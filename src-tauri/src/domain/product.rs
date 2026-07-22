//! S1-001 — the `Product` domain value type.
//!
//! Deliberately minimal, matching `inventory.products`: identity (sku),
//! display name, sale price, and active status. No cost field: valuation is
//! warehouse-specific WAC (final-architecture.md section 1), which lives on
//! `inventory.warehouse_stock`, not on the product itself — see
//! [`super::stock`].

use super::error::DomainError;
use super::money::Money;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Product {
    sku: String,
    name: String,
    sale_price: Money,
    is_active: bool,
}

impl Product {
    pub(crate) fn new(
        sku: impl Into<String>,
        name: impl Into<String>,
        sale_price: Money,
        is_active: bool,
    ) -> Result<Self, DomainError> {
        let sku = sku.into();
        let name = name.into();
        if sku.trim().is_empty() {
            return Err(DomainError::BlankField);
        }
        if name.trim().is_empty() {
            return Err(DomainError::BlankField);
        }
        Ok(Self {
            sku,
            name,
            sale_price,
            is_active,
        })
    }

    pub(crate) fn sku(&self) -> &str {
        &self.sku
    }

    pub(crate) fn name(&self) -> &str {
        &self.name
    }

    pub(crate) fn sale_price(&self) -> Money {
        self.sale_price
    }

    pub(crate) fn is_active(&self) -> bool {
        self.is_active
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal::Decimal;

    #[test]
    fn rejects_blank_sku_and_name() {
        let price = Money::new_non_negative(Decimal::new(1000, 2)).unwrap();
        assert_eq!(
            Product::new("", "Name", price, true),
            Err(DomainError::BlankField)
        );
        assert_eq!(
            Product::new("SKU-1", "  ", price, true),
            Err(DomainError::BlankField)
        );
    }

    #[test]
    fn accepts_valid_product() {
        let price = Money::new_non_negative(Decimal::new(1000, 2)).unwrap();
        let product = Product::new("SKU-1", "Widget", price, true).unwrap();
        assert_eq!(product.sku(), "SKU-1");
        assert_eq!(product.name(), "Widget");
        assert!(product.is_active());
    }
}
