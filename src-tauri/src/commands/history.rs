use crate::application::history_service;
use crate::domain::history::*;
use crate::error::IpcError;
use crate::infrastructure::db::{self, DatabaseState};
use serde_json::Value as JsonValue;
use tauri::State;

#[tauri::command]
pub(crate) async fn create_import_batch(
    state: State<'_, DatabaseState>,
    session_token: String,
    payload: CreateImportBatchPayload,
) -> Result<JsonValue, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    history_service::create_import_batch(pool, &session_token, payload)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn list_import_batches(
    state: State<'_, DatabaseState>,
    session_token: String,
) -> Result<Vec<ImportBatchDto>, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    history_service::list_import_batches(pool, &session_token)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn get_staged_records(
    state: State<'_, DatabaseState>,
    session_token: String,
    batch_id: String,
) -> Result<Vec<StagedRecordDto>, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    history_service::get_staged_records(pool, &session_token, &batch_id)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn update_staged_record(
    state: State<'_, DatabaseState>,
    session_token: String,
    payload: UpdateStagedRecordPayload,
) -> Result<JsonValue, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    history_service::update_staged_record(pool, &session_token, payload)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn replay_historical_batch(
    state: State<'_, DatabaseState>,
    session_token: String,
    batch_id: String,
) -> Result<ReplayResultDto, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    history_service::replay_historical_batch(pool, &session_token, &batch_id)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn commit_historical_batch(
    state: State<'_, DatabaseState>,
    session_token: String,
    batch_id: String,
) -> Result<CommitBatchResultDto, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    history_service::commit_historical_batch(pool, &session_token, &batch_id)
        .await
        .map_err(IpcError::from)
}
