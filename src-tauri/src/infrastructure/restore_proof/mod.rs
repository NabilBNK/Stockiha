//! S0-010 — Temporary-database restore and reconciliation proof.
//!
//! Proves the Rust backend can validate an S0-009 backup bundle, restore its
//! `database.dump` into a uniquely named, throwaway PostgreSQL 18 database
//! via `pg_restore`, run deterministic fixture-based reconciliation against
//! the database the bundle was taken from, and always drop both temporary
//! databases — success or failure. No restore ever targets, or even
//! connects near, the real Stockiha application database.
//!
//! ## Role and credential strategy (checked against S0-004, not assumed)
//! S0-004's role posture matrix gives **all four** fixed Stockiha roles
//! `NOCREATEDB`, and `stockiha_backup` additionally has no memberships and
//! only per-object `SELECT`. None of them can create or drop a database, or
//! run a DDL-heavy restore. Every destructive operation here — creating and
//! dropping the temporary databases, running `pg_restore`, and the
//! reconciliation queries — uses one distinct **admin** connection, read
//! from `STOCKIHA_RESTORE_PROOF_ADMIN_DATABASE_URL` and gated by
//! `STOCKIHA_ALLOW_RESTORE_PROOF=YES`, mirroring S0-004's
//! `STOCKIHA_BOOTSTRAP_ADMIN_DATABASE_URL` precedent rather than inventing a
//! new pattern. This is never one of the four Stockiha app roles.
//!
//! ## Secrets / data-leak policy
//! The raw admin URL is parsed exactly once ([`parse_admin_url`]) and never
//! retained, logged, reported, or rendered by any `Display`/`Debug`. Note
//! that `sqlx::postgres::PgConnectOptions` itself derives `Debug` **without**
//! redacting its password field (confirmed against the real `sqlx-postgres
//! 0.8.6` source, not assumed) — this module therefore never calls
//! `{:?}`/`{}` on a `PgConnectOptions` value anywhere, and neither
//! [`ParsedAdminUrl`] nor [`RestoreProofError`] derive or implement `Debug`
//! in a way that could expose it. `pg_restore`'s own authentication uses the
//! same host/port/username via argv and the password via the child's
//! `PGPASSWORD` environment variable only — exactly like S0-009's `pg_dump`
//! handling — never a connection URL, never argv.
//!
//! ## Platform split
//! Everything here — URL parsing, identifier quoting/validation, `pg_restore`
//! invocation, the async database operations, and the cleanup orchestration
//! — is platform-neutral. The only Windows-specific step is reading the
//! `stockiha_backup` credential (via `backup_proof::resolve_backup_credential`,
//! reused, not duplicated) for the live proof's "generate a real bundle"
//! phase.
//!
//! ## Bundle validation
//! This module never re-parses `manifest.json`/`checksums.sha256`, never
//! reimplements the required layout, path normalization, path-traversal
//! checks, symlink/reparse-point rejection, or version validation — it calls
//! [`super::backup_proof::validate_bundle`], the single authoritative
//! validator, exclusively.

use core::fmt;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use sqlx::postgres::PgConnectOptions;
use sqlx::{Connection, PgConnection};

use super::backup_proof::{
    parse_pg_dump_major_version, validate_bundle, BackupProofError, ValidatedBundle,
};

// ---------------------------------------------------------------------------
// Fixed constants
// ---------------------------------------------------------------------------

/// Fixed prefix every generated temporary database name must carry. Checked
/// immediately before every destructive operation — never trusted once and
/// forgotten.
pub(crate) const TEMP_DB_PREFIX: &str = "stockiha_restore_proof_";

/// The only maintenance database the admin connection may target. Checked
/// both at URL-parse time and, in the live proof, against a live
/// `SELECT current_database()`.
pub(crate) const REQUIRED_MAINTENANCE_DATABASE: &str = "postgres";

/// The only PostgreSQL major version this proof (and the target
/// architecture) supports — same requirement S0-009 places on `pg_dump`.
pub(crate) const REQUIRED_PG_MAJOR_VERSION: u32 = super::backup_proof::REQUIRED_PG_MAJOR_VERSION;

/// Fixed fixture table name used for reconciliation. A fixed literal, never
/// built from any input.
#[cfg_attr(not(windows), allow(dead_code))] // only the Windows live proof calls this
const FIXTURE_TABLE: &str = "stockiha_restore_proof_fixture";

// ---------------------------------------------------------------------------
// Errors (non-serializable, redacted — mirrors the other Slice 0 proofs)
// ---------------------------------------------------------------------------

/// Internal restore-proof error. Not serialized; does not cross any IPC
/// boundary. `Debug`/`Display` are redacted to a stable, payload-free
/// string; no admin URL, password, bundle path, or SQL diagnostic text is
/// ever rendered by either.
pub(crate) enum RestoreProofError {
    /// `STOCKIHA_RESTORE_PROOF_ADMIN_DATABASE_URL` was not set.
    AdminUrlMissing,
    /// The admin URL could not be parsed, or did not explicitly target the
    /// required maintenance database. Never retains the raw URL.
    AdminUrlInvalid,
    /// The live connection's `SELECT current_database()` was not
    /// [`REQUIRED_MAINTENANCE_DATABASE`].
    WrongMaintenanceDatabase,
    /// A generated database name did not carry [`TEMP_DB_PREFIX`] or
    /// contained a character outside lowercase ASCII letters, digits, and
    /// underscore. Should never trigger in practice (names are always
    /// self-generated) — this is the defensive guard checked immediately
    /// before every destructive operation.
    UnsafeGeneratedDatabaseName,
    /// `CREATE DATABASE` failed.
    DatabaseCreateFailed,
    /// `DROP DATABASE` failed.
    DatabaseDropFailed,
    /// Establishing the admin connection failed.
    AdminConnectFailed,
    /// Bundle preflight validation failed. Wraps the already-redacted
    /// `backup_proof::BackupProofError` summary; the safe text is preserved
    /// only in [`RestoreProofError::diagnostic`].
    BundleInvalid(BackupProofErrorSummary),
    /// The `pg_restore` executable could not be found or spawned.
    PgRestoreNotFound,
    /// `pg_restore --version` produced output this proof could not parse.
    PgRestoreVersionParseFailed,
    /// `pg_restore --version` reported a major version other than
    /// [`REQUIRED_PG_MAJOR_VERSION`]. Detail retained only in `diagnostic()`.
    PgRestoreVersionMismatch(u32),
    /// The `pg_restore` child process exited with a failure status. Detail
    /// retained only in `diagnostic()`.
    PgRestoreFailed(Option<i32>),
    /// A reconciliation query (seeding or digesting the fixture table)
    /// failed.
    ReconciliationQueryFailed,
    /// Source and restored fixture data did not match (row count or
    /// SHA-256 digest differs).
    ReconciliationMismatch,
    /// A filesystem operation failed. Carries no path.
    Io,
}

/// A redacted, owned summary of a [`BackupProofError`], captured via its
/// own already-safe `Display` — adds no new leak surface.
pub(crate) struct BackupProofErrorSummary(String);

impl From<BackupProofError> for BackupProofErrorSummary {
    fn from(err: BackupProofError) -> Self {
        BackupProofErrorSummary(err.to_string())
    }
}

impl RestoreProofError {
    fn code(&self) -> &'static str {
        match self {
            RestoreProofError::AdminUrlMissing => "RESTORE_PROOF_ADMIN_URL_MISSING",
            RestoreProofError::AdminUrlInvalid => "RESTORE_PROOF_ADMIN_URL_INVALID",
            RestoreProofError::WrongMaintenanceDatabase => {
                "RESTORE_PROOF_WRONG_MAINTENANCE_DATABASE"
            }
            RestoreProofError::UnsafeGeneratedDatabaseName => {
                "RESTORE_PROOF_UNSAFE_GENERATED_DATABASE_NAME"
            }
            RestoreProofError::DatabaseCreateFailed => "RESTORE_PROOF_DATABASE_CREATE_FAILED",
            RestoreProofError::DatabaseDropFailed => "RESTORE_PROOF_DATABASE_DROP_FAILED",
            RestoreProofError::AdminConnectFailed => "RESTORE_PROOF_ADMIN_CONNECT_FAILED",
            RestoreProofError::BundleInvalid(_) => "RESTORE_PROOF_BUNDLE_INVALID",
            RestoreProofError::PgRestoreNotFound => "RESTORE_PROOF_PG_RESTORE_NOT_FOUND",
            RestoreProofError::PgRestoreVersionParseFailed => {
                "RESTORE_PROOF_PG_RESTORE_VERSION_PARSE_FAILED"
            }
            RestoreProofError::PgRestoreVersionMismatch(_) => {
                "RESTORE_PROOF_PG_RESTORE_VERSION_MISMATCH"
            }
            RestoreProofError::PgRestoreFailed(_) => "RESTORE_PROOF_PG_RESTORE_FAILED",
            RestoreProofError::ReconciliationQueryFailed => {
                "RESTORE_PROOF_RECONCILIATION_QUERY_FAILED"
            }
            RestoreProofError::ReconciliationMismatch => "RESTORE_PROOF_RECONCILIATION_MISMATCH",
            RestoreProofError::Io => "RESTORE_PROOF_IO",
        }
    }

    /// Internal-only diagnostic detail, retained for trusted in-crate
    /// debugging and tests. Never serialized and never surfaced by
    /// `Display`/`Debug`. Contains no admin URL, password, or bundle path —
    /// only fixed text and safe numeric detail.
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn diagnostic(&self) -> String {
        match self {
            RestoreProofError::BundleInvalid(summary) => summary.0.clone(),
            RestoreProofError::PgRestoreVersionMismatch(major) => format!(
                "found pg_restore major version {major}, required {REQUIRED_PG_MAJOR_VERSION}"
            ),
            RestoreProofError::PgRestoreFailed(code) => match code {
                Some(c) => format!("pg_restore exited with status {c}"),
                None => "pg_restore terminated without an exit code".to_string(),
            },
            other => other.code().to_string(),
        }
    }
}

