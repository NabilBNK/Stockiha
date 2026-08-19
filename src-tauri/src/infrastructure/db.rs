//! S0-003 — Local PostgreSQL / SQLx connectivity proof.
//!
//! This module owns all SQLx access for the connectivity proof. It is
//! deliberately Tauri-free so it can be compiled and tested in isolation.
//!
//! Security posture:
//! - The connection URL is read from the environment
//!   ([`DEV_DATABASE_URL_ENV`]); it is never hardcoded, never logged, and
//!   never stored in managed state ([`DatabaseState`] holds only a pool or a
//!   payload-free marker).
//! - Configuration diagnostics are **fixed constants** that never incorporate
//!   the URL value or the underlying parser message, so no input can be
//!   retained (see [`DIAGNOSTIC_PARSE_FAILURE`]). Connection diagnostics stay
//!   internal and are redacted from `Debug`/`Display` and dropped entirely at
//!   the IPC boundary (see `crate::error`).
//! - The health check executes only `SELECT 1` via the runtime query API —
//!   no schema objects, no writes, no transactions, no SQLx macros.

use crate::error::AppError;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::PgPool;
use std::str::FromStr;
use std::time::Duration;

/// Environment variable holding the local development connection URL.
///
/// Development-only. Production credential storage arrives with S0-005
/// (Windows Credential Manager); nothing in this module presumes the final
/// production mechanism. A local development URL may use `sslmode=disable`;
/// that is a per-URL developer choice, not a policy encoded here.
pub const DEV_DATABASE_URL_ENV: &str = "STOCKIHA_DEV_DATABASE_URL";

/// Environment variable holding the integration-test connection URL.
///
/// The connectivity tests require the parsed database name to end in `_test`.
/// That guard reduces the risk of accidentally targeting a development or
/// production database; it is a safety reduction, not an absolute guarantee.
#[cfg(test)]
const TEST_DATABASE_URL_ENV: &str = "STOCKIHA_TEST_DATABASE_URL";

/// Maximum pool connections for the application pool.
pub const MAX_CONNECTIONS: u32 = 25;

/// How long an acquire (including the lazy initial connect) may take before
/// failing. This bounds the health check without any
/// `tokio::time::timeout` in production code.
pub const ACQUIRE_TIMEOUT: Duration = Duration::from_secs(15);

/// Fixed diagnostic for a configuration value that could not be parsed.
///
/// Deliberately input-independent: it never contains the URL value or the
/// parser's own message, so a secret embedded in the URL cannot leak through
/// the diagnostic — even into internal logs.
const DIAGNOSTIC_PARSE_FAILURE: &str = "database connection configuration could not be parsed";

/// Fixed diagnostic for a missing configuration value.
const DIAGNOSTIC_NOT_CONFIGURED: &str = "database connection configuration is not set";

/// Fixed diagnostic for a configuration value that failed to parse at startup.
const DIAGNOSTIC_INVALID: &str = "database connection configuration is invalid";

/// Database connectivity state managed by Tauri.
///
/// Holds either a ready (lazily connecting) pool or a payload-free marker of
/// why no pool exists. Never stores raw URLs, credentials, or SQLx errors.
/// `PgPool` is internally reference-counted and thread-safe; it is managed
/// directly, without any mutex.
pub enum DatabaseState {
    /// [`DEV_DATABASE_URL_ENV`] is not set.
    Unconfigured,
    /// [`DEV_DATABASE_URL_ENV`] is set but could not be parsed as a
    /// PostgreSQL connection URL. The parse detail is intentionally not
    /// retained here; it surfaces (redacted) through the health check.
    InvalidConfiguration,
    /// A lazily-connecting pool built from valid configuration. No network
    /// activity has necessarily occurred yet.
    Configured(PgPool),
}

