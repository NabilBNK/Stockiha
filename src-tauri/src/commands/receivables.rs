use tauri::State;

use crate::application::receivables;
use crate::domain::receivables::{
    CustomerPaymentResult, OpenCustomerInvoice, PostCustomerPaymentPayload,
};
use crate::error::IpcError;
use crate::infrastructure::db::{self, DatabaseState};

#[tauri::command]
pub(crate) async fn list_open_customer_invoices(
    state: State<'_, DatabaseState>,
    session_token: String,
    customer_id: i64,
) -> Result<Vec<OpenCustomerInvoice>, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    receivables::list_open_customer_invoices(pool, &session_token, customer_id)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn post_customer_payment(
    state: State<'_, DatabaseState>,
    session_token: String,
    payload: PostCustomerPaymentPayload,
) -> Result<CustomerPaymentResult, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    receivables::post_customer_payment(pool, &session_token, payload)
        .await
        .map_err(IpcError::from)
}
