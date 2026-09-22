//! Financial application services: read-only journal list and detail queries.

use serde_json::Value;
use sqlx::PgPool;
use time::Date;

use crate::error::AppError;

pub(crate) struct JournalSearchFilter<'a> {
    pub date_from: Option<Date>,
    pub date_to: Option<Date>,
    pub source_type: Option<&'a str>,
    pub search: Option<&'a str>,
    pub limit: Option<i32>,
    pub offset: Option<i32>,
}

pub(crate) async fn search_journals(
    pool: &PgPool,
    session_token: &str,
    filter: JournalSearchFilter<'_>,
) -> Result<Value, AppError> {
    let res: Value =
        sqlx::query_scalar("SELECT finance.search_journals($1, $2, $3, $4, $5, $6, $7)")
            .bind(session_token)
            .bind(filter.date_from)
            .bind(filter.date_to)
            .bind(filter.source_type)
            .bind(filter.search)
            .bind(filter.limit)
            .bind(filter.offset)
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    Ok(res)
}

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