/// Parse a connection URL into typed [`PgConnectOptions`].
///
/// On failure the diagnostic is the fixed [`DIAGNOSTIC_PARSE_FAILURE`]
/// constant — the URL value and the parser's message are both discarded, so no
/// input is retained anywhere.
pub fn parse_connect_options(url: &str) -> Result<PgConnectOptions, AppError> {
    PgConnectOptions::from_str(url)
        .map_err(|_parse_error| AppError::database_configuration(DIAGNOSTIC_PARSE_FAILURE))
}

/// Build the connection pool for the connectivity proof.
///
/// Uses `connect_lazy_with`: no connection is attempted until first use, so
/// startup never blocks or fails on database availability. Connection
/// failures surface at the first acquire, bounded by [`ACQUIRE_TIMEOUT`].
///
/// Must be called within a Tokio runtime context: SQLx spawns the pool's
/// background maintenance task at construction and panics without one
/// (verified empirically). The Tauri entry point therefore wraps state
/// construction in `tauri::async_runtime::block_on`, and pool-creating tests
/// run under `#[tokio::test]`.
pub fn build_pool(options: PgConnectOptions) -> PgPool {
    PgPoolOptions::new()
        .max_connections(MAX_CONNECTIONS)
        .acquire_timeout(ACQUIRE_TIMEOUT)
        .connect_lazy_with(options)
}

/// Derive the managed [`DatabaseState`] from an optional URL value.
///
/// Pure with respect to its input — unit-testable without touching the
/// process environment or the network (the pool is lazy).
pub fn database_state_from(url: Option<String>) -> DatabaseState {
    match url {
        None => DatabaseState::Unconfigured,
        Some(value) => match parse_connect_options(&value) {
            Ok(options) => DatabaseState::Configured(build_pool(options)),
            Err(_) => DatabaseState::InvalidConfiguration,
        },
    }
}

/// Read [`DEV_DATABASE_URL_ENV`] and derive the managed [`DatabaseState`].
///
/// Missing configuration is a safe, expected state (the app starts and
/// reports "not configured"); it is never a panic and never logged with any
/// value content.
pub fn database_state_from_env() -> DatabaseState {
    database_state_from(std::env::var(DEV_DATABASE_URL_ENV).ok())
}

/// Execute the connectivity proof against a pool: exactly `SELECT 1`.
///
/// Read-only, no transaction, no cleanup required. Any SQLx failure —
/// connection refused, authentication failure, acquire timeout — is captured
/// as an internal [`AppError::DatabaseUnavailable`] diagnostic that never
/// crosses the IPC boundary.
pub async fn health_check(pool: &PgPool) -> Result<(), AppError> {
    sqlx::query("SELECT 1")
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|sqlx_error| {
            AppError::database_unavailable(format!("SELECT 1 health check failed: {sqlx_error}"))
        })
}

/// Evaluate the full managed state: the single entry point the Tauri command
/// delegates to, keeping the command thin and this logic testable without
/// Tauri. Configuration diagnostics are fixed constants (no input retained).
pub async fn health_check_state(state: &DatabaseState) -> Result<(), AppError> {
    match state {
        DatabaseState::Unconfigured => {
            Err(AppError::database_configuration(DIAGNOSTIC_NOT_CONFIGURED))
        }
        DatabaseState::InvalidConfiguration => {
            Err(AppError::database_configuration(DIAGNOSTIC_INVALID))
        }
        DatabaseState::Configured(pool) => health_check(pool).await,
    }
}

