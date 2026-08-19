use crate::application::purchase_transaction;
use crate::domain::procurement::{PostPurchaseTransactionPayload, PurchaseProductOption};
use crate::error::IpcError;
use crate::infrastructure::db::{self, DatabaseState};
use serde_json::Value as JsonValue;
use tauri::State;

#[tauri::command]
pub(crate) async fn list_purchase_product_options(
    state: State<'_, DatabaseState>,
    session_token: String,
) -> Result<Vec<PurchaseProductOption>, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    purchase_transaction::list_purchase_product_options(pool, &session_token)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn get_purchase_workflow_policy(
    state: State<'_, DatabaseState>,
    session_token: String,
) -> Result<JsonValue, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    purchase_transaction::get_purchase_workflow_policy(pool, &session_token)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn update_purchase_workflow_policy(
    state: State<'_, DatabaseState>,
    session_token: String,
    mode: String,
) -> Result<JsonValue, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    purchase_transaction::update_purchase_workflow_policy(pool, &session_token, &mode)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn post_purchase_transaction(
    state: State<'_, DatabaseState>,
    session_token: String,
    payload: PostPurchaseTransactionPayload,
) -> Result<JsonValue, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    purchase_transaction::post_purchase_transaction(pool, &session_token, payload)
        .await
        .map_err(IpcError::from)
}
