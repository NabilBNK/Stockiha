use serde::{Deserialize, Serialize};
use sqlx::PgPool;

use crate::error::AppError;

/// DTO for listing users.
///
/// `iam.user_roles` is a junction table, so a user may hold more than one role.
/// The roles are returned as parallel arrays ordered by role code rather than
/// flattened into one row per assignment, which previously duplicated users.
#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct UserSnapshot {
    pub user_id: i64,
    pub username: String,
    pub display_name: String,
    pub is_active: bool,
    pub role_codes: Vec<String>,
    pub role_names: Vec<String>,
}

/// DTO for listing permissions
#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct PermissionSnapshot {
    pub code: String,
    pub name: String,
}

/// DTO for listing roles
#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct RoleSnapshot {
    pub code: String,
    pub name: String,
}

/// Classify an IAM database error.
///
/// Every exception raised by the `iam.*` administration functions carries an
/// explicit SQLSTATE (`28000` invalid session, `42501` missing permission,
/// `55000` precondition), so the shared SQLSTATE classifier is sufficient and no
/// database message is ever inspected. Diagnostics stay internal — they are
/// dropped at the IPC boundary by `IpcError`.
fn map_iam_error(err: sqlx::Error) -> AppError {
    AppError::from_posting_error(err)
}

pub(crate) async fn create_user(
    pool: &PgPool,
    token: &str,
    username: &str,
    password: &str,
    display_name: &str,
    role_code: &str,
) -> Result<i64, AppError> {
    let password_hash = crate::application::auth::hash_password(password)?;

    let (new_user_id,): (i64,) = sqlx::query_as("SELECT iam.create_user($1, $2, $3, $4, $5)")
        .bind(token)
        .bind(username)
        .bind(&password_hash)
        .bind(display_name)
        .bind(role_code)
        .fetch_one(pool)
        .await
        .map_err(map_iam_error)?;

    Ok(new_user_id)
}

pub(crate) async fn list_users(pool: &PgPool, token: &str) -> Result<Vec<UserSnapshot>, AppError> {
    let users = sqlx::query_as::<_, (i64, String, String, bool, Vec<String>, Vec<String>)>(
        "SELECT user_id, username, display_name, is_active, role_codes, role_names \
         FROM iam.list_users($1)",
    )
    .bind(token)
    .fetch_all(pool)
    .await
    .map_err(map_iam_error)?
    .into_iter()
    .map(|row| UserSnapshot {
        user_id: row.0,
        username: row.1,
        display_name: row.2,
        is_active: row.3,
        role_codes: row.4,
        role_names: row.5,
    })
    .collect();

    Ok(users)
}

pub(crate) async fn set_user_active(
    pool: &PgPool,
    token: &str,
    target_user_id: i64,
    is_active: bool,
) -> Result<(), AppError> {
    sqlx::query("SELECT iam.set_user_active($1, $2, $3)")
        .bind(token)
        .bind(target_user_id)
        .bind(is_active)
        .execute(pool)
        .await
        .map_err(map_iam_error)?;

    Ok(())
}

pub(crate) async fn assign_user_role(
    pool: &PgPool,
    token: &str,
    target_user_id: i64,
    role_code: &str,
) -> Result<(), AppError> {
    sqlx::query("SELECT iam.assign_user_role($1, $2, $3)")
        .bind(token)
        .bind(target_user_id)
        .bind(role_code)
        .execute(pool)
        .await
        .map_err(map_iam_error)?;

    Ok(())
}

pub(crate) async fn create_role(
    pool: &PgPool,
    token: &str,
    role_code: &str,
    role_name: &str,
) -> Result<i64, AppError> {
    let (new_role_id,): (i64,) = sqlx::query_as("SELECT iam.create_role($1, $2, $3)")
        .bind(token)
        .bind(role_code)
        .bind(role_name)
        .fetch_one(pool)
        .await
        .map_err(map_iam_error)?;

    Ok(new_role_id)
}

