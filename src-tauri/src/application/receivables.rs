use rust_decimal::Decimal;
use serde_json::Value as JsonValue;
use sqlx::{query_scalar, PgPool};

use crate::application::parse_iso_date;
use crate::domain::receivables::{
    AuthorizeCustomerRefundPayload, CustomerPaymentResult, CustomerRefundResult,
    OpenCustomerInvoice, PostCustomerPaymentPayload, PostCustomerRefundPayload,
    RefundableCustomerPayment,
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

pub(crate) async fn list_refundable_customer_payments(
    pool: &PgPool,
    session_token: &str,
    customer_id: i64,
) -> Result<Vec<RefundableCustomerPayment>, AppError> {
    if customer_id <= 0 {
        return Err(AppError::ValidationError {
            diagnostic: "customer_id must be positive".to_string(),
        });
    }

    let result: JsonValue = query_scalar(
        "SELECT receivables.list_refundable_customer_payments($1, $2)",
    )
    .bind(session_token)
    .bind(customer_id)
    .fetch_one(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    serde_json::from_value(result).map_err(|error| {
        AppError::internal(format!("Failed to parse refundable customer payments: {error}"))
    })
}

pub(crate) async fn authorize_customer_payment_refund(
    pool: &PgPool,
    session_token: &str,
    payload: AuthorizeCustomerRefundPayload,
) -> Result<String, AppError> {
    payload
        .validate()
        .map_err(|diagnostic| AppError::ValidationError { diagnostic })?;

    query_scalar::<_, String>(
        "SELECT receivables.authorize_customer_payment_refund(\
            $1, $2::uuid, $3, $4, $5, $6, $7\
         )::text",
    )
    .bind(session_token)
    .bind(&payload.authorization_id)
    .bind(payload.source_payment_document_id)
    .bind(payload.refund_method.trim().to_ascii_uppercase())
    .bind(payload.cash_session_id)
    .bind(payload.reason.trim())
    .bind(payload.ttl_minutes)
    .fetch_one(pool)
    .await
    .map_err(AppError::from_posting_error)
}

pub(crate) async fn post_customer_refund(
    pool: &PgPool,
    session_token: &str,
    payload: PostCustomerRefundPayload,
) -> Result<CustomerRefundResult, AppError> {
    payload
        .validate()
        .map_err(|diagnostic| AppError::ValidationError { diagnostic })?;

    let document_date = parse_iso_date(&payload.document_date)?;
    let posting_result: JsonValue = query_scalar(
        "SELECT receivables.post_customer_refund(\
            $1, $2::uuid, $3::uuid, $4, $5, $6\
         )",
    )
    .bind(session_token)
    .bind(&payload.request_id)
    .bind(&payload.authorization_id)
    .bind(payload.fiscal_period_id)
    .bind(document_date)
    .bind(payload.note.as_deref())
    .fetch_one(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    let document_id = posting_result
        .get("document_id")
        .and_then(JsonValue::as_i64)
        .ok_or_else(|| AppError::internal("Customer refund result omitted document_id.".to_string()))?;

    let canonical_result: JsonValue = query_scalar(
        "SELECT receivables.get_customer_refund_result($1, $2)",
    )
    .bind(session_token)
    .bind(document_id)
    .fetch_one(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    serde_json::from_value(canonical_result)
        .map_err(|error| AppError::internal(format!("Failed to parse customer refund result: {error}")))
}
