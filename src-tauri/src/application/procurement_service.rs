use crate::application::parse_iso_date;
use crate::domain::canonical_json::payload_hash;
use crate::domain::procurement::{
    AllocateLandedCostResult, ConfirmPurchaseReceiptPayload, ConfirmPurchaseReceiptResult,
    ConfirmSupplierInvoiceResult, ConfirmSupplierReturnResult, CreatePurchaseOrderPayload,
    CreateSupplierInvoiceResult, CreateSupplierReturnResult, PostSupplierPaymentResult,
    ProcurementCapabilities, PurchaseOrderDetailDto, PurchaseOrderSummary, PurchaseReceiptLineDto,
    PurchaseReceiptSummary, UpdatePurchaseOrderPayload,
};
use crate::domain::supplier::{CreateSupplierPayload, Supplier, UpdateSupplierPayload};
use crate::error::AppError;
use rust_decimal::Decimal;
use serde_json::{json, Value as JsonValue};
use sqlx::{query_scalar, PgPool};

fn stringify_json_numbers(value: &mut JsonValue, keys: &[&str]) {
    let Some(object) = value.as_object_mut() else {
        return;
    };
    for key in keys {
        let number = object.get(*key).and_then(|item| match item {
            JsonValue::Number(number) => Some(number.to_string()),
            _ => None,
        });
        if let Some(number) = number {
            object.insert((*key).to_string(), JsonValue::String(number));
        }
    }
}

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

pub(crate) async fn get_procurement_capabilities(
    pool: &PgPool,
    session_token: &str,
) -> Result<ProcurementCapabilities, AppError> {
    let result: JsonValue = query_scalar("SELECT procurement.get_capabilities($1)")
        .bind(session_token)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    serde_json::from_value(result).map_err(|error| {
        AppError::internal(format!("Failed to parse procurement capabilities: {error}"))
    })
}

pub(crate) async fn list_purchase_receipt_lines(
    pool: &PgPool,
    session_token: &str,
    purchase_order_id: Option<i64>,
) -> Result<Vec<PurchaseReceiptLineDto>, AppError> {
    let result: JsonValue = query_scalar("SELECT procurement.list_purchase_receipt_lines($1, $2)")
        .bind(session_token)
        .bind(purchase_order_id)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    serde_json::from_value(result).map_err(|error| {
        AppError::internal(format!("Failed to parse purchase receipt lines: {error}"))
    })
}

