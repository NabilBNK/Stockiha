//! Slice 1 MVP batch — `sales.cash_sessions` status
//! (final-architecture.md section 3.E, minimal Slice 1 scope: OPEN/CLOSED
//! only, no blind counts or variance approval workflow yet).

use super::error::DomainError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub(crate) enum CashSessionStatus {
    Open,
    Closed,
}

impl CashSessionStatus {
    pub(crate) const fn as_db_str(self) -> &'static str {
        match self {
            CashSessionStatus::Open => "OPEN",
            CashSessionStatus::Closed => "CLOSED",
        }
    }

    pub(crate) fn from_db_str(value: &str) -> Result<Self, DomainError> {
        match value {
            "OPEN" => Ok(CashSessionStatus::Open),
            "CLOSED" => Ok(CashSessionStatus::Closed),
            _ => Err(DomainError::UnknownStatus),
        }
    }

    /// Mirrors `sales.forbid_closed_cash_session_mutation`: once CLOSED,
    /// the row (and its preserved opening/expected/counted/variance
    /// snapshot) is immutable.
    pub(crate) const fn is_immutable(self) -> bool {
        matches!(self, CashSessionStatus::Closed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_and_immutability_matches_architecture() {
        assert!(!CashSessionStatus::Open.is_immutable());
        assert!(CashSessionStatus::Closed.is_immutable());
        for status in [CashSessionStatus::Open, CashSessionStatus::Closed] {
            assert_eq!(
                CashSessionStatus::from_db_str(status.as_db_str()),
                Ok(status)
            );
        }
    }

    #[test]
    fn rejects_unknown_status() {
        assert_eq!(
            CashSessionStatus::from_db_str("SUSPENDED"),
            Err(DomainError::UnknownStatus)
        );
    }
}
