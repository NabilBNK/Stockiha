//! S4-002 — application service for the production cashier-session lifecycle.
//! PostgreSQL remains authoritative for state transitions, blind expected cash,
//! variance materiality, approval, suspension, and handover.

use rust_decimal::Decimal;
use sqlx::{PgPool, Row};
use time::OffsetDateTime;

use crate::domain::cash_session::{
    validate_denomination_counts, CashDenomination, CashSessionCloseResult, DenominationCountInput,
};
use crate::error::AppError;

pub(crate) struct ActiveCashSession {
    pub id: i64,
    pub warehouse_id: i64,
    pub opened_by_user_id: i64,
    pub opening_float: Decimal,
    pub opened_at: OffsetDateTime,
}

#[derive(Debug, Clone, serde::Serialize)]
pub(crate) struct CurrentCashSession {
    pub id: i64,
    pub warehouse_id: i64,
    pub workstation_id: String,
    pub opened_by_user_id: i64,
    pub current_cashier_user_id: i64,
    pub current_cashier_display_name: String,
    pub status: String,
    pub opening_float: String,
    pub opened_at: String,
    pub close_attempt_id: Option<i64>,
    pub expected_amount: Option<String>,
    pub counted_amount: Option<String>,
    pub variance_amount: Option<String>,
    pub requires_manager_approval: Option<bool>,
    pub suspension_reason: Option<String>,
}

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

fn rfc3339(t: OffsetDateTime) -> String {
    t.format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}

pub(crate) async fn open_cash_session(
    pool: &PgPool,
    session_token: &str,
    warehouse_id: i64,
    workstation_id: &str,
    opening_float: Decimal,
) -> Result<i64, AppError> {
    sqlx::query_scalar("SELECT sales.open_cash_session($1, $2, $3, $4)")
        .bind(session_token)
        .bind(warehouse_id)
        .bind(workstation_id)
        .bind(opening_float)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)
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

pub(crate) async fn inspect_current_cash_session(
    pool: &PgPool,
    session_token: &str,
    workstation_id: &str,
) -> Result<Option<CurrentCashSession>, AppError> {
    let row = sqlx::query(
        "SELECT id, warehouse_id, workstation_id, opened_by_user_id, current_cashier_user_id, \
                current_cashier_display_name, status, opening_float, opened_at, close_attempt_id, \
                expected_amount, counted_amount, variance_amount, requires_manager_approval, suspension_reason \
         FROM sales.inspect_current_cash_session($1, $2)",
    )
    .bind(session_token)
    .bind(workstation_id)
    .fetch_optional(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    Ok(row.map(|row| CurrentCashSession {
        id: row.get("id"),
        warehouse_id: row.get("warehouse_id"),
        workstation_id: row.get("workstation_id"),
        opened_by_user_id: row.get("opened_by_user_id"),
        current_cashier_user_id: row.get("current_cashier_user_id"),
        current_cashier_display_name: row.get("current_cashier_display_name"),
        status: row.get("status"),
        opening_float: row.get::<Decimal, _>("opening_float").to_string(),
        opened_at: rfc3339(row.get("opened_at")),
        close_attempt_id: row.get("close_attempt_id"),
        expected_amount: row
            .get::<Option<Decimal>, _>("expected_amount")
            .map(|v| v.to_string()),
        counted_amount: row
            .get::<Option<Decimal>, _>("counted_amount")
            .map(|v| v.to_string()),
        variance_amount: row
            .get::<Option<Decimal>, _>("variance_amount")
            .map(|v| v.to_string()),
        requires_manager_approval: row.get("requires_manager_approval"),
        suspension_reason: row.get("suspension_reason"),
    }))
}

pub(crate) async fn list_cash_denominations(
    pool: &PgPool,
    session_token: &str,
) -> Result<Vec<CashDenomination>, AppError> {
    let rows = sqlx::query_as::<_, (i64, String, Decimal, i32)>(
        "SELECT id, code, value, display_order FROM sales.list_cash_denominations($1)",
    )
    .bind(session_token)
    .fetch_all(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    Ok(rows
        .into_iter()
        .map(|(id, code, value, display_order)| CashDenomination {
            id,
            code,
            value: value.to_string(),
            display_order,
        })
        .collect())
}

pub(crate) async fn begin_cash_session_close(
    pool: &PgPool,
    session_token: &str,
    cash_session_id: i64,
) -> Result<i64, AppError> {
    sqlx::query_scalar("SELECT sales.begin_cash_session_close($1, $2)")
        .bind(session_token)
        .bind(cash_session_id)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)
}

pub(crate) async fn cancel_cash_session_close(
    pool: &PgPool,
    session_token: &str,
    cash_session_id: i64,
) -> Result<i64, AppError> {
    sqlx::query_scalar("SELECT sales.cancel_cash_session_close($1, $2)")
        .bind(session_token)
        .bind(cash_session_id)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)
}

