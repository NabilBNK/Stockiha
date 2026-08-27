use serde_json::Value as JsonValue;
use sqlx::query_scalar;
use tauri::{AppHandle, Manager, State};

use crate::application::recovery::{self, RestoreVerificationAttempt, ValidationAttempt};
use crate::application::recovery_creation::{self, CreationAttempt};
use crate::domain::recovery::{
    BackupDestinationSetting, CreateOperatorBackupRequest, OperatorBackupCreationResult,
    OperatorBackupValidationResult, OperatorRestoreVerificationResult,
    UpdateBackupDestinationRequest, UpdateBackupDestinationResult, ValidateOperatorBackupRequest,
    VerifyOperatorBackupRestoreRequest,
};
use crate::error::{AppError, IpcError};
use crate::infrastructure::db::{self, DatabaseState};

#[tauri::command]
pub(crate) async fn get_backup_destination_setting(
    state: State<'_, DatabaseState>,
    session_token: String,
) -> Result<BackupDestinationSetting, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    recovery::get_backup_destination(pool, &session_token)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn update_backup_destination_setting(
    state: State<'_, DatabaseState>,
    session_token: String,
    request: UpdateBackupDestinationRequest,
) -> Result<UpdateBackupDestinationResult, IpcError> {
    request
        .validate()
        .map_err(|diagnostic| IpcError::from(AppError::ValidationError { diagnostic }))?;
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    recovery::update_backup_destination(pool, &session_token, &request.path)
        .await
        .map_err(IpcError::from)
}

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

#[tauri::command]
pub(crate) async fn create_operator_backup(
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

#[tauri::command]
pub(crate) async fn validate_operator_backup(
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

    let validation = tauri::async_runtime::spawn_blocking(move || {
        recovery::validate_operator_backup_files(
            request_id,
            bundle_path,
            bundle_identifier,
            current_schema_version,
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

#[tauri::command]
pub(crate) async fn verify_operator_backup_restore(
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

    let verification = recovery::verify_operator_backup_restore_runtime(
        request_id,
        bundle_path,
        bundle_identifier,
        current_schema_version,
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
