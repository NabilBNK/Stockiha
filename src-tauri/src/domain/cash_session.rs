//! S4-002 Advanced Cash Sessions domain types and status state-machine

use super::error::DomainError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum CashSessionStatus {
    Open,
    Suspended,
    PendingApproval,
    Closed,
}

impl CashSessionStatus {
    pub(crate) const fn as_db_str(self) -> &'static str {
        match self {
            CashSessionStatus::Open => "OPEN",
            CashSessionStatus::Suspended => "SUSPENDED",
            CashSessionStatus::PendingApproval => "PENDING_APPROVAL",
            CashSessionStatus::Closed => "CLOSED",
        }
    }

    pub(crate) fn from_db_str(value: &str) -> Result<Self, DomainError> {
        match value {
            "OPEN" => Ok(CashSessionStatus::Open),
            "SUSPENDED" => Ok(CashSessionStatus::Suspended),
            "PENDING_APPROVAL" => Ok(CashSessionStatus::PendingApproval),
            "CLOSED" => Ok(CashSessionStatus::Closed),
            _ => Err(DomainError::UnknownStatus),
        }
    }

    pub(crate) const fn is_immutable(self) -> bool {
        matches!(self, CashSessionStatus::Closed)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DenominationInput {
    pub denomination: String,
    pub bill_count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubmitClosingPayload {
    pub cash_session_id: i64,
    pub denominations: Vec<DenominationInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingVarianceSessionDto {
    pub id: i64,
    pub warehouse_id: i64,
    pub workstation_id: String,
    pub opened_by_user_id: i64,
    pub opened_by_name: String,
    pub closed_by_user_id: Option<i64>,
    pub closed_by_name: Option<String>,
    pub status: String,
    pub opening_float: String,
    pub expected_amount: String,
    pub counted_amount: String,
    pub variance_amount: String,
    pub opened_at: String,
    pub closed_at: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_and_immutability_matches_architecture() {
        assert!(!CashSessionStatus::Open.is_immutable());
        assert!(!CashSessionStatus::Suspended.is_immutable());
        assert!(!CashSessionStatus::PendingApproval.is_immutable());
        assert!(CashSessionStatus::Closed.is_immutable());
        for status in [
            CashSessionStatus::Open,
            CashSessionStatus::Suspended,
            CashSessionStatus::PendingApproval,
            CashSessionStatus::Closed,
        ] {
            assert_eq!(
                CashSessionStatus::from_db_str(status.as_db_str()),
                Ok(status)
            );
        }
    }

    #[test]
    fn rejects_unknown_status() {
        assert_eq!(
            CashSessionStatus::from_db_str("UNKNOWN_STATUS"),
            Err(DomainError::UnknownStatus)
        );
    }
}
