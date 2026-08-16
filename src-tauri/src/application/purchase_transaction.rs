use crate::domain::canonical_json::payload_hash;
use crate::domain::procurement::{PostPurchaseTransactionPayload, PurchaseProductOption};
use crate::error::AppError;
use serde_json::{json, Value as JsonValue};
use sqlx::{query_scalar, PgPool};

/// Read the product/variant projection used by the single-operation purchase UI.
pub(crate) async fn list_purchase_product_options(
    pool: &PgPool,
    session_token: &str,
) -> Result<Vec<PurchaseProductOption>, AppError> {
    let value: JsonValue = query_scalar("SELECT procurement.list_purchase_product_options($1)")
        .bind(session_token)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    serde_json::from_value(value).map_err(|error| {
        AppError::internal(format!(
            "Failed to parse direct-purchase product options: {error}"
        ))
    })
}

pub(crate) async fn get_purchase_workflow_policy(
    pool: &PgPool,
    session_token: &str,
) -> Result<JsonValue, AppError> {
    query_scalar("SELECT procurement.get_purchase_workflow_policy($1)")
        .bind(session_token)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)
}

pub(crate) async fn update_purchase_workflow_policy(
    pool: &PgPool,
    session_token: &str,
    mode: &str,
) -> Result<JsonValue, AppError> {
    query_scalar("SELECT procurement.update_purchase_workflow_policy($1, $2)")
        .bind(session_token)
        .bind(mode)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)
}

/// Post one operator-level purchase transaction.
///
/// PostgreSQL owns the authoritative inventory/accounting orchestration. Rust
/// validates the IPC DTO and binds a canonical idempotency hash; it does not
/// duplicate posting rules.
pub(crate) async fn post_purchase_transaction(
    pool: &PgPool,
    session_token: &str,
    payload: PostPurchaseTransactionPayload,
) -> Result<JsonValue, AppError> {
    payload
        .validate()
        .map_err(|diagnostic| AppError::ValidationError { diagnostic })?;

    // The request UUID identifies the retry. It is intentionally excluded from
    // the canonical business payload hash so only business-content changes
    // trigger an idempotency conflict. Borrow the owned fields here so the
    // payload remains available for serialization and SQL binding below.
    let canonical = json!({
        "supplier_id": payload.supplier_id,
        "document_date": &payload.document_date,
        "external_supplier_document_number": &payload.external_supplier_document_number,
        "payment_status": &payload.payment_status,
        "payment_method": &payload.payment_method,
        "paid_amount": &payload.paid_amount,
        "print_after_confirmation": payload.print_after_confirmation,
        "note": &payload.note,
        "lines": &payload.lines,
        "additional_costs": &payload.additional_costs,
    });
    let hash = payload_hash(&canonical);
    let payload_json = serde_json::to_value(&payload)
        .map_err(|error| AppError::internal(format!("Invalid purchase payload JSON: {error}")))?;

    query_scalar(
        "SELECT procurement.post_purchase_transaction($1, $2::uuid, $3, $4)",
    )
    .bind(session_token)
    .bind(&payload.request_id)
    .bind(hash.as_slice())
    .bind(payload_json)
    .fetch_one(pool)
    .await
    .map_err(AppError::from_posting_error)
}
