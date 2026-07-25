use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Supplier {
    pub id: i64,
    pub code: String,
    pub name: String,
    pub contact_name: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub address: Option<String>,
    pub tax_id: Option<String>,
    pub is_active: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSupplierPayload {
    pub code: String,
    pub name: String,
    pub contact_name: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub address: Option<String>,
    pub tax_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateSupplierPayload {
    pub supplier_id: i64,
    pub code: String,
    pub name: String,
    pub contact_name: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub address: Option<String>,
    pub tax_id: Option<String>,
    pub is_active: bool,
}

impl CreateSupplierPayload {
    pub fn validate(&self) -> Result<(), String> {
        if self.code.trim().is_empty() {
            return Err("Supplier code cannot be blank.".to_string());
        }
        if self.name.trim().is_empty() {
            return Err("Supplier name cannot be blank.".to_string());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_supplier_payload_validation() {
        let valid = CreateSupplierPayload {
            code: "SUP-1".to_string(),
            name: "Supplier 1".to_string(),
            contact_name: None,
            phone: None,
            email: None,
            address: None,
            tax_id: None,
        };
        assert!(valid.validate().is_ok());

        let invalid_code = CreateSupplierPayload {
            code: "  ".to_string(),
            name: "Supplier 1".to_string(),
            contact_name: None,
            phone: None,
            email: None,
            address: None,
            tax_id: None,
        };
        assert!(invalid_code.validate().is_err());
    }
}
