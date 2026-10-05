//! WS-N-1: Tauri commands for dashboard data and insights.
//! Translates IPC requests, parses ISO dates/times, and delegates to the
//! application service.

use tauri::State;

use crate::application::dashboard_insights::{
    self, parse_hms, parse_iso_date, DashboardAgingRowDto, DashboardBusyCellDto,
    DashboardCategoryRowDto, DashboardDebtorDto, DashboardLatestSaleDto, DashboardMoneySummaryDto,
    DashboardPeriodDto, DashboardSeriesRowDto, DashboardStockItemDto, DashboardStockSummaryDto,
    DashboardTopCustomerDto, DashboardTopItemDto,
};
use crate::error::IpcError;
use crate::infrastructure::db::{self, DatabaseState};

#[inline]
fn log_slow(command_name: &str, started: std::time::Instant) {
    if cfg!(debug_assertions) {
        let elapsed = started.elapsed().as_millis();
        if elapsed > 300 {
            eprintln!("[DASHBOARD] {command_name} {elapsed}ms");
        }
    }
}

#[tauri::command]
pub(crate) async fn dashboard_get_period(
    state: State<'_, DatabaseState>,
    session_token: String,
    period: String,
    from: Option<String>,
    to: Option<String>,
) -> Result<DashboardPeriodDto, IpcError> {
    let started = std::time::Instant::now();
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    let parsed_from = from
        .as_deref()
        .map(parse_iso_date)
        .transpose()
        .map_err(IpcError::from)?;
    let parsed_to = to
        .as_deref()
        .map(parse_iso_date)
        .transpose()
        .map_err(IpcError::from)?;
    let result =
        dashboard_insights::get_period(pool, &session_token, &period, parsed_from, parsed_to)
            .await
            .map_err(IpcError::from);
    log_slow("dashboard_get_period", started);
    result
}

#[tauri::command]
pub(crate) async fn dashboard_get_money_summary(
    state: State<'_, DatabaseState>,
    session_token: String,
    cur_from: String,
    cur_to: String,
    prev_from: String,
    prev_to: String,
    cut_time: Option<String>,
) -> Result<DashboardMoneySummaryDto, IpcError> {
    let started = std::time::Instant::now();
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    let parsed_cur_from = parse_iso_date(&cur_from).map_err(IpcError::from)?;
    let parsed_cur_to = parse_iso_date(&cur_to).map_err(IpcError::from)?;
    let parsed_prev_from = parse_iso_date(&prev_from).map_err(IpcError::from)?;
    let parsed_prev_to = parse_iso_date(&prev_to).map_err(IpcError::from)?;
    let parsed_cut_time = cut_time
        .as_deref()
        .map(parse_hms)
        .transpose()
        .map_err(IpcError::from)?;
    let result = dashboard_insights::get_money_summary(
        pool,
        &session_token,
        parsed_cur_from,
        parsed_cur_to,
        parsed_prev_from,
        parsed_prev_to,
        parsed_cut_time,
    )
    .await
    .map_err(IpcError::from);
    log_slow("dashboard_get_money_summary", started);
    result
}

#[tauri::command]
pub(crate) async fn dashboard_get_stock_summary(
    state: State<'_, DatabaseState>,
    session_token: String,
    dead_days: i32,
) -> Result<DashboardStockSummaryDto, IpcError> {
    let started = std::time::Instant::now();
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    let result = dashboard_insights::get_stock_summary(pool, &session_token, dead_days)
        .await
        .map_err(IpcError::from);
    log_slow("dashboard_get_stock_summary", started);
    result
}

#[tauri::command]
pub(crate) async fn dashboard_list_stock_items(
    state: State<'_, DatabaseState>,
    session_token: String,
    kind: String,
    dead_days: i32,
    limit: i32,
    offset: i32,
) -> Result<Vec<DashboardStockItemDto>, IpcError> {
    let started = std::time::Instant::now();
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    let result =
        dashboard_insights::list_stock_items(pool, &session_token, &kind, dead_days, limit, offset)
            .await
            .map_err(IpcError::from);
    log_slow("dashboard_list_stock_items", started);
    result
}

