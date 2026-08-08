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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RefundableCustomerPayment {
    pub payment_document_id: i64,
    pub document_number: String,
    pub document_date: String,
    pub payment_method: String,
    pub amount: String,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthorizeCustomerRefundPayload {
    pub authorization_id: String,
    pub source_payment_document_id: i64,
    pub refund_method: String,
    pub cash_session_id: Option<i64>,
    pub reason: String,
    pub ttl_minutes: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostCustomerRefundPayload {
    pub request_id: String,
    pub authorization_id: String,
    pub fiscal_period_id: i64,
    pub document_date: String,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CustomerRefundResult {
    pub document_id: i64,
    pub document_number: String,
    pub source_payment_document_id: i64,
    pub customer_id: i64,
    pub refund_method: String,
    pub amount: String,
    pub exposure_amount: String,
    pub available_credit: String,
    pub journal_document_id: i64,
    pub refund_ledger_entry_id: i64,
}

impl PostCustomerPaymentPayload {
    pub fn validate(&self) -> Result<(), String> {
        if self.customer_id <= 0 || self.fiscal_period_id <= 0 {
            return Err("Customer and fiscal period are required.".to_string());
        }
        if self.request_id.trim().is_empty() {
            return Err("Request id is required.".to_string());
        }
        let amount: Decimal = self
            .amount
            .parse()
            .map_err(|_| "Payment amount must be a valid decimal.".to_string())?;
        if amount <= Decimal::ZERO {
            return Err("Payment amount must be positive.".to_string());
        }
        let method = self.payment_method.trim().to_ascii_uppercase();
        if !matches!(method.as_str(), "CASH" | "BANK_TRANSFER") {
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
            let allocated: Decimal = allocation
                .amount
                .parse()
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

impl AuthorizeCustomerRefundPayload {
    pub fn validate(&self) -> Result<(), String> {
        if self.authorization_id.trim().is_empty() || self.source_payment_document_id <= 0 {
            return Err("Refund authorization and source payment are required.".to_string());
        }
        let method = self.refund_method.trim().to_ascii_uppercase();
        if !matches!(method.as_str(), "CASH" | "BANK_TRANSFER") {
            return Err("Unsupported customer refund method.".to_string());
        }
        if method == "CASH" && self.cash_session_id.is_none() {
            return Err("Cash refund requires an active cash session.".to_string());
        }
        if method != "CASH" && self.cash_session_id.is_some() {
            return Err("Bank-transfer refund cannot use a cash session.".to_string());
        }
        if self.reason.trim().is_empty() {
            return Err("Refund authorization reason is required.".to_string());
        }
        if !(1..=30).contains(&self.ttl_minutes) {
            return Err(
                "Refund authorization lifetime must be between 1 and 30 minutes.".to_string(),
            );
        }
        Ok(())
    }
}

impl PostCustomerRefundPayload {
    pub fn validate(&self) -> Result<(), String> {
        if self.request_id.trim().is_empty() || self.authorization_id.trim().is_empty() {
            return Err("Refund request and authorization ids are required.".to_string());
        }
        if self.fiscal_period_id <= 0 {
            return Err("Fiscal period is required.".to_string());
        }
        if self.document_date.trim().is_empty() {
            return Err("Document date is required.".to_string());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_payment() -> PostCustomerPaymentPayload {
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
        assert!(valid_payment().validate().is_ok());
    }

    #[test]
    fn rejects_allocation_sum_mismatch() {
        let mut payload = valid_payment();
        payload.allocations[0].amount = "99.00".into();
        assert!(payload.validate().is_err());
    }

    #[test]
    fn rejects_bank_payment_with_cash_session() {
        let mut payload = valid_payment();
        payload.payment_method = "BANK_TRANSFER".into();
        assert!(payload.validate().is_err());
    }

    #[test]
    fn rejects_legacy_check_payment_method() {
        let mut payload = valid_payment();
        payload.payment_method = "CHECK".into();
        payload.cash_session_id = None;
        assert!(payload.validate().is_err());
    }

    #[test]
    fn validates_cash_refund_binding() {
        let payload = AuthorizeCustomerRefundPayload {
            authorization_id: "00000000-0000-4000-8000-000000000002".into(),
            source_payment_document_id: 10,
            refund_method: "CASH".into(),
            cash_session_id: Some(3),
            reason: "Approved correction".into(),
            ttl_minutes: 15,
        };
        assert!(payload.validate().is_ok());
    }

    #[test]
    fn rejects_cash_refund_without_session() {
        let payload = AuthorizeCustomerRefundPayload {
            authorization_id: "00000000-0000-4000-8000-000000000002".into(),
            source_payment_document_id: 10,
            refund_method: "CASH".into(),
            cash_session_id: None,
            reason: "Approved correction".into(),
            ttl_minutes: 15,
        };
        assert!(payload.validate().is_err());
    }
}
