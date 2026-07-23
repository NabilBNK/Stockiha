//! Slice 1 Frontend MVP batch — application service for fiscal-period reads.
//! The period-closing workflow stays out of scope (Slice-later); these are
//! read-only, session-validated queries used to supply `fiscal_period_id`
//! to the posting flows and to display period status.

use sqlx::PgPool;
use time::Date;

use crate::error::AppError;

pub(crate) struct FiscalPeriodItem {
    pub id: i64,
    pub period_code: String,
    pub starts_on: String,
    pub ends_on: String,
    pub status: String,
}

pub(crate) struct OpenFiscalPeriod {
    pub id: i64,
    pub period_code: String,
    pub starts_on: String,
    pub ends_on: String,
}

pub(crate) async fn list_fiscal_periods(
    pool: &PgPool,
    session_token: &str,
) -> Result<Vec<FiscalPeriodItem>, AppError> {
    let rows = sqlx::query_as::<_, (i64, String, Date, Date, String)>(
        "SELECT id, period_code, starts_on, ends_on, status \
         FROM finance.list_fiscal_periods($1)",
    )
    .bind(session_token)
    .fetch_all(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    Ok(rows
        .into_iter()
        .map(
            |(id, period_code, starts_on, ends_on, status)| FiscalPeriodItem {
                id,
                period_code,
                starts_on: starts_on.to_string(),
                ends_on: ends_on.to_string(),
                status,
            },
        )
        .collect())
}

/// The current open period, if any (at most one).
pub(crate) async fn get_open_fiscal_period(
    pool: &PgPool,
    session_token: &str,
) -> Result<Option<OpenFiscalPeriod>, AppError> {
    let row = sqlx::query_as::<_, (i64, String, Date, Date)>(
        "SELECT id, period_code, starts_on, ends_on \
         FROM finance.get_open_fiscal_period($1)",
    )
    .bind(session_token)
    .fetch_optional(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    Ok(
        row.map(|(id, period_code, starts_on, ends_on)| OpenFiscalPeriod {
            id,
            period_code,
            starts_on: starts_on.to_string(),
            ends_on: ends_on.to_string(),
        }),
    )
}
