//! Typed error foundation for Stockiha (S0-002, extended by S0-003).
//!
//! This module establishes a strict boundary between two error types:
//!
//! * [`AppError`] — internal only. It may retain private diagnostic context for
//!   trusted, in-process handling. It deliberately does **not** implement
//!   [`serde::Serialize`]. `AppError` diagnostics are not serialized across IPC
//!   and are not exposed by its standard `Debug` or `Display` implementations.
//!   Trusted in-crate Rust code may inspect them deliberately and remains
//!   responsible for logging and redaction policy.
//! * [`IpcError`] — the *only* serializable error type. It carries a stable,
//!   public [`ErrorCode`] and nothing else. Its wire shape is exactly
//!   `{"code":"<ERROR_CODE>"}`.
//!
//! Conversion from `AppError` to `IpcError` is explicit and **exhaustive**
//! (see [`From<AppError> for IpcError`]). Every future `AppError` variant must be
//! consciously classified to a public `ErrorCode`; a missing arm is a compile
//! error. Do not add a catch-all (`_`) arm — that would silently leak future
//! variants as `INTERNAL_ERROR` without review.
//!
//! S0-003 adds the database connectivity variants. Their diagnostics may contain
//! raw SQLx/PostgreSQL text or configuration parse detail; that content stays
//! internal and is dropped at the IPC boundary exactly like every other
//! diagnostic.

use serde::Serialize;
use std::fmt;

/// Stable, public error codes permitted to cross the Tauri IPC boundary.
///
/// Serialized in `SCREAMING_SNAKE_CASE` (e.g. `INTERNAL_ERROR`). These strings
/// are a public contract consumed by the frontend allowlist
/// (`src/shared/types/errors.ts`). Never rename or remove existing variants;
/// add a new variant only together with its frontend code and an explicit
/// mapping in [`From<AppError> for IpcError`].
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    /// A generic, non-attributable internal failure. Carries no detail.
    InternalError,
    /// Required configuration is missing or invalid (S0-003: the database
    /// connection configuration). Carries no detail.
    ConfigurationError,
    /// The database could not be reached or did not answer in time (S0-003).
    /// Carries no detail.
    DatabaseUnavailable,
    /// Slice 1 MVP batch: the session token is missing, malformed, expired,
    /// or revoked (`iam.resolve_session` / `iam.resolve_session_with_permission`,
    /// SQLSTATE `28000`). Carries no detail — never echoes the token.
    SessionInvalid,
    /// Slice 1 MVP batch: the session resolved to a real user, but that user
    /// lacks the permission the operation requires (SQLSTATE `42501`).
    PermissionDenied,
    /// Slice 1 MVP batch: the request's own input failed a posting
    /// function's validation (negative quantity, invalid cost, unknown
    /// warehouse/variant/fiscal period, malformed line, ... — SQLSTATE
    /// `22023`). Carries no detail; the specific reason is a private
    /// diagnostic only.
    ValidationError,
    /// Slice 1 MVP batch: the request is well-formed but the system is not
    /// in a state that allows it right now — a closed fiscal period, a cash
    /// session that is not open, insufficient stock (SQLSTATE `55000`).
    PreconditionFailed,
    /// Slice 1 MVP batch: the same idempotency key was already used with a
    /// different payload (SQLSTATE `23505` from
    /// `core.reserve_idempotent_request`) — the caller must not retry with
    /// the same request id and different contents.
    IdempotencyConflict,
    /// Slice 1 MVP batch: an attempt was made to mutate a posted/reversed/
    /// closed/immutable record (SQLSTATE `0A000` from one of this crate's
    /// `forbid_*_mutation` triggers).
    ImmutableRecord,
    /// S2-002: a positive adjustment at zero stock has no usable WAC. S2-003
    /// estimated-cost valuation is deliberately not accepted here.
    UnsafeZeroStockValuation,
}

