//! Slice 1 MVP batch — authentication and session issuance, reusing the
//! S0-006 SECURITY DEFINER / session-token model rather than a new one.
//!
//! Rust's responsibilities exactly match final-architecture.md section
//! 2.3's split: "Rust authenticates the application user and issues the
//! session token; the database validates it." Concretely:
//! - Password verification happens here (Argon2), never in SQL.
//! - The opaque raw token is generated here from a CSPRNG and returned to
//!   the caller exactly once; only its SHA-256 hash is ever persisted.
//! - `iam.resolve_session[_with_permission]` (SQL, `SECURITY DEFINER`) is
//!   the only thing that ever resolves a token back to a user.

use argon2::password_hash::SaltString;
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use time::OffsetDateTime;

use crate::error::AppError;

/// Raw session tokens are 32 CSPRNG bytes, hex-encoded to a 64-character
/// string. No `hex`/`base64` crate dependency is added for this: encoding
/// 32 fixed-size bytes to hex is a five-line loop, not worth a new
/// dependency.
const TOKEN_BYTES: usize = 32;

/// How long a freshly issued session stays valid before
/// `iam.resolve_session[_with_permission]` starts rejecting it.
const SESSION_LIFETIME: time::Duration = time::Duration::hours(12);

pub(crate) struct LoginResult {
    /// The raw opaque token. Returned to the caller exactly once; the
    /// database only ever stores its SHA-256 hash.
    pub session_token: String,
    pub expires_at: OffsetDateTime,
}

fn to_hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

fn generate_raw_token() -> Result<String, AppError> {
    let mut bytes = [0u8; TOKEN_BYTES];
    getrandom::getrandom(&mut bytes)
        .map_err(|_| AppError::internal("failed to read OS randomness for a session token"))?;
    Ok(to_hex(&bytes))
}

/// SHA-256 of the raw token's UTF-8 bytes — the exact same hash
/// `iam.resolve_session[_with_permission]`'s `sha256(p_token::bytea)`
/// computes on the SQL side, so a token issued here is resolvable there.
fn token_hash(raw_token: &str) -> Vec<u8> {
    Sha256::digest(raw_token.as_bytes()).to_vec()
}

/// Authenticates a username/password pair and, on success, issues a new
/// session for `workstation_id`. Fails safely (a generic, non-distinguishing
/// error) on an unknown username, a wrong password, or an inactive account —
/// never revealing which of the three occurred, so a caller cannot enumerate
/// valid usernames by observing different failure modes.
pub(crate) async fn login(
    pool: &PgPool,
    username: &str,
    password: &str,
    workstation_id: &str,
) -> Result<LoginResult, AppError> {
    let row = sqlx::query_as::<_, (i64, String, bool)>(
        "SELECT id, password_hash, is_active FROM iam.users WHERE username = $1",
    )
    .bind(username)
    .fetch_optional(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    let Some((user_id, stored_hash, is_active)) = row else {
        return Err(AppError::SessionInvalid {
            diagnostic: "unknown username".to_string(),
        });
    };

    let parsed_hash = PasswordHash::new(&stored_hash).map_err(|_| AppError::SessionInvalid {
        diagnostic: "stored password hash is malformed".to_string(),
    })?;

    let verified = Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok();

    if !verified || !is_active {
        return Err(AppError::SessionInvalid {
            diagnostic: "invalid credentials or inactive account".to_string(),
        });
    }

    let raw_token = generate_raw_token()?;
    let hash = token_hash(&raw_token);
    let expires_at = OffsetDateTime::now_utc() + SESSION_LIFETIME;

    sqlx::query(
        "INSERT INTO iam.application_sessions (token_hash, user_id, workstation_id, expires_at) \
         VALUES ($1, $2, $3, $4)",
    )
    .bind(&hash)
    .bind(user_id)
    .bind(workstation_id)
    .bind(expires_at)
    .execute(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    Ok(LoginResult {
        session_token: raw_token,
        expires_at,
    })
}

/// Hashes a plaintext password into the self-describing Argon2 string
/// stored in `iam.users.password_hash`. Not called anywhere in the Golden
/// Transaction Chain itself (no user-creation command exists in this
/// batch — administrator/cashier account creation is an application
/// bootstrap concern, same scoping note as the migration's seed data), but
/// is the natural companion to [`login`]'s verification and is what a
/// future "create user" command will call.
///
/// The salt is built from `getrandom` bytes via `SaltString::encode_b64`,
/// not `SaltString::generate(&mut rng)` — the latter needs a
/// `CryptoRngCore` implementor, which (for the same reason [`generate_raw_token`]
/// does not use `argon2::password_hash::rand_core::OsRng`) is not reachable
/// without a `rand_core` feature this dependency graph does not enable.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn hash_password(password: &str) -> Result<String, AppError> {
    let mut salt_bytes = [0u8; 16];
    getrandom::getrandom(&mut salt_bytes)
        .map_err(|_| AppError::internal("failed to read OS randomness for a password salt"))?;
    let salt = SaltString::encode_b64(&salt_bytes)
        .map_err(|e| AppError::internal(format!("failed to encode password salt: {e}")))?;

    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|e| AppError::internal(format!("failed to hash password: {e}")))
}

