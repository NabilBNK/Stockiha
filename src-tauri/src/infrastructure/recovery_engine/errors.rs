//! Engine error = one stable detail code + a log-only detail (plan §5.7).
//!
//! The detail code (`[A-Z0-9_]`, ≤ 128 chars) is what reaches the audit
//! table (`recovery_attempts.error_code`) and the frontend outcome events;
//! `log_detail` (paths, trimmed child-process stderr — never a password)
//! goes to `recovery.log` only. [`EngineError::to_app_error`] applies the
//! §5.7.1 mapping table to pick the public `AppError`/IPC code.

use crate::error::AppError;

/// Every detail code the engine can produce (plan §5.7.1). Kept as
/// constants so a typo is a compile error, and so the mapping test below can
/// enumerate them all.
pub(crate) mod codes {
    // Backup creation.
    pub(crate) const BACKUP_PREFLIGHT_BINARIES_MISSING: &str = "BACKUP_PREFLIGHT_BINARIES_MISSING";
    pub(crate) const BACKUP_PG_DUMP_VERSION_FAILED: &str = "BACKUP_PG_DUMP_VERSION_FAILED";
    pub(crate) const BACKUP_PG_DUMP_VERSION_MISMATCH: &str = "BACKUP_PG_DUMP_VERSION_MISMATCH";
    pub(crate) const BACKUP_SCHEMA_VERSION_UNREADABLE: &str = "BACKUP_SCHEMA_VERSION_UNREADABLE";
    pub(crate) const BACKUP_PG_DUMP_FAILED: &str = "BACKUP_PG_DUMP_FAILED";
    pub(crate) const BACKUP_STAGE_FAILED: &str = "BACKUP_STAGE_FAILED";
    pub(crate) const BACKUP_METADATA_WRITE_FAILED: &str = "BACKUP_METADATA_WRITE_FAILED";
    pub(crate) const BACKUP_VALIDATION_AFTER_CREATE_FAILED: &str =
        "BACKUP_VALIDATION_AFTER_CREATE_FAILED";
    pub(crate) const BACKUP_PUBLISH_FAILED: &str = "BACKUP_PUBLISH_FAILED";
    pub(crate) const BACKUP_IDENTIFIER_COLLISION: &str = "BACKUP_IDENTIFIER_COLLISION";
    pub(crate) const BACKUP_DESTINATION_UNAVAILABLE: &str = "BACKUP_DESTINATION_UNAVAILABLE";
    pub(crate) const BACKUP_INSUFFICIENT_SPACE: &str = "BACKUP_INSUFFICIENT_SPACE";
    pub(crate) const BACKUP_ASSET_COPY_FAILED: &str = "BACKUP_ASSET_COPY_FAILED";
    // Bundle inspection.
    pub(crate) const BACKUP_BUNDLE_NOT_A_DIRECTORY: &str = "BACKUP_BUNDLE_NOT_A_DIRECTORY";
    pub(crate) const BACKUP_BUNDLE_NAME_INVALID: &str = "BACKUP_BUNDLE_NAME_INVALID";
    pub(crate) const BACKUP_INTEGRITY_INVALID: &str = "BACKUP_INTEGRITY_INVALID";
    pub(crate) const BACKUP_FORMAT_NOT_RESTORABLE: &str = "BACKUP_FORMAT_NOT_RESTORABLE";
    pub(crate) const BACKUP_SCHEMA_NEWER_THAN_APP: &str = "BACKUP_SCHEMA_NEWER_THAN_APP";
    pub(crate) const BACKUP_SCHEMA_UNKNOWN: &str = "BACKUP_SCHEMA_UNKNOWN";
    // Isolated restore test (WS-H-4).
    pub(crate) const DRILL_PATH_NOT_ASCII: &str = "DRILL_PATH_NOT_ASCII";
    pub(crate) const DRILL_INSUFFICIENT_SPACE: &str = "DRILL_INSUFFICIENT_SPACE";
    pub(crate) const DRILL_INITDB_FAILED: &str = "DRILL_INITDB_FAILED";
    pub(crate) const DRILL_NO_FREE_PORT: &str = "DRILL_NO_FREE_PORT";
    pub(crate) const DRILL_SERVER_START_FAILED: &str = "DRILL_SERVER_START_FAILED";
    pub(crate) const DRILL_ROLE_SETUP_FAILED: &str = "DRILL_ROLE_SETUP_FAILED";
    pub(crate) const DRILL_RESTORE_FAILED: &str = "DRILL_RESTORE_FAILED";
    pub(crate) const DRILL_MIGRATION_HISTORY_MISMATCH: &str = "DRILL_MIGRATION_HISTORY_MISMATCH";
    pub(crate) const DRILL_FORWARD_MIGRATION_FAILED: &str = "DRILL_FORWARD_MIGRATION_FAILED";
    pub(crate) const DRILL_RECONCILIATION_FAILED: &str = "DRILL_RECONCILIATION_FAILED";
    pub(crate) const DRILL_SERVER_STOP_FAILED: &str = "DRILL_SERVER_STOP_FAILED";
    // Live restore (WS-H-5).
    pub(crate) const RESTORE_CONFIRMATION_INVALID: &str = "RESTORE_CONFIRMATION_INVALID";
    pub(crate) const FRESH_RESTORE_NOT_ALLOWED: &str = "FRESH_RESTORE_NOT_ALLOWED";
    pub(crate) const RESTORE_JOURNALS_UNBALANCED: &str = "RESTORE_JOURNALS_UNBALANCED";
    pub(crate) const RESTORE_SAFETY_BACKUP_FAILED: &str = "RESTORE_SAFETY_BACKUP_FAILED";
    pub(crate) const RESTORE_DATABASE_BUSY: &str = "RESTORE_DATABASE_BUSY";
    pub(crate) const RESTORE_RESET_FAILED: &str = "RESTORE_RESET_FAILED";
    pub(crate) const RESTORE_PG_RESTORE_FAILED: &str = "RESTORE_PG_RESTORE_FAILED";
    pub(crate) const RESTORE_FORWARD_MIGRATION_FAILED: &str = "RESTORE_FORWARD_MIGRATION_FAILED";
    pub(crate) const RESTORE_VERIFY_SCHEMA_FAILED: &str = "RESTORE_VERIFY_SCHEMA_FAILED";
    pub(crate) const RESTORE_VERIFY_TOTALS_MISMATCH: &str = "RESTORE_VERIFY_TOTALS_MISMATCH";
    pub(crate) const RESTORE_ASSET_COPY_FAILED: &str = "RESTORE_ASSET_COPY_FAILED";
    pub(crate) const RESTORE_ROLLBACK_FAILED: &str = "RESTORE_ROLLBACK_FAILED";
    // Copy to another folder (WS-H-4).
    pub(crate) const COPY_SOURCE_INVALID: &str = "COPY_SOURCE_INVALID";
    pub(crate) const COPY_TARGET_INVALID: &str = "COPY_TARGET_INVALID";
    pub(crate) const COPY_TARGET_EXISTS: &str = "COPY_TARGET_EXISTS";
    pub(crate) const COPY_IO_FAILED: &str = "COPY_IO_FAILED";
    pub(crate) const COPY_VALIDATION_FAILED: &str = "COPY_VALIDATION_FAILED";
    // Destination rules (§5.5) reuse the pre-existing WS-H-1 IPC codes.
    pub(crate) const BACKUP_DESTINATION_INSIDE_DATA_DIRECTORY: &str =
        "BACKUP_DESTINATION_INSIDE_DATA_DIRECTORY";
    pub(crate) const BACKUP_DESTINATION_CREATE_FAILED: &str = "BACKUP_DESTINATION_CREATE_FAILED";
    pub(crate) const VALIDATION_ERROR: &str = "VALIDATION_ERROR";

