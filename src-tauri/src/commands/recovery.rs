use std::sync::atomic::{AtomicBool, Ordering};

use serde_json::Value as JsonValue;
use sqlx::query_scalar;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::application::recovery::{self, RestoreVerificationAttempt, ValidationAttempt};
use crate::application::recovery_creation::{self, CreationAttempt};
use crate::application::recovery_embedded;
use crate::domain::recovery::{
    AutomaticBackupResponse, BackupDestinationSetting, BackupStatus, CopyBackupToRequest,
    CopyBackupToResult, CreateOperatorBackupRequest, InspectBackupForFreshInstallRequest,
    ListBackupsResponse, OperatorBackupCreationResult, OperatorBackupValidationResult,
    OperatorRestoreVerificationResult, RecoveryCapabilities, RecoveryModeResponse,
    RestoreBackupFreshInstallRequest, RestoreBackupLiveRequest, RestoreStarted,
    RunAutomaticBackupRequest, UpdateBackupDestinationRequest, UpdateBackupDestinationResult,
    ValidateOperatorBackupRequest, VerifyOperatorBackupRestoreRequest,
};
use crate::error::{AppError, IpcError};
use crate::infrastructure::db::{self, DatabaseState};
use crate::infrastructure::recovery_engine::bundle;
use crate::infrastructure::recovery_engine::catalog;
use crate::infrastructure::recovery_engine::live::RestoreFaults;
use crate::infrastructure::recovery_engine::mode::{self, EmbeddedRecoveryContext, RecoveryMode};
use crate::infrastructure::recovery_engine::restore_flow::{
    self, RestoreKind, RestoreOutcome, RestoreProgress,
};
use crate::infrastructure::{local_config, pg_process};

/// WS-H-2: at most one recovery operation may run at a time, process-wide.
///
/// Creating a backup, validating one, and verifying a restore are all heavy —
/// `pg_dump`, checksum walks over the whole bundle, `pg_restore` into a full
/// temporary database. Overlapping them is what preceded the PostgreSQL
/// backend crash seen during acceptance (`terminating connection because of
/// crash of another server process`), which then surfaced to the operator as
/// the unhelpful "The database is currently unavailable."
///
/// Disabling the buttons is a UI convenience; this is the guarantee. A second
/// call is rejected outright rather than queued, so the operator is told what
/// is happening instead of waiting on an invisible queue.
static RECOVERY_OPERATION_ACTIVE: AtomicBool = AtomicBool::new(false);

/// RAII lease over [`RECOVERY_OPERATION_ACTIVE`]. Released in `Drop`, so the
/// flag cannot be left stuck on by an early return, a `?`, or a panic — a
/// stuck flag would disable backups for the rest of the session.
pub(crate) struct RecoveryOperationLease;

impl RecoveryOperationLease {
    pub(crate) fn acquire() -> Result<Self, AppError> {
        RECOVERY_OPERATION_ACTIVE
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map(|_| RecoveryOperationLease)
            .map_err(|_| AppError::RecoveryOperationInProgress {
                diagnostic: "another recovery operation is already running".to_string(),
            })
    }
}

impl Drop for RecoveryOperationLease {
    fn drop(&mut self) {
        RECOVERY_OPERATION_ACTIVE.store(false, Ordering::Release);
    }
}

// ---------------------------------------------------------------------------
// WS-H-3: recovery mode (plan §5.1, ruling R1).
// ---------------------------------------------------------------------------

/// The one place the Tauri `AppHandle` is turned into a [`RecoveryMode`].
/// The precedence mirrors `db::database_state_from_precedence` (env var
/// first), so a backup always targets the database the app is connected to.
/// Resource dir: `pg_process::bundled_resource_dir()` first — Tauri's own
/// `resource_dir()` canonicalizes into a `\\?\` path PostgreSQL's tools
/// cannot use (see WS-K-4.4).
fn resolve_recovery_mode(app: &AppHandle) -> RecoveryMode {
    let env = std::env::var(db::DATABASE_URL_ENV).ok();
    let app_data = app.path().app_data_dir().ok();
    let resource = pg_process::bundled_resource_dir().or_else(|| app.path().resource_dir().ok());
    mode::resolve_from(
        env.as_deref(),
        app_data,
        resource,
        |dir| local_config::load_migrator_connection_info(dir).is_some(),
        app.package_info().version.to_string(),
    )
}

fn recovery_unavailable(reason: mode::UnavailableReason) -> IpcError {
    IpcError::from(AppError::RecoveryUnavailable {
        diagnostic: format!("{reason:?}"),
    })
}

/// A command that exists only in EMBEDDED mode was called in EXTERNAL mode.
fn embedded_only() -> IpcError {
    IpcError::from(AppError::RecoveryUnavailable {
        diagnostic: "EXTERNAL_MODE".to_string(),
    })
}

#[tauri::command]
pub(crate) async fn get_recovery_mode(app: AppHandle) -> Result<RecoveryModeResponse, IpcError> {
    let mode = resolve_recovery_mode(&app);
    Ok(RecoveryModeResponse {
        mode: mode.as_str().to_string(),
        unavailable_reason: match mode {
            RecoveryMode::Unavailable(reason) => Some(reason),
            _ => None,
        },
    })
}

