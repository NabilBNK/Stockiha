//! S1-001 — the `Warehouse` domain value type. Mirrors
//! `inventory.warehouses` exactly: a stable code, a display name, and an
//! active flag.

use super::error::DomainError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Warehouse {
    code: String,
    name: String,
    is_active: bool,
}

impl Warehouse {
    pub(crate) fn new(
        code: impl Into<String>,
        name: impl Into<String>,
        is_active: bool,
    ) -> Result<Self, DomainError> {
        let code = code.into();
        let name = name.into();
        if code.trim().is_empty() {
            return Err(DomainError::BlankField);
        }
        if name.trim().is_empty() {
            return Err(DomainError::BlankField);
        }
        Ok(Self {
            code,
            name,
            is_active,
        })
    }

    pub(crate) fn code(&self) -> &str {
        &self.code
    }

    pub(crate) fn name(&self) -> &str {
        &self.name
    }

    pub(crate) fn is_active(&self) -> bool {
        self.is_active
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_blank_code_and_name() {
        assert_eq!(
            Warehouse::new("", "Main", true),
            Err(DomainError::BlankField)
        );
        assert_eq!(
            Warehouse::new("WH1", "", true),
            Err(DomainError::BlankField)
        );
    }

    #[test]
    fn accepts_valid_warehouse() {
        let warehouse = Warehouse::new("WH1", "Main Warehouse", true).unwrap();
        assert_eq!(warehouse.code(), "WH1");
        assert!(warehouse.is_active());
    }
}
