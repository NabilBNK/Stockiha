use crate::application::parse_iso_date;
use crate::domain::returns_transfers::*;
use crate::error::AppError;
use rust_decimal::Decimal;
use serde_json::Value as JsonValue;
use sqlx::PgPool;
use std::str::FromStr;

pub(crate) async fn confirm_customer_return(
    pool: &PgPool,
    session_token: &str,
    payload: ConfirmCustomerReturnPayload,
) -> Result<JsonValue, AppError> {
    let doc_date = parse_iso_date(&payload.document_date)?;

    let lines_json = serde_json::to_value(
        payload
            .lines
            .into_iter()
            .map(|l| {
                Ok(serde_json::json!({
                    "variant_id": l.variant_id,
                    "quantity": Decimal::from_str(&l.quantity).map_err(|_| AppError::ValidationError { diagnostic: "Invalid quantity".to_string() })?,
                    "unit_price": Decimal::from_str(&l.unit_price).map_err(|_| AppError::ValidationError { diagnostic: "Invalid unit price".to_string() })?,
                }))
            })
            .collect::<Result<Vec<_>, AppError>>()?,
    ).map_err(|e| AppError::internal(e.to_string()))?;

    let res: JsonValue = sqlx::query_scalar(
        "SELECT sales.confirm_customer_return($1, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10)",
    )
    .bind(session_token)
    .bind(&payload.request_id)
    .bind(payload.customer_id)
    .bind(payload.cash_session_id)
    .bind(payload.warehouse_id)
    .bind(&payload.refund_method)
    .bind(payload.fiscal_period_id)
    .bind(doc_date)
    .bind(lines_json)
    .bind(&payload.note)
    .fetch_one(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    Ok(res)
}

pub(crate) async fn confirm_warehouse_transfer(
    pool: &PgPool,
    session_token: &str,
    payload: ConfirmWarehouseTransferPayload,
) -> Result<JsonValue, AppError> {
    let doc_date = parse_iso_date(&payload.document_date)?;

    let lines_json = serde_json::to_value(
        payload
            .lines
            .into_iter()
            .map(|l| {
                Ok(serde_json::json!({
                    "variant_id": l.variant_id,
                    "quantity": Decimal::from_str(&l.quantity).map_err(|_| AppError::ValidationError { diagnostic: "Invalid quantity".to_string() })?,
                }))
            })
            .collect::<Result<Vec<_>, AppError>>()?,
    ).map_err(|e| AppError::internal(e.to_string()))?;

    let res: JsonValue = sqlx::query_scalar(
        "SELECT inventory.confirm_warehouse_transfer($1, $2::uuid, $3, $4, $5, $6, $7, $8)",
    )
    .bind(session_token)
    .bind(&payload.request_id)
    .bind(payload.from_warehouse_id)
    .bind(payload.to_warehouse_id)
    .bind(payload.fiscal_period_id)
    .bind(doc_date)
    .bind(lines_json)
    .bind(&payload.note)
    .fetch_one(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    Ok(res)
}

pub(crate) async fn confirm_stock_write_off(
    pool: &PgPool,
    session_token: &str,
    payload: ConfirmStockWriteOffPayload,
) -> Result<JsonValue, AppError> {
    let doc_date = parse_iso_date(&payload.document_date)?;

    let lines_json = serde_json::to_value(
        payload
            .lines
            .into_iter()
            .map(|l| {
                Ok(serde_json::json!({
                    "variant_id": l.variant_id,
                    "quantity": Decimal::from_str(&l.quantity).map_err(|_| AppError::ValidationError { diagnostic: "Invalid quantity".to_string() })?,
                    "unit_cost": Decimal::from_str(&l.unit_cost).map_err(|_| AppError::ValidationError { diagnostic: "Invalid unit cost".to_string() })?,
                }))
            })
            .collect::<Result<Vec<_>, AppError>>()?,
    ).map_err(|e| AppError::internal(e.to_string()))?;

    let res: JsonValue = sqlx::query_scalar(
        "SELECT inventory.confirm_stock_write_off($1, $2::uuid, $3, $4, $5, $6, $7, $8)",
    )
    .bind(session_token)
    .bind(&payload.request_id)
    .bind(payload.warehouse_id)
    .bind(&payload.reason_code)
    .bind(payload.fiscal_period_id)
    .bind(doc_date)
    .bind(lines_json)
    .bind(&payload.note)
    .fetch_one(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    Ok(res)
}

pub(crate) async fn list_customer_returns(
    pool: &PgPool,
    session_token: &str,
) -> Result<Vec<CustomerReturnDto>, AppError> {
    let res: JsonValue = sqlx::query_scalar("SELECT sales.list_customer_returns($1)")
        .bind(session_token)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    let list: Vec<CustomerReturnDto> = serde_json::from_value(res)
        .map_err(|e| AppError::internal(format!("Failed to parse customer returns: {e}")))?;
    Ok(list)
}

pub(crate) async fn list_warehouse_transfers(
    pool: &PgPool,
    session_token: &str,
) -> Result<Vec<WarehouseTransferDto>, AppError> {
    let res: JsonValue = sqlx::query_scalar("SELECT inventory.list_warehouse_transfers($1)")
        .bind(session_token)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    let list: Vec<WarehouseTransferDto> = serde_json::from_value(res)
        .map_err(|e| AppError::internal(format!("Failed to parse warehouse transfers: {e}")))?;
    Ok(list)
}

pub(crate) async fn list_stock_write_offs(
    pool: &PgPool,
    session_token: &str,
) -> Result<Vec<StockWriteOffDto>, AppError> {
    let res: JsonValue = sqlx::query_scalar("SELECT inventory.list_stock_write_offs($1)")
        .bind(session_token)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    let list: Vec<StockWriteOffDto> = serde_json::from_value(res)
        .map_err(|e| AppError::internal(format!("Failed to parse stock write offs: {e}")))?;
    Ok(list)
}
