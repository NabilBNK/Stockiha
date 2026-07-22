//! S1-001 — exact decimal value types for money, quantity, and cost.
//!
//! final-architecture.md section 3.D-ter is explicit: "All monetary and
//! quantity calculations must use exact decimal types (`rust_decimal` or
//! equivalent) — never floating-point." Every type here wraps
//! [`rust_decimal::Decimal`] and is constructed only through a validated
//! function that enforces both sign and the type's fixed scale, matching the
//! corresponding `numeric(p, s)` column and `CHECK` constraint added by the
//! S1-001 migrations.

use rust_decimal::Decimal;

use super::error::DomainError;

/// A monetary amount at 2 decimal places (DZD minor-unit precision), used
/// for sale prices, unit prices, line totals, subtotals, totals, and
/// journal debit/credit values. Matches every `numeric(14, 2)` column added
/// in this slice.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, serde::Serialize, serde::Deserialize,
)]
pub(crate) struct Money(Decimal);

impl Money {
    pub(crate) const SCALE: u32 = 2;

    /// Builds a non-negative `Money` value. Rejects negative amounts and any
    /// value with more than 2 fractional digits.
    pub(crate) fn new_non_negative(value: Decimal) -> Result<Self, DomainError> {
        if value.is_sign_negative() && !value.is_zero() {
            return Err(DomainError::NegativeAmount);
        }
        if value.scale() > Self::SCALE {
            return Err(DomainError::ScaleMismatch);
        }
        Ok(Self(value.round_dp(Self::SCALE)))
    }

    /// Builds a strictly positive `Money` value (e.g. a sale line's unit
    /// price when zero is not a meaningful price).
    pub(crate) fn new_positive(value: Decimal) -> Result<Self, DomainError> {
        if value <= Decimal::ZERO {
            return Err(DomainError::NonPositiveAmount);
        }
        if value.scale() > Self::SCALE {
            return Err(DomainError::ScaleMismatch);
        }
        Ok(Self(value.round_dp(Self::SCALE)))
    }

    pub(crate) const fn zero() -> Self {
        Self(Decimal::ZERO)
    }

    pub(crate) fn value(&self) -> Decimal {
        self.0
    }
}

/// A physical quantity at 3 decimal places, used for stock quantities and
/// sale-line quantities. Matches every `numeric(18, 3)` quantity column.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, serde::Serialize, serde::Deserialize,
)]
pub(crate) struct Quantity(Decimal);

impl Quantity {
    pub(crate) const SCALE: u32 = 3;

    /// Builds a non-negative quantity (e.g. a warehouse balance, which may
    /// legitimately be zero).
    pub(crate) fn new_non_negative(value: Decimal) -> Result<Self, DomainError> {
        if value.is_sign_negative() && !value.is_zero() {
            return Err(DomainError::NegativeAmount);
        }
        if value.scale() > Self::SCALE {
            return Err(DomainError::ScaleMismatch);
        }
        Ok(Self(value.round_dp(Self::SCALE)))
    }

    /// Builds a strictly positive quantity (e.g. a sale line's quantity,
    /// which the S1-001 migration's `sale_lines_quantity_positive` check
    /// forbids from being zero or negative).
    pub(crate) fn new_positive(value: Decimal) -> Result<Self, DomainError> {
        if value <= Decimal::ZERO {
            return Err(DomainError::NonPositiveAmount);
        }
        if value.scale() > Self::SCALE {
            return Err(DomainError::ScaleMismatch);
        }
        Ok(Self(value.round_dp(Self::SCALE)))
    }

    /// A quantity *delta* (stock ledger movements may be negative — an
    /// issue reduces stock). Only the scale is validated; sign is
    /// meaningful and left to the caller.
    pub(crate) fn new_delta(value: Decimal) -> Result<Self, DomainError> {
        if value.scale() > Self::SCALE {
            return Err(DomainError::ScaleMismatch);
        }
        Ok(Self(value.round_dp(Self::SCALE)))
    }

    pub(crate) const fn zero() -> Self {
        Self(Decimal::ZERO)
    }

    pub(crate) fn value(&self) -> Decimal {
        self.0
    }

    pub(crate) fn is_zero(&self) -> bool {
        self.0.is_zero()
    }

    pub(crate) fn is_positive(&self) -> bool {
        self.0 > Decimal::ZERO
    }
}

/// A cost/valuation amount at 4 decimal places, used for warehouse stock
/// `total_value`, stock-ledger `inventory_value_delta`, and a sale line's
/// `unit_cost_snapshot`. Matches every `numeric(18, 4)` column.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, serde::Serialize, serde::Deserialize,
)]
pub(crate) struct CostAmount(Decimal);

impl CostAmount {
    pub(crate) const SCALE: u32 = 4;

