//! WS-K-3 — `--provision-migrate`: a narrow, installer-only CLI entry point.
//!
//! Runs every pending migration against a freshly created client database,
//! using the exact same embedded `Migrator`
//! (`schema_version::run_all_migrations`) the app's own schema-version check
//! already reads metadata from — replacing a separately bundled `sqlx.exe`,
//! whose provenance `resources/postgres/sqlx-cli/README.md` (now deleted)
//! could never cleanly establish. This is the migrator that provisions a
//! client is therefore byte-identical to the one compiled into the app it
//! provisions for.
//!
//! Does nothing else: no server, no window, no `tauri::Builder`. Connects
//! once, runs migrations, prints a single plain-language pass/fail line an
//! installer log can capture, and exits. Reachable ONLY via the literal
//! `--provision-migrate` argument — checked in `lib.rs`'s
//! `maybe_run_provision_migrate`, called before `run()` (the normal Tauri
//! GUI entry point) ever executes. A normal double-click launch passes no
//! arguments, so this path is never reached and `run()` behaves exactly as
//! it does today.
//!
//! Connection source: the `DATABASE_URL` environment variable — not
//! `database.json`, which does not exist yet at the point this runs (it is
//! written only after migrations succeed, per WS-K-2's own failure-handling
//! design). This is the same environment variable
//! `scripts/run-sqlx-migrations.ps1` already uses for the Owner's own
//! cluster and `Provision-StockihaPostgres.ps1` already sets for the
//! (now-removed) `sqlx.exe` invocation it replaces, so no new convention is
//! introduced. Never a CLI argument: a password passed as `argv` is visible
//! to any other process on the machine that can enumerate command lines
//! (Task Manager, `Get-Process`), which an environment variable set only for
//! this one child process is not.

use std::time::Duration;

use sqlx::postgres::PgConnection;
use sqlx::Connection;

use crate::infrastructure::db;
use crate::infrastructure::schema_version;

/// Bounded so an unreachable target fails loudly within a predictable time
/// rather than hanging the installer indefinitely. Matches the order of
/// magnitude of `db::ACQUIRE_TIMEOUT`; this path has no pool to size a
/// tighter probe timeout against, so it uses one bound for the whole
/// connect attempt.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

/// Exit codes, stable and documented here since the installer script
/// branches on them:
/// 0 = success. 2 = configuration problem (`DATABASE_URL` missing or
/// unparseable). 3 = could not connect (refused, or timed out). 4 = connected
/// but migrations failed partway.
pub fn run() -> i32 {
    let runtime = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(err) => {
            eprintln!("[PROVISION_MIGRATE] FAIL: could not start the async runtime ({err}).");
            return 1;
        }
    };
    runtime.block_on(run_async())
}

async fn run_async() -> i32 {
    let url = match std::env::var("DATABASE_URL") {
        Ok(value) if !value.trim().is_empty() => value,
        _ => {
            eprintln!("[PROVISION_MIGRATE] FAIL: DATABASE_URL is not set.");
            return 2;
        }
    };
    run_migrate_against(&url).await
}

/// The testable core: everything `run_async` does once it has a URL string
/// in hand, split out so tests can drive it directly with a known-bad or
/// known-good URL without mutating the process environment (which `cargo
/// test`'s parallel threads would otherwise race on).
async fn run_migrate_against(url: &str) -> i32 {
    // Reuses the same fixed, input-independent diagnostic `db.rs` already
    // guarantees for a malformed URL — the value and the parser's own
    // message are both discarded, so a secret embedded in a malformed
    // DATABASE_URL cannot leak into this output either.
    let options = match db::parse_connect_options(url) {
        Ok(options) => options,
        Err(_) => {
            eprintln!(
                "[PROVISION_MIGRATE] FAIL: DATABASE_URL could not be parsed as a PostgreSQL connection string."
            );
            return 2;
        }
    };

    let connect_attempt =
        tokio::time::timeout(CONNECT_TIMEOUT, PgConnection::connect_with(&options));
    let mut conn = match connect_attempt.await {
        Ok(Ok(conn)) => conn,
        Ok(Err(err)) => {
            eprintln!("[PROVISION_MIGRATE] FAIL: could not connect ({err}).");
            return 3;
        }
        Err(_elapsed) => {
            eprintln!(
                "[PROVISION_MIGRATE] FAIL: no response within {}s - the target is unreachable.",
                CONNECT_TIMEOUT.as_secs()
            );
            return 3;
        }
    };

    println!("[PROVISION_MIGRATE] Connected. Running migrations...");
    match schema_version::run_all_migrations(&mut conn).await {
        Ok(()) => {
            println!("[PROVISION_MIGRATE] PASS: all migrations applied.");
            0
        }
        Err(err) => {
            eprintln!("[PROVISION_MIGRATE] FAIL: migrations failed partway ({err}).");
            4
        }
    }
}

