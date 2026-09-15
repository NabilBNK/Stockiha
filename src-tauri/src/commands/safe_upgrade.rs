//! WS-K-5 — safe automatic database upgrade, driven from the frontend the
//! moment the upgrade screen mounts (no Start button: unlike first-run
//! setup, applying this is not optional for the app to work).
//!
//! Thin by design, mirroring `commands::embedded_setup` exactly: all real
//! logic lives in `infrastructure::safe_upgrade::run_safe_upgrade`
//! (Tauri-free, independently tested against a real embedded instance).
//! This command resolves the two paths only Tauri knows, wires the progress
//! callback to a real IPC event, and — on a successful upgrade — restarts
//! the app the same way first-run setup does, so the relaunched process
//! resolves `DatabaseState` fresh against the now-current schema. On
//! failure (aborted before migration, rolled back, or a failed rollback)
//! the process is deliberately NOT restarted: the final progress event
//! carries enough detail for the screen to render the right one of those
//! three outcomes, and restarting would only return the operator to the
//! exact same diagnostic that led here.
//!
//! Deliberately not an `async fn` command and not `tauri::async_runtime::
//! spawn`, for the identical `Send`-generality reason documented on
//! `commands::embedded_setup::run_embedded_setup`: `std::thread::spawn`
//! running `tauri::async_runtime::block_on` sidesteps it.

use tauri::{AppHandle, Emitter, Manager};

use crate::error::{ErrorCode, IpcError};
use crate::infrastructure::pg_process;
use crate::infrastructure::safe_upgrade::{self, UpgradeError, UpgradeOutcome, UpgradeProgress};

/// Event name the frontend subscribes to for live upgrade progress. Payload
/// is `UpgradeProgress`, serialized the same way every other IPC type in
/// this crate is.
pub const SAFE_UPGRADE_PROGRESS_EVENT: &str = "safe-upgrade-progress";

/// Terminal event fired exactly once, after the last progress event, stating
/// how the attempt ended. Kept separate from `UpgradeProgress` (which only
/// ever carries one step's status) because the three failure shapes here —
/// aborted before anything changed, rolled back, or rollback itself failed —
/// are a fact about the *whole attempt*, not about any single step, and the
/// wording each one needs is materially different (see the frontend copy).
#[derive(Clone, serde::Serialize)]
#[serde(tag = "outcome", rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum SafeUpgradeOutcomeEvent {
    /// The database was never touched. `backup_path` is set only when a
    /// backup was taken but failed verification.
    AbortedBeforeMigration {
        reason: String,
        backup_path: Option<String>,
    },
    /// Rolled back successfully to the exact pre-upgrade state.
    RolledBack { reason: String, backup_path: String },
    /// The worst case: rollback itself failed. `rollback_error` is shown
    /// alongside `backup_path` so the operator's supplier has everything
    /// needed without reading logs.
    RollbackFailed {
        reason: String,
        backup_path: String,
        rollback_error: String,
    },
}

pub const SAFE_UPGRADE_OUTCOME_EVENT: &str = "safe-upgrade-outcome";

#[tauri::command]
pub(crate) fn run_safe_database_upgrade(app: AppHandle) -> Result<(), IpcError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| IpcError::new(ErrorCode::ConfigurationError))?;
    let resource_dir = pg_process::bundled_resource_dir()
        .or_else(|| app.path().resource_dir().ok())
        .ok_or_else(|| IpcError::new(ErrorCode::ConfigurationError))?;
    let bin_dir = pg_process::bundled_bin_dir(&resource_dir);

    let emit_app = app.clone();

    std::thread::spawn(move || {
        let emit = move |progress: UpgradeProgress| {
            let _ = emit_app.emit(SAFE_UPGRADE_PROGRESS_EVENT, &progress);
        };

        let result = tauri::async_runtime::block_on(safe_upgrade::run_safe_upgrade(
            &app_data_dir,
            &bin_dir,
            emit,
        ));

        match result {
            Ok(UpgradeOutcome::Upgraded { .. })
            | Ok(UpgradeOutcome::NoActionNeeded(_))
            | Ok(UpgradeOutcome::NotEmbedded) => {
                // Every success shape (including "there was nothing to do",
                // which should not normally be reachable from this screen
                // but is handled identically rather than left undefined)
                // relaunches: a fresh `.setup()` resolves `DatabaseState`
                // against whatever the schema now actually is, exactly like
                // first-run setup's own restart.
                let env = app.env();
                tauri::process::restart(&env);
            }
            Err(err) => {
                let event = match err {
                    UpgradeError::AbortedBeforeMigration {
                        reason,
                        backup_path,
                    } => SafeUpgradeOutcomeEvent::AbortedBeforeMigration {
                        reason,
                        backup_path: backup_path.map(|p| p.display().to_string()),
                    },
                    UpgradeError::RolledBack {
                        reason,
                        backup_path,
                    } => SafeUpgradeOutcomeEvent::RolledBack {
                        reason,
                        backup_path: backup_path.display().to_string(),
                    },
                    UpgradeError::RollbackFailed {
                        reason,
                        backup_path,
                        rollback_error,
                    } => SafeUpgradeOutcomeEvent::RollbackFailed {
                        reason,
                        backup_path: backup_path.display().to_string(),
                        rollback_error,
                    },
                };
                let _ = emit_app_outcome(&app, event);
            }
        }
    });

    Ok(())
}

fn emit_app_outcome(app: &AppHandle, event: SafeUpgradeOutcomeEvent) -> Result<(), tauri::Error> {
    app.emit(SAFE_UPGRADE_OUTCOME_EVENT, &event)
}
