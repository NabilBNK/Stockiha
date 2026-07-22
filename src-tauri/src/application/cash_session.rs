//! Slice 1 MVP batch — application service wrapping the cash-session
//! open/inspect/close SQL functions. No idempotency wrapping here: opening
//! and closing a session are not the "financial or ledger command"
//! category final-architecture.md section 2.4 requires a request id for —
//! the partial-unique-index-backed "one open session per workstation" rule
//! is itself what prevents an accidental double-open from having any
//! effect beyond a clean rejection.

use rust_decimal::Decimal;
use sqlx::PgPool;
use time::OffsetDateTime;

use crate::error::AppError;

pub(crate) struct ActiveCashSession {
    pub id: i64,
    pub warehouse_id: i64,
    pub opened_by_user_id: i64,
    pub opening_float: Decimal,
    pub opened_at: OffsetDateTime,
}

pub(crate) async fn open_cash_session(
    pool: &PgPool,
    session_token: &str,
    warehouse_id: i64,
    workstation_id: &str,
    opening_float: Decimal,
) -> Result<i64, AppError> {
    let cash_session_id: i64 = sqlx::query_scalar("SELECT sales.open_cash_session($1, $2, $3, $4)")
        .bind(session_token)
        .bind(warehouse_id)
        .bind(workstation_id)
        .bind(opening_float)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;
    Ok(cash_session_id)
}

pub(crate) async fn inspect_active_cash_session(
    pool: &PgPool,
    session_token: &str,
    workstation_id: &str,
) -> Result<Option<ActiveCashSession>, AppError> {
    let row = sqlx::query_as::<_, (i64, i64, i64, Decimal, OffsetDateTime)>(
        "SELECT id, warehouse_id, opened_by_user_id, opening_float, opened_at \
         FROM sales.inspect_active_cash_session($1, $2)",
    )
    .bind(session_token)
    .bind(workstation_id)
    .fetch_optional(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    Ok(row.map(
        |(id, warehouse_id, opened_by_user_id, opening_float, opened_at)| ActiveCashSession {
            id,
            warehouse_id,
            opened_by_user_id,
            opening_float,
            opened_at,
        },
    ))
}

pub(crate) async fn close_cash_session(
    pool: &PgPool,
    session_token: &str,
    cash_session_id: i64,
    counted_amount: Decimal,
) -> Result<i64, AppError> {
    let closed_id: i64 = sqlx::query_scalar("SELECT sales.close_cash_session($1, $2, $3)")
        .bind(session_token)
        .bind(cash_session_id)
        .bind(counted_amount)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;
    Ok(closed_id)
}
