use crate::application::parse_iso_date;
use crate::domain::canonical_json::payload_hash;
use crate::domain::customer::{
    CreateCustomerPayload, Customer, CustomerLiabilityDto, CustomerPaymentDto,
    PostCustomerPaymentPayload,
};
use crate::error::AppError;
use rust_decimal::Decimal;
use serde_json::{json, Value as JsonValue};
use sqlx::{query_scalar, PgPool};

pub(crate) async fn create_customer(
    pool: &PgPool,
    session_token: &str,
    payload: CreateCustomerPayload,
) -> Result<Customer, AppError> {
    payload
        .validate()
        .map_err(|msg| AppError::ValidationError { diagnostic: msg })?;

    let credit_limit: Decimal = payload
        .credit_limit_amount
        .parse()
        .map_err(|_| AppError::ValidationError {
            diagnostic: "Invalid credit limit amount.".to_string(),
        })?;

    let res: JsonValue =
        query_scalar("SELECT sales.create_customer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)")
            .bind(session_token)
            .bind(&payload.code)
            .bind(&payload.name)
            .bind(&payload.contact_name)
            .bind(&payload.phone)
            .bind(&payload.email)
            .bind(&payload.address)
            .bind(&payload.tax_id)
            .bind(credit_limit)
            .bind(payload.max_overdue_days)
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    let id = res["id"]
        .as_i64()
        .ok_or_else(|| AppError::internal("Invalid customer ID"))?;
    let code = res["code"]
        .as_str()
        .ok_or_else(|| AppError::internal("Invalid code"))?
        .to_string();
    let name = res["name"]
        .as_str()
        .ok_or_else(|| AppError::internal("Invalid name"))?
        .to_string();
    let is_active = res["is_active"].as_bool().unwrap_or(true);

    Ok(Customer {
        id,
        code,
        name,
        contact_name: payload.contact_name,
        phone: payload.phone,
        email: payload.email,
        address: payload.address,
        tax_id: payload.tax_id,
        credit_limit_amount: payload.credit_limit_amount,
        max_overdue_days: payload.max_overdue_days,
        is_active,
        exposure_amount: "0.00".to_string(),
        created_at: String::new(),
    })
}

pub(crate) async fn list_customers(
    pool: &PgPool,
    session_token: &str,
    include_inactive: bool,
) -> Result<Vec<Customer>, AppError> {
    let res: JsonValue =
        query_scalar("SELECT sales.list_customers($1, $2)")
            .bind(session_token)
            .bind(include_inactive)
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    let arr = res.as_array().cloned().unwrap_or_default();
    let mut out = Vec::with_capacity(arr.len());
    for v in arr {
        out.push(Customer {
            id: v["id"].as_i64().unwrap_or(0),
            code: v["code"].as_str().unwrap_or("").to_string(),
            name: v["name"].as_str().unwrap_or("").to_string(),
            contact_name: v["contact_name"].as_str().map(|s| s.to_string()),
            phone: v["phone"].as_str().map(|s| s.to_string()),
            email: v["email"].as_str().map(|s| s.to_string()),
            address: v["address"].as_str().map(|s| s.to_string()),
            tax_id: v["tax_id"].as_str().map(|s| s.to_string()),
            credit_limit_amount: v["credit_limit_amount"]
                .as_str()
                .unwrap_or("0.00")
                .to_string(),
            max_overdue_days: v["max_overdue_days"].as_i64().unwrap_or(0) as i32,
            is_active: v["is_active"].as_bool().unwrap_or(true),
            exposure_amount: v["exposure_amount"].as_str().unwrap_or("0.00").to_string(),
            created_at: v["created_at"].as_str().unwrap_or("").to_string(),
        });
    }
    Ok(out)
}

