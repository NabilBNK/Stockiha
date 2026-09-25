//! WS-I-1 — thin Tauri commands over the `reports.*` SQL functions. One
//! command per SQL function (plan §4.2); no business logic here.

use rust_decimal::Decimal;
use serde_json::Value;
use tauri::State;

use crate::application::reports::{call_report, ReportBind};
use crate::commands::documents::parse_filter_date;
use crate::error::IpcError;
use crate::infrastructure::db::{self, DatabaseState};

#[tauri::command]
pub async fn get_reports_capabilities(
    state: State<'_, DatabaseState>,
    session_token: String,
) -> Result<Value, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    call_report(
        pool,
        "SELECT reports.get_capabilities($1)",
        vec![ReportBind::Text(Some(session_token))],
    )
    .await
    .map_err(IpcError::from)
}

#[tauri::command]
pub async fn get_sales_summary(
    state: State<'_, DatabaseState>,
    session_token: String,
    date_from: String,
    date_to: String,
) -> Result<Value, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    let from = parse_filter_date(&date_from).map_err(IpcError::from)?;
    let to = parse_filter_date(&date_to).map_err(IpcError::from)?;
    call_report(
        pool,
        "SELECT reports.get_sales_summary($1, $2, $3)",
        vec![
            ReportBind::Text(Some(session_token)),
            ReportBind::Date(Some(from)),
            ReportBind::Date(Some(to)),
        ],
    )
    .await
    .map_err(IpcError::from)
}

#[tauri::command]
pub async fn get_sales_timeseries(
    state: State<'_, DatabaseState>,
    session_token: String,
    date_from: String,
    date_to: String,
    granularity: String,
) -> Result<Value, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    let from = parse_filter_date(&date_from).map_err(IpcError::from)?;
    let to = parse_filter_date(&date_to).map_err(IpcError::from)?;
    call_report(
        pool,
        "SELECT reports.get_sales_timeseries($1, $2, $3, $4)",
        vec![
            ReportBind::Text(Some(session_token)),
            ReportBind::Date(Some(from)),
            ReportBind::Date(Some(to)),
            ReportBind::Text(Some(granularity)),
        ],
    )
    .await
    .map_err(IpcError::from)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn get_sales_by_product(
    state: State<'_, DatabaseState>,
    session_token: String,
    date_from: String,
    date_to: String,
    sort: String,
    search: Option<String>,
    limit: Option<i32>,
    offset: Option<i32>,
) -> Result<Value, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    let from = parse_filter_date(&date_from).map_err(IpcError::from)?;
    let to = parse_filter_date(&date_to).map_err(IpcError::from)?;
    call_report(
        pool,
        "SELECT reports.get_sales_by_product($1, $2, $3, $4, $5, $6, $7)",
        vec![
            ReportBind::Text(Some(session_token)),
            ReportBind::Date(Some(from)),
            ReportBind::Date(Some(to)),
            ReportBind::Text(Some(sort)),
            ReportBind::Text(search),
            ReportBind::Int(limit),
            ReportBind::Int(offset),
        ],
    )
    .await
    .map_err(IpcError::from)
}

#[tauri::command]
pub async fn get_sales_by_category(
    state: State<'_, DatabaseState>,
    session_token: String,
    date_from: String,
    date_to: String,
) -> Result<Value, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    let from = parse_filter_date(&date_from).map_err(IpcError::from)?;
    let to = parse_filter_date(&date_to).map_err(IpcError::from)?;
    call_report(
        pool,
        "SELECT reports.get_sales_by_category($1, $2, $3)",
        vec![
            ReportBind::Text(Some(session_token)),
            ReportBind::Date(Some(from)),
            ReportBind::Date(Some(to)),
        ],
    )
    .await
    .map_err(IpcError::from)
}

#[tauri::command]
pub async fn get_sales_by_cashier(
    state: State<'_, DatabaseState>,
    session_token: String,
    date_from: String,
    date_to: String,
) -> Result<Value, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    let from = parse_filter_date(&date_from).map_err(IpcError::from)?;
    let to = parse_filter_date(&date_to).map_err(IpcError::from)?;
    call_report(
        pool,
        "SELECT reports.get_sales_by_cashier($1, $2, $3)",
        vec![
            ReportBind::Text(Some(session_token)),
            ReportBind::Date(Some(from)),
            ReportBind::Date(Some(to)),
        ],
    )
    .await
    .map_err(IpcError::from)
}

#[tauri::command]
pub async fn get_sales_by_hour(
    state: State<'_, DatabaseState>,
    session_token: String,
    date_from: String,
    date_to: String,
) -> Result<Value, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    let from = parse_filter_date(&date_from).map_err(IpcError::from)?;
    let to = parse_filter_date(&date_to).map_err(IpcError::from)?;
    call_report(
        pool,
        "SELECT reports.get_sales_by_hour($1, $2, $3)",
        vec![
            ReportBind::Text(Some(session_token)),
            ReportBind::Date(Some(from)),
            ReportBind::Date(Some(to)),
        ],
    )
    .await
    .map_err(IpcError::from)
}

#[tauri::command]
pub async fn get_margin_alerts(
    state: State<'_, DatabaseState>,
    session_token: String,
    date_from: String,
    date_to: String,
    threshold_pct: f64,
) -> Result<Value, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    let from = parse_filter_date(&date_from).map_err(IpcError::from)?;
    let to = parse_filter_date(&date_to).map_err(IpcError::from)?;
    // `from_f64_retain` keeps every binary digit of the incoming f64, which
    // reproduces float noise (e.g. 0.1 -> 0.1000000000000000055511151231)
    // that the plan's SQL would otherwise echo straight back in
    // `threshold_pct`; round to 2dp, matching the amounts/percentages
    // convention used throughout `reports.*`.
    let threshold = Decimal::from_f64_retain(threshold_pct)
        .map(|d| d.round_dp(2))
        .ok_or_else(|| IpcError::from(crate::error::AppError::internal("invalid threshold")))?;
    call_report(
        pool,
        "SELECT reports.get_margin_alerts($1, $2, $3, $4)",
        vec![
            ReportBind::Text(Some(session_token)),
            ReportBind::Date(Some(from)),
            ReportBind::Date(Some(to)),
            ReportBind::Num(Some(threshold)),
        ],
    )
    .await
    .map_err(IpcError::from)
}