impl fmt::Display for RestoreProofError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.code())
    }
}

impl fmt::Debug for RestoreProofError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "RestoreProofError({})", self.code())
    }
}

impl std::error::Error for RestoreProofError {}

fn map_bundle_error(err: BackupProofError) -> RestoreProofError {
    RestoreProofError::BundleInvalid(BackupProofErrorSummary::from(err))
}

/// Validate a bundle before any restore is attempted.
///
/// Delegates entirely to [`super::backup_proof::validate_bundle`] — the
/// single authoritative bundle validator. This wrapper exists only to map
/// its error type into [`RestoreProofError`]; it re-parses nothing, checks
/// nothing itself, and adds no logic of its own.
pub(crate) fn preflight_bundle(bundle_dir: &Path) -> Result<ValidatedBundle, RestoreProofError> {
    validate_bundle(bundle_dir).map_err(map_bundle_error)
}

// ---------------------------------------------------------------------------
// Admin URL parsing (hand-rolled — a minimal `postgres://` parser; the "no
// hand-parse" rule in this proof applies to JSON, not URLs)
// ---------------------------------------------------------------------------

/// The admin connection's parsed fields. Deliberately has **no**
/// `Debug`/`Display` impl — the compiler itself enforces that nothing can
/// accidentally `{:?}`/`{}` this and leak the password.
pub(crate) struct ParsedAdminUrl {
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) username: String,
    pub(crate) password: String,
    pub(crate) database: String,
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = &input[i + 1..i + 3];
            if let Ok(value) = u8::from_str_radix(hex, 16) {
                out.push(value);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Parse a `postgres://user:password@host[:port]/database` admin URL.
///
/// Scoped simplifications, documented rather than silently assumed: no
/// IPv6 bracketed host literals, no query-string handling (anything after
/// `?` is discarded — this proof does not need TLS/SSL mode negotiation, the
/// same scoping S0-003 already applies to its own database URLs). The
/// database component must be exactly [`REQUIRED_MAINTENANCE_DATABASE`] —
/// checked here at parse time; the live connection's own
/// `SELECT current_database()` is checked again after connecting, since the
/// URL's declared database is only a request, not a guarantee about what
/// the server actually connects you to.
pub(crate) fn parse_admin_url(raw: &str) -> Result<ParsedAdminUrl, RestoreProofError> {
    let without_scheme = raw
        .strip_prefix("postgres://")
        .or_else(|| raw.strip_prefix("postgresql://"))
        .ok_or(RestoreProofError::AdminUrlInvalid)?;
    let without_query = without_scheme
        .split('?')
        .next()
        .ok_or(RestoreProofError::AdminUrlInvalid)?;

    let (userinfo, hostinfo) = without_query
        .split_once('@')
        .ok_or(RestoreProofError::AdminUrlInvalid)?;
    let (username_raw, password_raw) = userinfo
        .split_once(':')
        .ok_or(RestoreProofError::AdminUrlInvalid)?;
    if username_raw.is_empty() {
        return Err(RestoreProofError::AdminUrlInvalid);
    }
    let username = percent_decode(username_raw);
    let password = percent_decode(password_raw);

    let (host_port, database_raw) = hostinfo
        .split_once('/')
        .ok_or(RestoreProofError::AdminUrlInvalid)?;
    if host_port.is_empty() || database_raw.is_empty() {
        return Err(RestoreProofError::AdminUrlInvalid);
    }
    let database = percent_decode(database_raw);
    if database != REQUIRED_MAINTENANCE_DATABASE {
        return Err(RestoreProofError::AdminUrlInvalid);
    }

    let (host, port) = match host_port.rsplit_once(':') {
        Some((h, p)) if !h.is_empty() => {
            let parsed_port: u16 = p.parse().map_err(|_| RestoreProofError::AdminUrlInvalid)?;
            (h.to_string(), parsed_port)
        }
        _ => (host_port.to_string(), 5432),
    };
    if host.is_empty() {
        return Err(RestoreProofError::AdminUrlInvalid);
    }

    Ok(ParsedAdminUrl {
        host,
        port,
        username,
        password,
        database,
    })
}

/// Build `sqlx::postgres::PgConnectOptions` from a [`ParsedAdminUrl`].
///
/// **Never** call `{:?}`/`{}` on the returned value — `PgConnectOptions`
/// derives `Debug` without redacting its password field (verified against
/// the real `sqlx-postgres 0.8.6` source).
#[cfg_attr(not(windows), allow(dead_code))] // only the Windows live proof calls this
pub(crate) fn admin_connect_options(parsed: &ParsedAdminUrl) -> PgConnectOptions {
    PgConnectOptions::new()
        .host(&parsed.host)
        .port(parsed.port)
        .username(&parsed.username)
        .password(&parsed.password)
        .database(&parsed.database)
}

// ---------------------------------------------------------------------------
// Temporary-database naming, the destructive-prefix guard, and identifier
// quoting
// ---------------------------------------------------------------------------

static TEMP_DB_SUFFIX_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Generate a temporary database name: [`TEMP_DB_PREFIX`] combined with a
/// fixed `role` tag (e.g. `"source"`/`"restore"`, always a lowercase-ASCII
/// literal chosen by the caller, never external input), the process id, a
/// nanosecond timestamp, and a per-process atomic counter — the same
/// no-UUID uniqueness technique S0-009 uses for temporary directories.
pub(crate) fn generate_temp_db_name(role: &str) -> String {
    let n = TEMP_DB_SUFFIX_COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_nanos();
    format!(
        "{TEMP_DB_PREFIX}{role}_{}_{}_{}",
        std::process::id(),
        nanos,
        n
    )
}

/// The destructive-prefix guard: every database name this module creates or
/// drops must pass this check immediately before the operation — never
/// trusted from an earlier check alone. Rejects anything without
/// [`TEMP_DB_PREFIX`], and anything outside lowercase ASCII letters, digits,
/// and underscore (which also makes `quote_identifier`'s escaping provably
/// unnecessary for names this function accepts — it is applied anyway, as
/// defense in depth).
pub(crate) fn validate_generated_database_name(name: &str) -> Result<(), RestoreProofError> {
    if !name.starts_with(TEMP_DB_PREFIX) {
        return Err(RestoreProofError::UnsafeGeneratedDatabaseName);
    }
    if name
        .bytes()
        .any(|b| !(b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_'))
    {
        return Err(RestoreProofError::UnsafeGeneratedDatabaseName);
    }
    Ok(())
}

/// Quote a Postgres identifier: wrap in double quotes, doubling any embedded
/// double quote. `CREATE`/`DROP DATABASE` cannot bind-parameter an
/// identifier, so this — plus [`validate_generated_database_name`], always
/// called first — is what makes building that SQL safe.
pub(crate) fn quote_identifier(name: &str) -> String {
    let mut out = String::with_capacity(name.len() + 2);
    out.push('"');
    for c in name.chars() {
        if c == '"' {
            out.push('"');
        }
        out.push(c);
    }
    out.push('"');
    out
}

// ---------------------------------------------------------------------------
// Async database operations (platform-neutral; require a real PostgreSQL
// server to exercise — never mocked, only the live proof runs these)
// ---------------------------------------------------------------------------

/// Confirm the live connection's `SELECT current_database()` is exactly
/// [`REQUIRED_MAINTENANCE_DATABASE`]. Checked in addition to the parse-time
/// check in [`parse_admin_url`] — the URL's declared database is a request,
/// not a guarantee of what the server actually connected you to.
#[cfg_attr(not(windows), allow(dead_code))] // only the Windows live proof calls this
pub(crate) async fn verify_maintenance_database(
    conn: &mut PgConnection,
) -> Result<(), RestoreProofError> {
    let current: String = sqlx::query_scalar("SELECT current_database()")
        .fetch_one(&mut *conn)
        .await
        .map_err(|_| RestoreProofError::AdminConnectFailed)?;
    if current != REQUIRED_MAINTENANCE_DATABASE {
        return Err(RestoreProofError::WrongMaintenanceDatabase);
    }
    Ok(())
}

/// `CREATE DATABASE <name>`, executed as a single statement outside any
/// transaction (a bare `.execute()` call on a connection sqlx never wraps
/// in an implicit transaction — `CREATE DATABASE` cannot run inside one).
/// `name` is validated against [`TEMP_DB_PREFIX`] immediately before use.
#[cfg_attr(not(windows), allow(dead_code))] // only the Windows live proof calls this
pub(crate) async fn create_database(
    conn: &mut PgConnection,
    name: &str,
) -> Result<(), RestoreProofError> {
    validate_generated_database_name(name)?;
    let sql = format!("CREATE DATABASE {}", quote_identifier(name));
    sqlx::query(&sql)
        .execute(&mut *conn)
        .await
        .map_err(|_| RestoreProofError::DatabaseCreateFailed)?;
    Ok(())
}

/// `DROP DATABASE IF EXISTS <name> WITH (FORCE)`, executed outside any
/// transaction. `WITH (FORCE)` (PostgreSQL 13+) terminates any other
/// connections to the database as part of the drop itself, so a separate
/// manual `pg_terminate_backend` pass is unnecessary in the common case —
/// this is the "only when necessary" default. `name` is validated against
/// [`TEMP_DB_PREFIX`] immediately before use, on every call, regardless of
/// whether the caller already validated it earlier.
#[cfg_attr(not(windows), allow(dead_code))] // only the Windows live proof calls this
pub(crate) async fn drop_database_with_force(
    conn: &mut PgConnection,
    name: &str,
) -> Result<(), RestoreProofError> {
    validate_generated_database_name(name)?;
    let sql = format!(
        "DROP DATABASE IF EXISTS {} WITH (FORCE)",
        quote_identifier(name)
    );
    sqlx::query(&sql)
        .execute(&mut *conn)
        .await
        .map_err(|_| RestoreProofError::DatabaseDropFailed)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// pg_restore discovery, version validation, and invocation
// ---------------------------------------------------------------------------

/// Resolve `pg_restore`: `STOCKIHA_PG_RESTORE_PATH` if set and non-empty,
/// otherwise the bare name `pg_restore` (PATH resolution).
#[cfg_attr(not(windows), allow(dead_code))] // only the Windows live proof calls this
pub(crate) fn resolve_pg_restore_executable() -> PathBuf {
    match std::env::var_os("STOCKIHA_PG_RESTORE_PATH") {
        Some(path) if !path.is_empty() => PathBuf::from(path),
        _ => PathBuf::from("pg_restore"),
    }
}

/// Run `pg_restore --version` and require [`REQUIRED_PG_MAJOR_VERSION`].
/// `pg_restore --version` reports the same `"<tool> (PostgreSQL) X.Y"` shape
/// `pg_dump --version` does, so the parser is reused directly from
/// `backup_proof` rather than reimplemented.
pub(crate) fn discover_and_validate_pg_restore(
    executable: &Path,
) -> Result<String, RestoreProofError> {
    let output = Command::new(executable)
        .arg("--version")
        .stdin(Stdio::null())
        .output()
        .map_err(|_| RestoreProofError::PgRestoreNotFound)?;
    if !output.status.success() {
        return Err(RestoreProofError::PgRestoreNotFound);
    }
    let version_string = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let major = parse_pg_dump_major_version(&version_string)
        .map_err(|_| RestoreProofError::PgRestoreVersionParseFailed)?;
    if major != REQUIRED_PG_MAJOR_VERSION {
        return Err(RestoreProofError::PgRestoreVersionMismatch(major));
    }
    Ok(version_string)
}

/// Connection target for `pg_restore`. Never carries a password.
pub(crate) struct PgRestoreTarget<'a> {
    pub(crate) host: &'a str,
    pub(crate) port: u16,
    pub(crate) database: &'a str,
}

/// A running `pg_restore` child that is killed and waited-for on drop,
/// regardless of whether the primary path already waited — the exact
/// pattern S0-009 uses for `pg_dump`, reimplemented locally here rather than
/// exposed from `backup_proof` (a generic process-cleanup helper is not
/// bundle-validation domain logic, so it is not part of the "do not
/// duplicate" list).
struct ChildGuard(Child);

impl Drop for ChildGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

/// Restore `dump_path` into `target` via `pg_restore --exit-on-error
/// --single-transaction --no-owner --no-privileges`. `username` and
/// `password` authenticate the fixed admin identity used to create
/// `target.database` — never a Stockiha app role. The password is placed
/// **only** in this child's environment; host/port/username are ordinary
/// (non-secret) arguments.
pub(crate) fn run_pg_restore(
    executable: &Path,
    target: &PgRestoreTarget<'_>,
    username: &str,
    password: &str,
    dump_path: &Path,
) -> Result<(), RestoreProofError> {
    let mut command = Command::new(executable);
    command
        .arg("--exit-on-error")
        .arg("--single-transaction")
        .arg("--no-owner")
        .arg("--no-privileges")
        .arg("--host")
        .arg(target.host)
        .arg("--port")
        .arg(target.port.to_string())
        .arg("--username")
        .arg(username)
        .arg("--dbname")
        .arg(target.database)
        .arg(dump_path)
        .env("PGPASSWORD", password)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let child = command
        .spawn()
        .map_err(|_| RestoreProofError::PgRestoreNotFound)?;
    let mut guard = ChildGuard(child);
    let status = guard.0.wait().map_err(|_| RestoreProofError::Io)?;
    if !status.success() {
        return Err(RestoreProofError::PgRestoreFailed(status.code()));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Reconciliation (deterministic fixture; no business ledger exists yet)
// ---------------------------------------------------------------------------

/// A deterministic digest of the fixture table's contents: row count plus a
/// SHA-256 of the canonically ordered, canonically formatted rows.
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct FixtureDigest {
    pub(crate) row_count: i64,
    pub(crate) sha256: String,
}

/// Create the fixed fixture table and insert deterministic rows, using
/// fixed literal SQL — no dynamic string construction, matching S0-004's
/// "zero dynamic string construction for role names" discipline applied
/// here to the fixture schema.
#[cfg_attr(not(windows), allow(dead_code))] // only the Windows live proof calls this
pub(crate) async fn seed_fixture(conn: &mut PgConnection) -> Result<(), RestoreProofError> {
    sqlx::query(&format!(
        "CREATE TABLE {FIXTURE_TABLE} (id INTEGER PRIMARY KEY, label TEXT NOT NULL, amount BIGINT NOT NULL)"
    ))
    .execute(&mut *conn)
    .await
    .map_err(|_| RestoreProofError::ReconciliationQueryFailed)?;

    sqlx::query(&format!(
        "INSERT INTO {FIXTURE_TABLE} (id, label, amount) VALUES \
         (1, 'stockiha-restore-proof-alpha', 1000), \
         (2, 'stockiha-restore-proof-beta', 2500), \
         (3, 'stockiha-restore-proof-gamma', 42)"
    ))
    .execute(&mut *conn)
    .await
    .map_err(|_| RestoreProofError::ReconciliationQueryFailed)?;

    Ok(())
}

/// Compute a [`FixtureDigest`] for the fixture table: canonical order
/// (`ORDER BY id`), canonical formatting (`id:label:amount` per row, joined
/// with `\n`), hashed with SHA-256.
#[cfg_attr(not(windows), allow(dead_code))] // only the Windows live proof calls this
pub(crate) async fn compute_fixture_digest(
    conn: &mut PgConnection,
) -> Result<FixtureDigest, RestoreProofError> {
    let rows: Vec<(i32, String, i64)> = sqlx::query_as(&format!(
        "SELECT id, label, amount FROM {FIXTURE_TABLE} ORDER BY id"
    ))
    .fetch_all(&mut *conn)
    .await
    .map_err(|_| RestoreProofError::ReconciliationQueryFailed)?;

    let row_count = rows.len() as i64;
    let canonical = rows
        .iter()
        .map(|(id, label, amount)| format!("{id}:{label}:{amount}"))
        .collect::<Vec<_>>()
        .join("\n");

    use sha2::{Digest, Sha256};
    let hash = Sha256::digest(canonical.as_bytes());
    let sha256 = hash.iter().map(|b| format!("{b:02x}")).collect::<String>();

    Ok(FixtureDigest { row_count, sha256 })
}

/// Pure comparison: source and restored digests must match exactly (row
/// count and SHA-256 both). No database access — fully unit-testable.
pub(crate) fn compare_fixture_digests(
    source: &FixtureDigest,
    restored: &FixtureDigest,
) -> Result<ReconciliationReport, RestoreProofError> {
    if source.row_count != restored.row_count || source.sha256 != restored.sha256 {
        return Err(RestoreProofError::ReconciliationMismatch);
    }
    Ok(ReconciliationReport {
        row_count: source.row_count,
        sha256: source.sha256.clone(),
    })
}

/// The result of a successful reconciliation: what matched.
pub(crate) struct ReconciliationReport {
    pub(crate) row_count: i64,
    pub(crate) sha256: String,
}

// ---------------------------------------------------------------------------
// Cleanup obligation (passive record only — Drop cannot run async code, and
// must not pretend it can)
// ---------------------------------------------------------------------------

/// A passive record that a temporary database exists and must eventually be
/// dropped. This is **not** an async-cleanup guard: `Drop` is synchronous,
/// so it cannot issue a `DROP DATABASE` itself. Callers must call
/// [`TempDbObligation::mark_cleaned`] once the explicit async cleanup path
/// (below) has actually dropped the database. If a value is dropped while
/// still unmarked, that indicates a bug in the call site — not a condition
/// this type can or does repair.
pub(crate) struct TempDbObligation {
    name: String,
    cleaned: bool,
}

impl TempDbObligation {
    pub(crate) fn new(name: String) -> Self {
        TempDbObligation {
            name,
            cleaned: false,
        }
    }

    pub(crate) fn name(&self) -> &str {
        &self.name
    }

    pub(crate) fn mark_cleaned(&mut self) {
        self.cleaned = true;
    }
}

impl Drop for TempDbObligation {
    fn drop(&mut self) {
        if !self.cleaned {
            // Deliberately not a safety net. This only ever fires if an
            // explicit async cleanup call was skipped at the call site;
            // fix the call site, do not rely on this message or on Drop.
            #[cfg(debug_assertions)]
            eprintln!(
                "stockiha restore-proof: temporary database '{}' was not explicitly cleaned up (Drop cannot run async cleanup)",
                self.name
            );
        }
    }
}

// ---------------------------------------------------------------------------
// WS-H-2: Drop-enforced cleanup, and the startup sweep behind it
// ---------------------------------------------------------------------------

/// Open a fresh maintenance connection and drop `name`.
///
/// Deliberately takes `PgConnectOptions` rather than an existing
/// `&mut PgConnection`: the reason the operator found two orphaned 15 MB
/// databases is that the drill's cleanup reused the *same* maintenance
/// connection the drill ran on, and a PostgreSQL backend crash
/// (`terminating connection because of crash of another server process`)
/// killed that connection before the drop could be issued. A connection that
/// has just died cannot clean up after itself; only a new one can.
async fn drop_temp_database_on_new_connection(
    maintenance: &PgConnectOptions,
    name: &str,
) -> Result<(), RestoreProofError> {
    validate_generated_database_name(name)?;
    let mut conn = PgConnection::connect_with(maintenance)
        .await
        .map_err(|_| RestoreProofError::AdminConnectFailed)?;
    let result = drop_database_with_force(&mut conn, name).await;
    let _ = conn.close().await;
    result
}

/// A temporary restore database whose `DROP` the compiler enforces.
///
/// Unlike [`TempDbObligation`] — which is only a passive record and says so —
/// this guard actually removes the database on every unwind path: an early
/// `return`/`?`, a validation failure, or a panic. `Drop` is synchronous and
/// still cannot `.await`, so it does not pretend to: it hands a detached task
/// to the ambient Tokio runtime, which opens its own connection (see
/// [`drop_temp_database_on_new_connection`]) and issues the drop.
///
/// This closes every path except one: a hard process kill, where no in-process
/// code runs at all. [`sweep_orphaned_temp_databases`] is the backstop for
/// that, and is why the sweep exists in addition to this guard rather than
/// instead of it.
///
/// Never derives `Debug`: it holds `PgConnectOptions`, whose own derived
/// `Debug` prints the password unredacted (see this module's header).
pub(crate) struct TempDbGuard {
    name: String,
    maintenance: PgConnectOptions,
    cleaned: bool,
}

impl TempDbGuard {
    /// Construct **immediately** after `CREATE DATABASE` returns `Ok`, so no
    /// `?` between creation and the guard can strand the database.
    pub(crate) fn new(name: String, maintenance: PgConnectOptions) -> Self {
        TempDbGuard {
            name,
            maintenance,
            cleaned: false,
        }
    }

    pub(crate) fn name(&self) -> &str {
        &self.name
    }

    /// Record that the explicit async cleanup already dropped this database,
    /// so `Drop` does not schedule a redundant second attempt. The drop is
    /// `IF EXISTS`, so a duplicate would be harmless — this just keeps the
    /// logs honest about which path did the work.
    pub(crate) fn mark_cleaned(&mut self) {
        self.cleaned = true;
    }
}

impl Drop for TempDbGuard {
    fn drop(&mut self) {
        if self.cleaned {
            return;
        }
        let name = self.name.clone();
        let maintenance = self.maintenance.clone();

        // `Handle::try_current` rather than an unconditional spawn: unit
        // tests construct guards with no ambient runtime, and a bare
        // `spawn` would panic inside `Drop` there.
        match tokio::runtime::Handle::try_current() {
            Ok(handle) => {
                handle.spawn(async move {
                    match drop_temp_database_on_new_connection(&maintenance, &name).await {
                        Ok(()) => tracing::warn!(
                            "restore drill: temporary database {name} was dropped by the cleanup \
                             guard after an early exit"
                        ),
                        Err(_) => {
                            tracing::error!(
                                "restore drill: temporary database {name} could NOT be dropped; \
                                 it will be swept at the next application start"
                            );
                            eprintln!(
                                "[RESTORE_CLEANUP] temporary database {name} could not be dropped; \
                                 it will be swept at the next application start"
                            );
                        }
                    }
                });
            }
            Err(_) => {
                eprintln!(
                    "[RESTORE_CLEANUP] temporary database {name} left behind (no async runtime \
                     available to drop it); it will be swept at the next application start"
                );
            }
        }
    }
}

/// Drop every leftover `stockiha_restore_proof_*` database, returning the
/// names actually removed.
///
/// The safety net for the one case no in-process guard can cover: the process
/// or the PostgreSQL backend dying outright, which is exactly what stranded
/// the two 15 MB duplicates the operator found with `\l`. Runs at application
/// start, when no drill of this process can legitimately be in flight.
///
/// Matching uses `left(datname, length($1)) = $1` rather than `LIKE`: the
/// prefix contains `_`, which `LIKE` treats as a single-character wildcard,
/// so a `LIKE` pattern would match strictly more databases than intended.
/// Every candidate is then re-checked through
/// [`validate_generated_database_name`] before any `DROP` is built — a name
/// that somehow fails is left untouched and reported, never dropped.
pub(crate) async fn sweep_orphaned_temp_databases(
    maintenance: &PgConnectOptions,
) -> Result<Vec<String>, RestoreProofError> {
    let mut conn = PgConnection::connect_with(maintenance)
        .await
        .map_err(|_| RestoreProofError::AdminConnectFailed)?;

    let candidates: Vec<String> = sqlx::query_scalar::<_, String>(
        "SELECT datname FROM pg_database \
         WHERE left(datname, length($1)) = $1 \
         ORDER BY datname",
    )
    .bind(TEMP_DB_PREFIX)
    .fetch_all(&mut conn)
    .await
    .map_err(|_| RestoreProofError::AdminConnectFailed)?;

    let mut dropped = Vec::new();
    for name in candidates {
        if validate_generated_database_name(&name).is_err() {
            tracing::error!(
                "restore drill sweep: refusing to drop '{name}' — it carries the temporary \
                 prefix but is not a well-formed generated name"
            );
            continue;
        }
        match drop_database_with_force(&mut conn, &name).await {
            Ok(()) => dropped.push(name),
            Err(_) => tracing::error!("restore drill sweep: could not drop leftover '{name}'"),
        }
    }

    let _ = conn.close().await;
    Ok(dropped)
}

// ---------------------------------------------------------------------------
// Orchestration: create the restore-target database, restore into it,
// reconcile, then always drop both proof databases
// ---------------------------------------------------------------------------

/// Runs the restore-and-reconcile phase and always drops both proof
/// databases before returning, on every path.
///
/// Cleanup semantics (exact):
/// - Cleanup (`drop_source_db` then `drop_restore_db`) always runs, exactly
///   once each, regardless of where a failure occurred.
/// - If `restore` or `reconcile` fails, that **original** error is
///   returned; any cleanup-step outcome is discarded (never substituted).
/// - If everything up to and including `reconcile` succeeds, a cleanup
///   failure **is** the reportable error — there is no earlier failure for
///   it to protect (the same rule S0-008/S0-009 apply to their own
///   success-path final steps).
/// - `create_restore_db` creating the target database is included in the
///   same all-paths-cleanup discipline: even a failure at this step still
///   attempts to drop both databases (idempotent — `DROP DATABASE IF
///   EXISTS` — so this is always safe).
pub(crate) async fn run_restore_and_reconcile<
    CreateRestore,
    FutCR,
    DropSource,
    FutDS,
    DropRestore,
    FutDR,
    Restore,
    FutR,
    Reconcile,
    FutRec,
>(
    mut create_restore_db: CreateRestore,
    mut drop_source_db: DropSource,
    mut drop_restore_db: DropRestore,
    mut restore: Restore,
    mut reconcile: Reconcile,
) -> Result<ReconciliationReport, RestoreProofError>
where
    CreateRestore: FnMut() -> FutCR,
    FutCR: Future<Output = Result<(), RestoreProofError>>,
    DropSource: FnMut() -> FutDS,
    FutDS: Future<Output = Result<(), RestoreProofError>>,
    DropRestore: FnMut() -> FutDR,
    FutDR: Future<Output = Result<(), RestoreProofError>>,
    Restore: FnMut() -> FutR,
    FutR: Future<Output = Result<(), RestoreProofError>>,
    Reconcile: FnMut() -> FutRec,
    FutRec: Future<Output = Result<ReconciliationReport, RestoreProofError>>,
{
    async fn cleanup_both<DropSource, FutDS, DropRestore, FutDR>(
        drop_source_db: &mut DropSource,
        drop_restore_db: &mut DropRestore,
    ) -> Result<(), RestoreProofError>
    where
        DropSource: FnMut() -> FutDS,
        FutDS: Future<Output = Result<(), RestoreProofError>>,
        DropRestore: FnMut() -> FutDR,
        FutDR: Future<Output = Result<(), RestoreProofError>>,
    {
        // Both are always attempted, regardless of the other's outcome.
        let source_result = drop_source_db().await;
        let restore_result = drop_restore_db().await;
        source_result.and(restore_result)
    }

    if let Err(original) = create_restore_db().await {
        let _ = cleanup_both(&mut drop_source_db, &mut drop_restore_db).await;
        return Err(original);
    }

    if let Err(original) = restore().await {
        let _ = cleanup_both(&mut drop_source_db, &mut drop_restore_db).await;
        return Err(original);
    }

    match reconcile().await {
        Ok(report) => {
            // Success path: a cleanup failure here has no earlier error to
            // protect, so it IS the reportable error.
            cleanup_both(&mut drop_source_db, &mut drop_restore_db).await?;
            Ok(report)
        }
        Err(original) => {
            let _ = cleanup_both(&mut drop_source_db, &mut drop_restore_db).await;
            Err(original)
        }
    }
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::fs;
    use std::rc::Rc;

    // ---- shared S0-009 bundle validation (via preflight_bundle) -------------

    fn scratch_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "stockiha-restore-proof-test-{tag}-{}",
            generate_temp_db_name("scratch")
        ));
        fs::create_dir_all(&dir).expect("scratch dir must be creatable");
        dir
    }

    #[test]
    fn preflight_bundle_accepts_a_real_bundle_built_by_backup_proof() {
        let root = scratch_dir("preflight-ok");
        let bundle = super::super::backup_proof::create_backup_bundle(
            &root,
            time::OffsetDateTime::from_unix_timestamp(1_784_800_000).unwrap(),
            "pg_dump (PostgreSQL) 18.1",
            &super::super::backup_proof::BackupInputs::empty(),
            |path| fs::write(path, b"restore-proof fixture dump").map_err(|_| BackupProofError::Io),
        )
        .expect("backup_proof must build a fixture bundle");

        let validated = preflight_bundle(&bundle).expect("a real bundle must pass preflight");
        assert_eq!(validated.postgres_major_version, 18);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn preflight_bundle_rejects_a_tampered_bundle_through_the_same_wrapper() {
        let root = scratch_dir("preflight-tampered");
        let bundle = super::super::backup_proof::create_backup_bundle(
            &root,
            time::OffsetDateTime::from_unix_timestamp(1_784_800_100).unwrap(),
            "pg_dump (PostgreSQL) 18.1",
            &super::super::backup_proof::BackupInputs::empty(),
            |path| fs::write(path, b"original bytes").map_err(|_| BackupProofError::Io),
        )
        .expect("backup_proof must build a fixture bundle");

        // Tamper with the dump without touching the manifest/checksums —
        // preflight_bundle must reject this via the same code path
        // backup_proof's own tests exercise, proving the wrapper adds no
        // separate (and therefore possibly inconsistent) validation logic.
        fs::write(bundle.join("database.dump"), b"tampered bytes").unwrap();

        // `ValidatedBundle` deliberately has no `Debug` impl, so
        // `expect_err`/`unwrap_err` (which require `Ok`'s type to implement
        // `Debug`) cannot be used here — match explicitly instead.
        let err = match preflight_bundle(&bundle) {
            Err(err) => err,
            Ok(_) => panic!("a tampered bundle must be rejected"),
        };
        assert!(matches!(err, RestoreProofError::BundleInvalid(_)));
        assert_eq!(format!("{err}"), "RESTORE_PROOF_BUNDLE_INVALID");

        let _ = fs::remove_dir_all(&root);
    }

    // ---- generated database-name validation --------------------------------

    #[test]
    fn accepts_a_well_formed_generated_name() {
        let name = generate_temp_db_name("source");
        assert!(validate_generated_database_name(&name).is_ok());
        assert!(name.starts_with(TEMP_DB_PREFIX));
    }

    #[test]
    fn rejects_a_name_without_the_prefix() {
        assert!(matches!(
            validate_generated_database_name("stockiha_production"),
            Err(RestoreProofError::UnsafeGeneratedDatabaseName)
        ));
    }

    #[test]
    fn rejects_a_name_with_uppercase_or_symbol_characters() {
        assert!(matches!(
            validate_generated_database_name("stockiha_restore_proof_Source"),
            Err(RestoreProofError::UnsafeGeneratedDatabaseName)
        ));
        assert!(matches!(
            validate_generated_database_name("stockiha_restore_proof_source; DROP TABLE x"),
            Err(RestoreProofError::UnsafeGeneratedDatabaseName)
        ));
    }

    #[test]
    fn two_generated_names_are_distinct() {
        let a = generate_temp_db_name("source");
        let b = generate_temp_db_name("source");
        assert_ne!(a, b);
    }

    // ---- identifier quoting --------------------------------------------------

    #[test]
    fn quotes_a_plain_identifier() {
        assert_eq!(
            quote_identifier("stockiha_restore_proof_source_1"),
            "\"stockiha_restore_proof_source_1\""
        );
    }

    #[test]
    fn doubles_an_embedded_double_quote() {
        // Never reachable through validate_generated_database_name (which
        // would reject the `"` character first), but the quoting function
        // itself must still be correct in isolation — this is what makes it
        // safe to keep as a distinct, independently-verified layer.
        assert_eq!(quote_identifier("a\"b"), "\"a\"\"b\"");
    }

    // ---- destructive prefix guard -------------------------------------------

    #[test]
    fn create_and_drop_reject_names_without_the_prefix_before_any_query_is_built() {
        // These calls never reach a real connection (validation happens
        // first), so this is testable without PostgreSQL.
        assert!(matches!(
            validate_generated_database_name("postgres"),
            Err(RestoreProofError::UnsafeGeneratedDatabaseName)
        ));
        assert!(matches!(
            validate_generated_database_name(""),
            Err(RestoreProofError::UnsafeGeneratedDatabaseName)
        ));
    }

    // ---- admin URL parsing / maintenance-database enforcement ---------------

    #[test]
    fn parses_a_well_formed_admin_url() {
        let parsed = parse_admin_url("postgres://admin:s3cret@localhost:5432/postgres")
            .expect("well-formed admin URL must parse");
        assert_eq!(parsed.host, "localhost");
        assert_eq!(parsed.port, 5432);
        assert_eq!(parsed.username, "admin");
        assert_eq!(parsed.password, "s3cret");
        assert_eq!(parsed.database, "postgres");
    }

    #[test]
    fn defaults_the_port_when_omitted() {
        let parsed = parse_admin_url("postgres://admin:pw@localhost/postgres").unwrap();
        assert_eq!(parsed.port, 5432);
    }

    #[test]
    fn percent_decodes_a_password_containing_reserved_characters() {
        // "%40" -> "@"
        let parsed = parse_admin_url("postgres://admin:pa%40ss@localhost/postgres").unwrap();
        assert_eq!(parsed.password, "pa@ss");
    }

    #[test]
    fn maintenance_database_must_equal_postgres() {
        assert!(matches!(
            parse_admin_url("postgres://admin:pw@localhost/some_other_db"),
            Err(RestoreProofError::AdminUrlInvalid)
        ));
        assert!(parse_admin_url("postgres://admin:pw@localhost/postgres").is_ok());
    }

    #[test]
    fn rejects_malformed_admin_urls() {
        assert!(matches!(
            parse_admin_url("not-a-url"),
            Err(RestoreProofError::AdminUrlInvalid)
        ));
        assert!(matches!(
            parse_admin_url("postgres://localhost/postgres"), // missing userinfo
            Err(RestoreProofError::AdminUrlInvalid)
        ));
        assert!(matches!(
            parse_admin_url("postgres://admin:pw@localhost"), // missing database
            Err(RestoreProofError::AdminUrlInvalid)
        ));
    }

    // ---- password and URL redaction -----------------------------------------

    #[test]
    fn errors_never_render_dynamic_content() {
        let variants: Vec<RestoreProofError> = vec![
            RestoreProofError::AdminUrlMissing,
            RestoreProofError::AdminUrlInvalid,
            RestoreProofError::WrongMaintenanceDatabase,
            RestoreProofError::UnsafeGeneratedDatabaseName,
            RestoreProofError::DatabaseCreateFailed,
            RestoreProofError::DatabaseDropFailed,
            RestoreProofError::AdminConnectFailed,
            RestoreProofError::BundleInvalid(BackupProofErrorSummary("safe-detail".to_string())),
            RestoreProofError::PgRestoreNotFound,
            RestoreProofError::PgRestoreVersionParseFailed,
            RestoreProofError::PgRestoreVersionMismatch(17),
            RestoreProofError::PgRestoreFailed(Some(1)),
            RestoreProofError::ReconciliationQueryFailed,
            RestoreProofError::ReconciliationMismatch,
            RestoreProofError::Io,
        ];
        for e in &variants {
            let displayed = format!("{e}");
            let debugged = format!("{e:?}");
            assert!(displayed.starts_with("RESTORE_PROOF_"));
            assert!(debugged.starts_with("RestoreProofError(RESTORE_PROOF_"));
            assert!(!displayed.contains("safe-detail"));
            assert!(!debugged.contains("safe-detail"));
            assert!(!e.diagnostic().is_empty());
        }
    }

    #[test]
    fn a_password_fed_into_parse_admin_url_never_reaches_any_error_text() {
        const SENTINEL: &str = "SUPER-SECRET-SENTINEL";
        let url = format!("postgres://admin:{SENTINEL}@localhost/postgres");
        let parsed = parse_admin_url(&url).expect("must parse");
        assert_eq!(parsed.password, SENTINEL);
        // Rejecting a *different* malformed URL must not somehow echo a
        // password from elsewhere; and there is no Debug/Display impl on
        // ParsedAdminUrl at all (enforced at compile time — `{:?}` on
        // `parsed` would not compile), so the only way this sentinel could
        // ever surface is through an error message, which it does not.
        // `ParsedAdminUrl` deliberately has no `Debug` impl either, so
        // `unwrap_err` cannot be used here for the same reason as above.
        let err = match parse_admin_url("postgres://localhost/postgres") {
            Err(err) => err,
            Ok(_) => panic!("this URL is missing userinfo and must not parse"),
        };
        assert!(!format!("{err}").contains(SENTINEL));
        assert!(!format!("{err:?}").contains(SENTINEL));
    }

    // ---- pg_restore version parsing (reused parser) --------------------------

    #[test]
    #[cfg(unix)]
    fn discover_and_validate_pg_restore_accepts_major_18_fake_executable() {
        let dir = std::env::temp_dir().join(format!(
            "stockiha-restore-proof-test-fake-version-{}",
            generate_temp_db_name("scratch")
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let script_path = dir.join("pg_restore");
        std::fs::write(
            &script_path,
            "#!/bin/sh\necho 'pg_restore (PostgreSQL) 18.2'\nexit 0\n",
        )
        .unwrap();
        set_executable(&script_path);

        let version = discover_and_validate_pg_restore(&script_path).expect("major 18 must pass");
        assert_eq!(version, "pg_restore (PostgreSQL) 18.2");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    fn set_executable(path: &Path) {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(path).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(path, perms).unwrap();
    }

    // ---- fake pg_restore argv and environment ---------------------------------

    #[test]
    #[cfg(unix)]
    fn run_pg_restore_passes_expected_flags_and_child_only_password() {
        let dir = std::env::temp_dir().join(format!(
            "stockiha-restore-proof-test-fake-restore-{}",
            generate_temp_db_name("scratch")
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let marker = dir.join("argv.txt");
        let password_marker = dir.join("password_seen.txt");
        let script_path = dir.join("pg_restore");
        let script = format!(
            r#"#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "pg_restore (PostgreSQL) 18.0"
  exit 0
fi
echo "$@" > "{argv}"
if [ -n "${{PGPASSWORD+x}}" ]; then
  echo "SET" > "{pw}"
else
  echo "UNSET" > "{pw}"
fi
exit "${{STOCKIHA_FAKE_PG_RESTORE_EXIT_CODE:-0}}"
"#,
            argv = marker.display(),
            pw = password_marker.display()
        );
        std::fs::write(&script_path, script).unwrap();
        set_executable(&script_path);

        let dump_path = dir.join("database.dump");
        std::fs::write(&dump_path, b"fake dump bytes").unwrap();

        let target = PgRestoreTarget {
            host: "localhost",
            port: 5432,
            database: "stockiha_restore_proof_restore_1",
        };
        run_pg_restore(&script_path, &target, "admin", "test-password", &dump_path)
            .expect("fake pg_restore run must succeed");

        let argv_line = std::fs::read_to_string(&marker).unwrap();
        assert!(argv_line.contains("--exit-on-error"));
        assert!(argv_line.contains("--single-transaction"));
        assert!(argv_line.contains("--no-owner"));
        assert!(argv_line.contains("--no-privileges"));
        assert!(argv_line.contains("--host"));
        assert!(argv_line.contains("localhost"));
        assert!(argv_line.contains("--username"));
        assert!(argv_line.contains("admin"));
        assert!(argv_line.contains("--dbname"));
        assert!(argv_line.contains("stockiha_restore_proof_restore_1"));
        assert!(
            !argv_line.contains("test-password"),
            "the password must never appear in argv"
        );

        assert_eq!(
            std::fs::read_to_string(&password_marker).unwrap().trim(),
            "SET"
        );
        assert!(
            std::env::var("PGPASSWORD").is_err(),
            "PGPASSWORD must only affect the child"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    #[cfg(unix)]
    fn run_pg_restore_maps_nonzero_exit_to_pg_restore_failed() {
        let dir = std::env::temp_dir().join(format!(
            "stockiha-restore-proof-test-fake-restore-fail-{}",
            generate_temp_db_name("scratch")
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let script_path = dir.join("pg_restore");
        std::fs::write(
            &script_path,
            "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 'pg_restore (PostgreSQL) 18.0'; exit 0; fi\nexit 2\n",
        )
        .unwrap();
        set_executable(&script_path);
        let dump_path = dir.join("database.dump");
        std::fs::write(&dump_path, b"x").unwrap();

        let target = PgRestoreTarget {
            host: "localhost",
            port: 5432,
            database: "stockiha_restore_proof_restore_2",
        };
        let result = run_pg_restore(&script_path, &target, "admin", "pw", &dump_path);
        assert!(matches!(
            result,
            Err(RestoreProofError::PgRestoreFailed(Some(2)))
        ));

        let _ = std::fs::remove_dir_all(&dir);
    }

    // ---- reconciliation: pure comparison, no database needed ----------------

    #[test]
    fn compare_fixture_digests_accepts_matching_digests() {
        let a = FixtureDigest {
            row_count: 3,
            sha256: "abc".to_string(),
        };
        let b = a.clone();
        let report = compare_fixture_digests(&a, &b).expect("identical digests must match");
        assert_eq!(report.row_count, 3);
        assert_eq!(report.sha256, "abc");
    }

    #[test]
    fn compare_fixture_digests_rejects_a_row_count_mismatch() {
        let a = FixtureDigest {
            row_count: 3,
            sha256: "abc".to_string(),
        };
        let b = FixtureDigest {
            row_count: 2,
            sha256: "abc".to_string(),
        };
        assert!(matches!(
            compare_fixture_digests(&a, &b),
            Err(RestoreProofError::ReconciliationMismatch)
        ));
    }

    #[test]
    fn compare_fixture_digests_rejects_a_hash_mismatch() {
        let a = FixtureDigest {
            row_count: 3,
            sha256: "abc".to_string(),
        };
        let b = FixtureDigest {
            row_count: 3,
            sha256: "different".to_string(),
        };
        assert!(matches!(
            compare_fixture_digests(&a, &b),
            Err(RestoreProofError::ReconciliationMismatch)
        ));
    }

    // ---- orchestration cleanup semantics (fake async closures, no DB) -------

    #[derive(Default, Clone)]
    struct CallLog {
        create_restore: Rc<RefCell<u32>>,
        drop_source: Rc<RefCell<u32>>,
        drop_restore: Rc<RefCell<u32>>,
        restore: Rc<RefCell<u32>>,
        reconcile: Rc<RefCell<u32>>,
    }

    fn ok_report() -> ReconciliationReport {
        ReconciliationReport {
            row_count: 3,
            sha256: "abc".to_string(),
        }
    }

    #[tokio::test]
    async fn explicit_cleanup_runs_on_success_and_reports_a_sole_cleanup_failure() {
        let log = CallLog::default();
        let l = log.clone();
        let result = run_restore_and_reconcile(
            || {
                *l.create_restore.borrow_mut() += 1;
                async { Ok(()) }
            },
            {
                let l = log.clone();
                move || {
                    *l.drop_source.borrow_mut() += 1;
                    async { Ok(()) }
                }
            },
            {
                let l = log.clone();
                move || {
                    *l.drop_restore.borrow_mut() += 1;
                    // The drop_restore step fails; since everything else
                    // succeeded, this is the sole failure and must surface.
                    async { Err(RestoreProofError::DatabaseDropFailed) }
                }
            },
            {
                let l = log.clone();
                move || {
                    *l.restore.borrow_mut() += 1;
                    async { Ok(()) }
                }
            },
            {
                let l = log.clone();
                move || {
                    *l.reconcile.borrow_mut() += 1;
                    async { Ok(ok_report()) }
                }
            },
        )
        .await;

        assert!(matches!(result, Err(RestoreProofError::DatabaseDropFailed)));
        assert_eq!(*log.create_restore.borrow(), 1);
        assert_eq!(*log.restore.borrow(), 1);
        assert_eq!(*log.reconcile.borrow(), 1);
        assert_eq!(
            *log.drop_source.borrow(),
            1,
            "both drops must still be attempted"
        );
        assert_eq!(*log.drop_restore.borrow(), 1);
    }

    #[tokio::test]
    async fn explicit_cleanup_runs_and_succeeds_on_the_full_success_path() {
        let log = CallLog::default();
        let result = run_restore_and_reconcile(
            {
                let l = log.clone();
                move || {
                    *l.create_restore.borrow_mut() += 1;
                    async { Ok(()) }
                }
            },
            {
                let l = log.clone();
                move || {
                    *l.drop_source.borrow_mut() += 1;
                    async { Ok(()) }
                }
            },
            {
                let l = log.clone();
                move || {
                    *l.drop_restore.borrow_mut() += 1;
                    async { Ok(()) }
                }
            },
            {
                let l = log.clone();
                move || {
                    *l.restore.borrow_mut() += 1;
                    async { Ok(()) }
                }
            },
            {
                let l = log.clone();
                move || {
                    *l.reconcile.borrow_mut() += 1;
                    async { Ok(ok_report()) }
                }
            },
        )
        .await;

        let report = result.expect("full success path must succeed");
        assert_eq!(report.row_count, 3);
        assert_eq!(*log.drop_source.borrow(), 1);
        assert_eq!(*log.drop_restore.borrow(), 1);
    }

    #[tokio::test]
    async fn cleanup_runs_after_a_restore_failure_and_the_original_error_is_preserved() {
        let log = CallLog::default();
        let result = run_restore_and_reconcile(
            {
                let l = log.clone();
                move || {
                    *l.create_restore.borrow_mut() += 1;
                    async { Ok(()) }
                }
            },
            {
                let l = log.clone();
                move || {
                    *l.drop_source.borrow_mut() += 1;
                    async { Ok(()) }
                }
            },
            {
                let l = log.clone();
                move || {
                    *l.drop_restore.borrow_mut() += 1;
                    async { Ok(()) }
                }
            },
            {
                let l = log.clone();
                move || {
                    *l.restore.borrow_mut() += 1;
                    async { Err(RestoreProofError::PgRestoreFailed(Some(1))) }
                }
            },
            {
                let l = log.clone();
                move || {
                    *l.reconcile.borrow_mut() += 1;
                    async { Ok(ok_report()) }
                }
            },
        )
        .await;

        assert!(matches!(
            result,
            Err(RestoreProofError::PgRestoreFailed(Some(1)))
        ));
        assert_eq!(
            *log.reconcile.borrow(),
            0,
            "reconcile must never run after a restore failure"
        );
        assert_eq!(*log.drop_source.borrow(), 1, "cleanup must still run");
        assert_eq!(*log.drop_restore.borrow(), 1);
    }

    #[tokio::test]
    async fn cleanup_runs_after_a_reconciliation_failure_and_the_original_error_is_preserved() {
        let log = CallLog::default();
        let result = run_restore_and_reconcile(
            {
                let l = log.clone();
                move || {
                    *l.create_restore.borrow_mut() += 1;
                    async { Ok(()) }
                }
            },
            {
                let l = log.clone();
                move || {
                    *l.drop_source.borrow_mut() += 1;
                    async { Ok(()) }
                }
            },
            {
                let l = log.clone();
                move || {
                    *l.drop_restore.borrow_mut() += 1;
                    async { Ok(()) }
                }
            },
            {
                let l = log.clone();
                move || {
                    *l.restore.borrow_mut() += 1;
                    async { Ok(()) }
                }
            },
            {
                let l = log.clone();
                move || {
                    *l.reconcile.borrow_mut() += 1;
                    async { Err(RestoreProofError::ReconciliationMismatch) }
                }
            },
        )
        .await;

        assert!(matches!(
            result,
            Err(RestoreProofError::ReconciliationMismatch)
        ));
        assert_eq!(*log.drop_source.borrow(), 1);
        assert_eq!(*log.drop_restore.borrow(), 1);
    }

    #[tokio::test]
    async fn original_error_is_preserved_when_cleanup_also_fails() {
        let log = CallLog::default();
        let result = run_restore_and_reconcile(
            {
                let l = log.clone();
                move || {
                    *l.create_restore.borrow_mut() += 1;
                    async { Ok(()) }
                }
            },
            {
                let l = log.clone();
                move || {
                    *l.drop_source.borrow_mut() += 1;
                    // Cleanup itself also fails here...
                    async { Err(RestoreProofError::DatabaseDropFailed) }
                }
            },
            {
                let l = log.clone();
                move || {
                    *l.drop_restore.borrow_mut() += 1;
                    async { Err(RestoreProofError::DatabaseDropFailed) }
                }
            },
            {
                let l = log.clone();
                move || {
                    *l.restore.borrow_mut() += 1;
                    // ...but the ORIGINAL restore failure is what must be
                    // returned, never replaced by the cleanup failure.
                    async { Err(RestoreProofError::PgRestoreFailed(Some(9))) }
                }
            },
            {
                let l = log.clone();
                move || {
                    *l.reconcile.borrow_mut() += 1;
                    async { Ok(ok_report()) }
                }
            },
        )
        .await;

        assert!(matches!(
            result,
            Err(RestoreProofError::PgRestoreFailed(Some(9)))
        ));
        assert_eq!(
            *log.drop_source.borrow(),
            1,
            "cleanup must still be attempted"
        );
        assert_eq!(*log.drop_restore.borrow(), 1);
    }

    // ---- TempDbObligation is a passive record, not an async-Drop guard -----

    #[test]
    fn temp_db_obligation_marks_cleaned_without_doing_any_cleanup_itself() {
        let mut obligation = TempDbObligation::new("stockiha_restore_proof_source_1".to_string());
        assert_eq!(obligation.name(), "stockiha_restore_proof_source_1");
        obligation.mark_cleaned();
        // Dropping a marked-clean obligation is silent; dropping an
        // unmarked one only ever emits a debug-only diagnostic — neither
        // path performs any I/O, which is the whole point: Drop cannot run
        // async cleanup, so this type must never claim to.
    }

    // ===========================================================================
    // Windows/PostgreSQL live proof (ignored by default; requires Windows, a
    // real PostgreSQL 18 instance, a real pg_dump/pg_restore on PATH or the
    // *_PATH overrides, and the stockiha_backup credential already stored
    // via S0-005).
    // ===========================================================================

    /// Full end-to-end proof, in order: create a source proof database, seed
    /// deterministic fixture rows, generate a real S0-009 bundle through
    /// unmodified production backup code (as `stockiha_backup`, exactly as a
    /// real backup would run), preflight that bundle, create a distinct
    /// restore proof database, restore into it, verify PostgreSQL major
    /// version 18, reconcile source vs. restored (row count + canonical
    /// SHA-256), then drop both temporary databases and remove the
    /// generated bundle/temp files. Never touches a real Stockiha
    /// application database — `source`/`restore` are both freshly created,
    /// [`TEMP_DB_PREFIX`]-guarded, throwaway databases.
    ///
    /// ```powershell
    /// $env:STOCKIHA_ALLOW_RESTORE_PROOF = "YES"
    /// $env:STOCKIHA_RESTORE_PROOF_ADMIN_DATABASE_URL = "postgres://<admin>:<password>@localhost:5432/postgres"
    /// cargo test -p stockiha-backend restore_proof -- --ignored
    /// ```
    #[cfg(windows)]
    #[tokio::test]
    #[ignore]
    async fn windows_live_proof_restores_and_reconciles_against_a_real_postgres() {
        use sqlx::Connection;

        let allowed = std::env::var("STOCKIHA_ALLOW_RESTORE_PROOF").unwrap_or_default();
        assert_eq!(
            allowed, "YES",
            "set STOCKIHA_ALLOW_RESTORE_PROOF=YES to run this live proof"
        );
        let admin_url = std::env::var("STOCKIHA_RESTORE_PROOF_ADMIN_DATABASE_URL")
            .expect("set STOCKIHA_RESTORE_PROOF_ADMIN_DATABASE_URL to run this live proof");

        let parsed = parse_admin_url(&admin_url)
            .expect("admin URL must parse and explicitly target the postgres maintenance database");
        let base_options = admin_connect_options(&parsed);

        let mut admin_conn = PgConnection::connect_with(&base_options)
            .await
            .expect("must connect as admin to the postgres maintenance database");
        verify_maintenance_database(&mut admin_conn)
            .await
            .expect("the live connection must report current_database() = postgres");

        // 1. Create the source proof database.
        let source_name = generate_temp_db_name("source");
        create_database(&mut admin_conn, &source_name)
            .await
            .expect("create source db");
        let mut source_obligation = TempDbObligation::new(source_name.clone());

        // 2. Seed deterministic fixture rows directly in the source db.
        let source_options = base_options.clone().database(&source_name);
        let mut source_conn = PgConnection::connect_with(&source_options)
            .await
            .expect("connect to source db");
        seed_fixture(&mut source_conn).await.expect("seed fixture");
        let source_digest = compute_fixture_digest(&mut source_conn)
            .await
            .expect("digest source fixture");

        // Grant the fixed `stockiha_backup` role read access so unmodified
        // production backup code can dump this throwaway database exactly
        // as it would dump the real one.
        sqlx::query(&format!(
            "GRANT CONNECT ON DATABASE {} TO stockiha_backup",
            quote_identifier(&source_name)
        ))
        .execute(&mut admin_conn)
        .await
        .expect("grant connect to stockiha_backup");
        sqlx::query(&format!(
            "GRANT SELECT ON {FIXTURE_TABLE} TO stockiha_backup"
        ))
        .execute(&mut source_conn)
        .await
        .expect("grant select to stockiha_backup");
        drop(source_conn);

        // 3. Generate a real S0-009 bundle through production backup code.
        let pg_dump_exe = super::super::backup_proof::resolve_pg_dump_executable();
        let pg_dump_version =
            super::super::backup_proof::discover_and_validate_pg_dump(&pg_dump_exe)
                .expect("pg_dump must be discoverable and report major version 18");
        let secret = super::super::backup_proof::resolve_backup_credential()
            .expect("the stockiha_backup credential must already be stored via S0-005");
        let bytes = secret.as_ref();
        let password = if bytes.contains(&0) {
            let u16s: Vec<u16> = bytes
                .chunks_exact(2)
                .map(|c| u16::from_le_bytes([c[0], c[1]]))
                .collect();
            String::from_utf16_lossy(&u16s)
                .trim_end_matches('\0')
                .to_string()
        } else {
            std::str::from_utf8(bytes)
                .expect("stockiha_backup password must be UTF-8")
                .to_string()
        };
        let dump_target = super::super::backup_proof::PgDumpTarget {
            host: &parsed.host,
            port: parsed.port,
            database: &source_name,
        };
        let bundle_root = std::env::temp_dir().join("stockiha-restore-proof-live-bundles");
        fs::create_dir_all(&bundle_root).expect("bundle root must be creatable");
        let bundle = super::super::backup_proof::create_backup_bundle(
            &bundle_root,
            time::OffsetDateTime::now_utc(),
            &pg_dump_version,
            &super::super::backup_proof::BackupInputs::empty(),
            |out_path| {
                super::super::backup_proof::run_pg_dump(
                    &pg_dump_exe,
                    &dump_target,
                    &password,
                    out_path,
                )
            },
        )
        .expect("bundle creation through production backup code must succeed");

        // 4. Preflight the generated bundle — the single shared validator.
        let validated =
            preflight_bundle(&bundle).expect("the generated bundle must pass preflight");
        assert_eq!(validated.postgres_major_version, REQUIRED_PG_MAJOR_VERSION);

        // 5-9 via the shared orchestrator (`run_restore_and_reconcile`) —
        // the exact function the fake-closure unit tests above already
        // proved the cleanup semantics of. Every closure opens its own
        // fresh connection (cloning the cheap, `Clone`-derived
        // `PgConnectOptions`) rather than sharing one `&mut PgConnection`
        // across closures, which the borrow checker would not allow here.
        let restore_name = generate_temp_db_name("restore");
        let pg_restore_exe = resolve_pg_restore_executable();
        discover_and_validate_pg_restore(&pg_restore_exe)
            .expect("pg_restore must be discoverable and report major version 18");

        let mut restore_obligation = TempDbObligation::new(restore_name.clone());

        let create_restore_db = {
            let options = base_options.clone();
            let restore_name = restore_name.clone();
            move || {
                let options = options.clone();
                let restore_name = restore_name.clone();
                async move {
                    let mut conn = PgConnection::connect_with(&options)
                        .await
                        .map_err(|_| RestoreProofError::AdminConnectFailed)?;
                    create_database(&mut conn, &restore_name).await
                }
            }
        };

        let drop_source_db = {
            let options = base_options.clone();
            let source_name = source_name.clone();
            move || {
                let options = options.clone();
                let source_name = source_name.clone();
                async move {
                    let mut conn = PgConnection::connect_with(&options)
                        .await
                        .map_err(|_| RestoreProofError::AdminConnectFailed)?;
                    drop_database_with_force(&mut conn, &source_name).await
                }
            }
        };

        let drop_restore_db = {
            let options = base_options.clone();
            let restore_name = restore_name.clone();
            move || {
                let options = options.clone();
                let restore_name = restore_name.clone();
                async move {
                    let mut conn = PgConnection::connect_with(&options)
                        .await
                        .map_err(|_| RestoreProofError::AdminConnectFailed)?;
                    drop_database_with_force(&mut conn, &restore_name).await
                }
            }
        };

        let restore_step = {
            let pg_restore_exe = pg_restore_exe.clone();
            let host = parsed.host.clone();
            let port = parsed.port;
            let restore_name = restore_name.clone();
            let username = parsed.username.clone();
            let password = parsed.password.clone();
            let dump_path = validated.dump_path.clone();
            move || {
                let pg_restore_exe = pg_restore_exe.clone();
                let host = host.clone();
                let database = restore_name.clone();
                let username = username.clone();
                let password = password.clone();
                let dump_path = dump_path.clone();
                async move {
                    let target = PgRestoreTarget {
                        host: &host,
                        port,
                        database: &database,
                    };
                    run_pg_restore(&pg_restore_exe, &target, &username, &password, &dump_path)
                }
            }
        };

        let reconcile_step = {
            let options = base_options.clone();
            let restore_name = restore_name.clone();
            let source_digest = source_digest.clone();
            move || {
                let options = options.clone().database(&restore_name);
                let source_digest = source_digest.clone();
                async move {
                    let mut conn = PgConnection::connect_with(&options)
                        .await
                        .map_err(|_| RestoreProofError::AdminConnectFailed)?;
                    let restored = compute_fixture_digest(&mut conn).await?;
                    compare_fixture_digests(&source_digest, &restored)
                }
            }
        };

        let outcome = run_restore_and_reconcile(
            create_restore_db,
            drop_source_db,
            drop_restore_db,
            restore_step,
            reconcile_step,
        )
        .await;

        // The orchestrator guarantees both drops were attempted on every
        // path (proven by the fake-closure unit tests above), so both
        // obligations are cleaned regardless of `outcome`.
        source_obligation.mark_cleaned();
        restore_obligation.mark_cleaned();

        // 10. Remove the generated bundle and its root.
        let _ = fs::remove_dir_all(&bundle_root);

        let report = outcome.expect(
            "restore and reconciliation must succeed end-to-end against a real PostgreSQL 18",
        );
        assert_eq!(report.row_count, 3);
        assert_eq!(report.sha256, source_digest.sha256);
    }
}
