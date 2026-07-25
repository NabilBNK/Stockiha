use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PurchaseOrderSummary {
    pub document_id: i64,
    pub document_number: Option<String>,
    pub supplier_id: i64,
    pub supplier_code: String,
    pub supplier_name: String,
    pub warehouse_id: i64,
    pub warehouse_code: String,
    pub warehouse_name: String,
    pub status: String,
    pub subtotal: String,
    pub total_amount: String,
    pub created_at: String,
    pub confirmed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PurchaseOrderLineDto {
    pub id: i64,
    pub line_number: i32,
    pub variant_id: i64,
    pub variant_sku: String,
    pub variant_name: String,
    pub unit_id: i64,
    pub unit_code: String,
    pub unit_name: String,
    pub quantity_ordered: String,
    pub quantity_received: String,
    pub remaining_quantity: String,
    pub unit_cost: String,
    pub line_total: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PurchaseOrderDetailDto {
    pub document_id: i64,
    pub document_number: Option<String>,
    pub supplier_id: i64,
    pub supplier_code: String,
    pub supplier_name: String,
    pub warehouse_id: i64,
    pub warehouse_code: String,
    pub warehouse_name: String,
    pub status: String,
    pub subtotal: String,
    pub total_amount: String,
    pub note: Option<String>,
    pub created_at: String,
    pub confirmed_at: Option<String>,
    pub lines: Vec<PurchaseOrderLineDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatePoLinePayload {
    pub variant_id: i64,
    pub unit_id: i64,
    pub quantity_ordered: String,
    pub unit_cost: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatePurchaseOrderPayload {
    pub supplier_id: i64,
    pub warehouse_id: i64,
    pub note: Option<String>,
    pub lines: Vec<CreatePoLinePayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdatePurchaseOrderPayload {
    pub purchase_order_id: i64,
    pub supplier_id: i64,
    pub warehouse_id: i64,
    pub note: Option<String>,
    pub lines: Vec<CreatePoLinePayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfirmPurchaseReceiptLinePayload {
    pub po_line_id: i64,
    pub quantity_received: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfirmPurchaseReceiptPayload {
    pub request_id: String,
    pub purchase_order_id: i64,
    pub fiscal_period_id: i64,
    pub document_date: String,
    pub lines: Vec<ConfirmPurchaseReceiptLinePayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PurchaseReceiptSummary {
    pub document_id: i64,
    pub document_number: String,
    pub purchase_order_id: i64,
    pub purchase_order_number: String,
    pub supplier_id: i64,
    pub supplier_name: String,
    pub warehouse_id: i64,
    pub warehouse_name: String,
    pub total_amount: String,
    pub posted_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfirmPurchaseReceiptResult {
    pub document_id: i64,
    pub document_number: String,
    pub purchase_order_id: i64,
    pub purchase_order_number: String,
    pub supplier_id: i64,
    pub warehouse_id: i64,
    pub total_amount: String,
    pub journal_document_id: Option<i64>,
    pub journal_document_number: Option<String>,
    pub order_status: String,
    pub posted_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AllocateLandedCostPayload {
    pub request_id: String,
    pub receipt_id: i64,
    pub landed_cost_amount: String,
    pub allocation_method: String,
    pub fiscal_period_id: i64,
    pub document_date: String,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSupplierInvoiceLinePayload {
    pub line_number: i32,
    pub po_line_id: Option<i64>,
    pub receipt_line_id: Option<i64>,
    pub variant_id: i64,
    pub quantity: String,
    pub unit_cost: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSupplierInvoicePayload {
    pub supplier_id: i64,
    pub purchase_order_id: Option<i64>,
    pub currency_code: Option<String>,
    pub exchange_rate_to_dzd: Option<String>,
    pub note: Option<String>,
    pub lines: Vec<CreateSupplierInvoiceLinePayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfirmSupplierInvoicePayload {
    pub request_id: String,
    pub invoice_doc_id: i64,
    pub fiscal_period_id: i64,
    pub document_date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupplierInvoiceSummary {
    pub document_id: i64,
    pub document_number: Option<String>,
    pub supplier_id: i64,
    pub supplier_name: String,
    pub status: String,
    pub currency_code: String,
    pub foreign_total_amount: String,
    pub base_total_amount: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupplierLiabilityDto {
    pub id: i64,
    pub supplier_id: i64,
    pub supplier_code: String,
    pub supplier_name: String,
    pub document_id: Option<i64>,
    pub original_amount: String,
    pub remaining_amount: String,
    pub due_date: Option<String>,
    pub created_at: String,
}

impl CreatePurchaseOrderPayload {
    pub fn validate(&self) -> Result<(), String> {
        if self.supplier_id <= 0 {
            return Err("Supplier selection is required.".to_string());
        }
        if self.warehouse_id <= 0 {
            return Err("Warehouse selection is required.".to_string());
        }
        if self.lines.is_empty() {
            return Err("Purchase order must contain at least one line.".to_string());
        }
        for (idx, line) in self.lines.iter().enumerate() {
            let qty: Decimal = line
                .quantity_ordered
                .parse()
                .map_err(|_| format!("Line {}: invalid ordered quantity", idx + 1))?;
            if qty <= Decimal::ZERO {
                return Err(format!("Line {}: quantity must be positive", idx + 1));
            }
            let cost: Decimal = line
                .unit_cost
                .parse()
                .map_err(|_| format!("Line {}: invalid unit cost", idx + 1))?;
            if cost < Decimal::ZERO {
                return Err(format!("Line {}: unit cost cannot be negative", idx + 1));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_po_payload_validation() {
        let valid = CreatePurchaseOrderPayload {
            supplier_id: 1,
            warehouse_id: 1,
            note: None,
            lines: vec![CreatePoLinePayload {
                variant_id: 7,
                unit_id: 1,
                quantity_ordered: "10.000".to_string(),
                unit_cost: "100.00".to_string(),
            }],
        };
        assert!(valid.validate().is_ok());

        let invalid_qty = CreatePurchaseOrderPayload {
            supplier_id: 1,
            warehouse_id: 1,
            note: None,
            lines: vec![CreatePoLinePayload {
                variant_id: 7,
                unit_id: 1,
                quantity_ordered: "-1.000".to_string(),
                unit_cost: "100.00".to_string(),
            }],
        };
        assert!(invalid_qty.validate().is_err());
    }
}
