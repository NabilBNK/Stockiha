use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReturnLinePayload {
    pub variant_id: i64,
    pub quantity: String,
    pub unit_price: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfirmCustomerReturnPayload {
    pub request_id: String,
    pub customer_id: Option<i64>,
    pub cash_session_id: Option<i64>,
    pub warehouse_id: i64,
    pub refund_method: String,
    pub fiscal_period_id: i64,
    pub document_date: String,
    pub lines: Vec<ReturnLinePayload>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferLinePayload {
    pub variant_id: i64,
    pub quantity: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfirmWarehouseTransferPayload {
    pub request_id: String,
    pub from_warehouse_id: i64,
    pub to_warehouse_id: i64,
    pub fiscal_period_id: i64,
    pub document_date: String,
    pub lines: Vec<TransferLinePayload>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WriteOffLinePayload {
    pub variant_id: i64,
    pub quantity: String,
    pub unit_cost: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfirmStockWriteOffPayload {
    pub request_id: String,
    pub warehouse_id: i64,
    pub reason_code: String,
    pub fiscal_period_id: i64,
    pub document_date: String,
    pub lines: Vec<WriteOffLinePayload>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomerReturnDto {
    pub id: i64,
    pub document_id: i64,
    pub document_number: String,
    pub customer_name: String,
    pub refund_method: String,
    pub total_amount: String,
    pub note: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WarehouseTransferDto {
    pub id: i64,
    pub document_id: i64,
    pub document_number: String,
    pub from_warehouse_name: String,
    pub to_warehouse_name: String,
    pub note: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StockWriteOffDto {
    pub id: i64,
    pub document_id: i64,
    pub document_number: String,
    pub warehouse_name: String,
    pub reason_code: String,
    pub total_cost: String,
    pub note: Option<String>,
    pub created_at: String,
}
