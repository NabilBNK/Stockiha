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
    Internal(String),
    /// The database connection configuration is missing or could not be
    /// parsed (S0-003). The diagnostic may reference the environment variable
    /// name or a parse failure; it must never contain a secret value and is
    /// never serialized across IPC nor exposed by `Debug`/`Display`.
    DatabaseConfiguration { diagnostic: String },
    /// The database could not be reached, refused the connection, failed
    /// authentication, or timed out (S0-003). The diagnostic may contain raw
    /// SQLx/PostgreSQL error text; it is never serialized across IPC nor
    /// exposed by `Debug`/`Display`.
    DatabaseUnavailable { diagnostic: String },
}

impl AppError {
    /// Construct an [`AppError::Internal`] with diagnostic context.
    ///
    /// The diagnostic is retained for trusted in-crate handling; it is not
    /// serialized across IPC and is not exposed by `Debug`/`Display`.
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
