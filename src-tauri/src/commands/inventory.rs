//! R8-D thin Tauri commands for capability and inventory snapshot reads.

use tauri::State;

use crate::application::inventory::{self, InventoryCapabilities, InventorySnapshotItem};
use crate::error::IpcError;
use crate::infrastructure::db::{self, DatabaseState};

#[tauri::command]
pub(crate) async fn get_inventory_capabilities(
    state: State<'_, DatabaseState>,
    session_token: String,
) -> Result<InventoryCapabilities, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    inventory::get_capabilities(pool, &session_token)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn list_inventory_snapshot(
    state: State<'_, DatabaseState>,
    session_token: String,
    warehouse_id: i64,
    search: Option<String>,
    include_inactive: Option<bool>,
) -> Result<Vec<InventorySnapshotItem>, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    inventory::list_inventory_snapshot(
        pool,
        &session_token,
        warehouse_id,
        search.as_deref(),
        include_inactive.unwrap_or(false),
    )
    .await
    .map_err(IpcError::from)
}
