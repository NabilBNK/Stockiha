//! WS-F-006 — application service for cancelling a whole cash or credit sale.
//! PostgreSQL remains authoritative for every reversal effect (stock, the
//! mirrored journal, the drawer or the customer's debt); this module only
//! validates early, binds parameters, and parses the result.

use serde_json::Value as JsonValue;
use sqlx::{query_scalar, PgPool};

use crate::domain::sale_void::{validate_void_request, SaleVoidResult, SessionSaleDto};
use crate::error::AppError;

pub(crate) async fn void_sale(
    pool: &PgPool,
    session_token: &str,
    document_id: i64,
    reason_code: &str,
    note: Option<&str>,
) -> Result<SaleVoidResult, AppError> {
    validate_void_request(reason_code, note)
        .map_err(|err| AppError::ValidationError { diagnostic: err })?;

    let res: JsonValue = query_scalar("SELECT sales.void_sale($1, $2, $3, $4)")
        .bind(session_token)
        .bind(document_id)
        .bind(reason_code)
        .bind(note)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    serde_json::from_value(res)
        .map_err(|e| AppError::internal(format!("Failed to parse sale void result: {e}")))
}

pub(crate) async fn list_session_sales(
    pool: &PgPool,
    session_token: &str,
    cash_session_id: i64,
) -> Result<Vec<SessionSaleDto>, AppError> {
    let res: JsonValue = query_scalar("SELECT sales.list_session_sales($1, $2)")
        .bind(session_token)
        .bind(cash_session_id)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    serde_json::from_value(res)
        .map_err(|e| AppError::internal(format!("Failed to parse session sales list: {e}")))
}
