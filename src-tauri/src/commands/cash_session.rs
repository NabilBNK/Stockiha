//! Slice 1 MVP batch — thin Tauri commands for cash-session open / inspect
//! / close.

use rust_decimal::Decimal;
use serde::Serialize;
use tauri::State;
use time::OffsetDateTime;

use crate::application::cash_session;
use crate::error::IpcError;
use crate::infrastructure::db::{self, DatabaseState};

#[tauri::command]
pub(crate) async fn open_cash_session(
    state: State<'_, DatabaseState>,
    session_token: String,
    warehouse_id: i64,
    workstation_id: String,
    opening_float: Decimal,
) -> Result<i64, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    cash_session::open_cash_session(
        pool,
        &session_token,
        warehouse_id,
        &workstation_id,
        opening_float,
    )
    .await
    .map_err(IpcError::from)
}

#[derive(Serialize)]
pub(crate) struct ActiveCashSessionResponse {
    pub id: i64,
    pub warehouse_id: i64,
    pub opened_by_user_id: i64,
    pub opening_float: Decimal,
    #[serde(with = "time::serde::rfc3339")]
    pub opened_at: OffsetDateTime,
}

#[tauri::command]
pub(crate) async fn inspect_active_cash_session(
    state: State<'_, DatabaseState>,
    session_token: String,
    workstation_id: String,
) -> Result<Option<ActiveCashSessionResponse>, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    cash_session::inspect_active_cash_session(pool, &session_token, &workstation_id)
        .await
        .map(|maybe_session| {
            maybe_session.map(|session| ActiveCashSessionResponse {
                id: session.id,
                warehouse_id: session.warehouse_id,
                opened_by_user_id: session.opened_by_user_id,
                opening_float: session.opening_float,
                opened_at: session.opened_at,
            })
        })
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn close_cash_session(
    state: State<'_, DatabaseState>,
    session_token: String,
    cash_session_id: i64,
    counted_amount: Decimal,
) -> Result<i64, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    cash_session::close_cash_session(pool, &session_token, cash_session_id, counted_amount)
        .await
        .map_err(IpcError::from)
}

#[derive(Serialize)]
pub(crate) struct CashSessionDetailResponse {
    pub id: i64,
    pub warehouse_id: i64,
    pub status: String,
    pub opening_float: String,
    pub expected_amount: Option<String>,
    pub counted_amount: Option<String>,
    pub variance_amount: Option<String>,
    pub opened_at: String,
    pub closed_at: Option<String>,
}

#[tauri::command]
pub(crate) async fn get_cash_session(
    state: State<'_, DatabaseState>,
    session_token: String,
    cash_session_id: i64,
) -> Result<Option<CashSessionDetailResponse>, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    cash_session::get_cash_session(pool, &session_token, cash_session_id)
        .await
        .map(|maybe| {
            maybe.map(|d| CashSessionDetailResponse {
                id: d.id,
                warehouse_id: d.warehouse_id,
                status: d.status,
                opening_float: d.opening_float,
                expected_amount: d.expected_amount,
                counted_amount: d.counted_amount,
                variance_amount: d.variance_amount,
                opened_at: d.opened_at,
                closed_at: d.closed_at,
            })
        })
        .map_err(IpcError::from)
}