    /// Every code above, for the exhaustive mapping test.
    #[cfg(test)]
    pub(crate) const ALL: &[&str] = &[
        BACKUP_PREFLIGHT_BINARIES_MISSING,
        BACKUP_PG_DUMP_VERSION_FAILED,
        BACKUP_PG_DUMP_VERSION_MISMATCH,
        BACKUP_SCHEMA_VERSION_UNREADABLE,
        BACKUP_PG_DUMP_FAILED,
        BACKUP_STAGE_FAILED,
        BACKUP_METADATA_WRITE_FAILED,
        BACKUP_VALIDATION_AFTER_CREATE_FAILED,
        BACKUP_PUBLISH_FAILED,
        BACKUP_IDENTIFIER_COLLISION,
        BACKUP_DESTINATION_UNAVAILABLE,
        BACKUP_INSUFFICIENT_SPACE,
        BACKUP_ASSET_COPY_FAILED,
        BACKUP_BUNDLE_NOT_A_DIRECTORY,
        BACKUP_BUNDLE_NAME_INVALID,
        BACKUP_INTEGRITY_INVALID,
        BACKUP_FORMAT_NOT_RESTORABLE,
        BACKUP_SCHEMA_NEWER_THAN_APP,
        BACKUP_SCHEMA_UNKNOWN,
        DRILL_PATH_NOT_ASCII,
        DRILL_INSUFFICIENT_SPACE,
        DRILL_INITDB_FAILED,
        DRILL_NO_FREE_PORT,
        DRILL_SERVER_START_FAILED,
        DRILL_ROLE_SETUP_FAILED,
        DRILL_RESTORE_FAILED,
        DRILL_MIGRATION_HISTORY_MISMATCH,
        DRILL_FORWARD_MIGRATION_FAILED,
        DRILL_RECONCILIATION_FAILED,
        DRILL_SERVER_STOP_FAILED,
        RESTORE_CONFIRMATION_INVALID,
        FRESH_RESTORE_NOT_ALLOWED,
        RESTORE_JOURNALS_UNBALANCED,
        RESTORE_SAFETY_BACKUP_FAILED,
        RESTORE_DATABASE_BUSY,
        RESTORE_RESET_FAILED,
        RESTORE_PG_RESTORE_FAILED,
        RESTORE_FORWARD_MIGRATION_FAILED,
        RESTORE_VERIFY_SCHEMA_FAILED,
        RESTORE_VERIFY_TOTALS_MISMATCH,
        RESTORE_ASSET_COPY_FAILED,
        RESTORE_ROLLBACK_FAILED,
        COPY_SOURCE_INVALID,
        COPY_TARGET_INVALID,
        COPY_TARGET_EXISTS,
        COPY_IO_FAILED,
        COPY_VALIDATION_FAILED,
        BACKUP_DESTINATION_INSIDE_DATA_DIRECTORY,
        BACKUP_DESTINATION_CREATE_FAILED,
        VALIDATION_ERROR,
    ];
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct EngineError {
    pub(crate) code: &'static str,
    pub(crate) log_detail: String,
}

impl EngineError {
    pub(crate) fn new(code: &'static str, detail: impl Into<String>) -> Self {
        EngineError {
            code,
            log_detail: detail.into(),
        }
    }

