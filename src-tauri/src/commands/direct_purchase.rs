use crate::application::direct_purchase;
use crate::domain::direct_purchase::{
    ConfirmDirectPurchasePayload, ConfirmDirectPurchaseResult,
};
use crate::error::IpcError;
use crate::infrastructure::db::{self, DatabaseState};
use tauri::State;

#[tauri::command]
pub(crate) async fn confirm_direct_purchase(
    state: State<'_, DatabaseState>,
    session_token: String,
    payload: ConfirmDirectPurchasePayload,
) -> Result<ConfirmDirectPurchaseResult, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    direct_purchase::confirm_direct_purchase(pool, &session_token, payload)
        .await
        .map_err(IpcError::from)
}