pub(crate) async fn list_customer_liabilities(
    pool: &PgPool,
    session_token: &str,
    customer_id: Option<i64>,
) -> Result<Vec<CustomerLiabilityDto>, AppError> {
    let res: JsonValue =
        query_scalar("SELECT sales.list_customer_liabilities($1, $2)")
            .bind(session_token)
            .bind(customer_id)
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    let arr = res.as_array().cloned().unwrap_or_default();
    let mut out = Vec::with_capacity(arr.len());
    for v in arr {
        out.push(CustomerLiabilityDto {
            id: v["id"].as_i64().unwrap_or(0),
            customer_id: v["customer_id"].as_i64().unwrap_or(0),
            customer_name: v["customer_name"].as_str().unwrap_or("").to_string(),
            customer_code: v["customer_code"].as_str().unwrap_or("").to_string(),
            original_amount: v["original_amount"].as_str().unwrap_or("0.00").to_string(),
            remaining_amount: v["remaining_amount"].as_str().unwrap_or("0.00").to_string(),
            due_date: v["due_date"].as_str().map(|s| s.to_string()),
            status: v["status"].as_str().unwrap_or("OPEN").to_string(),
            created_at: v["created_at"].as_str().unwrap_or("").to_string(),
        });
    }
    Ok(out)
}

pub(crate) async fn list_customer_payments(
    pool: &PgPool,
    session_token: &str,
    customer_id: Option<i64>,
) -> Result<Vec<CustomerPaymentDto>, AppError> {
    let res: JsonValue =
        query_scalar("SELECT sales.list_customer_payments($1, $2)")
            .bind(session_token)
            .bind(customer_id)
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    let arr = res.as_array().cloned().unwrap_or_default();
    let mut out = Vec::with_capacity(arr.len());
    for v in arr {
        out.push(CustomerPaymentDto {
            id: v["id"].as_i64().unwrap_or(0),
            customer_id: v["customer_id"].as_i64().unwrap_or(0),
            customer_name: v["customer_name"].as_str().unwrap_or("").to_string(),
            customer_code: v["customer_code"].as_str().unwrap_or("").to_string(),
            liability_id: v["liability_id"].as_i64(),
            amount: v["amount"].as_str().unwrap_or("0.00").to_string(),
            payment_method: v["payment_method"].as_str().unwrap_or("CASH").to_string(),
            document_number: v["document_number"].as_str().map(|s| s.to_string()),
            document_date: v["document_date"].as_str().unwrap_or("").to_string(),
            note: v["note"].as_str().map(|s| s.to_string()),
            created_at: v["created_at"].as_str().unwrap_or("").to_string(),
        });
    }
    Ok(out)
}

pub(crate) async fn post_customer_payment(
    pool: &PgPool,
    session_token: &str,
    payload: PostCustomerPaymentPayload,
) -> Result<JsonValue, AppError> {
    let amount: Decimal = payload.amount.parse().map_err(|_| {
        AppError::ValidationError {
            diagnostic: "Invalid payment amount.".to_string(),
        }
    })?;

    if amount <= Decimal::ZERO {
        return Err(AppError::ValidationError {
            diagnostic: "Payment amount must be positive.".to_string(),
        });
    }

    let doc_date = parse_iso_date(&payload.document_date)?;

    let _canonical = payload_hash(&json!({
        "customer_id": payload.customer_id,
        "liability_id": payload.liability_id,
        "amount": payload.amount,
        "payment_method": payload.payment_method,
        "fiscal_period_id": payload.fiscal_period_id,
        "document_date": payload.document_date,
    }));

    let res: JsonValue =
        query_scalar("SELECT sales.post_customer_payment($1, $2::uuid, $3, $4, $5, $6, $7, $8, $9)")
            .bind(session_token)
            .bind(&payload.request_id)
            .bind(payload.customer_id)
            .bind(payload.liability_id)
            .bind(amount)
            .bind(&payload.payment_method)
            .bind(payload.fiscal_period_id)
            .bind(doc_date)
            .bind(&payload.note)
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    Ok(res)
}