#[tauri::command]
pub(crate) async fn get_recovery_capabilities(
    app: AppHandle,
    state: State<'_, DatabaseState>,
    session_token: String,
) -> Result<RecoveryCapabilities, IpcError> {
    let mode = resolve_recovery_mode(&app);
    if matches!(mode, RecoveryMode::Unavailable(_)) {
        return Ok(RecoveryCapabilities::none(mode.as_str()));
    }
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    recovery_embedded::fetch_capabilities(pool, &session_token, mode.as_str())
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn get_backup_status(
    app: AppHandle,
    state: State<'_, DatabaseState>,
    session_token: String,
) -> Result<BackupStatus, IpcError> {
    if let RecoveryMode::Unavailable(reason) = resolve_recovery_mode(&app) {
        return Err(recovery_unavailable(reason));
    }
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    recovery_embedded::fetch_backup_status(pool, &session_token)
        .await
        .map_err(IpcError::from)
}

// ---------------------------------------------------------------------------
// Destination setting.
// ---------------------------------------------------------------------------

#[tauri::command]
pub(crate) async fn get_backup_destination_setting(
    app: AppHandle,
    state: State<'_, DatabaseState>,
    session_token: String,
) -> Result<BackupDestinationSetting, IpcError> {
    let mode = resolve_recovery_mode(&app);
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    match mode {
        RecoveryMode::External => {
            // WS-H-1 behaviour, unchanged: the stored path, else the env var.
            let setting = recovery::get_backup_destination(pool, &session_token)
                .await
                .map_err(IpcError::from)?;
            let effective_path = setting.path.clone().or_else(|| {
                std::env::var(recovery::BACKUP_ROOT_ENV)
                    .ok()
                    .filter(|value| !value.trim().is_empty())
            });
            Ok(BackupDestinationSetting {
                path: setting.path,
                effective_path,
                is_default: false,
                available: true,
                same_drive_warning: false,
            })
        }
        RecoveryMode::Embedded(ctx) => {
            recovery_embedded::get_destination(pool, &session_token, &ctx)
                .await
                .map_err(IpcError::from)
        }
        RecoveryMode::Unavailable(reason) => Err(recovery_unavailable(reason)),
    }
}

#[tauri::command]
pub(crate) async fn update_backup_destination_setting(
    app: AppHandle,
    state: State<'_, DatabaseState>,
    session_token: String,
    request: UpdateBackupDestinationRequest,
) -> Result<UpdateBackupDestinationResult, IpcError> {
    request
        .validate()
        .map_err(|diagnostic| IpcError::from(AppError::ValidationError { diagnostic }))?;
    let mode = resolve_recovery_mode(&app);
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    match mode {
        RecoveryMode::External => {
            recovery::update_backup_destination(pool, &session_token, &request.path)
                .await
                .map_err(IpcError::from)
        }
        RecoveryMode::Embedded(ctx) => {
            recovery_embedded::update_destination(pool, &session_token, &ctx, &request.path)
                .await
                .map_err(IpcError::from)
        }
        RecoveryMode::Unavailable(reason) => Err(recovery_unavailable(reason)),
    }
}

// ---------------------------------------------------------------------------
// Restore-verification policy (unchanged, mode-independent).
// ---------------------------------------------------------------------------

#[tauri::command]
pub(crate) async fn get_restore_verification_setting(
    state: State<'_, DatabaseState>,
    session_token: String,
) -> Result<JsonValue, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    query_scalar("SELECT operations.get_restore_verification_setting($1)")
        .bind(session_token)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn update_restore_verification_setting(
    state: State<'_, DatabaseState>,
    session_token: String,
    enabled: bool,
) -> Result<JsonValue, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    query_scalar("SELECT operations.update_restore_verification_setting($1, $2)")
        .bind(session_token)
        .bind(enabled)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)
        .map_err(IpcError::from)
}

// ---------------------------------------------------------------------------
// Create.
// ---------------------------------------------------------------------------

#[tauri::command]
pub(crate) async fn create_operator_backup(
    app: AppHandle,
    state: State<'_, DatabaseState>,
    session_token: String,
    request: CreateOperatorBackupRequest,
) -> Result<OperatorBackupCreationResult, IpcError> {
    // Held for the whole operation; released on every exit path by `Drop`.
    let _lease = RecoveryOperationLease::acquire().map_err(IpcError::from)?;
    match resolve_recovery_mode(&app) {
        RecoveryMode::External => {
            create_operator_backup_external(app, state, session_token, request).await
        }
        RecoveryMode::Embedded(ctx) => {
            let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
            recovery_embedded::create_manual_backup(pool, &session_token, &ctx, request)
                .await
                .map_err(IpcError::from)
        }
        RecoveryMode::Unavailable(reason) => Err(recovery_unavailable(reason)),
    }
}

