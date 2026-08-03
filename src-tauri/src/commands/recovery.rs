use tauri::State;

use crate::application::recovery::{self, ValidationAttempt};
use crate::domain::recovery::{
    OperatorBackupValidationResult, ValidateOperatorBackupRequest,
};
use crate::error::{AppError, IpcError};
use crate::infrastructure::db::{self, DatabaseState};

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

    let ValidationAttempt::Run {
        attempt_id,
        request_id,
        bundle_path,
        bundle_identifier,
        current_schema_version,
    } = attempt
    else {
        let ValidationAttempt::Replay(result) = attempt else {
            unreachable!("validation attempt has only run or replay variants")
        };
        return Ok(result);
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
            // Preserve the original validation error for the caller. If the
            // audit completion itself fails, the STARTED attempt remains
            // resumable with the same request id rather than being falsely
            // marked complete.
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
