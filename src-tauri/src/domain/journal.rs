//! S1-001 (corrected) — the `JournalLine` value type
//! (final-architecture.md section 3.D).
//!
//! Correction from the first pass: `JournalEntryStatus` moved to
//! [`super::business_document::BusinessDocumentStatus`] — `finance.
//! journal_entries` no longer has its own `status` column, since it is now
//! a thin subtype of `core.business_documents`. This module only captures
//! the single-line invariant the `journal_lines_exactly_one_side` database
//! check also enforces — the cross-line balance/line-count invariants are
//! enforced by the deferred constraint trigger added in the same migration,
//! not by this Rust type, since they are inherently properties of a set of
//! lines, not of one line in isolation.

use super::error::DomainError;
use super::money::Money;

/// A single journal line. Construction enforces exactly the same rule as
/// the `journal_lines_exactly_one_side` database check: debit and credit
/// are each non-negative, and exactly one of the two is positive.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct JournalLine {
    account_code: String,
    debit: Money,
    credit: Money,
}

impl JournalLine {
    pub(crate) fn new_debit(
        account_code: impl Into<String>,
        amount: Money,
    ) -> Result<Self, DomainError> {
        Self::new(account_code, amount, Money::zero())
    }

    pub(crate) fn new_credit(
        account_code: impl Into<String>,
        amount: Money,
    ) -> Result<Self, DomainError> {
        Self::new(account_code, Money::zero(), amount)
    }

    fn new(
        account_code: impl Into<String>,
        debit: Money,
        credit: Money,
    ) -> Result<Self, DomainError> {
        let account_code = account_code.into();
        if account_code.trim().is_empty() {
            return Err(DomainError::BlankField);
        }
        let debit_positive = debit.value() > rust_decimal::Decimal::ZERO;
        let credit_positive = credit.value() > rust_decimal::Decimal::ZERO;
        if debit_positive == credit_positive {
            // Either both positive (not allowed) or neither positive (also
            // not allowed) — exactly one side must be positive.
            return Err(DomainError::JournalLineNotExactlyOneSide);
        }
        Ok(Self {
            account_code,
            debit,
            credit,
        })
    }

    pub(crate) fn account_code(&self) -> &str {
        &self.account_code
    }

    pub(crate) fn debit(&self) -> Money {
        self.debit
    }

    pub(crate) fn credit(&self) -> Money {
        self.credit
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal::Decimal;

    fn money(unscaled: i64, scale: u32) -> Money {
        Money::new_non_negative(Decimal::new(unscaled, scale)).unwrap()
    }

    #[test]
    fn debit_line_is_valid() {
        let line = JournalLine::new_debit("CASH", money(10000, 2)).unwrap();
        assert_eq!(line.debit(), money(10000, 2));
        assert_eq!(line.credit(), Money::zero());
    }

    #[test]
    fn credit_line_is_valid() {
        let line = JournalLine::new_credit("SALES_REVENUE", money(10000, 2)).unwrap();
        assert_eq!(line.credit(), money(10000, 2));
        assert_eq!(line.debit(), Money::zero());
    }

    #[test]
    fn both_sides_positive_is_rejected() {
        let result = JournalLine::new("CASH", money(100, 2), money(100, 2));
        assert_eq!(result, Err(DomainError::JournalLineNotExactlyOneSide));
    }

    #[test]
    fn neither_side_positive_is_rejected() {
        let result = JournalLine::new("CASH", Money::zero(), Money::zero());
        assert_eq!(result, Err(DomainError::JournalLineNotExactlyOneSide));
    }

    #[test]
    fn blank_account_code_is_rejected() {
        let result = JournalLine::new_debit("", money(100, 2));
        assert_eq!(result, Err(DomainError::BlankField));
    }
}
