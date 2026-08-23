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
use serde::Serialize;
use sqlx::postgres::{PgConnectOptions, PgConnection, PgPoolOptions};
use sqlx::{Connection, PgPool};
use std::fmt;
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
///
/// Justification: a single-workstation desktop client. 25 is comfortably above
/// the peak concurrent IPC command count (a POS screen issues single-digit
/// concurrent queries) and comfortably below the cluster's `max_connections`,
/// so the pool is never the scarce resource and saturation here always means a
/// leaked connection rather than genuine load.
pub const MAX_CONNECTIONS: u32 = 25;

/// Minimum idle connections held open by the pool.
///
/// Justification: deliberately `0`. A non-zero floor would make SQLx spawn an
/// eager maintenance task that dials PostgreSQL at construction time, which
/// would make `run()` fail or block when the cluster is briefly unavailable.
/// Startup readiness is instead proven explicitly and once by
/// [`startup_diagnostic`], which reports the *underlying* error rather than a
/// generic timeout.
pub const MIN_CONNECTIONS: u32 = 0;

/// How long an acquire (including the lazy initial connect) may take before
/// failing.
///
/// Justification: 15s is long enough to absorb a cold cluster accepting its
/// first connection and short enough that a genuinely unreachable server is
/// reported well inside a user's patience. It is a bound, not a retry budget —
/// raising it would only delay the same failure, so it must never be used to
/// "fix" a connectivity problem.
pub const ACQUIRE_TIMEOUT: Duration = Duration::from_secs(15);

/// Bound for the one-shot diagnostic probe in [`diagnose`].
///
/// This is *not* a retry and *not* part of any production query path: it runs
/// only when connectivity is already being reported, to recover the per-attempt
/// error that SQLx discards behind `PoolTimedOut`. Kept short so an error
/// report is never slower than the failure it explains.
const PROBE_TIMEOUT: Duration = Duration::from_secs(5);

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

/// The non-secret coordinates the pool dials: host, port, database.
///
/// Deliberately excludes the username and password. This exists so a
/// connectivity failure can say *where* the application actually tried to
/// connect — the single fact whose absence has caused this failure class to be
/// misdiagnosed as a server, migration, or IAM problem more than once.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConnectionTarget {
    host: String,
    port: u16,
    database: String,
}

impl ConnectionTarget {
    /// Extract the target from parsed options. No credential field is read.
    fn from_options(options: &PgConnectOptions) -> Self {
        Self {
            host: options.get_host().to_owned(),
            port: options.get_port(),
            database: options.get_database().unwrap_or("<default>").to_owned(),
        }
    }
}

impl fmt::Display for ConnectionTarget {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}:{}/{}", self.host, self.port, self.database)
    }
}

/// Database connectivity state managed by Tauri.
///
/// Holds either a ready (lazily connecting) pool or a payload-free marker of
/// why no pool exists. Never stores raw URLs, credentials, or SQLx errors —
/// [`ConnectionTarget`] carries only host/port/database.
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
    Configured {
        pool: PgPool,
        target: ConnectionTarget,
    },
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
        .min_connections(MIN_CONNECTIONS)
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
            Ok(options) => {
                let target = ConnectionTarget::from_options(&options);
                DatabaseState::Configured {
                    pool: build_pool(options),
                    target,
                }
            }
            Err(_) => DatabaseState::InvalidConfiguration,
        },
    }
}

#[cfg(target_os = "windows")]
fn ensure_local_postgres_active() {
    use std::process::Command;

    let is_ready = Command::new("C:\\Program Files\\PostgreSQL\\18\\bin\\pg_isready.exe")
        .args(["-h", "127.0.0.1", "-p", "5433"])
        .output()
        .map(|out| String::from_utf8_lossy(&out.stdout).contains("accepting connections"))
        .unwrap_or(false);

    if !is_ready {
        if let Some(local_appdata) = std::env::var_os("LOCALAPPDATA") {
            let data_dir = std::path::Path::new(&local_appdata)
                .join("Stockiha")
                .join("r8-acceptance")
                .join("data-55433");
            if data_dir.exists() {
                let _ = Command::new("C:\\Program Files\\PostgreSQL\\18\\bin\\postgres.exe")
                    .args(["-D", data_dir.to_str().unwrap_or_default(), "-p", "5433"])
                    .spawn();
                std::thread::sleep(std::time::Duration::from_millis(500));
            }
        }
    }
}

