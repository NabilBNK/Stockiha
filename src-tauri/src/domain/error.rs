//! S1-001 — domain validation errors.
//!
//! Every domain value type is built through a validated constructor that
//! rejects the same invalid states the S1-001 migrations reject at the
//! database layer (non-negative amounts, exact scale, non-blank identifiers,
//! exactly-one-side journal lines, ...). Catching these in Rust first is a
//! fast-fail convenience; the database CHECK constraints remain the
//! authoritative, final gate — this type never claims to replace them.
//!
//! Carries no reference to the invalid value itself: messages are fixed,
//! descriptive, and safe to log (no risk of ever leaking a secret, since
//! nothing here handles credentials).

use core::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DomainError {
    /// A text field required to be non-blank was empty or all whitespace.
    BlankField,
    /// A monetary/quantity/cost value that must be non-negative was negative.
    NegativeAmount,
    /// A monetary/quantity/cost value that must be strictly positive was
    /// zero or negative.
    NonPositiveAmount,
    /// A decimal value carried more fractional digits than its domain type's
    /// fixed scale allows (e.g. a `Money` value with 3 decimal places).
    ScaleMismatch,
    /// A typed identifier was constructed from a non-positive raw value.
    InvalidIdentifier,
    /// A date range was invalid (end before start).
    InvalidDateRange,
    /// A journal line did not have exactly one of debit/credit positive.
    JournalLineNotExactlyOneSide,
    /// A sale line's stored total did not match quantity × unit price
    /// (rounded to two decimal places).
    LineTotalMismatch,
    /// A fiscal period / document status string was not one of the fixed,
    /// closed set of values the database CHECK constraint allows.
    UnknownStatus,
}

impl fmt::Display for DomainError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let text = match self {
            DomainError::BlankField => "field must not be blank",
            DomainError::NegativeAmount => "value must not be negative",
            DomainError::NonPositiveAmount => "value must be strictly positive",
            DomainError::ScaleMismatch => "value has more decimal places than allowed",
            DomainError::InvalidIdentifier => "identifier must be a positive integer",
            DomainError::InvalidDateRange => "end date must not be before start date",
            DomainError::JournalLineNotExactlyOneSide => {
                "journal line must have exactly one of debit or credit positive"
            }
            DomainError::LineTotalMismatch => {
                "line total must equal quantity multiplied by unit price, rounded to 2 decimals"
            }
            DomainError::UnknownStatus => "status is not one of the fixed allowed values",
        };
        f.write_str(text)
    }
}

impl std::error::Error for DomainError {}
