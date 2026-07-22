//! S1-001 — fiscal period status and the `FiscalPeriod` value type
//! (final-architecture.md section 3.D-bis).
//!
//! The period-closing *workflow* (soft-close, hard-close, authorized
//! reopening with a recorded reason) is out of scope for this slice; this
//! module only models the fixed state vocabulary and the structural
//! invariant (`ends_on >= starts_on`) the S1-001 migration also enforces via
//! `fiscal_periods_valid_range`.

use time::Date;

use super::error::DomainError;

/// Mirrors the `core.fiscal_periods.status` `CHECK` constraint exactly.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub(crate) enum FiscalPeriodStatus {
    Open,
    SoftClosed,
    HardClosed,
}

impl FiscalPeriodStatus {
    /// The exact `text` value stored in `core.fiscal_periods.status`.
    pub(crate) const fn as_db_str(self) -> &'static str {
        match self {
            FiscalPeriodStatus::Open => "OPEN",
            FiscalPeriodStatus::SoftClosed => "SOFT_CLOSED",
            FiscalPeriodStatus::HardClosed => "HARD_CLOSED",
        }
    }

    pub(crate) fn from_db_str(value: &str) -> Result<Self, DomainError> {
        match value {
            "OPEN" => Ok(FiscalPeriodStatus::Open),
            "SOFT_CLOSED" => Ok(FiscalPeriodStatus::SoftClosed),
            "HARD_CLOSED" => Ok(FiscalPeriodStatus::HardClosed),
            _ => Err(DomainError::UnknownStatus),
        }
    }

    /// Whether normal posting is allowed in a period with this status.
    /// Foundation only: no posting function exists yet in S1-001 to call
    /// this, but the rule ("OPEN: normal posting allowed") is architecture
    /// vocabulary, not a guess, so it is captured here rather than left
    /// implicit.
    pub(crate) const fn allows_posting(self) -> bool {
        matches!(self, FiscalPeriodStatus::Open)
    }
}

/// A validated fiscal period. Construction enforces the same structural
/// invariant as the `fiscal_periods_valid_range` database check; the
/// non-overlap invariant (`fiscal_periods_no_overlap`) is set-based across
/// existing rows and can only be enforced by the database, not by this
/// single-value constructor.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct FiscalPeriod {
    period_code: String,
    starts_on: Date,
    ends_on: Date,
    status: FiscalPeriodStatus,
}

impl FiscalPeriod {
    pub(crate) fn new(
        period_code: impl Into<String>,
        starts_on: Date,
        ends_on: Date,
        status: FiscalPeriodStatus,
    ) -> Result<Self, DomainError> {
        let period_code = period_code.into();
        if period_code.trim().is_empty() {
            return Err(DomainError::BlankField);
        }
        if ends_on < starts_on {
            return Err(DomainError::InvalidDateRange);
        }
        Ok(Self {
            period_code,
            starts_on,
            ends_on,
            status,
        })
    }

    pub(crate) fn period_code(&self) -> &str {
        &self.period_code
    }

    pub(crate) fn starts_on(&self) -> Date {
        self.starts_on
    }

    pub(crate) fn ends_on(&self) -> Date {
        self.ends_on
    }

    pub(crate) fn status(&self) -> FiscalPeriodStatus {
        self.status
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::Month;

    // No `time` "macros" feature is enabled crate-wide, so test dates are
    // built via the always-available `Date::from_calendar_date` rather than
    // the `date!` macro.
    fn d(year: i32, month: Month, day: u8) -> Date {
        Date::from_calendar_date(year, month, day).unwrap()
    }

    #[test]
    fn status_round_trips_through_db_strings() {
        for status in [
            FiscalPeriodStatus::Open,
            FiscalPeriodStatus::SoftClosed,
            FiscalPeriodStatus::HardClosed,
        ] {
            let db_str = status.as_db_str();
            assert_eq!(FiscalPeriodStatus::from_db_str(db_str), Ok(status));
        }
    }

    #[test]
    fn unknown_status_string_is_rejected() {
        assert_eq!(
            FiscalPeriodStatus::from_db_str("CLOSED_FOREVER"),
            Err(DomainError::UnknownStatus)
        );
    }

    #[test]
    fn only_open_allows_posting() {
        assert!(FiscalPeriodStatus::Open.allows_posting());
        assert!(!FiscalPeriodStatus::SoftClosed.allows_posting());
        assert!(!FiscalPeriodStatus::HardClosed.allows_posting());
    }

    #[test]
    fn rejects_end_before_start() {
        let result = FiscalPeriod::new(
            "2026-01",
            d(2026, Month::January, 31),
            d(2026, Month::January, 1),
            FiscalPeriodStatus::Open,
        );
        assert_eq!(result, Err(DomainError::InvalidDateRange));
    }

    #[test]
    fn rejects_blank_period_code() {
        let result = FiscalPeriod::new(
            "   ",
            d(2026, Month::January, 1),
            d(2026, Month::January, 31),
            FiscalPeriodStatus::Open,
        );
        assert_eq!(result, Err(DomainError::BlankField));
    }

    #[test]
    fn accepts_valid_period() {
        let period = FiscalPeriod::new(
            "2026-01",
            d(2026, Month::January, 1),
            d(2026, Month::January, 31),
            FiscalPeriodStatus::Open,
        )
        .unwrap();
        assert_eq!(period.period_code(), "2026-01");
    }
}
