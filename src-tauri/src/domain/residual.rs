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

        if remaining_value > Decimal::ZERO && remaining_value < threshold {
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
