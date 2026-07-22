//! S1-001 (corrected) — `Product` (catalog identity) and `ProductVariant`
//! (the stocked, sellable, priced unit).
//!
//! Correction from the first pass: `sku`/`sale_price` moved off `Product`
//! entirely, onto `ProductVariant` — "price, availability, stock, and WAC
//! attach to the stocked variant where required". `catalog.products` is
//! now just the grouping identity above the sellable unit; valuation still
//! lives on `inventory.positions` (warehouse-specific WAC), not on the
//! variant itself either.

use super::error::DomainError;
use super::money::Money;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Product {
    name: String,
    is_active: bool,
}

impl Product {
    pub(crate) fn new(name: impl Into<String>, is_active: bool) -> Result<Self, DomainError> {
        let name = name.into();
        if name.trim().is_empty() {
            return Err(DomainError::BlankField);
        }
        Ok(Self { name, is_active })
    }

    pub(crate) fn name(&self) -> &str {
        &self.name
    }

    pub(crate) fn is_active(&self) -> bool {
        self.is_active
    }
}

/// The actual sellable/stocked unit. Minimal grain only — no attributes,
/// barcodes, or unit conversions (those stay Slice 2 work); this exists at
/// all in S1-001 only because inventory positions/movements and sale lines
/// need a stable `variant_id` to key off of.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ProductVariant {
    sku: String,
    sale_price: Money,
    is_active: bool,
}

impl ProductVariant {
    pub(crate) fn new(
        sku: impl Into<String>,
        sale_price: Money,
        is_active: bool,
    ) -> Result<Self, DomainError> {
        let sku = sku.into();
        if sku.trim().is_empty() {
            return Err(DomainError::BlankField);
        }
        Ok(Self {
            sku,
            sale_price,
            is_active,
        })
    }

    pub(crate) fn sku(&self) -> &str {
        &self.sku
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
    fn product_rejects_blank_name() {
        assert_eq!(Product::new("", true), Err(DomainError::BlankField));
        assert_eq!(Product::new("   ", true), Err(DomainError::BlankField));
    }

    #[test]
    fn product_accepts_valid_name() {
        let product = Product::new("Widget", true).unwrap();
        assert_eq!(product.name(), "Widget");
        assert!(product.is_active());
    }

    #[test]
    fn variant_rejects_blank_sku() {
        let price = Money::new_non_negative(Decimal::new(1000, 2)).unwrap();
        assert_eq!(
            ProductVariant::new("", price, true),
            Err(DomainError::BlankField)
        );
    }

    #[test]
    fn variant_accepts_valid_sku_and_price() {
        let price = Money::new_non_negative(Decimal::new(1999, 2)).unwrap();
        let variant = ProductVariant::new("SKU-1", price, true).unwrap();
        assert_eq!(variant.sku(), "SKU-1");
        assert_eq!(variant.sale_price(), price);
        assert!(variant.is_active());
    }
}
