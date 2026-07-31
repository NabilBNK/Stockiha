use crate::application::customer_service;
use crate::domain::customer::{
    CreateCustomerPayload, Customer, CustomerCapabilities, CustomerCreditSummary,
    CustomerLedgerEntry, UpdateCustomerPayload,
};
use crate::error::IpcError;
use crate::infrastructure::db::{self, DatabaseState};
use tauri::State;

#[tauri::command]
pub(crate) async fn create_customer(
    state: State<'_, DatabaseState>,
    session_token: String,
    payload: CreateCustomerPayload,
) -> Result<Customer, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    customer_service::create_customer(pool, &session_token, payload)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn update_customer(
    state: State<'_, DatabaseState>,
    session_token: String,
    payload: UpdateCustomerPayload,
) -> Result<Customer, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    customer_service::update_customer(pool, &session_token, payload)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn list_customers(
    state: State<'_, DatabaseState>,
    session_token: String,
    include_inactive: Option<bool>,
) -> Result<Vec<Customer>, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    customer_service::list_customers(pool, &session_token, include_inactive.unwrap_or(false))
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn get_customer_capabilities(
    state: State<'_, DatabaseState>,
    session_token: String,
) -> Result<CustomerCapabilities, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    customer_service::get_customer_capabilities(pool, &session_token)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn get_customer_credit_summary(
    state: State<'_, DatabaseState>,
    session_token: String,
    customer_id: i64,
) -> Result<CustomerCreditSummary, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    customer_service::get_customer_credit_summary(pool, &session_token, customer_id)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn list_customer_ledger(
    state: State<'_, DatabaseState>,
    session_token: String,
    customer_id: i64,
    limit: Option<i32>,
) -> Result<Vec<CustomerLedgerEntry>, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    customer_service::list_customer_ledger(pool, &session_token, customer_id, limit.unwrap_or(100))
        .await
        .map_err(IpcError::from)
}
