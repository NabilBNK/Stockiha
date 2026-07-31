//! S4-002 — production cashier-session lifecycle domain types.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use super::error::DomainError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum CashSessionStatus {
    Open,
    Closing,
    PendingApproval,
    Closed,
    Suspended,
}

impl CashSessionStatus {
    pub(crate) const fn as_db_str(self) -> &'static str {
        match self {
            CashSessionStatus::Open => "OPEN",
            CashSessionStatus::Closing => "CLOSING",
            CashSessionStatus::PendingApproval => "PENDING_APPROVAL",
            CashSessionStatus::Closed => "CLOSED",
            CashSessionStatus::Suspended => "SUSPENDED",
        }
    }

    pub(crate) fn from_db_str(value: &str) -> Result<Self, DomainError> {
        match value {
            "OPEN" => Ok(CashSessionStatus::Open),
            "CLOSING" => Ok(CashSessionStatus::Closing),
            "PENDING_APPROVAL" => Ok(CashSessionStatus::PendingApproval),
            "CLOSED" => Ok(CashSessionStatus::Closed),
            "SUSPENDED" => Ok(CashSessionStatus::Suspended),
            _ => Err(DomainError::UnknownStatus),
        }
    }

    pub(crate) const fn is_immutable(self) -> bool {
        matches!(self, CashSessionStatus::Closed)
    }

    pub(crate) const fn is_cash_operational(self) -> bool {
        matches!(self, CashSessionStatus::Open)
    }
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct CashDenomination {
    pub id: i64,
    pub code: String,
    pub value: String,
    pub display_order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct DenominationCountInput {
    pub denomination_id: i64,
    pub quantity: i64,
}

pub(crate) fn validate_denomination_counts(
    counts: &[DenominationCountInput],
) -> Result<(), DomainError> {
    if counts.is_empty() {
        return Err(DomainError::InvalidValue);
    }

    let mut ids = HashSet::with_capacity(counts.len());
    for count in counts {
        if count.denomination_id <= 0 || count.quantity < 0 || !ids.insert(count.denomination_id) {
            return Err(DomainError::InvalidValue);
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct CashSessionCloseResult {
    pub cash_session_id: i64,
    pub close_attempt_id: i64,
    pub status: String,
    pub expected_amount: String,
    pub counted_amount: String,
    pub variance_amount: String,
    pub requires_manager_approval: bool,
    #[serde(default)]
    pub approved_by_user_id: Option<i64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lifecycle_statuses_round_trip_and_only_closed_is_immutable() {
        let statuses = [
            CashSessionStatus::Open,
            CashSessionStatus::Closing,
            CashSessionStatus::PendingApproval,
            CashSessionStatus::Closed,
            CashSessionStatus::Suspended,
        ];

        for status in statuses {
            assert_eq!(CashSessionStatus::from_db_str(status.as_db_str()), Ok(status));
        }

        assert!(CashSessionStatus::Open.is_cash_operational());
        assert!(!CashSessionStatus::Closing.is_cash_operational());
        assert!(!CashSessionStatus::PendingApproval.is_cash_operational());
        assert!(!CashSessionStatus::Suspended.is_cash_operational());
        assert!(CashSessionStatus::Closed.is_immutable());
        assert!(!CashSessionStatus::Open.is_immutable());
    }

    #[test]
    fn rejects_unknown_status() {
        assert_eq!(
            CashSessionStatus::from_db_str("ABANDONED"),
            Err(DomainError::UnknownStatus)
        );
    }

    #[test]
    fn denomination_counts_require_unique_positive_ids_and_non_negative_quantity() {
        assert!(validate_denomination_counts(&[
            DenominationCountInput { denomination_id: 1, quantity: 3 },
            DenominationCountInput { denomination_id: 2, quantity: 0 },
        ])
        .is_ok());

        assert!(validate_denomination_counts(&[]).is_err());
        assert!(validate_denomination_counts(&[
            DenominationCountInput { denomination_id: 1, quantity: 1 },
            DenominationCountInput { denomination_id: 1, quantity: 2 },
        ])
        .is_err());
        assert!(validate_denomination_counts(&[
            DenominationCountInput { denomination_id: 0, quantity: 1 },
        ])
        .is_err());
        assert!(validate_denomination_counts(&[
            DenominationCountInput { denomination_id: 1, quantity: -1 },
        ])
        .is_err());
    }
}
