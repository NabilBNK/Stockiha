//! WS-I-1 — the reporting foundation: a single generic caller for the
//! read-only, `SECURITY DEFINER` `reports.*` SQL functions (plan §4.2).
//!
//! All report logic lives in SQL (plan A1) so the same numbers reach the
//! screen, print, PDF and CSV. This module owns no business logic — it binds
//! typed parameters in order and maps the SQL result straight through.

use rust_decimal::Decimal;
use serde_json::Value;
use sqlx::PgPool;
use time::Date;

use crate::error::AppError;

/// One positional bind for a `reports.*` call, in the SQL function's
/// argument order.
pub(crate) enum ReportBind {
    Text(Option<String>),
    Date(Option<Date>),
    Int(Option<i32>),
    BigInt(Option<i64>),
    Num(Option<Decimal>),
}

/// Runs one `reports.*` function and returns its single `jsonb` column
/// as-is. `sql` is a full `SELECT reports.<name>($1, $2, ...)` statement;
/// `binds` are applied in order.
pub(crate) async fn call_report(
    pool: &PgPool,
    sql: &str,
    binds: Vec<ReportBind>,
) -> Result<Value, AppError> {
    let mut query = sqlx::query_scalar::<_, Value>(sql);
    for bind in binds {
        query = match bind {
            ReportBind::Text(v) => query.bind(v),
            ReportBind::Date(v) => query.bind(v),
            ReportBind::Int(v) => query.bind(v),
            ReportBind::BigInt(v) => query.bind(v),
            ReportBind::Num(v) => query.bind(v),
        };
    }
    query
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)
}
