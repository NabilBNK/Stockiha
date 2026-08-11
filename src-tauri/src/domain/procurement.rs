use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProcurementCapabilities {
    pub can_manage_procurement: bool,
    pub can_post_purchase_receipt: bool,
    pub can_post_supplier_invoice: bool,
    pub can_post_supplier_return: bool,
    pub can_post_supplier_payment: bool,
}

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
    pub journal_document_id: Option<i64>,
    pub journal_document_number: Option<String>,
    pub landed_cost_amount: Option<String>,
    pub landed_cost_journal_id: Option<i64>,
    pub landed_cost_journal_number: Option<String>,
    pub posted_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PurchaseReceiptLineDto {
    pub receipt_line_id: i64,
    pub receipt_document_id: i64,
    pub receipt_document_number: String,
    pub purchase_order_id: i64,
    pub purchase_order_number: String,
    pub po_line_id: i64,
    pub supplier_id: i64,
    pub supplier_name: String,
    pub warehouse_id: i64,
    pub warehouse_name: String,
    pub variant_id: i64,
    pub variant_sku: String,
    pub variant_name: String,
    pub unit_id: i64,
    pub unit_code: String,
    pub quantity_received: String,
    pub quantity_invoiced: String,
    pub quantity_available_to_invoice: String,
    pub quantity_returned_for_variant: String,
    pub quantity_returnable_for_variant: String,
    pub unit_cost: String,
    pub line_total: String,
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
pub struct AllocateLandedCostResult {
    pub receipt_id: i64,
    pub landed_cost_amount: String,
    pub inventory_debit: Option<String>,
    pub variance_debit: Option<String>,
    pub journal_document_id: i64,
    pub status: String,
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
pub struct CreateSupplierInvoiceResult {
    pub document_id: i64,
    pub supplier_id: i64,
    pub purchase_order_id: i64,
    pub status: String,
    pub subtotal: String,
    pub total_amount: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfirmSupplierInvoicePayload {
    pub request_id: String,
    pub invoice_doc_id: i64,
    pub fiscal_period_id: i64,
    pub document_date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfirmSupplierInvoiceResult {
    pub document_id: i64,
    pub document_number: String,
    pub supplier_id: Option<i64>,
    pub total_amount: Option<String>,
    pub grni_amount: Option<String>,
    pub variance_amount: Option<String>,
    pub journal_document_id: i64,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupplierInvoiceSummary {
    pub document_id: i64,
    pub document_number: Option<String>,
    pub supplier_id: i64,
    pub supplier_name: String,
    pub purchase_order_id: Option<i64>,
    pub purchase_order_number: Option<String>,
    pub status: String,
    pub currency_code: String,
    pub foreign_total_amount: String,
    pub base_total_amount: String,
    pub journal_document_id: Option<i64>,
    pub journal_document_number: Option<String>,
    pub liability_id: Option<i64>,
    pub outstanding_amount: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupplierLiabilityDto {
    pub id: i64,
    pub supplier_id: i64,
    pub supplier_code: String,
    pub supplier_name: String,
    pub document_id: Option<i64>,
    pub document_number: Option<String>,
    pub source_type: String,
    pub journal_document_id: i64,
    pub journal_document_number: Option<String>,
    pub original_amount: String,
    pub remaining_amount: String,
    pub status: String,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSupplierReturnLinePayload {
    pub variant_id: i64,
    pub quantity: String,
    pub unit_cost: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSupplierReturnPayload {
    pub supplier_id: i64,
    pub warehouse_id: i64,
    pub purchase_order_id: Option<i64>,
    pub reason_code: Option<String>,
    pub note: Option<String>,
    pub lines: Vec<CreateSupplierReturnLinePayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSupplierReturnResult {
    pub document_id: i64,
    pub supplier_id: i64,
    pub purchase_order_id: i64,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfirmSupplierReturnPayload {
    pub return_document_id: i64,
    pub fiscal_period_id: i64,
    pub document_date: String,
    pub request_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfirmSupplierReturnResult {
    pub document_id: i64,
    pub document_number: String,
    pub status: String,
    pub clearing_role: Option<String>,
    pub clearing_amount: Option<String>,
    pub inventory_value: Option<String>,
    pub variance_amount: Option<String>,
    pub journal_document_id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostSupplierPaymentPayload {
    pub supplier_id: i64,
    pub liability_id: Option<i64>,
    pub amount: String,
    pub payment_method: String,
    pub fiscal_period_id: i64,
    pub document_date: String,
    pub note: Option<String>,
    pub request_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostSupplierPaymentResult {
    pub document_id: i64,
    pub document_number: String,
    pub status: String,
    pub journal_document_id: i64,
    pub amount: Option<String>,
    pub funding_role: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupplierReturnSummary {
    pub document_id: i64,
    pub document_number: Option<String>,
    pub supplier_id: i64,
    pub supplier_name: String,
    pub warehouse_id: i64,
    pub warehouse_name: String,
    pub purchase_order_id: Option<i64>,
    pub purchase_order_number: Option<String>,
    pub status: String,
    pub reason_code: String,
    pub journal_document_id: Option<i64>,
    pub journal_document_number: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupplierPaymentDto {
    pub document_id: i64,
    pub document_number: Option<String>,
    pub supplier_id: i64,
    pub supplier_name: String,
    pub liability_id: i64,
    pub payment_method: String,
    pub amount: String,
    pub journal_document_id: Option<i64>,
    pub journal_document_number: Option<String>,
    pub created_at: String,
}

fn positive_decimal(value: &str, field: &str) -> Result<Decimal, String> {
    let parsed = value
        .parse::<Decimal>()
        .map_err(|_| format!("Invalid {field}."))?;
    if parsed <= Decimal::ZERO {
        return Err(format!("{field} must be positive."));
    }
    Ok(parsed)
}

fn non_negative_decimal(value: &str, field: &str) -> Result<Decimal, String> {
    let parsed = value
        .parse::<Decimal>()
        .map_err(|_| format!("Invalid {field}."))?;
    if parsed < Decimal::ZERO {
        return Err(format!("{field} cannot be negative."));
    }
    Ok(parsed)
}

impl AllocateLandedCostPayload {
    pub fn validate(&self) -> Result<(), String> {
        if self.receipt_id <= 0 || self.fiscal_period_id <= 0 {
            return Err("Receipt and fiscal period are required.".to_string());
        }
        positive_decimal(&self.landed_cost_amount, "landed cost amount")?;
        if !matches!(
            self.allocation_method.as_str(),
            "BY_QTY" | "BY_VALUE" | "EQUAL_PER_LINE"
        ) {
            return Err("Unsupported landed cost allocation method.".to_string());
        }
        Ok(())
    }
}

impl CreateSupplierInvoicePayload {
    pub fn validate(&self) -> Result<(), String> {
        if self.supplier_id <= 0 || self.purchase_order_id.unwrap_or_default() <= 0 {
            return Err("Supplier and purchase order are required.".to_string());
        }
        if self.lines.is_empty() {
            return Err("Supplier invoice requires at least one receipt line.".to_string());
        }
        if self.currency_code.as_deref().unwrap_or("DZD") != "DZD" {
            return Err("Only DZD supplier invoices are enabled for the MVP.".to_string());
        }
        if let Some(rate) = self.exchange_rate_to_dzd.as_deref() {
            positive_decimal(rate, "exchange rate")?;
        }
        for (index, line) in self.lines.iter().enumerate() {
            if line.line_number <= 0
                || line.po_line_id.unwrap_or_default() <= 0
                || line.receipt_line_id.unwrap_or_default() <= 0
                || line.variant_id <= 0
            {
                return Err(format!("Invoice line {} has invalid references.", index + 1));
            }
            positive_decimal(&line.quantity, "invoice quantity")?;
            non_negative_decimal(&line.unit_cost, "invoice unit cost")?;
        }
        Ok(())
    }
}

impl ConfirmSupplierInvoicePayload {
    pub fn validate(&self) -> Result<(), String> {
        if self.invoice_doc_id <= 0 || self.fiscal_period_id <= 0 {
            return Err("Invoice and fiscal period are required.".to_string());
        }
        Ok(())
    }
}

impl CreateSupplierReturnPayload {
    pub fn validate(&self) -> Result<(), String> {
        if self.supplier_id <= 0
            || self.warehouse_id <= 0
            || self.purchase_order_id.unwrap_or_default() <= 0
        {
            return Err("Supplier, warehouse, and purchase order are required.".to_string());
        }
        if self.lines.is_empty() {
            return Err("Supplier return requires at least one line.".to_string());
        }
        if !matches!(
            self.reason_code.as_deref().unwrap_or("DEFECTIVE_GOODS"),
            "DEFECTIVE_GOODS" | "EXCESS_DELIVERY" | "WRONG_ITEM"
        ) {
            return Err("Unsupported supplier return reason.".to_string());
        }
        for line in &self.lines {
            if line.variant_id <= 0 {
                return Err("Supplier return variant is required.".to_string());
            }
            positive_decimal(&line.quantity, "return quantity")?;
            non_negative_decimal(&line.unit_cost, "return unit cost")?;
        }
        Ok(())
    }
}

impl ConfirmSupplierReturnPayload {
    pub fn validate(&self) -> Result<(), String> {
        if self.return_document_id <= 0 || self.fiscal_period_id <= 0 {
            return Err("Return document and fiscal period are required.".to_string());
        }
        Ok(())
    }
}

impl PostSupplierPaymentPayload {
    pub fn validate(&self) -> Result<(), String> {
        if self.supplier_id <= 0
            || self.liability_id.unwrap_or_default() <= 0
            || self.fiscal_period_id <= 0
        {
            return Err("Supplier, liability, and fiscal period are required.".to_string());
        }
        positive_decimal(&self.amount, "payment amount")?;
        if !matches!(
            self.payment_method.as_str(),
            "CASH" | "BANK_TRANSFER" | "CHECK"
        ) {
            return Err("Unsupported supplier payment method.".to_string());
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

    #[test]
    fn procurement_posting_payloads_reject_unsafe_values() {
        let landed_cost = AllocateLandedCostPayload {
            request_id: "00000000-0000-4000-8000-000000000001".to_string(),
            receipt_id: 1,
            landed_cost_amount: "-0.01".to_string(),
            allocation_method: "BY_QTY".to_string(),
            fiscal_period_id: 1,
            document_date: "2026-08-11".to_string(),
            note: None,
        };
        assert!(landed_cost.validate().is_err());

        let payment = PostSupplierPaymentPayload {
            supplier_id: 1,
            liability_id: Some(1),
            amount: "10.00".to_string(),
            payment_method: "CARD".to_string(),
            fiscal_period_id: 1,
            document_date: "2026-08-11".to_string(),
            note: None,
            request_id: "00000000-0000-4000-8000-000000000002".to_string(),
        };
        assert!(payment.validate().is_err());
    }
}