/// Revokes a session so it can never be resolved again, even before its
/// natural expiry. A logout for an already-invalid token is treated as a
/// no-op success, not an error — the caller's intent ("this token should no
/// longer work") is already satisfied.
pub(crate) async fn logout(pool: &PgPool, raw_token: &str) -> Result<(), AppError> {
    let hash = token_hash(raw_token);
    sqlx::query(
        "UPDATE iam.application_sessions SET revoked_at = now() \
         WHERE token_hash = $1 AND revoked_at IS NULL",
    )
    .bind(&hash)
    .execute(pool)
    .await
    .map_err(AppError::from_posting_error)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_tokens_are_64_hex_characters_and_unique() {
        let a = generate_raw_token().unwrap();
        let b = generate_raw_token().unwrap();
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b, "two CSPRNG draws must not collide in a sane test run");
    }

    #[test]
    fn token_hash_is_deterministic_sha256() {
        let hash_a = token_hash("fixed-example-token");
        let hash_b = token_hash("fixed-example-token");
        assert_eq!(hash_a, hash_b);
        assert_eq!(hash_a.len(), 32);
    }

    #[test]
    fn different_tokens_hash_differently() {
        assert_ne!(token_hash("token-a"), token_hash("token-b"));
    }

    #[test]
    fn hash_password_round_trips_through_real_argon2_verification() {
        let hash = hash_password("correct horse battery staple").unwrap();
        let parsed = PasswordHash::new(&hash).unwrap();
        assert!(Argon2::default()
            .verify_password(b"correct horse battery staple", &parsed)
            .is_ok());
        assert!(Argon2::default()
            .verify_password(b"wrong password", &parsed)
            .is_err());
    }

    #[test]
    fn hash_password_uses_a_fresh_salt_each_time() {
        let a = hash_password("same-password").unwrap();
        let b = hash_password("same-password").unwrap();
        assert_ne!(
            a, b,
            "two hashes of the same password must differ (different salts)"
        );
    }

    // Genuine, opt-in Rust-to-PostgreSQL integration test — see
    // `application::stock_receipt::tests` for the full fixture/env-var
    // pattern this shares. Requires one additional fixture beyond that
    // module's list: a user with a REAL Argon2 hash (not the placeholder
    // string the other fixtures use, since this test verifies the actual
    // password check):
    //
    //   INSERT INTO iam.users (username, password_hash, display_name)
    //   VALUES ('realauthuser', '<output of hash_password("correct-password-123")>', 'Real Auth User');
    //   INSERT INTO iam.user_roles (user_id, role_id) SELECT <that user's id>, id FROM iam.roles WHERE code = 'CASHIER';
    fn require_test_pool_url() -> String {
        let url = std::env::var("STOCKIHA_TEST_DATABASE_URL")
            .expect("STOCKIHA_TEST_DATABASE_URL must be set to run this integration test");
        let options: sqlx::postgres::PgConnectOptions = url
            .parse()
            .expect("STOCKIHA_TEST_DATABASE_URL must be a valid PostgreSQL URL");
        let database = options.get_database().unwrap_or_default();
        assert!(
            database.ends_with("_test"),
            "refusing to run against a database not ending in `_test`: {database:?}"
        );
        url
    }

    #[tokio::test]
    #[ignore = "requires a live PostgreSQL server, STOCKIHA_TEST_DATABASE_URL, and the realauthuser fixture"]
    async fn login_then_logout_round_trips_against_a_real_argon2_hash() {
        let pool = sqlx::PgPool::connect(&require_test_pool_url())
            .await
            .expect("failed to connect to the integration test database");

        let wrong_password =
            login(&pool, "realauthuser", "the-wrong-password", "POS-AUTH-TEST").await;
        assert!(
            wrong_password.is_err(),
            "a wrong password must not issue a session"
        );

        let unknown_user = login(&pool, "no-such-user", "irrelevant", "POS-AUTH-TEST").await;
        assert!(
            unknown_user.is_err(),
            "an unknown username must not issue a session"
        );

        let result = login(
            &pool,
            "realauthuser",
            "correct-password-123",
            "POS-AUTH-TEST",
        )
        .await
        .expect("the correct password must issue a session");
        assert_eq!(result.session_token.len(), 64);

        // The freshly issued token must actually resolve through the real
        // SECURITY DEFINER function — proving the Rust-side SHA-256 over
        // the raw token's UTF-8 bytes matches the SQL side's
        // `sha256(p_token::bytea)` exactly, not just that *some* hash was
        // stored.
        let resolved: (i64,) = sqlx::query_as("SELECT user_id FROM iam.resolve_session($1)")
            .bind(&result.session_token)
            .fetch_one(&pool)
            .await
            .expect("the freshly issued token must resolve via iam.resolve_session");
        assert!(resolved.0 > 0);

        logout(&pool, &result.session_token)
            .await
            .expect("logout should succeed");

        // A revoked token must no longer resolve.
        let after_logout: Result<(i64,), _> =
            sqlx::query_as("SELECT user_id FROM iam.resolve_session($1)")
                .bind(&result.session_token)
                .fetch_one(&pool)
                .await;
        assert!(after_logout.is_err(), "a revoked token must not resolve");

        // Logging out an already-revoked token again is a no-op success,
        // not an error.
        logout(&pool, &result.session_token)
            .await
            .expect("a second logout of the same token must still succeed");
    }
}
