//! Typed error boundary for Stockiha.
//!
//! `AppError` is internal and may retain private diagnostics. `IpcError` is the
//! only serializable error type and carries one stable public code with no SQL,
//! token, customer, filesystem, or other diagnostic detail.

use serde::Serialize;
use std::fmt;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    InternalError,
    ConfigurationError,
    DatabaseUnavailable,
    SessionInvalid,
    PermissionDenied,
    ValidationError,
    PreconditionFailed,
    BackupCreationFailed,
    BackupValidationFailed,
    IdempotencyConflict,
    ImmutableRecord,
    UnsafeZeroStockValuation,
    /// S4-001: customer inactive/not credit-enabled, credit limit exceeded,
    /// overdue policy blocks posting, or a required override is unusable.
    CreditPolicyBlocked,
    InsufficientStock,
    CorrectionsDisabled,
}

pub enum AppError {
    #[cfg_attr(not(test), allow(dead_code))]
    Internal(String),
    DatabaseConfiguration {
        #[cfg_attr(not(test), allow(dead_code))]
        diagnostic: String,
    },
    DatabaseUnavailable {
        #[cfg_attr(not(test), allow(dead_code))]
        diagnostic: String,
    },
    SessionInvalid {
        diagnostic: String,
    },
    PermissionDenied {
        diagnostic: String,
    },
    ValidationError {
        diagnostic: String,
    },
    PreconditionFailed {
        diagnostic: String,
    },
    BackupCreationFailed {
        diagnostic: String,
    },
    BackupValidationFailed {
        diagnostic: String,
    },
    IdempotencyConflict {
        diagnostic: String,
    },
    ImmutableRecord {
        diagnostic: String,
    },
    UnsafeZeroStockValuation {
        diagnostic: String,
    },
    CreditPolicyBlocked {
        diagnostic: String,
    },
    InsufficientStock {
        diagnostic: String,
    },
    CorrectionsDisabled {
        diagnostic: String,
    },
}

impl AppError {
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn internal(diagnostic: impl Into<String>) -> Self {
        AppError::Internal(diagnostic.into())
    }

    pub fn database_configuration(diagnostic: impl Into<String>) -> Self {
        AppError::DatabaseConfiguration {
            diagnostic: diagnostic.into(),
        }
    }

    pub fn database_unavailable(diagnostic: impl Into<String>) -> Self {
        AppError::DatabaseUnavailable {
            diagnostic: diagnostic.into(),
        }
    }

    /// Translate database SQLSTATE into a stable internal class. Full database
    /// text remains private in `diagnostic` and is dropped at IPC conversion.
    pub fn from_posting_error(err: sqlx::Error) -> Self {
        // A pool-acquire timeout is a connectivity fault, not a posting fault.
        // Classifying it as `Internal` (the old behaviour, via the
        // `as_database_error() == None` arm below) is what made it surface as
        // an opaque `INTERNAL_ERROR` with the evidence-free SQLx text
        // "pool timed out while waiting for an open connection". Route it to
        // `DatabaseUnavailable` so the frontend asks
        // `get_db_diagnostic` for the real, credential-free cause.
        if matches!(err, sqlx::Error::PoolTimedOut) {
            return AppError::DatabaseUnavailable {
                diagnostic: "could not acquire a database connection; \
                             see the DB_STARTUP diagnostic for the real cause"
                    .to_owned(),
            };
        }

        let message = err.to_string();
        if cfg!(debug_assertions) {
            eprintln!("[DB_POSTING_ERROR] {}", message);
        }
        let Some(db_err) = err.as_database_error() else {
            return AppError::Internal(message);
        };
        match db_err.code().as_deref() {
            Some("28000") => AppError::SessionInvalid {
                diagnostic: message,
            },
            Some("42501") => AppError::PermissionDenied {
                diagnostic: message,
            },
            Some("22023") => AppError::ValidationError {
                diagnostic: message,
            },
            Some("55000") => {
                if message.contains("insufficient stock") {
                    AppError::InsufficientStock {
                        diagnostic: message,
                    }
                } else if message.contains("disabled by policy") {
                    AppError::CorrectionsDisabled {
                        diagnostic: message,
                    }
                } else {
                    AppError::PreconditionFailed {
                        diagnostic: message,
                    }
                }
            }
            Some("23505") => AppError::IdempotencyConflict {
                diagnostic: message,
            },
            Some("0A000") => AppError::ImmutableRecord {
                diagnostic: message,
            },
            Some("P2002") => AppError::UnsafeZeroStockValuation {
                diagnostic: message,
            },
            Some("P4001") => AppError::CreditPolicyBlocked {
                diagnostic: message,
            },
            _ => AppError::Internal(message),
        }
    }
}

