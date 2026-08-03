use tauri::State;

use crate::application::drawer;
use crate::domain::drawer::{DrawerOperationPolicy, UpdateDrawerOperationPolicyPayload};
use crate::error::IpcError;
use crate::infrastructure::db::{self, DatabaseState};

#[tauri::command]
pub(crate) async fn list_drawer_operation_policy(
    state: State<'_, DatabaseState>,
    session_token: String,
) -> Result<Vec<DrawerOperationPolicy>, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    drawer::list_drawer_operation_policy(pool, &session_token)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn update_drawer_operation_policy(
    state: State<'_, DatabaseState>,
    session_token: String,
    payload: UpdateDrawerOperationPolicyPayload,
) -> Result<DrawerOperationPolicy, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    drawer::update_drawer_operation_policy(pool, &session_token, payload)
        .await
        .map_err(IpcError::from)
}
