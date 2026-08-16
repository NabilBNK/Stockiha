use crate::application::parse_iso_date;
use crate::domain::canonical_json::payload_hash;
use crate::domain::direct_purchase::{
    ConfirmDirectPurchasePayload, ConfirmDirectPurchaseResult,
};
use crate::error::AppError;
use serde_json::{json, Value as JsonValue};
use sqlx::{query_scalar, PgPool};

pub(crate) async fn confirm_direct_purchase(
    pool: &PgPool,
    session_token: &str,
    payload: ConfirmDirectPurchasePayload,
) -> Result<ConfirmDirectPurchaseResult, AppError> {
    payload
        .validate()
        .map_err(|diagnostic| AppError::ValidationError { diagnostic })?;

    let document_date = parse_iso_date(&payload.document_date)?;
    let canonical = json!({
        "supplier_id": payload.supplier_id,
        "warehouse_id": payload.warehouse_id,
        "fiscal_period_id": payload.fiscal_period_id,
        "document_date": &payload.document_date,
        "note": &payload.note,
        "lines": &payload.lines,
    });
    let hash = payload_hash(&canonical);
    let lines = serde_json::to_value(&payload.lines)
        .map_err(|error| AppError::internal(format!("Invalid Direct Purchase lines JSON: {error}")))?;

    let result: JsonValue = query_scalar(
        "SELECT inventory.confirm_direct_purchase_receipt($1, $2::uuid, $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(session_token)
    .bind(&payload.request_id)
    .bind(hash.as_slice())
    .bind(payload.supplier_id)
    .bind(payload.warehouse_id)
    .bind(payload.fiscal_period_id)
    .bind(document_date)
    .bind(lines)
    .bind(payload.note)
    .fetch_one(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    serde_json::from_value(result).map_err(|error| {
        AppError::internal(format!("Failed to parse Direct Purchase result: {error}"))
    })
}