impl fmt::Debug for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AppError::Internal(_) => f.write_str("AppError::Internal(<redacted>)"),
            AppError::DatabaseConfiguration { .. } => {
                f.write_str("AppError::DatabaseConfiguration(<redacted>)")
            }
            AppError::DatabaseUnavailable { .. } => {
                f.write_str("AppError::DatabaseUnavailable(<redacted>)")
            }
            AppError::SessionInvalid { .. } => f.write_str("AppError::SessionInvalid(<redacted>)"),
            AppError::PermissionDenied { .. } => {
                f.write_str("AppError::PermissionDenied(<redacted>)")
            }
            AppError::ValidationError { .. } => {
                f.write_str("AppError::ValidationError(<redacted>)")
            }
            AppError::PreconditionFailed { .. } => {
                f.write_str("AppError::PreconditionFailed(<redacted>)")
            }
            AppError::BackupCreationFailed { .. } => {
                f.write_str("AppError::BackupCreationFailed(<redacted>)")
            }
            AppError::BackupValidationFailed { .. } => {
                f.write_str("AppError::BackupValidationFailed(<redacted>)")
            }
            AppError::IdempotencyConflict { .. } => {
                f.write_str("AppError::IdempotencyConflict(<redacted>)")
            }
            AppError::ImmutableRecord { .. } => {
                f.write_str("AppError::ImmutableRecord(<redacted>)")
            }
            AppError::UnsafeZeroStockValuation { .. } => {
                f.write_str("AppError::UnsafeZeroStockValuation(<redacted>)")
            }
            AppError::CreditPolicyBlocked { .. } => {
                f.write_str("AppError::CreditPolicyBlocked(<redacted>)")
            }
            AppError::InsufficientStock { .. } => {
                f.write_str("AppError::InsufficientStock(<redacted>)")
            }
            AppError::CorrectionsDisabled { .. } => {
                f.write_str("AppError::CorrectionsDisabled(<redacted>)")
            }
        }
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AppError::Internal(_) => f.write_str("internal error"),
            AppError::DatabaseConfiguration { .. } => f.write_str("database configuration error"),
            AppError::DatabaseUnavailable { .. } => f.write_str("database unavailable"),
            AppError::SessionInvalid { .. } => f.write_str("invalid, expired, or revoked session"),
            AppError::PermissionDenied { .. } => f.write_str("permission denied"),
            AppError::ValidationError { .. } => f.write_str("validation error"),
            AppError::PreconditionFailed { .. } => f.write_str("precondition failed"),
            AppError::BackupCreationFailed { .. } => f.write_str("backup creation failed"),
            AppError::BackupValidationFailed { .. } => f.write_str("backup validation failed"),
            AppError::IdempotencyConflict { .. } => f.write_str("idempotency conflict"),
            AppError::ImmutableRecord { .. } => f.write_str("record is immutable"),
            AppError::UnsafeZeroStockValuation { .. } => f.write_str("unsafe zero-stock valuation"),
            AppError::CreditPolicyBlocked { .. } => f.write_str("credit policy blocked"),
            AppError::InsufficientStock { .. } => f.write_str("insufficient stock"),
            AppError::CorrectionsDisabled { .. } => {
                f.write_str("inventory corrections disabled by policy")
            }
        }
    }
}

