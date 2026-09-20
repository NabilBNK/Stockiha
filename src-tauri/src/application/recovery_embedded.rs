//! WS-H-3 — EMBEDDED-mode recovery orchestration (plan H3-06/H3-07).
//!
//! Sits between the mode-dispatching Tauri commands (`commands::recovery`)
//! and the Tauri-free engine (`infrastructure::recovery_engine`). Owns the
//! audit envelope (`operations.begin_/complete_recovery_attempt`), the
//! bundle-identifier collision retry, and the translation of an engine
//! summary into the safe IPC result shape. Never touches the EXTERNAL-mode
//! code paths in `recovery` / `recovery_creation` — it only reuses their
//! audit helpers, which do exactly what the plan's step 1 requires.

use std::path::PathBuf;
use std::time::Duration;

use serde_json::Value as JsonValue;
use sqlx::{query_scalar, PgPool};

use crate::domain::recovery::{
    BackupDestinationSetting, BackupStatus, CopyBackupToResult, CreateOperatorBackupRequest,
    ListBackupsResponse, OperatorBackupCreationResult, OperatorBackupValidationResult,
    OperatorRestoreVerificationResult, RecoveryCapabilities, RecoveryCapabilitiesRow,
    UpdateBackupDestinationResult, ValidateOperatorBackupRequest,
    VerifyOperatorBackupRestoreRequest,
};
use crate::error::AppError;
use crate::infrastructure::backup_proof;
use crate::infrastructure::recovery_engine::backup::{self, CreateBundleInput};
use crate::infrastructure::recovery_engine::bundle::{self, BackupKind, BundleSummary};
use crate::infrastructure::recovery_engine::catalog;
use crate::infrastructure::recovery_engine::copy;
use crate::infrastructure::recovery_engine::destination::{self, DestinationPurpose};
use crate::infrastructure::recovery_engine::drill;
use crate::infrastructure::recovery_engine::errors::{codes, EngineError};
use crate::infrastructure::recovery_engine::log;
use crate::infrastructure::recovery_engine::mode::EmbeddedRecoveryContext;

use super::recovery::{self, RestoreVerificationAttempt, ValidationAttempt};
use super::recovery_creation::{self, CreationAttempt};

/// Two backups started in the same second collide on the clock-based bundle
/// name (unique index + folder check). Retry with the next second, at most
/// this many times (edge case E-02).
const IDENTIFIER_COLLISION_ATTEMPTS: u32 = 3;

// ---------------------------------------------------------------------------
// Mode-independent reads (work in EMBEDDED and EXTERNAL mode).
// ---------------------------------------------------------------------------

pub(crate) async fn fetch_capabilities(
    pool: &PgPool,
    session_token: &str,
    mode: &str,
) -> Result<RecoveryCapabilities, AppError> {
    let value: JsonValue = query_scalar("SELECT operations.get_recovery_capabilities($1)")
        .bind(session_token)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;
    let row: RecoveryCapabilitiesRow = serde_json::from_value(value).map_err(|error| {
        AppError::internal(format!("failed to parse recovery capabilities: {error}"))
    })?;
    Ok(RecoveryCapabilities {
        mode: mode.to_string(),
        can_create_backup: row.can_create_backup,
        can_validate_backup: row.can_validate_backup,
        can_verify_restore: row.can_verify_restore,
        can_restore_live: row.can_restore_live,
    })
}

pub(crate) async fn fetch_backup_status(
    pool: &PgPool,
    session_token: &str,
) -> Result<BackupStatus, AppError> {
    let value: JsonValue = query_scalar("SELECT operations.get_backup_status($1)")
        .bind(session_token)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;
    serde_json::from_value(value)
        .map_err(|error| AppError::internal(format!("failed to parse backup status: {error}")))
}

// ---------------------------------------------------------------------------
// Destination (EMBEDDED).
// ---------------------------------------------------------------------------

