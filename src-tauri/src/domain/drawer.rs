use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DrawerOperationPolicy {
    pub operation_code: String,
    pub movement_type: String,
    pub movement_direction: String,
    pub is_enabled: bool,
    pub description: String,
    pub can_manage: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateDrawerOperationPolicyPayload {
    pub operation_code: String,
    pub is_enabled: bool,
}

impl UpdateDrawerOperationPolicyPayload {
    pub fn validate(&self) -> Result<(), String> {
        if self.operation_code.trim().is_empty() {
            return Err("Drawer operation code is required.".to_string());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_blank_operation_code() {
        let payload = UpdateDrawerOperationPolicyPayload {
            operation_code: " ".to_string(),
            is_enabled: true,
        };
        assert!(payload.validate().is_err());
    }
}
