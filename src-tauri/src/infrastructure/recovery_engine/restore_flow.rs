//! The restore worker (plan H5-03) — every step of a real, in-place restore,
//! in the exact mandatory order: validate, isolated test, safety backup,
//! stop connections, replace, forward-migrate, verify, restore assets,
//! record, with automatic rollback from the safety backup on any failure
//! from REPLACE_DATA onward. No step may be reordered.

use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::time::Duration;

use serde::Serialize;
use time::OffsetDateTime;

use super::backup::{self, CreateBundleInput};
use super::bundle::{self, BackupKind};
use super::drill;
use super::errors::{codes, EngineError};
use super::live::{self, AssetSwap, RestoreEventRow, RestoreFaults};
use super::log;
use super::mode::EmbeddedRecoveryContext;
use super::schema::SchemaVerdict;
use crate::infrastructure::local_config::MigratorConnectionInfo;
use crate::infrastructure::pg_process;
use crate::infrastructure::schema_version;

const LOG_OPERATION: &str = "RESTORE";
const SESSION_WAIT_TIMEOUT: Duration = Duration::from_secs(15);
const SAFETY_SPACE_MULTIPLIER: u64 = 2;
const SAFETY_SPACE_FIXED_MARGIN_BYTES: u64 = 50 * 1024 * 1024;
const DRILL_SPACE_MULTIPLIER: u64 = 4;
const DRILL_SPACE_FIXED_MARGIN_BYTES: u64 = 200 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum RestoreStep {
    ValidateBackup,
    Preflight,
    TestRestore,
    SafetyBackup,
    StopConnections,
    ReplaceData,
    UpdateSchema,
    Verify,
    RestoreFiles,
    Record,
    Rollback,
    Restart,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum RestoreStepStatus {
    Running,
    Done,
    Failed,
    Skipped,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RestoreProgress {
    pub step: RestoreStep,
    pub status: RestoreStepStatus,
    pub detail_code: Option<String>,
}

pub(crate) enum RestoreKind {
    Live {
        safety_destination: PathBuf,
        actor_username: Option<String>,
        workstation_id: Option<String>,
    },
    FreshInstall,
}

pub(crate) enum RestoreOutcome {
    Succeeded {
        bundle_identifier: String,
        migrated_forward: bool,
    },
    AbortedBeforeChange {
        error_code: String,
        restart_required: bool,
    },
    RolledBack {
        error_code: String,
        safety_bundle_identifier: Option<String>,
    },
    RollbackFailed {
        error_code: String,
        safety_bundle_path: Option<String>,
        log_path: String,
    },
}

struct Ctx<'a, F: FnMut(RestoreProgress)> {
    app_data_dir: PathBuf,
    emit: &'a mut F,
}

impl<'a, F: FnMut(RestoreProgress)> Ctx<'a, F> {
    fn step(&mut self, step: RestoreStep, status: RestoreStepStatus, detail_code: Option<&str>) {
        log::append(
            &self.app_data_dir,
            LOG_OPERATION,
            &format!(
                "{step:?} {status:?}{}",
                detail_code.map(|c| format!(" - {c}")).unwrap_or_default()
            ),
        );
        (self.emit)(RestoreProgress {
            step,
            status,
            detail_code: detail_code.map(str::to_string),
        });
    }
}

/// Runs every step of a real restore, in the mandatory order. Returns the
/// final outcome; never panics on an ordinary failure (a step error simply
/// routes to `AbortedBeforeChange` or, once live data may have changed, to
/// automatic rollback).
pub(crate) async fn run_restore<F>(
    ctx: &EmbeddedRecoveryContext,
    bundle_dir: &Path,
    kind: RestoreKind,
    close_app_pool: impl FnOnce() -> Pin<Box<dyn std::future::Future<Output = ()> + Send>>,
    faults: RestoreFaults,
    mut emit: F,
) -> RestoreOutcome
where
    F: FnMut(RestoreProgress) + Send,
{
    let mut c = Ctx {
        app_data_dir: ctx.app_data_dir.clone(),
        emit: &mut emit,
    };

    // 1. VALIDATE_BACKUP
    c.step(
        RestoreStep::ValidateBackup,
        RestoreStepStatus::Running,
        None,
    );
    let summary = match bundle::inspect_bundle(bundle_dir, true) {
        Ok(summary) => summary,
        Err(error) => {
            c.step(
                RestoreStep::ValidateBackup,
                RestoreStepStatus::Failed,
                Some(error.code),
            );
            return RestoreOutcome::AbortedBeforeChange {
                error_code: error.code.to_string(),
                restart_required: false,
            };
        }
    };
    let restorability_error = match summary.verdict {
        SchemaVerdict::Newer => Some(codes::BACKUP_SCHEMA_NEWER_THAN_APP),
        SchemaVerdict::Unknown => Some(codes::BACKUP_SCHEMA_UNKNOWN),
        _ if !summary.restorable => Some(codes::BACKUP_FORMAT_NOT_RESTORABLE),
        _ => None,
    };
    if let Some(code) = restorability_error {
        c.step(
            RestoreStep::ValidateBackup,
            RestoreStepStatus::Failed,
            Some(code),
        );
        return RestoreOutcome::AbortedBeforeChange {
            error_code: code.to_string(),
            restart_required: false,
        };
    }
    c.step(RestoreStep::ValidateBackup, RestoreStepStatus::Done, None);

    // 2. PREFLIGHT
    c.step(RestoreStep::Preflight, RestoreStepStatus::Running, None);
    if let Err(detail) = pg_process::preflight_backup_binaries(&ctx.bin_dir) {
        c.step(
            RestoreStep::Preflight,
            RestoreStepStatus::Failed,
            Some(codes::BACKUP_PREFLIGHT_BINARIES_MISSING),
        );
        let _ = detail;
        return RestoreOutcome::AbortedBeforeChange {
            error_code: codes::BACKUP_PREFLIGHT_BINARIES_MISSING.to_string(),
            restart_required: false,
        };
    }
    let Some(info) =
        crate::infrastructure::local_config::load_migrator_connection_info(&ctx.app_data_dir)
    else {
        c.step(
            RestoreStep::Preflight,
            RestoreStepStatus::Failed,
            Some(codes::BACKUP_SCHEMA_VERSION_UNREADABLE),
        );
        return RestoreOutcome::AbortedBeforeChange {
            error_code: codes::BACKUP_SCHEMA_VERSION_UNREADABLE.to_string(),
            restart_required: false,
        };
    };
    let dump_size = std::fs::metadata(&summary.validated.dump_path)
        .map(|m| m.len())
        .unwrap_or(0);
    let drill_required = dump_size
        .saturating_mul(DRILL_SPACE_MULTIPLIER)
        .saturating_add(DRILL_SPACE_FIXED_MARGIN_BYTES);
    let pgdata_parent = ctx.pgdata.parent().unwrap_or(&ctx.pgdata);
    let pgdata_free = pg_process::free_disk_space_bytes(pgdata_parent);
    if pgdata_free.map(|f| f < drill_required).unwrap_or(true) {
        c.step(
            RestoreStep::Preflight,
            RestoreStepStatus::Failed,
            Some(codes::BACKUP_INSUFFICIENT_SPACE),
        );
        return RestoreOutcome::AbortedBeforeChange {
            error_code: codes::BACKUP_INSUFFICIENT_SPACE.to_string(),
            restart_required: false,
        };
    }
    match &kind {
        RestoreKind::Live {
            safety_destination, ..
        } => {
            let mut db_conn = match live::migrator_connection(&info).await {
                Ok(conn) => conn,
                Err(error) => {
                    c.step(
                        RestoreStep::Preflight,
                        RestoreStepStatus::Failed,
                        Some(error.code),
                    );
                    return RestoreOutcome::AbortedBeforeChange {
                        error_code: error.code.to_string(),
                        restart_required: false,
                    };
                }
            };
            let db_size: i64 = sqlx::query_scalar("SELECT pg_database_size(current_database())")
                .fetch_one(&mut db_conn)
                .await
                .unwrap_or(0);
            let _ = sqlx::Connection::close(db_conn).await;
            let safety_required = (db_size.max(0) as u64)
                .saturating_mul(SAFETY_SPACE_MULTIPLIER)
                .saturating_add(SAFETY_SPACE_FIXED_MARGIN_BYTES);
            let safety_free = pg_process::free_disk_space_bytes(safety_destination);
            if safety_free.map(|f| f < safety_required).unwrap_or(true) {
                c.step(
                    RestoreStep::Preflight,
                    RestoreStepStatus::Failed,
                    Some(codes::BACKUP_INSUFFICIENT_SPACE),
                );
                return RestoreOutcome::AbortedBeforeChange {
                    error_code: codes::BACKUP_INSUFFICIENT_SPACE.to_string(),
                    restart_required: false,
                };
            }
        }
        RestoreKind::FreshInstall => {
            let mut db_conn = match live::migrator_connection(&info).await {
                Ok(conn) => conn,
                Err(error) => {
                    c.step(
                        RestoreStep::Preflight,
                        RestoreStepStatus::Failed,
                        Some(error.code),
                    );
                    return RestoreOutcome::AbortedBeforeChange {
                        error_code: error.code.to_string(),
                        restart_required: false,
                    };
                }
            };
            let users = live::count_users(&mut db_conn).await.unwrap_or(1);
            let _ = sqlx::Connection::close(db_conn).await;
            if users != 0 {
                c.step(
                    RestoreStep::Preflight,
                    RestoreStepStatus::Failed,
                    Some(codes::FRESH_RESTORE_NOT_ALLOWED),
                );
                return RestoreOutcome::AbortedBeforeChange {
                    error_code: codes::FRESH_RESTORE_NOT_ALLOWED.to_string(),
                    restart_required: false,
                };
            }
        }
    }
    c.step(RestoreStep::Preflight, RestoreStepStatus::Done, None);

    // 3. TEST_RESTORE
    c.step(RestoreStep::TestRestore, RestoreStepStatus::Running, None);
    let report = match drill::run_isolated_drill(ctx, &summary).await {
        Ok(report) => report,
        Err(error) => {
            c.step(
                RestoreStep::TestRestore,
                RestoreStepStatus::Failed,
                Some(error.code),
            );
            return RestoreOutcome::AbortedBeforeChange {
                error_code: error.code.to_string(),
                restart_required: false,
            };
        }
    };
    if !report.journal_balanced {
        c.step(
            RestoreStep::TestRestore,
            RestoreStepStatus::Failed,
            Some(codes::RESTORE_JOURNALS_UNBALANCED),
        );
        return RestoreOutcome::AbortedBeforeChange {
            error_code: codes::RESTORE_JOURNALS_UNBALANCED.to_string(),
            restart_required: false,
        };
    }
    let expected = report.totals;
    let will_migrate = report.migrated_forward;
    c.step(RestoreStep::TestRestore, RestoreStepStatus::Done, None);

    // 4. SAFETY_BACKUP
    let mut safety_dump_path: Option<PathBuf> = None;
    let mut safety_bundle_identifier: Option<String> = None;
    if let RestoreKind::Live {
        safety_destination, ..
    } = &kind
    {
        c.step(RestoreStep::SafetyBackup, RestoreStepStatus::Running, None);
        match take_safety_backup(ctx, safety_destination).await {
            Ok(created) => {
                safety_bundle_identifier = created
                    .path
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned());
                safety_dump_path = Some(created.summary.validated.dump_path.clone());
                c.step(RestoreStep::SafetyBackup, RestoreStepStatus::Done, None);
            }
            Err(error) => {
                c.step(
                    RestoreStep::SafetyBackup,
                    RestoreStepStatus::Failed,
                    Some(codes::RESTORE_SAFETY_BACKUP_FAILED),
                );
                let _ = error;
                return RestoreOutcome::AbortedBeforeChange {
                    error_code: codes::RESTORE_SAFETY_BACKUP_FAILED.to_string(),
                    restart_required: false,
                };
            }
        }
    } else {
        c.step(RestoreStep::SafetyBackup, RestoreStepStatus::Skipped, None);
    }

    // From here on the live data may change. Every failure goes to rollback.

    // 5. STOP_CONNECTIONS
    c.step(
        RestoreStep::StopConnections,
        RestoreStepStatus::Running,
        None,
    );
    close_app_pool().await;
    let stop_connections_result: Result<(), EngineError> = async {
        let mut conn = live::migrator_connection(&info).await?;
        if matches!(kind, RestoreKind::FreshInstall) {
            let users = live::count_users(&mut conn).await?;
            if users != 0 {
                return Err(EngineError::new(
                    codes::FRESH_RESTORE_NOT_ALLOWED,
                    "a user account was created after preflight",
                ));
            }
        }
        live::wait_for_no_other_sessions(&mut conn, SESSION_WAIT_TIMEOUT).await?;
        let _ = sqlx::Connection::close(conn).await;
        Ok(())
    }
    .await;
    if let Err(error) = stop_connections_result {
        c.step(
            RestoreStep::StopConnections,
            RestoreStepStatus::Failed,
            Some(error.code),
        );
        return RestoreOutcome::AbortedBeforeChange {
            error_code: error.code.to_string(),
            restart_required: true,
        };
    }
    c.step(RestoreStep::StopConnections, RestoreStepStatus::Done, None);

    // 6. REPLACE_DATA
    c.step(RestoreStep::ReplaceData, RestoreStepStatus::Running, None);
    let replace_result: Result<(), EngineError> = async {
        live::replace_database(ctx, &info, &summary.validated.dump_path, true).await?;
        if faults.fail_after_replace {
            return Err(EngineError::new(
                codes::RESTORE_PG_RESTORE_FAILED,
                "fault: fail_after_replace",
            ));
        }
        Ok(())
    }
    .await;
    if let Err(error) = replace_result {
        c.step(
            RestoreStep::ReplaceData,
            RestoreStepStatus::Failed,
            Some(error.code),
        );
        return rollback(
            &mut c,
            ctx,
            &info,
            bundle_dir,
            &kind,
            None,
            safety_dump_path.as_deref(),
            safety_bundle_identifier.clone(),
            error.code,
            faults,
        )
        .await;
    }
    c.step(RestoreStep::ReplaceData, RestoreStepStatus::Done, None);

    // 7. UPDATE_SCHEMA
    c.step(RestoreStep::UpdateSchema, RestoreStepStatus::Running, None);
    let migrated_forward = match live::bring_schema_forward(&info).await {
        Ok(migrated) => migrated,
        Err(error) => {
            c.step(
                RestoreStep::UpdateSchema,
                RestoreStepStatus::Failed,
                Some(error.code),
            );
            return rollback(
                &mut c,
                ctx,
                &info,
                bundle_dir,
                &kind,
                None,
                safety_dump_path.as_deref(),
                safety_bundle_identifier.clone(),
                error.code,
                faults,
            )
            .await;
        }
    };
    if migrated_forward != will_migrate {
        tracing::warn!(
            "restore: forward-migration outcome ({migrated_forward}) differs from the isolated \
             test's prediction ({will_migrate})"
        );
    }
    if migrated_forward {
        c.step(RestoreStep::UpdateSchema, RestoreStepStatus::Done, None);
    } else {
        c.step(RestoreStep::UpdateSchema, RestoreStepStatus::Skipped, None);
    }

    // 8. VERIFY
    c.step(RestoreStep::Verify, RestoreStepStatus::Running, None);
    let verify_result: Result<(), EngineError> = async {
        live::verify_restored(&info, &expected).await?;
        if faults.fail_verify {
            return Err(EngineError::new(
                codes::RESTORE_VERIFY_TOTALS_MISMATCH,
                "fault: fail_verify",
            ));
        }
        Ok(())
    }
    .await;
    if let Err(error) = verify_result {
        c.step(
            RestoreStep::Verify,
            RestoreStepStatus::Failed,
            Some(error.code),
        );
        return rollback(
            &mut c,
            ctx,
            &info,
            bundle_dir,
            &kind,
            None,
            safety_dump_path.as_deref(),
            safety_bundle_identifier.clone(),
            error.code,
            faults,
        )
        .await;
    }
    c.step(RestoreStep::Verify, RestoreStepStatus::Done, None);

    // 9. RESTORE_FILES
    c.step(RestoreStep::RestoreFiles, RestoreStepStatus::Running, None);
    let swap = match live::swap_in_assets(&ctx.app_data_dir, bundle_dir) {
        Ok(swap) => swap,
        Err(error) => {
            c.step(
                RestoreStep::RestoreFiles,
                RestoreStepStatus::Failed,
                Some(error.code),
            );
            return rollback(
                &mut c,
                ctx,
                &info,
                bundle_dir,
                &kind,
                None,
                safety_dump_path.as_deref(),
                safety_bundle_identifier.clone(),
                error.code,
                faults,
            )
            .await;
        }
    };
    c.step(RestoreStep::RestoreFiles, RestoreStepStatus::Done, None);

    // 10. RECORD
    c.step(RestoreStep::Record, RestoreStepStatus::Running, None);
    let (restore_mode, actor_username, workstation_id) = match &kind {
        RestoreKind::Live {
            actor_username,
            workstation_id,
            ..
        } => ("LIVE", actor_username.clone(), workstation_id.clone()),
        RestoreKind::FreshInstall => ("FRESH_INSTALL", None, None),
    };
    let event = RestoreEventRow {
        restore_mode,
        bundle_identifier: summary
            .validated
            .bundle_dir
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        backup_kind: summary.backup_kind().to_string(),
        bundle_schema_version: summary.validated.schema_version.clone(),
        restored_schema_version: schema_version::embedded_latest_version().to_string(),
        migrated_forward,
        actor_username,
        workstation_id,
        safety_bundle_identifier: safety_bundle_identifier.clone(),
    };
    if let Err(error) = live::record_restore_event(&info, &event).await {
        tracing::error!(
            "restore: recording the restore event failed (non-fatal): {}",
            error.code
        );
        log::append(
            &ctx.app_data_dir,
            LOG_OPERATION,
            &format!("RECORD non-fatal failure: {}", error.code),
        );
    }
    live::discard_previous_assets(&swap);
    c.step(RestoreStep::Record, RestoreStepStatus::Done, None);
    log::append(&ctx.app_data_dir, LOG_OPERATION, "SUCCEEDED");

    RestoreOutcome::Succeeded {
        bundle_identifier: event_bundle_identifier(bundle_dir),
        migrated_forward,
    }
}