pub(crate) async fn allocate_landed_cost(
    pool: &PgPool,
    session_token: &str,
    payload: crate::domain::procurement::AllocateLandedCostPayload,
) -> Result<AllocateLandedCostResult, AppError> {
    payload
        .validate()
        .map_err(|diagnostic| AppError::ValidationError { diagnostic })?;
    let canonical = json!({
        "receipt_id": payload.receipt_id,
        "landed_cost_amount": payload.landed_cost_amount,
        "allocation_method": payload.allocation_method,
        "fiscal_period_id": payload.fiscal_period_id,
        "document_date": payload.document_date
    });
    let hash = payload_hash(&canonical);
    let doc_date = parse_iso_date(&payload.document_date)?;
    let landed_cost: rust_decimal::Decimal =
        payload
            .landed_cost_amount
            .parse()
            .map_err(|_| AppError::ValidationError {
                diagnostic: "Invalid landed cost amount".to_string(),
            })?;

    let mut res: JsonValue = query_scalar(
        "SELECT inventory.allocate_landed_cost($1, $2::uuid, $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(session_token)
    .bind(&payload.request_id)
    .bind(hash.as_slice())
    .bind(payload.receipt_id)
    .bind(landed_cost)
    .bind(&payload.allocation_method)
    .bind(payload.fiscal_period_id)
    .bind(doc_date)
    .bind(&payload.note)
    .fetch_one(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    stringify_json_numbers(
        &mut res,
        &["landed_cost_amount", "inventory_debit", "variance_debit"],
    );

    serde_json::from_value(res)
        .map_err(|error| AppError::internal(format!("Failed to parse landed cost result: {error}")))
}

pub(crate) async fn create_supplier_invoice_draft(
    pool: &PgPool,
    session_token: &str,
    payload: crate::domain::procurement::CreateSupplierInvoicePayload,
) -> Result<CreateSupplierInvoiceResult, AppError> {
    payload
        .validate()
        .map_err(|diagnostic| AppError::ValidationError { diagnostic })?;
    let lines_json = serde_json::to_value(&payload.lines)
        .map_err(|e| AppError::internal(format!("Invalid lines JSON: {e}")))?;

    let rate: Option<rust_decimal::Decimal> = match payload.exchange_rate_to_dzd {
        Some(r) => Some(r.parse().map_err(|_| AppError::ValidationError {
            diagnostic: "Invalid exchange rate".to_string(),
        })?),
        None => None,
    };

    let mut res: JsonValue = query_scalar(
        "SELECT procurement.create_supplier_invoice_draft($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(session_token)
    .bind(payload.supplier_id)
    .bind(payload.purchase_order_id)
    .bind(&payload.currency_code)
    .bind(rate)
    .bind(&payload.note)
    .bind(&lines_json)
    .fetch_one(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    stringify_json_numbers(&mut res, &["subtotal", "total_amount"]);

    serde_json::from_value(res).map_err(|error| {
        AppError::internal(format!(
            "Failed to parse supplier invoice draft result: {error}"
        ))
    })
}

pub(crate) async fn confirm_supplier_invoice(
    pool: &PgPool,
    session_token: &str,
    payload: crate::domain::procurement::ConfirmSupplierInvoicePayload,
) -> Result<ConfirmSupplierInvoiceResult, AppError> {
    payload
        .validate()
        .map_err(|diagnostic| AppError::ValidationError { diagnostic })?;
    let canonical = json!({
        "invoice_doc_id": payload.invoice_doc_id,
        "fiscal_period_id": payload.fiscal_period_id,
        "document_date": payload.document_date
    });
    let hash = payload_hash(&canonical);
    let doc_date = parse_iso_date(&payload.document_date)?;

    let mut res: JsonValue =
        query_scalar("SELECT procurement.confirm_supplier_invoice($1, $2::uuid, $3, $4, $5, $6)")
            .bind(session_token)
            .bind(&payload.request_id)
            .bind(hash.as_slice())
            .bind(payload.invoice_doc_id)
            .bind(payload.fiscal_period_id)
            .bind(doc_date)
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    stringify_json_numbers(
        &mut res,
        &["total_amount", "grni_amount", "variance_amount"],
    );

    serde_json::from_value(res).map_err(|error| {
        AppError::internal(format!("Failed to parse supplier invoice result: {error}"))
    })
}

pub(crate) async fn list_supplier_invoices(
    pool: &PgPool,
    session_token: &str,
    supplier_id: Option<i64>,
) -> Result<Vec<crate::domain::procurement::SupplierInvoiceSummary>, AppError> {
    let res: JsonValue = query_scalar("SELECT procurement.list_supplier_invoices($1, $2)")
        .bind(session_token)
        .bind(supplier_id)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    let invoices: Vec<crate::domain::procurement::SupplierInvoiceSummary> =
        serde_json::from_value(res)
            .map_err(|e| AppError::internal(format!("Failed to parse supplier invoices: {e}")))?;
    Ok(invoices)
}

pub(crate) async fn list_supplier_liabilities(
    pool: &PgPool,
    session_token: &str,
    supplier_id: Option<i64>,
) -> Result<Vec<crate::domain::procurement::SupplierLiabilityDto>, AppError> {
    let res: JsonValue = query_scalar("SELECT procurement.list_supplier_liabilities($1, $2)")
        .bind(session_token)
        .bind(supplier_id)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    let liabilities: Vec<crate::domain::procurement::SupplierLiabilityDto> =
        serde_json::from_value(res).map_err(|e| {
            AppError::internal(format!("Failed to parse supplier liabilities: {e}"))
        })?;
    Ok(liabilities)
}

pub(crate) async fn create_supplier_return_draft(
    pool: &PgPool,
    session_token: &str,
    payload: crate::domain::procurement::CreateSupplierReturnPayload,
) -> Result<CreateSupplierReturnResult, AppError> {
    payload
        .validate()
        .map_err(|diagnostic| AppError::ValidationError { diagnostic })?;
    let lines_json = serde_json::to_value(&payload.lines)
        .map_err(|e| AppError::internal(format!("Invalid lines JSON: {e}")))?;

    let res: JsonValue =
        query_scalar("SELECT procurement.create_supplier_return_draft($1, $2, $3, $4, $5, $6, $7)")
            .bind(session_token)
            .bind(payload.supplier_id)
            .bind(payload.warehouse_id)
            .bind(payload.purchase_order_id)
            .bind(payload.reason_code)
            .bind(payload.note)
            .bind(lines_json)
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    serde_json::from_value(res).map_err(|error| {
        AppError::internal(format!(
            "Failed to parse supplier return draft result: {error}"
        ))
    })
}

pub(crate) async fn confirm_supplier_return(
    pool: &PgPool,
    session_token: &str,
    payload: crate::domain::procurement::ConfirmSupplierReturnPayload,
) -> Result<ConfirmSupplierReturnResult, AppError> {
    payload
        .validate()
        .map_err(|diagnostic| AppError::ValidationError { diagnostic })?;
    let canonical = json!({
        "return_document_id": payload.return_document_id,
        "fiscal_period_id": payload.fiscal_period_id,
        "document_date": payload.document_date,
    });
    let hash = payload_hash(&canonical);
    let doc_date = parse_iso_date(&payload.document_date)?;

    let mut res: JsonValue =
        query_scalar("SELECT inventory.confirm_supplier_return($1, $2::uuid, $3, $4, $5, $6)")
            .bind(session_token)
            .bind(&payload.request_id)
            .bind(hash.as_slice())
            .bind(payload.return_document_id)
            .bind(payload.fiscal_period_id)
            .bind(doc_date)
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    stringify_json_numbers(
        &mut res,
        &["clearing_amount", "inventory_value", "variance_amount"],
    );

    serde_json::from_value(res).map_err(|error| {
        AppError::internal(format!("Failed to parse supplier return result: {error}"))
    })
}

pub(crate) async fn post_supplier_payment(
    pool: &PgPool,
    session_token: &str,
    payload: crate::domain::procurement::PostSupplierPaymentPayload,
) -> Result<PostSupplierPaymentResult, AppError> {
    payload
        .validate()
        .map_err(|diagnostic| AppError::ValidationError { diagnostic })?;
    let amount: Decimal = payload
        .amount
        .parse()
        .map_err(|_| AppError::ValidationError {
            diagnostic: "Invalid payment amount".to_string(),
        })?;

    let canonical = json!({
        "supplier_id": payload.supplier_id,
        "liability_id": payload.liability_id,
        "amount": payload.amount,
        "payment_method": payload.payment_method,
        "fiscal_period_id": payload.fiscal_period_id,
        "document_date": payload.document_date,
    });
    let hash = payload_hash(&canonical);
    let doc_date = parse_iso_date(&payload.document_date)?;

    let mut res: JsonValue = query_scalar(
        "SELECT procurement.post_supplier_payment($1, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10)",
    )
    .bind(session_token)
    .bind(&payload.request_id)
    .bind(hash.as_slice())
    .bind(payload.supplier_id)
    .bind(payload.liability_id)
    .bind(amount)
    .bind(payload.payment_method)
    .bind(payload.fiscal_period_id)
    .bind(doc_date)
    .bind(payload.note)
    .fetch_one(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    stringify_json_numbers(&mut res, &["amount"]);

    serde_json::from_value(res).map_err(|error| {
        AppError::internal(format!("Failed to parse supplier payment result: {error}"))
    })
}

pub(crate) async fn list_supplier_returns(
    pool: &PgPool,
    session_token: &str,
    supplier_id: Option<i64>,
) -> Result<Vec<crate::domain::procurement::SupplierReturnSummary>, AppError> {
    let res: JsonValue = query_scalar("SELECT procurement.list_supplier_returns($1, $2)")
        .bind(session_token)
        .bind(supplier_id)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    let returns: Vec<crate::domain::procurement::SupplierReturnSummary> =
        serde_json::from_value(res)
            .map_err(|e| AppError::internal(format!("Failed to parse supplier returns: {e}")))?;
    Ok(returns)
}

pub(crate) async fn list_supplier_payments(
    pool: &PgPool,
    session_token: &str,
    supplier_id: Option<i64>,
) -> Result<Vec<crate::domain::procurement::SupplierPaymentDto>, AppError> {
    let res: JsonValue = query_scalar("SELECT procurement.list_supplier_payments($1, $2)")
        .bind(session_token)
        .bind(supplier_id)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    let payments: Vec<crate::domain::procurement::SupplierPaymentDto> = serde_json::from_value(res)
        .map_err(|e| AppError::internal(format!("Failed to parse supplier payments: {e}")))?;
    Ok(payments)
}
