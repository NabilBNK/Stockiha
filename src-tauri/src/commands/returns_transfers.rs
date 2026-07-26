use crate::application::returns_transfers_service;
use crate::domain::returns_transfers::*;
use crate::error::IpcError;
use crate::infrastructure::db::{self, DatabaseState};
use serde_json::Value as JsonValue;
use tauri::State;

#[tauri::command]
pub(crate) async fn confirm_customer_return(
    state: State<'_, DatabaseState>,
    session_token: String,
    payload: ConfirmCustomerReturnPayload,
) -> Result<JsonValue, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    returns_transfers_service::confirm_customer_return(pool, &session_token, payload)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn confirm_warehouse_transfer(
    state: State<'_, DatabaseState>,
    session_token: String,
    payload: ConfirmWarehouseTransferPayload,
) -> Result<JsonValue, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    returns_transfers_service::confirm_warehouse_transfer(pool, &session_token, payload)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn confirm_stock_write_off(
    state: State<'_, DatabaseState>,
    session_token: String,
    payload: ConfirmStockWriteOffPayload,
) -> Result<JsonValue, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    returns_transfers_service::confirm_stock_write_off(pool, &session_token, payload)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn list_customer_returns(
    state: State<'_, DatabaseState>,
    session_token: String,
) -> Result<Vec<CustomerReturnDto>, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    returns_transfers_service::list_customer_returns(pool, &session_token)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn list_warehouse_transfers(
    state: State<'_, DatabaseState>,
    session_token: String,
) -> Result<Vec<WarehouseTransferDto>, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    returns_transfers_service::list_warehouse_transfers(pool, &session_token)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn list_stock_write_offs(
    state: State<'_, DatabaseState>,
    session_token: String,
) -> Result<Vec<StockWriteOffDto>, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    returns_transfers_service::list_stock_write_offs(pool, &session_token)
        .await
        .map_err(IpcError::from)
}
