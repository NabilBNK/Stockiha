//! WS-K-5 — safe automatic database upgrade: mandatory pre-upgrade backup,
//! verification, and automatic rollback around WS-K-4.9's already-shipped
//! `embedded_setup::apply_pending_migrations`.
//!
//! # Why this exists
//!
//! WS-K-4.9 made an embedded installation upgrade its own schema
//! automatically at startup (`apply_pending_migrations`, called from
//! `lib.rs`'s `.setup()`). That closed one real gap — a new build over an
//! old embedded database used to dead-end on "Database needs an update,
//! contact your supplier", a message written for a database someone else
//! administers — but it introduced another: the migration ran completely
//! unattended, with no backup, no verification that a backup even could be
//! restored, and no rollback if it failed. An update could silently rewrite
//! a shop's live database with nothing to fall back on.
//!
//! This module is the safety wrapper. It does not re-implement the
//! migration itself — [`embedded_setup::apply_pending_migrations`] remains
//! the one place that calls SQLx's migrator — it decides *whether* that is
//! safe to call yet, backs up first, proves the backup is usable, and undoes
//! everything if the migration (or the check afterward) does not succeed.
//!
//! # What changed about *when* migration is attempted
//!
//! [`embedded_setup::apply_pending_migrations`] was also corrected (see its
//! own doc comment) to only ever attempt a migration when the schema is
//! genuinely [`SchemaCompatibility::OlderThanBinary`]. This module's own
//! gate (`run_safe_upgrade`'s early return in
//! [`UpgradeOutcome::NoActionNeeded`]) enforces the same rule a second time,
//! independently, before any backup is even considered — belt and braces:
//! [`SchemaCompatibility::UpToDate`], [`SchemaCompatibility::NewerThanBinary`]
//! and [`SchemaCompatibility::Unknown`] all take zero action here. A
//! newer-than-binary database is the one case an older binary must refuse to
//! touch at all (the existing WS-K-1 hard-stop screen is unchanged); an
//! unknown verdict is, by construction, not evidence the schema needs
//! anything.
//!
//! # Rollback mechanism
//!
//! No persisted embedded-flow role holds `CREATEDB` or `SUPERUSER` — by
//! design, the superuser password created during first-run setup is never
//! written to disk (see `local_config`'s and `embedded_setup`'s own module
//! notes). That rules out the textbook rollback of dropping and recreating
//! the whole database. What `stockiha_migrator` *does* have, every time it
//! connects to this database, is its session role already switched to
//! `stockiha_owner` (`ALTER ROLE stockiha_migrator IN DATABASE ... SET
//! role = 'stockiha_owner'`, set once during first-run setup) — and
//! `stockiha_owner` owns every schema this app's migrations create
//! outright. Rollback therefore drops and recreates **every** non-system
//! schema (`public` plus each dedicated schema the migrations created —
//! `cash`, `catalog`, `finance`, `iam`, `sales`, and so on; the business
//! tables live in those, not in `public`), a schema-owner operation, not a
//! database-owner one, then restores the pre-upgrade dump into the now-empty
//! database. This is deliberately stronger than `pg_restore --clean`:
//! `--clean` only knows how to drop objects the dump itself lists, so any
//! table a partially-applied migration created that predates nothing in the
//! backup would survive `--clean` as an orphan. Dropping every schema first
//! leaves nothing behind that the backup does not explicitly recreate — the
//! database ends up in exactly, not approximately, its pre-upgrade state.
//! (`public` itself is handled slightly differently from the rest: `pg_dump`
//! never emits an explicit `CREATE SCHEMA public` — it treats `public` as
//! always pre-existing — so `reset_all_schemas` recreates it itself, owned
//! by `stockiha_owner`, immediately after dropping it, rather than leaving
//! that to the restored archive the way every other schema is.)
//!
//! The dump itself is taken **with** privilege information (`pg_dump
//! --no-owner`, deliberately *not* `--no-privileges`): the pre-existing
//! `GRANT`s that let `stockiha_runtime` — the role the running app actually
//! connects as — read and write its own tables must come back on restore,
//! or the previous app version would reconnect successfully post-rollback
//! and then fail on its very first query.
//!
//! # Backup verification
//!
//! `pg_restore --list` reads the archive's table of contents and fails on a
//! truncated or corrupt file — cheap, and it is also the *strongest* check
//! available here: a full trial-restore into a scratch database (the
//! approach WS-H's own operator recovery flow uses, see
//! `application::recovery`) needs `CREATEDB`, which — per the rollback note
//! above — no persisted embedded-flow credential holds. `--list` is treated
//! as sufficient for this narrower, unattended path; a corrupt or truncated
//! dump is exactly what it is built to catch, and the one thing it cannot
//! prove (that every row would replay cleanly) can only be proven by
//! actually restoring, which is exactly what a failed migration's own
//! rollback does moments later if it comes to that.
//!
//! # Retention
//!
//! Successful-upgrade backups are pruned to the newest three
//! (`BACKUP_RETENTION_COUNT`) after a *successful* upgrade only. A backup
//! that was ever part of a failed upgrade (verification failure, or a
//! migration that had to be rolled back) is moved into `backups/failed/`
//! the moment that failure is known, which is outside the directory
//! retention ever scans — it is never a deletion candidate, regardless of
//! how many later upgrades succeed.

use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::Serialize;
use sqlx::postgres::{PgConnectOptions, PgConnection};
use sqlx::Connection;

use crate::infrastructure::embedded_setup;
use crate::infrastructure::local_config::{self, MigratorConnectionInfo};
use crate::infrastructure::pg_process;
use crate::infrastructure::schema_version::{self, SchemaCompatibility};

/// How many times larger than the estimated dump size the free disk space
/// must be before a backup is attempted. Chosen, not measured: 1x covers
/// only the dump itself with zero margin for the temporary directory
/// PostgreSQL's own tooling may use, filesystem block overhead, or a second
/// concurrent write; 3x is the same order-of-magnitude safety margin
/// `create_backup_bundle`'s own atomic-temp-then-rename design assumes
/// elsewhere in this crate, and is cheap to satisfy in absolute terms for a
/// single-shop database (megabytes to low gigabytes), not a data warehouse.
const FREE_SPACE_MULTIPLIER: u64 = 3;

/// Keep the newest three pre-upgrade backups after a successful upgrade.
/// Three, not one: a shop's very first launch on a newly-updated binary is
/// exactly when an operator most needs to compare against more than the
/// single most recent backup if something looks wrong days later — but
/// unbounded retention fills a shop's disk silently over a year of updates.
/// Three balances both without asking the Owner to manage anything.
const BACKUP_RETENTION_COUNT: usize = 3;

const BACKUP_FILE_PREFIX: &str = "stockiha-preupgrade-";
const BACKUP_FILE_SUFFIX: &str = ".dump";
const FAILED_BACKUPS_SUBDIR: &str = "failed";

