use rust_decimal::Decimal;

/// Represents a detected inventory residual (sub-centime value at zero quantity).
/// Residuals arise from exact-decimal rounding in WAC calculations.
#[derive(Debug, Clone)]
pub struct InventoryResidual {
    pub warehouse_id: i64,
    pub variant_id: i64,
    /// The detected residual value, always in range [0.0001, 0.0099] DZD.
    pub detected_value: Decimal,
    /// The movement ID that brought the position to zero.
    pub source_movement_id: i64,
}

impl InventoryResidual {
    /// Threshold for "material" residual: >= 0.01 DZD (minimum centime).
    const MATERIAL_THRESHOLD: &'static str = "0.01";

    /// Checks if a remaining inventory value after a posting is a residual
    /// (sub-centime, non-negative, at zero quantity).
    pub fn detect_at_zero_quantity(remaining_value: Decimal) -> Option<Decimal> {
        let threshold = Decimal::from_str_exact(Self::MATERIAL_THRESHOLD)
            .expect("MATERIAL_THRESHOLD is a valid decimal");

        if remaining_value.abs() > Decimal::ZERO && remaining_value.abs() < threshold {
            Some(remaining_value)
        } else {
            None
        }
    }

    /// Checks if a remaining value is a material (unresolvable) discrepancy.
    pub fn is_material_discrepancy(remaining_value: Decimal) -> bool {
        let threshold = Decimal::from_str_exact(Self::MATERIAL_THRESHOLD)
            .expect("MATERIAL_THRESHOLD is a valid decimal");

        remaining_value.abs() >= threshold
    }

    /// Rounds a residual to 2-decimal (centime) precision for journaling.
    pub fn to_journal_amount(residual: Decimal) -> Decimal {
        residual.round_dp(2)
    }
}

/// Result of a residual check during posting.
#[derive(Debug)]
pub enum ResidualCheckResult {
    /// No residual detected, quantity did not reach zero or value is exactly zero.
    NoResidual,
    /// Sub-centime residual detected and will be cleared atomically.
    SubCentimeDetected(Decimal),
    /// Material residual (>= 0.01) that cannot be resolved — posting must fail.
    MaterialDiscrepancy(Decimal),
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    #[test]
    fn test_detect_at_zero_quantity_sub_centime() {
        let val = Decimal::from_str("0.0035").unwrap();
        assert_eq!(InventoryResidual::detect_at_zero_quantity(val), Some(val));

        let neg_val = Decimal::from_str("-0.0035").unwrap();
        assert_eq!(InventoryResidual::detect_at_zero_quantity(neg_val), Some(neg_val));
    }

    #[test]
    fn test_detect_at_zero_quantity_zero_or_material() {
        assert_eq!(InventoryResidual::detect_at_zero_quantity(Decimal::ZERO), None);

        let mat = Decimal::from_str("0.01").unwrap();
        assert_eq!(InventoryResidual::detect_at_zero_quantity(mat), None);

        let mat_large = Decimal::from_str("5.50").unwrap();
        assert_eq!(InventoryResidual::detect_at_zero_quantity(mat_large), None);
    }

    #[test]
    fn test_is_material_discrepancy() {
        assert!(!InventoryResidual::is_material_discrepancy(Decimal::ZERO));
        assert!(!InventoryResidual::is_material_discrepancy(Decimal::from_str("0.0099").unwrap()));
        assert!(InventoryResidual::is_material_discrepancy(Decimal::from_str("0.01").unwrap()));
        assert!(InventoryResidual::is_material_discrepancy(Decimal::from_str("-0.01").unwrap()));
    }

    #[test]
    fn test_to_journal_amount() {
        let sub = Decimal::from_str("0.0035").unwrap();
        assert_eq!(InventoryResidual::to_journal_amount(sub), Decimal::ZERO);

        let mat = Decimal::from_str("0.0150").unwrap();
        assert_eq!(InventoryResidual::to_journal_amount(mat), Decimal::from_str("0.02").unwrap());
    }
}
