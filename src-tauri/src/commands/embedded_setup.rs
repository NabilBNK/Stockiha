//! WS-K-4 — first-run embedded PostgreSQL setup, driven from the frontend's
//! Start button.
//!
//! Thin by design: all real logic lives in
//! `infrastructure::embedded_setup::run_setup` (Tauri-free, independently
//! tested). This command's only job is resolving the two paths only Tauri
//! knows (`app_data_dir`, `resource_dir`), wiring the progress callback to a
//! real IPC event the frontend listens for, and — on success — relaunching
//! the app via `tauri::process::restart` rather than trying to hot-swap the
//! already-managed `DatabaseState` in place.
//!
//! Restart, not in-place state mutation: `DatabaseState` is managed as a
//! plain, unwrapped value everywhere in this crate (`State<'_, DatabaseState>`
//! in every existing command), resolved once in `lib.rs`'s `.setup()`.
//! Making it mutable after the fact would mean touching every one of those
//! call sites to add lock/unwrap ceremony for a state transition that only
//! ever happens once, at most, per installation. A restart re-runs
//! `.setup()` from scratch, which re-resolves `DatabaseState` through the
//! exact same WS-K-1 precedence a fresh launch would use — guaranteed
//! identical behavior, zero changes to any other command.
//!
//! Deliberately NOT an `async fn` command, and deliberately not run via
//! `tauri::async_runtime::spawn` either: `run_setup`'s own call graph
//! (role/database SQL, migrations, connection verification) chains several
//! locally-defined `async fn`s that each pass a borrowed `&mut PgConnection`/
//! `&str`, and both `#[tauri::command]`'s macro-generated wrapper AND
//! `tauri::async_runtime::spawn` need to prove the WHOLE nested future is
//! `Send` for *any* possible lifetime those borrows could carry — a proof
//! rustc's trait solver cannot generalize across this many nested async fns
//! (confirmed against the real compiler for both approaches: `error:
//! implementation of Send/Acquire is not general enough`, not assumed).
//!
//! `std::thread::spawn` running `tauri::async_runtime::block_on` sidesteps
//! this entirely: `block_on` polls the future to completion on the thread
//! that calls it and never needs the future itself to be `Send` (only the
//! thread closure's own captured, already-owned data does). This is the
//! exact pattern `lib.rs`'s own `.setup()` and `provision_cli.rs` already
//! use successfully for the same reason. The frontend never needed this
//! command's own promise to resolve only once setup finished — the
//! checklist UI is driven entirely by [`SETUP_PROGRESS_EVENT`], so
//! returning immediately after kicking off the background thread changes
//! nothing observable.

use tauri::{AppHandle, Emitter, Manager};

use crate::error::{ErrorCode, IpcError};
use crate::infrastructure::embedded_setup::{self, SetupProgress};
use crate::infrastructure::pg_process::EmbeddedPostgresHandle;

/// Event name the frontend subscribes to for live setup progress. Payload
/// is `SetupProgress`, serialized the same way every other IPC type in this
/// crate is.
pub const SETUP_PROGRESS_EVENT: &str = "embedded-setup-progress";

/// Fixed, low, well-known starting point for the port search — see
/// `infrastructure::pg_process::find_free_port`'s own doc comment for why
/// it is chosen once and then persisted, never re-probed.
const PREFERRED_PORT: u16 = 55432;

#[tauri::command]
pub(crate) fn run_embedded_setup(
    app: AppHandle,
    pg_handle: tauri::State<'_, std::sync::Arc<std::sync::Mutex<EmbeddedPostgresHandle>>>,
) -> Result<(), IpcError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| IpcError::new(ErrorCode::ConfigurationError))?;
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|_| IpcError::new(ErrorCode::ConfigurationError))?;

    // Existing installation repair (pgdata present, database.json missing):
    // reuse whatever port an earlier attempt in this same process run
    // already recorded; otherwise a genuinely fresh install starts the
    // free-port search at PREFERRED_PORT.
    let preferred_port = {
        let guard = pg_handle.lock().unwrap_or_else(|p| p.into_inner());
        if guard.port != 0 {
            guard.port
        } else {
            PREFERRED_PORT
        }
    };

    let handle = pg_handle.inner().clone();
    let emit_app = app.clone();

    std::thread::spawn(move || {
        let emit = move |progress: SetupProgress| {
            // Best-effort: a failure to deliver a progress event must never
            // abort setup itself — the final outcome (and setup.log) remain
            // authoritative regardless of whether any single event reached
            // a listening window.
            let _ = emit_app.emit(SETUP_PROGRESS_EVENT, &progress);
        };

        let result = tauri::async_runtime::block_on(embedded_setup::run_setup(
            app_data_dir,
            resource_dir,
            preferred_port,
            handle,
            emit,
        ));

        if result.is_ok() {
            // Relaunch: .setup() re-resolves DatabaseState from the
            // database.json this run just wrote, via the same WS-K-1
            // precedence a fresh launch would use. Never returns.
            let env = app.env();
            tauri::process::restart(&env);
        }
        // On failure, nothing further to do here: the specific,
        // credential-free reason was already delivered through
        // SETUP_PROGRESS_EVENT (and setup.log) as a `Failed` step, and the
        // frontend's checklist already reflects it.
    });

    Ok(())
}