/// Internal application error. Not serialized; does not cross the IPC boundary.
///
/// Variants may carry diagnostic context. That context is not serialized across
/// IPC and is not exposed by the standard `Debug`/`Display` implementations, and
/// the `From<AppError>` conversion drops all payloads, keeping only the public
/// code. Trusted in-crate Rust code may still inspect the payload deliberately
/// and remains responsible for logging and redaction policy.
pub enum AppError {
    /// An unexpected internal failure. The contained string is diagnostic
    /// context for trusted in-crate handling; it is not serialized across IPC
    /// and is not exposed by `Debug`/`Display`.
    ///
    /// Remove this temporary allowance when a genuine production consumer reads
    /// or constructs this item.
    #[cfg_attr(not(test), allow(dead_code))]
    Internal(String),
    /// The database connection configuration is missing or could not be
    /// parsed (S0-003). The diagnostic is a fixed, input-independent constant
    /// that never incorporates the URL value, credentials, hostnames, database
    /// names, or the underlying parser's details, so no secret can leak. It is
    /// never serialized across IPC nor exposed by `Debug`/`Display`.
    DatabaseConfiguration {
        /// Remove this temporary allowance when a genuine production consumer
        /// reads or constructs this item.
        #[cfg_attr(not(test), allow(dead_code))]
        diagnostic: String,
    },
    /// The database could not be reached, refused the connection, failed
    /// authentication, or timed out (S0-003). The diagnostic may retain trusted
    /// internal SQLx/PostgreSQL context for backend debugging, but standard
    /// Debug/Display and IPC conversion remain redacted and drop it.
    DatabaseUnavailable {
        /// Remove this temporary allowance when a genuine production consumer
        /// reads or constructs this item.
        #[cfg_attr(not(test), allow(dead_code))]
        diagnostic: String,
    },
    /// Slice 1 MVP batch: see [`ErrorCode::SessionInvalid`].
    SessionInvalid { diagnostic: String },
    /// Slice 1 MVP batch: see [`ErrorCode::PermissionDenied`].
    PermissionDenied { diagnostic: String },
    /// Slice 1 MVP batch: see [`ErrorCode::ValidationError`].
    ValidationError { diagnostic: String },
    /// Slice 1 MVP batch: see [`ErrorCode::PreconditionFailed`].
    PreconditionFailed { diagnostic: String },
    /// Slice 1 MVP batch: see [`ErrorCode::IdempotencyConflict`].
    IdempotencyConflict { diagnostic: String },
    /// Slice 1 MVP batch: see [`ErrorCode::ImmutableRecord`].
    ImmutableRecord { diagnostic: String },
    /// S2-002: see [`ErrorCode::UnsafeZeroStockValuation`].
    UnsafeZeroStockValuation { diagnostic: String },
}

impl AppError {
    /// Construct an [`AppError::Internal`] with diagnostic context.
    ///
    /// The diagnostic is retained for trusted in-crate handling; it is not
    /// serialized across IPC and is not exposed by `Debug`/`Display`.
    ///
    /// Remove this temporary allowance when a genuine production consumer reads
    /// or constructs this item.
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn internal(diagnostic: impl Into<String>) -> Self {
        AppError::Internal(diagnostic.into())
    }

    /// Construct an [`AppError::DatabaseConfiguration`] with diagnostic context.
    pub fn database_configuration(diagnostic: impl Into<String>) -> Self {
        AppError::DatabaseConfiguration {
            diagnostic: diagnostic.into(),
        }
    }

    /// Construct an [`AppError::DatabaseUnavailable`] with diagnostic context.
    pub fn database_unavailable(diagnostic: impl Into<String>) -> Self {
        AppError::DatabaseUnavailable {
            diagnostic: diagnostic.into(),
        }
    }

    /// Classifies a `sqlx::Error` returned by one of this crate's posting
    /// functions (`inventory.confirm_stock_receipt`,
    /// `sales.confirm_cash_sale`, `sales.open_cash_session`, ...) into the
    /// right [`AppError`] variant, by reading the underlying PostgreSQL
    /// `SQLSTATE` the function's own `RAISE EXCEPTION ... USING ERRCODE =
    /// ...` set. Falls back to [`AppError::Internal`] for anything that
    /// does not carry a recognized, database-reported code (a genuinely
    /// unexpected failure, not a business-rule rejection).
    ///
    /// The full PostgreSQL error text is retained as the diagnostic for
    /// trusted in-crate logging only — never serialized across IPC (see
    /// this module's own top-level documentation).
    pub fn from_posting_error(err: sqlx::Error) -> Self {
        let message = err.to_string();
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
            Some("55000") => AppError::PreconditionFailed {
                diagnostic: message,
            },
            Some("23505") => AppError::IdempotencyConflict {
                diagnostic: message,
            },
            Some("0A000") => AppError::ImmutableRecord {
                diagnostic: message,
            },
            Some("P2002") => AppError::UnsafeZeroStockValuation {
                diagnostic: message,
            },
            _ => AppError::Internal(message),
        }
    }
}

/// Redacted `Debug`: never prints variant payloads, so `{:?}` (including panic
/// output and accidental logging of the error value) cannot leak diagnostics.
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
            AppError::IdempotencyConflict { .. } => {
                f.write_str("AppError::IdempotencyConflict(<redacted>)")
            }
            AppError::ImmutableRecord { .. } => {
                f.write_str("AppError::ImmutableRecord(<redacted>)")
            }
            AppError::UnsafeZeroStockValuation { .. } => {
                f.write_str("AppError::UnsafeZeroStockValuation(<redacted>)")
            }
        }
    }
}

/// Redacted `Display`: stable, non-sensitive text only.
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
            AppError::IdempotencyConflict { .. } => f.write_str("idempotency conflict"),
            AppError::ImmutableRecord { .. } => f.write_str("record is immutable"),
            AppError::UnsafeZeroStockValuation { .. } => f.write_str("unsafe zero-stock valuation"),
        }
    }
}

impl std::error::Error for AppError {}

/// Public, serializable IPC error payload — the only error type allowed across
/// the Tauri IPC boundary.
///
/// Wire shape: `{"code":"<ERROR_CODE>"}`. It contains only the stable public
/// [`ErrorCode`]; no message, source, or diagnostic is ever serialized.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct IpcError {
    pub code: ErrorCode,
}

