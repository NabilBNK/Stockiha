//! Slice 1 Frontend MVP batch — application service for the small
//! operational dashboard summary. Session-validated read; only
//! currently-supported figures, no analytics.

use sqlx::PgPool;

use crate::error::AppError;

pub(crate) struct DashboardSummary {
    pub product_count: i64,
    pub variant_count: i64,
    pub active_cash_session_id: Option<i64>,
    pub latest_document_id: Option<i64>,
    pub latest_document_number: Option<String>,
    pub pending_generation_jobs: i64,
    pub pending_print_jobs: i64,
}

pub(crate) async fn get_dashboard_summary(
    pool: &PgPool,
    session_token: &str,
    workstation_id: &str,
) -> Result<DashboardSummary, AppError> {
    let row = sqlx::query_as::<_, (i64, i64, Option<i64>, Option<i64>, Option<String>, i64, i64)>(
        "SELECT product_count, variant_count, active_cash_session_id, \
         latest_document_id, latest_document_number, pending_generation_jobs, \
         pending_print_jobs FROM core.get_dashboard_summary($1, $2)",
    )
    .bind(session_token)
    .bind(workstation_id)
    .fetch_one(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    Ok(DashboardSummary {
        product_count: row.0,
        variant_count: row.1,
        active_cash_session_id: row.2,
        latest_document_id: row.3,
        latest_document_number: row.4,
        pending_generation_jobs: row.5,
        pending_print_jobs: row.6,
    })
}