/// Read [`DEV_DATABASE_URL_ENV`] and derive the managed [`DatabaseState`].
///
/// Missing configuration is a safe, expected state (the app starts and
/// reports "not configured"); it is never a panic and never logged with any
/// value content.
pub fn database_state_from_env() -> DatabaseState {
    let mut source = "none";
    let mut url = std::env::var(DEV_DATABASE_URL_ENV).ok();
    if url.is_some() {
        source = DEV_DATABASE_URL_ENV;
    }

    if url.is_none() {
        #[cfg(target_os = "windows")]
        if let Some(local_appdata) = std::env::var_os("LOCALAPPDATA") {
            let key_path = std::path::Path::new(&local_appdata)
                .join("Stockiha")
                .join("r8-acceptance")
                .join("runtime.key");
            if let Ok(password) = std::fs::read_to_string(&key_path) {
                let password = password.trim();
                if !password.is_empty() {
                    url = Some(format!(
                        "postgres://stockiha_runtime:{password}\
                         @127.0.0.1:5433/stockiha_acceptance?sslmode=disable"
                    ));
                    source = "LOCALAPPDATA runtime.key";
                }
            }
        }
    }

    let state = database_state_from(url);

    // Did the environment variable win over the local `runtime.key` fallback?
    // The precedence itself is the documented contract and is deliberately
    // unchanged; only its visibility changes below.
    let env_override = source == DEV_DATABASE_URL_ENV;

    // The one line whose absence let a stale `STOCKIHA_DEV_DATABASE_URL`
    // masquerade as a server, migration, and IAM fault across several
    // investigations: say out loud, at every startup, which configuration
    // source won and which host/port/database it resolved to. Credential-free
    // by construction — `ConnectionTarget` cannot hold a password.
    match &state {
        DatabaseState::Configured { target, .. } => {
            tracing::info!(source, target = %target, "database configuration resolved");

            if env_override {
                // WARN rather than INFO on purpose. `init_dev_tracing` installs
                // an `EnvFilter` whose floor is `warn` when `RUST_LOG` is unset,
                // so this is the one configuration line that appears in a plain
                // `npm run tauri dev` console with no environment tuning at all.
                //
                // An environment variable silently outranking the local
                // `runtime.key` is precisely how a stale target left over from a
                // retired acceptance environment survived clean rebuilds and was
                // misdiagnosed as a PostgreSQL, migration, and IAM fault — twice.
                // See docs/incident-2026-08-16-local-development-launch.md.
                //
                // Pure ASCII: this reaches a Windows console, where a UTF-8
                // em dash renders as mojibake.
                tracing::warn!(
                    target = %target,
                    "{DEV_DATABASE_URL_ENV} is set and overrides the local runtime.key - \
                     the application will use this target. If it is not the one you expect, \
                     that environment variable is stale; remove it and restart from a fresh shell"
                );

                // A `WARN` alone is not actually a visibility guarantee, which
                // is the whole point of this line. Measured on Windows: with
                // `RUST_LOG=sqlx=debug` — the exact command the previous
                // investigation was told to run — the `EnvFilter` has no global
                // directive, so every `stockiha_lib` event is filtered out and
                // this warning disappears. It is also absent from release
                // builds, where `init_dev_tracing` is compiled out entirely.
                //
                // So mirror it to stderr, but only when the tracing path would
                // genuinely swallow it: `enabled!` answers for this callsite's
                // target and level against whatever subscriber is actually
                // installed, so the common case prints exactly once.
                if !tracing::enabled!(tracing::Level::WARN) {
                    eprintln!(
                        "[DB_CONFIG_OVERRIDE] {DEV_DATABASE_URL_ENV} is set and overrides \
                         the local runtime.key - using target {target}. If that is not the \
                         target you expect, the variable is stale; remove it and restart \
                         from a fresh shell."
                    );
                }
            }
        }
        DatabaseState::InvalidConfiguration => {
            tracing::error!(source, "{DIAGNOSTIC_INVALID}");
        }
        DatabaseState::Unconfigured => {
            tracing::error!("{DIAGNOSTIC_NOT_CONFIGURED}");
        }
    }

    state
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
        DatabaseState::Configured { pool, target } => match health_check(pool).await {
            Ok(()) => Ok(()),
            // Replace SQLx's evidence-free `PoolTimedOut` text with the real
            // reason and the real target before it reaches any log or the UI.
            Err(_) => Err(AppError::database_unavailable(
                diagnose_configured(pool, target).await.to_string(),
            )),
        },
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
        DatabaseState::Configured { pool, .. } => Ok(pool),
    }
}

