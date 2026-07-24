//! S2-001 — Catalog domain logic: normalization helpers, conversion arithmetic,
//! and validation constructors for variant-catalog operations.

use rust_decimal::Decimal;

use super::error::DomainError;

// ---------------------------------------------------------------------------
// String normalization helpers
// ---------------------------------------------------------------------------

/// Uppercase + trim a barcode.  Returns the normalised string.
pub(crate) fn normalize_barcode(raw: &str) -> String {
    raw.trim().to_uppercase()
}

/// Uppercase + trim a unit code or similar short code.
pub(crate) fn normalize_code(raw: &str) -> String {
    raw.trim().to_uppercase()
}

/// Return `Err(DomainError::BlankField)` if the trimmed string is empty.
pub(crate) fn require_non_blank(value: &str, _field: &str) -> Result<(), DomainError> {
    if value.trim().is_empty() {
        Err(DomainError::BlankField)
    } else {
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Conversion-factor arithmetic
// ---------------------------------------------------------------------------

/// Validate that a conversion factor is strictly positive.
pub(crate) fn validate_positive_factor(factor: Decimal) -> Result<(), DomainError> {
    if factor <= Decimal::ZERO {
        Err(DomainError::NonPositiveAmount)
    } else {
        Ok(())
    }
}

/// Compute the base quantity: `entered * factor` using exact Decimal arithmetic.
/// `factor` must be strictly positive; this function validates internally.
pub(crate) fn base_quantity(entered: Decimal, factor: Decimal) -> Result<Decimal, DomainError> {
    validate_positive_factor(factor)?;
    Ok(entered * factor)
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    fn d(s: &str) -> Decimal {
        Decimal::from_str(s).unwrap()
    }

    // -- blank-rejection -------------------------------------------------------

    #[test]
    fn blank_sku_rejected() {
        assert_eq!(require_non_blank("", "sku"), Err(DomainError::BlankField));
        assert_eq!(
            require_non_blank("   ", "sku"),
            Err(DomainError::BlankField)
        );
    }

    #[test]
    fn blank_barcode_rejected() {
        assert_eq!(
            require_non_blank("", "barcode"),
            Err(DomainError::BlankField)
        );
        assert_eq!(
            require_non_blank("\t\n", "barcode"),
            Err(DomainError::BlankField)
        );
    }

    #[test]
    fn non_blank_sku_accepted() {
        assert!(require_non_blank("SKU-001", "sku").is_ok());
    }

    // -- normalization ---------------------------------------------------------

    #[test]
    fn barcode_normalization_uppercases_and_trims() {
        assert_eq!(normalize_barcode("  abc123  "), "ABC123");
        assert_eq!(normalize_barcode("EAN-13"), "EAN-13");
    }

    #[test]
    fn code_normalization_uppercases_and_trims() {
        assert_eq!(normalize_code("  kg  "), "KG");
        assert_eq!(normalize_code("PCS"), "PCS");
    }

    // -- base_quantity conversions ---------------------------------------------

    #[test]
    fn base_quantity_integer_case() {
        // 5 boxes * 12 units/box = 60 units
        let result = base_quantity(d("5"), d("12")).unwrap();
        assert_eq!(result, d("60"));
    }

    #[test]
    fn base_quantity_exact_fractional() {
        // 2 * 0.001 = 0.002  (exact, no floating-point drift)
        let result = base_quantity(d("2"), d("0.001")).unwrap();
        assert_eq!(result, d("0.002"));
    }

    #[test]
    fn base_quantity_factor_zero_rejected() {
        assert_eq!(
            base_quantity(d("5"), Decimal::ZERO),
            Err(DomainError::NonPositiveAmount)
        );
    }

    #[test]
    fn base_quantity_negative_factor_rejected() {
        assert_eq!(
            base_quantity(d("5"), d("-1")),
            Err(DomainError::NonPositiveAmount)
        );
    }

    #[test]
    fn validate_positive_factor_rejects_zero() {
        assert_eq!(
            validate_positive_factor(Decimal::ZERO),
            Err(DomainError::NonPositiveAmount)
        );
    }

    #[test]
    fn validate_positive_factor_rejects_negative() {
        assert_eq!(
            validate_positive_factor(d("-0.5")),
            Err(DomainError::NonPositiveAmount)
        );
    }

    #[test]
    fn validate_positive_factor_accepts_positive() {
        assert!(validate_positive_factor(d("0.001")).is_ok());
    }

    // -- decimal parse/serialize round-trip -----------------------------------

    #[test]
    fn decimal_parse_serialize_round_trip_preserves_scale() {
        // "10.00" must round-trip to "10.00", not "10" or "10.0"
        let val = d("10.00");
        assert_eq!(val.to_string(), "10.00");
    }

    #[test]
    fn decimal_parse_serialize_round_trip_no_trailing_zero_collapse() {
        // rust_decimal preserves the scale from the parsed string
        let val = d("10.00");
        // Confirm it isn't collapsed to "10"
        assert_ne!(val.to_string(), "10");
    }
}
