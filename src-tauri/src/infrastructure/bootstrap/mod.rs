//! S0-004 — Database role bootstrap subsystem.
//!
//! Provides safe, atomic, and idempotent database role creation and verification
//! for Stockiha application roles (`stockiha_owner`, `stockiha_migrator`, `stockiha_runtime`, `stockiha_backup`).

pub(crate) mod roles;
pub(crate) mod verification;

use roles::{
    BOOTSTRAP_ADVISORY_LOCK_ID, SQL_CREATE_ROLES_IF_NOT_EXISTS, SQL_ENFORCE_MEMBERSHIPS,
    SQL_ENFORCE_ROLE_ATTRIBUTES,
};
use sqlx::{Connection, PgConnection, Row};
use std::fmt;
use std::str::FromStr;

/// Remove this temporary allowance when a genuine production consumer reads or constructs this item.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) const BOOTSTRAP_ADMIN_URL_ENV: &str = "STOCKIHA_BOOTSTRAP_ADMIN_DATABASE_URL";

/// Remove this temporary allowance when a genuine production consumer reads or constructs this item.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) const BOOTSTRAP_CONFIRMATION_ENV: &str = "STOCKIHA_ALLOW_CLUSTER_ROLE_BOOTSTRAP";

pub(crate) const REQUIRED_CONFIRMATION_VALUE: &str = "YES";
pub(crate) const REQUIRED_TEST_DATABASE_NAME: &str = "stockiha_role_bootstrap_test";

/// Crate-private non-serializable error type for bootstrap failures.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum BootstrapError {
    /// Remove this temporary allowance when a genuine production consumer reads or constructs this item.
    #[cfg_attr(not(test), allow(dead_code))]
    MissingEnvironmentVariable(&'static str),
    /// Remove this temporary allowance when a genuine production consumer reads or constructs this item.
    #[cfg_attr(not(test), allow(dead_code))]
    InvalidConfirmationValue(String),
    /// Remove this temporary allowance when a genuine production consumer reads or constructs this item.
    #[cfg_attr(not(test), allow(dead_code))]
    DatabaseNameMismatch(String),
    /// Remove this temporary allowance when a genuine production consumer reads or constructs this item.
    #[cfg_attr(not(test), allow(dead_code))]
    PostgresVersionMismatch(String),
    /// Remove this temporary allowance when a genuine production consumer reads or constructs this item.
    #[cfg_attr(not(test), allow(dead_code))]
    SuperuserRequired(String),
    /// Remove this temporary allowance when a genuine production consumer reads or constructs this item.
    #[cfg_attr(not(test), allow(dead_code))]
    Database(String),
    /// Remove this temporary allowance when a genuine production consumer reads or constructs this item.
    #[cfg_attr(not(test), allow(dead_code))]
    VerificationFailure(String),
}

impl fmt::Display for BootstrapError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            BootstrapError::MissingEnvironmentVariable(var) => {
                write!(f, "missing required environment variable: {var}")
            }
            BootstrapError::InvalidConfirmationValue(val) => write!(
                f,
                "invalid confirmation value '{val}'; expected '{REQUIRED_CONFIRMATION_VALUE}'"
            ),
            BootstrapError::DatabaseNameMismatch(name) => write!(
                f,
                "database name '{name}' does not match required target '{REQUIRED_TEST_DATABASE_NAME}'"
            ),
            BootstrapError::PostgresVersionMismatch(ver) => {
                write!(f, "PostgreSQL version '{ver}' does not meet requirement (must be major version 18)")
            }
            BootstrapError::SuperuserRequired(msg) => write!(f, "superuser requirement failed: {msg}"),
            BootstrapError::Database(msg) => write!(f, "database error during bootstrap: {msg}"),
            BootstrapError::VerificationFailure(msg) => write!(f, "catalog verification failed: {msg}"),
        }
    }
}

impl std::error::Error for BootstrapError {}