// ——— Self-diagnosing connectivity reporting ———
//
// SQLx reports `PoolTimedOut` ("pool timed out while waiting for an open
// connection") when `acquire()` exhausts `ACQUIRE_TIMEOUT`, and discards every
// per-attempt connect error it made in the meantime. That single lossy
// conversion is why this failure class has repeatedly been misread as a
// PostgreSQL, migration, or IAM fault: the message names neither the cause nor
// the target. Everything below exists to put both back.

/// Stable, non-sensitive reason code shown in logs and in the UI.
///
/// Codes are a closed set of fixed strings — never derived from configuration
/// — so they are safe to display verbatim and stable enough to quote in a bug
/// report.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DbReasonCode {
    /// Connectivity proven: a real connection completed `SELECT 1`.
    Ok,
    /// No connection URL is configured.
    NotConfigured,
    /// A URL is configured but is not a parseable PostgreSQL URL.
    InvalidConfiguration,
    /// Nothing is listening at the configured host and port.
    ConnectRefused,
    /// The connection attempt failed for some other transport reason.
    ConnectFailed,
    /// The server answered and rejected the credentials.
    AuthFailed,
    /// The server answered; the configured database does not exist.
    DatabaseMissing,
    /// A connection *can* be established — the pool itself is exhausted.
    PoolSaturated,
}

/// A connectivity verdict: a stable code plus a credential-free explanation.
///
/// `detail` is assembled only from a fixed sentence, the [`ConnectionTarget`]
/// (host/port/database), pool counters, and the operating-system or PostgreSQL
/// error text. It never contains the password, the username, the connection
/// string, a token, or a hash.
#[derive(Clone, Debug, Serialize)]
pub struct DbDiagnostic {
    pub code: DbReasonCode,
    pub detail: String,
}

impl fmt::Display for DbDiagnostic {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.code, self.detail)
    }
}

impl DbDiagnostic {
    fn new(code: DbReasonCode, detail: impl Into<String>) -> Self {
        Self {
            code,
            detail: detail.into(),
        }
    }

    /// True when connectivity is proven, i.e. nothing needs reporting.
    pub fn is_ok(&self) -> bool {
        self.code == DbReasonCode::Ok
    }
}

