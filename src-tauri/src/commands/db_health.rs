//! S0-003 — Thin Tauri command exposing the database connectivity proof.
//!
//! The command owns no logic: it delegates to
//! `infrastructure::db::health_check_state` and converts the internal
//! [`AppError`](crate::error::AppError) into the public
//! [`IpcError`](crate::error::IpcError) at the boundary. Success carries only
//! a typed `CONNECTED` status — never a host, port, database name, server
//! version, URL, or any SQLx detail.

use crate::error::IpcError;
use crate::infrastructure::db::{self, DatabaseState};
use serde::Serialize;
use tauri::State;

/// Typed health status. `CONNECTED` is the only success value; failures are
/// reported through the `IpcError` rejection channel, never in this payload.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum DbHealthStatus {
    Connected,
}

/// Minimal health response serialized to the frontend: `{"status":"CONNECTED"}`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct DbHealthReport {
    pub status: DbHealthStatus,
}

/// Run the `SELECT 1` connectivity proof against the managed database state.
///
/// Declared `pub(crate)` (not `pub`) so its signature — which names the
/// crate-private [`IpcError`] and [`DatabaseState`] — does not expose private
/// types through a public interface. `tauri::generate_handler!` in `lib.rs`
/// reaches it from the crate root regardless.
#[tauri::command]
pub(crate) async fn check_db_health(
    state: State<'_, DatabaseState>,
) -> Result<DbHealthReport, IpcError> {
    db::health_check_state(state.inner())
        .await
        .map(|()| DbHealthReport {
            status: DbHealthStatus::Connected,
        })
        .map_err(IpcError::from)
}

/// Report the current, credential-free reason the database is unreachable.
///
/// A deliberate exception to the rule that failures carry no detail through
/// IPC — and the reason it is safe: [`db::DbDiagnostic`] is assembled in
/// `infrastructure::db` from a closed set of reason codes plus a
/// [`ConnectionTarget`](db::ConnectionTarget) that structurally cannot hold a
/// password, never from the connection URL. The `IpcError` channel is
/// unchanged and still detail-free; this is a separate, explicitly redacted
/// channel the "Service unavailable" screen calls only when it is already
/// showing an error, so the Project Owner can report a reason code without
/// reading logs.
///
/// Infallible by design: a diagnostic must never itself fail to be reported.
#[tauri::command]
pub(crate) async fn get_db_diagnostic(
    state: State<'_, DatabaseState>,
) -> Result<db::DbDiagnostic, IpcError> {
    Ok(db::diagnose(state.inner()).await)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn health_report_serializes_to_minimal_typed_status() {
        let report = DbHealthReport {
            status: DbHealthStatus::Connected,
        };
        let json = serde_json::to_string(&report).unwrap();
        assert_eq!(json, r#"{"status":"CONNECTED"}"#);
    }
}
