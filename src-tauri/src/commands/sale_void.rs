//! WS-F-006 — thin Tauri commands for cancelling a whole cash or credit sale.

use tauri::State;

use crate::application::sale_void;
use crate::domain::sale_void::{SaleVoidResult, SessionSaleDto};
use crate::error::IpcError;
use crate::infrastructure::db::{self, DatabaseState};

#[tauri::command]
pub(crate) async fn void_sale(
    state: State<'_, DatabaseState>,
    session_token: String,
    document_id: i64,
    reason_code: String,
    note: Option<String>,
) -> Result<SaleVoidResult, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    sale_void::void_sale(
        pool,
        &session_token,
        document_id,
        &reason_code,
        note.as_deref(),
    )
    .await
    .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn list_session_sales(
    state: State<'_, DatabaseState>,
    session_token: String,
    cash_session_id: i64,
) -> Result<Vec<SessionSaleDto>, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    sale_void::list_session_sales(pool, &session_token, cash_session_id)
        .await
        .map_err(IpcError::from)
}