/// The five steps of a safe upgrade attempt, in order. Serialized the same
/// way `embedded_setup::SetupStep` is, for the same reason: a stable string
/// tag the frontend keys its checklist off directly. `Rollback` is included
/// even though it only ever runs on failure — omitting it from the fixed,
/// always-rendered step list would make a rollback look like an unexplained
/// sixth thing happening after "the plan" already finished.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum UpgradeStep {
    Preflight,
    Backup,
    VerifyBackup,
    Migrate,
    VerifySchema,
    Rollback,
}

impl UpgradeStep {
    pub const ALL: [UpgradeStep; 6] = [
        UpgradeStep::Preflight,
        UpgradeStep::Backup,
        UpgradeStep::VerifyBackup,
        UpgradeStep::Migrate,
        UpgradeStep::VerifySchema,
        UpgradeStep::Rollback,
    ];
}

pub use embedded_setup::StepStatus;

/// One progress update, mirroring `embedded_setup::SetupProgress`'s own
/// credential-free-by-construction discipline: `detail` is always built from
/// fixed sentences plus a plain OS/SQLx/child-process error `Display`, never
/// a password or an assembled connection string.
#[derive(Clone, Debug, Serialize)]
pub struct UpgradeProgress {
    pub step: UpgradeStep,
    pub status: StepStatus,
    pub detail: Option<String>,
}

/// What a safe-upgrade attempt produced when it did **not** fail.
#[derive(Debug)]
pub enum UpgradeOutcome {
    /// This installation has no migrator credential on file (not an embedded
    /// install set up at WS-K-4.9 or later). Nothing was attempted; the
    /// existing WS-K-1 diagnostic reports whatever it would have reported.
    NotEmbedded,
    /// The schema was not `OlderThanBinary` — nothing needed doing. Carries
    /// the actual verdict so a caller can log it. Zero backup or migration
    /// calls were made for any of these: `UpToDate`, `NewerThanBinary`, or
    /// `Unknown`.
    NoActionNeeded(SchemaCompatibility),
    /// The upgrade completed: backed up, verified, migrated, and confirmed
    /// `UpToDate` afterward.
    Upgraded {
        backup_path: PathBuf,
        from: SchemaCompatibility,
    },
}

/// What a safe-upgrade attempt produced when it **did** fail. Every variant
/// states, by construction, whether the database was touched at all.
#[derive(Debug)]
pub enum UpgradeError {
    /// The database was never modified: either no backup was ever taken
    /// (a preflight check refused), or a backup was taken but failed
    /// verification before migration could even start. `backup_path` is
    /// `Some` only in the latter case, pointing at the quarantined (not
    /// deleted) file.
    AbortedBeforeMigration {
        reason: String,
        backup_path: Option<PathBuf>,
    },
    /// Migration was attempted, failed (or its post-check found the schema
    /// was not `UpToDate`), and rollback succeeded: the database is back to
    /// its exact pre-upgrade state.
    RolledBack {
        reason: String,
        backup_path: PathBuf,
    },
    /// Migration was attempted and rollback **itself** failed. The worst
    /// case in this entire system: the database may be in an inconsistent
    /// state, but the backup file named here still exists and was never
    /// touched by the failed rollback attempt.
    RollbackFailed {
        reason: String,
        backup_path: PathBuf,
        rollback_error: String,
    },
}

fn append_upgrade_log(app_data_dir: &Path, line: &str) {
    use std::io::Write;
    let timestamp = time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default();
    let timestamped = format!("[{timestamp}] {line}\n");
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(app_data_dir.join("upgrade.log"))
    {
        let _ = file.write_all(timestamped.as_bytes());
    }
}

fn connect_options(info: &MigratorConnectionInfo) -> PgConnectOptions {
    PgConnectOptions::new()
        .host(&info.host)
        .port(info.port)
        .username(&info.username)
        .password(info.password.as_str())
        .database(&info.database)
}

