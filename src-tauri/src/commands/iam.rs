use tauri::State;

use crate::application::iam;
use crate::error::IpcError;
use crate::infrastructure::db::{self, DatabaseState};

#[tauri::command]
pub(crate) async fn create_user(
    state: State<'_, DatabaseState>,
    session_token: String,
    username: String,
    password: String,
    display_name: String,
    role_code: String,
) -> Result<i64, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    iam::create_user(
        pool,
        &session_token,
        &username,
        &password,
        &display_name,
        &role_code,
    )
    .await
    .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn list_users(
    state: State<'_, DatabaseState>,
    session_token: String,
) -> Result<Vec<iam::UserSnapshot>, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    iam::list_users(pool, &session_token)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn set_user_active(
    state: State<'_, DatabaseState>,
    session_token: String,
    target_user_id: i64,
    is_active: bool,
) -> Result<(), IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    iam::set_user_active(pool, &session_token, target_user_id, is_active)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn assign_user_role(
    state: State<'_, DatabaseState>,
    session_token: String,
    target_user_id: i64,
    role_code: String,
) -> Result<(), IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    iam::assign_user_role(pool, &session_token, target_user_id, &role_code)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn create_role(
    state: State<'_, DatabaseState>,
    session_token: String,
    role_code: String,
    role_name: String,
) -> Result<i64, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    iam::create_role(pool, &session_token, &role_code, &role_name)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn list_permissions(
    state: State<'_, DatabaseState>,
    session_token: String,
) -> Result<Vec<iam::PermissionSnapshot>, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    iam::list_permissions(pool, &session_token)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn list_roles(
    state: State<'_, DatabaseState>,
    session_token: String,
) -> Result<Vec<iam::RoleSnapshot>, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    iam::list_roles(pool, &session_token)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn set_role_permissions(
    state: State<'_, DatabaseState>,
    session_token: String,
    role_code: String,
    permission_codes: Vec<String>,
) -> Result<(), IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    iam::set_role_permissions(pool, &session_token, &role_code, &permission_codes)
        .await
        .map_err(IpcError::from)
}