/// Stored setting → effective folder (plan §5.8 `get_backup_destination_setting`).
pub(crate) async fn get_destination(
    pool: &PgPool,
    session_token: &str,
    ctx: &EmbeddedRecoveryContext,
) -> Result<BackupDestinationSetting, AppError> {
    let stored = recovery::get_backup_destination(pool, session_token)
        .await?
        .path;
    match destination::resolve(stored.as_deref(), ctx, DestinationPurpose::Manual) {
        Ok(resolved) => Ok(BackupDestinationSetting {
            same_drive_warning: destination::same_drive(&resolved.path, &ctx.pgdata),
            effective_path: Some(resolved.path.to_string_lossy().into_owned()),
            is_default: resolved.is_default,
            available: true,
            path: stored,
        }),
        Err(error) if error.code == codes::BACKUP_DESTINATION_UNAVAILABLE => {
            log::append(
                &ctx.app_data_dir,
                "DESTINATION",
                &format!("UNAVAILABLE - {}", error.log_detail),
            );
            Ok(BackupDestinationSetting {
                effective_path: stored.clone(),
                is_default: false,
                available: false,
                same_drive_warning: false,
                path: stored,
            })
        }
        Err(error) => Err(error.to_app_error()),
    }
}

/// `check_candidate` (§5.5) then the existing SQL setter, which itself
/// enforces `CREATE_BACKUP_BUNDLE` and stores the user's trimmed path.
pub(crate) async fn update_destination(
    pool: &PgPool,
    session_token: &str,
    ctx: &EmbeddedRecoveryContext,
    path: &str,
) -> Result<UpdateBackupDestinationResult, AppError> {
    let check = destination::check_candidate(path, ctx).map_err(|error| {
        log::append(
            &ctx.app_data_dir,
            "DESTINATION",
            &format!("REFUSED: {} - {}", error.code, error.log_detail),
        );
        error.to_app_error()
    })?;

    let value: JsonValue =
        query_scalar("SELECT operations.update_backup_destination_setting($1, $2)")
            .bind(session_token)
            .bind(path.trim())
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;
    let saved_path = value
        .get("path")
        .and_then(JsonValue::as_str)
        .map(str::to_string);
    log::append(
        &ctx.app_data_dir,
        "DESTINATION",
        &format!(
            "SAVED: {} same_drive={}",
            check.canonical.display(),
            check.same_drive_warning
        ),
    );
    Ok(UpdateBackupDestinationResult {
        path: saved_path,
        same_drive_warning: check.same_drive_warning,
    })
}

// ---------------------------------------------------------------------------
// Manual backup (EMBEDDED) — plan §5.10 F1.
// ---------------------------------------------------------------------------