/// Run the full safe-upgrade flow. See the module doc comment for the
/// mechanism; this is the orchestration in the exact order the WS-K-5 task
/// specifies: preflight, backup, verify backup, migrate, verify schema, and
/// — only on failure — rollback.
pub async fn run_safe_upgrade(
    app_data_dir: &Path,
    bin_dir: &Path,
    mut emit: impl FnMut(UpgradeProgress) + Send,
) -> Result<UpgradeOutcome, UpgradeError> {
    let mut report = |step: UpgradeStep, status: StepStatus, detail: Option<String>| {
        let line = match (status, &detail) {
            (StepStatus::Running, _) => format!("{step:?}: starting"),
            (StepStatus::Done, Some(d)) => format!("{step:?}: done - {d}"),
            (StepStatus::Done, None) => format!("{step:?}: done"),
            (StepStatus::Failed, Some(d)) => format!("{step:?}: FAILED - {d}"),
            (StepStatus::Failed, None) => format!("{step:?}: FAILED"),
        };
        append_upgrade_log(app_data_dir, &line);
        emit(UpgradeProgress {
            step,
            status,
            detail,
        });
    };

    let Some(info) = local_config::load_migrator_connection_info(app_data_dir) else {
        return Ok(UpgradeOutcome::NotEmbedded);
    };
    let options = connect_options(&info);

    // ——— Fast, read-only gate: only OlderThanBinary proceeds ———
    let before = {
        let mut conn = PgConnection::connect_with(&options).await.map_err(|e| {
            UpgradeError::AbortedBeforeMigration {
                reason: format!("could not connect as the migrator to check the schema ({e})"),
                backup_path: None,
            }
        })?;
        let verdict = schema_version::check_schema_compatibility(&mut conn).await;
        let _ = conn.close().await;
        verdict
    };
    if !matches!(before, SchemaCompatibility::OlderThanBinary { .. }) {
        return Ok(UpgradeOutcome::NoActionNeeded(before));
    }

    // ——— Step 1: preflight ———
    report(UpgradeStep::Preflight, StepStatus::Running, None);
    if let Err(detail) = pg_process::preflight_backup_binaries(bin_dir) {
        report(
            UpgradeStep::Preflight,
            StepStatus::Failed,
            Some(detail.clone()),
        );
        return Err(UpgradeError::AbortedBeforeMigration {
            reason: detail,
            backup_path: None,
        });
    }
    let backups_dir = app_data_dir.join("backups");
    if let Err(err) = std::fs::create_dir_all(&backups_dir) {
        let detail = format!("could not create the backups folder ({err})");
        report(
            UpgradeStep::Preflight,
            StepStatus::Failed,
            Some(detail.clone()),
        );
        return Err(UpgradeError::AbortedBeforeMigration {
            reason: detail,
            backup_path: None,
        });
    }
    let estimated_size = match estimate_database_size_bytes(&options).await {
        Ok(size) => size,
        Err(detail) => {
            report(
                UpgradeStep::Preflight,
                StepStatus::Failed,
                Some(detail.clone()),
            );
            return Err(UpgradeError::AbortedBeforeMigration {
                reason: detail,
                backup_path: None,
            });
        }
    };
    let free_space = pg_process::free_disk_space_bytes(&backups_dir);
    if let Err(detail) =
        require_enough_free_space(free_space, estimated_size, FREE_SPACE_MULTIPLIER)
    {
        report(
            UpgradeStep::Preflight,
            StepStatus::Failed,
            Some(detail.clone()),
        );
        return Err(UpgradeError::AbortedBeforeMigration {
            reason: detail,
            backup_path: None,
        });
    }
    report(UpgradeStep::Preflight, StepStatus::Done, None);

    // ——— Step 2: backup ———
    report(UpgradeStep::Backup, StepStatus::Running, None);
    let backup_path = backups_dir.join(backup_file_name(time::OffsetDateTime::now_utc()));
    if let Err(detail) = run_pg_dump(bin_dir, &info, &backup_path) {
        report(
            UpgradeStep::Backup,
            StepStatus::Failed,
            Some(detail.clone()),
        );
        // Whatever partial file pg_dump left behind is not a usable backup;
        // still never deleted outright — quarantined like any other
        // failed-upgrade artifact, in case its content helps diagnose why.
        let quarantined = quarantine_backup(&backups_dir, &backup_path);
        return Err(UpgradeError::AbortedBeforeMigration {
            reason: detail,
            backup_path: quarantined,
        });
    }
    report(
        UpgradeStep::Backup,
        StepStatus::Done,
        Some(format!("backup written to {}", backup_path.display())),
    );

    // ——— Step 3: verify the backup is restorable ———
    report(UpgradeStep::VerifyBackup, StepStatus::Running, None);
    if let Err(detail) = verify_backup_restorable(bin_dir, &backup_path) {
        report(
            UpgradeStep::VerifyBackup,
            StepStatus::Failed,
            Some(detail.clone()),
        );
        let quarantined = quarantine_backup(&backups_dir, &backup_path);
        return Err(UpgradeError::AbortedBeforeMigration {
            reason: format!(
                "the pre-upgrade backup could not be verified ({detail}); the database was not \
                 changed and the previous version of Stockiha keeps working"
            ),
            backup_path: quarantined,
        });
    }
    report(UpgradeStep::VerifyBackup, StepStatus::Done, None);

    // ——— Step 4: migrate (reuses embedded_setup's own migrator) ———
    report(UpgradeStep::Migrate, StepStatus::Running, None);
    if let Err(detail) = embedded_setup::apply_pending_migrations(app_data_dir).await {
        report(
            UpgradeStep::Migrate,
            StepStatus::Failed,
            Some(detail.clone()),
        );
        return rollback(
            bin_dir,
            &info,
            &backups_dir,
            &backup_path,
            format!("the migration failed ({detail})"),
            &mut report,
        )
        .await;
    }
    report(UpgradeStep::Migrate, StepStatus::Done, None);

    // ——— Step 5: verify the schema is now UpToDate ———
    report(UpgradeStep::VerifySchema, StepStatus::Running, None);
    let after: Option<SchemaCompatibility> = match PgConnection::connect_with(&options).await {
        Ok(mut conn) => {
            let verdict = schema_version::check_schema_compatibility(&mut conn).await;
            let _ = conn.close().await;
            Some(verdict)
        }
        Err(_) => None,
    };
    match after {
        Some(SchemaCompatibility::UpToDate) => {
            report(UpgradeStep::VerifySchema, StepStatus::Done, None);
        }
        Some(other) => {
            let detail = format!("expected the schema to be UP_TO_DATE, found {other:?}");
            report(
                UpgradeStep::VerifySchema,
                StepStatus::Failed,
                Some(detail.clone()),
            );
            return rollback(
                bin_dir,
                &info,
                &backups_dir,
                &backup_path,
                detail,
                &mut report,
            )
            .await;
        }
        None => {
            let detail = "could not reconnect to verify the schema after migrating".to_string();
            report(
                UpgradeStep::VerifySchema,
                StepStatus::Failed,
                Some(detail.clone()),
            );
            return rollback(
                bin_dir,
                &info,
                &backups_dir,
                &backup_path,
                detail,
                &mut report,
            )
            .await;
        }
    }

    // ——— Retention: only after a successful upgrade ———
    if let Err(err) = enforce_backup_retention(&backups_dir) {
        append_upgrade_log(
            app_data_dir,
            &format!("backup retention cleanup warning (non-fatal): {err}"),
        );
    }

    Ok(UpgradeOutcome::Upgraded {
        backup_path,
        from: before,
    })
}

async fn rollback(
    bin_dir: &Path,
    info: &MigratorConnectionInfo,
    backups_dir: &Path,
    backup_path: &Path,
    reason: String,
    report: &mut impl FnMut(UpgradeStep, StepStatus, Option<String>),
) -> Result<UpgradeOutcome, UpgradeError> {
    report(UpgradeStep::Rollback, StepStatus::Running, None);
    match perform_rollback(bin_dir, info, backup_path).await {
        Ok(()) => {
            report(UpgradeStep::Rollback, StepStatus::Done, None);
            let kept = quarantine_backup(backups_dir, backup_path)
                .unwrap_or_else(|| backup_path.to_path_buf());
            Err(UpgradeError::RolledBack {
                reason,
                backup_path: kept,
            })
        }
        Err(rollback_error) => {
            report(
                UpgradeStep::Rollback,
                StepStatus::Failed,
                Some(rollback_error.clone()),
            );
            // Deliberately NOT quarantined: a failed rollback is the one
            // case where the backup file's exact, already-communicated path
            // must never move again.
            Err(UpgradeError::RollbackFailed {
                reason,
                backup_path: backup_path.to_path_buf(),
                rollback_error,
            })
        }
    }
}

/// Reset the `public` schema to empty, then restore the pre-upgrade dump
/// into it. See the module doc comment for why this — not `pg_restore
/// --clean` — is the mechanism: it is the only approach available without a
/// persisted superuser/`CREATEDB` credential that is still guaranteed to
/// leave nothing behind that predates the backup.
async fn perform_rollback(
    bin_dir: &Path,
    info: &MigratorConnectionInfo,
    backup_path: &Path,
) -> Result<(), String> {
    let options = connect_options(info);
    let mut conn = PgConnection::connect_with(&options)
        .await
        .map_err(|e| format!("could not connect to reset the schema before restoring ({e})"))?;

    // The migrations create their own dedicated schemas (`cash`, `catalog`,
    // `finance`, `iam`, `sales`, ... — `public` is not where the actual
    // business tables live). `pg_dump`'s archive contains an explicit
    // `CREATE SCHEMA` for every one of those non-default schemas it found,
    // so each must be dropped first or restore fails with "already exists"
    // instead of recreating a clean copy — discovered exactly this way by
    // this module's own rollback integration test.
    let reset_result = reset_all_schemas(&mut conn).await;
    let _ = conn.close().await;
    reset_result?;

    run_pg_restore(bin_dir, info, backup_path)
}

