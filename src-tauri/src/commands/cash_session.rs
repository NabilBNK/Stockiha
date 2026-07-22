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
