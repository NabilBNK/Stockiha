//! S1-001 — the stock movement vocabulary and the zero-quantity/value
//! invariant (final-architecture.md section 3.C).
//!
//! No `WarehouseStock`/`StockLedger` row-mutation logic lives here: the
//! authoritative posting function that appends a ledger row and updates the
//! cached balance atomically is future work (Slice 2's
//! `inventory.confirm_stock_adjustment` and beyond). This module only
//! captures the fixed movement-type vocabulary and the one structural
//! invariant simple enough to validate on a single (quantity, value) pair
//! before it ever reaches the database.

use super::error::DomainError;
use super::money::{CostAmount, Quantity};

/// Mirrors `inventory.stock_ledger.movement_type` exactly.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub(crate) enum StockMovementType {
    Receipt,
    Issue,
    Adjustment,
    CostOnly,
}

impl StockMovementType {
    pub(crate) const fn as_db_str(self) -> &'static str {
        match self {
            StockMovementType::Receipt => "RECEIPT",
            StockMovementType::Issue => "ISSUE",
            StockMovementType::Adjustment => "ADJUSTMENT",
            StockMovementType::CostOnly => "COST_ONLY",
        }
    }

    pub(crate) fn from_db_str(value: &str) -> Result<Self, DomainError> {
        match value {
            "RECEIPT" => Ok(StockMovementType::Receipt),
            "ISSUE" => Ok(StockMovementType::Issue),
            "ADJUSTMENT" => Ok(StockMovementType::Adjustment),
            "COST_ONLY" => Ok(StockMovementType::CostOnly),
            _ => Err(DomainError::UnknownStatus),
        }
    }
}

/// Validates the zero-quantity safeguard from architecture section 3.C:
/// "When the physical quantity reaches exactly zero, `quantity_on_hand` and
/// `total_value` are set to `0`" — i.e. a positive value may never coexist
/// with zero quantity. Mirrors the
/// `warehouse_stock_zero_quantity_zero_value` /
/// `stock_ledger_zero_quantity_zero_value` database checks exactly.
pub(crate) fn validate_zero_quantity_invariant(
    quantity_on_hand: Quantity,
    total_value: CostAmount,
) -> Result<(), DomainError> {
    if quantity_on_hand.is_zero() && !total_value.is_zero() {
        return Err(DomainError::NegativeAmount);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal::Decimal;

    #[test]
    fn round_trips_through_db_strings() {
        for movement in [
            StockMovementType::Receipt,
            StockMovementType::Issue,
            StockMovementType::Adjustment,
            StockMovementType::CostOnly,
        ] {
            assert_eq!(
                StockMovementType::from_db_str(movement.as_db_str()),
                Ok(movement)
            );
        }
    }

    #[test]
    fn zero_quantity_with_positive_value_is_rejected() {
        let zero_qty = Quantity::new_non_negative(Decimal::ZERO).unwrap();
        let positive_value = CostAmount::new_non_negative(Decimal::new(500, 2)).unwrap();
        assert!(validate_zero_quantity_invariant(zero_qty, positive_value).is_err());
    }

    #[test]
    fn zero_quantity_with_zero_value_is_valid() {
        let zero_qty = Quantity::new_non_negative(Decimal::ZERO).unwrap();
        let zero_value = CostAmount::zero();
        assert!(validate_zero_quantity_invariant(zero_qty, zero_value).is_ok());
    }

    #[test]
    fn positive_quantity_with_any_value_is_valid() {
        let qty = Quantity::new_positive(Decimal::new(10, 0)).unwrap();
        let value = CostAmount::new_non_negative(Decimal::new(500, 2)).unwrap();
        assert!(validate_zero_quantity_invariant(qty, value).is_ok());
    }
}
