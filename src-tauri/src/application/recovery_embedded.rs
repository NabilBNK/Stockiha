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
    AutomaticBackupResponse, BackupDestinationSetting, BackupStatus, CopyBackupToResult,
    CreateOperatorBackupRequest, ListBackupsResponse, OperatorBackupCreationResult,
    OperatorBackupValidationResult, OperatorRestoreVerificationResult, RecoveryCapabilities,
    RecoveryCapabilitiesRow, RunAutomaticBackupRequest, UpdateBackupDestinationResult,
    ValidateOperatorBackupRequest, VerifyOperatorBackupRestoreRequest,
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
use crate::infrastructure::recovery_engine::live;
use crate::infrastructure::recovery_engine::log;
use crate::infrastructure::recovery_engine::mode::EmbeddedRecoveryContext;
use crate::infrastructure::recovery_engine::retention;

use super::recovery::{self, RestoreVerificationAttempt, ValidationAttempt};
use super::recovery_creation::{self, CreationAttempt, CreationAttemptEnvelope};

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
    // See `BackupStatusRow`'s doc comment: the SQL result's keys are
    // snake_case, `BackupStatus` itself is camelCase-only (the outgoing IPC
    // shape) - deserializing straight into it silently drops every field.
    let row: crate::domain::recovery::BackupStatusRow = serde_json::from_value(value)
        .map_err(|error| AppError::internal(format!("failed to parse backup status: {error}")))?;
    Ok(row.into())
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
// Automatic backup (EMBEDDED) — plan H6-01, §5.10 F6/F7.
// ---------------------------------------------------------------------------

/// How long since the last successful backup before a `DAILY` automatic
/// backup is due (ruling R12).
const DAILY_DUE_AFTER_HOURS: i64 = 20;

