//! WS-K-7 — file-based licence storage: `licence.key`, `licence-state.json`,
//! and the append-only `licence.log` (plan §3.5, §3.6, §5.3, §5.4).
//!
//! Every write here is atomic (temp file + `sync_all` + rename), and every
//! read treats a missing or corrupt file as "no value" rather than an
//! error — the evaluator (`super::evaluator`) already handles `None` inputs
//! correctly, so a damaged file self-heals on the next successful write
//! rather than ever blocking the app.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration as StdDuration, Instant};

use serde::{Deserialize, Serialize};
use time::OffsetDateTime;

use super::{LICENCE_FILE, LOG_FILE, STATE_FILE};

/// Set once, at `LicenceRuntime::new`, so the rate-limited [`log_blocked`]
/// call from the `invoke_handler` gate (plan §6.1) — which has no natural
/// way to thread an `app_data_dir` through a plain `Fn(Invoke<R>) -> bool`
/// closure on every call — can still find the log file.
static APP_DATA_DIR: OnceLock<Option<PathBuf>> = OnceLock::new();

pub(crate) fn set_app_data_dir(dir: Option<PathBuf>) {
    // Only ever called once, from `LicenceRuntime::new`; `set` is a no-op
    // if already set.
    let _ = APP_DATA_DIR.set(dir);
}

fn app_data_dir() -> Option<PathBuf> {
    APP_DATA_DIR.get().cloned().flatten()
}

/// Write `contents` to `path` atomically: a sibling temp file, flushed and
/// `sync_all`ed, then renamed over the target. The temp file is removed on
/// any error. `create_dir_all`s the parent directory first (plan §5.3).
fn write_atomic(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("licence");
    let tmp_path = path.with_file_name(format!(
        "{file_name}.tmp-{}-{}",
        std::process::id(),
        OffsetDateTime::now_utc().unix_timestamp_nanos(),
    ));

    let result = (|| -> std::io::Result<()> {
        use std::io::Write;
        let mut file = std::fs::File::create(&tmp_path)?;
        file.write_all(contents)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&tmp_path, path)?;
        Ok(())
    })();

    if result.is_err() {
        let _ = std::fs::remove_file(&tmp_path);
    }
    result
}

// ——— licence.key (plan §3.5) ———

/// A single line containing the licence key string exactly as accepted,
/// after whitespace removal. `None` when the file is missing, empty, or
/// unreadable — never an error.
pub(crate) fn read_licence_key(app_data_dir: &Path) -> Option<String> {
    let contents = std::fs::read_to_string(app_data_dir.join(LICENCE_FILE)).ok()?;
    let trimmed = contents.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_owned())
    }
}

pub(crate) fn write_licence_key(app_data_dir: &Path, key: &str) -> std::io::Result<()> {
    write_atomic(&app_data_dir.join(LICENCE_FILE), key.trim().as_bytes())
}

