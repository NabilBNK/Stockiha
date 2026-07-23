//! Slice 1 Frontend MVP batch — thin Tauri commands for warehouse reads and
//! creation.

use serde::Serialize;
use tauri::State;

use crate::application::warehouse;
use crate::error::IpcError;
use crate::infrastructure::db::{self, DatabaseState};

#[derive(Serialize)]
pub(crate) struct WarehouseResponse {
    pub id: i64,
    pub code: String,
    pub name: String,
    pub is_active: bool,
}

#[tauri::command]
pub(crate) async fn create_warehouse(
    state: State<'_, DatabaseState>,
    session_token: String,
    code: String,
    name: String,
) -> Result<i64, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    warehouse::create_warehouse(pool, &session_token, &code, &name)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn list_warehouses(
    state: State<'_, DatabaseState>,
    session_token: String,
) -> Result<Vec<WarehouseResponse>, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    warehouse::list_warehouses(pool, &session_token)
        .await
        .map(|items| {
            items
                .into_iter()
                .map(|w| WarehouseResponse {
                    id: w.id,
                    code: w.code,
                    name: w.name,
                    is_active: w.is_active,
                })
                .collect()
        })
        .map_err(IpcError::from)
}