/// WS-H-1/WS-H-2 body, moved here verbatim in WS-H-3 (EXTERNAL mode only).
async fn create_operator_backup_external(
    app: AppHandle,
    state: State<'_, DatabaseState>,
    session_token: String,
    request: CreateOperatorBackupRequest,
) -> Result<OperatorBackupCreationResult, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    let attempt = recovery_creation::begin_operator_backup_creation(pool, &session_token, request)
        .await
        .map_err(IpcError::from)?;

    let (attempt_id, request_id, bundle_identifier, current_schema_version, resume_existing) =
        match attempt {
            CreationAttempt::Replay(result) => return Ok(result),
            CreationAttempt::Run {
                attempt_id,
                request_id,
                bundle_identifier,
                current_schema_version,
                resume_existing,
            } => (
                attempt_id,
                request_id,
                bundle_identifier,
                current_schema_version,
                resume_existing,
            ),
        };

    let app_data_dir = match app.path().app_data_dir() {
        Ok(path) => path,
        Err(_) => {
            let error = AppError::BackupCreationFailed {
                diagnostic: "BACKUP_CREATION_APP_DATA_UNAVAILABLE".to_string(),
            };
            let _ = recovery_creation::complete_operator_backup_creation_failure(
                pool,
                &session_token,
                attempt_id,
                &error,
            )
            .await;
            return Err(IpcError::from(error));
        }
    };

    let canonical_root = match recovery_creation::resolve_backup_root(pool, &session_token).await {
        Ok(path) => path,
        Err(error) => {
            let _ = recovery_creation::complete_operator_backup_creation_failure(
                pool,
                &session_token,
                attempt_id,
                &error,
            )
            .await;
            return Err(IpcError::from(error));
        }
    };

    let creation = tauri::async_runtime::spawn_blocking(move || {
        recovery_creation::create_operator_backup_files(
            request_id,
            attempt_id,
            bundle_identifier,
            current_schema_version,
            resume_existing,
            app_data_dir,
            canonical_root,
        )
    })
    .await
    .map_err(|_| {
        IpcError::from(AppError::BackupCreationFailed {
            diagnostic: "BACKUP_CREATION_WORKER_FAILED".to_string(),
        })
    })?;

    match creation {
        Ok(result) => {
            recovery_creation::complete_operator_backup_creation_success(
                pool,
                &session_token,
                attempt_id,
                &result,
            )
            .await
            .map_err(IpcError::from)?;
            Ok(result)
        }
        Err(error) => {
            let _ = recovery_creation::complete_operator_backup_creation_failure(
                pool,
                &session_token,
                attempt_id,
                &error,
            )
            .await;
            Err(IpcError::from(error))
        }
    }
}

// ---------------------------------------------------------------------------
// Validate.
// ---------------------------------------------------------------------------

#[tauri::command]
pub(crate) async fn validate_operator_backup(
    app: AppHandle,
    state: State<'_, DatabaseState>,
    session_token: String,
    request: ValidateOperatorBackupRequest,
) -> Result<OperatorBackupValidationResult, IpcError> {
    // Held for the whole operation; released on every exit path by `Drop`.
    let _lease = RecoveryOperationLease::acquire().map_err(IpcError::from)?;
    match resolve_recovery_mode(&app) {
        RecoveryMode::External => {
            validate_operator_backup_external(state, session_token, request).await
        }
        RecoveryMode::Embedded(ctx) => {
            let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
            recovery_embedded::validate_backup(pool, &session_token, &ctx, request)
                .await
                .map_err(IpcError::from)
        }
        RecoveryMode::Unavailable(reason) => Err(recovery_unavailable(reason)),
    }
}

/// WS-H-1/WS-H-2 body, moved here verbatim in WS-H-3 (EXTERNAL mode only).
async fn validate_operator_backup_external(
    state: State<'_, DatabaseState>,
    session_token: String,
    request: ValidateOperatorBackupRequest,
) -> Result<OperatorBackupValidationResult, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    let attempt = recovery::begin_operator_backup_validation(pool, &session_token, request)
        .await
        .map_err(IpcError::from)?;

    let (attempt_id, request_id, bundle_path, bundle_identifier, current_schema_version) =
        match attempt {
            ValidationAttempt::Replay(result) => return Ok(result),
            ValidationAttempt::Run {
                attempt_id,
                request_id,
                bundle_path,
                bundle_identifier,
                current_schema_version,
            } => (
                attempt_id,
                request_id,
                bundle_path,
                bundle_identifier,
                current_schema_version,
            ),
        };

    let canonical_root = match recovery_creation::resolve_backup_root(pool, &session_token).await {
        Ok(path) => path,
        Err(error) => {
            let _ = recovery::complete_operator_backup_validation_failure(
                pool,
                &session_token,
                attempt_id,
                &error,
            )
            .await;
            return Err(IpcError::from(error));
        }
    };

    let validation = tauri::async_runtime::spawn_blocking(move || {
        recovery::validate_operator_backup_files(
            request_id,
            bundle_path,
            bundle_identifier,
            current_schema_version,
            canonical_root,
        )
    })
    .await
    .map_err(|_| IpcError::from(AppError::internal("backup validation worker failed")))?;

    match validation {
        Ok(result) => {
            recovery::complete_operator_backup_validation_success(
                pool,
                &session_token,
                attempt_id,
                &result,
            )
            .await
            .map_err(IpcError::from)?;
            Ok(result)
        }
        Err(error) => {
            let _ = recovery::complete_operator_backup_validation_failure(
                pool,
                &session_token,
                attempt_id,
                &error,
            )
            .await;
            Err(IpcError::from(error))
        }
    }
}