/// Classify a raw SQLx connect failure against a known target.
///
/// Only the OS/PostgreSQL message is carried through; the URL never is.
fn classify_connect_error(error: &sqlx::Error, target: &ConnectionTarget) -> DbDiagnostic {
    match error {
        sqlx::Error::Io(io) if io.kind() == std::io::ErrorKind::ConnectionRefused => {
            DbDiagnostic::new(
                DbReasonCode::ConnectRefused,
                format!(
                    "nothing is listening at {target} - the configured host, \
                     port or database is wrong, or PostgreSQL is not running \
                     ({io})"
                ),
            )
        }
        sqlx::Error::Io(io) => DbDiagnostic::new(
            DbReasonCode::ConnectFailed,
            format!("could not reach {target} ({io})"),
        ),
        other => match other.as_database_error().and_then(|e| e.code()).as_deref() {
            Some("28P01" | "28000") => DbDiagnostic::new(
                DbReasonCode::AuthFailed,
                format!("{target} rejected the configured credentials"),
            ),
            Some("3D000") => DbDiagnostic::new(
                DbReasonCode::DatabaseMissing,
                format!("{target} does not exist on that server"),
            ),
            _ => DbDiagnostic::new(
                DbReasonCode::ConnectFailed,
                format!("could not establish a connection to {target} ({other})"),
            ),
        },
    }
}

/// Probe a configured pool and return the true reason it is or is not usable.
///
/// Deliberately bypasses the pool for the probe: a pooled `acquire()` is
/// exactly what erases the underlying error. One direct connection, bounded by
/// [`PROBE_TIMEOUT`], recovers it. This runs only on an already-failing path
/// and at startup — never inside a query path, and never as a retry.
async fn diagnose_configured(pool: &PgPool, target: &ConnectionTarget) -> DbDiagnostic {
    let options = pool.connect_options();
    let probe = tokio::time::timeout(PROBE_TIMEOUT, PgConnection::connect_with(&options)).await;

    match probe {
        Err(_elapsed) => DbDiagnostic::new(
            DbReasonCode::ConnectFailed,
            format!(
                "no response from {target} within {}s - the address is \
                 reachable but nothing completed a PostgreSQL handshake",
                PROBE_TIMEOUT.as_secs()
            ),
        ),
        Ok(Err(error)) => classify_connect_error(&error, target),
        Ok(Ok(connection)) => {
            // A direct connection succeeds, so the transport and credentials
            // are fine. If acquiring from the pool still failed, the pool
            // itself is the constraint — report its counters, which is the
            // only case where "pool timed out" was ever the honest message.
            let _ = connection.close().await;
            if pool.size() >= MAX_CONNECTIONS && pool.num_idle() == 0 {
                DbDiagnostic::new(
                    DbReasonCode::PoolSaturated,
                    format!(
                        "all {} pooled connections to {target} are in use and \
                         none became free within {}s - a connection is being \
                         leaked or held too long (size={}, idle={})",
                        MAX_CONNECTIONS,
                        ACQUIRE_TIMEOUT.as_secs(),
                        pool.size(),
                        pool.num_idle()
                    ),
                )
            } else {
                DbDiagnostic::new(
                    DbReasonCode::Ok,
                    format!(
                        "connected to {target} (pool size={}, idle={})",
                        pool.size(),
                        pool.num_idle()
                    ),
                )
            }
        }
    }
}

/// Full connectivity verdict for the managed state.
///
/// The single source of truth behind both the startup check and the IPC
/// diagnostic command, so logs and the UI can never disagree.
pub async fn diagnose(state: &DatabaseState) -> DbDiagnostic {
    match state {
        DatabaseState::Unconfigured => {
            DbDiagnostic::new(DbReasonCode::NotConfigured, DIAGNOSTIC_NOT_CONFIGURED)
        }
        DatabaseState::InvalidConfiguration => {
            DbDiagnostic::new(DbReasonCode::InvalidConfiguration, DIAGNOSTIC_INVALID)
        }
        DatabaseState::Configured { pool, target } => diagnose_configured(pool, target).await,
    }
}