impl IpcError {
    /// Construct an [`IpcError`] from a public [`ErrorCode`].
    pub const fn new(code: ErrorCode) -> Self {
        Self { code }
    }
}

/// Explicit, exhaustive classification of internal errors into public codes.
///
/// The exhaustive `match` forces every future [`AppError`] variant to be
/// assigned a public [`ErrorCode`] here — new variants fail to compile until
/// classified. Private diagnostics are intentionally dropped; only the public
/// code survives. Do **not** add a `_ =>` arm.
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
            AppError::IdempotencyConflict { .. } => IpcError::new(ErrorCode::IdempotencyConflict),
            AppError::ImmutableRecord { .. } => IpcError::new(ErrorCode::ImmutableRecord),
            AppError::UnsafeZeroStockValuation { .. } => {
                IpcError::new(ErrorCode::UnsafeZeroStockValuation)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A sentinel that must never appear in any serialized or rendered output.
    const SENTINEL: &str = "DO_NOT_EXPOSE_DIAGNOSTIC";

    #[test]
    fn ipc_error_serializes_to_exact_public_shape() {
        let json = serde_json::to_string(&IpcError::new(ErrorCode::InternalError)).unwrap();
        assert_eq!(json, r#"{"code":"INTERNAL_ERROR"}"#);
    }

    #[test]
    fn error_code_is_stable_screaming_snake_case() {
        let json = serde_json::to_string(&ErrorCode::InternalError).unwrap();
        assert_eq!(json, r#""INTERNAL_ERROR""#);
        let json = serde_json::to_string(&ErrorCode::ConfigurationError).unwrap();
        assert_eq!(json, r#""CONFIGURATION_ERROR""#);
        let json = serde_json::to_string(&ErrorCode::DatabaseUnavailable).unwrap();
        assert_eq!(json, r#""DATABASE_UNAVAILABLE""#);
        let json = serde_json::to_string(&ErrorCode::UnsafeZeroStockValuation).unwrap();
        assert_eq!(json, r#""UNSAFE_ZERO_STOCK_VALUATION""#);
    }

    #[test]
    fn explicit_conversion_maps_internal_to_internal_error() {
        let ipc: IpcError = AppError::internal("some private detail").into();
        assert_eq!(ipc, IpcError::new(ErrorCode::InternalError));
        assert_eq!(ipc.code, ErrorCode::InternalError);
    }

    #[test]
    fn explicit_conversion_maps_database_configuration_to_configuration_error() {
        let ipc: IpcError = AppError::database_configuration(SENTINEL).into();
        assert_eq!(ipc, IpcError::new(ErrorCode::ConfigurationError));
    }

    #[test]
    fn explicit_conversion_maps_database_unavailable_to_database_unavailable() {
        let ipc: IpcError = AppError::database_unavailable(SENTINEL).into();
        assert_eq!(ipc, IpcError::new(ErrorCode::DatabaseUnavailable));
    }

    #[test]
    fn unsafe_zero_stock_valuation_is_redacted_and_stable() {
        let app = AppError::UnsafeZeroStockValuation {
            diagnostic: SENTINEL.to_owned(),
        };
        assert!(!format!("{app:?}").contains(SENTINEL));
        let ipc: IpcError = app.into();
        assert_eq!(ipc, IpcError::new(ErrorCode::UnsafeZeroStockValuation));
        assert_eq!(
            serde_json::to_string(&ipc).unwrap(),
            r#"{"code":"UNSAFE_ZERO_STOCK_VALUATION"}"#
        );
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
            assert!(
                !json.contains(SENTINEL),
                "serialized IpcError must not contain private diagnostics"
            );
            assert!(
                json.starts_with(r#"{"code":""#) && json.ends_with(r#""}"#),
                "wire shape must be exactly {{\"code\":\"...\"}}, got {json}"
            );
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
            assert!(!debug.contains(SENTINEL), "Debug must be redacted");
            assert!(!display.contains(SENTINEL), "Display must be redacted");
            assert_eq!(debug, expected_debug);
            assert_eq!(display, expected_display);
        }
    }

    #[test]
    fn internal_diagnostic_remains_available_to_trusted_rust_code() {
        let error = AppError::internal(SENTINEL);
        match error {
            AppError::Internal(diagnostic) => {
                assert_eq!(diagnostic, SENTINEL);
            }
            _ => panic!("expected AppError::Internal"),
        }
    }

    #[test]
    fn database_diagnostics_remain_available_to_trusted_rust_code() {
        match AppError::database_configuration(SENTINEL) {
            AppError::DatabaseConfiguration { diagnostic } => assert_eq!(diagnostic, SENTINEL),
            _ => panic!("expected AppError::DatabaseConfiguration"),
        }
        match AppError::database_unavailable(SENTINEL) {
            AppError::DatabaseUnavailable { diagnostic } => assert_eq!(diagnostic, SENTINEL),
            _ => panic!("expected AppError::DatabaseUnavailable"),
        }
    }
}