pub(crate) async fn create_manual_backup(
    pool: &PgPool,
    session_token: &str,
    ctx: &EmbeddedRecoveryContext,
    request: CreateOperatorBackupRequest,
) -> Result<OperatorBackupCreationResult, AppError> {
    // Step 1: audit row, with the same-second collision retry.
    let mut attempts = 0;
    let (attempt_id, request_id, bundle_identifier, resume_existing) = loop {
        attempts += 1;
        match recovery_creation::begin_operator_backup_creation(
            pool,
            session_token,
            request.clone(),
        )
        .await
        {
            Ok(CreationAttempt::Replay(result)) => return Ok(result),
            Ok(CreationAttempt::Run {
                attempt_id,
                request_id,
                bundle_identifier,
                resume_existing,
                ..
            }) => break (attempt_id, request_id, bundle_identifier, resume_existing),
            Err(AppError::IdempotencyConflict { .. })
                if attempts < IDENTIFIER_COLLISION_ATTEMPTS =>
            {
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
            Err(AppError::IdempotencyConflict { .. }) => {
                return Err(AppError::BackupCreationFailed {
                    diagnostic: codes::BACKUP_IDENTIFIER_COLLISION.to_string(),
                });
            }
            Err(error) => return Err(error),
        }
    };

    // Step 2: destination.
    let outcome = async {
        let stored = recovery::get_backup_destination(pool, session_token)
            .await?
            .path;
        let resolved = destination::resolve(stored.as_deref(), ctx, DestinationPurpose::Manual)
            .map_err(|error| error.to_app_error())?;

        // A crash after publish but before completion leaves a STARTED row
        // whose folder already exists: replaying that request id resumes
        // it by inspecting the published bundle (same rule as EXTERNAL).
        let final_path = resolved.path.join(&bundle_identifier);
        if resume_existing && final_path.exists() {
            let dir = final_path.clone();
            let summary = tokio::task::spawn_blocking(move || bundle::inspect_bundle(&dir, true))
                .await
                .map_err(|_| worker_failed())?
                .map_err(|error| error.to_app_error())?;
            return Ok(result_from_summary(
                request_id.clone(),
                bundle_identifier.clone(),
                &summary,
                false,
            ));
        }

        // Step 3: the engine.
        let created = backup::create_bundle(CreateBundleInput {
            ctx,
            destination: &resolved.path,
            bundle_name: &bundle_identifier,
            kind: BackupKind::Manual,
            stage_tag: &attempt_id.to_string(),
        })
        .await
        .map_err(|error| error.to_app_error())?;
        Ok::<_, AppError>(result_from_summary(
            request_id.clone(),
            bundle_identifier.clone(),
            &created.summary,
            resolved.used_fallback,
        ))
    }
    .await;

    // Step 4: completion.
    match outcome {
        Ok(result) => {
            recovery_creation::complete_operator_backup_creation_success(
                pool,
                session_token,
                attempt_id,
                &result,
            )
            .await?;
            Ok(result)
        }
        Err(error) => {
            let _ = recovery_creation::complete_operator_backup_creation_failure(
                pool,
                session_token,
                attempt_id,
                &error,
            )
            .await;
            Err(error)
        }
    }
}

// ---------------------------------------------------------------------------
// Validation (EMBEDDED) — plan §5.10 F2: any folder (ruling R9).
// ---------------------------------------------------------------------------

pub(crate) async fn validate_backup(
    pool: &PgPool,
    session_token: &str,
    ctx: &EmbeddedRecoveryContext,
    request: ValidateOperatorBackupRequest,
) -> Result<OperatorBackupValidationResult, AppError> {
    request
        .validate()
        .map_err(|diagnostic| AppError::ValidationError { diagnostic })?;
    let (canonical_path, _name) =
        bundle::canonical_bundle_anywhere(&request.bundle_path).map_err(|error| {
            log::append(
                &ctx.app_data_dir,
                "VALIDATE",
                &format!("REFUSED: {} - {}", error.code, error.log_detail),
            );
            error.to_app_error()
        })?;

    let attempt = recovery::begin_operator_backup_validation(pool, session_token, request).await?;
    let (attempt_id, request_id, bundle_identifier) = match attempt {
        ValidationAttempt::Replay(result) => return Ok(result),
        ValidationAttempt::Run {
            attempt_id,
            request_id,
            bundle_identifier,
            ..
        } => (attempt_id, request_id, bundle_identifier),
    };

    let dir = canonical_path.clone();
    let inspected = tokio::task::spawn_blocking(move || bundle::inspect_bundle(&dir, true))
        .await
        .map_err(|_| worker_failed());
    let outcome: Result<OperatorBackupValidationResult, AppError> = match inspected {
        Ok(Ok(summary)) => {
            log::append(
                &ctx.app_data_dir,
                "VALIDATE",
                &format!(
                    "SUCCEEDED: {} verdict={} restorable={}",
                    canonical_path.display(),
                    summary.verdict.as_str(),
                    summary.restorable
                ),
            );
            Ok(result_from_summary(
                request_id,
                bundle_identifier,
                &summary,
                false,
            ))
        }
        Ok(Err(error)) => {
            log::append(
                &ctx.app_data_dir,
                "VALIDATE",
                &format!(
                    "FAILED: {} - {} ({})",
                    error.code,
                    error.log_detail,
                    canonical_path.display()
                ),
            );
            Err(error.to_app_error())
        }
        Err(error) => Err(error),
    };

    match outcome {
        Ok(result) => {
            recovery::complete_operator_backup_validation_success(
                pool,
                session_token,
                attempt_id,
                &result,
            )
            .await?;
            Ok(result)
        }
        Err(error) => {
            let _ = recovery::complete_operator_backup_validation_failure(
                pool,
                session_token,
                attempt_id,
                &error,
            )
            .await;
            Err(error)
        }
    }
}

// ---------------------------------------------------------------------------
// Backup list (EMBEDDED) — plan H4-05.
// ---------------------------------------------------------------------------

/// Resolve the destination exactly as a manual backup would, then scan it.
/// An unusable stored destination is not an error here — the plan wants the
/// stored path echoed back with an empty list, so the operator sees *why*
/// nothing is listed instead of a bare error banner.
pub(crate) async fn list_backups(
    pool: &PgPool,
    session_token: &str,
    ctx: &EmbeddedRecoveryContext,
) -> Result<ListBackupsResponse, AppError> {
    let stored = recovery::get_backup_destination(pool, session_token)
        .await?
        .path;
    let root = match destination::resolve(stored.as_deref(), ctx, DestinationPurpose::Manual) {
        Ok(resolved) => resolved.path,
        Err(error) if error.code == codes::BACKUP_DESTINATION_UNAVAILABLE => {
            return Ok(ListBackupsResponse {
                destination: stored,
                items: Vec::new(),
            });
        }
        Err(error) => return Err(error.to_app_error()),
    };
    let destination_string = root.to_string_lossy().into_owned();
    let items = tokio::task::spawn_blocking(move || catalog::list_bundles(&root, true))
        .await
        .map_err(|_| worker_failed())?;
    Ok(ListBackupsResponse {
        destination: Some(destination_string),
        items,
    })
}

// ---------------------------------------------------------------------------
// Copy to another folder — plan H4-05. Mode-independent: the copy itself
// never touches the database, so the same code path serves EMBEDDED and
// EXTERNAL. `app_data_dir` is `None` when it could not be resolved (or the
// caller chose not to log), in which case logging is silently skipped.
// ---------------------------------------------------------------------------

pub(crate) async fn copy_backup(
    bundle_path: &str,
    target_directory: &str,
    app_data_dir: Option<PathBuf>,
) -> Result<CopyBackupToResult, AppError> {
    let (source, _name) = bundle::canonical_bundle_anywhere(bundle_path).map_err(|error| {
        if let Some(dir) = &app_data_dir {
            log::append(
                dir,
                "COPY",
                &format!("REFUSED: {} - {}", error.code, error.log_detail),
            );
        }
        error.to_app_error()
    })?;
    let target = PathBuf::from(target_directory.trim());

    let result = tokio::task::spawn_blocking(move || copy::copy_bundle(&source, &target))
        .await
        .map_err(|_| worker_failed())?;

    match result {
        Ok((copied_path, total_bytes)) => {
            if let Some(dir) = &app_data_dir {
                log::append(
                    dir,
                    "COPY",
                    &format!("SUCCEEDED: {}", copied_path.display()),
                );
            }
            Ok(CopyBackupToResult {
                copied_path: copied_path.to_string_lossy().into_owned(),
                total_bytes,
            })
        }
        Err(error) => {
            if let Some(dir) = &app_data_dir {
                log::append(
                    dir,
                    "COPY",
                    &format!("FAILED: {} - {}", error.code, error.log_detail),
                );
            }
            Err(error.to_app_error())
        }
    }
}

// ---------------------------------------------------------------------------
// Isolated restore test (EMBEDDED) — plan H4-05, §5.10 F3.
// ---------------------------------------------------------------------------

/// `DrillCluster::start` provisions the throwaway cluster's roles through
/// `embedded_setup::create_roles`/`create_database`, which — like the old
/// shape of `collect_restore_control_totals` — reuse one `&mut PgConnection`
/// across several sequential awaited calls. That combination, reached
/// directly from a `#[tauri::command]` (which needs the whole command's
/// future to be `Send` for a fully generalized lifetime), hits a known,
/// longstanding rustc HRTB limitation: "implementation of `Send`/`Executor`
/// is not general enough" — confirmed by bisection to originate inside
/// `DrillCluster::start` itself, not in this function's own shape. Running
/// the whole isolated-test body on a blocking-pool thread via its own
/// `tokio::runtime::Handle::block_on` (the same "sync boundary calls into
/// async work" idiom `commands/safe_upgrade.rs` uses for the equally heavy
/// safe-upgrade flow) sidesteps it entirely: `block_on`'s own bound is just
/// `F: Future`, with no `Send`-for-any-lifetime proof involved. Deliberately
/// `tokio::` rather than `tauri::async_runtime::`: `application::*` modules
/// have no compile-time dependency on `tauri` (see `application::mod`'s own
/// doc comment), and `tokio` alone is enough here.
pub(crate) async fn test_backup(
    pool: PgPool,
    session_token: String,
    ctx: EmbeddedRecoveryContext,
    request: VerifyOperatorBackupRestoreRequest,
) -> Result<OperatorRestoreVerificationResult, AppError> {
    let runtime_handle = tokio::runtime::Handle::current();
    tokio::task::spawn_blocking(move || {
        runtime_handle.block_on(test_backup_on_blocking_thread(
            pool,
            session_token,
            ctx,
            request,
        ))
    })
    .await
    .map_err(|_| worker_failed())?
}

async fn test_backup_on_blocking_thread(
    pool: PgPool,
    session_token: String,
    ctx: EmbeddedRecoveryContext,
    request: VerifyOperatorBackupRestoreRequest,
) -> Result<OperatorRestoreVerificationResult, AppError> {
    let pool = &pool;
    let session_token = session_token.as_str();
    let ctx = &ctx;
    request
        .validate()
        .map_err(|diagnostic| AppError::ValidationError { diagnostic })?;
    let (canonical_path, _name) =
        bundle::canonical_bundle_anywhere(&request.bundle_path).map_err(|error| {
            log::append(
                &ctx.app_data_dir,
                "TEST",
                &format!("REFUSED: {} - {}", error.code, error.log_detail),
            );
            error.to_app_error()
        })?;

    let attempt =
        recovery::begin_operator_restore_verification(pool, session_token, request).await?;
    let (attempt_id, request_id, bundle_identifier) = match attempt {
        RestoreVerificationAttempt::Replay(result) => return Ok(result),
        RestoreVerificationAttempt::Run {
            attempt_id,
            request_id,
            bundle_identifier,
            ..
        } => (attempt_id, request_id, bundle_identifier),
    };

    let outcome: Result<OperatorRestoreVerificationResult, AppError> = async {
        let summary = bundle::inspect_bundle(&canonical_path, true).map_err(|error| {
            log::append(
                &ctx.app_data_dir,
                "TEST",
                &format!(
                    "FAILED: {} - {} ({})",
                    error.code,
                    error.log_detail,
                    canonical_path.display()
                ),
            );
            error.to_app_error()
        })?;

        let report = drill::run_isolated_drill(ctx, &summary).await.map_err(|error| {
            log::append(
                &ctx.app_data_dir,
                "TEST",
                &format!(
                    "FAILED: {} - {} ({})",
                    error.code,
                    error.log_detail,
                    canonical_path.display()
                ),
            );
            error.to_app_error()
        })?;

        log::append(
            &ctx.app_data_dir,
            "TEST",
            &format!(
                "SUCCEEDED: {} verdict={} migrated_forward={} journal_balanced={} cleanup_pending={}",
                canonical_path.display(),
                report.verdict.as_str(),
                report.migrated_forward,
                report.journal_balanced,
                report.cleanup_pending
            ),
        );

        Ok(OperatorRestoreVerificationResult {
            request_id: request_id.clone(),
            bundle_identifier: bundle_identifier.clone(),
            schema_version: summary.validated.schema_version.clone(),
            postgres_major_version: summary.validated.postgres_major_version,
            temporary_database_cleaned: report.server_stopped,
            journal_balanced: report.journal_balanced,
            control_totals: report.totals,
            schema_verdict: Some(report.verdict.as_str().to_string()),
            migrated_forward: Some(report.migrated_forward),
            cleanup_pending: Some(report.cleanup_pending),
        })
    }
    .await;

    match outcome {
        Ok(result) => {
            recovery::complete_operator_restore_verification_success(
                pool,
                session_token,
                attempt_id,
                &result,
            )
            .await?;
            Ok(result)
        }
        Err(error) => {
            let _ = recovery::complete_operator_restore_verification_failure(
                pool,
                session_token,
                attempt_id,
                &error,
            )
            .await;
            Err(error)
        }
    }
}

// ---------------------------------------------------------------------------
// Result shaping.
// ---------------------------------------------------------------------------

/// The safe IPC result for a format 1 or 2 bundle (plan H3-07): the
/// application version is informational (`application_compatible` always
/// `true`, ruling R5); schema compatibility is the verdict; PostgreSQL
/// compatibility is the major check.
pub(crate) fn result_from_summary(
    request_id: String,
    bundle_identifier: String,
    summary: &BundleSummary,
    used_fallback_destination: bool,
) -> OperatorBackupValidationResult {
    let validated = &summary.validated;
    OperatorBackupValidationResult {
        request_id,
        created_at_label: bundle_identifier
            .strip_prefix(backup_proof::BUNDLE_NAME_PREFIX)
            .unwrap_or_default()
            .to_string(),
        bundle_identifier,
        application_version: validated.application_version.clone(),
        schema_version: validated.schema_version.clone(),
        postgres_major_version: validated.postgres_major_version,
        integrity_valid: true,
        application_compatible: true,
        schema_compatible: summary.verdict.is_restorable(),
        postgres_compatible: validated.postgres_major_version
            == backup_proof::REQUIRED_PG_MAJOR_VERSION,
        file_count: summary.file_count,
        total_bytes: summary.total_bytes,
        format_version: Some(validated.bundle_format_version),
        backup_kind: Some(summary.backup_kind().to_string()),
        schema_verdict: Some(summary.verdict.as_str().to_string()),
        restorable: Some(summary.restorable),
        created_at_utc: summary.created_at_utc.clone(),
        used_fallback_destination: Some(used_fallback_destination),
    }
}

fn worker_failed() -> AppError {
    EngineError::new(codes::BACKUP_STAGE_FAILED, "blocking worker failed").to_app_error()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::recovery_engine::schema::SchemaVerdict;
    use std::path::PathBuf;

    fn summary(format: u32, privileges: bool, verdict: SchemaVerdict) -> BundleSummary {
        BundleSummary {
            validated: backup_proof::ValidatedBundle {
                bundle_dir: PathBuf::from("x"),
                dump_path: PathBuf::from("x/database.dump"),
                bundle_format_version: format,
                application_version: "0.4.0".to_string(),
                schema_version: "20260916100000".to_string(),
                postgres_major_version: 18,
                backup_kind: Some("DAILY".to_string()),
                dump_includes_privileges: privileges,
                created_at_unix: Some(0),
            },
            file_count: 6,
            total_bytes: 4096,
            verdict,
            restorable: format == 2 && privileges && verdict.is_restorable(),
            created_at_utc: Some("1970-01-01T00:00:00Z".to_string()),
        }
    }

    #[test]
    fn application_version_is_informational_and_schema_follows_the_verdict() {
        let result = result_from_summary(
            "create-20260919-0001".to_string(),
            "GestStock-Backup-20260919-101500".to_string(),
            &summary(2, true, SchemaVerdict::Older),
            true,
        );
        assert!(result.application_compatible, "R5: never blocks");
        assert_eq!(result.application_version, "0.4.0");
        assert!(result.schema_compatible, "OLDER is restorable");
        assert!(result.postgres_compatible);
        assert_eq!(result.created_at_label, "20260919-101500");
        assert_eq!(result.format_version, Some(2));
        assert_eq!(result.backup_kind.as_deref(), Some("DAILY"));
        assert_eq!(result.schema_verdict.as_deref(), Some("OLDER"));
        assert_eq!(result.restorable, Some(true));
        assert_eq!(result.used_fallback_destination, Some(true));

        let newer = result_from_summary(
            "validate-20260919-0001".to_string(),
            "GestStock-Backup-20260919-101500".to_string(),
            &summary(1, false, SchemaVerdict::Newer),
            false,
        );
        assert!(!newer.schema_compatible);
        assert_eq!(newer.restorable, Some(false));
        assert_eq!(newer.format_version, Some(1));
    }
}