/// Eager startup readiness check: prove connectivity once, loudly.
///
/// Returns the verdict so the caller can decide what to do with it; startup
/// itself is not aborted, because the "Service unavailable" screen with its
/// Retry button is a more useful outcome for an operator than a process that
/// refuses to launch. The point is that the *reason* is now stated at startup
/// instead of degrading silently.
pub async fn startup_diagnostic(state: &DatabaseState) -> DbDiagnostic {
    let diagnostic = diagnose(state).await;
    if diagnostic.is_ok() {
        tracing::info!(code = ?diagnostic.code, "{}", diagnostic.detail);
    } else {
        tracing::error!(code = ?diagnostic.code, "{}", diagnostic.detail);
        // Mirrored to stderr: `tracing` is debug-build only, and this is the
        // one message an operator must never miss.
        eprintln!("[DB_STARTUP] {diagnostic}");
    }
    diagnostic
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
    fn acceptance_fallback_points_to_canonical_database() {
        // Prove the hardcoded fallback URL targets the canonical database
        let fallback_url =
            "postgres://stockiha_runtime:dummy@127.0.0.1:5433/stockiha_acceptance?sslmode=disable";
        let options = parse_connect_options(fallback_url).expect("fallback URL must parse");
        assert_eq!(options.get_database(), Some("stockiha_acceptance"));
    }

    #[test]
    fn database_naming_guard() {
        // Prevent accidental reintroduction of obsolete database names
        let fallback_url =
            "postgres://stockiha_runtime:dummy@127.0.0.1:5433/stockiha_acceptance?sslmode=disable";
        let obsolete_names = [
            "stockiha_r8e_verification_test",
            "stockiha_r8_acceptance_inventory_test",
            "stockiha_r8-acceptance_inventory_test",
        ];

        for name in obsolete_names {
            assert!(
                !fallback_url.contains(name),
                "Fallback URL must not contain obsolete database identifier: {}",
                name
            );
        }
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
            DatabaseState::Configured { .. }
        ));
    }

    /// The regression this whole change exists to prevent.
    ///
    /// A pool pointed at a port where nothing listens must report *why* and
    /// *where* — never SQLx's evidence-free "pool timed out while waiting for
    /// an open connection". Needs no server: the proof is that nothing is
    /// listening. Port 1 is reserved and never carries PostgreSQL.
    #[tokio::test]
    async fn unreachable_target_reports_the_real_cause_and_the_target() {
        let options = parse_connect_options(
            "postgres://unit_user:unit_placeholder@127.0.0.1:1/stockiha_unreachable_db",
        )
        .expect("valid URL must parse");
        let target = ConnectionTarget::from_options(&options);
        let state = DatabaseState::Configured {
            pool: build_pool(options),
            target,
        };

        let diagnostic = diagnose(&state).await;

        assert_eq!(diagnostic.code, DbReasonCode::ConnectRefused);
        // Names the exact host, port and database actually dialled — the fact
        // whose absence caused this failure to be misread as a server,
        // migration, and IAM fault across separate investigations.
        assert!(
            diagnostic
                .detail
                .contains("127.0.0.1:1/stockiha_unreachable_db"),
            "diagnostic must name the target it dialled, got: {}",
            diagnostic.detail
        );
        // And never regress to the message that started all of this.
        assert!(
            !diagnostic.detail.contains("pool timed out"),
            "diagnostic must not surface a bare pool timeout, got: {}",
            diagnostic.detail
        );
        // Credential-free: the placeholder password must never appear.
        assert!(
            !diagnostic.detail.contains("unit_placeholder"),
            "diagnostic leaked a credential: {}",
            diagnostic.detail
        );
    }

    /// `DatabaseState` and its diagnostics can never carry the password: the
    /// only configuration-derived value they retain is [`ConnectionTarget`],
    /// which has no credential field.
    #[test]
    fn connection_target_display_is_credential_free() {
        let options = parse_connect_options(UNIT_TEST_URL).expect("valid URL must parse");
        let rendered = ConnectionTarget::from_options(&options).to_string();
        assert_eq!(rendered, "127.0.0.1:5432/unit_db");
        assert!(!rendered.contains("unit_placeholder"));
        assert!(!rendered.contains("unit_user"));
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
        let options = require_test_options();
        let target = ConnectionTarget::from_options(&options);
        let state = DatabaseState::Configured {
            pool: build_pool(options),
            target,
        };
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