    pub(crate) fn new_non_negative(value: Decimal) -> Result<Self, DomainError> {
        if value.is_sign_negative() && !value.is_zero() {
            return Err(DomainError::NegativeAmount);
        }
        if value.scale() > Self::SCALE {
            return Err(DomainError::ScaleMismatch);
        }
        Ok(Self(value.round_dp(Self::SCALE)))
    }

    /// A cost/value *delta* (ledger movements may be negative). Only scale
    /// is validated.
    pub(crate) fn new_delta(value: Decimal) -> Result<Self, DomainError> {
        if value.scale() > Self::SCALE {
            return Err(DomainError::ScaleMismatch);
        }
        Ok(Self(value.round_dp(Self::SCALE)))
    }

    pub(crate) const fn zero() -> Self {
        Self(Decimal::ZERO)
    }

    pub(crate) fn value(&self) -> Decimal {
        self.0
    }

    pub(crate) fn is_zero(&self) -> bool {
        self.0.is_zero()
    }
}

/// A weighted-average-cost rate at 6 decimal places
/// (`inventory.warehouse_stock.last_known_wac`). Kept as its own type,
/// distinct from [`CostAmount`], because architecture section 3.C stores it
/// "separately to prevent rounding residuals from leaving dangling values"
/// — it is a per-unit rate, not a value total, and needs more precision.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, serde::Serialize, serde::Deserialize,
)]
pub(crate) struct WacRate(Decimal);

impl WacRate {
    pub(crate) const SCALE: u32 = 6;

    pub(crate) fn new_non_negative(value: Decimal) -> Result<Self, DomainError> {
        if value.is_sign_negative() && !value.is_zero() {
            return Err(DomainError::NegativeAmount);
        }
        if value.scale() > Self::SCALE {
            return Err(DomainError::ScaleMismatch);
        }
        Ok(Self(value.round_dp(Self::SCALE)))
    }

    pub(crate) const fn zero() -> Self {
        Self(Decimal::ZERO)
    }

    pub(crate) fn value(&self) -> Decimal {
        self.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // No `rust_decimal_macros` dependency is added just for test literals:
    // `Decimal::new(unscaled, scale)` is exact, allocation-free, and already
    // available from the `rust_decimal` dependency this module needs anyway.
    fn d(unscaled: i64, scale: u32) -> Decimal {
        Decimal::new(unscaled, scale)
    }

    #[test]
    fn money_rejects_negative() {
        assert_eq!(
            Money::new_non_negative(d(-1, 2)),
            Err(DomainError::NegativeAmount)
        );
    }

    #[test]
    fn money_rejects_extra_scale() {
        assert_eq!(
            Money::new_non_negative(d(1005, 3)),
            Err(DomainError::ScaleMismatch)
        );
    }

    #[test]
    fn money_accepts_zero_and_exact_scale() {
        assert!(Money::new_non_negative(Decimal::ZERO).is_ok());
        assert_eq!(
            Money::new_non_negative(d(1999, 2)).unwrap().value(),
            d(1999, 2)
        );
    }

    #[test]
    fn money_positive_rejects_zero() {
        assert_eq!(
            Money::new_positive(Decimal::ZERO),
            Err(DomainError::NonPositiveAmount)
        );
    }

    #[test]
    fn quantity_positive_rejects_zero_and_negative() {
        assert_eq!(
            Quantity::new_positive(Decimal::ZERO),
            Err(DomainError::NonPositiveAmount)
        );
        assert_eq!(
            Quantity::new_positive(d(-1, 0)),
            Err(DomainError::NonPositiveAmount)
        );
    }

    #[test]
    fn quantity_delta_allows_negative_but_not_extra_scale() {
        assert!(Quantity::new_delta(d(-55, 1)).is_ok());
        assert_eq!(
            Quantity::new_delta(d(12345, 4)),
            Err(DomainError::ScaleMismatch)
        );
    }

    #[test]
    fn cost_amount_and_wac_reject_negative() {
        assert_eq!(
            CostAmount::new_non_negative(d(-1, 0)),
            Err(DomainError::NegativeAmount)
        );
        assert_eq!(
            WacRate::new_non_negative(d(-1, 0)),
            Err(DomainError::NegativeAmount)
        );
    }

    #[test]
    fn no_floating_point_types_are_used() {
        // This is a compile-time property, not a runtime one: `Money`,
        // `Quantity`, `CostAmount`, and `WacRate` all wrap `Decimal`. If any
        // of them wrapped `f32`/`f64` this test would still compile, so the
        // real guarantee is architectural (reviewed at PR time), but the
        // assertion below at least pins the concrete stored type via a
        // trait that `f32`/`f64` do not implement in the way `Decimal` does
        // here (`rust_decimal::Decimal`).
        let money = Money::new_non_negative(d(123, 2)).unwrap();
        let _: Decimal = money.value();
    }
}