impl std::error::Error for AppError {}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct IpcError {
    pub code: ErrorCode,
}

impl IpcError {
    pub const fn new(code: ErrorCode) -> Self {
        Self { code }
    }
}

impl From<AppError> for IpcError {
    fn from(err: AppError) -> Self {
        match err {
            AppError::Internal(_) => IpcError::new(ErrorCode::InternalError),
            AppError::DatabaseConfiguration { .. } => IpcError::new(ErrorCode::ConfigurationError),
            AppError::DatabaseUnavailable { .. } => IpcError::new(ErrorCode::DatabaseUnavailable),
            AppError::SessionInvalid { .. } => IpcError::new(ErrorCode::SessionInvalid),
            AppError::PermissionDenied { .. } => IpcError::new(ErrorCode::PermissionDenied),
            AppError::ValidationError { .. } => IpcError::new(ErrorCode::ValidationError),
            AppError::PreconditionFailed { .. } => IpcError::new(ErrorCode::PreconditionFailed),
            AppError::BackupCreationFailed { .. } => IpcError::new(ErrorCode::BackupCreationFailed),
            AppError::BackupValidationFailed { .. } => {
                IpcError::new(ErrorCode::BackupValidationFailed)
            }
            AppError::IdempotencyConflict { .. } => IpcError::new(ErrorCode::IdempotencyConflict),
            AppError::ImmutableRecord { .. } => IpcError::new(ErrorCode::ImmutableRecord),
            AppError::UnsafeZeroStockValuation { .. } => {
                IpcError::new(ErrorCode::UnsafeZeroStockValuation)
            }
            AppError::CreditPolicyBlocked { .. } => IpcError::new(ErrorCode::CreditPolicyBlocked),
            AppError::InsufficientStock { .. } => IpcError::new(ErrorCode::InsufficientStock),
            AppError::CorrectionsDisabled { .. } => IpcError::new(ErrorCode::CorrectionsDisabled),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SENTINEL: &str = "DO_NOT_EXPOSE_DIAGNOSTIC";

    #[test]
    fn ipc_error_serializes_to_exact_public_shape() {
        let json = serde_json::to_string(&IpcError::new(ErrorCode::InternalError)).unwrap();
        assert_eq!(json, r#"{"code":"INTERNAL_ERROR"}"#);
    }

    #[test]
    fn error_codes_are_stable_screaming_snake_case() {
        assert_eq!(
            serde_json::to_string(&ErrorCode::ConfigurationError).unwrap(),
            r#""CONFIGURATION_ERROR""#
        );
        assert_eq!(
            serde_json::to_string(&ErrorCode::BackupCreationFailed).unwrap(),
            r#""BACKUP_CREATION_FAILED""#
        );
        assert_eq!(
            serde_json::to_string(&ErrorCode::BackupValidationFailed).unwrap(),
            r#""BACKUP_VALIDATION_FAILED""#
        );
        assert_eq!(
            serde_json::to_string(&ErrorCode::UnsafeZeroStockValuation).unwrap(),
            r#""UNSAFE_ZERO_STOCK_VALUATION""#
        );
        assert_eq!(
            serde_json::to_string(&ErrorCode::CreditPolicyBlocked).unwrap(),
            r#""CREDIT_POLICY_BLOCKED""#
        );
    }

    #[test]
    fn explicit_conversion_maps_internal_to_internal_error() {
        let ipc: IpcError = AppError::internal("some private detail").into();
        assert_eq!(ipc, IpcError::new(ErrorCode::InternalError));
    }

    #[test]
    fn explicit_conversion_maps_database_configuration() {
        let ipc: IpcError = AppError::database_configuration(SENTINEL).into();
        assert_eq!(ipc, IpcError::new(ErrorCode::ConfigurationError));
    }

    #[test]
    fn explicit_conversion_maps_database_unavailable() {
        let ipc: IpcError = AppError::database_unavailable(SENTINEL).into();
        assert_eq!(ipc, IpcError::new(ErrorCode::DatabaseUnavailable));
    }

    #[test]
    fn backup_creation_error_is_redacted_and_stable() {
        let app = AppError::BackupCreationFailed {
            diagnostic: SENTINEL.to_owned(),
        };
        assert!(!format!("{app:?}").contains(SENTINEL));
        assert_eq!(format!("{app}"), "backup creation failed");
        let ipc: IpcError = app.into();
        assert_eq!(ipc, IpcError::new(ErrorCode::BackupCreationFailed));
        assert_eq!(
            serde_json::to_string(&ipc).unwrap(),
            r#"{"code":"BACKUP_CREATION_FAILED"}"#
        );
    }

    #[test]
    fn backup_validation_error_is_redacted_and_stable() {
        let app = AppError::BackupValidationFailed {
            diagnostic: SENTINEL.to_owned(),
        };
        assert!(!format!("{app:?}").contains(SENTINEL));
        assert_eq!(format!("{app}"), "backup validation failed");
        let ipc: IpcError = app.into();
        assert_eq!(ipc, IpcError::new(ErrorCode::BackupValidationFailed));
        assert_eq!(
            serde_json::to_string(&ipc).unwrap(),
            r#"{"code":"BACKUP_VALIDATION_FAILED"}"#
        );
    }

    #[test]
    fn credit_policy_error_is_redacted_and_stable() {
        let app = AppError::CreditPolicyBlocked {
            diagnostic: SENTINEL.to_owned(),
        };
        assert!(!format!("{app:?}").contains(SENTINEL));
        assert_eq!(format!("{app}"), "credit policy blocked");
        let ipc: IpcError = app.into();
        assert_eq!(ipc, IpcError::new(ErrorCode::CreditPolicyBlocked));
        assert_eq!(
            serde_json::to_string(&ipc).unwrap(),
            r#"{"code":"CREDIT_POLICY_BLOCKED"}"#
        );
    }

    #[test]
    fn unsafe_zero_stock_valuation_is_redacted_and_stable() {
        let app = AppError::UnsafeZeroStockValuation {
            diagnostic: SENTINEL.to_owned(),
        };
        assert!(!format!("{app:?}").contains(SENTINEL));
        let ipc: IpcError = app.into();
        assert_eq!(ipc, IpcError::new(ErrorCode::UnsafeZeroStockValuation));
    }

    #[test]
    fn conversion_omits_private_diagnostics_from_wire() {
        for err in [
            AppError::internal(SENTINEL),
            AppError::database_configuration(SENTINEL),
            AppError::database_unavailable(SENTINEL),
        ] {
            let ipc: IpcError = err.into();
            let json = serde_json::to_string(&ipc).unwrap();
            assert!(!json.contains(SENTINEL));
            assert!(json.starts_with(r#"{"code":""#) && json.ends_with(r#""}"#));
        }
    }

    #[test]
    fn redacted_debug_and_display_never_expose_diagnostics() {
        let cases = [
            (
                AppError::internal(SENTINEL),
                "AppError::Internal(<redacted>)",
                "internal error",
            ),
            (
                AppError::database_configuration(SENTINEL),
                "AppError::DatabaseConfiguration(<redacted>)",
                "database configuration error",
            ),
            (
                AppError::database_unavailable(SENTINEL),
                "AppError::DatabaseUnavailable(<redacted>)",
                "database unavailable",
            ),
        ];
        for (err, expected_debug, expected_display) in cases {
            let debug = format!("{err:?}");
            let display = format!("{err}");
            assert!(!debug.contains(SENTINEL));
            assert!(!display.contains(SENTINEL));
            assert_eq!(debug, expected_debug);
            assert_eq!(display, expected_display);
        }
    }

    #[test]
    fn internal_diagnostic_remains_available_to_trusted_rust_code() {
        match AppError::internal(SENTINEL) {
            AppError::Internal(diagnostic) => assert_eq!(diagnostic, SENTINEL),
            _ => panic!("expected AppError::Internal"),
        }
    }
}
