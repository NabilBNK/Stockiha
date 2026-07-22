//! Slice 1 Frontend MVP batch — thin Tauri commands for reference-data reads
//! (fiscal periods) and the dashboard summary.

use serde::Serialize;
use tauri::State;

use crate::application::{dashboard, fiscal};
use crate::error::IpcError;
use crate::infrastructure::db::{self, DatabaseState};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FiscalPeriodResponse {
    pub id: i64,
    pub period_code: String,
    pub starts_on: String,
    pub ends_on: String,
    pub status: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenFiscalPeriodResponse {
    pub id: i64,
    pub period_code: String,
    pub starts_on: String,
    pub ends_on: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DashboardSummaryResponse {
    pub product_count: i64,
    pub variant_count: i64,
    pub active_cash_session_id: Option<i64>,
    pub latest_document_id: Option<i64>,
    pub latest_document_number: Option<String>,
    pub pending_generation_jobs: i64,
    pub pending_print_jobs: i64,
}

#[tauri::command]
pub(crate) async fn list_fiscal_periods(
    state: State<'_, DatabaseState>,
    session_token: String,
) -> Result<Vec<FiscalPeriodResponse>, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    fiscal::list_fiscal_periods(pool, &session_token)
        .await
        .map(|items| {
            items
                .into_iter()
                .map(|p| FiscalPeriodResponse {
                    id: p.id,
                    period_code: p.period_code,
                    starts_on: p.starts_on,
                    ends_on: p.ends_on,
                    status: p.status,
                })
                .collect()
        })
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn get_open_fiscal_period(
    state: State<'_, DatabaseState>,
    session_token: String,
) -> Result<Option<OpenFiscalPeriodResponse>, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    fiscal::get_open_fiscal_period(pool, &session_token)
        .await
        .map(|maybe| {
            maybe.map(|p| OpenFiscalPeriodResponse {
                id: p.id,
                period_code: p.period_code,
                starts_on: p.starts_on,
                ends_on: p.ends_on,
            })
        })
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn get_dashboard_summary(
    state: State<'_, DatabaseState>,
    session_token: String,
    workstation_id: String,
) -> Result<DashboardSummaryResponse, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    dashboard::get_dashboard_summary(pool, &session_token, &workstation_id)
        .await
        .map(|d| DashboardSummaryResponse {
            product_count: d.product_count,
            variant_count: d.variant_count,
            active_cash_session_id: d.active_cash_session_id,
            latest_document_id: d.latest_document_id,
            latest_document_number: d.latest_document_number,
            pending_generation_jobs: d.pending_generation_jobs,
            pending_print_jobs: d.pending_print_jobs,
        })
        .map_err(IpcError::from)
}