/// Slice 1 MVP batch: extracts the ready pool from managed state, or the
/// same fixed configuration diagnostics [`health_check_state`] would report
/// — the one place every new IPC command needs to turn `DatabaseState` into
/// a `&PgPool` before delegating to `crate::application`.
pub fn pool_or_unavailable(state: &DatabaseState) -> Result<&PgPool, AppError> {
    match state {
        DatabaseState::Unconfigured => {
            Err(AppError::database_configuration(DIAGNOSTIC_NOT_CONFIGURED))
        }
        DatabaseState::InvalidConfiguration => {
            Err(AppError::database_configuration(DIAGNOSTIC_INVALID))
        }
        DatabaseState::Configured(pool) => Ok(pool),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::{ErrorCode, IpcError};

    /// Placeholder values used only inside unit tests to build syntactically
    /// valid URLs. They are never real credentials and no connection is ever
    /// attempted with them (the pool is lazy and unit tests never acquire).
    const UNIT_TEST_URL: &str = "postgres://unit_user:unit_placeholder@127.0.0.1:5432/unit_db";

    #[test]
    fn parse_valid_url_extracts_typed_options() {
        let options = parse_connect_options(UNIT_TEST_URL).expect("valid URL must parse");
        assert_eq!(options.get_database(), Some("unit_db"));
    }

    #[test]
    fn parse_invalid_url_maps_to_configuration_error() {
        let error = parse_connect_options("this is not a url").expect_err("must fail");
        let ipc: IpcError = error.into();
        assert_eq!(ipc.code, ErrorCode::ConfigurationError);
    }

    /// The parse diagnostic is a fixed constant that never incorporates the
    /// input. Proven by construction (equality to the constant) across several
    /// malformed inputs, including ones carrying secret-like content — not by a
    /// single "does not contain this one string" assertion.
    #[test]
    fn parse_failure_diagnostic_is_fixed_and_input_independent() {
        let malformed_inputs = [
            "",
            "not a url",
            "://missing-scheme/db",
            // Carries secret-like content and still fails to parse — the
            // diagnostic must remain the fixed constant regardless.
            "postgres://user:DO_NOT_EXPOSE_DIAGNOSTIC@@@:notaport/db",
            "🔥 not-a-url 🔥",
        ];
        for input in malformed_inputs {
            let error = parse_connect_options(input).expect_err("must fail");
            match error {
                AppError::DatabaseConfiguration { diagnostic } => {
                    // Exact-equality to the fixed constant proves the diagnostic
                    // cannot vary with, or embed any part of, the input.
                    assert_eq!(diagnostic, DIAGNOSTIC_PARSE_FAILURE);
                }
                _ => panic!("expected AppError::DatabaseConfiguration"),
            }
        }
    }

    #[test]
    fn missing_url_yields_unconfigured() {
        assert!(matches!(
            database_state_from(None),
            DatabaseState::Unconfigured
        ));
    }

    #[test]
    fn invalid_url_yields_invalid_configuration() {
        assert!(matches!(
            database_state_from(Some("not a url".to_owned())),
            DatabaseState::InvalidConfiguration
        ));
    }

    #[tokio::test]
    async fn valid_url_yields_configured_pool_without_connecting() {
        // connect_lazy_with performs no network I/O, so this must succeed even
        // though no PostgreSQL server is running at the placeholder address.
        // A Tokio context is required because the pool spawns its background
        // maintenance task at construction.
        assert!(matches!(
            database_state_from(Some(UNIT_TEST_URL.to_owned())),
            DatabaseState::Configured(_)
        ));
    }

    #[tokio::test]
    async fn unconfigured_state_maps_to_configuration_error() {
        let error = health_check_state(&DatabaseState::Unconfigured)
            .await
            .expect_err("must fail");
        let ipc: IpcError = error.into();
        assert_eq!(ipc.code, ErrorCode::ConfigurationError);
    }

    #[tokio::test]
    async fn invalid_configuration_state_maps_to_configuration_error() {
        let error = health_check_state(&DatabaseState::InvalidConfiguration)
            .await
            .expect_err("must fail");
        let ipc: IpcError = error.into();
        assert_eq!(ipc.code, ErrorCode::ConfigurationError);
    }

    // ——— Opt-in PostgreSQL connectivity tests (crate-internal) ———
    //
    // These require a live, dedicated **test** database and are therefore
    // `#[ignore]`d by default. Run them (on Windows, against PostgreSQL 18):
    //
    //   $env:STOCKIHA_TEST_DATABASE_URL =
    //     "postgres://<user>:<password>@localhost:5432/stockiha_test?sslmode=disable"
    //   cargo test -- --ignored
    //
    // Safety: `require_test_options` parses the URL into typed
    // `PgConnectOptions` and refuses to proceed unless the **parsed** database
    // name ends in `_test`. That guard reduces the risk of accidentally
    // targeting a development or production database; it is not an absolute
    // guarantee. Only `SELECT 1` is ever executed — no schema objects, no
    // writes, no cleanup. These are the genuine connectivity proof; the unit
    // tests above prove contracts only, never real connectivity.

    /// Read and validate the test database configuration, enforcing the
    /// `_test` database-name guard on the **parsed** options. Panic messages
    /// are fixed strings plus, at most, the parsed database name — never the
    /// URL, credentials, or host.
    fn require_test_options() -> PgConnectOptions {
        let url = std::env::var(TEST_DATABASE_URL_ENV).unwrap_or_else(|_| {
            panic!(
                "{TEST_DATABASE_URL_ENV} must be set to run the ignored \
                 PostgreSQL connectivity tests"
            )
        });

        let options = parse_connect_options(&url)
            .unwrap_or_else(|_| panic!("{TEST_DATABASE_URL_ENV} could not be parsed"));

        let database = options
            .get_database()
            .unwrap_or_else(|| panic!("{TEST_DATABASE_URL_ENV} must name an explicit database"));

        assert!(
            database.ends_with("_test"),
            "refusing to run connectivity tests: parsed database name {database:?} \
             does not end in `_test`"
        );

        options
    }

    /// Real connectivity proof: `SELECT 1` succeeds against the dedicated test
    /// database through the exact production pool configuration.
    #[tokio::test]
    #[ignore = "requires a live PostgreSQL server and STOCKIHA_TEST_DATABASE_URL"]
    async fn select_one_succeeds_against_dedicated_test_database() {
        let pool = build_pool(require_test_options());
        health_check(&pool)
            .await
            .expect("SELECT 1 must succeed against the dedicated test database");
    }

    /// The full managed-state path reports success for a configured pool.
    #[tokio::test]
    #[ignore = "requires a live PostgreSQL server and STOCKIHA_TEST_DATABASE_URL"]
    async fn health_check_state_reports_connected_for_configured_pool() {
        let state = DatabaseState::Configured(build_pool(require_test_options()));
        health_check_state(&state)
            .await
            .expect("configured state must report healthy against the test database");
    }

    /// An unreachable server maps to `DATABASE_UNAVAILABLE` within the acquire
    /// timeout. Derives everything from the validated test options, then points
    /// them at a port where nothing listens — no separate hardcoded credentials.
    #[tokio::test]
    #[ignore = "requires STOCKIHA_TEST_DATABASE_URL (no live server needed on the derived port)"]
    async fn unreachable_server_maps_to_database_unavailable() {
        // Port 1 is reserved and never carries PostgreSQL.
        let unreachable = require_test_options().port(1);
        let pool = build_pool(unreachable);

        let started = std::time::Instant::now();
        let error = health_check(&pool)
            .await
            .expect_err("connecting to a closed port must fail");
        let elapsed = started.elapsed();

        assert!(
            matches!(error, AppError::DatabaseUnavailable { .. }),
            "expected AppError::DatabaseUnavailable, got a different variant"
        );
        let ipc: IpcError = error.into();
        assert_eq!(ipc.code, ErrorCode::DatabaseUnavailable);

        // The acquire timeout (5s) must bound the failure; allow scheduling slack.
        assert!(
            elapsed <= ACQUIRE_TIMEOUT + Duration::from_secs(2),
            "unavailable-server failure took {elapsed:?}, exceeding the acquire timeout bound"
        );
    }
}
