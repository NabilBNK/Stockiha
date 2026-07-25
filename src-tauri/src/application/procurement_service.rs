use crate::application::parse_iso_date;
use crate::domain::canonical_json::payload_hash;
use crate::domain::procurement::{
    ConfirmPurchaseReceiptPayload, ConfirmPurchaseReceiptResult, CreatePurchaseOrderPayload,
    PurchaseOrderDetailDto, PurchaseOrderSummary, PurchaseReceiptSummary,
    UpdatePurchaseOrderPayload,
};
use crate::domain::supplier::{CreateSupplierPayload, Supplier, UpdateSupplierPayload};
use crate::error::AppError;
use serde_json::{json, Value as JsonValue};
use sqlx::{query_scalar, PgPool};

pub(crate) async fn create_supplier(
    pool: &PgPool,
    session_token: &str,
    payload: CreateSupplierPayload,
) -> Result<Supplier, AppError> {
    payload
        .validate()
        .map_err(|msg| AppError::ValidationError { diagnostic: msg })?;

    let res: JsonValue =
        query_scalar("SELECT procurement.create_supplier($1, $2, $3, $4, $5, $6, $7, $8)")
            .bind(session_token)
            .bind(&payload.code)
            .bind(&payload.name)
            .bind(&payload.contact_name)
            .bind(&payload.phone)
            .bind(&payload.email)
            .bind(&payload.address)
            .bind(&payload.tax_id)
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    let id = res["id"]
        .as_i64()
        .ok_or_else(|| AppError::internal("Invalid supplier ID"))?;
    let code = res["code"]
        .as_str()
        .ok_or_else(|| AppError::internal("Invalid code"))?
        .to_string();
    let name = res["name"]
        .as_str()
        .ok_or_else(|| AppError::internal("Invalid name"))?
        .to_string();
    let is_active = res["is_active"].as_bool().unwrap_or(true);

    Ok(Supplier {
        id,
        code,
        name,
        contact_name: payload.contact_name,
        phone: payload.phone,
        email: payload.email,
        address: payload.address,
        tax_id: payload.tax_id,
        is_active,
        created_at: String::new(),
    })
}

pub(crate) async fn update_supplier(
    pool: &PgPool,
    session_token: &str,
    payload: UpdateSupplierPayload,
) -> Result<Supplier, AppError> {
    let res: JsonValue =
        query_scalar("SELECT procurement.update_supplier($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)")
            .bind(session_token)
            .bind(payload.supplier_id)
            .bind(&payload.code)
            .bind(&payload.name)
            .bind(&payload.contact_name)
            .bind(&payload.phone)
            .bind(&payload.email)
            .bind(&payload.address)
            .bind(&payload.tax_id)
            .bind(payload.is_active)
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    let id = res["id"]
        .as_i64()
        .ok_or_else(|| AppError::internal("Invalid supplier ID"))?;
    let code = res["code"]
        .as_str()
        .ok_or_else(|| AppError::internal("Invalid code"))?
        .to_string();
    let name = res["name"]
        .as_str()
        .ok_or_else(|| AppError::internal("Invalid name"))?
        .to_string();
    let is_active = res["is_active"].as_bool().unwrap_or(true);

    Ok(Supplier {
        id,
        code,
        name,
        contact_name: payload.contact_name,
        phone: payload.phone,
        email: payload.email,
        address: payload.address,
        tax_id: payload.tax_id,
        is_active,
        created_at: String::new(),
    })
}

pub(crate) async fn list_suppliers(
    pool: &PgPool,
    session_token: &str,
    include_inactive: bool,
) -> Result<Vec<Supplier>, AppError> {
    let res: JsonValue = query_scalar("SELECT procurement.list_suppliers($1, $2)")
        .bind(session_token)
        .bind(include_inactive)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    let suppliers: Vec<Supplier> = serde_json::from_value(res)
        .map_err(|e| AppError::internal(format!("Failed to parse suppliers: {e}")))?;
    Ok(suppliers)
}

pub(crate) async fn create_purchase_order_draft(
    pool: &PgPool,
    session_token: &str,
    payload: CreatePurchaseOrderPayload,
) -> Result<JsonValue, AppError> {
    payload
        .validate()
        .map_err(|msg| AppError::ValidationError { diagnostic: msg })?;
    let lines_json = serde_json::to_value(&payload.lines)
        .map_err(|e| AppError::internal(format!("Invalid lines JSON: {e}")))?;

    let res: JsonValue =
        query_scalar("SELECT procurement.create_purchase_order_draft($1, $2, $3, $4, $5)")
            .bind(session_token)
            .bind(payload.supplier_id)
            .bind(payload.warehouse_id)
            .bind(&payload.note)
            .bind(&lines_json)
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    Ok(res)
}

