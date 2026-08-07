use tauri::State;

use crate::application::onboarding;
use crate::domain::onboarding::{
    CreateHistoricalFinanceBatchRequest, CreateHistoricalTradeBatchRequest,
    HistoricalFinanceApprovalResult, HistoricalFinanceBatchDataResult,
    HistoricalFinanceBatchIdRequest, HistoricalFinanceBatchResult, HistoricalFinanceSettingResult,
    HistoricalFinanceSummaryRequest, HistoricalFinanceSummaryResult,
    HistoricalFinanceValidationResult, HistoricalTradeAnalyticsRequest,
    HistoricalTradeBatchDataResult, HistoricalTradeBatchResult, HistoricalTradeValidationResult,
    ReplaceHistoricalFinanceBatchDataRequest, ReplaceHistoricalTradeBatchDataRequest,
    UpdateHistoricalFinanceSettingRequest,
};
use crate::error::IpcError;
use crate::infrastructure::db::{self, DatabaseState};
use serde_json::Value as JsonValue;

#[tauri::command]
pub(crate) async fn get_historical_finance_setting(
    state: State<'_, DatabaseState>,
    session_token: String,
) -> Result<HistoricalFinanceSettingResult, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    onboarding::get_historical_finance_setting(pool, &session_token)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn update_historical_finance_setting(
    state: State<'_, DatabaseState>,
    session_token: String,
    request: UpdateHistoricalFinanceSettingRequest,
) -> Result<HistoricalFinanceSettingResult, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    onboarding::update_historical_finance_setting(pool, &session_token, request)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn create_historical_finance_batch(
    state: State<'_, DatabaseState>,
    session_token: String,
    request: CreateHistoricalFinanceBatchRequest,
) -> Result<HistoricalFinanceBatchResult, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    onboarding::create_historical_finance_batch(pool, &session_token, request)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn replace_historical_finance_batch_data(
    state: State<'_, DatabaseState>,
    session_token: String,
    request: ReplaceHistoricalFinanceBatchDataRequest,
) -> Result<HistoricalFinanceBatchDataResult, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    onboarding::replace_historical_finance_batch_data(pool, &session_token, request)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn validate_historical_finance_batch(
    state: State<'_, DatabaseState>,
    session_token: String,
    request: HistoricalFinanceBatchIdRequest,
) -> Result<HistoricalFinanceValidationResult, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    onboarding::validate_historical_finance_batch(pool, &session_token, request)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn approve_historical_finance_batch(
    state: State<'_, DatabaseState>,
    session_token: String,
    request: HistoricalFinanceBatchIdRequest,
) -> Result<HistoricalFinanceApprovalResult, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    onboarding::approve_historical_finance_batch(pool, &session_token, request)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn get_historical_finance_summary(
    state: State<'_, DatabaseState>,
    session_token: String,
    request: HistoricalFinanceSummaryRequest,
) -> Result<HistoricalFinanceSummaryResult, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    onboarding::get_historical_finance_summary(pool, &session_token, request)
        .await
        .map_err(IpcError::from)
}

// --- R0-002 Paper-Book Tauri Commands ---

#[tauri::command]
pub(crate) async fn create_historical_trade_batch(
    state: State<'_, DatabaseState>,
    session_token: String,
    request: CreateHistoricalTradeBatchRequest,
) -> Result<HistoricalTradeBatchResult, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    onboarding::create_historical_trade_batch(pool, &session_token, request)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn replace_historical_trade_batch_data(
    state: State<'_, DatabaseState>,
    session_token: String,
    request: ReplaceHistoricalTradeBatchDataRequest,
) -> Result<HistoricalTradeBatchDataResult, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    onboarding::replace_historical_trade_batch_data(pool, &session_token, request)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn validate_historical_trade_batch(
    state: State<'_, DatabaseState>,
    session_token: String,
    request: HistoricalFinanceBatchIdRequest,
) -> Result<HistoricalTradeValidationResult, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    onboarding::validate_historical_trade_batch(pool, &session_token, request)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn approve_historical_trade_batch(
    state: State<'_, DatabaseState>,
    session_token: String,
    request: HistoricalFinanceBatchIdRequest,
) -> Result<HistoricalFinanceApprovalResult, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    onboarding::approve_historical_trade_batch(pool, &session_token, request)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn get_historical_trade_analytics(
    state: State<'_, DatabaseState>,
    session_token: String,
    request: HistoricalTradeAnalyticsRequest,
) -> Result<JsonValue, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    onboarding::get_historical_trade_analytics(pool, &session_token, request)
        .await
        .map_err(IpcError::from)
}

