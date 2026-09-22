use serde::{Deserialize, Serialize};

pub const VOID_REASONS: [&str; 5] = [
    "CUSTOMER_CHANGED_MIND",
    "WRONG_ITEM",
    "WRONG_PRICE",
    "CASHIER_MISTAKE",
    "OTHER",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoidSlipLine {
    pub name: String,
    pub quantity: String,
    pub unit_price: String,
    pub line_total: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaleVoidResult {
    pub void_document_id: i64,
    pub void_document_number: String,
    pub original_document_id: i64,
    pub original_document_number: Option<String>,
    pub sale_kind: String,
    pub customer_name: Option<String>,
    pub subtotal: String,
    pub discount_amount: String,
    pub total_amount: String,
    pub reason_code: String,
    pub note: Option<String>,
    pub cash_session_id: i64,
    pub journal_document_id: i64,
    pub voided_at: String,
    pub lines: Vec<VoidSlipLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionSaleDto {
    pub document_id: i64,
    pub document_number: Option<String>,
    pub sale_kind: String,
    pub customer_name: Option<String>,
    pub total_amount: String,
    pub status: String,
    pub posted_at: Option<String>,
    pub void_document_number: Option<String>,
}

/// Validates a cancellation request before it reaches the database.
/// The database repeats every check; this only gives an early, clear error.
pub fn validate_void_request(reason_code: &str, note: Option<&str>) -> Result<(), String> {
    if !VOID_REASONS.contains(&reason_code) {
        return Err("unsupported cancellation reason".to_string());
    }
    let trimmed = note.map(str::trim).filter(|value| !value.is_empty());
    if let Some(value) = trimmed {
        if value.chars().count() > 200 {
            return Err("note must be at most 200 characters".to_string());
        }
    }
    if reason_code == "OTHER" && trimmed.is_none() {
        return Err("a description is required for a custom reason".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_valid_reason_is_accepted() {
        for reason in VOID_REASONS {
            if reason == "OTHER" {
                assert!(validate_void_request(reason, Some("x")).is_ok());
            } else {
                assert!(validate_void_request(reason, None).is_ok());
            }
        }
    }

    #[test]
    fn lowercase_reason_is_rejected() {
        assert!(validate_void_request("other", None).is_err());
    }

    #[test]
    fn other_without_a_usable_note_is_rejected() {
        assert!(validate_void_request("OTHER", None).is_err());
        assert!(validate_void_request("OTHER", Some("")).is_err());
        assert!(validate_void_request("OTHER", Some("   ")).is_err());
    }

    #[test]
    fn other_with_a_single_character_note_is_accepted() {
        assert!(validate_void_request("OTHER", Some("x")).is_ok());
    }

    #[test]
    fn a_note_over_two_hundred_characters_is_rejected() {
        let note = "x".repeat(201);
        assert!(validate_void_request("WRONG_ITEM", Some(&note)).is_err());
    }

    #[test]
    fn a_note_of_exactly_two_hundred_characters_is_accepted() {
        let note = "x".repeat(200);
        assert!(validate_void_request("WRONG_ITEM", Some(&note)).is_ok());
    }
}