pub(crate) async fn list_permissions(
    pool: &PgPool,
    token: &str,
) -> Result<Vec<PermissionSnapshot>, AppError> {
    let permissions =
        sqlx::query_as::<_, (String, String)>("SELECT code, name FROM iam.list_permissions($1)")
            .bind(token)
            .fetch_all(pool)
            .await
            .map_err(map_iam_error)?
            .into_iter()
            .map(|row| PermissionSnapshot {
                code: row.0,
                name: row.1,
            })
            .collect();

    Ok(permissions)
}

pub(crate) async fn list_roles(pool: &PgPool, token: &str) -> Result<Vec<RoleSnapshot>, AppError> {
    let roles = sqlx::query_as::<_, (String, String)>("SELECT code, name FROM iam.list_roles($1)")
        .bind(token)
        .fetch_all(pool)
        .await
        .map_err(map_iam_error)?
        .into_iter()
        .map(|row| RoleSnapshot {
            code: row.0,
            name: row.1,
        })
        .collect();

    Ok(roles)
}

/// Read the permission codes a single role currently grants.
///
/// The counterpart to [`set_role_permissions`], which replaces a role's grants
/// wholesale. Without this read the editor could not know what it was about to
/// overwrite, so it opened empty and every save submitted a set that dropped
/// whatever the role already held.
pub(crate) async fn list_role_permissions(
    pool: &PgPool,
    token: &str,
    role_code: &str,
) -> Result<Vec<String>, AppError> {
    let codes =
        sqlx::query_as::<_, (String,)>("SELECT code FROM iam.list_role_permissions($1, $2)")
            .bind(token)
            .bind(role_code)
            .fetch_all(pool)
            .await
            .map_err(map_iam_error)?
            .into_iter()
            .map(|row| row.0)
            .collect();

    Ok(codes)
}