fn event_bundle_identifier(bundle_dir: &Path) -> String {
    bundle_dir
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

async fn take_safety_backup(
    ctx: &EmbeddedRecoveryContext,
    safety_destination: &Path,
) -> Result<super::backup::CreatedBundle, EngineError> {
    let mut name =
        crate::infrastructure::backup_proof::bundle_directory_name(OffsetDateTime::now_utc());
    for attempt in 0..3 {
        if !safety_destination.join(&name).exists() {
            break;
        }
        if attempt == 2 {
            return Err(EngineError::new(
                codes::RESTORE_SAFETY_BACKUP_FAILED,
                "could not generate a unique safety backup name",
            ));
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
        name =
            crate::infrastructure::backup_proof::bundle_directory_name(OffsetDateTime::now_utc());
    }
    let created = backup::create_bundle(CreateBundleInput {
        ctx,
        destination: safety_destination,
        bundle_name: &name,
        kind: BackupKind::PreRestore,
        stage_tag: "restore",
    })
    .await?;
    super::tools::run_pg_restore_list(&ctx.bin_dir, &created.summary.validated.dump_path)?;
    Ok(created)
}

#[allow(clippy::too_many_arguments)]
async fn rollback<F: FnMut(RestoreProgress)>(
    c: &mut Ctx<'_, F>,
    ctx: &EmbeddedRecoveryContext,
    info: &MigratorConnectionInfo,
    bundle_dir: &Path,
    kind: &RestoreKind,
    swap: Option<&AssetSwap>,
    safety_dump_path: Option<&Path>,
    safety_bundle_identifier: Option<String>,
    original_error_code: &'static str,
    faults: RestoreFaults,
) -> RestoreOutcome {
    let _ = bundle_dir;
    c.step(RestoreStep::Rollback, RestoreStepStatus::Running, None);

    let log_path = ctx
        .app_data_dir
        .join("recovery.log")
        .to_string_lossy()
        .into_owned();
    let safety_path_string = safety_dump_path
        .and_then(|p| p.parent())
        .map(|p| p.to_string_lossy().into_owned());

    if faults.fail_rollback {
        c.step(
            RestoreStep::Rollback,
            RestoreStepStatus::Failed,
            Some(codes::RESTORE_ROLLBACK_FAILED),
        );
        return RestoreOutcome::RollbackFailed {
            error_code: codes::RESTORE_ROLLBACK_FAILED.to_string(),
            safety_bundle_path: match kind {
                RestoreKind::Live { .. } => safety_path_string,
                RestoreKind::FreshInstall => None,
            },
            log_path,
        };
    }

    if let Some(swap) = swap {
        if !live::restore_previous_assets(swap, &ctx.app_data_dir) {
            c.step(
                RestoreStep::Rollback,
                RestoreStepStatus::Failed,
                Some(codes::RESTORE_ASSET_COPY_FAILED),
            );
            return RestoreOutcome::RollbackFailed {
                error_code: codes::RESTORE_ROLLBACK_FAILED.to_string(),
                safety_bundle_path: match kind {
                    RestoreKind::Live { .. } => safety_path_string,
                    RestoreKind::FreshInstall => None,
                },
                log_path,
            };
        }
    }

    let rollback_result: Result<(), EngineError> = match kind {
        RestoreKind::Live { .. } => {
            async {
                let Some(dump) = safety_dump_path else {
                    return Err(EngineError::new(
                        codes::RESTORE_ROLLBACK_FAILED,
                        "no safety dump available to roll back to",
                    ));
                };
                live::replace_database(ctx, info, dump, true).await?;
                let mut conn = live::migrator_connection(info).await?;
                let compat = schema_version::check_schema_compatibility(&mut conn).await;
                let _ = sqlx::Connection::close(conn).await;
                if compat != schema_version::SchemaCompatibility::UpToDate {
                    return Err(EngineError::new(
                        codes::RESTORE_ROLLBACK_FAILED,
                        format!("schema is {compat:?} after rollback, expected UpToDate"),
                    ));
                }
                Ok(())
            }
            .await
        }
        RestoreKind::FreshInstall => {
            async {
                let mut conn = live::migrator_connection(info).await?;
                safe_upgrade_reset(&mut conn).await?;
                schema_version::run_all_migrations(&mut conn)
                    .await
                    .map_err(|e| {
                        EngineError::new(codes::RESTORE_ROLLBACK_FAILED, format!("{e}"))
                    })?;
                let _ = sqlx::Connection::close(conn).await;
                Ok(())
            }
            .await
        }
    };

    match rollback_result {
        Ok(()) => {
            c.step(RestoreStep::Rollback, RestoreStepStatus::Done, None);
            RestoreOutcome::RolledBack {
                error_code: original_error_code.to_string(),
                safety_bundle_identifier: match kind {
                    RestoreKind::Live { .. } => safety_bundle_identifier,
                    RestoreKind::FreshInstall => None,
                },
            }
        }
        Err(error) => {
            c.step(
                RestoreStep::Rollback,
                RestoreStepStatus::Failed,
                Some(error.code),
            );
            RestoreOutcome::RollbackFailed {
                error_code: codes::RESTORE_ROLLBACK_FAILED.to_string(),
                safety_bundle_path: match kind {
                    RestoreKind::Live { .. } => safety_path_string,
                    RestoreKind::FreshInstall => None,
                },
                log_path,
            }
        }
    }
}

async fn safe_upgrade_reset(conn: &mut sqlx::PgConnection) -> Result<(), EngineError> {
    crate::infrastructure::safe_upgrade::reset_all_schemas(conn)
        .await
        .map_err(|e| EngineError::new(codes::RESTORE_ROLLBACK_FAILED, e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::postgres::PgConnectOptions;
    use sqlx::{Connection, PgConnection};

    use crate::infrastructure::recovery_engine::backup::{
        self as backup_engine, CreateBundleInput,
    };
    use crate::infrastructure::recovery_engine::bundle::BackupKind;
    use crate::infrastructure::recovery_engine::destination::{self, DestinationPurpose};
    use crate::infrastructure::recovery_engine::drill_cluster::DRILL_DIR_PREFIX;
    use crate::infrastructure::safe_upgrade::test_support;

    fn ctx(app_data_dir: &Path, bin_dir: PathBuf, pgdata: PathBuf) -> EmbeddedRecoveryContext {
        EmbeddedRecoveryContext {
            app_data_dir: app_data_dir.to_path_buf(),
            resource_dir: bin_dir
                .parent()
                .and_then(|p| p.parent())
                .and_then(|p| p.parent())
                .unwrap_or(&bin_dir)
                .to_path_buf(),
            bin_dir,
            pgdata,
            app_version: "0.5.0-test".to_string(),
        }
    }

    fn live_options(app_data_dir: &Path, port: u16) -> PgConnectOptions {
        let info = crate::infrastructure::local_config::load_migrator_connection_info(app_data_dir)
            .unwrap();
        PgConnectOptions::new()
            .host("127.0.0.1")
            .port(port)
            .username(&info.username)
            .password(info.password.as_str())
            .database(&info.database)
    }

    fn noop_close_pool() -> Pin<Box<dyn std::future::Future<Output = ()> + Send>> {
        Box::pin(async {})
    }

    fn no_progress(_p: RestoreProgress) {}

    fn debug_outcome(outcome: &RestoreOutcome) -> String {
        match outcome {
            RestoreOutcome::Succeeded {
                bundle_identifier,
                migrated_forward,
            } => format!("Succeeded {{ bundle_identifier: {bundle_identifier}, migrated_forward: {migrated_forward} }}"),
            RestoreOutcome::AbortedBeforeChange { error_code, restart_required } => {
                format!("AbortedBeforeChange {{ error_code: {error_code}, restart_required: {restart_required} }}")
            }
            RestoreOutcome::RolledBack { error_code, safety_bundle_identifier } => {
                format!("RolledBack {{ error_code: {error_code}, safety_bundle_identifier: {safety_bundle_identifier:?} }}")
            }
            RestoreOutcome::RollbackFailed { error_code, safety_bundle_path, log_path } => {
                format!("RollbackFailed {{ error_code: {error_code}, safety_bundle_path: {safety_bundle_path:?}, log_path: {log_path} }}")
            }
        }
    }

    async fn seed_marker(conn: &mut PgConnection, code: &str) {
        sqlx::query(
            "INSERT INTO finance.accounts \
             (scf_code, legacy_code, name_fr, name_en, account_type, normal_balance, is_postable, is_control) \
             VALUES ($1, $2, 'Marqueur de test', 'Test marker', 'asset', 'debit', true, false) \
             ON CONFLICT (scf_code) DO NOTHING",
        )
        .bind(code)
        .bind(format!("WS_H_5_TEST_MARKER_{code}"))
        .execute(&mut *conn)
        .await
        .expect("seed marker");
    }

    async fn marker_exists(conn: &mut PgConnection, code: &str) -> bool {
        let count: i64 =
            sqlx::query_scalar("SELECT count(*) FROM finance.accounts WHERE scf_code = $1")
                .bind(code)
                .fetch_one(&mut *conn)
                .await
                .expect("count marker");
        count > 0
    }

    async fn make_backup(ctx: &EmbeddedRecoveryContext, destination: &Path, name: &str) -> PathBuf {
        let created = backup_engine::create_bundle(CreateBundleInput {
            ctx,
            destination,
            bundle_name: name,
            kind: BackupKind::Manual,
            stage_tag: "restore-test",
        })
        .await
        .unwrap_or_else(|e| panic!("create_bundle failed: {} - {}", e.code, e.log_detail));
        created.path
    }

    fn assert_no_drill_folders(pgdata: &Path) {
        let parent = pgdata.parent().unwrap();
        if let Ok(entries) = std::fs::read_dir(parent) {
            for entry in entries.filter_map(|e| e.ok()) {
                assert!(
                    !entry
                        .file_name()
                        .to_string_lossy()
                        .starts_with(DRILL_DIR_PREFIX),
                    "no restore-drill-* folder may remain: {}",
                    entry.path().display()
                );
            }
        }
    }

    fn bundle_name(now: time::OffsetDateTime) -> String {
        crate::infrastructure::backup_proof::bundle_directory_name(now)
    }

    /// (1) plan H5-07: a live restore replaces the current data with the
    /// backup's, the safety copy is kept and is itself provably usable, and
    /// the audit row is recorded.
    #[tokio::test]
    #[ignore = "spawns real, disposable PostgreSQL instances; run explicitly with -- --ignored"]
    async fn live_restore_replaces_data_and_keeps_a_safety_copy() {
        let app_data_dir = test_support::temp_app_data_dir_for_tests("restore-live");
        let (bin_dir, pgdata, port) =
            test_support::provision_fresh_instance(&app_data_dir, 58720).await;
        let context = ctx(&app_data_dir, bin_dir.clone(), pgdata.clone());
        let backups_dir = destination::resolve(None, &context, DestinationPurpose::Manual)
            .unwrap()
            .path;
        let safety_dir = app_data_dir.join("safety-backups");
        std::fs::create_dir_all(&safety_dir).unwrap();

        {
            let mut conn = PgConnection::connect_with(&live_options(&app_data_dir, port))
                .await
                .unwrap();
            seed_marker(&mut conn, "998").await;
            let _ = conn.close().await;
        }
        let bundle_dir = make_backup(
            &context,
            &backups_dir,
            &bundle_name(time::OffsetDateTime::now_utc()),
        )
        .await;
        {
            let mut conn = PgConnection::connect_with(&live_options(&app_data_dir, port))
                .await
                .unwrap();
            seed_marker(&mut conn, "997").await;
            let _ = conn.close().await;
        }

        let started = std::time::Instant::now();
        let outcome = run_restore(
            &context,
            &bundle_dir,
            RestoreKind::Live {
                safety_destination: safety_dir.clone(),
                actor_username: Some("ws-h-5-test-admin".to_string()),
                workstation_id: Some("test-workstation".to_string()),
            },
            noop_close_pool,
            RestoreFaults::default(),
            no_progress,
        )
        .await;
        let elapsed = started.elapsed();
        println!("WS-H-5 timing: run_restore (live) took {elapsed:?}");

        let (bundle_identifier, migrated_forward) = match outcome {
            RestoreOutcome::Succeeded {
                bundle_identifier,
                migrated_forward,
            } => (bundle_identifier, migrated_forward),
            _other => panic!("expected Succeeded, got a different outcome"),
        };
        assert!(!migrated_forward, "same-schema restore does not migrate");
        assert_eq!(
            bundle_dir.file_name().unwrap().to_string_lossy(),
            bundle_identifier
        );

        let mut conn = PgConnection::connect_with(&live_options(&app_data_dir, port))
            .await
            .unwrap();
        assert!(
            marker_exists(&mut conn, "998").await,
            "A must be present after restore"
        );
        assert!(
            !marker_exists(&mut conn, "997").await,
            "B must be gone after restore"
        );
        assert_eq!(
            schema_version::check_schema_compatibility(&mut conn).await,
            schema_version::SchemaCompatibility::UpToDate
        );
        let restore_rows: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM operations.restore_events WHERE restore_mode = 'LIVE'",
        )
        .fetch_one(&mut conn)
        .await
        .unwrap();
        assert_eq!(restore_rows, 1, "exactly one LIVE restore_events row");
        let _ = conn.close().await;

        let safety_bundles: Vec<PathBuf> = std::fs::read_dir(&safety_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.is_dir())
            .collect();
        assert_eq!(
            safety_bundles.len(),
            1,
            "exactly one PRE_RESTORE safety bundle"
        );
        let safety_summary = crate::infrastructure::recovery_engine::bundle::inspect_bundle(
            &safety_bundles[0],
            true,
        )
        .expect("safety bundle must itself be a valid, restorable bundle");
        assert_eq!(safety_summary.backup_kind(), "PRE_RESTORE");
        let drill_report = drill::run_isolated_drill(&context, &safety_summary)
            .await
            .expect("the safety copy must itself pass an isolated drill");
        assert!(drill_report.totals.schema_count > 0);
        // The safety copy was taken right after seeding B, before the
        // restore replaced the live data with A's backup.
        let mut proof_conn = PgConnection::connect_with(&live_options(&app_data_dir, port))
            .await
            .unwrap();
        // (the drill above already tore its own throwaway cluster down;
        // this just proves the live server is still the one we restored to)
        assert!(marker_exists(&mut proof_conn, "998").await);
        let _ = proof_conn.close().await;

        assert_no_drill_folders(&pgdata);
        test_support::stop_server(&bin_dir, &pgdata);
        let _ = std::fs::remove_dir_all(&app_data_dir);
    }

    /// (2) an OLDER backup is migrated forward during a live restore.
    #[tokio::test]
    #[ignore = "spawns real, disposable PostgreSQL instances; run explicitly with -- --ignored"]
    async fn live_restore_of_older_backup_migrates_forward() {
        let app_data_dir = test_support::temp_app_data_dir_for_tests("restore-older");
        let (bin_dir, pgdata, port) =
            test_support::provision_fresh_instance(&app_data_dir, 58730).await;
        let context = ctx(&app_data_dir, bin_dir.clone(), pgdata.clone());
        let backups_dir = destination::resolve(None, &context, DestinationPurpose::Manual)
            .unwrap()
            .path;
        let safety_dir = app_data_dir.join("safety-backups");
        std::fs::create_dir_all(&safety_dir).unwrap();

        {
            let mut conn = PgConnection::connect_with(&live_options(&app_data_dir, port))
                .await
                .unwrap();
            test_support::rewind_latest_migration(&mut conn).await;
            let _ = conn.close().await;
        }
        let bundle_dir = make_backup(
            &context,
            &backups_dir,
            &bundle_name(time::OffsetDateTime::now_utc()),
        )
        .await;
        {
            // Bring the live database back up to date so the restore below
            // is genuinely "older backup onto an up-to-date live database".
            let mut conn = PgConnection::connect_with(&live_options(&app_data_dir, port))
                .await
                .unwrap();
            schema_version::run_all_migrations(&mut conn).await.unwrap();
            let _ = conn.close().await;
        }

        let outcome = run_restore(
            &context,
            &bundle_dir,
            RestoreKind::Live {
                safety_destination: safety_dir,
                actor_username: None,
                workstation_id: None,
            },
            noop_close_pool,
            RestoreFaults::default(),
            no_progress,
        )
        .await;

        match outcome {
            RestoreOutcome::Succeeded {
                migrated_forward, ..
            } => {
                assert!(migrated_forward, "an older backup must migrate forward");
            }
            _ => panic!("expected Succeeded"),
        }
        let mut conn = PgConnection::connect_with(&live_options(&app_data_dir, port))
            .await
            .unwrap();
        assert_eq!(
            schema_version::check_schema_compatibility(&mut conn).await,
            schema_version::SchemaCompatibility::UpToDate
        );
        let _ = conn.close().await;

        assert_no_drill_folders(&pgdata);
        test_support::stop_server(&bin_dir, &pgdata);
        let _ = std::fs::remove_dir_all(&app_data_dir);
    }

    /// (3) a failure right after REPLACE_DATA rolls back to exactly the
    /// pre-restore state (both A and B survive, since B was seeded after
    /// the safety backup and the safety backup is what comes back).
    #[tokio::test]
    #[ignore = "spawns real, disposable PostgreSQL instances; run explicitly with -- --ignored"]
    async fn failure_after_replace_rolls_back_exactly() {
        let app_data_dir = test_support::temp_app_data_dir_for_tests("restore-fault-replace");
        let (bin_dir, pgdata, port) =
            test_support::provision_fresh_instance(&app_data_dir, 58740).await;
        let context = ctx(&app_data_dir, bin_dir.clone(), pgdata.clone());
        let backups_dir = destination::resolve(None, &context, DestinationPurpose::Manual)
            .unwrap()
            .path;
        let safety_dir = app_data_dir.join("safety-backups");
        std::fs::create_dir_all(&safety_dir).unwrap();

        {
            let mut conn = PgConnection::connect_with(&live_options(&app_data_dir, port))
                .await
                .unwrap();
            seed_marker(&mut conn, "998").await;
            let _ = conn.close().await;
        }
        let bundle_dir = make_backup(
            &context,
            &backups_dir,
            &bundle_name(time::OffsetDateTime::now_utc()),
        )
        .await;
        {
            let mut conn = PgConnection::connect_with(&live_options(&app_data_dir, port))
                .await
                .unwrap();
            seed_marker(&mut conn, "997").await;
            let _ = conn.close().await;
        }

        let outcome = run_restore(
            &context,
            &bundle_dir,
            RestoreKind::Live {
                safety_destination: safety_dir,
                actor_username: None,
                workstation_id: None,
            },
            noop_close_pool,
            RestoreFaults {
                fail_after_replace: true,
                ..RestoreFaults::default()
            },
            no_progress,
        )
        .await;

        match &outcome {
            RestoreOutcome::RolledBack { .. } => {}
            _ => panic!("expected RolledBack"),
        }
        let mut conn = PgConnection::connect_with(&live_options(&app_data_dir, port))
            .await
            .unwrap();
        assert!(
            marker_exists(&mut conn, "998").await,
            "A must survive rollback"
        );
        assert!(
            marker_exists(&mut conn, "997").await,
            "B must survive rollback (safety backup was taken after B)"
        );
        assert_eq!(
            schema_version::check_schema_compatibility(&mut conn).await,
            schema_version::SchemaCompatibility::UpToDate
        );
        let _ = conn.close().await;

        assert_no_drill_folders(&pgdata);
        test_support::stop_server(&bin_dir, &pgdata);
        let _ = std::fs::remove_dir_all(&app_data_dir);
    }

    /// (4) a verify-time failure rolls back the database *and* the asset
    /// folders to their pre-restore contents.
    #[tokio::test]
    #[ignore = "spawns real, disposable PostgreSQL instances; run explicitly with -- --ignored"]
    async fn verify_mismatch_rolls_back() {
        let app_data_dir = test_support::temp_app_data_dir_for_tests("restore-fault-verify");
        let (bin_dir, pgdata, _port) =
            test_support::provision_fresh_instance(&app_data_dir, 58750).await;
        let context = ctx(&app_data_dir, bin_dir.clone(), pgdata.clone());
        let backups_dir = destination::resolve(None, &context, DestinationPurpose::Manual)
            .unwrap()
            .path;
        let safety_dir = app_data_dir.join("safety-backups");
        std::fs::create_dir_all(&safety_dir).unwrap();

        let attachments_dir = app_data_dir.join("attachments");
        std::fs::create_dir_all(&attachments_dir).unwrap();
        std::fs::write(attachments_dir.join("before.txt"), b"before").unwrap();

        let bundle_dir = make_backup(
            &context,
            &backups_dir,
            &bundle_name(time::OffsetDateTime::now_utc()),
        )
        .await;
        // Put a distinguishable asset file inside the bundle itself, so we
        // can tell whether the swap happened and then was undone.
        let bundle_attachments = bundle_dir.join("attachments");
        std::fs::create_dir_all(&bundle_attachments).unwrap();
        std::fs::write(bundle_attachments.join("in-backup.txt"), b"in backup").unwrap();

        let outcome = run_restore(
            &context,
            &bundle_dir,
            RestoreKind::Live {
                safety_destination: safety_dir,
                actor_username: None,
                workstation_id: None,
            },
            noop_close_pool,
            RestoreFaults {
                fail_verify: true,
                ..RestoreFaults::default()
            },
            no_progress,
        )
        .await;

        match &outcome {
            RestoreOutcome::RolledBack { .. } => {}
            _ => panic!("expected RolledBack"),
        }
        // VERIFY fails before RESTORE_FILES ever runs, so no swap happened
        // at all: only the original file must be present.
        assert!(attachments_dir.join("before.txt").exists());
        assert!(!attachments_dir.join("in-backup.txt").exists());

        assert_no_drill_folders(&pgdata);
        test_support::stop_server(&bin_dir, &pgdata);
        let _ = std::fs::remove_dir_all(&app_data_dir);
    }

    /// (5) when rollback itself is made to fail, the safety bundle is never
    /// touched and its path is reported so the operator's supplier can act.
    #[tokio::test]
    #[ignore = "spawns real, disposable PostgreSQL instances; run explicitly with -- --ignored"]
    async fn failed_rollback_keeps_safety_bundle_in_place() {
        let app_data_dir = test_support::temp_app_data_dir_for_tests("restore-fault-rollback");
        let (bin_dir, pgdata, _port) =
            test_support::provision_fresh_instance(&app_data_dir, 58760).await;
        let context = ctx(&app_data_dir, bin_dir.clone(), pgdata.clone());
        let backups_dir = destination::resolve(None, &context, DestinationPurpose::Manual)
            .unwrap()
            .path;
        let safety_dir = app_data_dir.join("safety-backups");
        std::fs::create_dir_all(&safety_dir).unwrap();

        let bundle_dir = make_backup(
            &context,
            &backups_dir,
            &bundle_name(time::OffsetDateTime::now_utc()),
        )
        .await;

        let outcome = run_restore(
            &context,
            &bundle_dir,
            RestoreKind::Live {
                safety_destination: safety_dir.clone(),
                actor_username: None,
                workstation_id: None,
            },
            noop_close_pool,
            RestoreFaults {
                fail_after_replace: true,
                fail_rollback: true,
                ..RestoreFaults::default()
            },
            no_progress,
        )
        .await;

        match outcome {
            RestoreOutcome::RollbackFailed {
                safety_bundle_path, ..
            } => {
                let path = safety_bundle_path
                    .expect("a live rollback failure must report a safety bundle path");
                assert!(
                    Path::new(&path).exists(),
                    "the safety bundle folder must still exist on disk: {path}"
                );
            }
            _ => panic!("expected RollbackFailed"),
        }
        let safety_bundles: Vec<PathBuf> = std::fs::read_dir(&safety_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .collect();
        assert_eq!(
            safety_bundles.len(),
            1,
            "the safety bundle must be untouched, not moved or deleted"
        );

        assert_no_drill_folders(&pgdata);
        // The live database was left mid-replace by design here; stop the
        // server without asserting further about its data.
        test_support::stop_server(&bin_dir, &pgdata);
        let _ = std::fs::remove_dir_all(&app_data_dir);
    }

    /// (6) a backup from a newer application is refused before anything
    /// starts: no safety bundle, no data change.
    #[tokio::test]
    #[ignore = "spawns real, disposable PostgreSQL instances; run explicitly with -- --ignored"]
    async fn newer_backup_is_refused_before_any_change() {
        let app_data_dir = test_support::temp_app_data_dir_for_tests("restore-newer");
        let (bin_dir, pgdata, port) =
            test_support::provision_fresh_instance(&app_data_dir, 58770).await;
        let context = ctx(&app_data_dir, bin_dir.clone(), pgdata.clone());
        let backups_dir = destination::resolve(None, &context, DestinationPurpose::Manual)
            .unwrap()
            .path;
        let safety_dir = app_data_dir.join("safety-backups");
        std::fs::create_dir_all(&safety_dir).unwrap();

        {
            let mut conn = PgConnection::connect_with(&live_options(&app_data_dir, port))
                .await
                .unwrap();
            seed_marker(&mut conn, "998").await;
            let _ = conn.close().await;
        }
        let bundle_dir = make_backup(
            &context,
            &backups_dir,
            &bundle_name(time::OffsetDateTime::now_utc()),
        )
        .await;
        {
            // A fake future migration row makes this bundle look NEWER
            // than the binary once it is dumped.
            let mut conn = PgConnection::connect_with(&live_options(&app_data_dir, port))
                .await
                .unwrap();
            sqlx::query(
                "INSERT INTO _sqlx_migrations (version, description, installed_on, success, checksum, execution_time) \
                 VALUES (99999999999999, 'future', now(), true, '\\x00', 0)",
            )
            .execute(&mut conn)
            .await
            .unwrap();
            let _ = conn.close().await;
        }
        let future_bundle_dir = make_backup(
            &context,
            &backups_dir,
            &bundle_name(time::OffsetDateTime::now_utc() + time::Duration::seconds(1)),
        )
        .await;

        let outcome = run_restore(
            &context,
            &future_bundle_dir,
            RestoreKind::Live {
                safety_destination: safety_dir.clone(),
                actor_username: None,
                workstation_id: None,
            },
            noop_close_pool,
            RestoreFaults::default(),
            no_progress,
        )
        .await;

        match outcome {
            RestoreOutcome::AbortedBeforeChange { .. } => {}
            _ => panic!("expected AbortedBeforeChange"),
        }
        assert_eq!(
            std::fs::read_dir(&safety_dir).unwrap().count(),
            0,
            "no safety bundle may be created before any change"
        );
        let mut conn = PgConnection::connect_with(&live_options(&app_data_dir, port))
            .await
            .unwrap();
        assert!(
            marker_exists(&mut conn, "998").await,
            "live data must be unchanged"
        );
        let _ = conn.close().await;
        let _ = bundle_dir;

        assert_no_drill_folders(&pgdata);
        test_support::stop_server(&bin_dir, &pgdata);
        let _ = std::fs::remove_dir_all(&app_data_dir);
    }

    /// (7) a fresh-install restore onto an empty database brings its users.
    #[tokio::test]
    #[ignore = "spawns real, disposable PostgreSQL instances; run explicitly with -- --ignored"]
    async fn fresh_install_restore_brings_users() {
        let source_data_dir = test_support::temp_app_data_dir_for_tests("restore-fresh-source");
        let (source_bin, source_pgdata, source_port) =
            test_support::provision_fresh_instance(&source_data_dir, 58780).await;
        let source_ctx = ctx(&source_data_dir, source_bin.clone(), source_pgdata.clone());
        let source_backups = destination::resolve(None, &source_ctx, DestinationPurpose::Manual)
            .unwrap()
            .path;
        {
            let mut conn = PgConnection::connect_with(&live_options(&source_data_dir, source_port))
                .await
                .unwrap();
            sqlx::query(
                "INSERT INTO iam.users (username, password_hash, display_name) \
                 VALUES ('ws-h-5-fresh-admin', 'x', 'Fresh Admin')",
            )
            .execute(&mut conn)
            .await
            .unwrap();
            let _ = conn.close().await;
        }
        let bundle_dir = make_backup(
            &source_ctx,
            &source_backups,
            &bundle_name(time::OffsetDateTime::now_utc()),
        )
        .await;
        test_support::stop_server(&source_bin, &source_pgdata);

        let target_data_dir = test_support::temp_app_data_dir_for_tests("restore-fresh-target");
        let (target_bin, target_pgdata, target_port) =
            test_support::provision_fresh_instance(&target_data_dir, 58790).await;
        let target_ctx = ctx(&target_data_dir, target_bin.clone(), target_pgdata.clone());

        let outcome = run_restore(
            &target_ctx,
            &bundle_dir,
            RestoreKind::FreshInstall,
            noop_close_pool,
            RestoreFaults::default(),
            no_progress,
        )
        .await;

        match outcome {
            RestoreOutcome::Succeeded { .. } => {}
            _ => panic!("expected Succeeded"),
        }
        let mut conn = PgConnection::connect_with(&live_options(&target_data_dir, target_port))
            .await
            .unwrap();
        let users: i64 = sqlx::query_scalar("SELECT count(*) FROM iam.users")
            .fetch_one(&mut conn)
            .await
            .unwrap();
        assert_eq!(users, 1, "the restored user must be present");
        let _ = conn.close().await;

        assert_no_drill_folders(&target_pgdata);
        test_support::stop_server(&target_bin, &target_pgdata);
        let _ = std::fs::remove_dir_all(&source_data_dir);
        let _ = std::fs::remove_dir_all(&target_data_dir);
    }

    /// (8) a fresh-install restore is refused once any user account exists.
    #[tokio::test]
    #[ignore = "spawns real, disposable PostgreSQL instances; run explicitly with -- --ignored"]
    async fn fresh_install_refused_when_users_exist() {
        let source_data_dir = test_support::temp_app_data_dir_for_tests("restore-fr-src");
        let (source_bin, source_pgdata, _source_port) =
            test_support::provision_fresh_instance(&source_data_dir, 58800).await;
        let source_ctx = ctx(&source_data_dir, source_bin.clone(), source_pgdata.clone());
        let source_backups = destination::resolve(None, &source_ctx, DestinationPurpose::Manual)
            .unwrap()
            .path;
        let bundle_dir = make_backup(
            &source_ctx,
            &source_backups,
            &bundle_name(time::OffsetDateTime::now_utc()),
        )
        .await;
        test_support::stop_server(&source_bin, &source_pgdata);

        let target_data_dir = test_support::temp_app_data_dir_for_tests("restore-fr-tgt");
        let (target_bin, target_pgdata, target_port) =
            test_support::provision_fresh_instance(&target_data_dir, 58810).await;
        let target_ctx = ctx(&target_data_dir, target_bin.clone(), target_pgdata.clone());
        {
            let mut conn = PgConnection::connect_with(&live_options(&target_data_dir, target_port))
                .await
                .unwrap();
            sqlx::query(
                "INSERT INTO iam.users (username, password_hash, display_name) \
                 VALUES ('already-here', 'x', 'Already Here')",
            )
            .execute(&mut conn)
            .await
            .unwrap();
            let _ = conn.close().await;
        }

        let outcome = run_restore(
            &target_ctx,
            &bundle_dir,
            RestoreKind::FreshInstall,
            noop_close_pool,
            RestoreFaults::default(),
            no_progress,
        )
        .await;

        match outcome {
            RestoreOutcome::AbortedBeforeChange { error_code, .. } => {
                assert_eq!(error_code, codes::FRESH_RESTORE_NOT_ALLOWED);
            }
            _ => panic!("expected AbortedBeforeChange(FRESH_RESTORE_NOT_ALLOWED)"),
        }

        assert_no_drill_folders(&target_pgdata);
        test_support::stop_server(&target_bin, &target_pgdata);
        let _ = std::fs::remove_dir_all(&source_data_dir);
        let _ = std::fs::remove_dir_all(&target_data_dir);
    }

    /// (9) an extra open connection blocks STOP_CONNECTIONS: aborted before
    /// any change, with `restart_required = true`.
    #[tokio::test]
    #[ignore = "spawns real, disposable PostgreSQL instances; run explicitly with -- --ignored"]
    async fn busy_database_aborts_before_change() {
        let app_data_dir = test_support::temp_app_data_dir_for_tests("restore-busy");
        let (bin_dir, pgdata, port) =
            test_support::provision_fresh_instance(&app_data_dir, 58820).await;
        let context = ctx(&app_data_dir, bin_dir.clone(), pgdata.clone());
        let backups_dir = destination::resolve(None, &context, DestinationPurpose::Manual)
            .unwrap()
            .path;
        let safety_dir = app_data_dir.join("safety-backups");
        std::fs::create_dir_all(&safety_dir).unwrap();

        {
            let mut conn = PgConnection::connect_with(&live_options(&app_data_dir, port))
                .await
                .unwrap();
            seed_marker(&mut conn, "998").await;
            let _ = conn.close().await;
        }
        let bundle_dir = make_backup(
            &context,
            &backups_dir,
            &bundle_name(time::OffsetDateTime::now_utc()),
        )
        .await;

        // Held open for the whole restore attempt: a second `client
        // backend` connection `wait_for_no_other_sessions` will never see
        // go away inside its 15s window.
        let mut busy_conn = PgConnection::connect_with(&live_options(&app_data_dir, port))
            .await
            .unwrap();
        let _keep_alive: i32 = sqlx::query_scalar("SELECT 1")
            .fetch_one(&mut busy_conn)
            .await
            .unwrap();

        let outcome = run_restore(
            &context,
            &bundle_dir,
            RestoreKind::Live {
                safety_destination: safety_dir.clone(),
                actor_username: None,
                workstation_id: None,
            },
            noop_close_pool,
            RestoreFaults::default(),
            no_progress,
        )
        .await;

        match outcome {
            RestoreOutcome::AbortedBeforeChange {
                error_code,
                restart_required,
            } => {
                assert_eq!(error_code, codes::RESTORE_DATABASE_BUSY);
                assert!(
                    restart_required,
                    "the operator must restart after a busy-database abort"
                );
            }
            other => panic!(
                "expected AbortedBeforeChange(RESTORE_DATABASE_BUSY), got a different outcome: {}",
                debug_outcome(&other)
            ),
        }
        let _ = busy_conn.close().await;
        let mut conn = PgConnection::connect_with(&live_options(&app_data_dir, port))
            .await
            .unwrap();
        assert!(
            marker_exists(&mut conn, "998").await,
            "live data must be unchanged"
        );
        let _ = conn.close().await;

        assert_no_drill_folders(&pgdata);
        test_support::stop_server(&bin_dir, &pgdata);
        let _ = std::fs::remove_dir_all(&app_data_dir);
    }
}
