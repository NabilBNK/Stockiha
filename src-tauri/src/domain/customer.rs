use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Customer {
    pub id: i64,
    pub code: String,
    pub name: String,
    pub contact_name: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub address: Option<String>,
    pub tax_id: Option<String>,
    pub credit_limit_amount: String,
    pub max_overdue_days: i32,
    pub is_active: bool,
    pub exposure_amount: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateCustomerPayload {
    pub code: String,
    pub name: String,
    pub contact_name: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub address: Option<String>,
    pub tax_id: Option<String>,
    pub credit_limit_amount: String,
    pub max_overdue_days: i32,
}

impl CreateCustomerPayload {
    pub fn validate(&self) -> Result<(), String> {
        if self.code.trim().is_empty() {
            return Err("Customer code cannot be blank.".to_string());
        }
        if self.name.trim().is_empty() {
            return Err("Customer name cannot be blank.".to_string());
        }
        let limit: rust_decimal::Decimal = self
            .credit_limit_amount
            .parse()
            .map_err(|_| "Invalid credit limit amount.".to_string())?;
        if limit < rust_decimal::Decimal::ZERO {
            return Err("Credit limit cannot be negative.".to_string());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomerLiabilityDto {
    pub id: i64,
    pub customer_id: i64,
    pub customer_name: String,
    pub customer_code: String,
    pub original_amount: String,
    pub remaining_amount: String,
    pub due_date: Option<String>,
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomerPaymentDto {
    pub id: i64,
    pub customer_id: i64,
    pub customer_name: String,
    pub customer_code: String,
    pub liability_id: Option<i64>,
    pub amount: String,
    pub payment_method: String,
    pub document_number: Option<String>,
    pub document_date: String,
    pub note: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostCustomerPaymentPayload {
    pub request_id: String,
    pub customer_id: i64,
    pub liability_id: i64,
    pub amount: String,
    pub payment_method: String, // 'CASH' | 'BANK_TRANSFER' | 'CHECK'
    pub fiscal_period_id: i64,
    pub document_date: String,
    pub note: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_customer_payload_validation() {
        let valid = CreateCustomerPayload {
            code: "CUST-001".to_string(),
            name: "Test Customer".to_string(),
            contact_name: None,
            phone: None,
            email: None,
            address: None,
            tax_id: None,
            credit_limit_amount: "50000.00".to_string(),
            max_overdue_days: 30,
        };
        assert!(valid.validate().is_ok());

        let blank_code = CreateCustomerPayload {
            code: "  ".to_string(),
            name: "Test Customer".to_string(),
            contact_name: None,
            phone: None,
            email: None,
            address: None,
            tax_id: None,
            credit_limit_amount: "50000.00".to_string(),
            max_overdue_days: 30,
        };
        assert!(blank_code.validate().is_err());

        let neg_limit = CreateCustomerPayload {
            code: "CUST-002".to_string(),
            name: "Test 2".to_string(),
            contact_name: None,
            phone: None,
            email: None,
            address: None,
            tax_id: None,
            credit_limit_amount: "-100.00".to_string(),
            max_overdue_days: 0,
        };
        assert!(neg_limit.validate().is_err());
    }
}
