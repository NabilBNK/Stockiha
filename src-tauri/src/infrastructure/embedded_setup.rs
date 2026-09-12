//! WS-K-4 — first-run embedded PostgreSQL setup.
//!
//! Ported from `scripts/provisioning/Provision-StockihaPostgres.ps1` (WS-K-2/
//! WS-K-3, now deleted). Same decisions, same SQL, same generated-credential
//! discipline — only the language changed, and the steps that depended on a
//! Windows service (dedicated service account, `pg_ctl register`, elevation)
//! are gone, because PostgreSQL is now a plain child process of this app.
//!
//! Deliberately Tauri-free (matches `db.rs`'s own stated design): callers
//! pass plain paths and a progress callback, so this module compiles and is
//! tested in isolation, including the full end-to-end flow against a
//! disposable temp directory.
//!
//! # The absolute rule
//!
//! `database.json` is written **last**, and only after a real connection
//! using exactly what was written succeeds. If that final check fails, the
//! file is deleted again. An app that reports success while holding
//! credentials that do not work defeats every diagnostic WS-K-1 built.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;
use sqlx::postgres::{PgConnectOptions, PgConnection};
use sqlx::Connection;

use crate::infrastructure::{local_config, pg_process, schema_version};

/// Fixed database name for the embedded, single-shop deployment. Matches
/// `Provision-StockihaPostgres.ps1`'s own default.
const DATABASE_NAME: &str = "stockiha_shop";

/// How long to wait for a graceful `pg_ctl stop -m fast` before escalating.
pub const STOP_GRACEFUL_TIMEOUT: Duration = Duration::from_secs(20);

/// The nine setup steps, in order. Serialized as a stable string tag so the
/// frontend can key its checklist UI off it directly.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SetupStep {
    CreateDataDirectory,
    InitializeDatabase,
    WriteConfiguration,
    StartDatabase,
    CreateRoles,
    CreateDatabase,
    RunMigrations,
    WriteConfigFile,
    VerifyConnection,
}

impl SetupStep {
    pub const ALL: [SetupStep; 9] = [
        SetupStep::CreateDataDirectory,
        SetupStep::InitializeDatabase,
        SetupStep::WriteConfiguration,
        SetupStep::StartDatabase,
        SetupStep::CreateRoles,
        SetupStep::CreateDatabase,
        SetupStep::RunMigrations,
        SetupStep::WriteConfigFile,
        SetupStep::VerifyConnection,
    ];
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum StepStatus {
    Running,
    Done,
    Failed,
}

/// One progress update. `detail` is credential-free by construction: every
/// call site below builds it from fixed sentences plus a plain OS/SQLx
/// error `Display`, never the password or the assembled connection string —
/// the exact same discipline `db.rs` already holds itself to and tests.
#[derive(Clone, Debug, Serialize)]
pub struct SetupProgress {
    pub step: SetupStep,
    pub status: StepStatus,
    pub detail: Option<String>,
}

/// What the whole setup flow produced on success.
pub struct SetupOutcome {
    pub port: u16,
    pub pgdata: PathBuf,
    pub bin_dir: PathBuf,
}

pub enum SetupError {
    Io(String),
    Sql(String),
    Migration(String),
    Verification(String),
}

impl std::fmt::Display for SetupError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let msg = match self {
            SetupError::Io(m)
            | SetupError::Sql(m)
            | SetupError::Migration(m)
            | SetupError::Verification(m) => m,
        };
        f.write_str(msg)
    }
}

/// 32 random bytes, hex-encoded (64 characters, alphanumeric) — a
/// cryptographically random password with no new dependency: `getrandom` is
/// already pinned for `argon2`'s CSPRNG needs, and hex avoids pulling in a
/// base64 crate for a value that is never displayed to a human anyway.
fn generate_password() -> String {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).expect("OS CSPRNG must be available");
    let mut hex = String::with_capacity(64);
    for byte in bytes {
        hex.push_str(&format!("{byte:02x}"));
    }
    hex
}