pub(crate) async fn set_role_permissions(
    pool: &PgPool,
    token: &str,
    role_code: &str,
    permission_codes: &[String],
) -> Result<(), AppError> {
    sqlx::query("SELECT iam.set_role_permissions($1, $2, $3)")
        .bind(token)
        .bind(role_code)
        .bind(permission_codes)
        .execute(pool)
        .await
        .map_err(map_iam_error)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::application::test_fixtures::{
        require_test_pool_url, root_admin_session, seed_user_via_admin,
    };

    /// WS-A-4 regression: the permission editor must be able to read a role's
    /// current grants, and a save must replace exactly the submitted set.
    ///
    /// Before `iam.list_role_permissions` existed the editor had no way to load
    /// current state, so it opened every box unchecked and a save submitted a
    /// set that omitted everything the role already held. On a role without
    /// `MANAGE_USERS` the wholesale replace then deleted those grants silently.
    /// Every assertion here is against the database, never the UI.
    #[tokio::test]
    #[ignore = "requires a live PostgreSQL server, STOCKIHA_TEST_DATABASE_URL"]
    async fn role_permissions_round_trip_reads_and_persists_exactly() {
        let pool = sqlx::PgPool::connect(&require_test_pool_url())
            .await
            .expect("failed to connect to the integration test database");

        let suffix = crate::application::test_fixtures::unique_suffix();
        let (_root_id, root_token) = root_admin_session(&pool).await;

        let cashier_user = format!("cashier_rp_{suffix}");
        let (_cashier_id, cashier_token) =
            seed_user_via_admin(&pool, &root_token, &cashier_user, "CASHIER").await;

        // A throwaway role, so no seeded role's grants are disturbed.
        let role_code = format!("PERMRT_{suffix}");
        create_role(&pool, &root_token, &role_code, "Permission round trip")
            .await
            .expect("role creation must succeed");

        // A brand-new role holds nothing, and the reader must say so.
        let initial = list_role_permissions(&pool, &root_token, &role_code)
            .await
            .expect("reading a new role must succeed");
        assert!(
            initial.is_empty(),
            "a newly created role must hold no permissions, got {initial:?}"
        );

        // Grant three, then prove the reader returns exactly those three.
        let granted = vec![
            "VIEW_CUSTOMERS".to_owned(),
            "MANAGE_INVENTORY".to_owned(),
            "MANAGE_CATALOG".to_owned(),
        ];
        set_role_permissions(&pool, &root_token, &role_code, &granted)
            .await
            .expect("granting must succeed");

        let mut after_grant = list_role_permissions(&pool, &root_token, &role_code)
            .await
            .expect("reading after a grant must succeed");
        after_grant.sort();
        let mut expected = granted.clone();
        expected.sort();
        assert_eq!(
            after_grant, expected,
            "the reader must return exactly the persisted grants"
        );

        // The reader must agree with the table itself, not merely with itself.
        let direct: Vec<String> = sqlx::query_as::<_, (String,)>(
            "SELECT p.code FROM iam.role_permissions rp \
             JOIN iam.roles r ON r.id = rp.role_id \
             JOIN iam.permissions p ON p.id = rp.permission_id \
             WHERE r.code = $1 ORDER BY p.code",
        )
        .bind(&role_code)
        .fetch_all(&pool)
        .await
        .expect("direct read must succeed")
        .into_iter()
        .map(|row| row.0)
        .collect();
        assert_eq!(
            after_grant, direct,
            "iam.list_role_permissions must match iam.role_permissions exactly"
        );

        // Removing one permission must remove only that one — the defect this
        // whole change exists to prevent is the other two vanishing too.
        let reduced = vec!["VIEW_CUSTOMERS".to_owned(), "MANAGE_CATALOG".to_owned()];
        set_role_permissions(&pool, &root_token, &role_code, &reduced)
            .await
            .expect("revoking one permission must succeed");

        let mut after_revoke = list_role_permissions(&pool, &root_token, &role_code)
            .await
            .expect("reading after a revoke must succeed");
        after_revoke.sort();
        let mut expected_reduced = reduced.clone();
        expected_reduced.sort();
        assert_eq!(
            after_revoke, expected_reduced,
            "revoking MANAGE_INVENTORY must leave the other two grants intact"
        );

        // Authorization is the database's job: a CASHIER holds neither
        // MANAGE_ROLES nor the right to read or rewrite a role's grants.
        let read_denied = list_role_permissions(&pool, &cashier_token, &role_code)
            .await
            .expect_err("a cashier must not read role permissions");
        assert!(
            matches!(read_denied, AppError::PermissionDenied { .. }),
            "expected PermissionDenied on read, got {read_denied:?}"
        );

        let write_denied = set_role_permissions(&pool, &cashier_token, &role_code, &[])
            .await
            .expect_err("a cashier must not rewrite role permissions");
        assert!(
            matches!(write_denied, AppError::PermissionDenied { .. }),
            "expected PermissionDenied on write, got {write_denied:?}"
        );

        // An invalid session is rejected before any permission test.
        let invalid = list_role_permissions(&pool, "not-a-real-token", &role_code)
            .await
            .expect_err("an invalid session must be rejected");
        assert!(
            matches!(invalid, AppError::SessionInvalid { .. }),
            "expected SessionInvalid, got {invalid:?}"
        );

        // An unknown role is a precondition failure, not an empty result — an
        // empty list would let the editor open on a role that does not exist.
        let unknown = list_role_permissions(&pool, &root_token, "NO_SUCH_ROLE_XYZ")
            .await
            .expect_err("an unknown role must be rejected");
        assert!(
            matches!(unknown, AppError::PreconditionFailed { .. }),
            "expected PreconditionFailed, got {unknown:?}"
        );

        // SUPER_ADMIN stays readable so the editor can display it, while the
        // write path keeps refusing it.
        let super_admin = list_role_permissions(&pool, &root_token, "SUPER_ADMIN")
            .await
            .expect("SUPER_ADMIN must be readable");
        assert!(
            !super_admin.is_empty(),
            "SUPER_ADMIN must report the permissions it holds"
        );
        let super_admin_write = set_role_permissions(&pool, &root_token, "SUPER_ADMIN", &[])
            .await
            .expect_err("SUPER_ADMIN must not be writable");
        assert!(
            matches!(super_admin_write, AppError::PreconditionFailed { .. }),
            "expected PreconditionFailed for SUPER_ADMIN write, got {super_admin_write:?}"
        );
    }

    #[tokio::test]
    #[ignore = "requires a live PostgreSQL server, STOCKIHA_TEST_DATABASE_URL"]
    async fn test_iam_operations_rigorous() {
        let pool = sqlx::PgPool::connect(&require_test_pool_url())
            .await
            .expect("failed to connect to the integration test database");

        let suffix = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();

        // The root administrator is the only fixture that can be created without
        // an existing administrator; everything else goes through iam.create_user.
        let (root_admin_id, root_admin_token) = root_admin_session(&pool).await;

        let cashier_user = format!("cashier_ops_{}", suffix);
        let admin_user = format!("admin_ops_{}", suffix);

        let (_cashier_id, cashier_token) =
            seed_user_via_admin(&pool, &root_admin_token, &cashier_user, "CASHIER").await;
        let (_admin_id, admin_token) =
            seed_user_via_admin(&pool, &root_admin_token, &admin_user, "ADMIN").await;

        // ==========================================
        // AUTHORIZATION TESTS
        // ==========================================
        // 1. Invalid session token
        let err = list_users(&pool, "invalid-token-123").await.unwrap_err();
        assert!(matches!(err, AppError::SessionInvalid { .. }));

        // 2. Valid session without MANAGE_USERS (Cashier trying to create user)
        let err = create_user(
            &pool,
            &cashier_token,
            &format!("fail_user_{}", suffix),
            "secret_pass",
            "Fail User",
            "CASHIER",
        )
        .await
        .unwrap_err();
        assert!(matches!(err, AppError::PermissionDenied { .. }));

        // 3. Valid session without MANAGE_ROLES (Cashier trying to create role)
        let err = create_role(
            &pool,
            &cashier_token,
            &format!("FAIL_ROLE_{}", suffix),
            "Fail Role",
        )
        .await
        .unwrap_err();
        assert!(matches!(err, AppError::PermissionDenied { .. }));

        // ==========================================
        // SUCCESS TESTS
        // ==========================================
        // Create User (Admin can create users)
        let new_username = format!("new_ops_user_{}", suffix);
        let new_user_id = create_user(
            &pool,
            &admin_token,
            &new_username,
            "secret_pass",
            "New Ops User",
            "CASHIER",
        )
        .await
        .expect("ADMIN should be able to create user");

        // List Users
        let users = list_users(&pool, &admin_token).await.unwrap();
        let created_user = users
            .iter()
            .find(|u| u.user_id == new_user_id)
            .expect("new user should be in the list");
        assert_eq!(created_user.username, new_username);
        assert_eq!(created_user.display_name, "New Ops User");
        assert!(created_user.is_active);
        assert_eq!(created_user.role_codes, vec!["CASHIER".to_string()]);

        // Set user active (deactivate)
        set_user_active(&pool, &admin_token, new_user_id, false)
            .await
            .unwrap();
        let users = list_users(&pool, &admin_token).await.unwrap();
        let deactivated_user = users.iter().find(|u| u.user_id == new_user_id).unwrap();
        assert!(!deactivated_user.is_active);

        // Assign user role
        assign_user_role(&pool, &admin_token, new_user_id, "MANAGER")
            .await
            .unwrap();
        let users = list_users(&pool, &admin_token).await.unwrap();
        let upgraded_user = users.iter().find(|u| u.user_id == new_user_id).unwrap();
        assert_eq!(upgraded_user.role_codes, vec!["MANAGER".to_string()]);

        // Create custom role (Admin has MANAGE_ROLES)
        let new_role_code = format!("CUSTOM_OPS_{}", suffix);
        let _new_role_id = create_role(&pool, &admin_token, &new_role_code, "Custom Ops Role")
            .await
            .unwrap();

        // List permissions
        let perms = list_permissions(&pool, &admin_token).await.unwrap();
        assert!(!perms.is_empty());
        assert!(perms.iter().any(|p| p.code == "MANAGE_USERS"));

        // Replace role permissions
        set_role_permissions(
            &pool,
            &admin_token,
            &new_role_code,
            &["MANAGE_USERS".to_string()],
        )
        .await
        .unwrap();

        // ==========================================
        // ERROR PROPAGATION TESTS
        // ==========================================

        // 1. duplicate username -> PreconditionFailed
        let err = create_user(
            &pool,
            &admin_token,
            &new_username, // already exists
            "secret_pass",
            "Dup Ops User",
            "CASHIER",
        )
        .await
        .unwrap_err();
        assert!(
            matches!(err, AppError::PreconditionFailed { diagnostic } if diagnostic.contains("already exists"))
        );

        // 2. unknown role -> PreconditionFailed
        let err = create_user(
            &pool,
            &admin_token,
            &format!("another_user_{}", suffix),
            "secret_pass",
            "Anon User",
            "UNKNOWN_ROLE",
        )
        .await
        .unwrap_err();
        assert!(
            matches!(err, AppError::PreconditionFailed { diagnostic } if diagnostic.contains("unknown role"))
        );

        // 3. unknown permission -> PreconditionFailed
        let err = set_role_permissions(
            &pool,
            &admin_token,
            &new_role_code,
            &["UNKNOWN_PERMISSION".to_string()],
        )
        .await
        .unwrap_err();
        assert!(
            matches!(err, AppError::PreconditionFailed { diagnostic } if diagnostic.contains("unknown permission"))
        );

        // 4. nonexistent user -> PreconditionFailed
        let err = set_user_active(&pool, &admin_token, -1, false)
            .await
            .unwrap_err();
        assert!(
            matches!(err, AppError::PreconditionFailed { diagnostic } if diagnostic.contains("does not exist"))
        );

        let err = assign_user_role(&pool, &admin_token, -1, "MANAGER")
            .await
            .unwrap_err();
        assert!(
            matches!(err, AppError::PreconditionFailed { diagnostic } if diagnostic.contains("does not exist"))
        );

        // 5. Invalid role assignment (unknown role) -> PreconditionFailed
        let err = assign_user_role(&pool, &admin_token, new_user_id, "UNKNOWN_ROLE")
            .await
            .unwrap_err();
        assert!(
            matches!(err, AppError::PreconditionFailed { diagnostic } if diagnostic.contains("unknown role"))
        );

        // 6. SUPER_ADMIN hierarchy restriction (ADMIN cannot assign SUPER_ADMIN) -> PreconditionFailed
        let err = assign_user_role(&pool, &admin_token, new_user_id, "SUPER_ADMIN")
            .await
            .unwrap_err();
        assert!(
            matches!(err, AppError::PreconditionFailed { diagnostic } if diagnostic.contains("only a SUPER_ADMIN"))
        );

        // 7. SUPER_ADMIN permission protection (cannot change SUPER_ADMIN role permissions) -> PreconditionFailed
        let err = set_role_permissions(&pool, &admin_token, "SUPER_ADMIN", &[])
            .await
            .unwrap_err();
        assert!(
            matches!(err, AppError::PreconditionFailed { diagnostic } if diagnostic.contains("SUPER_ADMIN role"))
        );

        // 8. self-deactivation -> PreconditionFailed
        let err = set_user_active(&pool, &root_admin_token, root_admin_id, false)
            .await
            .unwrap_err();
        assert!(
            matches!(err, AppError::PreconditionFailed { diagnostic } if diagnostic.contains("deactivate own user account"))
        );

        // 9. malformed role code -> PreconditionFailed
        let err = create_role(&pool, &admin_token, "bad-role-123", "Bad role")
            .await
            .unwrap_err();
        assert!(
            matches!(err, AppError::PreconditionFailed { diagnostic } if diagnostic.contains("malformed role code"))
        );

        // 10. duplicate role code -> PreconditionFailed
        let err = create_role(&pool, &admin_token, &new_role_code, "Dup role")
            .await
            .unwrap_err();
        assert!(
            matches!(err, AppError::PreconditionFailed { diagnostic } if diagnostic.contains("role code already exists"))
        );
    }

    /// The Rust IPC boundary classifies IAM failures purely by SQLSTATE, so the
    /// SQL functions must actually emit the codes it expects. Asserted directly
    /// against the database rather than through the mapped `AppError`, which is
    /// what the other tests cover.
    #[tokio::test]
    #[ignore = "requires a live PostgreSQL server, STOCKIHA_TEST_DATABASE_URL"]
    async fn iam_functions_emit_the_expected_sqlstates() {
        let pool = sqlx::PgPool::connect(&require_test_pool_url())
            .await
            .expect("failed to connect to the integration test database");

        let suffix = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();

        let (_root_id, root_token) = root_admin_session(&pool).await;
        let (_cashier_id, cashier_token) = seed_user_via_admin(
            &pool,
            &root_token,
            &format!("sqlstate_cashier_{suffix}"),
            "CASHIER",
        )
        .await;

        async fn sqlstate_of(pool: &sqlx::PgPool, sql: &str, token: &str) -> String {
            let error = sqlx::query(sql)
                .bind(token)
                .execute(pool)
                .await
                .expect_err("this statement must fail");
            error
                .as_database_error()
                .and_then(|db| db.code().map(|code| code.into_owned()))
                .unwrap_or_else(|| String::from("<no sqlstate>"))
        }

        // 28000 — invalid, expired, or revoked session.
        assert_eq!(
            sqlstate_of(
                &pool,
                "SELECT * FROM iam.list_users($1)",
                "not-a-real-token"
            )
            .await,
            "28000"
        );

        // 42501 — authenticated but missing the required permission.
        for statement in [
            "SELECT * FROM iam.list_users($1)",
            "SELECT iam.create_user($1, 'x', 'y', 'z', 'CASHIER')",
            "SELECT iam.create_role($1, 'X_ROLE', 'X')",
            "SELECT iam.set_role_permissions($1, 'CASHIER', ARRAY[]::text[])",
        ] {
            assert_eq!(
                sqlstate_of(&pool, statement, &cashier_token).await,
                "42501",
                "a CASHIER must be refused by: {statement}"
            );
        }

        // 55000 — authorized, but the requested state change is not allowed.
        for statement in [
            "SELECT iam.create_user($1, '', 'hash', 'n', 'CASHIER')",
            "SELECT iam.create_user($1, 'u', 'hash', 'n', 'NO_SUCH_ROLE')",
            "SELECT iam.create_role($1, 'lowercase', 'n')",
            "SELECT iam.assign_user_role($1, -1, 'CASHIER')",
            "SELECT iam.set_user_active($1, -1, false)",
            "SELECT iam.set_role_permissions($1, 'SUPER_ADMIN', ARRAY[]::text[])",
            "SELECT iam.set_role_permissions($1, 'CASHIER', ARRAY['NO_SUCH_PERMISSION'])",
        ] {
            assert_eq!(
                sqlstate_of(&pool, statement, &root_token).await,
                "55000",
                "expected a precondition failure from: {statement}"
            );
        }
    }

    /// Regression coverage for the WS-A administration-safety guards installed by
    /// migration `20260822190000_iam_admin_safety_hardening.sql`, plus the
    /// SUPER_ADMIN-specific guard added by
    /// `20260823210000_pre_ws_b_superadmin_bootstrap.sql`.
    ///
    /// The bootstrapped root account now holds SUPER_ADMIN, not ADMIN (see
    /// `core.bootstrap_first_admin`). Because SUPER_ADMIN always holds
    /// MANAGE_USERS and root can never be deactivated or reassigned away from
    /// SUPER_ADMIN while it is the last holder, an ordinary ADMIN peer can no
    /// longer be driven into the MANAGE_USERS lockout scenario through the
    /// sanctioned API — root always remains as another active administrator.
    /// That branch of coverage is replaced with an assertion that the demotion
    /// now correctly succeeds. This test must never call
    /// `set_role_permissions` on the shared `ADMIN` role: doing so would
    /// permanently strip every permission from the ADMIN role definition used
    /// by every other fixture in this database.
    #[tokio::test]
    #[ignore = "requires a live PostgreSQL server, STOCKIHA_TEST_DATABASE_URL"]
    async fn iam_admin_safety_guards() {
        let pool = sqlx::PgPool::connect(&require_test_pool_url())
            .await
            .expect("failed to connect to the integration test database");

        let suffix = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();

        let (root_id, root_token) = root_admin_session(&pool).await;

        // --- list_users returns exactly one row per user ---
        // The original implementation inner-joined iam.user_roles without
        // aggregating, so a user holding N roles appeared N times. Stacked roles
        // are not reachable through the sanctioned API (iam.assign_user_role
        // replaces every assignment), so the invariant is asserted structurally:
        // the projection must have the same cardinality as iam.users, and roles
        // must arrive as arrays rather than as repeated rows.
        let users = list_users(&pool, &root_token).await.unwrap();
        let (user_count,): (i64,) = sqlx::query_as("SELECT count(*) FROM iam.users")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(
            users.len() as i64,
            user_count,
            "iam.list_users must project one row per user"
        );

        let distinct_ids: std::collections::HashSet<i64> =
            users.iter().map(|user| user.user_id).collect();
        assert_eq!(
            distinct_ids.len(),
            users.len(),
            "iam.list_users must not repeat a user id"
        );

        let root_row = users
            .iter()
            .find(|user| user.user_id == root_id)
            .expect("the acting administrator must appear in its own listing");
        assert_eq!(root_row.role_codes, vec!["SUPER_ADMIN".to_string()]);
        assert_eq!(root_row.role_names.len(), root_row.role_codes.len());

        // Derive an ordinary ADMIN account through root: the escalation check
        // below only means something for an actor that does not already hold
        // SUPER_ADMIN.
        let (admin_id, admin_token) =
            seed_user_via_admin(&pool, &root_token, &format!("admin_ops_{suffix}"), "ADMIN").await;

        // --- create_user must not be an escalation path to SUPER_ADMIN ---
        let err = create_user(
            &pool,
            &admin_token,
            &format!("escalated_{suffix}"),
            "secret_pass",
            "Escalated",
            "SUPER_ADMIN",
        )
        .await
        .unwrap_err();
        assert!(
            matches!(err, AppError::PreconditionFailed { diagnostic } if diagnostic.contains("only a SUPER_ADMIN")),
            "an ADMIN must not be able to create a SUPER_ADMIN account"
        );

        // --- the last active SUPER_ADMIN can never be deactivated or
        //     reassigned away, even by another MANAGE_USERS holder (Pre-WS-B
        //     guard: role-code-specific, independent of the ADMIN peer above
        //     also holding MANAGE_USERS). ---
        let err = set_user_active(&pool, &admin_token, root_id, false)
            .await
            .unwrap_err();
        assert!(
            matches!(err, AppError::PreconditionFailed { diagnostic }
                if diagnostic.contains("last active SUPER_ADMIN")),
            "the last active SUPER_ADMIN must never be deactivatable"
        );

        let err = assign_user_role(&pool, &admin_token, root_id, "ADMIN")
            .await
            .unwrap_err();
        assert!(
            matches!(err, AppError::PreconditionFailed { diagnostic }
                if diagnostic.contains("last active SUPER_ADMIN")),
            "the last active SUPER_ADMIN must never be reassigned away from SUPER_ADMIN"
        );

        // --- a non-SUPER_ADMIN administrator CAN be demoted while SUPER_ADMIN
        //     remains active — MANAGE_USERS is never actually stranded as
        //     long as the permanent owner exists. ---
        let (peer_id, peer_token) = seed_user_via_admin(
            &pool,
            &admin_token,
            &format!("safety_peer_{suffix}"),
            "ADMIN",
        )
        .await;

        // While a second administrator exists, demoting one is allowed.
        assign_user_role(&pool, &admin_token, peer_id, "CASHIER")
            .await
            .expect("demoting a non-final administrator must succeed");

        // A live session loses its permissions the moment the role changes —
        // there is no cached permission set to refresh.
        let err = list_users(&pool, &peer_token).await.unwrap_err();
        assert!(
            matches!(err, AppError::PermissionDenied { .. }),
            "the demoted peer's existing session must lose MANAGE_USERS immediately"
        );

        // Demoting the last ADMIN itself now succeeds too: SUPER_ADMIN root is
        // still active and still holds MANAGE_USERS, so the generic
        // last-administrator guard does not fire. This is the correct,
        // intended interaction between the two guards, not a regression.
        assign_user_role(&pool, &root_token, admin_id, "CASHIER")
            .await
            .expect("demoting the last ADMIN must succeed while SUPER_ADMIN remains active");

        // The acting root must still hold SUPER_ADMIN throughout.
        let users = list_users(&pool, &root_token)
            .await
            .expect("root must still hold MANAGE_USERS");
        let root_row = users.iter().find(|user| user.user_id == root_id).unwrap();
        assert_eq!(root_row.role_codes, vec!["SUPER_ADMIN".to_string()]);
    }
}
