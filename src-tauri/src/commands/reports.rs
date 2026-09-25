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

// WS-I-2: finance, money owed and accountant reports.

#[tauri::command]
pub async fn get_profit_and_loss(
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
        "SELECT reports.get_profit_and_loss($1, $2, $3)",
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
pub async fn get_cash_flow(
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
        "SELECT reports.get_cash_flow($1, $2, $3)",
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
pub async fn get_monthly_summary(
    state: State<'_, DatabaseState>,
    session_token: String,
    year: i32,
    month: i32,
) -> Result<Value, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    call_report(
        pool,
        "SELECT reports.get_monthly_summary($1, $2, $3)",
        vec![
            ReportBind::Text(Some(session_token)),
            ReportBind::Int(Some(year)),
            ReportBind::Int(Some(month)),
        ],
    )
    .await
    .map_err(IpcError::from)
}

#[tauri::command]
pub async fn get_receivables_aging(
    state: State<'_, DatabaseState>,
    session_token: String,
    search: Option<String>,
    limit: Option<i32>,
    offset: Option<i32>,
) -> Result<Value, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    call_report(
        pool,
        "SELECT reports.get_receivables_aging($1, $2, $3, $4)",
        vec![
            ReportBind::Text(Some(session_token)),
            ReportBind::Text(search),
            ReportBind::Int(limit),
            ReportBind::Int(offset),
        ],
    )
    .await
    .map_err(IpcError::from)
}

#[tauri::command]
pub async fn get_customer_statement(
    state: State<'_, DatabaseState>,
    session_token: String,
    customer_id: i64,
    date_from: String,
    date_to: String,
) -> Result<Value, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    let from = parse_filter_date(&date_from).map_err(IpcError::from)?;
    let to = parse_filter_date(&date_to).map_err(IpcError::from)?;
    call_report(
        pool,
        "SELECT reports.get_customer_statement($1, $2, $3, $4)",
        vec![
            ReportBind::Text(Some(session_token)),
            ReportBind::BigInt(Some(customer_id)),
            ReportBind::Date(Some(from)),
            ReportBind::Date(Some(to)),
        ],
    )
    .await
    .map_err(IpcError::from)
}

#[tauri::command]
pub async fn get_supplier_balances(
    state: State<'_, DatabaseState>,
    session_token: String,
    search: Option<String>,
    limit: Option<i32>,
    offset: Option<i32>,
) -> Result<Value, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    call_report(
        pool,
        "SELECT reports.get_supplier_balances($1, $2, $3, $4)",
        vec![
            ReportBind::Text(Some(session_token)),
            ReportBind::Text(search),
            ReportBind::Int(limit),
            ReportBind::Int(offset),
        ],
    )
    .await
    .map_err(IpcError::from)
}

#[tauri::command]
pub async fn get_supplier_statement(
    state: State<'_, DatabaseState>,
    session_token: String,
    supplier_id: i64,
    date_from: String,
    date_to: String,
) -> Result<Value, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    let from = parse_filter_date(&date_from).map_err(IpcError::from)?;
    let to = parse_filter_date(&date_to).map_err(IpcError::from)?;
    call_report(
        pool,
        "SELECT reports.get_supplier_statement($1, $2, $3, $4)",
        vec![
            ReportBind::Text(Some(session_token)),
            ReportBind::BigInt(Some(supplier_id)),
            ReportBind::Date(Some(from)),
            ReportBind::Date(Some(to)),
        ],
    )
    .await
    .map_err(IpcError::from)
}

#[tauri::command]
pub async fn get_trial_balance(
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
        "SELECT reports.get_trial_balance($1, $2, $3)",
        vec![
            ReportBind::Text(Some(session_token)),
            ReportBind::Date(Some(from)),
            ReportBind::Date(Some(to)),
        ],
    )
    .await
    .map_err(IpcError::from)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn get_account_ledger(
    state: State<'_, DatabaseState>,
    session_token: String,
    account_id: i64,
    date_from: String,
    date_to: String,
    limit: Option<i32>,
    offset: Option<i32>,
) -> Result<Value, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    let from = parse_filter_date(&date_from).map_err(IpcError::from)?;
    let to = parse_filter_date(&date_to).map_err(IpcError::from)?;
    call_report(
        pool,
        "SELECT reports.get_account_ledger($1, $2, $3, $4, $5, $6)",
        vec![
            ReportBind::Text(Some(session_token)),
            ReportBind::BigInt(Some(account_id)),
            ReportBind::Date(Some(from)),
            ReportBind::Date(Some(to)),
            ReportBind::Int(limit),
            ReportBind::Int(offset),
        ],
    )
    .await
    .map_err(IpcError::from)
}