fn append_setup_log(setup_log: &Path, line: &str) {
    use std::io::Write;
    let timestamp = time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default();
    let timestamped = format!("[{timestamp}] {line}\n");
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(setup_log)
    {
        let _ = file.write_all(timestamped.as_bytes());
    }
}

/// Executes one or more `;`-separated SQL statements. Uses the simple query
/// protocol (`sqlx::raw_sql`), not `sqlx::query`, because the latter's
/// prepared-statement protocol rejects multi-statement strings outright —
/// and both the role-attribute block and the database-setup block below are
/// multi-statement by design (copied verbatim from the provisioning script).
async fn exec_sql(conn: &mut PgConnection, sql: String) -> Result<(), sqlx::Error> {
    sqlx::raw_sql(&sql).execute(conn).await.map(|_| ())
}

#[derive(Default)]
struct RolePasswords {
    runtime: Option<String>,
    migrator: Option<String>,
}

/// Run the full first-run setup flow, depositing the spawned child process
/// (if a new one was started) into `handle` as soon as it exists — before
/// any later, fallible step — so a caller can always find and stop it even
/// if setup fails partway through role/database/migration steps.
///
/// `emit` is called at least twice per step (`Running` then `Done`/`Failed`)
/// so a UI can render a live checklist; every call is also appended to
/// `<app_data_dir>/setup.log`.
///
/// `app_data_dir` and `resource_dir` are passed in rather than resolved here
/// — this module has no Tauri dependency, so the caller (a
/// `#[tauri::command]`) resolves them via `app.path()`.
pub async fn run_setup(
    app_data_dir: PathBuf,
    resource_dir: PathBuf,
    preferred_port: u16,
    handle: std::sync::Arc<std::sync::Mutex<pg_process::EmbeddedPostgresHandle>>,
    mut emit: impl FnMut(SetupProgress) + Send,
) -> Result<SetupOutcome, SetupError> {
    // Not always `<app_data_dir>/pgdata` — see `pg_process::resolve_pgdata_dir`
    // for the non-ASCII-path fallback this exists to handle.
    let pgdata = pg_process::resolve_pgdata_dir(&app_data_dir);
    let bin_dir = resource_dir.join("postgres").join("win64").join("bin");
    let setup_log = app_data_dir.join("setup.log");

    {
        let mut guard = handle.lock().unwrap_or_else(|poison| poison.into_inner());
        guard.bin_dir = bin_dir.clone();
        guard.pgdata = pgdata.clone();
    }

    let mut report = |step: SetupStep, status: StepStatus, detail: Option<String>| {
        let line = match (status, &detail) {
            (StepStatus::Running, _) => format!("{step:?}: starting"),
            (StepStatus::Done, _) => format!("{step:?}: done"),
            (StepStatus::Failed, Some(d)) => format!("{step:?}: FAILED - {d}"),
            (StepStatus::Failed, None) => format!("{step:?}: FAILED"),
        };
        append_setup_log(&setup_log, &line);
        emit(SetupProgress {
            step,
            status,
            detail,
        });
    };

    // ——— Step 1: data directory ———
    report(SetupStep::CreateDataDirectory, StepStatus::Running, None);
    let already_initialized = pgdata.join("PG_VERSION").exists();
    if !already_initialized {
        if let Err(err) = std::fs::create_dir_all(&pgdata) {
            let detail = format!("could not create the database folder ({err})");
            report(
                SetupStep::CreateDataDirectory,
                StepStatus::Failed,
                Some(detail.clone()),
            );
            return Err(SetupError::Io(detail));
        }
    }
    report(SetupStep::CreateDataDirectory, StepStatus::Done, None);

    // `stockiha_admin`'s password: generated once, here, and reused for
    // every later admin connection this run makes. It MUST be the exact
    // value handed to `initdb --pwfile` below — generating a second,
    // different password later (as an earlier version of this function
    // did) bakes one password into the actual database while every
    // subsequent connection attempts a different one, failing
    // authentication every time. An existing installation's repair path
    // (pgdata survives, database.json does not) cannot know this password
    // and does not attempt role/database work — see the report's "known
    // gap" note.
    let admin_password = if already_initialized {
        None
    } else {
        Some(generate_password())
    };

    // ——— Step 2: initdb. Skipped for an existing installation — initdb
    // itself refuses to initialize an already-populated directory, loudly,
    // so skipping here is a courtesy, not a safety requirement. ———
    report(SetupStep::InitializeDatabase, StepStatus::Running, None);
    if let Some(admin_password) = &admin_password {
        if let Err(detail) = run_initdb(&bin_dir, &pgdata, admin_password) {
            report(
                SetupStep::InitializeDatabase,
                StepStatus::Failed,
                Some(detail.clone()),
            );
            return Err(SetupError::Io(detail));
        }
    }
    report(SetupStep::InitializeDatabase, StepStatus::Done, None);

    // ——— Step 3: postgresql.conf / pg_hba.conf ———
    report(SetupStep::WriteConfiguration, StepStatus::Running, None);
    let port = if already_initialized {
        // An existing installation already chose its port; re-probing here
        // could pick a *different* free port than what a surviving
        // database.json (if any) expects. The caller passes the previously
        // chosen port back in as `preferred_port` when repairing.
        preferred_port
    } else {
        match pg_process::find_free_port(preferred_port) {
            Some(p) => p,
            None => {
                let detail = format!("no free port found starting at {preferred_port}");
                report(
                    SetupStep::WriteConfiguration,
                    StepStatus::Failed,
                    Some(detail.clone()),
                );
                return Err(SetupError::Io(detail));
            }
        }
    };
    if !already_initialized {
        if let Err(detail) = write_server_config(&pgdata, port) {
            report(
                SetupStep::WriteConfiguration,
                StepStatus::Failed,
                Some(detail.clone()),
            );
            return Err(SetupError::Io(detail));
        }
    }
    report(SetupStep::WriteConfiguration, StepStatus::Done, None);

    // ——— Step 4: start the server, honoring the stale-pid safety check ———
    report(SetupStep::StartDatabase, StepStatus::Running, None);
    let child = match pg_process::ensure_running(bin_dir.clone(), pgdata.clone(), port).await {
        Ok(child) => child,
        Err(detail) => {
            report(
                SetupStep::StartDatabase,
                StepStatus::Failed,
                Some(detail.clone()),
            );
            return Err(SetupError::Io(detail));
        }
    };
    {
        let mut guard = handle.lock().unwrap_or_else(|poison| poison.into_inner());
        if child.is_some() {
            guard.child = child;
        }
        guard.port = port;
    }
    report(SetupStep::StartDatabase, StepStatus::Done, None);

    // ——— Step 5: roles ———
    report(SetupStep::CreateRoles, StepStatus::Running, None);
    let role_passwords = match &admin_password {
        Some(admin_password) => match create_roles(port, admin_password.clone()).await {
            Ok(passwords) => passwords,
            Err(detail) => {
                report(
                    SetupStep::CreateRoles,
                    StepStatus::Failed,
                    Some(detail.clone()),
                );
                return Err(SetupError::Sql(detail));
            }
        },
        None => RolePasswords::default(),
    };
    report(SetupStep::CreateRoles, StepStatus::Done, None);

    // ——— Step 6: database ———
    report(SetupStep::CreateDatabase, StepStatus::Running, None);
    if let Some(admin_password) = &admin_password {
        if let Err(detail) = create_database(port, admin_password.clone()).await {
            report(
                SetupStep::CreateDatabase,
                StepStatus::Failed,
                Some(detail.clone()),
            );
            return Err(SetupError::Sql(detail));
        }
    }
    report(SetupStep::CreateDatabase, StepStatus::Done, None);

    // ——— Step 7: migrations, in-process — the same embedded Migrator
    // schema_version.rs already uses for the version check, not a spawned
    // --provision-migrate subprocess of itself (see the WS-K-4 report). ———
    report(SetupStep::RunMigrations, StepStatus::Running, None);
    let migrator_password = role_passwords.migrator.clone().unwrap_or_default();
    if let Err(detail) = run_migrations(port, migrator_password.clone()).await {
        report(
            SetupStep::RunMigrations,
            StepStatus::Failed,
            Some(detail.clone()),
        );
        return Err(SetupError::Migration(detail));
    }
    report(SetupStep::RunMigrations, StepStatus::Done, None);

    // ——— Step 8: write database.json — only now, with every prior step
    // already verified working. ———
    report(SetupStep::WriteConfigFile, StepStatus::Running, None);
    let runtime_password = role_passwords.runtime.clone().unwrap_or_default();
    if let Err(err) = local_config::write(
        &app_data_dir,
        "127.0.0.1",
        port,
        DATABASE_NAME,
        "stockiha_runtime",
        &runtime_password,
    ) {
        let detail = format!("could not write database.json ({err})");
        report(
            SetupStep::WriteConfigFile,
            StepStatus::Failed,
            Some(detail.clone()),
        );
        return Err(SetupError::Io(detail));
    }
    report(SetupStep::WriteConfigFile, StepStatus::Done, None);

    // ——— Step 9: verify using exactly what was written; delete it again on
    // any failure. ———
    report(SetupStep::VerifyConnection, StepStatus::Running, None);
    match verify_written_config(app_data_dir.clone()).await {
        Ok(()) => {
            report(SetupStep::VerifyConnection, StepStatus::Done, None);
        }
        Err(detail) => {
            let _ = local_config::remove(&app_data_dir);
            report(
                SetupStep::VerifyConnection,
                StepStatus::Failed,
                Some(detail.clone()),
            );
            return Err(SetupError::Verification(detail));
        }
    }

    Ok(SetupOutcome {
        port,
        pgdata,
        bin_dir,
    })
}

