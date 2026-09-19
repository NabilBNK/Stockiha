//! `<app_data_dir>\recovery.log` — append-only, one line per event
//! (plan §4.6): `[RFC3339 UTC] <OPERATION> <STEP>: <STATUS> [- detail]`.
//!
//! Same helper style as `safe_upgrade::append_upgrade_log`. Errors are
//! ignored on purpose (edge case E-30): a log that cannot be written must
//! never stop a backup or a restore. Callers are responsible for never
//! passing a password or a connection string in `line`; child-process
//! stderr is trimmed to [`MAX_DETAIL_CHARS`] before it gets here.

use std::io::Write;
use std::path::Path;

pub(crate) const LOG_FILE_NAME: &str = "recovery.log";

/// Upper bound on child-process stderr kept in a log detail (plan §4.6).
pub(crate) const MAX_DETAIL_CHARS: usize = 500;

pub(crate) fn append(app_data_dir: &Path, operation: &str, line: &str) {
    let timestamp = time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default();
    let timestamped = format!("[{timestamp}] {operation} {line}\n");
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(app_data_dir.join(LOG_FILE_NAME))
    {
        let _ = file.write_all(timestamped.as_bytes());
    }
    tracing::warn!("recovery {operation} {line}");
}

/// Trim free-form process output to the log's detail budget, on a char
/// boundary, so a 40 KB `pg_dump` stack trace does not bloat the log.
pub(crate) fn trim_detail(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= MAX_DETAIL_CHARS {
        return trimmed.to_string();
    }
    trimmed.chars().take(MAX_DETAIL_CHARS).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appends_one_timestamped_line_per_event() {
        let dir = std::env::temp_dir().join(format!(
            "sk-recovery-log-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        append(&dir, "BACKUP", "PREFLIGHT: RUNNING");
        append(&dir, "BACKUP", "PREFLIGHT: DONE - ok");
        let text = std::fs::read_to_string(dir.join(LOG_FILE_NAME)).unwrap();
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].starts_with('['));
        assert!(lines[0].ends_with("] BACKUP PREFLIGHT: RUNNING"));
        assert!(lines[1].ends_with("] BACKUP PREFLIGHT: DONE - ok"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_missing_directory_is_silently_ignored() {
        let missing = std::env::temp_dir().join("sk-recovery-log-does-not-exist-anywhere");
        append(&missing, "BACKUP", "x");
        assert!(!missing.exists());
    }

    #[test]
    fn detail_is_trimmed_to_the_budget() {
        let long = "é".repeat(MAX_DETAIL_CHARS + 50);
        assert_eq!(trim_detail(&long).chars().count(), MAX_DETAIL_CHARS);
        assert_eq!(trim_detail("  short  "), "short");
    }
}
