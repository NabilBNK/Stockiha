use crate::application::printing_service;
use crate::domain::printing::*;
use crate::error::IpcError;
use crate::infrastructure::db::{self, DatabaseState};
use tauri::State;

#[tauri::command]
pub(crate) async fn enqueue_print_job(
    state: State<'_, DatabaseState>,
    session_token: String,
    payload: EnqueuePrintJobPayload,
) -> Result<i64, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    printing_service::enqueue_print_job(pool, &session_token, payload)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn list_print_jobs(
    state: State<'_, DatabaseState>,
    session_token: String,
) -> Result<Vec<PrintJobDto>, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    printing_service::list_print_jobs(pool, &session_token)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn update_print_job_status(
    state: State<'_, DatabaseState>,
    session_token: String,
    payload: UpdatePrintJobStatusPayload,
) -> Result<(), IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    printing_service::update_print_job_status(pool, &session_token, payload)
        .await
        .map_err(IpcError::from)
}