#[tauri::command]
pub async fn list_report_accounts(
    state: State<'_, DatabaseState>,
    session_token: String,
) -> Result<Value, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    call_report(
        pool,
        "SELECT reports.list_accounts($1)",
        vec![ReportBind::Text(Some(session_token))],
    )
    .await
    .map_err(IpcError::from)
}

// WS-I-3 — stock reports, notifications and the Today home.

#[tauri::command]
pub async fn get_stock_valuation(
    state: State<'_, DatabaseState>,
    session_token: String,
    category_id: Option<i64>,
    search: Option<String>,
    limit: Option<i32>,
    offset: Option<i32>,
) -> Result<Value, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    call_report(
        pool,
        "SELECT reports.get_stock_valuation($1, $2, $3, $4, $5)",
        vec![
            ReportBind::Text(Some(session_token)),
            ReportBind::BigInt(category_id),
            ReportBind::Text(search),
            ReportBind::Int(limit),
            ReportBind::Int(offset),
        ],
    )
    .await
    .map_err(IpcError::from)
}

#[tauri::command]
pub async fn get_low_stock(
    state: State<'_, DatabaseState>,
    session_token: String,
    search: Option<String>,
    limit: Option<i32>,
    offset: Option<i32>,
) -> Result<Value, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    call_report(
        pool,
        "SELECT reports.get_low_stock($1, $2, $3, $4)",
        vec![
            ReportBind::Text(Some(session_token)),
            ReportBind::Text(search),
            ReportBind::Int(limit),
            ReportBind::Int(offset),
        ],
    )
    .await
    .map_err(IpcError::from)
}

#[tauri::command]
pub async fn get_slow_movers(
    state: State<'_, DatabaseState>,
    session_token: String,
    days: i32,
    search: Option<String>,
    limit: Option<i32>,
    offset: Option<i32>,
) -> Result<Value, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    call_report(
        pool,
        "SELECT reports.get_slow_movers($1, $2, $3, $4, $5)",
        vec![
            ReportBind::Text(Some(session_token)),
            ReportBind::Int(Some(days)),
            ReportBind::Text(search),
            ReportBind::Int(limit),
            ReportBind::Int(offset),
        ],
    )
    .await
    .map_err(IpcError::from)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn get_product_history(
    state: State<'_, DatabaseState>,
    session_token: String,
    variant_id: i64,
    date_from: String,
    date_to: String,
    limit: Option<i32>,
    offset: Option<i32>,
) -> Result<Value, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    let from = parse_filter_date(&date_from).map_err(IpcError::from)?;
    let to = parse_filter_date(&date_to).map_err(IpcError::from)?;
    call_report(
        pool,
        "SELECT reports.get_product_history($1, $2, $3, $4, $5, $6)",
        vec![
            ReportBind::Text(Some(session_token)),
            ReportBind::BigInt(Some(variant_id)),
            ReportBind::Date(Some(from)),
            ReportBind::Date(Some(to)),
            ReportBind::Int(limit),
            ReportBind::Int(offset),
        ],
    )
    .await
    .map_err(IpcError::from)
}

#[tauri::command]
pub async fn get_report_notifications(
    state: State<'_, DatabaseState>,
    session_token: String,
) -> Result<Value, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    call_report(
        pool,
        "SELECT reports.get_notifications($1)",
        vec![ReportBind::Text(Some(session_token))],
    )
    .await
    .map_err(IpcError::from)
}

#[tauri::command]
pub async fn get_today_overview(
    state: State<'_, DatabaseState>,
    session_token: String,
) -> Result<Value, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    call_report(
        pool,
        "SELECT reports.get_today($1)",
        vec![ReportBind::Text(Some(session_token))],
    )
    .await
    .map_err(IpcError::from)
}
