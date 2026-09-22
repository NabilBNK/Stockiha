//! WS-F-002 — IPC surface for till receipt printing.
//! WS-M-1 — shop identity, print settings and the company logo file.

use serde_json::Value as JsonValue;
use tauri::{AppHandle, Manager, State};

use crate::application::printing;
use crate::error::{AppError, IpcError};
use crate::infrastructure::db::{self, DatabaseState};

#[tauri::command]
pub(crate) async fn print_raw_receipt(
    _state: State<'_, DatabaseState>,
    printer_name: String,
    payload: Vec<u8>,
) -> Result<u32, IpcError> {
    let written = printing::print_raw(&printer_name, payload).map_err(IpcError::from)?;
    Ok(written as u32)
}

#[tauri::command]
pub(crate) async fn get_printing_settings(
    state: State<'_, DatabaseState>,
    session_token: String,
) -> Result<JsonValue, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    printing::get_printing_settings(pool, &session_token)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn save_printing_settings(
    state: State<'_, DatabaseState>,
    session_token: String,
    settings: JsonValue,
) -> Result<JsonValue, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    printing::save_printing_settings(pool, &session_token, settings)
        .await
        .map_err(IpcError::from)
}

fn resolve_app_data_dir(app: &AppHandle) -> Result<std::path::PathBuf, IpcError> {
    app.path()
        .app_data_dir()
        .map_err(|err| IpcError::from(AppError::internal(err.to_string())))
}

#[tauri::command]
pub(crate) async fn set_company_logo(
    app: AppHandle,
    state: State<'_, DatabaseState>,
    session_token: String,
    source_path: String,
) -> Result<JsonValue, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    let app_data_dir = resolve_app_data_dir(&app)?;
    printing::set_company_logo(pool, &app_data_dir, &session_token, &source_path)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn get_company_logo(
    app: AppHandle,
    state: State<'_, DatabaseState>,
    session_token: String,
) -> Result<Option<String>, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    let app_data_dir = resolve_app_data_dir(&app)?;
    printing::get_company_logo(pool, &app_data_dir, &session_token)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn clear_company_logo(
    app: AppHandle,
    state: State<'_, DatabaseState>,
    session_token: String,
) -> Result<JsonValue, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    let app_data_dir = resolve_app_data_dir(&app)?;
    printing::clear_company_logo(pool, &app_data_dir, &session_token)
        .await
        .map_err(IpcError::from)
}
