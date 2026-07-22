//! Slice 1 MVP batch — the three durable job-queue status vocabularies
//! (final-architecture.md section 5), each mirroring its migration's
//! `CHECK` constraint exactly.

use super::error::DomainError;

/// Mirrors `documents.generation_jobs.status`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub(crate) enum GenerationJobStatus {
    Pending,
    Claimed,
    Generating,
    Completed,
    RetryableFailure,
    PermanentFailure,
}

impl GenerationJobStatus {
    pub(crate) const fn as_db_str(self) -> &'static str {
        match self {
            GenerationJobStatus::Pending => "PENDING",
            GenerationJobStatus::Claimed => "CLAIMED",
            GenerationJobStatus::Generating => "GENERATING",
            GenerationJobStatus::Completed => "COMPLETED",
            GenerationJobStatus::RetryableFailure => "RETRYABLE_FAILURE",
            GenerationJobStatus::PermanentFailure => "PERMANENT_FAILURE",
        }
    }

    pub(crate) fn from_db_str(value: &str) -> Result<Self, DomainError> {
        match value {
            "PENDING" => Ok(GenerationJobStatus::Pending),
            "CLAIMED" => Ok(GenerationJobStatus::Claimed),
            "GENERATING" => Ok(GenerationJobStatus::Generating),
            "COMPLETED" => Ok(GenerationJobStatus::Completed),
            "RETRYABLE_FAILURE" => Ok(GenerationJobStatus::RetryableFailure),
            "PERMANENT_FAILURE" => Ok(GenerationJobStatus::PermanentFailure),
            _ => Err(DomainError::UnknownStatus),
        }
    }

    pub(crate) const fn is_terminal(self) -> bool {
        matches!(
            self,
            GenerationJobStatus::Completed | GenerationJobStatus::PermanentFailure
        )
    }
}

/// Mirrors `documents.print_jobs.status`. `WaitingForGeneration` is the
/// only non-terminal state a print job can be enqueued in — it becomes
/// `Pending` only once its generation job reaches `Completed` (enforced by
/// `documents.complete_generation_job`, not by this enum).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub(crate) enum PrintJobStatus {
    WaitingForGeneration,
    Pending,
    Claimed,
    Sending,
    Submitted,
    Completed,
    RetryableFailure,
    PermanentFailure,
    UnknownDelivery,
    Cancelled,
}

impl PrintJobStatus {
    pub(crate) const fn as_db_str(self) -> &'static str {
        match self {
            PrintJobStatus::WaitingForGeneration => "WAITING_FOR_GENERATION",
            PrintJobStatus::Pending => "PENDING",
            PrintJobStatus::Claimed => "CLAIMED",
            PrintJobStatus::Sending => "SENDING",
            PrintJobStatus::Submitted => "SUBMITTED",
            PrintJobStatus::Completed => "COMPLETED",
            PrintJobStatus::RetryableFailure => "RETRYABLE_FAILURE",
            PrintJobStatus::PermanentFailure => "PERMANENT_FAILURE",
            PrintJobStatus::UnknownDelivery => "UNKNOWN_DELIVERY",
            PrintJobStatus::Cancelled => "CANCELLED",
        }
    }

    pub(crate) fn from_db_str(value: &str) -> Result<Self, DomainError> {
        match value {
            "WAITING_FOR_GENERATION" => Ok(PrintJobStatus::WaitingForGeneration),
            "PENDING" => Ok(PrintJobStatus::Pending),
            "CLAIMED" => Ok(PrintJobStatus::Claimed),
            "SENDING" => Ok(PrintJobStatus::Sending),
            "SUBMITTED" => Ok(PrintJobStatus::Submitted),
            "COMPLETED" => Ok(PrintJobStatus::Completed),
            "RETRYABLE_FAILURE" => Ok(PrintJobStatus::RetryableFailure),
            "PERMANENT_FAILURE" => Ok(PrintJobStatus::PermanentFailure),
            "UNKNOWN_DELIVERY" => Ok(PrintJobStatus::UnknownDelivery),
            "CANCELLED" => Ok(PrintJobStatus::Cancelled),
            _ => Err(DomainError::UnknownStatus),
        }
    }

    /// Architecture: "Unknown printer delivery states do not trigger
    /// automatic retries" — `UnknownDelivery` is terminal here, alongside
    /// the other obviously-terminal states.
    pub(crate) const fn is_terminal(self) -> bool {
        matches!(
            self,
            PrintJobStatus::Completed
                | PrintJobStatus::PermanentFailure
                | PrintJobStatus::UnknownDelivery
                | PrintJobStatus::Cancelled
        )
    }
}