#[tauri::command]
pub(crate) async fn dashboard_list_top_items(
    state: State<'_, DatabaseState>,
    session_token: String,
    from: String,
    to: String,
    limit: i32,
) -> Result<Vec<DashboardTopItemDto>, IpcError> {
    let started = std::time::Instant::now();
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    let parsed_from = parse_iso_date(&from).map_err(IpcError::from)?;
    let parsed_to = parse_iso_date(&to).map_err(IpcError::from)?;
    let result =
        dashboard_insights::list_top_items(pool, &session_token, parsed_from, parsed_to, limit)
            .await
            .map_err(IpcError::from);
    log_slow("dashboard_list_top_items", started);
    result
}

#[tauri::command]
pub(crate) async fn dashboard_list_top_customers(
    state: State<'_, DatabaseState>,
    session_token: String,
    from: String,
    to: String,
) -> Result<Vec<DashboardTopCustomerDto>, IpcError> {
    let started = std::time::Instant::now();
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    let parsed_from = parse_iso_date(&from).map_err(IpcError::from)?;
    let parsed_to = parse_iso_date(&to).map_err(IpcError::from)?;
    let result =
        dashboard_insights::list_top_customers(pool, &session_token, parsed_from, parsed_to)
            .await
            .map_err(IpcError::from);
    log_slow("dashboard_list_top_customers", started);
    result
}

#[tauri::command]
pub(crate) async fn dashboard_list_top_debtors(
    state: State<'_, DatabaseState>,
    session_token: String,
) -> Result<Vec<DashboardDebtorDto>, IpcError> {
    let started = std::time::Instant::now();
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    let result = dashboard_insights::list_top_debtors(pool, &session_token)
        .await
        .map_err(IpcError::from);
    log_slow("dashboard_list_top_debtors", started);
    result
}

#[tauri::command]
pub(crate) async fn dashboard_list_latest_sales(
    state: State<'_, DatabaseState>,
    session_token: String,
) -> Result<Vec<DashboardLatestSaleDto>, IpcError> {
    let started = std::time::Instant::now();
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    let result = dashboard_insights::list_latest_sales(pool, &session_token)
        .await
        .map_err(IpcError::from);
    log_slow("dashboard_list_latest_sales", started);
    result
}

#[tauri::command]
pub(crate) async fn dashboard_get_sales_series(
    state: State<'_, DatabaseState>,
    session_token: String,
    from: String,
    to: String,
    bucket: String,
) -> Result<Vec<DashboardSeriesRowDto>, IpcError> {
    let started = std::time::Instant::now();
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    let parsed_from = parse_iso_date(&from).map_err(IpcError::from)?;
    let parsed_to = parse_iso_date(&to).map_err(IpcError::from)?;
    let result =
        dashboard_insights::get_sales_series(pool, &session_token, parsed_from, parsed_to, &bucket)
            .await
            .map_err(IpcError::from);
    log_slow("dashboard_get_sales_series", started);
    result
}

#[tauri::command]
pub(crate) async fn dashboard_get_sales_by_category(
    state: State<'_, DatabaseState>,
    session_token: String,
    from: String,
    to: String,
) -> Result<Vec<DashboardCategoryRowDto>, IpcError> {
    let started = std::time::Instant::now();
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    let parsed_from = parse_iso_date(&from).map_err(IpcError::from)?;
    let parsed_to = parse_iso_date(&to).map_err(IpcError::from)?;
    let result =
        dashboard_insights::get_sales_by_category(pool, &session_token, parsed_from, parsed_to)
            .await
            .map_err(IpcError::from);
    log_slow("dashboard_get_sales_by_category", started);
    result
}

#[tauri::command]
pub(crate) async fn dashboard_get_busy_hours(
    state: State<'_, DatabaseState>,
    session_token: String,
    from: String,
    to: String,
) -> Result<Vec<DashboardBusyCellDto>, IpcError> {
    let started = std::time::Instant::now();
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    let parsed_from = parse_iso_date(&from).map_err(IpcError::from)?;
    let parsed_to = parse_iso_date(&to).map_err(IpcError::from)?;
    let result = dashboard_insights::get_busy_hours(pool, &session_token, parsed_from, parsed_to)
        .await
        .map_err(IpcError::from);
    log_slow("dashboard_get_busy_hours", started);
    result
}

#[tauri::command]
pub(crate) async fn dashboard_get_receivables_aging(
    state: State<'_, DatabaseState>,
    session_token: String,
) -> Result<Vec<DashboardAgingRowDto>, IpcError> {
    let started = std::time::Instant::now();
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    let result = dashboard_insights::get_receivables_aging(pool, &session_token)
        .await
        .map_err(IpcError::from);
    log_slow("dashboard_get_receivables_aging", started);
    result
}
