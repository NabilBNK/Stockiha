//! S1-001 (corrected) — the shared business-document header status and
//! value type (`core.business_documents`).
//!
//! Correction from the first pass: there used to be two parallel status
//! enums (`CashSaleStatus`: Draft/Confirmed, `JournalEntryStatus`:
//! Draft/Posted/Reversed) because each subtype table carried its own status
//! column. Now that `sales.cash_sales` and `finance.journal_entries` are
//! thin subtypes keyed by `document_id`, status lives exclusively on
//! `core.business_documents`, and there is exactly one shared vocabulary —
//! `BusinessDocumentStatus` — for every document type in this slice.

use time::Date;

use super::document_sequence::DocumentType;
use super::error::DomainError;
use super::identifiers::{BusinessDocumentId, FiscalPeriodId};

/// Mirrors `core.business_documents.status` exactly.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub(crate) enum BusinessDocumentStatus {
    Draft,
    Posted,
    Reversed,
}

impl BusinessDocumentStatus {
    pub(crate) const fn as_db_str(self) -> &'static str {
        match self {
            BusinessDocumentStatus::Draft => "DRAFT",
            BusinessDocumentStatus::Posted => "POSTED",
            BusinessDocumentStatus::Reversed => "REVERSED",
        }
    }

    pub(crate) fn from_db_str(value: &str) -> Result<Self, DomainError> {
        match value {
            "DRAFT" => Ok(BusinessDocumentStatus::Draft),
            "POSTED" => Ok(BusinessDocumentStatus::Posted),
            "REVERSED" => Ok(BusinessDocumentStatus::Reversed),
            _ => Err(DomainError::UnknownStatus),
        }
    }

    /// Mirrors `core.forbid_business_document_mutation` /
    /// `sales.forbid_posted_cash_sale_mutation` /
    /// `finance.forbid_posted_journal_entry_mutation`: once POSTED or
    /// REVERSED, ordinary mutation is blocked (the header has exactly one
    /// controlled exception beyond this — see [`Self::can_reverse`] — but
    /// the subtype tables have none at all).
    pub(crate) const fn is_immutable(self) -> bool {
        matches!(
            self,
            BusinessDocumentStatus::Posted | BusinessDocumentStatus::Reversed
        )
    }

    /// Whether `self -> REVERSED` is the one controlled transition the
    /// database's `core.forbid_business_document_mutation` trigger allows
    /// on `core.business_documents` (and only there — never on the subtype
    /// tables). Exposed so callers can fail fast in Rust before attempting
    /// a doomed UPDATE.
    pub(crate) const fn can_reverse(self) -> bool {
        matches!(self, BusinessDocumentStatus::Posted)
    }
}

/// The shared business-document header. Construction enforces the same
/// invariant as `business_documents_number_set_iff_posted`: a DRAFT
/// document has no sequence number or document number; a POSTED/REVERSED
/// document has both.
///
/// The `business_documents_reversal_not_self` invariant ("reversal cannot
/// reference itself") is intentionally NOT re-validated here: it compares
/// `reverses_document_id` against the row's own `id`, which does not exist
/// yet for a value not yet persisted (`id` is a `GENERATED ALWAYS AS
/// IDENTITY` column assigned at insert time) — the database remains the
/// only place that check can actually run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct BusinessDocument {
    document_type: DocumentType,
    status: BusinessDocumentStatus,
    document_date: Date,
    fiscal_period_id: FiscalPeriodId,
    fiscal_year: i32,
    sequence_number: Option<i64>,
    document_number: Option<String>,
    reverses_document_id: Option<BusinessDocumentId>,
}

impl BusinessDocument {
    pub(crate) fn new(
        document_type: DocumentType,
        status: BusinessDocumentStatus,
        document_date: Date,
        fiscal_period_id: FiscalPeriodId,
        fiscal_year: i32,
        sequence_number: Option<i64>,
        document_number: Option<String>,
        reverses_document_id: Option<BusinessDocumentId>,
    ) -> Result<Self, DomainError> {
        let number_fields_present = sequence_number.is_some() && document_number.is_some();
        let number_fields_absent = sequence_number.is_none() && document_number.is_none();

        match status {
            BusinessDocumentStatus::Draft if !number_fields_absent => {
                return Err(DomainError::UnknownStatus);
            }
            BusinessDocumentStatus::Posted | BusinessDocumentStatus::Reversed
                if !number_fields_present =>
            {
                return Err(DomainError::UnknownStatus);
            }
            _ => {}
        }

        if let Some(number) = &document_number {
            if number.trim().is_empty() {
                return Err(DomainError::BlankField);
            }
        }

        Ok(Self {
            document_type,
            status,
            document_date,
            fiscal_period_id,
            fiscal_year,
            sequence_number,
            document_number,
            reverses_document_id,
        })
    }

