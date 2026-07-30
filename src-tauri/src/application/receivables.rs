use rust_decimal::Decimal;
use serde_json::Value as JsonValue;
use sqlx::{query_scalar, PgPool};

use crate::application::parse_iso_date;
use crate::domain::receivables::{
    CustomerPaymentResult, OpenCustomerInvoice, PostCustomerPaymentPayload,
};
use crate::error::AppError;

pub(crate) async fn list_open_customer_invoices(
    pool: &PgPool,
    session_token: &str,
    customer_id: i64,
) -> Result<Vec<OpenCustomerInvoice>, AppError> {
    if customer_id <= 0 {
        return Err(AppError::ValidationError {
            diagnostic: "customer_id must be positive".to_string(),
        });
    }

    let result: JsonValue = query_scalar("SELECT receivables.list_open_customer_invoices($1, $2)")
        .bind(session_token)
        .bind(customer_id)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    serde_json::from_value(result)
        .map_err(|error| AppError::internal(format!("Failed to parse open customer invoices: {error}")))
}

pub(crate) async fn post_customer_payment(
    pool: &PgPool,
    session_token: &str,
    payload: PostCustomerPaymentPayload,
) -> Result<CustomerPaymentResult, AppError> {
    payload
        .validate()
        .map_err(|diagnostic| AppError::ValidationError { diagnostic })?;

    let amount: Decimal = payload.amount.parse().map_err(|_| AppError::ValidationError {
        diagnostic: "payment amount is not a valid decimal".to_string(),
    })?;
    let document_date = parse_iso_date(&payload.document_date)?;
    let allocations = serde_json::to_value(&payload.allocations)
        .map_err(|error| AppError::internal(format!("Failed to serialize payment allocations: {error}")))?;

    let result: JsonValue = query_scalar(
        "SELECT receivables.post_customer_payment(\
            $1, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10\
         )",
    )
    .bind(session_token)
    .bind(&payload.request_id)
    .bind(payload.customer_id)
    .bind(amount)
    .bind(payload.payment_method.trim().to_ascii_uppercase())
    .bind(payload.cash_session_id)
    .bind(payload.fiscal_period_id)
    .bind(document_date)
    .bind(allocations)
    .bind(payload.note.as_deref())
    .fetch_one(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    serde_json::from_value(result)
        .map_err(|error| AppError::internal(format!("Failed to parse customer payment result: {error}")))
}
