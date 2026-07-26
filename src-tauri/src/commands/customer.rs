use crate::application::customer_service;
use crate::domain::customer::{
    CreateCustomerPayload, Customer, CustomerLiabilityDto, CustomerPaymentDto,
    PostCustomerPaymentPayload,
};
use crate::error::IpcError;
use crate::infrastructure::db::{self, DatabaseState};
use serde_json::Value as JsonValue;
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
pub(crate) async fn list_customer_liabilities(
    state: State<'_, DatabaseState>,
    session_token: String,
    customer_id: Option<i64>,
) -> Result<Vec<CustomerLiabilityDto>, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    customer_service::list_customer_liabilities(pool, &session_token, customer_id)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn list_customer_payments(
    state: State<'_, DatabaseState>,
    session_token: String,
    customer_id: Option<i64>,
) -> Result<Vec<CustomerPaymentDto>, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    customer_service::list_customer_payments(pool, &session_token, customer_id)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn post_customer_payment(
    state: State<'_, DatabaseState>,
    session_token: String,
    payload: PostCustomerPaymentPayload,
) -> Result<JsonValue, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    customer_service::post_customer_payment(pool, &session_token, payload)
        .await
        .map_err(IpcError::from)
}
