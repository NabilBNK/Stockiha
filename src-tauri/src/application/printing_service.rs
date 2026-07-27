use crate::domain::printing::*;
use crate::error::AppError;
use serde_json::Value as JsonValue;
use sqlx::PgPool;

pub(crate) async fn enqueue_print_job(
    pool: &PgPool,
    session_token: &str,
    payload: EnqueuePrintJobPayload,
) -> Result<i64, AppError> {
    let job_id: i64 = sqlx::query_scalar("SELECT core.enqueue_print_job($1, $2, $3, $4, $5)")
        .bind(session_token)
        .bind(payload.document_id)
        .bind(&payload.job_type)
        .bind(&payload.format)
        .bind(&payload.printer_name)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    Ok(job_id)
}

pub(crate) async fn list_print_jobs(
    pool: &PgPool,
    session_token: &str,
) -> Result<Vec<PrintJobDto>, AppError> {
    let res: JsonValue = sqlx::query_scalar("SELECT core.list_print_jobs($1)")
        .bind(session_token)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    let list: Vec<PrintJobDto> = serde_json::from_value(res)
        .map_err(|e| AppError::internal(format!("Failed to parse print jobs: {e}")))?;
    Ok(list)
}

pub(crate) async fn update_print_job_status(
    pool: &PgPool,
    session_token: &str,
    payload: UpdatePrintJobStatusPayload,
) -> Result<(), AppError> {
    sqlx::query("SELECT core.update_print_job_status($1, $2, $3, $4)")
        .bind(session_token)
        .bind(payload.job_id)
        .bind(&payload.status)
        .bind(&payload.error_message)
        .execute(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    Ok(())
}
