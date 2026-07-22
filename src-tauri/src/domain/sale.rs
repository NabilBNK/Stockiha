//! S1-001 (corrected) — the `SaleLine` value type (cash-only scope:
//! final-architecture.md section 4, Slice 1 — no credit, returns, refunds,
//! discounts, taxes, or split payments).
//!
//! Correction from the first pass: `CashSaleStatus` moved to
//! [`super::business_document::BusinessDocumentStatus`] — `sales.
//! cash_sales` no longer has its own `status` column, since it is now a
//! thin subtype of `core.business_documents`. Snapshot fields are renamed
//! from `product_*_snapshot` to `variant_*_snapshot`: sale lines now key
//! off `catalog.product_variants`, not a bare product id.

use super::error::DomainError;
use super::money::{CostAmount, Money, Quantity};

/// A single sale line, carrying the historical snapshots the task requires
/// (variant identity, SKU/name snapshot, quantity, unit price, cost
/// snapshot, line total). Construction enforces the same derived-total
/// invariant as `cash_sale_lines_line_total_matches_quantity_and_price`:
/// `line_total = round(quantity * unit_price, 2)`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SaleLine {
    variant_sku_snapshot: String,
    variant_name_snapshot: String,
    quantity: Quantity,
    unit_price: Money,
    unit_cost_snapshot: CostAmount,
    line_total: Money,
}

impl SaleLine {
    pub(crate) fn new(
        variant_sku_snapshot: impl Into<String>,
        variant_name_snapshot: impl Into<String>,
        quantity: Quantity,
        unit_price: Money,
        unit_cost_snapshot: CostAmount,
    ) -> Result<Self, DomainError> {
        let variant_sku_snapshot = variant_sku_snapshot.into();
        let variant_name_snapshot = variant_name_snapshot.into();
        if variant_sku_snapshot.trim().is_empty() || variant_name_snapshot.trim().is_empty() {
            return Err(DomainError::BlankField);
        }

        let line_total_value = (quantity.value() * unit_price.value()).round_dp(Money::SCALE);
        let line_total = Money::new_non_negative(line_total_value)?;

        Ok(Self {
            variant_sku_snapshot,
            variant_name_snapshot,
            quantity,
            unit_price,
            unit_cost_snapshot,
            line_total,
        })
    }

    /// Rebuilds a `SaleLine` from a persisted row, verifying the stored
    /// `line_total` still matches `quantity * unit_price` rather than
    /// trusting it blindly — the same invariant [`SaleLine::new`] computes,
    /// checked here instead of recomputed, since the database is the
    /// source of truth for a persisted line.
    pub(crate) fn from_persisted(
        variant_sku_snapshot: impl Into<String>,
        variant_name_snapshot: impl Into<String>,
        quantity: Quantity,
        unit_price: Money,
        unit_cost_snapshot: CostAmount,
        line_total: Money,
    ) -> Result<Self, DomainError> {
        let expected = (quantity.value() * unit_price.value()).round_dp(Money::SCALE);
        if expected != line_total.value() {
            return Err(DomainError::LineTotalMismatch);
        }
        let variant_sku_snapshot = variant_sku_snapshot.into();
        let variant_name_snapshot = variant_name_snapshot.into();
        if variant_sku_snapshot.trim().is_empty() || variant_name_snapshot.trim().is_empty() {
            return Err(DomainError::BlankField);
        }
        Ok(Self {
            variant_sku_snapshot,
            variant_name_snapshot,
            quantity,
            unit_price,
            unit_cost_snapshot,
            line_total,
        })
    }

    pub(crate) fn line_total(&self) -> Money {
        self.line_total
    }

    pub(crate) fn quantity(&self) -> Quantity {
        self.quantity
    }

    pub(crate) fn unit_price(&self) -> Money {
        self.unit_price
    }

    pub(crate) fn unit_cost_snapshot(&self) -> CostAmount {
        self.unit_cost_snapshot
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal::Decimal;

    fn money(unscaled: i64, scale: u32) -> Money {
        Money::new_non_negative(Decimal::new(unscaled, scale)).unwrap()
    }

    fn qty(unscaled: i64, scale: u32) -> Quantity {
        Quantity::new_positive(Decimal::new(unscaled, scale)).unwrap()
    }

    fn cost(unscaled: i64, scale: u32) -> CostAmount {
        CostAmount::new_non_negative(Decimal::new(unscaled, scale)).unwrap()
    }

    #[test]
    fn computes_line_total_from_quantity_and_price() {
        // 2.000 * 50.00 = 100.00
        let line = SaleLine::new(
            "SKU-1",
            "Widget",
            qty(2000, 3),
            money(5000, 2),
            cost(4000, 4),
        )
        .unwrap();
        assert_eq!(line.line_total(), money(10000, 2));
    }

    #[test]
    fn from_persisted_accepts_matching_total() {
        let line = SaleLine::from_persisted(
            "SKU-1",
            "Widget",
            qty(2000, 3),
            money(5000, 2),
            cost(4000, 4),
            money(10000, 2),
        );
        assert!(line.is_ok());
    }

    #[test]
    fn from_persisted_rejects_mismatched_total() {
        let line = SaleLine::from_persisted(
            "SKU-1",
            "Widget",
            qty(2000, 3),
            money(5000, 2),
            cost(4000, 4),
            money(99900, 2),
        );
        assert_eq!(line, Err(DomainError::LineTotalMismatch));
    }

    #[test]
    fn rejects_blank_snapshots() {
        let result = SaleLine::new("", "Widget", qty(1000, 3), money(100, 2), cost(50, 4));
        assert_eq!(result, Err(DomainError::BlankField));
    }
}