/// Verify that cluster safety environment variables are correctly configured.
///
/// Remove this temporary allowance when a genuine production consumer reads or constructs this item.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn verify_bootstrap_environment_guards() -> Result<(), BootstrapError> {
    let confirmation = std::env::var(BOOTSTRAP_CONFIRMATION_ENV).map_err(|_| {
        BootstrapError::MissingEnvironmentVariable(BOOTSTRAP_CONFIRMATION_ENV)
    })?;

    if confirmation != REQUIRED_CONFIRMATION_VALUE {
        return Err(BootstrapError::InvalidConfirmationValue(confirmation));
    }

    Ok(())
}

/// Verify database name, PostgreSQL major version, and superuser session posture.
///
/// Remove this temporary allowance when a genuine production consumer reads or constructs this item.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) async fn verify_connection_guards(
    conn: &mut PgConnection,
    required_db_name: Option<&str>,
) -> Result<(), BootstrapError> {
    // 1. Database name check
    let current_db_row = sqlx::query("SELECT current_database()")
        .fetch_one(&mut *conn)
        .await
        .map_err(|e| BootstrapError::Database(format!("failed to query current_database(): {e}")))?;
    let db_name: String = current_db_row.get(0);

    let expected_db = required_db_name.unwrap_or(REQUIRED_TEST_DATABASE_NAME);
    if db_name != expected_db {
        return Err(BootstrapError::DatabaseNameMismatch(db_name));
    }

    // 2. Session user = current user check, and superuser check
    let session_row = sqlx::query(
        "SELECT session_user, current_user, current_setting('is_superuser') AS is_superuser",
    )
    .fetch_one(&mut *conn)
    .await
    .map_err(|e| BootstrapError::Database(format!("failed to query session posture: {e}")))?;

    let sess_user: String = session_row.get("session_user");
    let curr_user: String = session_row.get("current_user");
    let is_super: String = session_row.get("is_superuser");

    if sess_user != curr_user {
        return Err(BootstrapError::SuperuserRequired(format!(
            "session_user ({sess_user}) must equal current_user ({curr_user})"
        )));
    }

    if is_super != "on" {
        return Err(BootstrapError::SuperuserRequired(format!(
            "active session role ({curr_user}) is not a superuser"
        )));
    }

    // 3. PostgreSQL version check (must be major version 18)
    let version_row = sqlx::query("SHOW server_version_num")
        .fetch_one(&mut *conn)
        .await
        .map_err(|e| BootstrapError::Database(format!("failed to query server_version_num: {e}")))?;
    let version_num_str: String = version_row.get(0);
    let version_num: u32 = u32::from_str(&version_num_str).map_err(|_| {
        BootstrapError::PostgresVersionMismatch(format!("unparseable version num: {version_num_str}"))
    })?;

    // PostgreSQL 18.x has server_version_num >= 180000 and < 190000
    if !(180000..190000).contains(&version_num) {
        return Err(BootstrapError::PostgresVersionMismatch(format!(
            "server_version_num is {version_num}, expected 180000..189999"
        )));
    }

    Ok(())
}