    pub(crate) fn document_type(&self) -> DocumentType {
        self.document_type
    }

    pub(crate) fn status(&self) -> BusinessDocumentStatus {
        self.status
    }

    pub(crate) fn fiscal_period_id(&self) -> FiscalPeriodId {
        self.fiscal_period_id
    }

    pub(crate) fn document_number(&self) -> Option<&str> {
        self.document_number.as_deref()
    }

    pub(crate) fn reverses_document_id(&self) -> Option<BusinessDocumentId> {
        self.reverses_document_id
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::Month;

    fn d(year: i32, month: Month, day: u8) -> Date {
        Date::from_calendar_date(year, month, day).unwrap()
    }

    #[test]
    fn status_round_trips_and_immutability_matches_architecture() {
        assert!(!BusinessDocumentStatus::Draft.is_immutable());
        assert!(BusinessDocumentStatus::Posted.is_immutable());
        assert!(BusinessDocumentStatus::Reversed.is_immutable());
        assert!(BusinessDocumentStatus::Posted.can_reverse());
        assert!(!BusinessDocumentStatus::Draft.can_reverse());
        assert!(!BusinessDocumentStatus::Reversed.can_reverse());
        for status in [
            BusinessDocumentStatus::Draft,
            BusinessDocumentStatus::Posted,
            BusinessDocumentStatus::Reversed,
        ] {
            assert_eq!(
                BusinessDocumentStatus::from_db_str(status.as_db_str()),
                Ok(status)
            );
        }
    }

    #[test]
    fn draft_with_a_number_is_rejected() {
        let result = BusinessDocument::new(
            DocumentType::CashSale,
            BusinessDocumentStatus::Draft,
            d(2026, Month::January, 15),
            FiscalPeriodId::new(1).unwrap(),
            2026,
            Some(1),
            Some("VC-2026-00001".to_string()),
            None,
        );
        assert!(result.is_err());
    }

    #[test]
    fn posted_without_a_number_is_rejected() {
        let result = BusinessDocument::new(
            DocumentType::CashSale,
            BusinessDocumentStatus::Posted,
            d(2026, Month::January, 15),
            FiscalPeriodId::new(1).unwrap(),
            2026,
            None,
            None,
            None,
        );
        assert!(result.is_err());
    }

    #[test]
    fn draft_without_a_number_is_accepted() {
        let doc = BusinessDocument::new(
            DocumentType::JournalEntry,
            BusinessDocumentStatus::Draft,
            d(2026, Month::January, 15),
            FiscalPeriodId::new(1).unwrap(),
            2026,
            None,
            None,
            None,
        )
        .unwrap();
        assert_eq!(doc.status(), BusinessDocumentStatus::Draft);
        assert_eq!(doc.document_number(), None);
    }

    #[test]
    fn posted_with_a_number_is_accepted() {
        let doc = BusinessDocument::new(
            DocumentType::JournalEntry,
            BusinessDocumentStatus::Posted,
            d(2026, Month::January, 15),
            FiscalPeriodId::new(1).unwrap(),
            2026,
            Some(1),
            Some("JE-2026-00001".to_string()),
            None,
        )
        .unwrap();
        assert_eq!(doc.document_number(), Some("JE-2026-00001"));
    }

    #[test]
    fn reversal_document_carries_its_target() {
        let original = BusinessDocumentId::new(8).unwrap();
        let doc = BusinessDocument::new(
            DocumentType::JournalEntry,
            BusinessDocumentStatus::Posted,
            d(2026, Month::January, 16),
            FiscalPeriodId::new(1).unwrap(),
            2026,
            Some(2),
            Some("JE-2026-00002".to_string()),
            Some(original),
        )
        .unwrap();
        assert_eq!(doc.reverses_document_id(), Some(original));
    }
}
