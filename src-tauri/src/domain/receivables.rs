use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OpenCustomerInvoice {
    pub invoice_ledger_entry_id: i64,
    pub document_id: Option<i64>,
    pub document_number: Option<String>,
    pub document_date: Option<String>,
    pub due_date: Option<String>,
    pub original_amount: String,
    pub allocated_amount: String,
    pub remaining_amount: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomerPaymentAllocationInput {
    pub invoice_ledger_entry_id: i64,
    pub amount: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostCustomerPaymentPayload {
    pub request_id: String,
    pub customer_id: i64,
    pub amount: String,
    pub payment_method: String,
    pub cash_session_id: Option<i64>,
    pub fiscal_period_id: i64,
    pub document_date: String,
    pub allocations: Vec<CustomerPaymentAllocationInput>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CustomerPaymentResult {
    pub document_id: i64,
    pub document_number: String,
    pub customer_id: i64,
    pub payment_method: String,
    pub amount: String,
    pub exposure_amount: String,
    pub available_credit: String,
    pub journal_document_id: i64,
    pub payment_ledger_entry_id: i64,
}

impl PostCustomerPaymentPayload {
    pub fn validate(&self) -> Result<(), String> {
        if self.customer_id <= 0 || self.fiscal_period_id <= 0 {
            return Err("Customer and fiscal period are required.".to_string());
        }
        if self.request_id.trim().is_empty() {
            return Err("Request id is required.".to_string());
        }
        let amount: Decimal = self.amount.parse()
            .map_err(|_| "Payment amount must be a valid decimal.".to_string())?;
        if amount <= Decimal::ZERO {
            return Err("Payment amount must be positive.".to_string());
        }
        let method = self.payment_method.trim().to_ascii_uppercase();
        if !matches!(method.as_str(), "CASH" | "BANK_TRANSFER" | "CHECK") {
            return Err("Unsupported customer payment method.".to_string());
        }
        if method == "CASH" && self.cash_session_id.is_none() {
            return Err("Cash payment requires an active cash session.".to_string());
        }
        if method != "CASH" && self.cash_session_id.is_some() {
            return Err("Non-cash payment cannot use a cash session.".to_string());
        }
        if self.allocations.is_empty() {
            return Err("Payment requires at least one invoice allocation.".to_string());
        }

        let mut sum = Decimal::ZERO;
        for allocation in &self.allocations {
            if allocation.invoice_ledger_entry_id <= 0 {
                return Err("Invoice allocation id must be positive.".to_string());
            }
            let allocated: Decimal = allocation.amount.parse()
                .map_err(|_| "Allocation amount must be a valid decimal.".to_string())?;
            if allocated <= Decimal::ZERO {
                return Err("Allocation amount must be positive.".to_string());
            }
            sum += allocated;
        }
        if sum != amount {
            return Err("Payment allocations must equal payment amount.".to_string());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid() -> PostCustomerPaymentPayload {
        PostCustomerPaymentPayload {
            request_id: "00000000-0000-4000-8000-000000000001".into(),
            customer_id: 1,
            amount: "100.00".into(),
            payment_method: "CASH".into(),
            cash_session_id: Some(1),
            fiscal_period_id: 1,
            document_date: "2026-07-30".into(),
            allocations: vec![CustomerPaymentAllocationInput {
                invoice_ledger_entry_id: 1,
                amount: "100.00".into(),
            }],
            note: None,
        }
    }

    #[test]
    fn accepts_balanced_cash_payment() {
        assert!(valid().validate().is_ok());
    }

    #[test]
    fn rejects_allocation_sum_mismatch() {
        let mut payload = valid();
        payload.allocations[0].amount = "99.00".into();
        assert!(payload.validate().is_err());
    }

    #[test]
    fn rejects_bank_payment_with_cash_session() {
        let mut payload = valid();
        payload.payment_method = "BANK_TRANSFER".into();
        assert!(payload.validate().is_err());
    }
}
