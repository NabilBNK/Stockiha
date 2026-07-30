use crate::domain::customer::{
    CreateCustomerPayload, Customer, CustomerCapabilities, CustomerCreditSummary,
    CustomerLedgerEntry, UpdateCustomerPayload,
};
use crate::error::AppError;
use rust_decimal::Decimal;
use serde_json::Value as JsonValue;
use sqlx::{query_scalar, PgPool};

fn parse_amount(value: &str, field: &str) -> Result<Decimal, AppError> {
    value.parse::<Decimal>().map_err(|_| AppError::ValidationError {
        diagnostic: format!("{field} is not a valid decimal amount"),
    })
}

pub(crate) async fn create_customer(
    pool: &PgPool,
    session_token: &str,
    payload: CreateCustomerPayload,
) -> Result<Customer, AppError> {
    payload
        .validate()
        .map_err(|diagnostic| AppError::ValidationError { diagnostic })?;
    let credit_limit = parse_amount(&payload.credit_limit, "credit_limit")?;

    let result: JsonValue = query_scalar(
        "SELECT receivables.create_customer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
    )
    .bind(session_token)
    .bind(&payload.code)
    .bind(&payload.name)
    .bind(&payload.contact_name)
    .bind(&payload.phone)
    .bind(&payload.email)
    .bind(&payload.address)
    .bind(&payload.tax_id)
    .bind(payload.credit_enabled)
    .bind(credit_limit)
    .bind(payload.payment_terms_days)
    .bind(payload.max_overdue_days)
    .fetch_one(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    serde_json::from_value(result)
        .map_err(|error| AppError::internal(format!("Failed to parse created customer: {error}")))
}

pub(crate) async fn update_customer(
    pool: &PgPool,
    session_token: &str,
    payload: UpdateCustomerPayload,
) -> Result<Customer, AppError> {
    payload
        .validate()
        .map_err(|diagnostic| AppError::ValidationError { diagnostic })?;
    let credit_limit = parse_amount(&payload.credit_limit, "credit_limit")?;

    let result: JsonValue = query_scalar(
        "SELECT receivables.update_customer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)",
    )
    .bind(session_token)
    .bind(payload.customer_id)
    .bind(&payload.code)
    .bind(&payload.name)
    .bind(&payload.contact_name)
    .bind(&payload.phone)
    .bind(&payload.email)
    .bind(&payload.address)
    .bind(&payload.tax_id)
    .bind(payload.is_active)
    .bind(payload.credit_enabled)
    .bind(credit_limit)
    .bind(payload.payment_terms_days)
    .bind(payload.max_overdue_days)
    .fetch_one(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    serde_json::from_value(result)
        .map_err(|error| AppError::internal(format!("Failed to parse updated customer: {error}")))
}

pub(crate) async fn list_customers(
    pool: &PgPool,
    session_token: &str,
    include_inactive: bool,
) -> Result<Vec<Customer>, AppError> {
    let result: JsonValue = query_scalar("SELECT receivables.list_customers($1, $2)")
        .bind(session_token)
        .bind(include_inactive)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    serde_json::from_value(result)
        .map_err(|error| AppError::internal(format!("Failed to parse customers: {error}")))
}

pub(crate) async fn get_customer_capabilities(
    pool: &PgPool,
    session_token: &str,
) -> Result<CustomerCapabilities, AppError> {
    let result: JsonValue = query_scalar("SELECT receivables.get_customer_capabilities($1)")
        .bind(session_token)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    serde_json::from_value(result)
        .map_err(|error| AppError::internal(format!("Failed to parse customer capabilities: {error}")))
}

pub(crate) async fn get_customer_credit_summary(
    pool: &PgPool,
    session_token: &str,
    customer_id: i64,
) -> Result<CustomerCreditSummary, AppError> {
    if customer_id <= 0 {
        return Err(AppError::ValidationError {
            diagnostic: "customer_id must be positive".to_string(),
        });
    }

    let result: JsonValue =
        query_scalar("SELECT receivables.get_customer_credit_summary($1, $2)")
            .bind(session_token)
            .bind(customer_id)
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    serde_json::from_value(result).map_err(|error| {
        AppError::internal(format!("Failed to parse customer credit summary: {error}"))
    })
}

pub(crate) async fn list_customer_ledger(
    pool: &PgPool,
    session_token: &str,
    customer_id: i64,
    limit: i32,
) -> Result<Vec<CustomerLedgerEntry>, AppError> {
    if customer_id <= 0 {
        return Err(AppError::ValidationError {
            diagnostic: "customer_id must be positive".to_string(),
        });
    }
    if !(1..=500).contains(&limit) {
        return Err(AppError::ValidationError {
            diagnostic: "ledger limit must be between 1 and 500".to_string(),
        });
    }

    let result: JsonValue = query_scalar("SELECT receivables.list_customer_ledger($1, $2, $3)")
        .bind(session_token)
        .bind(customer_id)
        .bind(limit)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    serde_json::from_value(result)
        .map_err(|error| AppError::internal(format!("Failed to parse customer ledger: {error}")))
}
