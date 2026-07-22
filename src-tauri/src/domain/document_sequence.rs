//! S1-001 — the document-type vocabulary for `core.document_sequences`.
//!
//! Kept as a closed Rust enum for the same reason the DB column has a
//! `CHECK ... IN (...)` constraint: only the document types this slice
//! actually produces exist, scoped to what `core.claim_next_document_number`
//! (see the `20260722121308_core_document_sequences.sql` migration) accepts
//! today. Extending this is a deliberate future migration + enum variant,
//! not a loosened string.

use super::error::DomainError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub(crate) enum DocumentType {
    CashSale,
    JournalEntry,
}

impl DocumentType {
    /// The exact `text` value accepted by
    /// `core.claim_next_document_number` and stored in
    /// `core.document_sequences.document_type`.
    pub(crate) const fn as_db_str(self) -> &'static str {
        match self {
            DocumentType::CashSale => "CASH_SALE",
            DocumentType::JournalEntry => "JOURNAL_ENTRY",
        }
    }

    pub(crate) fn from_db_str(value: &str) -> Result<Self, DomainError> {
        match value {
            "CASH_SALE" => Ok(DocumentType::CashSale),
            "JOURNAL_ENTRY" => Ok(DocumentType::JournalEntry),
            _ => Err(DomainError::UnknownStatus),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_through_db_strings() {
        for doc_type in [DocumentType::CashSale, DocumentType::JournalEntry] {
            let db_str = doc_type.as_db_str();
            assert_eq!(DocumentType::from_db_str(db_str), Ok(doc_type));
        }
    }

    #[test]
    fn rejects_unknown_document_type() {
        assert_eq!(
            DocumentType::from_db_str("PURCHASE_ORDER"),
            Err(DomainError::UnknownStatus)
        );
    }
}
