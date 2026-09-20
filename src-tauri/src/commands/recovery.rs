use std::sync::atomic::{AtomicBool, Ordering};

use serde_json::Value as JsonValue;
use sqlx::query_scalar;
use tauri::{AppHandle, Manager, State};

use crate::application::recovery::{self, RestoreVerificationAttempt, ValidationAttempt};
use crate::application::recovery_creation::{self, CreationAttempt};
use crate::application::recovery_embedded;
use crate::domain::recovery::{
    BackupDestinationSetting, BackupStatus, CopyBackupToRequest, CopyBackupToResult,
    CreateOperatorBackupRequest, ListBackupsResponse, OperatorBackupCreationResult,
    OperatorBackupValidationResult, OperatorRestoreVerificationResult, RecoveryCapabilities,
    RecoveryModeResponse, UpdateBackupDestinationRequest, UpdateBackupDestinationResult,
    ValidateOperatorBackupRequest, VerifyOperatorBackupRestoreRequest,
};
use crate::error::{AppError, IpcError};
use crate::infrastructure::db::{self, DatabaseState};
use crate::infrastructure::recovery_engine::catalog;
use crate::infrastructure::recovery_engine::mode::{self, RecoveryMode};
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
struct RecoveryOperationLease;

impl RecoveryOperationLease {
    fn acquire() -> Result<Self, AppError> {
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