// ---------------------------------------------------------------------------
// Verify (temporary restore).
// ---------------------------------------------------------------------------

#[tauri::command]
pub(crate) async fn verify_operator_backup_restore(
    app: AppHandle,
    state: State<'_, DatabaseState>,
    session_token: String,
    request: VerifyOperatorBackupRestoreRequest,
) -> Result<OperatorRestoreVerificationResult, IpcError> {
    // Held for the whole operation; released on every exit path by `Drop`.
    let _lease = RecoveryOperationLease::acquire().map_err(IpcError::from)?;
    match resolve_recovery_mode(&app) {
        RecoveryMode::External => {
            verify_operator_backup_restore_external(state, session_token, request).await
        }
        RecoveryMode::Embedded(ctx) => {
            let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
            recovery_embedded::test_backup(pool.clone(), session_token, ctx, request)
                .await
                .map_err(IpcError::from)
        }
        RecoveryMode::Unavailable(reason) => Err(recovery_unavailable(reason)),
    }
}

/// WS-H-2 body, moved here verbatim in WS-H-3 (EXTERNAL mode only).
async fn verify_operator_backup_restore_external(
    state: State<'_, DatabaseState>,
    session_token: String,
    request: VerifyOperatorBackupRestoreRequest,
) -> Result<OperatorRestoreVerificationResult, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    let attempt = recovery::begin_operator_restore_verification(pool, &session_token, request)
        .await
        .map_err(IpcError::from)?;

    let (attempt_id, request_id, bundle_path, bundle_identifier, current_schema_version) =
        match attempt {
            RestoreVerificationAttempt::Replay(result) => return Ok(result),
            RestoreVerificationAttempt::Run {
                attempt_id,
                request_id,
                bundle_path,
                bundle_identifier,
                current_schema_version,
            } => (
                attempt_id,
                request_id,
                bundle_path,
                bundle_identifier,
                current_schema_version,
            ),
        };

    let canonical_root = match recovery_creation::resolve_backup_root(pool, &session_token).await {
        Ok(path) => path,
        Err(error) => {
            let _ = recovery::complete_operator_restore_verification_failure(
                pool,
                &session_token,
                attempt_id,
                &error,
            )
            .await;
            return Err(IpcError::from(error));
        }
    };

    let verification = recovery::verify_operator_backup_restore_runtime(
        request_id,
        bundle_path,
        bundle_identifier,
        current_schema_version,
        canonical_root,
    )
    .await;

    match verification {
        Ok(result) => {
            recovery::complete_operator_restore_verification_success(
                pool,
                &session_token,
                attempt_id,
                &result,
            )
            .await
            .map_err(IpcError::from)?;
            Ok(result)
        }
        Err(error) => {
            let _ = recovery::complete_operator_restore_verification_failure(
                pool,
                &session_token,
                attempt_id,
                &error,
            )
            .await;
            Err(IpcError::from(error))
        }
    }
}

// ---------------------------------------------------------------------------
// Backup list (H4-01/H4-05) — read-only, works in both modes.
// ---------------------------------------------------------------------------

#[tauri::command]
pub(crate) async fn list_backups(
    app: AppHandle,
    state: State<'_, DatabaseState>,
    session_token: String,
) -> Result<ListBackupsResponse, IpcError> {
    let mode = resolve_recovery_mode(&app);
    if let RecoveryMode::Unavailable(reason) = mode {
        return Err(recovery_unavailable(reason));
    }
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    let capabilities = recovery_embedded::fetch_capabilities(pool, &session_token, mode.as_str())
        .await
        .map_err(IpcError::from)?;
    if !capabilities.can_validate_backup {
        return Err(IpcError::from(AppError::PermissionDenied {
            diagnostic: "VALIDATE_BACKUP_BUNDLE required".to_string(),
        }));
    }

    match mode {
        RecoveryMode::Embedded(ctx) => recovery_embedded::list_backups(pool, &session_token, &ctx)
            .await
            .map_err(IpcError::from),
        RecoveryMode::External => list_backups_external(pool, &session_token).await,
        RecoveryMode::Unavailable(_) => unreachable!("handled above"),
    }
}

