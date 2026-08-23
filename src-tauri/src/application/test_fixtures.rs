//! Shared fixtures for the opt-in PostgreSQL integration tests.
//!
//! Test-only (`#[cfg(test)]`); nothing here is compiled into the application.
//!
//! Every fixture reaches the database exactly the way the application does:
//! through `core.bootstrap_first_admin` for the very first administrator, and
//! through the `SECURITY DEFINER` functions for everything after that.
//! `stockiha_runtime` holds `SELECT` only on `iam.users`, `iam.roles`,
//! `iam.user_roles`, and `iam.role_permissions`, and has no `INSERT` on any
//! catalog, inventory, sales, or finance table either — so a fixture that
//! inserted rows directly would fail with SQLSTATE 42501 rather than set
//! anything up. Seeding through the sanctioned path is not merely tidier here;
//! it is the only thing that works, and it means the fixtures exercise the same
//! authorization boundary the production code does.

use rust_decimal::Decimal;
use sqlx::PgPool;

/// The bootstrapped administrator these fixtures share.
pub(crate) const ROOT_USERNAME: &str = "wsa_fixture_root";
pub(crate) const FIXTURE_PASSWORD: &str = "wsa-fixture-password";
/// Workstation the fixture session authenticates from. `sales.open_cash_session`
/// requires the requested workstation to equal the authenticated one, so cash
/// session fixtures must pass exactly this value.
pub(crate) const FIXTURE_WORKSTATION: &str = "WSA-FIXTURE";
/// Warehouse and fiscal period created by the bootstrap below.
pub(crate) const FIXTURE_WAREHOUSE_CODE: &str = "WSA-FIX";
pub(crate) const FIXTURE_PERIOD_CODE: &str = "WSA-FIX-2026";

/// Reads `STOCKIHA_TEST_DATABASE_URL` and refuses any database whose name does
/// not end in `_test`.
///
/// This guard is not decoration. Integration tests that wrote fixtures into
/// `stockiha_acceptance` are what left that database with users but
/// `core.system_state.initialized = false`, a state in which
/// `core.bootstrap_first_admin` refuses to run and the application can never be
/// logged into. Provision a disposable database with
/// `scripts/provision-iam-test.ps1`.
pub(crate) fn require_test_pool_url() -> String {
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

/// Establish an authenticated administrator session using only sanctioned paths.
///
/// The first administrator comes from `core.bootstrap_first_admin` — the same
/// unauthenticated first-run path the installer uses — which also creates the
/// fixture warehouse and an OPEN fiscal period covering all of 2026. The
/// bootstrap is idempotent here: on an already-initialized database it raises
/// `55000` and this simply logs the existing root administrator in.
pub(crate) async fn root_admin_session(pool: &PgPool) -> (i64, String) {
    let hash = crate::application::auth::hash_password(FIXTURE_PASSWORD).unwrap();
    let bootstrap = sqlx::query_as::<_, (i64,)>(
        "SELECT core.bootstrap_first_admin($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(ROOT_USERNAME)
    .bind(&hash)
    .bind("WS-A Fixture Root")
    .bind(FIXTURE_WORKSTATION)
    .bind(FIXTURE_WAREHOUSE_CODE)
    .bind("WS-A Fixture Warehouse")
    .bind(FIXTURE_PERIOD_CODE)
    .bind(time::Date::from_calendar_date(2026, time::Month::January, 1).unwrap())
    .bind(time::Date::from_calendar_date(2026, time::Month::December, 31).unwrap())
    .fetch_one(pool)
    .await;

    if let Err(error) = &bootstrap {
        let already_initialized = error
            .as_database_error()
            .and_then(|db| db.code().map(|code| code.into_owned()))
            .as_deref()
            == Some("55000");
        assert!(
            already_initialized,
            "fixture bootstrap failed for an unexpected reason: {error:?}"
        );
    }

    let (user_id,): (i64,) = sqlx::query_as("SELECT id FROM iam.users WHERE username = $1")
        .bind(ROOT_USERNAME)
        .fetch_one(pool)
        .await
        .expect("the bootstrapped root administrator must exist");

    let session =
        crate::application::auth::login(pool, ROOT_USERNAME, FIXTURE_PASSWORD, FIXTURE_WORKSTATION)
            .await
            .expect("the root administrator must be able to log in");

    (user_id, session.session_token)
}

/// Create a user through `iam.create_user` and return its id plus a live
/// session token.
pub(crate) async fn seed_user_via_admin(
    pool: &PgPool,
    admin_token: &str,
    username: &str,
    role_code: &str,
) -> (i64, String) {
    let user_id = crate::application::iam::create_user(
        pool,
        admin_token,
        username,
        FIXTURE_PASSWORD,
        "Fixture User",
        role_code,
    )
    .await
    .unwrap_or_else(|error| panic!("failed to seed {username} as {role_code}: {error:?}"));

    let session =
        crate::application::auth::login(pool, username, FIXTURE_PASSWORD, FIXTURE_WORKSTATION)
            .await
            .unwrap();

    (user_id, session.session_token)
}

/// Id of the warehouse `root_admin_session` bootstrapped.
pub(crate) async fn fixture_warehouse_id(pool: &PgPool) -> i64 {
    sqlx::query_scalar("SELECT id FROM inventory.warehouses WHERE code = $1")
        .bind(FIXTURE_WAREHOUSE_CODE)
        .fetch_one(pool)
        .await
        .expect("the fixture warehouse must exist — call root_admin_session first")
}

/// Id of the OPEN fiscal period `root_admin_session` bootstrapped.
pub(crate) async fn fixture_fiscal_period_id(pool: &PgPool) -> i64 {
    sqlx::query_scalar("SELECT id FROM finance.fiscal_periods WHERE period_code = $1")
        .bind(FIXTURE_PERIOD_CODE)
        .fetch_one(pool)
        .await
        .expect("the fixture fiscal period must exist — call root_admin_session first")
}

/// Return the live cash session for the fixture workstation, opening one if
/// there is none.
///
/// `sales.cash_sessions` allows only one live session per workstation
/// (`open_cash_session` maps the unique violation to
/// `workstation % already has a live cash session`), so a test that
/// unconditionally opened a session would pass once and then fail on every
/// subsequent run against the same database.
pub(crate) async fn fixture_cash_session_id(pool: &PgPool, token: &str, warehouse_id: i64) -> i64 {
    let existing: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM sales.cash_sessions \
         WHERE workstation_id = $1 AND status = 'OPEN' \
         ORDER BY id DESC LIMIT 1",
    )
    .bind(FIXTURE_WORKSTATION)
    .fetch_optional(pool)
    .await
    .expect("querying for a live cash session must succeed");

    if let Some(id) = existing {
        return id;
    }

    crate::application::cash_session::open_cash_session(
        pool,
        token,
        warehouse_id,
        FIXTURE_WORKSTATION,
        Decimal::ZERO,
    )
    .await
    .expect("opening a fixture cash session must succeed")
}

/// A monotonically distinct suffix for fixture identifiers, so repeated runs
/// against the same database do not collide on unique constraints.
pub(crate) fn unique_suffix() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos()
}