pub(crate) async fn run_automatic_backup(
    pool: &PgPool,
    session_token: &str,
    ctx: &EmbeddedRecoveryContext,
    request: RunAutomaticBackupRequest,
) -> Result<AutomaticBackupResponse, AppError> {
    request
        .validate()
        .map_err(|diagnostic| AppError::ValidationError { diagnostic })?;
    let kind = match request.reason.trim() {
        "DAILY" => BackupKind::Daily,
        "PRE_UPDATE" => BackupKind::PreUpdate,
        other => {
            return Err(AppError::ValidationError {
                diagnostic: format!("unknown automatic backup reason '{other}'"),
            })
        }
    };

    // Due check: DAILY only, PRE_UPDATE always proceeds.
    if kind == BackupKind::Daily {
        let status = fetch_backup_status(pool, session_token).await?;
        if let Some(last_success_at) = status.last_success_at.as_deref() {
            match time::OffsetDateTime::parse(
                last_success_at,
                &time::format_description::well_known::Rfc3339,
            ) {
                Ok(last_success) => {
                    let age = time::OffsetDateTime::now_utc() - last_success;
                    // A negative age (clock moved backwards) always falls
                    // through as due; only a non-negative age under the
                    // threshold is skipped.
                    if !age.is_negative() && age < time::Duration::hours(DAILY_DUE_AFTER_HOURS) {
                        return Ok(AutomaticBackupResponse {
                            status: "SKIPPED".to_string(),
                            skip_reason: Some("NOT_DUE".to_string()),
                            result: None,
                            used_fallback_destination: false,
                        });
                    }
                }
                Err(parse_error) => {
                    log::append(
                        &ctx.app_data_dir,
                        "AUTO_BACKUP",
                        &format!(
                            "parse of last_success_at failed (value={last_success_at:?}, error={parse_error}) - treating as due"
                        ),
                    );
                }
            }
        }
    }

    // Begin the audit attempt, with same-second collision retry.
    let mut attempts = 0;
    let (attempt_id, bundle_identifier) = loop {
        attempts += 1;
        let candidate = backup_proof::bundle_directory_name(time::OffsetDateTime::now_utc());
        let value: JsonValue =
            match query_scalar("SELECT operations.begin_automatic_backup_attempt($1, $2, $3)")
                .bind(session_token)
                .bind(request.request_id.trim())
                .bind(&candidate)
                .fetch_one(pool)
                .await
            {
                Ok(value) => value,
                Err(error) => match AppError::from_posting_error(error) {
                    AppError::IdempotencyConflict { .. }
                        if attempts < IDENTIFIER_COLLISION_ATTEMPTS =>
                    {
                        tokio::time::sleep(Duration::from_secs(1)).await;
                        continue;
                    }
                    AppError::IdempotencyConflict { .. } => {
                        return Err(AppError::BackupCreationFailed {
                            diagnostic: codes::BACKUP_IDENTIFIER_COLLISION.to_string(),
                        });
                    }
                    other => return Err(other),
                },
            };
        let envelope: CreationAttemptEnvelope = serde_json::from_value(value).map_err(|error| {
            AppError::internal(format!("failed to parse automatic backup attempt: {error}"))
        })?;
        match envelope.status.as_str() {
            "SUCCEEDED" => {
                let result = envelope.result.ok_or_else(|| {
                    AppError::internal("completed automatic backup attempt has no result metadata")
                })?;
                let parsed: OperatorBackupCreationResult =
                    serde_json::from_value(result).map_err(|error| {
                        AppError::internal(format!(
                            "failed to parse completed automatic backup result: {error}"
                        ))
                    })?;
                return Ok(AutomaticBackupResponse {
                    status: "CREATED".to_string(),
                    skip_reason: None,
                    result: Some(parsed),
                    used_fallback_destination: false,
                });
            }
            "FAILED" => {
                return Err(AppError::BackupCreationFailed {
                    diagnostic: envelope
                        .error_code
                        .unwrap_or_else(|| "BACKUP_CREATION_FAILED".to_string()),
                })
            }
            "STARTED" => break (envelope.attempt_id, envelope.bundle_identifier),
            other => {
                return Err(AppError::internal(format!(
                    "unknown automatic backup attempt status: {other}"
                )))
            }
        }
    };

    // Resolve the destination without the permissioned SQL function: a
    // cashier's session may be the one running this (clicking Install), and
    // `operations.get_backup_destination_setting` requires
    // CREATE_BACKUP_BUNDLE. Read the stored path through a migrator
    // connection instead (WS-H-5 already added this helper's connection
    // shape in `begin_live_restore`).
    let outcome = async {
        let Some(info) =
            crate::infrastructure::local_config::load_migrator_connection_info(&ctx.app_data_dir)
        else {
            return Err(EngineError::new(
                codes::BACKUP_SCHEMA_VERSION_UNREADABLE,
                "no migrator credential",
            )
            .to_app_error());
        };
        let mut conn = live::migrator_connection(&info)
            .await
            .map_err(|e| e.to_app_error())?;
        let stored: Option<String> = sqlx::query_scalar(
            "SELECT backup_destination_path FROM operations.recovery_settings WHERE singleton",
        )
        .fetch_optional(&mut conn)
        .await
        .map_err(|e| AppError::internal(format!("could not read backup destination: {e}")))?
        .flatten();
        let _ = sqlx::Connection::close(conn).await;

        let resolved = destination::resolve(stored.as_deref(), ctx, DestinationPurpose::Automatic)
            .map_err(|error| error.to_app_error())?;

        let created = backup::create_bundle(CreateBundleInput {
            ctx,
            destination: &resolved.path,
            bundle_name: &bundle_identifier,
            kind,
            stage_tag: &attempt_id.to_string(),
        })
        .await
        .map_err(|error| error.to_app_error())?;

        Ok::<_, AppError>((
            result_from_summary(
                request.request_id.trim().to_string(),
                bundle_identifier.clone(),
                &created.summary,
                resolved.used_fallback,
            ),
            created.path,
            resolved.used_fallback,
        ))
    }
    .await;

    match outcome {
        Ok((result, created_path, used_fallback)) => {
            let result_json = serde_json::to_value(&result).map_err(|error| {
                AppError::internal(format!(
                    "failed to serialize automatic backup result: {error}"
                ))
            })?;
            let _: JsonValue = query_scalar(
                "SELECT operations.complete_automatic_backup_attempt($1, $2, true, NULL, $3)",
            )
            .bind(session_token)
            .bind(attempt_id)
            .bind(result_json)
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

            let deleted = retention::apply(
                created_path.parent().unwrap_or(&created_path),
                kind,
                &created_path,
                &ctx.app_data_dir,
            );
            log::append(
                &ctx.app_data_dir,
                "RETENTION",
                &format!("automatic backup retention removed {deleted} folder(s)"),
            );

            Ok(AutomaticBackupResponse {
                status: "CREATED".to_string(),
                skip_reason: None,
                result: Some(result),
                used_fallback_destination: used_fallback,
            })
        }
        Err(error) => {
            let stable_code = recovery_creation::creation_audit_error_code(&error);
            let _: JsonValue = query_scalar(
                "SELECT operations.complete_automatic_backup_attempt($1, $2, false, $3, NULL)",
            )
            .bind(session_token)
            .bind(attempt_id)
            .bind(stable_code)
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;
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

// ---------------------------------------------------------------------------
// WS-H-5: real restore orchestration (plan H5-04).
// ---------------------------------------------------------------------------

/// Mirrors `application::recovery`'s private `RecoveryAttemptEnvelope` (not
/// reused directly: this file's plan scope for H5-04 does not list
/// `application/recovery.rs`, and the shape is tiny).
#[derive(serde::Deserialize)]
struct LiveAttemptEnvelope {
    attempt_id: i64,
    is_replay: bool,
    status: String,
}

pub(crate) struct LiveRestorePrepared {
    pub(crate) attempt_id: i64,
    pub(crate) actor_username: Option<String>,
    pub(crate) workstation_id: Option<String>,
    pub(crate) safety_destination: std::path::PathBuf,
}

/// Begins the `RESTORE_LIVE` audit attempt and resolves everything the
/// worker thread needs but cannot resolve for itself: the actor's identity
/// (readable only through `operations.recovery_attempts` ⨝ `iam.users`, off
/// limits to the runtime role) and where the safety backup goes. A live
/// restore request id is never replayed (plan H5-04 step 6).
pub(crate) async fn begin_live_restore(
    pool: &PgPool,
    session_token: &str,
    request_id: &str,
    bundle_identifier: &str,
    ctx: &EmbeddedRecoveryContext,
) -> Result<LiveRestorePrepared, AppError> {
    let value: JsonValue =
        query_scalar("SELECT operations.begin_recovery_attempt($1, $2, 'RESTORE_LIVE', $3)")
            .bind(session_token)
            .bind(request_id)
            .bind(bundle_identifier)
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;
    let envelope: LiveAttemptEnvelope = serde_json::from_value(value).map_err(|error| {
        AppError::internal(format!(
            "failed to parse recovery attempt envelope: {error}"
        ))
    })?;
    match envelope.status.as_str() {
        "STARTED" if envelope.is_replay => {
            return Err(AppError::RecoveryOperationInProgress {
                diagnostic: "a live restore for this request is already running".to_string(),
            });
        }
        "STARTED" => {}
        _ => {
            return Err(AppError::ValidationError {
                diagnostic: "a live restore request id is never replayed".to_string(),
            });
        }
    }

    let Some(info) =
        crate::infrastructure::local_config::load_migrator_connection_info(&ctx.app_data_dir)
    else {
        return Err(EngineError::new(
            codes::BACKUP_SCHEMA_VERSION_UNREADABLE,
            "no migrator credential",
        )
        .to_app_error());
    };
    let mut conn = crate::infrastructure::recovery_engine::live::migrator_connection(&info)
        .await
        .map_err(|e| e.to_app_error())?;

    let identity: Option<(String, Option<String>)> = sqlx::query_as(
        "SELECT u.username, a.workstation_id FROM operations.recovery_attempts a \
         JOIN iam.users u ON u.id = a.actor_id WHERE a.id = $1",
    )
    .bind(envelope.attempt_id)
    .fetch_optional(&mut conn)
    .await
    .map_err(|e| AppError::internal(format!("could not resolve restore actor: {e}")))?;
    let (actor_username, workstation_id) = identity.unzip();
    let workstation_id = workstation_id.flatten();

    let stored: Option<String> = sqlx::query_scalar(
        "SELECT backup_destination_path FROM operations.recovery_settings WHERE singleton",
    )
    .fetch_optional(&mut conn)
    .await
    .map_err(|e| AppError::internal(format!("could not read backup destination: {e}")))?
    .flatten();
    let _ = sqlx::Connection::close(conn).await;

    let resolved = destination::resolve(stored.as_deref(), ctx, DestinationPurpose::Automatic)
        .map_err(|e| e.to_app_error())?;

    Ok(LiveRestorePrepared {
        attempt_id: envelope.attempt_id,
        actor_username,
        workstation_id,
        safety_destination: resolved.path,
    })
}

/// Completes the `RESTORE_LIVE` audit row after a live restore attempt that
/// did not succeed (an outcome where the row still exists — `Succeeded`
/// drops it along with the rest of `operations`, per plan R16). Runs on a
/// fresh migrator connection because the app's own pool may already be
/// closed by the time this is called (`STOP_CONNECTIONS` closes it before
/// any step that could fail this way).
pub(crate) async fn complete_live_restore_attempt(
    ctx: &EmbeddedRecoveryContext,
    session_token: &str,
    attempt_id: i64,
    error_code: &str,
) -> Result<(), AppError> {
    let Some(info) =
        crate::infrastructure::local_config::load_migrator_connection_info(&ctx.app_data_dir)
    else {
        return Err(EngineError::new(
            codes::BACKUP_SCHEMA_VERSION_UNREADABLE,
            "no migrator credential",
        )
        .to_app_error());
    };
    let mut conn = crate::infrastructure::recovery_engine::live::migrator_connection(&info)
        .await
        .map_err(|e| e.to_app_error())?;
    sqlx::raw_sql("SET ROLE stockiha_owner")
        .execute(&mut conn)
        .await
        .map_err(|e| AppError::internal(format!("could not assume stockiha_owner: {e}")))?;
    sqlx::query("SELECT operations.complete_recovery_attempt($1, $2, false, $3, NULL)")
        .bind(session_token)
        .bind(attempt_id)
        .bind(error_code)
        .execute(&mut conn)
        .await
        .map_err(|e| AppError::internal(format!("could not complete recovery attempt: {e}")))?;
    let _ = sqlx::Connection::close(conn).await;
    Ok(())
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

    // =======================================================================
    // WS-H-6 (H6-09): real-embedded-instance integration tests for automatic
    // backups. Reuses `safe_upgrade::test_support` (provisioning) exactly as
    // every other WS-H ignored test does, and `application::test_fixtures`
    // (bootstrap + login + create_user) for real sessions — both already
    // reach the database only through sanctioned paths, so these fixtures
    // work unmodified against the embedded fixture's own freshly-migrated
    // database.
    // =======================================================================

    use crate::application::test_fixtures;
    use crate::domain::recovery::RunAutomaticBackupRequest;
    use crate::infrastructure::recovery_engine::backup::CreateBundleInput;
    use crate::infrastructure::safe_upgrade::test_support;
    use sqlx::PgPool;

    async fn runtime_pool_for_tests(app_data_dir: &std::path::Path) -> PgPool {
        let outcome = crate::infrastructure::local_config::load(app_data_dir);
        let options = match outcome {
            crate::infrastructure::local_config::LocalConfigOutcome::Loaded { options, .. } => {
                *options
            }
            _ => panic!("database.json must be loadable after setup"),
        };
        PgPool::connect_with(options)
            .await
            .expect("connect the runtime pool for tests")
    }

    fn ctx_for_tests(
        app_data_dir: &std::path::Path,
        bin_dir: std::path::PathBuf,
        pgdata: std::path::PathBuf,
    ) -> EmbeddedRecoveryContext {
        EmbeddedRecoveryContext {
            app_data_dir: app_data_dir.to_path_buf(),
            resource_dir: dunce::simplified(&test_support::bundled_resource_dir_for_tests())
                .to_path_buf(),
            bin_dir,
            pgdata,
            app_version: "0.5.0-test".to_string(),
        }
    }

    #[tokio::test]
    #[ignore = "spawns a real, disposable PostgreSQL instance; run explicitly with -- --ignored"]
    async fn automatic_daily_backup_skips_when_recent() {
        let app_data_dir = test_support::temp_app_data_dir_for_tests("auto-daily-recent");
        let (bin_dir, pgdata, _port) =
            test_support::provision_fresh_instance(&app_data_dir, 58620).await;
        let ctx = ctx_for_tests(&app_data_dir, bin_dir.clone(), pgdata.clone());
        let runtime_pool = runtime_pool_for_tests(&app_data_dir).await;
        let (_admin_id, admin_token) = test_fixtures::root_admin_session(&runtime_pool).await;

        let manual = create_manual_backup(
            &runtime_pool,
            &admin_token,
            &ctx,
            CreateOperatorBackupRequest {
                request_id: "manual-before-daily-0001".to_string(),
            },
        )
        .await
        .expect("manual backup must succeed");

        let response = run_automatic_backup(
            &runtime_pool,
            &admin_token,
            &ctx,
            RunAutomaticBackupRequest {
                request_id: "auto-daily-skip-0001".to_string(),
                reason: "DAILY".to_string(),
            },
        )
        .await
        .expect("automatic backup call must not error");

        assert_eq!(response.status, "SKIPPED");
        assert_eq!(response.skip_reason.as_deref(), Some("NOT_DUE"));
        assert!(response.result.is_none());

        let destination = destination::resolve(None, &ctx, DestinationPurpose::Manual)
            .unwrap()
            .path;
        let items = catalog::list_bundles_uncapped(&destination, true);
        assert_eq!(items.len(), 1, "no second bundle folder must appear");
        assert_eq!(items[0].bundle_identifier, manual.bundle_identifier);

        runtime_pool.close().await;
        test_support::stop_server(&bin_dir, &pgdata);
        let _ = std::fs::remove_dir_all(&app_data_dir);
    }

    #[tokio::test]
    #[ignore = "spawns a real, disposable PostgreSQL instance; run explicitly with -- --ignored"]
    async fn automatic_daily_backup_runs_when_due() {
        let app_data_dir = test_support::temp_app_data_dir_for_tests("auto-daily-due");
        let (bin_dir, pgdata, _port) =
            test_support::provision_fresh_instance(&app_data_dir, 58630).await;
        let ctx = ctx_for_tests(&app_data_dir, bin_dir.clone(), pgdata.clone());
        let runtime_pool = runtime_pool_for_tests(&app_data_dir).await;
        let (_admin_id, admin_token) = test_fixtures::root_admin_session(&runtime_pool).await;

        let response = run_automatic_backup(
            &runtime_pool,
            &admin_token,
            &ctx,
            RunAutomaticBackupRequest {
                request_id: "auto-daily-due-0001".to_string(),
                reason: "DAILY".to_string(),
            },
        )
        .await
        .expect("automatic backup call must not error");

        assert_eq!(response.status, "CREATED");
        let result = response
            .result
            .expect("a created backup must carry its result");
        assert_eq!(result.backup_kind.as_deref(), Some("DAILY"));
        assert_eq!(result.restorable, Some(true));

        let destination = destination::resolve(None, &ctx, DestinationPurpose::Manual)
            .unwrap()
            .path;
        assert!(
            backup_proof::validate_bundle(&destination.join(&result.bundle_identifier)).is_ok()
        );

        runtime_pool.close().await;
        test_support::stop_server(&bin_dir, &pgdata);
        let _ = std::fs::remove_dir_all(&app_data_dir);
    }

    #[tokio::test]
    #[ignore = "spawns a real, disposable PostgreSQL instance; run explicitly with -- --ignored"]
    async fn automatic_backup_works_for_a_cashier_session() {
        let app_data_dir = test_support::temp_app_data_dir_for_tests("auto-cashier");
        let (bin_dir, pgdata, _port) =
            test_support::provision_fresh_instance(&app_data_dir, 58640).await;
        let ctx = ctx_for_tests(&app_data_dir, bin_dir.clone(), pgdata.clone());
        let runtime_pool = runtime_pool_for_tests(&app_data_dir).await;
        let (_admin_id, admin_token) = test_fixtures::root_admin_session(&runtime_pool).await;
        let (_cashier_id, cashier_token) = test_fixtures::seed_user_via_admin(
            &runtime_pool,
            &admin_token,
            "ws_h6_auto_backup_cashier",
            "CASHIER",
        )
        .await;

        let response = run_automatic_backup(
            &runtime_pool,
            &cashier_token,
            &ctx,
            RunAutomaticBackupRequest {
                request_id: "auto-preupdate-cashier-0001".to_string(),
                reason: "PRE_UPDATE".to_string(),
            },
        )
        .await
        .expect("a cashier session must be able to run an automatic backup");
        assert_eq!(response.status, "CREATED");

        // `operations.recovery_attempts` is off limits to `stockiha_runtime`
        // (privacy of the audit trail) - read it through the migrator
        // connection, exactly as the engine itself does.
        let info =
            crate::infrastructure::local_config::load_migrator_connection_info(&app_data_dir)
                .expect("migrator.json must exist");
        let mut migrator_conn = live::migrator_connection(&info).await.unwrap();
        let row: (String, String) = sqlx::query_as(
            "SELECT operation_code, status FROM operations.recovery_attempts \
             WHERE request_id = $1",
        )
        .bind("auto-preupdate-cashier-0001")
        .fetch_one(&mut migrator_conn)
        .await
        .expect("the audit row must exist");
        assert_eq!(row.0, "AUTO_BACKUP");
        assert_eq!(row.1, "SUCCEEDED");
        let _ = sqlx::Connection::close(migrator_conn).await;

        runtime_pool.close().await;
        test_support::stop_server(&bin_dir, &pgdata);
        let _ = std::fs::remove_dir_all(&app_data_dir);
    }

    #[tokio::test]
    #[ignore = "spawns a real, disposable PostgreSQL instance; run explicitly with -- --ignored"]
    async fn retention_keeps_fourteen_daily_backups() {
        let app_data_dir = test_support::temp_app_data_dir_for_tests("auto-retention-14");
        let (bin_dir, pgdata, _port) =
            test_support::provision_fresh_instance(&app_data_dir, 58650).await;
        let ctx = ctx_for_tests(&app_data_dir, bin_dir.clone(), pgdata.clone());
        let runtime_pool = runtime_pool_for_tests(&app_data_dir).await;
        let (_admin_id, admin_token) = test_fixtures::root_admin_session(&runtime_pool).await;

        let destination = destination::resolve(None, &ctx, DestinationPurpose::Manual)
            .unwrap()
            .path;

        // 15 real, syntactically valid DAILY bundles with distinct
        // timestamps, spread across different days so every canonical name
        // stays unique, plus one MANUAL bundle that must never be touched.
        for day in 1..=15u32 {
            let name = format!("GestStock-Backup-202609{day:02}-030000");
            backup::create_bundle(CreateBundleInput {
                ctx: &ctx,
                destination: &destination,
                bundle_name: &name,
                kind: BackupKind::Daily,
                stage_tag: &format!("seed-{day}"),
            })
            .await
            .unwrap_or_else(|e| panic!("seed DAILY bundle {name} failed: {e}"));
        }
        let manual_name = "GestStock-Backup-20260901-020000";
        backup::create_bundle(CreateBundleInput {
            ctx: &ctx,
            destination: &destination,
            bundle_name: manual_name,
            kind: BackupKind::Manual,
            stage_tag: "seed-manual",
        })
        .await
        .expect("seed MANUAL bundle");

        let response = run_automatic_backup(
            &runtime_pool,
            &admin_token,
            &ctx,
            RunAutomaticBackupRequest {
                request_id: "auto-daily-retention-0001".to_string(),
                reason: "DAILY".to_string(),
            },
        )
        .await
        .expect("automatic backup call must not error");
        assert_eq!(response.status, "CREATED");

        let items = catalog::list_bundles_uncapped(&destination, true);
        let daily_count = items.iter().filter(|i| i.backup_kind == "DAILY").count();
        let manual_count = items.iter().filter(|i| i.backup_kind == "MANUAL").count();
        assert_eq!(
            daily_count, 14,
            "16 DAILY bundles existed (15 seeded + 1 new); exactly 14 must remain"
        );
        assert_eq!(manual_count, 1, "the MANUAL bundle must never be deleted");
        assert!(
            items.iter().any(|i| i.bundle_identifier == manual_name),
            "the specific MANUAL bundle must still be present"
        );

        runtime_pool.close().await;
        test_support::stop_server(&bin_dir, &pgdata);
        let _ = std::fs::remove_dir_all(&app_data_dir);
    }

    #[tokio::test]
    #[ignore = "spawns a real, disposable PostgreSQL instance; run explicitly with -- --ignored"]
    async fn automatic_backup_falls_back_when_the_destination_is_missing() {
        let app_data_dir = test_support::temp_app_data_dir_for_tests("auto-fallback");
        let (bin_dir, pgdata, _port) =
            test_support::provision_fresh_instance(&app_data_dir, 58660).await;
        let ctx = ctx_for_tests(&app_data_dir, bin_dir.clone(), pgdata.clone());
        let runtime_pool = runtime_pool_for_tests(&app_data_dir).await;
        let (_admin_id, admin_token) = test_fixtures::root_admin_session(&runtime_pool).await;

        // A destination that WAS valid when saved (a since-unplugged drive,
        // say) - written directly through the migrator connection, since the
        // normal setter validates and creates the folder at save time, which
        // a nonexistent drive letter can never pass.
        let info =
            crate::infrastructure::local_config::load_migrator_connection_info(&app_data_dir)
                .expect("migrator.json must exist");
        let mut migrator_conn = live::migrator_connection(&info).await.unwrap();
        sqlx::query(
            "UPDATE operations.recovery_settings SET backup_destination_path = $1 WHERE singleton",
        )
        .bind(r"Z:\nope\backups")
        .execute(&mut migrator_conn)
        .await
        .expect("seed the unreachable destination");
        let _ = sqlx::Connection::close(migrator_conn).await;

        let response = run_automatic_backup(
            &runtime_pool,
            &admin_token,
            &ctx,
            RunAutomaticBackupRequest {
                request_id: "auto-daily-fallback-0001".to_string(),
                reason: "DAILY".to_string(),
            },
        )
        .await
        .expect("automatic backup call must not error");

        assert_eq!(response.status, "CREATED");
        assert!(response.used_fallback_destination);
        let result = response
            .result
            .expect("a created backup must carry its result");
        let default_destination = ctx.app_data_dir.join("operator-backups");
        assert!(
            default_destination.join(&result.bundle_identifier).is_dir(),
            "the bundle must land in the default folder, not the unreachable one"
        );

        runtime_pool.close().await;
        test_support::stop_server(&bin_dir, &pgdata);
        let _ = std::fs::remove_dir_all(&app_data_dir);
    }
}