/// EXTERNAL mode: the same read-only scan of the existing `run.bat` backup
/// root; nothing in it is ever restorable (ruling R10, enforced by
/// `catalog::list_bundles`'s own `embedded_mode` parameter).
async fn list_backups_external(
    pool: &sqlx::PgPool,
    session_token: &str,
) -> Result<ListBackupsResponse, IpcError> {
    let root = match recovery_creation::resolve_backup_root(pool, session_token).await {
        Ok(path) => path,
        Err(_) => {
            return Ok(ListBackupsResponse {
                destination: None,
                items: Vec::new(),
            });
        }
    };
    let destination = root.to_string_lossy().into_owned();
    let items = tauri::async_runtime::spawn_blocking(move || catalog::list_bundles(&root, false))
        .await
        .map_err(|_| IpcError::from(AppError::internal("list backups worker failed")))?;
    Ok(ListBackupsResponse {
        destination: Some(destination),
        items,
    })
}

// ---------------------------------------------------------------------------
// Copy to another folder (H4-02/H4-05) — mode-independent.
// ---------------------------------------------------------------------------

#[tauri::command]
pub(crate) async fn copy_backup_to(
    app: AppHandle,
    state: State<'_, DatabaseState>,
    session_token: String,
    request: CopyBackupToRequest,
) -> Result<CopyBackupToResult, IpcError> {
    request
        .validate()
        .map_err(|diagnostic| IpcError::from(AppError::ValidationError { diagnostic }))?;
    let mode = resolve_recovery_mode(&app);
    if let RecoveryMode::Unavailable(reason) = mode {
        return Err(recovery_unavailable(reason));
    }
    // Held for the whole operation; released on every exit path by `Drop`.
    let _lease = RecoveryOperationLease::acquire().map_err(IpcError::from)?;
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    let capabilities = recovery_embedded::fetch_capabilities(pool, &session_token, mode.as_str())
        .await
        .map_err(IpcError::from)?;
    if !capabilities.can_create_backup {
        return Err(IpcError::from(AppError::PermissionDenied {
            diagnostic: "CREATE_BACKUP_BUNDLE required".to_string(),
        }));
    }

    let app_data_dir = app.path().app_data_dir().ok();
    recovery_embedded::copy_backup(
        &request.bundle_path,
        &request.target_directory,
        app_data_dir,
    )
    .await
    .map_err(IpcError::from)
}

// ---------------------------------------------------------------------------
// Real restore (H5-03/H5-04) — EMBEDDED only, the highest-risk path in the
// whole recovery feature. Every failure after `STOP_CONNECTIONS` is followed
// by an automatic rollback in `restore_flow::run_restore`; this command's
// job is validation, mode/permission/lease gating, resolving what the
// worker thread cannot resolve for itself, and — on success — stopping the
// embedded server before restarting the app (WS-K-4.7 orphan bug).
// ---------------------------------------------------------------------------

pub const RECOVERY_RESTORE_PROGRESS_EVENT: &str = "recovery-restore-progress";
pub const RECOVERY_RESTORE_OUTCOME_EVENT: &str = "recovery-restore-outcome";

