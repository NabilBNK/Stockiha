//! S0-006 — SECURITY DEFINER and session-token proof.
//!
//! Smallest technical proof that a PostgreSQL `SECURITY DEFINER` function, owned
//! by `stockiha_owner`, can validate an **opaque session token** (never an
//! `actor_user_id`), execute under the owner role, and be callable **only** by
//! `stockiha_runtime` — while the runtime role has no direct access to the
//! protected session/actor tables and cannot alter the function.
//!
//! Crate-private, consumer-free proof: no Tauri command, no IPC, no frontend,
//! no serialization. The full Slice-1 `iam.application_sessions` subsystem is
//! out of scope. Live assertions run as `#[ignore]` integration tests against a
//! dedicated PostgreSQL 18 test database (Windows verification).

pub(crate) mod sql;

use sql::{SQL_APPLY_GRANTS, SQL_CREATE_OBJECTS, SQL_TEARDOWN};
use sqlx::{PgConnection, Row};
use std::fmt;
use std::str::FromStr;

/// Opt-in confirmation for the live proof (must equal [`REQUIRED_CONFIRMATION_VALUE`]).
pub(crate) const SESSION_PROOF_CONFIRMATION_ENV: &str = "STOCKIHA_ALLOW_SESSION_DEFINER_PROOF";
/// Superuser admin connection URL for the live proof.
pub(crate) const SESSION_PROOF_ADMIN_URL_ENV: &str = "STOCKIHA_SESSION_PROOF_ADMIN_DATABASE_URL";
/// Required confirmation value.
pub(crate) const REQUIRED_CONFIRMATION_VALUE: &str = "YES";
/// The only database name the live proof will touch.
pub(crate) const REQUIRED_TEST_DATABASE_NAME: &str = "stockiha_session_definer_test";

/// Crate-private, non-serializable error type for the session-definer proof.
///
/// Payloads are diagnostic only and are never rendered by `Debug`/`Display`.
#[derive(PartialEq, Eq)]
pub(crate) enum SessionProofError {
    MissingEnvironmentVariable(&'static str),
    InvalidConfirmationValue(String),
    DatabaseNameMismatch(String),
    PostgresVersionMismatch(String),
    SuperuserRequired(String),
    Database(String),
    VerificationFailure(String),
}

impl fmt::Debug for SessionProofError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let text = match self {
            SessionProofError::MissingEnvironmentVariable(_) => {
                "SessionProofError::MissingEnvironmentVariable(<redacted>)"
            }
            SessionProofError::InvalidConfirmationValue(_) => {
                "SessionProofError::InvalidConfirmationValue(<redacted>)"
            }
            SessionProofError::DatabaseNameMismatch(_) => {
                "SessionProofError::DatabaseNameMismatch(<redacted>)"
            }
            SessionProofError::PostgresVersionMismatch(_) => {
                "SessionProofError::PostgresVersionMismatch(<redacted>)"
            }
            SessionProofError::SuperuserRequired(_) => {
                "SessionProofError::SuperuserRequired(<redacted>)"
            }
            SessionProofError::Database(_) => "SessionProofError::Database(<redacted>)",
            SessionProofError::VerificationFailure(_) => {
                "SessionProofError::VerificationFailure(<redacted>)"
            }
        };
        f.write_str(text)
    }
}

impl fmt::Display for SessionProofError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let text = match self {
            SessionProofError::MissingEnvironmentVariable(_) => {
                "missing required environment variable"
            }
            SessionProofError::InvalidConfirmationValue(_) => {
                "invalid session proof confirmation value"
            }
            SessionProofError::DatabaseNameMismatch(_) => {
                "database name mismatch for session proof"
            }
            SessionProofError::PostgresVersionMismatch(_) => "PostgreSQL major version mismatch",
            SessionProofError::SuperuserRequired(_) => {
                "superuser session required for session proof"
            }
            SessionProofError::Database(_) => "database error during session proof",
            SessionProofError::VerificationFailure(_) => "catalog verification failed",
        };
        f.write_str(text)
    }
}

impl std::error::Error for SessionProofError {}

/// The catalog posture of the proof function, read straight from `pg_proc`.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct FunctionCatalogPosture {
    pub security_definer: bool,
    pub owner: String,
    pub has_fixed_search_path: bool,
    pub runtime_can_execute: bool,
    pub public_can_execute: bool,
}

