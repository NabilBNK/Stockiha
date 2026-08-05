use tauri::State;

use crate::application::opening_state;
use crate::domain::opening_state::{
    CreateOpeningStatePackageRequest, OpeningStateApprovalResult,
    OpeningStatePackageDataResult, OpeningStatePackageIdRequest,
    OpeningStatePackageResult, OpeningStatePackageSummaryResult,
    OpeningStateSettingResult, OpeningStateValidationResult,
    ReplaceOpeningStatePackageDataRequest, UpdateOpeningStateSettingRequest,
};
use crate::error::IpcError;
use crate::infrastructure::db::{self, DatabaseState};

#[tauri::command]
pub(crate) async fn get_opening_state_setting(
    state: State<'_, DatabaseState>,
    session_token: String,
) -> Result<OpeningStateSettingResult, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    opening_state::get_opening_state_setting(pool, &session_token)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn update_opening_state_setting(
    state: State<'_, DatabaseState>,
    session_token: String,
    request: UpdateOpeningStateSettingRequest,
) -> Result<OpeningStateSettingResult, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    opening_state::update_opening_state_setting(pool, &session_token, request)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn create_opening_state_package(
    state: State<'_, DatabaseState>,
    session_token: String,
    request: CreateOpeningStatePackageRequest,
) -> Result<OpeningStatePackageResult, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    opening_state::create_opening_state_package(pool, &session_token, request)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn replace_opening_state_package_data(
    state: State<'_, DatabaseState>,
    session_token: String,
    request: ReplaceOpeningStatePackageDataRequest,
) -> Result<OpeningStatePackageDataResult, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    opening_state::replace_opening_state_package_data(pool, &session_token, request)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn validate_opening_state_package(
    state: State<'_, DatabaseState>,
    session_token: String,
    request: OpeningStatePackageIdRequest,
) -> Result<OpeningStateValidationResult, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    opening_state::validate_opening_state_package(pool, &session_token, request)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn approve_opening_state_package(
    state: State<'_, DatabaseState>,
    session_token: String,
    request: OpeningStatePackageIdRequest,
) -> Result<OpeningStateApprovalResult, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    opening_state::approve_opening_state_package(pool, &session_token, request)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn get_opening_state_package(
    state: State<'_, DatabaseState>,
    session_token: String,
    request: OpeningStatePackageIdRequest,
) -> Result<OpeningStatePackageSummaryResult, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    opening_state::get_opening_state_package(pool, &session_token, request)
        .await
        .map_err(IpcError::from)
}
