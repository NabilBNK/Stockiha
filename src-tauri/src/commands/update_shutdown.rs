//! WS-K-6 — stop the embedded PostgreSQL server before letting the
//! updater's installer run, and confirm it actually took effect.
//!
//! # The defect this closes, and the evidence behind the fix
//!
//! Real-hardware testing found NSIS failing to overwrite a bundled
//! PostgreSQL runtime DLL mid-update:
//!
//! ```text
//! Extract: postgres\win64\bin\ecpg.exe
//! Can't write: ...\postgres\win64\bin\icudt77.dll
//! ```
//!
//! with the classic Abort/Retry/Ignore dialog. Root cause, confirmed by
//! reading `tauri-plugin-updater 2.11.0`'s own source
//! (`src/updater.rs`, Windows `install_inner`), not assumed:
//!
//! - A successful install on Windows ends with a direct
//!   `std::process::exit(0)` call (line ~876 of that file).
//! - Immediately before it, the plugin runs its own `on_before_exit` hook
//!   — which (see the plugin's `lib.rs`) calls only
//!   `AppHandle::cleanup_before_exit()`.
//! - `cleanup_before_exit` (Tauri core, `app.rs`) is documented as
//!   "runs necessary cleanup tasks before exiting the process"; reading
//!   its actual body shows it clears internal resource tables and hides
//!   windows — nothing about a child process, and it does **not** dispatch
//!   `tauri::RunEvent::Exit`.
//! - This crate's own PostgreSQL shutdown logic lives entirely inside the
//!   `RunEvent::Exit` handler in `lib.rs`. A raw `std::process::exit(0)`
//!   runs no Rust destructors and reaches no event-loop callback, so that
//!   handler never runs on this path — this app's own embedded
//!   `postgres.exe`, actively serving the live database up to that
//!   instant, is still fully alive when NSIS starts overwriting its files.
//!
//! The fix is sequencing, not a race to win against the plugin's internal
//! exit call: the frontend (`src/features/update/useAppUpdate.ts`) calls
//! `download()` first (no risk yet — nothing has been touched), then this
//! command, then `install()` only if this command succeeds. If this
//! command fails, `install()` is never called at all: the previous version
//! keeps running, database included, completely untouched.
//!
//! `prepare_for_update_install` reuses [`pg_process::
//! stop_embedded_postgres_if_running`] — the exact same function the
//! `RunEvent::Exit` hook calls — so there is exactly one implementation of
//! "stop it, and mean it", not two that could drift apart. It additionally
//! waits, with a bound, for the specific resource files a previous attempt
//! failed on to become genuinely writable (see [`pg_process::
//! wait_until_resources_unlocked`]'s own doc comment for why that check,
//! not "is postgres.exe still in the process table", is what this
//! confirms) — a confirmed-stopped postmaster's own worker processes do
//! not always finish tearing down at the exact instant it reports stopped.

use crate::infrastructure::embedded_setup;
use crate::infrastructure::pg_process::{self, EmbeddedPostgresHandle};
use std::time::Duration;

/// Generous relative to [`embedded_setup::STOP_GRACEFUL_TIMEOUT`] (the
/// graceful/escalated stop itself): this is the *additional* bounded wait
/// for the specific files a previous failure was reported against to
/// become writable, on top of the stop already completing.
const RESOURCE_UNLOCK_TIMEOUT: Duration = Duration::from_secs(15);

#[tauri::command]
pub(crate) fn prepare_for_update_install(
    pg_handle: tauri::State<'_, std::sync::Arc<std::sync::Mutex<EmbeddedPostgresHandle>>>,
) -> Result<(), String> {
    pg_process::stop_embedded_postgres_if_running(
        pg_handle.inner(),
        embedded_setup::STOP_GRACEFUL_TIMEOUT,
    )
    .map_err(|detail| {
        format!("could not stop the database before installing the update ({detail})")
    })?;

    let bin_dir = {
        let guard = pg_handle.lock().unwrap_or_else(|p| p.into_inner());
        guard.bin_dir.clone()
    };
    if bin_dir.as_os_str().is_empty() {
        // Nothing was ever resolved (should not be reachable once the app
        // has reached a normal, logged-in state where an update can even
        // be offered) — nothing to check.
        return Ok(());
    }

    if pg_process::wait_until_resources_unlocked(&bin_dir, RESOURCE_UNLOCK_TIMEOUT) {
        Ok(())
    } else {
        Err(
            "a program is still using files Stockiha needs to replace, even after waiting. \
             Try again in a moment, or restart the computer and try once more."
                .to_string(),
        )
    }
}

/// Best-effort recovery if `install()` itself fails AFTER
/// `prepare_for_update_install` already stopped PostgreSQL (or if
/// `prepare_for_update_install` itself refused because files stayed
/// locked — that path stops PostgreSQL too, before checking) — restarts it
/// so the shop stays fully usable on the still-installed previous version
/// rather than being left with a stopped database and no update either.
/// Rare in practice: by the time this could matter, the update package is
/// already downloaded and its signature already verified, so there is
/// little left to fail — but "rare" is not "impossible", and a forced
/// update must never leave a shop worse off than before it began.
#[tauri::command]
pub(crate) async fn resume_after_failed_update_install(
    pg_handle: tauri::State<'_, std::sync::Arc<std::sync::Mutex<EmbeddedPostgresHandle>>>,
) -> Result<(), String> {
    let (bin_dir, pgdata, port) = {
        let guard = pg_handle.lock().unwrap_or_else(|p| p.into_inner());
        (guard.bin_dir.clone(), guard.pgdata.clone(), guard.port)
    };
    if bin_dir.as_os_str().is_empty() {
        return Ok(());
    }
    let child = pg_process::ensure_running(bin_dir, pgdata, port)
        .await
        .map_err(|e| {
            format!("could not restart the database after a failed update install ({e})")
        })?;
    if let Some(child) = child {
        let mut guard = pg_handle.lock().unwrap_or_else(|p| p.into_inner());
        guard.child = Some(child);
    }
    Ok(())
}