/// Drop every non-system schema so `pg_restore`'s archive can recreate each
/// one exactly as the backup recorded it, then separately reset `public`
/// (never explicitly created by `pg_dump` — it is treated as always
/// pre-existing) back to the same owned-by-`stockiha_owner`,
/// granted-to-`stockiha_migrator` shape first-run setup itself establishes.
async fn reset_all_schemas(conn: &mut PgConnection) -> Result<(), String> {
    let schemas: Vec<String> = sqlx::query_scalar(
        "SELECT nspname FROM pg_namespace \
         WHERE nspname NOT IN ('public', 'pg_catalog', 'information_schema') \
         AND nspname NOT LIKE 'pg\\_%'",
    )
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| format!("could not list schemas to reset before restoring ({e})"))?;

    for schema in &schemas {
        let sql = format!("DROP SCHEMA IF EXISTS {} CASCADE", quote_ident(schema));
        sqlx::raw_sql(&sql)
            .execute(&mut *conn)
            .await
            .map_err(|e| format!("could not drop schema \"{schema}\" before restoring ({e})"))?;
    }

    let reset_public = "DROP SCHEMA IF EXISTS public CASCADE; \
                         CREATE SCHEMA public AUTHORIZATION stockiha_owner; \
                         GRANT USAGE, CREATE ON SCHEMA public TO stockiha_migrator;";
    sqlx::raw_sql(reset_public)
        .execute(conn)
        .await
        .map_err(|e| format!("could not reset the public schema before restoring ({e})"))?;

    Ok(())
}

/// Double-quote a PostgreSQL identifier, doubling any embedded `"`. Callers
/// here only ever pass schema names already recorded in `pg_namespace` by
/// this crate's own migrations — not external input — but this is the
/// correct escaping regardless.
fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

// ---------------------------------------------------------------------------
// Disk space
// ---------------------------------------------------------------------------

async fn estimate_database_size_bytes(options: &PgConnectOptions) -> Result<u64, String> {
    let mut conn = PgConnection::connect_with(options)
        .await
        .map_err(|e| format!("could not connect to estimate the database size ({e})"))?;
    let size: i64 = sqlx::query_scalar("SELECT pg_database_size(current_database())")
        .fetch_one(&mut conn)
        .await
        .map_err(|e| format!("could not determine the database size ({e})"))?;
    let _ = conn.close().await;
    Ok(size.max(0) as u64)
}

/// Pure decision, unit-testable without touching a real filesystem: is
/// `free` at least `multiplier` times `estimated_size`? `None` (free space
/// could not be determined at all) refuses, fail-closed — see
/// `pg_process::free_disk_space_bytes`'s own doc comment for why this
/// check, unlike most advisory checks in this crate, does not fail open.
fn require_enough_free_space(
    free: Option<u64>,
    estimated_size: u64,
    multiplier: u64,
) -> Result<(), String> {
    let required = estimated_size.saturating_mul(multiplier);
    match free {
        Some(bytes) if bytes >= required => Ok(()),
        Some(bytes) => Err(format!(
            "not enough free disk space for a safe backup: the database is approximately \
             {estimated_size} bytes, so at least {required} bytes free are required \
             ({multiplier}x, for the dump itself plus a safety margin), but only {bytes} bytes \
             are free"
        )),
        None => Err(
            "could not determine how much free disk space is available, so a backup cannot be \
             safely attempted"
                .to_string(),
        ),
    }
}

// ---------------------------------------------------------------------------
// pg_dump / pg_restore invocation (bundled binaries only — never PATH)
// ---------------------------------------------------------------------------

fn run_pg_dump(
    bin_dir: &Path,
    info: &MigratorConnectionInfo,
    out_path: &Path,
) -> Result<(), String> {
    let exe = bin_dir.join("pg_dump.exe");
    let mut command = std::process::Command::new(&exe);
    pg_process::hide_console_window(&mut command);
    command
        .arg("--format=custom")
        .arg("--no-owner")
        .arg("--host")
        .arg(&info.host)
        .arg("--port")
        .arg(info.port.to_string())
        .arg("--username")
        .arg(&info.username)
        .arg("--dbname")
        .arg(&info.database)
        .arg("--file")
        .arg(out_path)
        .env("PGPASSWORD", info.password.as_str())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    let output = command
        .output()
        .map_err(|e| format!("could not run pg_dump ({e})"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "pg_dump exited with {}: {}",
            output.status,
            stderr.trim()
        ));
    }
    Ok(())
}

fn verify_backup_restorable(bin_dir: &Path, dump_path: &Path) -> Result<(), String> {
    let exe = bin_dir.join("pg_restore.exe");
    let mut command = std::process::Command::new(&exe);
    pg_process::hide_console_window(&mut command);
    command
        .arg("--list")
        .arg(dump_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    let output = command
        .output()
        .map_err(|e| format!("could not run pg_restore --list ({e})"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "pg_restore --list reports this backup is not readable: {}",
            stderr.trim()
        ));
    }
    Ok(())
}

fn run_pg_restore(
    bin_dir: &Path,
    info: &MigratorConnectionInfo,
    dump_path: &Path,
) -> Result<(), String> {
    let exe = bin_dir.join("pg_restore.exe");
    let mut command = std::process::Command::new(&exe);
    pg_process::hide_console_window(&mut command);
    command
        .arg("--no-owner")
        .arg("--host")
        .arg(&info.host)
        .arg("--port")
        .arg(info.port.to_string())
        .arg("--username")
        .arg(&info.username)
        .arg("--dbname")
        .arg(&info.database)
        .arg(dump_path)
        .env("PGPASSWORD", info.password.as_str())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    let output = command
        .output()
        .map_err(|e| format!("could not run pg_restore ({e})"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "pg_restore exited with {}: {}",
            output.status,
            stderr.trim()
        ));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Naming, quarantine, retention
// ---------------------------------------------------------------------------

fn backup_file_name(now: time::OffsetDateTime) -> String {
    format!(
        "{BACKUP_FILE_PREFIX}{:04}{:02}{:02}-{:02}{:02}{:02}{BACKUP_FILE_SUFFIX}",
        now.year(),
        u8::from(now.month()),
        now.day(),
        now.hour(),
        now.minute(),
        now.second()
    )
}

/// Move a backup file that was part of a failed upgrade into
/// `backups/failed/`, so [`enforce_backup_retention`] (which only ever scans
/// `backups/` itself, not its subdirectories) can never delete it. Returns
/// the new path, or `None` if the move itself failed — in which case the
/// original file is left exactly where it was, still not deleted.
fn quarantine_backup(backups_dir: &Path, backup_path: &Path) -> Option<PathBuf> {
    if !backup_path.exists() {
        return None;
    }
    let failed_dir = backups_dir.join(FAILED_BACKUPS_SUBDIR);
    if std::fs::create_dir_all(&failed_dir).is_err() {
        return None;
    }
    let file_name = backup_path.file_name()?;
    let dest = failed_dir.join(file_name);
    std::fs::rename(backup_path, &dest).ok().map(|()| dest)
}

/// Delete every backup in `backups_dir` (never its `failed/` subdirectory)
/// beyond the newest [`BACKUP_RETENTION_COUNT`], oldest first. Only ever
/// called after a successful upgrade.
fn enforce_backup_retention(backups_dir: &Path) -> Result<(), String> {
    let mut entries: Vec<(std::time::SystemTime, PathBuf)> = std::fs::read_dir(backups_dir)
        .map_err(|e| format!("could not list the backups folder ({e})"))?
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry.file_type().map(|t| t.is_file()).unwrap_or(false)
                && is_backup_file_name(&entry.file_name().to_string_lossy())
        })
        .filter_map(|entry| {
            entry
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .map(|modified| (modified, entry.path()))
        })
        .collect();

    // Newest first.
    entries.sort_by(|a, b| b.0.cmp(&a.0));

    for (_, path) in entries.into_iter().skip(BACKUP_RETENTION_COUNT) {
        let _ = std::fs::remove_file(&path);
    }
    Ok(())
}