    /// Map the detail code to the public error class (plan §5.7.1 table).
    /// The `diagnostic` carried by the resulting `AppError` is the detail
    /// code itself — never `log_detail` — so it can flow into the audit
    /// row's `error_code` unchanged.
    pub(crate) fn to_app_error(&self) -> AppError {
        let diagnostic = self.code.to_string();
        match self.code {
            codes::BACKUP_DESTINATION_UNAVAILABLE => {
                AppError::BackupDestinationUnavailable { diagnostic }
            }
            codes::BACKUP_INSUFFICIENT_SPACE | codes::DRILL_INSUFFICIENT_SPACE => {
                AppError::InsufficientDiskSpace { diagnostic }
            }
            codes::BACKUP_FORMAT_NOT_RESTORABLE
            | codes::BACKUP_SCHEMA_NEWER_THAN_APP
            | codes::BACKUP_SCHEMA_UNKNOWN
            | codes::DRILL_MIGRATION_HISTORY_MISMATCH => {
                AppError::BackupNotRestorable { diagnostic }
            }
            codes::BACKUP_BUNDLE_NOT_A_DIRECTORY
            | codes::BACKUP_BUNDLE_NAME_INVALID
            | codes::BACKUP_INTEGRITY_INVALID => AppError::BackupValidationFailed { diagnostic },
            codes::BACKUP_DESTINATION_INSIDE_DATA_DIRECTORY => {
                AppError::BackupDestinationInsideDataDirectory { diagnostic }
            }
            codes::BACKUP_DESTINATION_CREATE_FAILED => {
                AppError::BackupDestinationCreateFailed { diagnostic }
            }
            codes::VALIDATION_ERROR | codes::RESTORE_CONFIRMATION_INVALID => {
                AppError::ValidationError { diagnostic }
            }
            codes::FRESH_RESTORE_NOT_ALLOWED => AppError::FreshRestoreNotAllowed { diagnostic },
            code if code.starts_with("BACKUP_") => AppError::BackupCreationFailed { diagnostic },
            code if code.starts_with("DRILL_") => AppError::RestoreTestFailed { diagnostic },
            code if code.starts_with("COPY_") => AppError::BackupCopyFailed { diagnostic },
            code if code.starts_with("RESTORE_") => AppError::PreconditionFailed { diagnostic },
            _ => AppError::internal(diagnostic),
        }
    }
}

impl std::fmt::Display for EngineError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.code)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::{ErrorCode, IpcError};

    fn ipc(code: &'static str) -> ErrorCode {
        IpcError::from(EngineError::new(code, "detail").to_app_error()).code
    }

    #[test]
    fn every_detail_code_is_well_formed() {
        for code in codes::ALL {
            assert!(!code.is_empty() && code.len() <= 128, "{code}");
            assert!(
                code.bytes()
                    .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_'),
                "{code} must be uppercase ASCII"
            );
        }
        let mut sorted: Vec<&str> = codes::ALL.to_vec();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(sorted.len(), codes::ALL.len(), "duplicate detail code");
    }

    #[test]
    fn every_detail_code_maps_to_the_planned_ipc_code() {
        for code in codes::ALL {
            let expected = match *code {
                "BACKUP_DESTINATION_UNAVAILABLE" => ErrorCode::BackupDestinationUnavailable,
                "BACKUP_INSUFFICIENT_SPACE" | "DRILL_INSUFFICIENT_SPACE" => {
                    ErrorCode::InsufficientDiskSpace
                }
                "BACKUP_BUNDLE_NOT_A_DIRECTORY"
                | "BACKUP_BUNDLE_NAME_INVALID"
                | "BACKUP_INTEGRITY_INVALID" => ErrorCode::BackupValidationFailed,
                "BACKUP_FORMAT_NOT_RESTORABLE"
                | "BACKUP_SCHEMA_NEWER_THAN_APP"
                | "BACKUP_SCHEMA_UNKNOWN"
                | "DRILL_MIGRATION_HISTORY_MISMATCH" => ErrorCode::BackupNotRestorable,
                "BACKUP_DESTINATION_INSIDE_DATA_DIRECTORY" => {
                    ErrorCode::BackupDestinationInsideDataDirectory
                }
                "BACKUP_DESTINATION_CREATE_FAILED" => ErrorCode::BackupDestinationCreateFailed,
                "VALIDATION_ERROR" | "RESTORE_CONFIRMATION_INVALID" => ErrorCode::ValidationError,
                "FRESH_RESTORE_NOT_ALLOWED" => ErrorCode::FreshRestoreNotAllowed,
                c if c.starts_with("BACKUP_") => ErrorCode::BackupCreationFailed,
                c if c.starts_with("DRILL_") => ErrorCode::RestoreTestFailed,
                c if c.starts_with("COPY_") => ErrorCode::BackupCopyFailed,
                c if c.starts_with("RESTORE_") => ErrorCode::PreconditionFailed,
                other => panic!("unmapped detail code {other}"),
            };
            assert_eq!(ipc(code), expected, "{code}");
        }
    }

    #[test]
    fn app_error_diagnostic_is_the_code_never_the_log_detail() {
        let error = EngineError::new(codes::BACKUP_PG_DUMP_FAILED, "C:\\secret\\path stderr");
        match error.to_app_error() {
            AppError::BackupCreationFailed { diagnostic } => {
                assert_eq!(diagnostic, "BACKUP_PG_DUMP_FAILED");
            }
            other => panic!("unexpected {other:?}"),
        }
    }
}
