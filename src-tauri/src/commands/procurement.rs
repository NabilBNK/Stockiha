use crate::application::procurement_service;
use crate::domain::procurement::{
    AllocateLandedCostResult, ConfirmPurchaseReceiptPayload, ConfirmPurchaseReceiptResult,
    ConfirmSupplierInvoiceResult, ConfirmSupplierReturnResult, CreatePurchaseOrderPayload,
    CreateSupplierInvoiceResult, CreateSupplierReturnResult, PostSupplierPaymentResult,
    ProcurementCapabilities, PurchaseOrderDetailDto, PurchaseOrderSummary, PurchaseReceiptLineDto,
    PurchaseReceiptSummary, UpdatePurchaseOrderPayload,
};
use crate::domain::supplier::{CreateSupplierPayload, Supplier, UpdateSupplierPayload};
use crate::error::IpcError;
use crate::infrastructure::db::{self, DatabaseState};
use serde_json::Value as JsonValue;
use tauri::State;

#[tauri::command]
pub(crate) async fn create_supplier(
    state: State<'_, DatabaseState>,
    session_token: String,
    payload: CreateSupplierPayload,
) -> Result<Supplier, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    procurement_service::create_supplier(pool, &session_token, payload)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn update_supplier(
    state: State<'_, DatabaseState>,
    session_token: String,
    payload: UpdateSupplierPayload,
) -> Result<Supplier, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    procurement_service::update_supplier(pool, &session_token, payload)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn list_suppliers(
    state: State<'_, DatabaseState>,
    session_token: String,
    include_inactive: Option<bool>,
) -> Result<Vec<Supplier>, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    procurement_service::list_suppliers(pool, &session_token, include_inactive.unwrap_or(false))
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn create_purchase_order_draft(
    state: State<'_, DatabaseState>,
    session_token: String,
    payload: CreatePurchaseOrderPayload,
) -> Result<JsonValue, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    procurement_service::create_purchase_order_draft(pool, &session_token, payload)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn update_purchase_order_draft(
    state: State<'_, DatabaseState>,
    session_token: String,
    payload: UpdatePurchaseOrderPayload,
) -> Result<JsonValue, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    procurement_service::update_purchase_order_draft(pool, &session_token, payload)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn confirm_purchase_order(
    state: State<'_, DatabaseState>,
    session_token: String,
    purchase_order_id: i64,
) -> Result<JsonValue, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    procurement_service::confirm_purchase_order(pool, &session_token, purchase_order_id)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn cancel_purchase_order(
    state: State<'_, DatabaseState>,
    session_token: String,
    purchase_order_id: i64,
) -> Result<JsonValue, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    procurement_service::cancel_purchase_order(pool, &session_token, purchase_order_id)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn list_purchase_orders(
    state: State<'_, DatabaseState>,
    session_token: String,
    supplier_id: Option<i64>,
    status: Option<String>,
) -> Result<Vec<PurchaseOrderSummary>, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    procurement_service::list_purchase_orders(pool, &session_token, supplier_id, status)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn get_purchase_order_detail(
    state: State<'_, DatabaseState>,
    session_token: String,
    purchase_order_id: i64,
) -> Result<PurchaseOrderDetailDto, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    procurement_service::get_purchase_order_detail(pool, &session_token, purchase_order_id)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn confirm_purchase_receipt(
    state: State<'_, DatabaseState>,
    session_token: String,
    payload: ConfirmPurchaseReceiptPayload,
) -> Result<ConfirmPurchaseReceiptResult, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    procurement_service::confirm_purchase_receipt(pool, &session_token, payload)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn list_purchase_receipts(
    state: State<'_, DatabaseState>,
    session_token: String,
    supplier_id: Option<i64>,
    purchase_order_id: Option<i64>,
) -> Result<Vec<PurchaseReceiptSummary>, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    procurement_service::list_purchase_receipts(
        pool,
        &session_token,
        supplier_id,
        purchase_order_id,
    )
    .await
    .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn get_procurement_capabilities(
    state: State<'_, DatabaseState>,
    session_token: String,
) -> Result<ProcurementCapabilities, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    procurement_service::get_procurement_capabilities(pool, &session_token)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn list_purchase_receipt_lines(
    state: State<'_, DatabaseState>,
    session_token: String,
    purchase_order_id: Option<i64>,
) -> Result<Vec<PurchaseReceiptLineDto>, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    procurement_service::list_purchase_receipt_lines(pool, &session_token, purchase_order_id)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn allocate_landed_cost(
    state: State<'_, DatabaseState>,
    session_token: String,
    payload: crate::domain::procurement::AllocateLandedCostPayload,
) -> Result<AllocateLandedCostResult, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    procurement_service::allocate_landed_cost(pool, &session_token, payload)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn create_supplier_invoice_draft(
    state: State<'_, DatabaseState>,
    session_token: String,
    payload: crate::domain::procurement::CreateSupplierInvoicePayload,
) -> Result<CreateSupplierInvoiceResult, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    procurement_service::create_supplier_invoice_draft(pool, &session_token, payload)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn confirm_supplier_invoice(
    state: State<'_, DatabaseState>,
    session_token: String,
    payload: crate::domain::procurement::ConfirmSupplierInvoicePayload,
) -> Result<ConfirmSupplierInvoiceResult, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    procurement_service::confirm_supplier_invoice(pool, &session_token, payload)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn list_supplier_invoices(
    state: State<'_, DatabaseState>,
    session_token: String,
    supplier_id: Option<i64>,
) -> Result<Vec<crate::domain::procurement::SupplierInvoiceSummary>, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    procurement_service::list_supplier_invoices(pool, &session_token, supplier_id)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn list_supplier_liabilities(
    state: State<'_, DatabaseState>,
    session_token: String,
    supplier_id: Option<i64>,
) -> Result<Vec<crate::domain::procurement::SupplierLiabilityDto>, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    procurement_service::list_supplier_liabilities(pool, &session_token, supplier_id)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn create_supplier_return_draft(
    state: State<'_, DatabaseState>,
    session_token: String,
    payload: crate::domain::procurement::CreateSupplierReturnPayload,
) -> Result<CreateSupplierReturnResult, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    procurement_service::create_supplier_return_draft(pool, &session_token, payload)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn confirm_supplier_return(
    state: State<'_, DatabaseState>,
    session_token: String,
    payload: crate::domain::procurement::ConfirmSupplierReturnPayload,
) -> Result<ConfirmSupplierReturnResult, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    procurement_service::confirm_supplier_return(pool, &session_token, payload)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn post_supplier_payment(
    state: State<'_, DatabaseState>,
    session_token: String,
    payload: crate::domain::procurement::PostSupplierPaymentPayload,
) -> Result<PostSupplierPaymentResult, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    procurement_service::post_supplier_payment(pool, &session_token, payload)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn list_supplier_returns(
    state: State<'_, DatabaseState>,
    session_token: String,
    supplier_id: Option<i64>,
) -> Result<Vec<crate::domain::procurement::SupplierReturnSummary>, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    procurement_service::list_supplier_returns(pool, &session_token, supplier_id)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn list_supplier_payments(
    state: State<'_, DatabaseState>,
    session_token: String,
    supplier_id: Option<i64>,
) -> Result<Vec<crate::domain::procurement::SupplierPaymentDto>, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    procurement_service::list_supplier_payments(pool, &session_token, supplier_id)
        .await
        .map_err(IpcError::from)
}