/// Require the opt-in confirmation environment variable to equal `"YES"`.
pub(crate) fn verify_confirmation() -> Result<(), SessionProofError> {
    let value = std::env::var(SESSION_PROOF_CONFIRMATION_ENV).map_err(|_| {
        SessionProofError::MissingEnvironmentVariable(SESSION_PROOF_CONFIRMATION_ENV)
    })?;
    if value != REQUIRED_CONFIRMATION_VALUE {
        return Err(SessionProofError::InvalidConfirmationValue(value));
    }
    Ok(())
}

/// Verify the connection points at the dedicated test database, is a superuser
/// session, and is PostgreSQL major version 18.
pub(crate) async fn verify_connection_guards(
    conn: &mut PgConnection,
) -> Result<(), SessionProofError> {
    let db: String = sqlx::query("SELECT current_database()")
        .fetch_one(&mut *conn)
        .await
        .map_err(|e| SessionProofError::Database(format!("current_database(): {e}")))?
        .get(0);
    if db != REQUIRED_TEST_DATABASE_NAME {
        return Err(SessionProofError::DatabaseNameMismatch(db));
    }

    let row = sqlx::query(
        "SELECT session_user, current_user, current_setting('is_superuser') AS is_superuser",
    )
    .fetch_one(&mut *conn)
    .await
    .map_err(|e| SessionProofError::Database(format!("session posture: {e}")))?;
    let sess_user: String = row.get("session_user");
    let curr_user: String = row.get("current_user");
    let is_super: String = row.get("is_superuser");
    if sess_user != curr_user {
        return Err(SessionProofError::SuperuserRequired(format!(
            "session_user ({sess_user}) must equal current_user ({curr_user})"
        )));
    }
    if is_super != "on" {
        return Err(SessionProofError::SuperuserRequired(format!(
            "active role ({curr_user}) is not a superuser"
        )));
    }

    let version_num_str: String = sqlx::query("SHOW server_version_num")
        .fetch_one(&mut *conn)
        .await
        .map_err(|e| SessionProofError::Database(format!("server_version_num: {e}")))?
        .get(0);
    let version_num = u32::from_str(&version_num_str).map_err(|_| {
        SessionProofError::PostgresVersionMismatch(format!("unparseable: {version_num_str}"))
    })?;
    if !(180000..190000).contains(&version_num) {
        return Err(SessionProofError::PostgresVersionMismatch(format!(
            "server_version_num is {version_num}, expected 180000..189999"
        )));
    }
    Ok(())
}

/// (Re)create the proof schema, objects, and grants. Idempotent via teardown.
pub(crate) async fn setup_proof_objects(conn: &mut PgConnection) -> Result<(), SessionProofError> {
    for statement in [SQL_TEARDOWN, SQL_CREATE_OBJECTS, SQL_APPLY_GRANTS] {
        sqlx::raw_sql(statement)
            .execute(&mut *conn)
            .await
            .map_err(|e| SessionProofError::Database(format!("setup failed: {e}")))?;
    }
    Ok(())
}

/// Drop all proof objects.
pub(crate) async fn teardown_proof_objects(
    conn: &mut PgConnection,
) -> Result<(), SessionProofError> {
    sqlx::raw_sql(SQL_TEARDOWN)
        .execute(&mut *conn)
        .await
        .map_err(|e| SessionProofError::Database(format!("teardown failed: {e}")))?;
    Ok(())
}

/// Read the proof function's catalog posture from `pg_proc`.
pub(crate) async fn read_function_posture(
    conn: &mut PgConnection,
) -> Result<FunctionCatalogPosture, SessionProofError> {
    let row = sqlx::query(
        r#"
        SELECT p.prosecdef,
               pg_get_userbyid(p.proowner) AS owner,
               COALESCE(
                   (SELECT bool_or(cfg LIKE 'search_path=%')
                    FROM unnest(p.proconfig) AS cfg),
                   false
               ) AS has_fixed_search_path,
               has_function_privilege('stockiha_runtime', p.oid, 'EXECUTE') AS runtime_exec,
               has_function_privilege('public', p.oid, 'EXECUTE') AS public_exec
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 's0_006_proof' AND p.proname = 'resolve_session';
        "#,
    )
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| SessionProofError::Database(format!("pg_proc query: {e}")))?
    .ok_or_else(|| {
        SessionProofError::VerificationFailure("proof function not found".to_string())
    })?;

    Ok(FunctionCatalogPosture {
        security_definer: row.get("prosecdef"),
        owner: row.get("owner"),
        has_fixed_search_path: row.get("has_fixed_search_path"),
        runtime_can_execute: row.get("runtime_exec"),
        public_can_execute: row.get("public_exec"),
    })
}