pub(crate) fn remove_licence_key(app_data_dir: &Path) -> std::io::Result<()> {
    match std::fs::remove_file(app_data_dir.join(LICENCE_FILE)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

// ——— licence-state.json (plan §3.6) ———

#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct StateFileValues {
    pub first_seen: Option<OffsetDateTime>,
    pub last_seen: Option<OffsetDateTime>,
}

#[derive(Serialize, Deserialize)]
struct StateFileV1 {
    v: u32,
    #[serde(with = "time::serde::rfc3339::option")]
    first_seen_utc: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339::option")]
    last_seen_utc: Option<OffsetDateTime>,
}

/// A missing or corrupt file reads as "no file values", never an error
/// (plan §3.6).
pub(crate) fn read_state_file(app_data_dir: &Path) -> StateFileValues {
    let Ok(contents) = std::fs::read_to_string(app_data_dir.join(STATE_FILE)) else {
        return StateFileValues::default();
    };
    let Ok(parsed) = serde_json::from_str::<StateFileV1>(&contents) else {
        return StateFileValues::default();
    };
    StateFileValues {
        first_seen: parsed.first_seen_utc,
        last_seen: parsed.last_seen_utc,
    }
}

pub(crate) fn write_state_file(
    app_data_dir: &Path,
    first_seen: OffsetDateTime,
    last_seen: OffsetDateTime,
) -> std::io::Result<()> {
    let value = StateFileV1 {
        v: 1,
        first_seen_utc: Some(first_seen),
        last_seen_utc: Some(last_seen),
    };
    // `OffsetDateTime` via `rfc3339` cannot fail to serialize for any value
    // this module ever constructs (no BCE/far-future dates in play).
    let json = serde_json::to_vec(&value).unwrap_or_default();
    write_atomic(&app_data_dir.join(STATE_FILE), &json)
}

// ——— licence.log (plan §5.4) ———

/// Append one line, best-effort: errors writing the log are ignored (plan
/// §5.4). Never writes the licence key text, the raw machine GUID, or any
/// password — only the fixed event name and the non-secret detail string
/// the caller passes in.
pub(crate) fn log_event(app_data_dir: Option<&Path>, event: &str, details: &str) {
    let Some(dir) = app_data_dir else {
        return;
    };
    let timestamp = OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default();
    let line = format!("[{timestamp}] {event} {details}\n");

    if std::fs::create_dir_all(dir).is_err() {
        return;
    }
    use std::io::Write;
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join(LOG_FILE))
    {
        let _ = file.write_all(line.as_bytes());
    }
}

/// Rate-limited (at most once per command per minute) log line for a
/// command the gate blocked (plan §6.1). Uses the `app_data_dir` recorded
/// once via [`set_app_data_dir`], since the `invoke_handler` closure has no
/// other natural way to reach it on every call.
pub(crate) fn log_blocked(command: &str) {
    static LAST_LOGGED: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();
    let map = LAST_LOGGED.get_or_init(|| Mutex::new(HashMap::new()));
    let mut guard = map.lock().unwrap_or_else(|poisoned| poisoned.into_inner());

    let now = Instant::now();
    let should_log = match guard.get(command) {
        Some(last) => now.duration_since(*last) >= StdDuration::from_secs(60),
        None => true,
    };
    if !should_log {
        return;
    }
    guard.insert(command.to_owned(), now);
    drop(guard);

    log_event(
        app_data_dir().as_deref(),
        "BLOCKED",
        &format!("command={command}"),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "sk-licence-storage-{label}-{}-{}",
            std::process::id(),
            line!()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn atomic_write_leaves_no_temp_file() {
        let dir = temp_dir("atomic");
        write_licence_key(&dir, "STKL1.abc.def").unwrap();
        let entries: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(entries, vec![LICENCE_FILE.to_owned()]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_state_file_reads_as_none() {
        let dir = temp_dir("missing-state");
        let values = read_state_file(&dir);
        assert!(values.first_seen.is_none());
        assert!(values.last_seen.is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn corrupt_state_file_reads_as_none() {
        let dir = temp_dir("corrupt-state");
        std::fs::write(dir.join(STATE_FILE), "{ not json").unwrap();
        let values = read_state_file(&dir);
        assert!(values.first_seen.is_none());
        assert!(values.last_seen.is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn state_file_round_trips() {
        let dir = temp_dir("round-trip");
        let first = OffsetDateTime::from_unix_timestamp(1_700_000_000).unwrap();
        let last = OffsetDateTime::from_unix_timestamp(1_700_100_000).unwrap();
        write_state_file(&dir, first, last).unwrap();
        let values = read_state_file(&dir);
        assert_eq!(values.first_seen, Some(first));
        assert_eq!(values.last_seen, Some(last));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn licence_key_round_trips_and_removes() {
        let dir = temp_dir("key-round-trip");
        assert!(read_licence_key(&dir).is_none());
        write_licence_key(&dir, "  STKL1.abc.def  \n").unwrap();
        assert_eq!(read_licence_key(&dir), Some("STKL1.abc.def".to_owned()));
        remove_licence_key(&dir).unwrap();
        assert!(read_licence_key(&dir).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