fn run_initdb(bin_dir: &Path, pgdata: &Path, admin_password: &str) -> Result<(), String> {
    let initdb_exe = bin_dir.join("initdb.exe");
    let pwfile =
        std::env::temp_dir().join(format!("stockiha-initdb-pw-{}.tmp", std::process::id()));
    std::fs::write(&pwfile, admin_password)
        .map_err(|e| format!("could not write a temporary password file ({e})"))?;

    let result = std::process::Command::new(&initdb_exe)
        .arg("-D")
        .arg(pgdata)
        .arg("-E")
        .arg("UTF8")
        .arg("--locale=C")
        .arg("-U")
        .arg("stockiha_admin")
        .arg("-A")
        .arg("scram-sha-256")
        .arg(format!("--pwfile={}", pwfile.display()))
        .arg("--auth-host=scram-sha-256")
        .arg("--auth-local=scram-sha-256")
        .stdin(std::process::Stdio::null())
        .output();

    let _ = std::fs::remove_file(&pwfile);

    match result {
        Ok(output) if output.status.success() => Ok(()),
        Ok(output) => Err(format!(
            "initdb exited with {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        )),
        Err(err) => Err(format!("could not run initdb ({err})")),
    }
}

fn write_server_config(pgdata: &Path, port: u16) -> Result<(), String> {
    use std::io::Write;
    let conf_path = pgdata.join("postgresql.conf");
    let mut file = std::fs::OpenOptions::new()
        .append(true)
        .open(&conf_path)
        .map_err(|e| format!("could not open postgresql.conf ({e})"))?;
    writeln!(
        file,
        "\n# --- Stockiha WS-K-4 embedded setup ---\nlisten_addresses = '127.0.0.1'\nport = {port}\n"
    )
    .map_err(|e| format!("could not write postgresql.conf ({e})"))?;

    let hba_path = pgdata.join("pg_hba.conf");
    let hba = "# Stockiha WS-K-4: loopback-only, password-authenticated. No trust, no\n\
               # network-exposed entries. Regenerated by setup; do not hand-edit.\n\
               local   all             all                                     scram-sha-256\n\
               host    all             all             127.0.0.1/32            scram-sha-256\n\
               host    all             all             ::1/128                 scram-sha-256\n";
    std::fs::write(&hba_path, hba).map_err(|e| format!("could not write pg_hba.conf ({e})"))?;

    Ok(())
}

/// A bare TCP connect (what [`pg_process::wait_until_ready`] waits for) only
/// proves the postmaster is listening — on Windows in particular there is a
/// real window after that where the postmaster is still finishing startup
/// (forking the startup subprocess, replaying WAL) and answers every new
/// connection with "the database system is starting up" until it's done.
/// That's a transient condition, not a real failure, so retry through it
/// instead of surfacing it as a setup failure on the first unlucky attempt.
const ADMIN_CONNECT_RETRY_TIMEOUT: Duration = Duration::from_secs(15);

async fn connect_as_admin(port: u16, admin_password: String) -> Result<PgConnection, String> {
    let options = PgConnectOptions::new()
        .host("127.0.0.1")
        .port(port)
        .username("stockiha_admin")
        .password(&admin_password)
        .database("postgres");

    let started = std::time::Instant::now();
    loop {
        match PgConnection::connect_with(&options).await {
            Ok(conn) => return Ok(conn),
            Err(e) => {
                let starting_up = e
                    .as_database_error()
                    .map(|db_err| db_err.message().contains("starting up"))
                    .unwrap_or(false);
                if !starting_up || started.elapsed() >= ADMIN_CONNECT_RETRY_TIMEOUT {
                    return Err(format!("could not connect as stockiha_admin ({e})"));
                }
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
        }
    }
}

async fn create_roles(port: u16, admin_password: String) -> Result<RolePasswords, String> {
    let mut conn = connect_as_admin(port, admin_password).await?;

    let roles = [
        "stockiha_backup",
        "stockiha_migrator",
        "stockiha_owner",
        "stockiha_runtime",
    ];
    let mut passwords = std::collections::HashMap::new();
    for role in roles {
        let password = generate_password();
        let escaped = password.replace('\'', "''");
        let sql = format!(
            "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') THEN \
             CREATE ROLE \"{role}\" PASSWORD '{escaped}'; ELSE ALTER ROLE \"{role}\" PASSWORD '{escaped}'; \
             END IF; END $$;"
        );
        exec_sql(&mut conn, sql)
            .await
            .map_err(|e| format!("could not create role {role} ({e})"))?;
        passwords.insert(role.to_string(), password);
    }

    // Attributes copied verbatim from
    // scripts/recovery/stockiha_bootstrap_roles_and_grants.sql (see the
    // WS-K-2 report for the original transcription).
    let attrs = concat!(
        "ALTER ROLE \"stockiha_admin\" LOGIN INHERIT SUPERUSER CREATEDB CREATEROLE REPLICATION BYPASSRLS;\n",
        "ALTER ROLE \"stockiha_backup\" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;\n",
        "ALTER ROLE \"stockiha_migrator\" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;\n",
        "ALTER ROLE \"stockiha_owner\" NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;\n",
        "ALTER ROLE \"stockiha_runtime\" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;\n",
        "GRANT \"stockiha_owner\" TO \"stockiha_migrator\" WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;",
    );
    exec_sql(&mut conn, attrs.to_owned())
        .await
        .map_err(|e| format!("could not set role attributes ({e})"))?;

    let _ = conn.close().await;

    Ok(RolePasswords {
        runtime: passwords.get("stockiha_runtime").cloned(),
        migrator: passwords.get("stockiha_migrator").cloned(),
    })
}

async fn create_database(port: u16, admin_password: String) -> Result<(), String> {
    let mut conn = connect_as_admin(port, admin_password.clone()).await?;

    let exists_sql = format!("SELECT 1 FROM pg_database WHERE datname = '{DATABASE_NAME}'");
    let exists = sqlx::query(&exists_sql)
        .fetch_optional(&mut conn)
        .await
        .map_err(|e| format!("could not check for an existing database ({e})"))?
        .is_some();

    if !exists {
        exec_sql(
            &mut conn,
            format!("CREATE DATABASE \"{DATABASE_NAME}\" WITH OWNER stockiha_owner;"),
        )
        .await
        .map_err(|e| format!("could not create the database ({e})"))?;
    }
    let _ = conn.close().await;

    // Matches Provision-StockihaPostgres.ps1's New-StockihaDatabase exactly:
    // grants stockiha_migrator CREATE on public (needed to bootstrap
    // _sqlx_migrations) and sets the per-database session default so
    // `SET ROLE stockiha_owner` inside every migration file has something
    // to switch to.
    let db_options = PgConnectOptions::new()
        .host("127.0.0.1")
        .port(port)
        .username("stockiha_admin")
        .password(&admin_password)
        .database(DATABASE_NAME);
    let mut db_conn = PgConnection::connect_with(&db_options)
        .await
        .map_err(|e| format!("could not connect to {DATABASE_NAME} as stockiha_admin ({e})"))?;
    let setup_sql = format!(
        "GRANT ALL ON SCHEMA public TO stockiha_owner;\n\
         GRANT USAGE, CREATE ON SCHEMA public TO stockiha_migrator;\n\
         ALTER SCHEMA public OWNER TO stockiha_owner;\n\
         ALTER ROLE stockiha_migrator IN DATABASE \"{DATABASE_NAME}\" SET role = 'stockiha_owner';"
    );
    exec_sql(&mut db_conn, setup_sql)
        .await
        .map_err(|e| format!("could not finish preparing the database ({e})"))?;
    let _ = db_conn.close().await;

    Ok(())
}

async fn run_migrations(port: u16, migrator_password: String) -> Result<(), String> {
    let options = PgConnectOptions::new()
        .host("127.0.0.1")
        .port(port)
        .username("stockiha_migrator")
        .password(&migrator_password)
        .database(DATABASE_NAME);
    let mut conn = PgConnection::connect_with(&options)
        .await
        .map_err(|e| format!("could not connect as stockiha_migrator ({e})"))?;
    let result = schema_version::run_all_migrations(&mut conn)
        .await
        .map_err(|e| format!("migrations failed ({e})"));
    let _ = conn.close().await;
    result
}

async fn verify_written_config(app_data_dir: PathBuf) -> Result<(), String> {
    let outcome = local_config::load(&app_data_dir);
    match outcome {
        local_config::LocalConfigOutcome::Loaded { options, .. } => {
            let conn = PgConnection::connect_with(&options)
                .await
                .map_err(|e| format!("wrote database.json but could not connect with it ({e})"))?;
            let _ = conn.close().await;
            Ok(())
        }
        _ => Err("database.json was written but could not be read back".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::pg_process::EmbeddedPostgresHandle;
    use std::sync::Mutex;

    /// The real, shipped resource root (`run_setup` itself joins
    /// `postgres/win64/bin` onto this) — resolved relative to this crate's
    /// own manifest dir so the test works regardless of current directory.
    /// Same binaries the built installer carries.
    fn bundled_resource_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources")
    }

    fn temp_app_data_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "sk-embedded-setup-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// The highest-probability remaining landmine, per the task: a Windows
    /// account with a non-ASCII display name/username (the Owner's client
    /// is in Algeria) gives an `app_data_dir()` like
    /// `C:\Users\محمد\AppData\...`, and `initdb` has a documented history
    /// of failing on non-ASCII Windows paths.
    ///
    /// This creates no Windows account (out of scope for an autonomous
    /// agent — that is a system-level change, not something this task
    /// authorizes performing outside a human's own action) — it instead
    /// exercises the actual mechanism of concern directly: a real
    /// `app_data_dir` whose path contains Arabic characters, run through
    /// the exact same `run_setup` → `std::process::Command` → `initdb.exe`
    /// path the shipped app uses. `std::process::Command` on Windows passes
    /// arguments via `CreateProcessW` (UTF-16), not a narrow/ANSI codepage,
    /// so this is the authoritative test — a plain shell invocation of
    /// `initdb.exe` through Git Bash's own ANSI-codepage argument passing
    /// is a red herring that fails for an unrelated reason and does not
    /// reflect how the real Rust code invokes the binary.
    fn temp_app_data_dir_with_arabic_path(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "sk-embedded-setup-{label}-محمد-١٢٣-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[tokio::test]
    #[ignore = "spawns a real, disposable PostgreSQL instance; run explicitly with -- --ignored"]
    async fn full_setup_succeeds_against_a_non_ascii_arabic_data_path() {
        let app_data_dir = temp_app_data_dir_with_arabic_path("nonascii");
        let resource_dir = bundled_resource_dir();
        let handle = std::sync::Arc::new(Mutex::new(EmbeddedPostgresHandle::new(
            PathBuf::new(),
            PathBuf::new(),
            0,
        )));

        let mut steps_seen = Vec::new();
        let result = run_setup(
            app_data_dir.clone(),
            resource_dir.clone(),
            58470,
            handle.clone(),
            |progress| {
                steps_seen.push((progress.step, progress.status));
                if progress.status == StepStatus::Failed {
                    eprintln!("FAILED: {:?} — {:?}", progress.step, progress.detail);
                }
            },
        )
        .await;

        // The fallback resolves pgdata to a fixed, ASCII-only path under
        // %ProgramData% (not under app_data_dir) — captured before the
        // guard is dropped so it can be cleaned up too, regardless of the
        // outcome below.
        let pgdata_used = {
            let mut guard = handle.lock().unwrap();
            let pgdata_used = guard.pgdata.clone();
            if let Some(mut child) = guard.child.take() {
                let _ = pg_process::stop_postgres(
                    &guard.bin_dir,
                    &guard.pgdata,
                    Duration::from_secs(10),
                );
                let _ = child.wait();
            }
            pgdata_used
        };

        match result {
            Ok(_) => {
                assert!(app_data_dir.join("database.json").exists());
                for step in SetupStep::ALL {
                    assert!(
                        steps_seen.contains(&(step, StepStatus::Done)),
                        "expected {step:?} to report Done under a non-ASCII data path"
                    );
                }
            }
            Err(err) => panic!(
                "setup failed against a non-ASCII (Arabic) data path — this is the exact risk \
                 the task called out as the highest-probability remaining landmine: {err}"
            ),
        }

        let _ = std::fs::remove_dir_all(&app_data_dir);
        if !pgdata_used.as_os_str().is_empty() {
            let _ = std::fs::remove_dir_all(&pgdata_used);
        }
    }

    /// Real, full end-to-end proof: all nine steps against a disposable
    /// temp directory, using the actual bundled PostgreSQL 18.6 binaries.
    /// Creates no service, no Windows account, needs no elevation, and
    /// never touches the Owner's own cluster or app-data path.
    #[tokio::test]
    #[ignore = "spawns a real, disposable PostgreSQL instance; run explicitly with -- --ignored"]
    async fn full_setup_runs_end_to_end_against_a_temp_directory() {
        let app_data_dir = temp_app_data_dir("e2e");
        let resource_dir = bundled_resource_dir();
        let handle = std::sync::Arc::new(Mutex::new(EmbeddedPostgresHandle::new(
            PathBuf::new(),
            PathBuf::new(),
            0,
        )));

        let mut steps_seen = Vec::new();
        let result = run_setup(
            app_data_dir.clone(),
            resource_dir.clone(),
            58432,
            handle.clone(),
            |progress| {
                steps_seen.push((progress.step, progress.status));
                if progress.status == StepStatus::Failed {
                    eprintln!("FAILED: {:?} — {:?}", progress.step, progress.detail);
                }
            },
        )
        .await;

        // Always stop the spawned server before asserting/cleaning up, even
        // on failure, so no orphan is left running against a temp dir we
        // are about to delete out from under it.
        {
            let mut guard = handle.lock().unwrap();
            if let Some(mut child) = guard.child.take() {
                let _ = pg_process::stop_postgres(
                    &guard.bin_dir,
                    &guard.pgdata,
                    Duration::from_secs(10),
                );
                let _ = child.wait();
            }
        }

        match result {
            Ok(outcome) => {
                assert!(outcome.port >= 58432);
                assert!(app_data_dir.join("database.json").exists());
                assert!(app_data_dir.join("setup.log").exists());
                for step in SetupStep::ALL {
                    assert!(
                        steps_seen.contains(&(step, StepStatus::Done)),
                        "expected {step:?} to report Done"
                    );
                }
            }
            Err(err) => panic!("expected setup to succeed: {err}"),
        }

        let _ = std::fs::remove_dir_all(&app_data_dir);
    }

    #[test]
    fn generated_passwords_are_high_entropy_hex() {
        let a = generate_password();
        let b = generate_password();
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }

    /// The absolute rule this module documents at its top: a failure that
    /// happens *after* database.json could have been written must still
    /// leave no file behind. Forces a real failure at step 7 (migrations)
    /// by killing the just-started server the moment CreateDatabase reports
    /// Done — i.e. after every step that could plausibly succeed, but
    /// before migrations get a chance to run — and asserts database.json
    /// was never written.
    #[tokio::test]
    #[ignore = "spawns a real, disposable PostgreSQL instance; run explicitly with -- --ignored"]
    async fn a_failure_during_migrations_leaves_no_database_json() {
        let app_data_dir = temp_app_data_dir("migrate-fail");
        let resource_dir = bundled_resource_dir();
        let handle = std::sync::Arc::new(Mutex::new(EmbeddedPostgresHandle::new(
            PathBuf::new(),
            PathBuf::new(),
            0,
        )));
        let handle_for_kill = handle.clone();

        let result = run_setup(
            app_data_dir.clone(),
            resource_dir.clone(),
            58480,
            handle.clone(),
            move |progress| {
                if progress.step == SetupStep::CreateDatabase && progress.status == StepStatus::Done
                {
                    let mut guard = handle_for_kill.lock().unwrap();
                    if let Some(child) = guard.child.as_mut() {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
            },
        )
        .await;

        assert!(
            result.is_err(),
            "killing the server before migrations should surface as a setup failure"
        );
        assert!(
            !app_data_dir.join("database.json").exists(),
            "database.json must not exist after a failure at the migrations step"
        );

        // Best-effort cleanup: the server is already dead (that was the
        // point), but the guard may still hold a handle worth reaping.
        {
            let mut guard = handle.lock().unwrap();
            if let Some(mut child) = guard.child.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
        let _ = std::fs::remove_dir_all(&app_data_dir);
    }

    /// The password rule WS-K-1 already enforces for its own error surfaces
    /// applies just as much to setup.log: nothing this module generates
    /// (five independent 64-char hex role passwords) may ever appear in it,
    /// under success or failure. A run of 64+ consecutive hex digits is a
    /// reliable fingerprint for one of our own generated passwords leaking
    /// into a log line, since nothing else this module writes is that long.
    fn contains_a_64_hex_char_run(haystack: &str) -> bool {
        let mut run = 0usize;
        for b in haystack.bytes() {
            if b.is_ascii_hexdigit() {
                run += 1;
                if run >= 64 {
                    return true;
                }
            } else {
                run = 0;
            }
        }
        false
    }

    #[tokio::test]
    #[ignore = "spawns a real, disposable PostgreSQL instance; run explicitly with -- --ignored"]
    async fn setup_log_never_contains_a_generated_password() {
        let app_data_dir = temp_app_data_dir("no-password-leak");
        let resource_dir = bundled_resource_dir();
        let handle = std::sync::Arc::new(Mutex::new(EmbeddedPostgresHandle::new(
            PathBuf::new(),
            PathBuf::new(),
            0,
        )));

        let result = run_setup(
            app_data_dir.clone(),
            resource_dir,
            58490,
            handle.clone(),
            |_| {},
        )
        .await;

        {
            let mut guard = handle.lock().unwrap();
            if let Some(mut child) = guard.child.take() {
                let _ = pg_process::stop_postgres(
                    &guard.bin_dir,
                    &guard.pgdata,
                    Duration::from_secs(10),
                );
                let _ = child.wait();
            }
        }

        assert!(result.is_ok(), "setup should succeed");
        let log = std::fs::read_to_string(app_data_dir.join("setup.log"))
            .expect("setup.log should exist after a run");
        assert!(
            !contains_a_64_hex_char_run(&log),
            "setup.log appears to contain a raw generated password"
        );

        let _ = std::fs::remove_dir_all(&app_data_dir);
    }
}