#[cfg(test)]
mod tests {
    use super::sql::{INVALID_SESSION_SQLSTATE, PROOF_FUNCTION};
    use super::*;

    #[test]
    fn confirmation_fails_when_unset() {
        std::env::remove_var(SESSION_PROOF_CONFIRMATION_ENV);
        assert_eq!(
            verify_confirmation().expect_err("must fail"),
            SessionProofError::MissingEnvironmentVariable(SESSION_PROOF_CONFIRMATION_ENV)
        );
    }

    #[test]
    fn confirmation_fails_when_not_yes() {
        std::env::set_var(SESSION_PROOF_CONFIRMATION_ENV, "no");
        assert_eq!(
            verify_confirmation().expect_err("must fail"),
            SessionProofError::InvalidConfirmationValue("no".to_string())
        );
        std::env::remove_var(SESSION_PROOF_CONFIRMATION_ENV);
    }

    #[test]
    fn confirmation_succeeds_when_yes() {
        std::env::set_var(SESSION_PROOF_CONFIRMATION_ENV, "YES");
        assert!(verify_confirmation().is_ok());
        std::env::remove_var(SESSION_PROOF_CONFIRMATION_ENV);
    }

    #[test]
    fn error_debug_and_display_never_expose_sentinel() {
        const SENTINEL: &str = "DO_NOT_EXPOSE_DIAGNOSTIC_SECRET";
        let cases = [
            SessionProofError::MissingEnvironmentVariable(SESSION_PROOF_CONFIRMATION_ENV),
            SessionProofError::InvalidConfirmationValue(SENTINEL.to_string()),
            SessionProofError::DatabaseNameMismatch(SENTINEL.to_string()),
            SessionProofError::PostgresVersionMismatch(SENTINEL.to_string()),
            SessionProofError::SuperuserRequired(SENTINEL.to_string()),
            SessionProofError::Database(SENTINEL.to_string()),
            SessionProofError::VerificationFailure(SENTINEL.to_string()),
        ];
        for err in cases {
            assert!(!format!("{err:?}").contains(SENTINEL));
            assert!(!format!("{err}").contains(SENTINEL));
        }
    }

    // ——— Live proof (requires PostgreSQL 18 + the S0-004 roles) ———
    //
    //   $env:STOCKIHA_ALLOW_SESSION_DEFINER_PROOF = "YES"
    //   $env:STOCKIHA_SESSION_PROOF_ADMIN_DATABASE_URL =
    //     "postgres://<superuser>:<pw>@localhost:5432/stockiha_session_definer_test"
    //   cargo test -- --ignored
    //
    // Requires the four S0-004 roles to already exist in the cluster.

    use sqlx::Connection;

    fn admin_url() -> String {
        std::env::var(SESSION_PROOF_ADMIN_URL_ENV)
            .expect("STOCKIHA_SESSION_PROOF_ADMIN_DATABASE_URL required")
    }

