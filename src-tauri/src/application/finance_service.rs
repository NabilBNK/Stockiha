//! Financial application services: read-only journal list and detail queries.

use serde_json::Value;
use sqlx::PgPool;

use crate::error::AppError;

pub(crate) async fn list_journals(
    pool: &PgPool,
    session_token: &str,
    limit: i32,
    offset: i32,
) -> Result<Value, AppError> {
    let res: Value = sqlx::query_scalar("SELECT finance.list_journals($1, $2, $3)")
        .bind(session_token)
        .bind(limit)
        .bind(offset)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    Ok(res)
}

pub(crate) async fn get_journal_detail(
    pool: &PgPool,
    session_token: &str,
    journal_doc_id: i64,
) -> Result<Value, AppError> {
    let res: Value = sqlx::query_scalar("SELECT finance.get_journal_detail($1, $2)")
        .bind(session_token)
        .bind(journal_doc_id)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    Ok(res)
}