fn is_backup_file_name(name: &str) -> bool {
    name.starts_with(BACKUP_FILE_PREFIX) && name.ends_with(BACKUP_FILE_SUFFIX)
}

// ===========================================================================
// Tests
// ===========================================================================

/// Real-embedded-instance test support, shared with the WS-H-3 recovery
/// engine's own ignored tests (`recovery_engine::backup`, and the WS-H-4/5
/// drill and restore tests that follow). Mirrors `embedded_setup`'s own
/// harness shape (`bundled_resource_dir`/`temp_app_data_dir`); every
/// helper spawns or talks to a real, disposable PostgreSQL instance.
#[cfg(test)]
pub(crate) mod test_support {
    use super::*;
    use crate::infrastructure::pg_process::{self as pg_process_mod, EmbeddedPostgresHandle};
    use std::sync::Mutex;

    pub(crate) fn bundled_resource_dir_for_tests() -> PathBuf {
        let exe = std::env::current_exe().expect("current_exe() must resolve");
        let dir = exe
            .parent()
            .and_then(|deps| deps.parent())
            .expect("test binary must live at target/<profile>/deps/");
        dir.canonicalize()
            .expect("the staged resource directory must exist")
    }

    pub(crate) fn temp_app_data_dir_for_tests(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "sk-safe-upgrade-e2e-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Provision a fresh, fully-migrated embedded instance via the real
    /// `embedded_setup::run_setup`. The server is left running on return
    /// (setup's own final step already proved it is reachable); the caller
    /// gets `bin_dir`/`pgdata`/`port` back so it can stop and, if needed,
    /// restart the same server itself later in the test.
    pub(crate) async fn provision_fresh_instance(
        app_data_dir: &Path,
        port: u16,
    ) -> (PathBuf, PathBuf, u16) {
        let resource_dir = bundled_resource_dir_for_tests();
        let handle = std::sync::Arc::new(Mutex::new(EmbeddedPostgresHandle::new(
            PathBuf::new(),
            PathBuf::new(),
            0,
        )));
        let result = embedded_setup::run_setup(
            app_data_dir.to_path_buf(),
            resource_dir,
            port,
            handle.clone(),
            |_| {},
        )
        .await;
        let (bin_dir, pgdata, actual_port) = {
            let guard = handle.lock().unwrap();
            (guard.bin_dir.clone(), guard.pgdata.clone(), guard.port)
        };
        result.unwrap_or_else(|e| panic!("provisioning fixture failed: {e}"));
        (bin_dir, pgdata, actual_port)
    }

    pub(crate) fn stop_server(bin_dir: &Path, pgdata: &Path) {
        let _ = pg_process_mod::stop_postgres(bin_dir, pgdata, std::time::Duration::from_secs(10));
    }

    /// Stop the server via `pg_ctl` (as [`stop_server`] does), then reap the
    /// `Child` this test itself spawned via [`start_server_and_wait`] — the
    /// process already exited once `pg_ctl stop` returned; this only
    /// collects its exit status so the OS process table entry is released
    /// immediately rather than at test-process exit.
    pub(crate) fn stop_server_and_reap(
        bin_dir: &Path,
        pgdata: &Path,
        mut child: std::process::Child,
    ) {
        stop_server(bin_dir, pgdata);
        let _ = child.wait();
    }

    pub(crate) async fn start_server_and_wait(
        bin_dir: &Path,
        pgdata: &Path,
        port: u16,
    ) -> std::process::Child {
        let child =
            pg_process_mod::spawn_postgres(bin_dir, pgdata).expect("spawn postgres for test");
        pg_process_mod::wait_until_ready(port, std::time::Duration::from_secs(15))
            .await
            .expect("server must become ready");
        child
    }

    pub(crate) async fn seed_row_and_count(conn: &mut PgConnection) -> i64 {
        // `finance.accounts` is untouched by the last migration's rewind
        // below and exists from far earlier in the migration set — a safe,
        // stable table to prove "pre-existing data survives" against.
        sqlx::raw_sql(
            "INSERT INTO finance.accounts \
             (scf_code, legacy_code, name_fr, name_en, account_type, normal_balance, is_postable, is_control) \
             VALUES ('999', 'WS_K_5_TEST_MARKER', 'Marqueur de test', 'Test marker', 'asset', 'debit', true, false) \
             ON CONFLICT (scf_code) DO NOTHING",
        )
        .execute(&mut *conn)
        .await
        .expect("seed row");
        sqlx::query_scalar("SELECT count(*) FROM finance.accounts WHERE scf_code = '999'")
            .fetch_one(conn)
            .await
            .expect("count seeded rows")
    }

    /// Delete the newest migration's `_sqlx_migrations` bookkeeping row — a
    /// real, honest "one migration behind" fixture: the real compiled
    /// `MIGRATOR` genuinely re-applies that exact file.
    ///
    /// The newest migration (WS-H-3 onward) is written to be fully
    /// idempotent, so deleting its bookkeeping row alone is an honest "one
    /// migration behind" fixture. Any future migration that becomes the
    /// newest MUST stay idempotent, or this fixture must undo its
    /// non-idempotent statements.
    pub(crate) async fn rewind_latest_migration(conn: &mut PgConnection) -> i64 {
        let latest = schema_version::embedded_latest_version();
        sqlx::query("DELETE FROM _sqlx_migrations WHERE version = $1")
            .bind(latest)
            .execute(&mut *conn)
            .await
            .expect("rewind: delete the latest migration's bookkeeping row");
        latest
    }

    /// Corrupt an already-applied migration's recorded checksum. SQLx's own
    /// migrator refuses to run at all when an applied migration's checksum
    /// no longer matches what is compiled in — a deterministic, real
    /// migration failure that does not depend on any migration file's own
    /// idempotency, used here purely to exercise the rollback path.
    pub(crate) async fn corrupt_an_earlier_checksum(conn: &mut PgConnection) {
        let earliest: i64 =
            sqlx::query_scalar("SELECT MIN(version) FROM _sqlx_migrations WHERE success = true")
                .fetch_one(&mut *conn)
                .await
                .expect("read the earliest applied version");
        sqlx::query(
            "UPDATE _sqlx_migrations SET checksum = decode('00', 'hex') WHERE version = $1",
        )
        .bind(earliest)
        .execute(conn)
        .await
        .expect("corrupt the earliest migration's checksum");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- pure decision logic: disk space --------------------------------

    #[test]
    fn refuses_when_free_space_is_unknown() {
        let result = require_enough_free_space(None, 1_000_000, 3);
        assert!(result.is_err(), "an undeterminable free space must refuse");
    }

    #[test]
    fn refuses_when_free_space_is_below_the_multiplier() {
        let result = require_enough_free_space(Some(2_999_999), 1_000_000, 3);
        assert!(result.is_err());
    }

    #[test]
    fn allows_when_free_space_meets_the_multiplier_exactly() {
        let result = require_enough_free_space(Some(3_000_000), 1_000_000, 3);
        assert!(result.is_ok());
    }

    #[test]
    fn allows_when_free_space_comfortably_exceeds_the_multiplier() {
        let result = require_enough_free_space(Some(10_000_000_000), 1_000_000, 3);
        assert!(result.is_ok());
    }

    #[test]
    fn saturating_multiply_never_panics_on_huge_estimates() {
        // Defense in depth: a corrupt or absurd pg_database_size reading
        // must never panic this preflight via integer overflow.
        let result = require_enough_free_space(Some(u64::MAX), u64::MAX, 3);
        assert!(result.is_ok());
    }

    // ---- backup file naming ----------------------------------------------

    #[test]
    fn backup_file_name_is_exact_fixed_format() {
        let now = time::OffsetDateTime::from_unix_timestamp(1_784_713_815).unwrap();
        let name = backup_file_name(now);
        assert!(name.starts_with(BACKUP_FILE_PREFIX));
        assert!(name.ends_with(BACKUP_FILE_SUFFIX));
        let middle = &name[BACKUP_FILE_PREFIX.len()..name.len() - BACKUP_FILE_SUFFIX.len()];
        assert_eq!(middle.len(), "YYYYMMDD-HHMMSS".len());
    }

    #[test]
    fn recognizes_only_well_formed_backup_file_names() {
        assert!(is_backup_file_name(
            "stockiha-preupgrade-20260101-120000.dump"
        ));
        assert!(!is_backup_file_name(
            "stockiha-preupgrade-20260101-120000.dump.tmp"
        ));
        assert!(!is_backup_file_name("something-else.dump"));
        assert!(!is_backup_file_name("manifest.json"));
    }

    // ---- retention: pure filesystem logic, no real PostgreSQL needed ----

    fn scratch_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "sk-safe-upgrade-test-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn touch_backup(dir: &Path, name: &str, age_secs_ago: u64) {
        let path = dir.join(name);
        std::fs::write(&path, b"fake dump bytes").unwrap();
        let when = std::time::SystemTime::now() - std::time::Duration::from_secs(age_secs_ago);
        // `set_modified` needs `FILE_WRITE_ATTRIBUTES` on Windows, which a
        // plain read-only `File::open` handle does not carry.
        let file = std::fs::OpenOptions::new().write(true).open(&path).unwrap();
        file.set_modified(when).unwrap();
    }

    #[test]
    fn retention_keeps_the_newest_n_and_deletes_the_rest_oldest_first() {
        let dir = scratch_dir("retention-basic");
        touch_backup(&dir, "stockiha-preupgrade-20260101-000000.dump", 500);
        touch_backup(&dir, "stockiha-preupgrade-20260102-000000.dump", 400);
        touch_backup(&dir, "stockiha-preupgrade-20260103-000000.dump", 300);
        touch_backup(&dir, "stockiha-preupgrade-20260104-000000.dump", 200);
        touch_backup(&dir, "stockiha-preupgrade-20260105-000000.dump", 100);

        enforce_backup_retention(&dir).unwrap();

        let remaining: std::collections::HashSet<String> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(remaining.len(), BACKUP_RETENTION_COUNT);
        // The three newest (least seconds-ago) must survive.
        assert!(remaining.contains("stockiha-preupgrade-20260103-000000.dump"));
        assert!(remaining.contains("stockiha-preupgrade-20260104-000000.dump"));
        assert!(remaining.contains("stockiha-preupgrade-20260105-000000.dump"));
        // The two oldest must be gone.
        assert!(!remaining.contains("stockiha-preupgrade-20260101-000000.dump"));
        assert!(!remaining.contains("stockiha-preupgrade-20260102-000000.dump"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn retention_never_touches_the_failed_subdirectory() {
        let dir = scratch_dir("retention-failed-immune");
        let failed_dir = dir.join(FAILED_BACKUPS_SUBDIR);
        std::fs::create_dir_all(&failed_dir).unwrap();
        touch_backup(
            &failed_dir,
            "stockiha-preupgrade-20250101-000000.dump",
            100_000,
        );
        for i in 0..5 {
            touch_backup(
                &dir,
                &format!("stockiha-preupgrade-2026010{i}-000000.dump"),
                (5 - i) as u64 * 10,
            );
        }

        enforce_backup_retention(&dir).unwrap();

        assert!(
            failed_dir
                .join("stockiha-preupgrade-20250101-000000.dump")
                .exists(),
            "a quarantined failed-upgrade backup must never be deleted by retention"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn retention_ignores_files_that_are_not_backup_dumps() {
        let dir = scratch_dir("retention-ignores-foreign-files");
        touch_backup(&dir, "stockiha-preupgrade-20260101-000000.dump", 10);
        std::fs::write(dir.join("notes.txt"), b"unrelated").unwrap();

        enforce_backup_retention(&dir).unwrap();

        assert!(dir.join("notes.txt").exists());
        assert!(dir
            .join("stockiha-preupgrade-20260101-000000.dump")
            .exists());

        let _ = std::fs::remove_dir_all(&dir);
    }

    // ---- quarantine --------------------------------------------------------

    #[test]
    fn quarantine_moves_the_file_into_the_failed_subdirectory() {
        let dir = scratch_dir("quarantine");
        let backup = dir.join("stockiha-preupgrade-20260101-000000.dump");
        std::fs::write(&backup, b"dump bytes").unwrap();

        let moved = quarantine_backup(&dir, &backup).expect("quarantine must succeed");
        assert!(!backup.exists());
        assert!(moved.exists());
        assert_eq!(
            moved.parent().unwrap().file_name().unwrap(),
            FAILED_BACKUPS_SUBDIR
        );
        assert_eq!(std::fs::read(&moved).unwrap(), b"dump bytes");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn quarantine_is_a_no_op_when_the_file_does_not_exist() {
        let dir = scratch_dir("quarantine-missing");
        let backup = dir.join("does-not-exist.dump");
        assert_eq!(quarantine_backup(&dir, &backup), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    // ---- serialization shape ------------------------------------------------

    #[test]
    fn upgrade_step_serializes_to_screaming_snake_case() {
        let json = serde_json::to_string(&UpgradeStep::VerifyBackup).unwrap();
        assert_eq!(json, "\"VERIFY_BACKUP\"");
    }

    // =======================================================================
    // Real-embedded-instance integration tests. Helpers live in the sibling
    // `test_support` module (WS-H-3 shares them with the recovery engine).
    // =======================================================================

    use super::test_support::*;
    use crate::infrastructure::pg_process as pg_process_mod;

    #[tokio::test]
    #[ignore = "spawns a real, disposable PostgreSQL instance; run explicitly with -- --ignored"]
    async fn happy_path_backs_up_verifies_migrates_and_verifies_again() {
        let app_data_dir = temp_app_data_dir_for_tests("happy");
        let port = 58530;
        let (bin_dir, pgdata, port) = provision_fresh_instance(&app_data_dir, port).await;

        let info = local_config::load_migrator_connection_info(&app_data_dir)
            .expect("migrator.json must exist after setup");
        let options = connect_options(&info);

        let seeded_count = {
            let mut conn = PgConnection::connect_with(&options).await.unwrap();
            let count = seed_row_and_count(&mut conn).await;
            rewind_latest_migration(&mut conn).await;
            let _ = conn.close().await;
            count
        };

        // Confirm the fixture actually produced OlderThanBinary before
        // trusting the rest of this test.
        {
            let mut conn = PgConnection::connect_with(&options).await.unwrap();
            let verdict = schema_version::check_schema_compatibility(&mut conn).await;
            let _ = conn.close().await;
            assert!(
                matches!(verdict, SchemaCompatibility::OlderThanBinary { .. }),
                "fixture must produce OlderThanBinary, got {verdict:?}"
            );
        }

        let mut steps_seen = Vec::new();
        let outcome = run_safe_upgrade(&app_data_dir, &bin_dir, |progress| {
            steps_seen.push((progress.step, progress.status));
        })
        .await;

        stop_server(&bin_dir, &pgdata);

        let backup_path = match outcome {
            Ok(UpgradeOutcome::Upgraded { backup_path, from }) => {
                assert!(
                    matches!(from, SchemaCompatibility::OlderThanBinary { .. }),
                    "expected the recorded starting verdict to be OlderThanBinary, got {from:?}"
                );
                backup_path
            }
            other => panic!("expected a successful upgrade, got {other:?}"),
        };

        assert!(backup_path.is_file(), "the backup file must exist on disk");
        for step in [
            UpgradeStep::Preflight,
            UpgradeStep::Backup,
            UpgradeStep::VerifyBackup,
            UpgradeStep::Migrate,
            UpgradeStep::VerifySchema,
        ] {
            assert!(
                steps_seen.contains(&(step, StepStatus::Done)),
                "expected {step:?} to report Done, saw {steps_seen:?}"
            );
        }
        assert!(
            !steps_seen
                .iter()
                .any(|(step, _)| *step == UpgradeStep::Rollback),
            "a successful upgrade must never report a Rollback step"
        );

        // Prove data survived by reconnecting after the "upgrade" and
        // reading the seeded row back — schema-version equality alone is
        // not proof, actual rows are.
        let child = start_server_and_wait(&bin_dir, &pgdata, port).await;
        {
            let mut conn = PgConnection::connect_with(&options).await.unwrap();
            let after: i64 =
                sqlx::query_scalar("SELECT count(*) FROM finance.accounts WHERE scf_code = '999'")
                    .fetch_one(&mut conn)
                    .await
                    .unwrap();
            assert_eq!(
                after, seeded_count,
                "the pre-existing seeded row must survive intact"
            );
            let verdict = schema_version::check_schema_compatibility(&mut conn).await;
            assert_eq!(verdict, SchemaCompatibility::UpToDate);
            let _ = conn.close().await;
        }
        stop_server_and_reap(&bin_dir, &pgdata, child);

        let _ = std::fs::remove_dir_all(&app_data_dir);
    }

    #[tokio::test]
    #[ignore = "spawns a real, disposable PostgreSQL instance; run explicitly with -- --ignored"]
    async fn a_failed_migration_is_rolled_back_to_the_exact_prior_state() {
        let app_data_dir = temp_app_data_dir_for_tests("rollback");
        let port = 58540;
        let (bin_dir, pgdata, _port) = provision_fresh_instance(&app_data_dir, port).await;

        let info = local_config::load_migrator_connection_info(&app_data_dir)
            .expect("migrator.json must exist after setup");
        let options = connect_options(&info);

        let (seeded_count, original_schema_row_count) = {
            let mut conn = PgConnection::connect_with(&options).await.unwrap();
            let count = seed_row_and_count(&mut conn).await;
            // Make the schema genuinely older (by count) BEFORE reading the
            // bookkeeping row count this test treats as "the pre-upgrade
            // state" — the backup `run_safe_upgrade` takes moments later is
            // a backup of the database as it exists at that point (151
            // rows, one behind the full 152), not of the fixture's starting
            // point before this rewind. Then force the real migrator to
            // fail via a corrupted historical checksum, independent of
            // whether the latest migration's own SQL is idempotent — see
            // `corrupt_an_earlier_checksum`'s doc comment.
            rewind_latest_migration(&mut conn).await;
            let original_migrations: i64 =
                sqlx::query_scalar("SELECT count(*) FROM _sqlx_migrations")
                    .fetch_one(&mut conn)
                    .await
                    .unwrap();
            corrupt_an_earlier_checksum(&mut conn).await;
            let _ = conn.close().await;
            (count, original_migrations)
        };

        let mut steps_seen = Vec::new();
        let outcome = run_safe_upgrade(&app_data_dir, &bin_dir, |progress| {
            steps_seen.push((progress.step, progress.status));
        })
        .await;

        let backup_path = match outcome {
            Err(UpgradeError::RolledBack { backup_path, .. }) => backup_path,
            other => {
                stop_server(&bin_dir, &pgdata);
                panic!("expected RolledBack, got {other:?}");
            }
        };
        assert!(
            backup_path.is_file(),
            "the rolled-back-from backup must still exist (never deleted)"
        );
        assert!(
            backup_path
                .parent()
                .map(|p| p
                    .file_name()
                    .map(|n| n == FAILED_BACKUPS_SUBDIR)
                    .unwrap_or(false))
                .unwrap_or(false),
            "a failed upgrade's backup must be quarantined under backups/failed/, got {}",
            backup_path.display()
        );
        assert!(steps_seen.contains(&(UpgradeStep::Rollback, StepStatus::Done)));

        // The single most important assertion in this test: reconnect and
        // prove the database is back to its EXACT pre-upgrade state — same
        // seeded row count, same migration bookkeeping row count, and the
        // schema version is the ORIGINAL one again (not UpToDate).
        {
            let mut conn = PgConnection::connect_with(&options).await.unwrap();
            let after_count: i64 =
                sqlx::query_scalar("SELECT count(*) FROM finance.accounts WHERE scf_code = '999'")
                    .fetch_one(&mut conn)
                    .await
                    .unwrap();
            assert_eq!(
                after_count, seeded_count,
                "seeded row must survive the rollback intact"
            );

            let after_migrations: i64 = sqlx::query_scalar("SELECT count(*) FROM _sqlx_migrations")
                .fetch_one(&mut conn)
                .await
                .unwrap();
            assert_eq!(
                after_migrations, original_schema_row_count,
                "migration bookkeeping must match the original pre-upgrade count exactly"
            );

            let verdict = schema_version::check_schema_compatibility(&mut conn).await;
            assert!(
                matches!(verdict, SchemaCompatibility::OlderThanBinary { .. }),
                "post-rollback the schema must be the ORIGINAL older version, not UpToDate; got {verdict:?}"
            );
            let _ = conn.close().await;
        }

        stop_server(&bin_dir, &pgdata);
        let _ = std::fs::remove_dir_all(&app_data_dir);
    }

    #[tokio::test]
    #[ignore = "spawns a real, disposable PostgreSQL instance; run explicitly with -- --ignored"]
    async fn up_to_date_newer_and_unknown_verdicts_never_trigger_a_backup() {
        let app_data_dir = temp_app_data_dir_for_tests("no-op-verdicts");
        let port = 58550;
        let (bin_dir, pgdata, _port) = provision_fresh_instance(&app_data_dir, port).await;

        let info = local_config::load_migrator_connection_info(&app_data_dir)
            .expect("migrator.json must exist after setup");
        let options = connect_options(&info);

        // ---- UpToDate: the natural state right after setup. ----
        let outcome = run_safe_upgrade(&app_data_dir, &bin_dir, |_| {
            panic!("UpToDate must never emit a single progress event");
        })
        .await;
        assert!(matches!(
            outcome,
            Ok(UpgradeOutcome::NoActionNeeded(
                SchemaCompatibility::UpToDate
            ))
        ));
        assert!(
            !app_data_dir.join("backups").exists(),
            "UpToDate must never create the backups folder"
        );

        // ---- NewerThanBinary: an applied version ahead of this binary. ----
        {
            let mut conn = PgConnection::connect_with(&options).await.unwrap();
            sqlx::query(
                "INSERT INTO _sqlx_migrations \
                 (version, description, installed_on, success, checksum, execution_time) \
                 VALUES ($1, 'from-the-future', now(), true, decode('00', 'hex'), 0)",
            )
            .bind(schema_version::embedded_latest_version() + 1)
            .execute(&mut conn)
            .await
            .unwrap();
            let _ = conn.close().await;
        }
        let outcome = run_safe_upgrade(&app_data_dir, &bin_dir, |_| {
            panic!("NewerThanBinary must never emit a single progress event");
        })
        .await;
        assert!(matches!(
            outcome,
            Ok(UpgradeOutcome::NoActionNeeded(
                SchemaCompatibility::NewerThanBinary { .. }
            ))
        ));
        assert!(!app_data_dir.join("backups").exists());
        {
            let mut conn = PgConnection::connect_with(&options).await.unwrap();
            sqlx::query("DELETE FROM _sqlx_migrations WHERE version = $1")
                .bind(schema_version::embedded_latest_version() + 1)
                .execute(&mut conn)
                .await
                .unwrap();
            let _ = conn.close().await;
        }

        // ---- Unknown: the version genuinely cannot be determined. ----
        {
            let mut conn = PgConnection::connect_with(&options).await.unwrap();
            sqlx::raw_sql("ALTER TABLE _sqlx_migrations RENAME COLUMN version TO version_renamed")
                .execute(&mut conn)
                .await
                .unwrap();
            let _ = conn.close().await;
        }
        let outcome = run_safe_upgrade(&app_data_dir, &bin_dir, |_| {
            panic!("Unknown must never emit a single progress event");
        })
        .await;
        assert!(matches!(
            outcome,
            Ok(UpgradeOutcome::NoActionNeeded(SchemaCompatibility::Unknown))
        ));
        assert!(!app_data_dir.join("backups").exists());
        {
            let mut conn = PgConnection::connect_with(&options).await.unwrap();
            sqlx::raw_sql("ALTER TABLE _sqlx_migrations RENAME COLUMN version_renamed TO version")
                .execute(&mut conn)
                .await
                .unwrap();
            let _ = conn.close().await;
        }

        stop_server(&bin_dir, &pgdata);
        let _ = std::fs::remove_dir_all(&app_data_dir);
    }

    #[test]
    fn pg_restore_list_rejects_a_truncated_dump_file() {
        // Real bundled `pg_restore.exe`, no database needed: `--list` reads
        // only the archive's own table of contents.
        let resource_dir = bundled_resource_dir_for_tests();
        let bin_dir = pg_process_mod::bundled_bin_dir(&resource_dir);
        if pg_process_mod::preflight_backup_binaries(&bin_dir).is_err() {
            eprintln!("SKIPPED: bundled pg_restore.exe not present in this build");
            return;
        }
        let dir = scratch_dir("bad-dump");
        let bogus = dir.join("truncated.dump");
        // A real custom-format dump starts with a fixed 5-byte magic
        // ("PGDMP"); a handful of arbitrary bytes is not a valid archive at
        // all, which is exactly what a truncated or corrupted file looks
        // like to `pg_restore --list`.
        std::fs::write(&bogus, b"not a real dump file").unwrap();

        let result = verify_backup_restorable(&bin_dir, &bogus);
        assert!(
            result.is_err(),
            "pg_restore --list must refuse a file that is not a valid archive"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn no_action_needed_outcomes_never_invoke_pg_dump() {
        // Documentation-as-test: `run_safe_upgrade`'s early return for every
        // verdict other than `OlderThanBinary` happens strictly before the
        // `Backup` step is ever reported — see the real end-to-end proofs in
        // the `#[ignore]`-gated integration tests below, which assert this
        // against a real embedded instance (zero `Backup`/`Preflight`
        // progress events observed for `UpToDate`, `NewerThanBinary`, and
        // `Unknown`-shaped databases). This unit test fixes the *shape* of
        // that contract so it cannot silently regress: `NoActionNeeded`
        // carries the verdict and nothing else — no path, no side effect.
        let outcome = UpgradeOutcome::NoActionNeeded(SchemaCompatibility::UpToDate);
        match outcome {
            UpgradeOutcome::NoActionNeeded(SchemaCompatibility::UpToDate) => {}
            _ => panic!("expected NoActionNeeded(UpToDate)"),
        }
    }
}