pub(crate) async fn update_purchase_order_draft(
    pool: &PgPool,
    session_token: &str,
    payload: UpdatePurchaseOrderPayload,
) -> Result<JsonValue, AppError> {
    let lines_json = serde_json::to_value(&payload.lines)
        .map_err(|e| AppError::internal(format!("Invalid lines JSON: {e}")))?;

    let res: JsonValue =
        query_scalar("SELECT procurement.update_purchase_order_draft($1, $2, $3, $4, $5, $6)")
            .bind(session_token)
            .bind(payload.purchase_order_id)
            .bind(payload.supplier_id)
            .bind(payload.warehouse_id)
            .bind(&payload.note)
            .bind(&lines_json)
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    Ok(res)
}

pub(crate) async fn confirm_purchase_order(
    pool: &PgPool,
    session_token: &str,
    purchase_order_id: i64,
) -> Result<JsonValue, AppError> {
    let res: JsonValue = query_scalar("SELECT procurement.confirm_purchase_order($1, $2)")
        .bind(session_token)
        .bind(purchase_order_id)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    Ok(res)
}

pub(crate) async fn cancel_purchase_order(
    pool: &PgPool,
    session_token: &str,
    purchase_order_id: i64,
) -> Result<JsonValue, AppError> {
    let res: JsonValue = query_scalar("SELECT procurement.cancel_purchase_order($1, $2)")
        .bind(session_token)
        .bind(purchase_order_id)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    Ok(res)
}

pub(crate) async fn list_purchase_orders(
    pool: &PgPool,
    session_token: &str,
    supplier_id: Option<i64>,
    status: Option<String>,
) -> Result<Vec<PurchaseOrderSummary>, AppError> {
    let res: JsonValue = query_scalar("SELECT procurement.list_purchase_orders($1, $2, $3)")
        .bind(session_token)
        .bind(supplier_id)
        .bind(status)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    let orders: Vec<PurchaseOrderSummary> = serde_json::from_value(res)
        .map_err(|e| AppError::internal(format!("Failed to parse purchase orders: {e}")))?;
    Ok(orders)
}

pub(crate) async fn get_purchase_order_detail(
    pool: &PgPool,
    session_token: &str,
    purchase_order_id: i64,
) -> Result<PurchaseOrderDetailDto, AppError> {
    let res: JsonValue = query_scalar("SELECT procurement.get_purchase_order_detail($1, $2)")
        .bind(session_token)
        .bind(purchase_order_id)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    let detail: PurchaseOrderDetailDto = serde_json::from_value(res)
        .map_err(|e| AppError::internal(format!("Failed to parse purchase order detail: {e}")))?;
    Ok(detail)
}

pub(crate) async fn confirm_purchase_receipt(
    pool: &PgPool,
    session_token: &str,
    payload: ConfirmPurchaseReceiptPayload,
) -> Result<ConfirmPurchaseReceiptResult, AppError> {
    let canonical = json!({
        "purchase_order_id": payload.purchase_order_id,
        "fiscal_period_id": payload.fiscal_period_id,
        "document_date": payload.document_date,
        "lines": payload.lines
    });
    let hash = payload_hash(&canonical);

    let doc_date = parse_iso_date(&payload.document_date)?;

    let lines_json = serde_json::to_value(&payload.lines)
        .map_err(|e| AppError::internal(format!("Invalid lines JSON: {e}")))?;

    let res: JsonValue =
        query_scalar("SELECT inventory.confirm_purchase_receipt($1, $2::uuid, $3, $4, $5, $6, $7)")
            .bind(session_token)
            .bind(&payload.request_id)
            .bind(hash.as_slice())
            .bind(payload.purchase_order_id)
            .bind(payload.fiscal_period_id)
            .bind(doc_date)
            .bind(&lines_json)
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    let result: ConfirmPurchaseReceiptResult = serde_json::from_value(res)
        .map_err(|e| AppError::internal(format!("Failed to parse purchase receipt result: {e}")))?;
    Ok(result)
}

pub(crate) async fn list_purchase_receipts(
    pool: &PgPool,
    session_token: &str,
    supplier_id: Option<i64>,
    purchase_order_id: Option<i64>,
) -> Result<Vec<PurchaseReceiptSummary>, AppError> {
    let res: JsonValue = query_scalar("SELECT procurement.list_purchase_receipts($1, $2, $3)")
        .bind(session_token)
        .bind(supplier_id)
        .bind(purchase_order_id)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    let receipts: Vec<PurchaseReceiptSummary> = serde_json::from_value(res)
        .map_err(|e| AppError::internal(format!("Failed to parse purchase receipts: {e}")))?;
    Ok(receipts)
}
