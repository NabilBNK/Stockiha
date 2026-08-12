//! Thin Tauri commands for read-only financial journals.

use serde_json::Value;
use tauri::State;

use crate::application::finance_service;
use crate::error::IpcError;
use crate::infrastructure::db::{self, DatabaseState};

#[tauri::command]
pub(crate) async fn list_journals(
    state: State<'_, DatabaseState>,
    session_token: String,
    limit: Option<i32>,
    offset: Option<i32>,
) -> Result<Value, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    finance_service::list_journals(
        pool,
        &session_token,
        limit.unwrap_or(100),
        offset.unwrap_or(0),
    )
    .await
    .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn get_journal_detail(
    state: State<'_, DatabaseState>,
    session_token: String,
    journal_doc_id: i64,
) -> Result<Value, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    finance_service::get_journal_detail(pool, &session_token, journal_doc_id)
        .await
        .map_err(IpcError::from)
}