/// Pure argument check backing [`crate::maybe_run_provision_migrate`] —
/// split out so "a normal launch never reaches this path" is a real,
/// directly asserted unit test rather than something inferred from reading
/// the code, and so the test never has to call the real entry point (which
/// calls `std::process::exit` and would kill the test process).
pub fn provision_migrate_requested<I, S>(args: I) -> bool
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    args.into_iter()
        .any(|arg| arg.as_ref() == "--provision-migrate")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_normal_launch_with_no_arguments_never_requests_provisioning() {
        // What a plain double-click launch's `std::env::args()` looks like:
        // exactly one element, the executable's own path, and nothing else.
        let args = vec!["C:\\Program Files\\Stockiha\\stockiha.exe".to_owned()];
        assert!(!provision_migrate_requested(args));
    }

    #[test]
    fn unrelated_arguments_never_request_provisioning() {
        let args = vec!["stockiha.exe".to_owned(), "--some-other-flag".to_owned()];
        assert!(!provision_migrate_requested(args));
    }

    #[test]
    fn the_exact_flag_requests_provisioning() {
        let args = vec!["stockiha.exe".to_owned(), "--provision-migrate".to_owned()];
        assert!(provision_migrate_requested(args));
    }

    #[test]
    fn a_near_miss_does_not_request_provisioning() {
        // Guards against a substring/prefix match ever being introduced by
        // accident — only an exact argument match may trigger this path.
        let args = vec![
            "stockiha.exe".to_owned(),
            "--provision-migrate-typo".to_owned(),
        ];
        assert!(!provision_migrate_requested(args));
    }

    #[tokio::test]
    async fn empty_or_malformed_url_fails_with_configuration_exit_code() {
        // Covers both `run_async`'s "unset" branch (an empty string behaves
        // identically once it reaches `run_migrate_against`, since neither
        // parses as a URL) and a genuinely malformed one — without mutating
        // the real process environment, which `cargo test`'s parallel
        // threads would otherwise race on.
        assert_eq!(run_migrate_against("").await, 2);
        assert_eq!(run_migrate_against("this is not a url").await, 2);
    }

    /// The regression this task's own required-tests list names explicitly:
    /// an unreachable target must fail loudly, within the bounded timeout,
    /// rather than hang. Port 1 is reserved and never carries PostgreSQL —
    /// no live server needed for this test.
    #[tokio::test]
    async fn unreachable_target_fails_loudly_within_the_timeout() {
        let started = std::time::Instant::now();
        let code = run_migrate_against(
            "postgres://unit_user:unit_placeholder@127.0.0.1:1/stockiha_unreachable_db",
        )
        .await;
        let elapsed = started.elapsed();

        assert_eq!(code, 3);
        assert!(
            elapsed <= CONNECT_TIMEOUT + Duration::from_secs(2),
            "unreachable-target failure took {elapsed:?}, exceeding the connect timeout bound"
        );
    }

    // ——— Opt-in live-database proof ———
    //
    // Exercises the real path this whole module exists for: connecting and
    // calling `schema_version::run_all_migrations` for real, against a
    // disposable database — never the Owner's own dev/acceptance cluster.
    // Matches the existing opt-in pattern in `db.rs`'s own ignored tests.

    /// Read and validate the test database configuration, enforcing the
    /// same `_test`-suffix guard `db.rs`'s `require_test_options` uses, so
    /// this can never accidentally target a development or production
    /// database. Migrations ARE applied for real against whatever this
    /// resolves to, so the guard here matters even more than in `db.rs`'s
    /// read-only check.
    fn require_test_url() -> String {
        let url = std::env::var("STOCKIHA_TEST_DATABASE_URL").unwrap_or_else(|_| {
            panic!("STOCKIHA_TEST_DATABASE_URL must be set to run this ignored test")
        });
        let options = db::parse_connect_options(&url)
            .unwrap_or_else(|_| panic!("STOCKIHA_TEST_DATABASE_URL could not be parsed"));
        let database = options
            .get_database()
            .unwrap_or_else(|| panic!("STOCKIHA_TEST_DATABASE_URL must name an explicit database"));
        assert!(
            database.ends_with("_test"),
            "refusing to run migrations: parsed database name {database:?} does not end in `_test`"
        );
        url
    }

    #[tokio::test]
    #[ignore = "requires a live PostgreSQL server and STOCKIHA_TEST_DATABASE_URL (name must end in _test); applies real migrations to it"]
    async fn runs_pending_migrations_against_a_disposable_test_database() {
        let url = require_test_url();
        let code = run_migrate_against(&url).await;
        assert_eq!(
            code, 0,
            "expected PASS against the dedicated _test database"
        );
    }
}
