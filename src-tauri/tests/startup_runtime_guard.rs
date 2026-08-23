//! Regression guard for `fix/db-pool-acquire-timeout`.
//!
//! Two invariants keep the connection pool bound to a runtime that outlives it,
//! and keep the process to exactly one pool. Both are structural properties of
//! the startup path, so they are asserted by scanning the crate's own source
//! rather than by observing runtime behaviour — a runtime assertion would need
//! a live PostgreSQL server and would therefore be skipped in CI, which is
//! precisely when this guard needs to fire.
//!
//! Invariant 1 — no ad-hoc Tokio runtime anywhere in the crate.
//!   `tokio::runtime::Runtime::new()` (or a hand-built `runtime::Builder`)
//!   creates a runtime that is dropped at the end of its expression or scope.
//!   A `PgPool` built inside one keeps working only until that drop; every
//!   later `acquire()` then fails locally on each retry until `acquire_timeout`
//!   elapses, surfacing as the evidence-free
//!   "pool timed out while waiting for an open connection".
//!   `tauri::async_runtime::block_on` is the correct construct: Tauri holds its
//!   runtime in a `static OnceLock`, so it lives for the whole process and is
//!   the same runtime that every `#[tauri::command]` is spawned onto.
//!
//! Invariant 2 — exactly one pool construction site.
//!   A second `PgPool` would silently double the connection budget and split
//!   state, and is the other classic route to a spurious acquire timeout.

use std::fs;
use std::path::{Path, PathBuf};

/// Every `.rs` file under `src-tauri/src`, recursively.
fn crate_sources() -> Vec<PathBuf> {
    fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
        let entries = fs::read_dir(dir).unwrap_or_else(|e| panic!("cannot read {dir:?}: {e}"));
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(&path, out);
            } else if path.extension().is_some_and(|ext| ext == "rs") {
                out.push(path);
            }
        }
    }

    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut files = Vec::new();
    walk(&root, &mut files);
    assert!(
        files.len() > 10,
        "source scan found only {} files — the guard is not looking where it thinks it is",
        files.len()
    );
    files
}

/// Path relative to `src-tauri/`, for readable failure messages.
fn label(path: &Path) -> String {
    path.strip_prefix(Path::new(env!("CARGO_MANIFEST_DIR")))
        .unwrap_or(path)
        .display()
        .to_string()
        .replace('\\', "/")
}

#[test]
fn no_ad_hoc_tokio_runtime_is_constructed_in_the_crate() {
    // Substrings that all denote "build a runtime I own and will drop".
    const FORBIDDEN: [&str; 4] = [
        "Runtime::new()",
        "runtime::Builder::new_multi_thread",
        "runtime::Builder::new_current_thread",
        "futures::executor::block_on",
    ];

    let mut offences = Vec::new();
    for path in crate_sources() {
        let source = fs::read_to_string(&path).expect("source file must be readable");
        for (index, line) in source.lines().enumerate() {
            // Comments and doc-comments discuss these constructs by name on
            // purpose; only real code counts.
            let code = line.trim_start();
            if code.starts_with("//") || code.starts_with("*") {
                continue;
            }
            for needle in FORBIDDEN {
                if code.contains(needle) {
                    offences.push(format!("{}:{} — {}", label(&path), index + 1, code.trim()));
                }
            }
        }
    }

    assert!(
        offences.is_empty(),
        "an application-owned Tokio runtime was introduced. A PgPool built on a \
         runtime that is later dropped fails every acquire until it times out as \
         \"pool timed out while waiting for an open connection\". Use \
         tauri::async_runtime::block_on / spawn instead.\nOffending lines:\n  {}",
        offences.join("\n  ")
    );
}

#[test]
fn exactly_one_pgpool_is_constructed_outside_tests() {
    // `build_pool` is the sole wrapper around `PgPoolOptions`; any other
    // occurrence is a second pool.
    let mut sites = Vec::new();
    for path in crate_sources() {
        let source = fs::read_to_string(&path).expect("source file must be readable");
        for (index, line) in source.lines().enumerate() {
            let code = line.trim_start();
            if code.starts_with("//") || code.starts_with("*") {
                continue;
            }
            if code.contains("PgPoolOptions::new()") {
                sites.push(format!("{}:{}", label(&path), index + 1));
            }
        }
    }

    assert_eq!(
        sites.len(),
        1,
        "expected exactly one PgPool construction site (infrastructure::db::build_pool), \
         found {}: {:?}",
        sites.len(),
        sites
    );
    assert!(
        sites[0].starts_with("src/infrastructure/db.rs"),
        "the single PgPool construction site moved out of infrastructure::db: {}",
        sites[0]
    );
}

#[test]
fn startup_builds_database_state_exactly_once() {
    let entry = fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("src/lib.rs"))
        .expect("src/lib.rs must be readable");

    let calls = entry.matches("database_state_from_env()").count();
    assert_eq!(
        calls, 1,
        "src/lib.rs must build the managed DatabaseState exactly once, found {calls}"
    );
    assert!(
        entry.contains("tauri::async_runtime::block_on"),
        "the pool must be created on Tauri's own runtime via tauri::async_runtime::block_on"
    );
}