#[derive(Clone, serde::Serialize)]
#[serde(tag = "outcome", rename_all = "SCREAMING_SNAKE_CASE")]
#[serde(rename_all_fields = "camelCase")]
enum RestoreOutcomeEvent {
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

impl From<RestoreOutcome> for RestoreOutcomeEvent {
    fn from(outcome: RestoreOutcome) -> Self {
        match outcome {
            RestoreOutcome::Succeeded {
                bundle_identifier,
                migrated_forward,
            } => RestoreOutcomeEvent::Succeeded {
                bundle_identifier,
                migrated_forward,
            },
            RestoreOutcome::AbortedBeforeChange {
                error_code,
                restart_required,
            } => RestoreOutcomeEvent::AbortedBeforeChange {
                error_code,
                restart_required,
            },
            RestoreOutcome::RolledBack {
                error_code,
                safety_bundle_identifier,
            } => RestoreOutcomeEvent::RolledBack {
                error_code,
                safety_bundle_identifier,
            },
            RestoreOutcome::RollbackFailed {
                error_code,
                safety_bundle_path,
                log_path,
            } => RestoreOutcomeEvent::RollbackFailed {
                error_code,
                safety_bundle_path,
                log_path,
            },
        }
    }
}

fn stop_embedded_server_before_restart(
    pg_handle: &std::sync::Arc<std::sync::Mutex<pg_process::EmbeddedPostgresHandle>>,
) {
    if let Err(err) = pg_process::stop_embedded_postgres_if_running(
        pg_handle,
        crate::infrastructure::embedded_setup::STOP_GRACEFUL_TIMEOUT,
    ) {
        tracing::error!("could not stop the embedded server before restart: {err}");
    }
}

#[tauri::command]
pub(crate) fn restore_backup_live(
    app: AppHandle,
    state: State<'_, DatabaseState>,
    pg_handle: State<'_, std::sync::Arc<std::sync::Mutex<pg_process::EmbeddedPostgresHandle>>>,
    session_token: String,
    request: RestoreBackupLiveRequest,
) -> Result<RestoreStarted, IpcError> {
    request
        .validate()
        .map_err(|diagnostic| IpcError::from(AppError::ValidationError { diagnostic }))?;
    let ctx = match resolve_recovery_mode(&app) {
        RecoveryMode::Embedded(ctx) => ctx,
        RecoveryMode::External => return Err(embedded_only()),
        RecoveryMode::Unavailable(reason) => return Err(recovery_unavailable(reason)),
    };
    let lease = RecoveryOperationLease::acquire().map_err(IpcError::from)?;
    let pool = db::pool_or_unavailable(state.inner())
        .map_err(IpcError::from)?
        .clone();
    let (path, name) = bundle::canonical_bundle_anywhere(&request.bundle_path)
        .map_err(|error| IpcError::from(error.to_app_error()))?;

    let prepared = tauri::async_runtime::block_on(recovery_embedded::begin_live_restore(
        &pool,
        &session_token,
        request.request_id.trim(),
        &name,
        &ctx,
    ))
    .map_err(IpcError::from)?;

    let pg_handle_arc = pg_handle.inner().clone();
    let emit_app = app.clone();
    let restore_ctx = ctx.clone();
    let session_token_for_worker = session_token.clone();

    std::thread::spawn(move || {
        let _lease = lease;
        let emit_progress = emit_app.clone();
        let emit = move |progress: RestoreProgress| {
            let _ = emit_progress.emit(RECOVERY_RESTORE_PROGRESS_EVENT, &progress);
        };
        let pool_for_close = pool.clone();
        let close_app_pool =
            move || -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>> {
                Box::pin(async move {
                    pool_for_close.close().await;
                })
            };

        let outcome = tauri::async_runtime::block_on(restore_flow::run_restore(
            &restore_ctx,
            &path,
            RestoreKind::Live {
                safety_destination: prepared.safety_destination.clone(),
                actor_username: prepared.actor_username.clone(),
                workstation_id: prepared.workstation_id.clone(),
            },
            close_app_pool,
            RestoreFaults::default(),
            emit,
        ));

        match &outcome {
            RestoreOutcome::Succeeded { .. } => {
                let _ = emit_app.emit(
                    RECOVERY_RESTORE_PROGRESS_EVENT,
                    &RestoreProgress {
                        step: restore_flow::RestoreStep::Restart,
                        status: restore_flow::RestoreStepStatus::Running,
                        detail_code: None,
                    },
                );
                let _ = emit_app.emit(
                    RECOVERY_RESTORE_OUTCOME_EVENT,
                    &RestoreOutcomeEvent::from(clone_outcome(&outcome)),
                );
                std::thread::sleep(std::time::Duration::from_millis(1500));
                stop_embedded_server_before_restart(&pg_handle_arc);
                tauri::process::restart(&emit_app.env());
            }
            RestoreOutcome::AbortedBeforeChange { error_code, .. }
            | RestoreOutcome::RolledBack { error_code, .. } => {
                let code = error_code.clone();
                let ctx_for_complete = restore_ctx.clone();
                let token_for_complete = session_token_for_worker.clone();
                let complete_result = tauri::async_runtime::block_on(
                    recovery_embedded::complete_live_restore_attempt(
                        &ctx_for_complete,
                        &token_for_complete,
                        prepared.attempt_id,
                        &code,
                    ),
                );
                if let Err(err) = complete_result {
                    tracing::error!("could not complete the RESTORE_LIVE audit row: {err:?}");
                }
                let _ = emit_app.emit(
                    RECOVERY_RESTORE_OUTCOME_EVENT,
                    &RestoreOutcomeEvent::from(clone_outcome(&outcome)),
                );
            }
            RestoreOutcome::RollbackFailed { .. } => {
                tracing::error!(
                    "restore rollback failed; the audit row is intentionally left untouched"
                );
                let _ = emit_app.emit(
                    RECOVERY_RESTORE_OUTCOME_EVENT,
                    &RestoreOutcomeEvent::from(clone_outcome(&outcome)),
                );
            }
        }
    });

    Ok(RestoreStarted { started: true })
}

/// `RestoreOutcome` holds owned `String`/`PathBuf` fields and is
/// deliberately not `Clone` in the engine (it is consumed exactly once by
/// its caller in every other context); the command layer needs to both
/// branch on it and serialize it, so this makes the one extra copy that
/// needs.
fn clone_outcome(outcome: &RestoreOutcome) -> RestoreOutcome {
    match outcome {
        RestoreOutcome::Succeeded {
            bundle_identifier,
            migrated_forward,
        } => RestoreOutcome::Succeeded {
            bundle_identifier: bundle_identifier.clone(),
            migrated_forward: *migrated_forward,
        },
        RestoreOutcome::AbortedBeforeChange {
            error_code,
            restart_required,
        } => RestoreOutcome::AbortedBeforeChange {
            error_code: error_code.clone(),
            restart_required: *restart_required,
        },
        RestoreOutcome::RolledBack {
            error_code,
            safety_bundle_identifier,
        } => RestoreOutcome::RolledBack {
            error_code: error_code.clone(),
            safety_bundle_identifier: safety_bundle_identifier.clone(),
        },
        RestoreOutcome::RollbackFailed {
            error_code,
            safety_bundle_path,
            log_path,
        } => RestoreOutcome::RollbackFailed {
            error_code: error_code.clone(),
            safety_bundle_path: safety_bundle_path.clone(),
            log_path: log_path.clone(),
        },
    }
}

#[tauri::command]
pub(crate) fn inspect_backup_for_fresh_install(
    app: AppHandle,
    state: State<'_, DatabaseState>,
    request: InspectBackupForFreshInstallRequest,
) -> Result<crate::infrastructure::recovery_engine::catalog::BackupListItemDto, IpcError> {
    request
        .validate()
        .map_err(|diagnostic| IpcError::from(AppError::ValidationError { diagnostic }))?;
    let ctx = match resolve_recovery_mode(&app) {
        RecoveryMode::Embedded(ctx) => ctx,
        RecoveryMode::External => return Err(embedded_only()),
        RecoveryMode::Unavailable(reason) => return Err(recovery_unavailable(reason)),
    };
    let _lease = RecoveryOperationLease::acquire().map_err(IpcError::from)?;
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    tauri::async_runtime::block_on(ensure_no_users_exist(pool, &ctx))?;

    let (path, _name) = bundle::canonical_bundle_anywhere(&request.bundle_path)
        .map_err(|error| IpcError::from(error.to_app_error()))?;
    let summary = crate::infrastructure::recovery_engine::bundle::inspect_bundle(&path, true)
        .map_err(|error| IpcError::from(error.to_app_error()))?;

    Ok(
        crate::infrastructure::recovery_engine::catalog::BackupListItemDto {
            bundle_identifier: summary
                .validated
                .bundle_dir
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default(),
            path: summary.validated.bundle_dir.to_string_lossy().into_owned(),
            created_at_utc: summary.created_at_utc.clone(),
            backup_kind: summary.backup_kind().to_string(),
            format_version: Some(summary.validated.bundle_format_version),
            schema_version: Some(summary.validated.schema_version.clone()),
            schema_verdict: summary.verdict.as_str().to_string(),
            restorable: summary.restorable,
            total_bytes: summary.total_bytes,
            manifest_readable: true,
        },
    )
}

async fn ensure_no_users_exist(
    pool: &sqlx::PgPool,
    ctx: &EmbeddedRecoveryContext,
) -> Result<(), IpcError> {
    let Some(info) = local_config::load_migrator_connection_info(&ctx.app_data_dir) else {
        return Err(IpcError::from(AppError::internal("no migrator credential")));
    };
    let _ = pool;
    let mut conn = crate::infrastructure::recovery_engine::live::migrator_connection(&info)
        .await
        .map_err(|error| IpcError::from(error.to_app_error()))?;
    let users = crate::infrastructure::recovery_engine::live::count_users(&mut conn)
        .await
        .map_err(|error| IpcError::from(error.to_app_error()))?;
    let _ = sqlx::Connection::close(conn).await;
    if users != 0 {
        return Err(IpcError::from(AppError::FreshRestoreNotAllowed {
            diagnostic: "iam.users is not empty".to_string(),
        }));
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn restore_backup_fresh_install(
    app: AppHandle,
    state: State<'_, DatabaseState>,
    pg_handle: State<'_, std::sync::Arc<std::sync::Mutex<pg_process::EmbeddedPostgresHandle>>>,
    request: RestoreBackupFreshInstallRequest,
) -> Result<RestoreStarted, IpcError> {
    request
        .validate()
        .map_err(|diagnostic| IpcError::from(AppError::ValidationError { diagnostic }))?;
    let ctx = match resolve_recovery_mode(&app) {
        RecoveryMode::Embedded(ctx) => ctx,
        RecoveryMode::External => return Err(embedded_only()),
        RecoveryMode::Unavailable(reason) => return Err(recovery_unavailable(reason)),
    };
    let lease = RecoveryOperationLease::acquire().map_err(IpcError::from)?;
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    tauri::async_runtime::block_on(ensure_no_users_exist(pool, &ctx))?;
    let pool = pool.clone();

    let (path, _name) = bundle::canonical_bundle_anywhere(&request.bundle_path)
        .map_err(|error| IpcError::from(error.to_app_error()))?;

    let pg_handle_arc = pg_handle.inner().clone();
    let emit_app = app.clone();
    let restore_ctx = ctx.clone();

    std::thread::spawn(move || {
        let _lease = lease;
        let emit_progress = emit_app.clone();
        let emit = move |progress: RestoreProgress| {
            let _ = emit_progress.emit(RECOVERY_RESTORE_PROGRESS_EVENT, &progress);
        };
        let pool_for_close = pool.clone();
        let close_app_pool =
            move || -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>> {
                Box::pin(async move {
                    pool_for_close.close().await;
                })
            };

        let outcome = tauri::async_runtime::block_on(restore_flow::run_restore(
            &restore_ctx,
            &path,
            RestoreKind::FreshInstall,
            close_app_pool,
            RestoreFaults::default(),
            emit,
        ));

        if let RestoreOutcome::Succeeded { .. } = &outcome {
            let _ = emit_app.emit(
                RECOVERY_RESTORE_PROGRESS_EVENT,
                &RestoreProgress {
                    step: restore_flow::RestoreStep::Restart,
                    status: restore_flow::RestoreStepStatus::Running,
                    detail_code: None,
                },
            );
            let _ = emit_app.emit(
                RECOVERY_RESTORE_OUTCOME_EVENT,
                &RestoreOutcomeEvent::from(clone_outcome(&outcome)),
            );
            std::thread::sleep(std::time::Duration::from_millis(1500));
            stop_embedded_server_before_restart(&pg_handle_arc);
            tauri::process::restart(&emit_app.env());
        } else {
            let _ = emit_app.emit(
                RECOVERY_RESTORE_OUTCOME_EVENT,
                &RestoreOutcomeEvent::from(clone_outcome(&outcome)),
            );
        }
    });

    Ok(RestoreStarted { started: true })
}

#[tauri::command]
pub(crate) fn restart_after_recovery(
    app: AppHandle,
    pg_handle: State<'_, std::sync::Arc<std::sync::Mutex<pg_process::EmbeddedPostgresHandle>>>,
) -> Result<(), IpcError> {
    stop_embedded_server_before_restart(pg_handle.inner());
    tauri::process::restart(&app.env());
}

// ---------------------------------------------------------------------------
// Automatic backups (H6-03/H6-04) — a daily backup and a mandatory backup
// before every update install. Any valid session may run one (system-
// initiated, not an operator-permissioned action); a developer/EXTERNAL
// machine reports MODE_UNSUPPORTED for both reasons rather than failing.
// ---------------------------------------------------------------------------

fn automatic_backup_skipped(reason: &str) -> AutomaticBackupResponse {
    AutomaticBackupResponse {
        status: "SKIPPED".to_string(),
        skip_reason: Some(reason.to_string()),
        result: None,
        used_fallback_destination: false,
    }
}

// Plain `fn` + `tauri::async_runtime::block_on`, not `async fn`: reaching
// `recovery_embedded::run_automatic_backup`'s migrator connection (opened,
// queried sequentially, and closed within one function) directly from an
// `async fn` Tauri command hits the same rustc HRTB "Send/Executor is not
// general enough" limitation as the WS-H-5 restore commands — confirmed by
// `cargo check` on this exact command before this fix. No background thread
// is needed here (unlike the restore commands): this call is expected to
// finish in well under the request's normal timeout, and the caller needs
// the real `AutomaticBackupResponse`, not a fire-and-forget `{started:true}`.
#[tauri::command]
pub(crate) fn run_automatic_backup(
    app: AppHandle,
    state: State<'_, DatabaseState>,
    session_token: String,
    request: RunAutomaticBackupRequest,
) -> Result<AutomaticBackupResponse, IpcError> {
    request
        .validate()
        .map_err(|diagnostic| IpcError::from(AppError::ValidationError { diagnostic }))?;
    let is_pre_update = request.reason.trim() == "PRE_UPDATE";

    let ctx = match resolve_recovery_mode(&app) {
        RecoveryMode::Embedded(ctx) => ctx,
        RecoveryMode::External => return Ok(automatic_backup_skipped("MODE_UNSUPPORTED")),
        RecoveryMode::Unavailable(reason) => {
            if is_pre_update {
                // A client machine that cannot back up must not update
                // silently (Owner ruling).
                return Err(recovery_unavailable(reason));
            }
            return Ok(automatic_backup_skipped("MODE_UNSUPPORTED"));
        }
    };

    let lease = match RecoveryOperationLease::acquire() {
        Ok(lease) => lease,
        Err(_) if !is_pre_update => return Ok(automatic_backup_skipped("BUSY")),
        Err(error) => return Err(IpcError::from(error)),
    };
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    let result = tauri::async_runtime::block_on(recovery_embedded::run_automatic_backup(
        pool,
        &session_token,
        &ctx,
        request,
    ))
    .map_err(IpcError::from);
    drop(lease);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The concurrency guarantee behind Task 2: the second caller is refused
    /// while the first holds the lease, and the lease is returned on `Drop`
    /// so a completed operation never leaves recovery disabled.
    #[test]
    fn recovery_lease_is_exclusive_and_released_on_drop() {
        let first = RecoveryOperationLease::acquire().expect("first acquire must succeed");
        assert!(
            matches!(
                RecoveryOperationLease::acquire(),
                Err(AppError::RecoveryOperationInProgress { .. })
            ),
            "a second concurrent recovery operation must be refused, not queued"
        );

        drop(first);
        let again = RecoveryOperationLease::acquire();
        assert!(
            again.is_ok(),
            "the lease must be released on Drop, or recovery stays disabled for the session"
        );
    }

    #[test]
    fn unavailable_and_embedded_only_errors_map_to_recovery_unavailable() {
        assert_eq!(
            recovery_unavailable(mode::UnavailableReason::NoMigratorCredential).code,
            crate::error::ErrorCode::RecoveryUnavailable
        );
        assert_eq!(
            embedded_only().code,
            crate::error::ErrorCode::RecoveryUnavailable
        );
    }
}