/// Mirrors `cash.drawer_jobs.status`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub(crate) enum DrawerJobStatus {
    Pending,
    Claimed,
    PulseSubmitted,
    PulseFailed,
    Cancelled,
}

impl DrawerJobStatus {
    pub(crate) const fn as_db_str(self) -> &'static str {
        match self {
            DrawerJobStatus::Pending => "PENDING",
            DrawerJobStatus::Claimed => "CLAIMED",
            DrawerJobStatus::PulseSubmitted => "PULSE_SUBMITTED",
            DrawerJobStatus::PulseFailed => "PULSE_FAILED",
            DrawerJobStatus::Cancelled => "CANCELLED",
        }
    }

    pub(crate) fn from_db_str(value: &str) -> Result<Self, DomainError> {
        match value {
            "PENDING" => Ok(DrawerJobStatus::Pending),
            "CLAIMED" => Ok(DrawerJobStatus::Claimed),
            "PULSE_SUBMITTED" => Ok(DrawerJobStatus::PulseSubmitted),
            "PULSE_FAILED" => Ok(DrawerJobStatus::PulseFailed),
            "CANCELLED" => Ok(DrawerJobStatus::Cancelled),
            _ => Err(DomainError::UnknownStatus),
        }
    }

    /// Architecture: "Reprint never creates a drawer pulse" — once a pulse
    /// has been submitted, this job is never re-armed; a retry is always a
    /// brand-new job with its own idempotency key.
    pub(crate) const fn is_terminal(self) -> bool {
        matches!(
            self,
            DrawerJobStatus::PulseSubmitted
                | DrawerJobStatus::PulseFailed
                | DrawerJobStatus::Cancelled
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generation_job_status_round_trips() {
        for status in [
            GenerationJobStatus::Pending,
            GenerationJobStatus::Claimed,
            GenerationJobStatus::Generating,
            GenerationJobStatus::Completed,
            GenerationJobStatus::RetryableFailure,
            GenerationJobStatus::PermanentFailure,
        ] {
            assert_eq!(
                GenerationJobStatus::from_db_str(status.as_db_str()),
                Ok(status)
            );
        }
        assert!(GenerationJobStatus::Completed.is_terminal());
        assert!(!GenerationJobStatus::Pending.is_terminal());
    }

    #[test]
    fn print_job_status_round_trips_and_unknown_delivery_is_terminal() {
        for status in [
            PrintJobStatus::WaitingForGeneration,
            PrintJobStatus::Pending,
            PrintJobStatus::Claimed,
            PrintJobStatus::Sending,
            PrintJobStatus::Submitted,
            PrintJobStatus::Completed,
            PrintJobStatus::RetryableFailure,
            PrintJobStatus::PermanentFailure,
            PrintJobStatus::UnknownDelivery,
            PrintJobStatus::Cancelled,
        ] {
            assert_eq!(PrintJobStatus::from_db_str(status.as_db_str()), Ok(status));
        }
        assert!(PrintJobStatus::UnknownDelivery.is_terminal());
        assert!(!PrintJobStatus::Pending.is_terminal());
    }

    #[test]
    fn drawer_job_status_round_trips_and_pulse_submitted_is_terminal() {
        for status in [
            DrawerJobStatus::Pending,
            DrawerJobStatus::Claimed,
            DrawerJobStatus::PulseSubmitted,
            DrawerJobStatus::PulseFailed,
            DrawerJobStatus::Cancelled,
        ] {
            assert_eq!(DrawerJobStatus::from_db_str(status.as_db_str()), Ok(status));
        }
        assert!(DrawerJobStatus::PulseSubmitted.is_terminal());
        assert!(!DrawerJobStatus::Pending.is_terminal());
    }

    #[test]
    fn rejects_unknown_status_strings() {
        assert_eq!(
            GenerationJobStatus::from_db_str("BOGUS"),
            Err(DomainError::UnknownStatus)
        );
        assert_eq!(
            PrintJobStatus::from_db_str("BOGUS"),
            Err(DomainError::UnknownStatus)
        );
        assert_eq!(
            DrawerJobStatus::from_db_str("BOGUS"),
            Err(DomainError::UnknownStatus)
        );
    }
}
