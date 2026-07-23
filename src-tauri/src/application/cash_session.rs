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

/// A full cash session (open or closed) with the immutable
/// expected/counted/variance snapshot, so the UI can show the
/// backend-authoritative figures after closing. Decimal fields are exact
/// strings; the expected/counted/variance triple is present only once closed.
pub(crate) struct CashSessionDetail {
    pub id: i64,
    pub warehouse_id: i64,
    pub status: String,
    pub opening_float: String,
    pub expected_amount: Option<String>,
    pub counted_amount: Option<String>,
    pub variance_amount: Option<String>,
    pub opened_at: String,
    pub closed_at: Option<String>,
}

pub(crate) async fn get_cash_session(
    pool: &PgPool,
    session_token: &str,
    cash_session_id: i64,
) -> Result<Option<CashSessionDetail>, AppError> {
    let row = sqlx::query_as::<
        _,
        (
            i64,
            i64,
            String,
            Decimal,
            Option<Decimal>,
            Option<Decimal>,
            Option<Decimal>,
            OffsetDateTime,
            Option<OffsetDateTime>,
        ),
    >(
        "SELECT id, warehouse_id, status, opening_float, expected_amount, counted_amount, \
         variance_amount, opened_at, closed_at FROM sales.get_cash_session($1, $2)",
    )
    .bind(session_token)
    .bind(cash_session_id)
    .fetch_optional(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    let rfc3339 = |t: OffsetDateTime| {
        t.format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_default()
    };

    Ok(row.map(|r| CashSessionDetail {
        id: r.0,
        warehouse_id: r.1,
        status: r.2,
        opening_float: r.3.to_string(),
        expected_amount: r.4.map(|d| d.to_string()),
        counted_amount: r.5.map(|d| d.to_string()),
        variance_amount: r.6.map(|d| d.to_string()),
        opened_at: rfc3339(r.7),
        closed_at: r.8.map(rfc3339),
    }))
}
