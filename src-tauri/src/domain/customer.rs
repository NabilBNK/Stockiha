use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Customer {
    pub id: i64,
    pub code: String,
    pub name: String,
    pub contact_name: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub address: Option<String>,
    pub tax_id: Option<String>,
    pub is_active: bool,
    pub credit_enabled: bool,
    pub credit_limit: String,
    pub payment_terms_days: i32,
    pub max_overdue_days: Option<i32>,
    pub exposure_amount: String,
    pub available_credit: String,
    pub oldest_open_due_date: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateCustomerPayload {
    pub code: Option<String>,
    pub name: String,
    pub contact_name: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub address: Option<String>,
    pub tax_id: Option<String>,
    pub credit_enabled: bool,
    pub credit_limit: String,
    pub payment_terms_days: i32,
    pub max_overdue_days: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateCustomerPayload {
    pub customer_id: i64,
    pub code: String,
    pub name: String,
    pub contact_name: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub address: Option<String>,
    pub tax_id: Option<String>,
    pub is_active: bool,
    pub credit_enabled: bool,
    pub credit_limit: String,
    pub payment_terms_days: i32,
    pub max_overdue_days: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CustomerCreditSummary {
    pub customer_id: i64,
    pub customer_code: String,
    pub customer_name: String,
    pub is_active: bool,
    pub credit_enabled: bool,
    pub credit_limit: String,
    pub exposure_amount: String,
    pub available_credit: String,
    pub payment_terms_days: i32,
    pub max_overdue_days: Option<i32>,
    pub oldest_open_due_date: Option<String>,
    pub overdue_blocked: bool,
    pub last_rebuilt_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CustomerLedgerEntry {
    pub id: i64,
    pub customer_id: i64,
    pub entry_type: String,
    pub amount_delta: String,
    pub document_id: Option<i64>,
    pub related_entry_id: Option<i64>,
    pub due_date: Option<String>,
    pub posted_by_user_id: i64,
    pub workstation_id: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CustomerCapabilities {
    pub can_view_customers: bool,
    pub can_manage_customers: bool,
    pub can_post_credit_sale: bool,
    pub can_post_customer_payment: bool,
    pub can_post_customer_refund: bool,
    pub can_manage_drawer_policy: bool,
    pub can_override_credit_limit: bool,
}

fn validate_credit_policy(
    credit_enabled: bool,
    credit_limit: &str,
    payment_terms_days: i32,
    max_overdue_days: Option<i32>,
) -> Result<(), String> {
    let limit: Decimal = credit_limit
        .parse()
        .map_err(|_| "Credit limit must be a valid decimal amount.".to_string())?;

    if limit < Decimal::ZERO {
        return Err("Credit limit cannot be negative.".to_string());
    }
    if payment_terms_days < 0 {
        return Err("Payment terms cannot be negative.".to_string());
    }
    if max_overdue_days.is_some_and(|days| days < 0) {
        return Err("Maximum overdue days cannot be negative.".to_string());
    }
    if !credit_enabled
        && (limit != Decimal::ZERO || payment_terms_days != 0 || max_overdue_days.is_some())
    {
        return Err(
            "Disabled credit requires zero limit, zero payment terms, and no overdue policy."
                .to_string(),
        );
    }

    Ok(())
}

impl CreateCustomerPayload {
    pub fn validate(&self) -> Result<(), String> {
        if self.name.trim().is_empty() {
            return Err("Customer name cannot be blank.".to_string());
        }
        validate_credit_policy(
            self.credit_enabled,
            &self.credit_limit,
            self.payment_terms_days,
            self.max_overdue_days,
        )
    }
}

impl UpdateCustomerPayload {
    pub fn validate(&self) -> Result<(), String> {
        if self.customer_id <= 0 {
            return Err("Customer id must be positive.".to_string());
        }
        if self.code.trim().is_empty() {
            return Err("Customer code cannot be blank.".to_string());
        }
        if self.name.trim().is_empty() {
            return Err("Customer name cannot be blank.".to_string());
        }
        validate_credit_policy(
            self.credit_enabled,
            &self.credit_limit,
            self.payment_terms_days,
            self.max_overdue_days,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_payload() -> CreateCustomerPayload {
        CreateCustomerPayload {
            code: None,
            name: "Customer One".to_string(),
            contact_name: None,
            phone: None,
            email: None,
            address: None,
            tax_id: None,
            credit_enabled: true,
            credit_limit: "500000.00".to_string(),
            payment_terms_days: 30,
            max_overdue_days: Some(15),
        }
    }

    #[test]
    fn accepts_valid_credit_policy_without_caller_code() {
        assert!(valid_payload().validate().is_ok());
    }

    #[test]
    fn rejects_negative_credit_limit() {
        let mut payload = valid_payload();
        payload.credit_limit = "-1".to_string();
        assert!(payload.validate().is_err());
    }

    #[test]
    fn rejects_credit_policy_when_credit_disabled() {
        let mut payload = valid_payload();
        payload.credit_enabled = false;
        assert!(payload.validate().is_err());
    }
}
