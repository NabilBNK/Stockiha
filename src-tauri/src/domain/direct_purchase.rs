use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfirmDirectPurchaseLinePayload {
    pub variant_id: i64,
    pub unit_id: i64,
    pub quantity_received: String,
    pub unit_cost: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfirmDirectPurchasePayload {
    pub request_id: String,
    pub supplier_id: i64,
    pub warehouse_id: i64,
    pub fiscal_period_id: i64,
    pub document_date: String,
    pub note: Option<String>,
    pub lines: Vec<ConfirmDirectPurchaseLinePayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfirmDirectPurchaseResult {
    pub document_id: i64,
    pub document_number: String,
    pub receipt_origin: String,
    pub purchase_order_id: Option<i64>,
    pub purchase_order_number: Option<String>,
    pub supplier_id: i64,
    pub warehouse_id: i64,
    pub total_amount: String,
    pub journal_document_id: i64,
    pub journal_document_number: Option<String>,
    pub order_status: Option<String>,
    pub posted_at: String,
}

impl ConfirmDirectPurchasePayload {
    pub fn validate(&self) -> Result<(), String> {
        if self.request_id.trim().is_empty() {
            return Err("Request ID is required.".to_string());
        }
        if self.supplier_id <= 0 {
            return Err("Supplier is required.".to_string());
        }
        if self.warehouse_id <= 0 {
            return Err("Warehouse is required.".to_string());
        }
        if self.fiscal_period_id <= 0 {
            return Err("Open fiscal period is required.".to_string());
        }
        if self.document_date.trim().is_empty() {
            return Err("Purchase date is required.".to_string());
        }
        if self.lines.is_empty() {
            return Err("Direct Purchase requires at least one product line.".to_string());
        }

        for (index, line) in self.lines.iter().enumerate() {
            if line.variant_id <= 0 || line.unit_id <= 0 {
                return Err(format!("Line {} has invalid product references.", index + 1));
            }

            let quantity: Decimal = line.quantity_received.parse().map_err(|_| {
                format!("Line {} has an invalid received quantity.", index + 1)
            })?;
            if quantity <= Decimal::ZERO {
                return Err(format!("Line {} quantity must be positive.", index + 1));
            }

            let cost: Decimal = line
                .unit_cost
                .parse()
                .map_err(|_| format!("Line {} has an invalid unit cost.", index + 1))?;
            if cost < Decimal::ZERO {
                return Err(format!("Line {} unit cost cannot be negative.", index + 1));
            }
        }

        Ok(())
    }
}
