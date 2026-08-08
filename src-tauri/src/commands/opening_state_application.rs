use tauri::State;

use crate::application::opening_state_application;
use crate::domain::opening_state_application::{
    ApplyOpeningStateRequest, OpeningStateApplicationContextResult, OpeningStateApplicationResult,
    OpeningStateApplicationSettingResult, UpdateOpeningStateApplicationSettingRequest,
};
use crate::error::IpcError;
use crate::infrastructure::db::{self, DatabaseState};

#[tauri::command]
pub(crate) async fn get_opening_state_application_context(
    state: State<'_, DatabaseState>,
    session_token: String,
) -> Result<OpeningStateApplicationContextResult, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    opening_state_application::get_context(pool, &session_token)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn update_opening_state_application_setting(
    state: State<'_, DatabaseState>,
    session_token: String,
    request: UpdateOpeningStateApplicationSettingRequest,
) -> Result<OpeningStateApplicationSettingResult, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    opening_state_application::update_setting(pool, &session_token, request)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn apply_opening_state(
    state: State<'_, DatabaseState>,
    session_token: String,
    request: ApplyOpeningStateRequest,
) -> Result<OpeningStateApplicationResult, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    opening_state_application::apply(pool, &session_token, request)
        .await
        .map_err(IpcError::from)
}