    /// Seed one actor and three sessions (valid / expired / revoked). Only the
    /// SHA-256 hash of each token is stored — the raw token is bound solely to
    /// compute `sha256()` and is never persisted.
    async fn seed_fixtures(
        conn: &mut PgConnection,
        valid: &str,
        expired: &str,
        revoked: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO s0_006_proof.actors(user_id, display_name) VALUES ('u1', 'Alice')",
        )
        .execute(&mut *conn)
        .await?;
        sqlx::query(
            "INSERT INTO s0_006_proof.app_sessions(token_hash, user_id, workstation_id, expires_at) \
             VALUES (sha256($1::bytea), 'u1', 'WS-1', now() + interval '1 hour')",
        )
        .bind(valid)
        .execute(&mut *conn)
        .await?;
        sqlx::query(
            "INSERT INTO s0_006_proof.app_sessions(token_hash, user_id, workstation_id, expires_at) \
             VALUES (sha256($1::bytea), 'u1', 'WS-1', now() - interval '1 hour')",
        )
        .bind(expired)
        .execute(&mut *conn)
        .await?;
        sqlx::query(
            "INSERT INTO s0_006_proof.app_sessions(token_hash, user_id, workstation_id, expires_at, revoked_at) \
             VALUES (sha256($1::bytea), 'u1', 'WS-1', now() + interval '1 hour', now())",
        )
        .bind(revoked)
        .execute(&mut *conn)
        .await?;
        Ok(())
    }

    #[tokio::test]
    #[ignore = "requires PostgreSQL 18, the S0-004 roles, and the session-proof env vars"]
    async fn security_definer_session_proof_end_to_end() {
        verify_confirmation().expect("confirmation must be YES");
        let url = admin_url();
        let mut admin = PgConnection::connect(&url).await.expect("admin connect");

        verify_connection_guards(&mut admin)
            .await
            .expect("connection guards must pass");
        setup_proof_objects(&mut admin)
            .await
            .expect("setup must succeed");
        seed_fixtures(&mut admin, "valid-token", "expired-token", "revoked-token")
            .await
            .expect("seed must succeed");

        // --- Catalog assertions (acceptance criterion 12) ---
        let posture = read_function_posture(&mut admin)
            .await
            .expect("posture read");
        assert!(
            posture.security_definer,
            "function must be SECURITY DEFINER"
        );
        assert_eq!(
            posture.owner, "stockiha_owner",
            "owner must be stockiha_owner"
        );
        assert!(
            posture.has_fixed_search_path,
            "must pin a fixed search_path"
        );
        assert!(posture.runtime_can_execute, "runtime must have EXECUTE");
        assert!(!posture.public_can_execute, "PUBLIC must not have EXECUTE");

        // --- Behavioral assertions as the runtime role ---
        let mut rt = PgConnection::connect(&url).await.expect("runtime connect");
        sqlx::query("SET SESSION AUTHORIZATION 'stockiha_runtime'")
            .execute(&mut rt)
            .await
            .expect("assume runtime role");
        let who: String = sqlx::query_scalar("SELECT session_user")
            .fetch_one(&mut rt)
            .await
            .unwrap();
        assert_eq!(who, "stockiha_runtime");

        // Valid token resolves the actor/workstation snapshot.
        let row = sqlx::query(
            "SELECT user_id, workstation_id, display_name FROM s0_006_proof.resolve_session($1)",
        )
        .bind("valid-token")
        .fetch_one(&mut rt)
        .await
        .expect("valid token must resolve");
        let uid: String = row.get("user_id");
        let ws: String = row.get("workstation_id");
        let name: String = row.get("display_name");
        assert_eq!(
            (uid.as_str(), ws.as_str(), name.as_str()),
            ("u1", "WS-1", "Alice")
        );

        // Missing / expired / revoked are all rejected with SQLSTATE 28000.
        for bad in ["no-such-token", "expired-token", "revoked-token"] {
            let err = sqlx::query("SELECT * FROM s0_006_proof.resolve_session($1)")
                .bind(bad)
                .fetch_all(&mut rt)
                .await
                .expect_err("invalid session must be rejected");
            let code = err
                .as_database_error()
                .and_then(|e| e.code())
                .map(|c| c.into_owned())
                .unwrap_or_default();
            assert_eq!(code, INVALID_SESSION_SQLSTATE, "expected 28000 for {bad}");
        }

        // Runtime cannot read the protected tables directly (criterion 6).
        for table in ["app_sessions", "actors"] {
            let err = sqlx::query(&format!("SELECT * FROM s0_006_proof.{table}"))
                .fetch_all(&mut rt)
                .await
                .expect_err("runtime must be denied direct table access");
            let code = err
                .as_database_error()
                .and_then(|e| e.code())
                .map(|c| c.into_owned())
                .unwrap_or_default();
            assert_eq!(code, "42501", "expected insufficient_privilege for {table}");
        }

        // Runtime cannot alter the function (criterion 11).
        let alter = sqlx::query(&format!(
            "ALTER FUNCTION s0_006_proof.{PROOF_FUNCTION}(text) RESET search_path"
        ))
        .execute(&mut rt)
        .await;
        assert!(alter.is_err(), "runtime must not alter the proof function");

        rt.close().await.ok();

        // Cleanup.
        let _ = teardown_proof_objects(&mut admin).await;
        std::env::remove_var(SESSION_PROOF_CONFIRMATION_ENV);
    }
}
