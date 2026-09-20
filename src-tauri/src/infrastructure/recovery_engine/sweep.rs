//! Startup sweep of abandoned drill clusters (plan H4-08).
//!
//! A drill cluster left behind by a crash (killed from Task Manager mid-test)
//! is a real `postgres.exe` still holding a data directory. This runs once
//! at startup, on a background thread so it never delays the window, and
//! only ever touches folders that carry the drill marker file — never a
//! folder without it, and never the live `pgdata` itself.

use std::path::Path;
use std::time::Duration;

use super::drill_cluster::{DRILL_DIR_PREFIX, DRILL_MARKER_FILE};
use crate::infrastructure::pg_process::{self, PidStatus};

const SWEEP_STOP_TIMEOUT: Duration = Duration::from_secs(10);

/// Remove every abandoned drill folder beside `pgdata`. Returns the removed
/// folder names (for logging). `pgdata` itself is never touched — only its
/// sibling `restore-drill-*` folders.
pub(crate) fn sweep_abandoned_drills(pgdata: &Path, bin_dir: &Path) -> Vec<String> {
    let Some(parent) = pgdata.parent() else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(parent) else {
        return Vec::new();
    };

    // Read the live server's PID once, before deciding anything about any
    // drill folder, so every comparison below uses the same snapshot.
    let live_pid = pg_process::read_postmaster_pid(pgdata);

    let mut removed = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(metadata) = std::fs::symlink_metadata(&path) else {
            continue;
        };
        if !metadata.is_dir() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        // Never touch a folder without the drill's own prefix, and never
        // one without the marker file — both are required before this
        // function will delete anything.
        if !name.starts_with(DRILL_DIR_PREFIX) || !path.join(DRILL_MARKER_FILE).is_file() {
            continue;
        }

        let drill_data = path.join("data");
        match pg_process::read_postmaster_pid(&drill_data) {
            Some(drill_pid) if Some(drill_pid) == live_pid => {
                // The drill's recorded PID has been reused by the live
                // server (or coincides with it) — never signal a process we
                // cannot positively attribute to this drill. Leave the
                // folder for a human to look at rather than risk it.
                continue;
            }
            Some(drill_pid) if pg_process::check_postmaster_pid(drill_pid) == PidStatus::Alive => {
                let _ = pg_process::stop_postgres(bin_dir, &drill_data, SWEEP_STOP_TIMEOUT);
            }
            _ => {}
        }

        if std::fs::remove_dir_all(&path).is_ok() {
            removed.push(name.to_string());
        }
    }
    removed
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn scratch(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "sk-sweep-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A fake, unreachable bin_dir: any stop attempt in these tests fails
    /// harmlessly (no PID is ever actually alive in a unit test), which is
    /// fine — the assertions are about which folders get removed.
    fn fake_bin_dir() -> std::path::PathBuf {
        std::env::temp_dir().join("sk-sweep-fake-bin-dir-does-not-exist")
    }

    #[test]
    fn a_folder_without_the_marker_is_left_untouched() {
        let root = scratch("no-marker");
        let pgdata = root.join("pgdata");
        fs::create_dir_all(&pgdata).unwrap();
        let stray = root.join(format!("{DRILL_DIR_PREFIX}12345-1"));
        fs::create_dir_all(&stray).unwrap();
        // Deliberately no marker file.

        let removed = sweep_abandoned_drills(&pgdata, &fake_bin_dir());
        assert!(removed.is_empty());
        assert!(
            stray.exists(),
            "a folder without the marker must never be deleted"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn a_marked_folder_with_no_recorded_pid_is_removed() {
        let root = scratch("no-pid");
        let pgdata = root.join("pgdata");
        fs::create_dir_all(&pgdata).unwrap();
        let drill = root.join(format!("{DRILL_DIR_PREFIX}12345-1"));
        fs::create_dir_all(drill.join("data")).unwrap();
        fs::write(drill.join(DRILL_MARKER_FILE), "pid=12345\nstarted=1\n").unwrap();
        // No postmaster.pid inside drill/data — the process never started
        // or already exited; nothing to signal, but the folder is removable.

        let removed = sweep_abandoned_drills(&pgdata, &fake_bin_dir());
        assert_eq!(
            removed,
            vec![drill.file_name().unwrap().to_string_lossy().into_owned()]
        );
        assert!(!drill.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn a_drill_pid_equal_to_the_live_pid_is_never_signalled_or_removed() {
        let root = scratch("pid-reuse");
        let pgdata = root.join("pgdata");
        fs::create_dir_all(&pgdata).unwrap();
        // The live server's own postmaster.pid.
        fs::write(pgdata.join("postmaster.pid"), "777\n").unwrap();

        let drill = root.join(format!("{DRILL_DIR_PREFIX}12345-1"));
        fs::create_dir_all(drill.join("data")).unwrap();
        fs::write(drill.join(DRILL_MARKER_FILE), "pid=12345\nstarted=1\n").unwrap();
        // The drill's own recorded PID coincides with the live server's.
        fs::write(drill.join("data").join("postmaster.pid"), "777\n").unwrap();

        let removed = sweep_abandoned_drills(&pgdata, &fake_bin_dir());
        assert!(removed.is_empty());
        assert!(
            drill.exists(),
            "PID reuse must never be signalled or removed"
        );
        let _ = fs::remove_dir_all(root);
    }
}