/// Atomically bootstrap all four Stockiha roles inside a single transaction.
///
/// Remove this temporary allowance when a genuine production consumer reads or constructs this item.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) async fn bootstrap_database_roles(
    conn: &mut PgConnection,
    required_db_name: Option<&str>,
) -> Result<(), BootstrapError> {
    verify_bootstrap_environment_guards()?;
    verify_connection_guards(conn, required_db_name).await?;

    let mut tx = conn
        .begin()
        .await
        .map_err(|e| BootstrapError::Database(format!("failed to begin transaction: {e}")))?;

    // Acquire advisory lock to prevent concurrent bootstrap executions
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(BOOTSTRAP_ADVISORY_LOCK_ID)
        .execute(tx.as_mut())
        .await
        .map_err(|e| BootstrapError::Database(format!("failed to acquire advisory lock: {e}")))?;

    // Execute idempotent DDL statements
    sqlx::raw_sql(SQL_CREATE_ROLES_IF_NOT_EXISTS)
        .execute(tx.as_mut())
        .await
        .map_err(|e| BootstrapError::Database(format!("failed role creation DDL: {e}")))?;

    sqlx::raw_sql(SQL_ENFORCE_ROLE_ATTRIBUTES)
        .execute(tx.as_mut())
        .await
        .map_err(|e| BootstrapError::Database(format!("failed role attributes DDL: {e}")))?;

    sqlx::raw_sql(SQL_ENFORCE_MEMBERSHIPS)
        .execute(tx.as_mut())
        .await
        .map_err(|e| BootstrapError::Database(format!("failed membership DDL: {e}")))?;

    // Perform final catalog assertions prior to commit
    verification::verify_role_attributes(tx.as_mut()).await?;
    verification::verify_role_memberships(tx.as_mut()).await?;

    tx.commit()
        .await
        .map_err(|e| BootstrapError::Database(format!("failed to commit bootstrap transaction: {e}")))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bootstrap_environment_guards_fails_when_unconfigured() {
        std::env::remove_var(BOOTSTRAP_CONFIRMATION_ENV);
        let err = verify_bootstrap_environment_guards().expect_err("must fail");
        assert_eq!(
            err,
            BootstrapError::MissingEnvironmentVariable(BOOTSTRAP_CONFIRMATION_ENV)
        );
    }

    #[test]
    fn bootstrap_environment_guards_fails_when_confirmation_is_not_yes() {
        std::env::set_var(BOOTSTRAP_CONFIRMATION_ENV, "NO");
        let err = verify_bootstrap_environment_guards().expect_err("must fail");
        assert_eq!(
            err,
            BootstrapError::InvalidConfirmationValue("NO".to_string())
        );
        std::env::remove_var(BOOTSTRAP_CONFIRMATION_ENV);
    }

    #[test]
    fn bootstrap_environment_guards_succeeds_when_confirmation_is_yes() {
        std::env::set_var(BOOTSTRAP_CONFIRMATION_ENV, "YES");
        assert!(verify_bootstrap_environment_guards().is_ok());
        std::env::remove_var(BOOTSTRAP_CONFIRMATION_ENV);
    }

    /// Helper to get test admin connection option.
    fn get_test_admin_url() -> Option<String> {
        std::env::var(BOOTSTRAP_ADMIN_URL_ENV).ok()
    }

    #[tokio::test]
    #[ignore = "requires live PostgreSQL 18 server and STOCKIHA_BOOTSTRAP_ADMIN_DATABASE_URL"]
    async fn bootstrap_executes_idempotently_against_role_bootstrap_test_database() {
        std::env::set_var(BOOTSTRAP_CONFIRMATION_ENV, "YES");
        let admin_url = get_test_admin_url().expect("STOCKIHA_BOOTSTRAP_ADMIN_DATABASE_URL required");
        let mut conn = PgConnection::connect(&admin_url).await.expect("must connect to admin db");

        // Run 1
        bootstrap_database_roles(&mut conn, Some(REQUIRED_TEST_DATABASE_NAME))
            .await
            .expect("first bootstrap must succeed");

        // Run 2 (Idempotency)
        bootstrap_database_roles(&mut conn, Some(REQUIRED_TEST_DATABASE_NAME))
            .await
            .expect("second bootstrap must succeed idempotently");

        // Catalog verification
        let attrs = verification::verify_role_attributes(&mut conn)
            .await
            .expect("attribute verification must pass");
        assert_eq!(attrs.len(), 4);

        let memberships = verification::verify_role_memberships(&mut conn)
            .await
            .expect("membership verification must pass");
        assert_eq!(memberships.len(), 1);

        std::env::remove_var(BOOTSTRAP_CONFIRMATION_ENV);
    }

    #[tokio::test]
    #[ignore = "requires live PostgreSQL 18 server and STOCKIHA_BOOTSTRAP_ADMIN_DATABASE_URL"]
    async fn concurrent_bootstrap_runs_safely_under_advisory_lock() {
        std::env::set_var(BOOTSTRAP_CONFIRMATION_ENV, "YES");
        let admin_url = get_test_admin_url().expect("STOCKIHA_BOOTSTRAP_ADMIN_DATABASE_URL required");

        let url1 = admin_url.clone();
        let url2 = admin_url.clone();

        let (res1, res2) = tokio::join!(
            async move {
                let mut conn = PgConnection::connect(&url1).await.unwrap();
                bootstrap_database_roles(&mut conn, Some(REQUIRED_TEST_DATABASE_NAME)).await
            },
            async move {
                let mut conn = PgConnection::connect(&url2).await.unwrap();
                bootstrap_database_roles(&mut conn, Some(REQUIRED_TEST_DATABASE_NAME)).await
            }
        );

        assert!(res1.is_ok(), "task1 failed: {res1:?}");
        assert!(res2.is_ok(), "task2 failed: {res2:?}");

        std::env::remove_var(BOOTSTRAP_CONFIRMATION_ENV);
    }

    #[tokio::test]
    #[ignore = "requires live PostgreSQL 18 server and STOCKIHA_BOOTSTRAP_ADMIN_DATABASE_URL"]
    async fn permission_probe_tests_verify_exact_role_restrictions() {
        std::env::set_var(BOOTSTRAP_CONFIRMATION_ENV, "YES");
        let admin_url = get_test_admin_url().expect("STOCKIHA_BOOTSTRAP_ADMIN_DATABASE_URL required");
        let mut admin_conn = PgConnection::connect(&admin_url).await.expect("admin connect");

        // 1. Run bootstrap first to ensure roles exist
        bootstrap_database_roles(&mut admin_conn, Some(REQUIRED_TEST_DATABASE_NAME))
            .await
            .expect("bootstrap must succeed");

        // 2. Setup controlled test ACLs
        sqlx::query("REVOKE CREATE ON DATABASE stockiha_role_bootstrap_test FROM PUBLIC;")
            .execute(&mut admin_conn)
            .await
            .unwrap();

        sqlx::query("DROP SCHEMA IF EXISTS s0_004_probe CASCADE;")
            .execute(&mut admin_conn)
            .await
            .unwrap();

        sqlx::query("CREATE SCHEMA s0_004_probe AUTHORIZATION stockiha_owner;")
            .execute(&mut admin_conn)
            .await
            .unwrap();

        sqlx::query("REVOKE ALL ON SCHEMA s0_004_probe FROM PUBLIC;")
            .execute(&mut admin_conn)
            .await
            .unwrap();

        // Create table as owner (using SET SESSION AUTHORIZATION)
        let mut owner_conn = PgConnection::connect(&admin_url).await.expect("owner session connect");
        sqlx::query("SET SESSION AUTHORIZATION 'stockiha_owner';")
            .execute(&mut owner_conn)
            .await
            .unwrap();

        let session_user: String = sqlx::query_scalar("SELECT session_user;").fetch_one(&mut owner_conn).await.unwrap();
        assert_eq!(session_user, "stockiha_owner");

        sqlx::query("CREATE TABLE s0_004_probe.test_table (id INT);")
            .execute(&mut owner_conn)
            .await
            .unwrap();

        sqlx::query("GRANT SELECT ON s0_004_probe.test_table TO stockiha_backup;")
            .execute(&mut owner_conn)
            .await
            .unwrap();

        sqlx::query("GRANT USAGE ON SCHEMA s0_004_probe TO stockiha_backup;")
            .execute(&mut owner_conn)
            .await
            .unwrap();

        owner_conn.close().await.unwrap();

        // 3. Probe: stockiha_runtime cannot CREATE SCHEMA
        {
            let mut runtime_conn = PgConnection::connect(&admin_url).await.unwrap();
            sqlx::query("SET SESSION AUTHORIZATION 'stockiha_runtime';")
                .execute(&mut runtime_conn)
                .await
                .unwrap();
            let session_user: String = sqlx::query_scalar("SELECT session_user;").fetch_one(&mut runtime_conn).await.unwrap();
            assert_eq!(session_user, "stockiha_runtime");

            let res = sqlx::query("CREATE SCHEMA s0_004_runtime_forbidden_schema;")
                .execute(&mut runtime_conn)
                .await;
            assert!(
                res.is_err(),
                "stockiha_runtime must not be able to CREATE SCHEMA"
            );

            let res_table = sqlx::query("CREATE TABLE s0_004_probe.runtime_table (id INT);")
                .execute(&mut runtime_conn)
                .await;
            assert!(
                res_table.is_err(),
                "stockiha_runtime must not be able to CREATE TABLE in probe schema"
            );

            let res_set_role = sqlx::query("SET ROLE stockiha_owner;")
                .execute(&mut runtime_conn)
                .await;
            assert!(
                res_set_role.is_err(),
                "stockiha_runtime must not be able to SET ROLE stockiha_owner"
            );

            runtime_conn.close().await.unwrap();
        }

        // 4. Probe: stockiha_migrator can SET ROLE stockiha_owner
        {
            let mut migrator_conn = PgConnection::connect(&admin_url).await.unwrap();
            sqlx::query("SET SESSION AUTHORIZATION 'stockiha_migrator';")
                .execute(&mut migrator_conn)
                .await
                .unwrap();
            let session_user: String = sqlx::query_scalar("SELECT session_user;")
                .fetch_one(&mut migrator_conn)
                .await
                .unwrap();
            assert_eq!(session_user, "stockiha_migrator");

            let res_set_role = sqlx::query("SET ROLE stockiha_owner;")
                .execute(&mut migrator_conn)
                .await;
            assert!(
                res_set_role.is_ok(),
                "stockiha_migrator must be able to SET ROLE stockiha_owner"
            );

            let curr_role: String = sqlx::query_scalar("SELECT current_user;")
                .fetch_one(&mut migrator_conn)
                .await
                .unwrap();
            assert_eq!(curr_role, "stockiha_owner");

            migrator_conn.close().await.unwrap();
        }

        // 5. Probe: stockiha_backup
        {
            let mut backup_conn = PgConnection::connect(&admin_url).await.unwrap();
            sqlx::query("SET SESSION AUTHORIZATION 'stockiha_backup';")
                .execute(&mut backup_conn)
                .await
                .unwrap();

            let session_user: String = sqlx::query_scalar("SELECT session_user;")
                .fetch_one(&mut backup_conn)
                .await
                .unwrap();
            assert_eq!(session_user, "stockiha_backup");

            let res_set_role = sqlx::query("SET ROLE stockiha_owner;")
                .execute(&mut backup_conn)
                .await;
            assert!(
                res_set_role.is_err(),
                "stockiha_backup must not be able to SET ROLE stockiha_owner"
            );

            let res_select = sqlx::query("SELECT * FROM s0_004_probe.test_table;")
                .execute(&mut backup_conn)
                .await;
            assert!(
                res_select.is_ok(),
                "stockiha_backup must be able to SELECT when granted"
            );

            let res_insert = sqlx::query("INSERT INTO s0_004_probe.test_table VALUES (1);")
                .execute(&mut backup_conn)
                .await;
            assert!(
                res_insert.is_err(),
                "stockiha_backup must not be able to INSERT"
            );

            let res_update = sqlx::query("UPDATE s0_004_probe.test_table SET id = 2;")
                .execute(&mut backup_conn)
                .await;
            assert!(
                res_update.is_err(),
                "stockiha_backup must not be able to UPDATE"
            );

            let res_delete = sqlx::query("DELETE FROM s0_004_probe.test_table;")
                .execute(&mut backup_conn)
                .await;
            assert!(
                res_delete.is_err(),
                "stockiha_backup must not be able to DELETE"
            );

            let res_truncate = sqlx::query("TRUNCATE s0_004_probe.test_table;")
                .execute(&mut backup_conn)
                .await;
            assert!(
                res_truncate.is_err(),
                "stockiha_backup must not be able to TRUNCATE"
            );

            backup_conn.close().await.unwrap();
        }

        // Cleanup probe schema
        sqlx::query("DROP SCHEMA IF EXISTS s0_004_probe CASCADE;")
            .execute(&mut admin_conn)
            .await
            .unwrap();

        std::env::remove_var(BOOTSTRAP_CONFIRMATION_ENV);
    }
}
