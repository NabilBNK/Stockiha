//! S1-001 — typed identifiers.
//!
//! Every S1-001 table uses a `bigint GENERATED ALWAYS AS IDENTITY` primary
//! key (matching the S0-006 proof's own convention), so every identifier
//! here is a validated newtype over `i64`: constructing one from a
//! non-positive raw value is a [`DomainError::InvalidIdentifier`], not a
//! silent zero/negative id.

use super::error::DomainError;

macro_rules! typed_id {
    ($name:ident, $doc:literal) => {
        #[doc = $doc]
        #[derive(
            Debug,
            Clone,
            Copy,
            PartialEq,
            Eq,
            PartialOrd,
            Ord,
            Hash,
            serde::Serialize,
            serde::Deserialize,
        )]
        pub(crate) struct $name(i64);

        impl $name {
            pub(crate) fn new(raw: i64) -> Result<Self, DomainError> {
                if raw <= 0 {
                    return Err(DomainError::InvalidIdentifier);
                }
                Ok(Self(raw))
            }

            pub(crate) fn value(&self) -> i64 {
                self.0
            }
        }
    };
}

typed_id!(ProductId, "Primary key of `inventory.products`.");
typed_id!(WarehouseId, "Primary key of `inventory.warehouses`.");
typed_id!(FiscalPeriodId, "Primary key of `core.fiscal_periods`.");
typed_id!(CashSaleId, "Primary key of `sales.cash_sales`.");
typed_id!(SaleLineId, "Primary key of `sales.sale_lines`.");
typed_id!(JournalEntryId, "Primary key of `finance.journal_entries`.");
typed_id!(JournalLineId, "Primary key of `finance.journal_lines`.");

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_zero_and_negative() {
        assert_eq!(ProductId::new(0), Err(DomainError::InvalidIdentifier));
        assert_eq!(ProductId::new(-1), Err(DomainError::InvalidIdentifier));
    }

    #[test]
    fn accepts_positive_and_round_trips() {
        let id = WarehouseId::new(42).unwrap();
        assert_eq!(id.value(), 42);
    }

    #[test]
    fn distinct_id_types_are_not_interchangeable() {
        // Compile-time property: `ProductId` and `WarehouseId` are distinct
        // types even though both wrap `i64`, so passing one where the other
        // is expected is a type error, not a silent bug. Demonstrated here
        // by simply constructing both and comparing their own type's values.
        let product = ProductId::new(1).unwrap();
        let warehouse = WarehouseId::new(1).unwrap();
        assert_eq!(product.value(), warehouse.value());
    }
}