pub(crate) async fn submit_cash_session_count(
    pool: &PgPool,
    session_token: &str,
    cash_session_id: i64,
    counts: &[DenominationCountInput],
) -> Result<CashSessionCloseResult, AppError> {
    validate_denomination_counts(counts).map_err(|err| AppError::ValidationError {
        diagnostic: err.to_string(),
    })?;

    let counts_json =
        serde_json::to_value(counts).map_err(|err| AppError::Internal(err.to_string()))?;
    let result: serde_json::Value =
        sqlx::query_scalar("SELECT sales.submit_cash_session_count($1, $2, $3)")
            .bind(session_token)
            .bind(cash_session_id)
            .bind(counts_json)
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    serde_json::from_value(result).map_err(|err| AppError::Internal(err.to_string()))
}

pub(crate) async fn approve_cash_session_variance(
    pool: &PgPool,
    session_token: &str,
    cash_session_id: i64,
    close_attempt_id: i64,
    reason: &str,
) -> Result<CashSessionCloseResult, AppError> {
    if cash_session_id <= 0 || close_attempt_id <= 0 || reason.trim().is_empty() {
        return Err(AppError::ValidationError {
            diagnostic: "cash session, close attempt, and reason are required".to_string(),
        });
    }

    let result: serde_json::Value =
        sqlx::query_scalar("SELECT sales.approve_cash_session_variance($1, $2, $3, $4)")
            .bind(session_token)
            .bind(cash_session_id)
            .bind(close_attempt_id)
            .bind(reason.trim())
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    serde_json::from_value(result).map_err(|err| AppError::Internal(err.to_string()))
}

pub(crate) async fn suspend_cash_session(
    pool: &PgPool,
    session_token: &str,
    cash_session_id: i64,
    reason: &str,
) -> Result<i64, AppError> {
    if cash_session_id <= 0 || reason.trim().is_empty() {
        return Err(AppError::ValidationError {
            diagnostic: "cash session and suspension reason are required".to_string(),
        });
    }

    sqlx::query_scalar("SELECT sales.suspend_cash_session($1, $2, $3)")
        .bind(session_token)
        .bind(cash_session_id)
        .bind(reason.trim())
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)
}

pub(crate) async fn resume_cash_session(
    pool: &PgPool,
    session_token: &str,
    cash_session_id: i64,
) -> Result<i64, AppError> {
    sqlx::query_scalar("SELECT sales.resume_cash_session($1, $2)")
        .bind(session_token)
        .bind(cash_session_id)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)
}

pub(crate) async fn handover_cash_session(
    pool: &PgPool,
    session_token: &str,
    cash_session_id: i64,
    target_username: &str,
    reason: &str,
) -> Result<i64, AppError> {
    if cash_session_id <= 0 || target_username.trim().is_empty() || reason.trim().is_empty() {
        return Err(AppError::ValidationError {
            diagnostic: "cash session, target cashier, and handover reason are required"
                .to_string(),
        });
    }

    sqlx::query_scalar("SELECT sales.handover_cash_session($1, $2, $3, $4)")
        .bind(session_token)
        .bind(cash_session_id)
        .bind(target_username.trim())
        .bind(reason.trim())
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)
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
