//! WS-H-3 — the embedded backup & recovery engine.
//!
//! Everything in this module is Tauri-free (like `safe_upgrade`): pure
//! decisions, filesystem work, bundled-binary child processes, and SQLx
//! connections opened with the migrator credential. The Tauri wrapper that
//! resolves the mode from an `AppHandle` lives in `commands::recovery`; the
//! audit/orchestration layer lives in `application::recovery_embedded`.
//!
//! Two recovery modes exist at runtime (plan R1):
//!
//! - `EXTERNAL` — `STOCKIHA_DEV_DATABASE_URL` is set (developer `run.bat`).
//!   Every pre-existing WS-H-1/WS-H-2 code path in `application::recovery`
//!   and `application::recovery_creation` runs unchanged.
//! - `EMBEDDED` — no env var, a `migrator.json` on file, app-data and
//!   resource directories resolvable. This module implements that mode.
//!
//! Security invariants (plan §4.2): the migrator password only ever goes
//! into a child process's `PGPASSWORD`; every child process is spawned
//! through `pg_process::hide_console_window`; `recovery.log` never receives
//! a password or a connection string.

pub(crate) mod backup;
pub(crate) mod bundle;
// WS-H-4: read-only backup list, folder-to-folder copy, and the isolated
// restore test (throwaway cluster + drill).
pub(crate) mod catalog;
pub(crate) mod copy;
pub(crate) mod destination;
pub(crate) mod drill;
pub(crate) mod drill_cluster;
pub(crate) mod errors;
pub(crate) mod log;
pub(crate) mod mode;
pub(crate) mod schema;
// WS-H-4 (H4-08): removes drill clusters abandoned by a crashed process.
pub(crate) mod sweep;
pub(crate) mod tools;

/// Windows reparse points (junctions, symlinks, mount points) are never
/// followed by any recovery path: a backup destination, a bundle folder, or
/// an asset directory that is a link is rejected outright. Same rule the
/// legacy `application::recovery` helpers apply; duplicated here so the
/// engine stays independent of the application layer.
#[cfg(windows)]
pub(crate) fn is_symlink_or_reparse(metadata: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    metadata.file_type().is_symlink()
        || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
pub(crate) fn is_symlink_or_reparse(metadata: &std::fs::Metadata) -> bool {
    metadata.file_type().is_symlink()
}
