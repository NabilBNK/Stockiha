//! Bundled `pg_dump` / `pg_restore` invocations for EMBEDDED mode.
//!
//! Only the bundled binaries in `<bin_dir>` are ever run — never anything
//! found on `PATH` (ruling R2). Every command goes through
//! `pg_process::hide_console_window` (no black window on the client PC),
//! passwords go only into the child's `PGPASSWORD`, stdin/stdout are null and
//! stderr is captured and trimmed for `recovery.log`.
//!
//! The legacy `backup_proof::discover_and_validate_pg_dump` /
//! `run_pg_dump` are deliberately not reused: they neither hide the console
//! nor authenticate as the migrator, and format 1 dumps drop privileges.

use std::path::Path;
use std::process::{Command, Stdio};

use super::errors::{codes, EngineError};
use super::log::trim_detail;
use crate::infrastructure::backup_proof;
use crate::infrastructure::local_config::MigratorConnectionInfo;
use crate::infrastructure::pg_process;

pub(crate) const PG_DUMP_EXE: &str = "pg_dump.exe";
pub(crate) const PG_RESTORE_EXE: &str = "pg_restore.exe";

/// Run `<bin_dir>/<exe_name> --version`, require PostgreSQL major
/// [`backup_proof::REQUIRED_PG_MAJOR_VERSION`], and return the trimmed
/// version string (recorded in `postgres-version.txt`) plus the major.
pub(crate) fn pg_tool_version(
    bin_dir: &Path,
    exe_name: &str,
) -> Result<(String, u32), EngineError> {
    let exe = bin_dir.join(exe_name);
    let mut command = Command::new(&exe);
    pg_process::hide_console_window(&mut command);
    command
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let output = command.output().map_err(|e| {
        EngineError::new(
            codes::BACKUP_PG_DUMP_VERSION_FAILED,
            format!("could not run {} --version ({e})", exe.display()),
        )
    })?;
    if !output.status.success() {
        return Err(EngineError::new(
            codes::BACKUP_PG_DUMP_VERSION_FAILED,
            format!(
                "{} --version exited with {}: {}",
                exe.display(),
                output.status,
                trim_detail(&String::from_utf8_lossy(&output.stderr))
            ),
        ));
    }
    let version_string = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let major = backup_proof::parse_pg_dump_major_version(&version_string).map_err(|_| {
        EngineError::new(
            codes::BACKUP_PG_DUMP_VERSION_FAILED,
            format!(
                "unparsable version output '{}'",
                trim_detail(&version_string)
            ),
        )
    })?;
    if major != backup_proof::REQUIRED_PG_MAJOR_VERSION {
        return Err(EngineError::new(
            codes::BACKUP_PG_DUMP_VERSION_MISMATCH,
            format!(
                "found major {major}, required {}",
                backup_proof::REQUIRED_PG_MAJOR_VERSION
            ),
        ));
    }
    Ok((version_string, major))
}

/// Format 2 dump (plan §5.3): custom format, `--no-owner`, **with**
/// privileges, authenticated as the migrator through `PGPASSWORD` only.
pub(crate) fn run_pg_dump(
    bin_dir: &Path,
    info: &MigratorConnectionInfo,
    out: &Path,
) -> Result<(), EngineError> {
    let exe = bin_dir.join(PG_DUMP_EXE);
    let mut command = Command::new(&exe);
    pg_process::hide_console_window(&mut command);
    command
        .arg("--format=custom")
        .arg("--no-owner")
        .arg("--no-password")
        .arg("--host")
        .arg(&info.host)
        .arg("--port")
        .arg(info.port.to_string())
        .arg("--username")
        .arg(&info.username)
        .arg("--dbname")
        .arg(&info.database)
        .arg("--file")
        .arg(out)
        .env("PGPASSWORD", info.password.as_str())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    let output = command.output().map_err(|e| {
        EngineError::new(
            codes::BACKUP_PG_DUMP_FAILED,
            format!("could not run {} ({e})", exe.display()),
        )
    })?;
    if !output.status.success() {
        return Err(EngineError::new(
            codes::BACKUP_PG_DUMP_FAILED,
            format!(
                "pg_dump exited with {}: {}",
                output.status,
                trim_detail(&String::from_utf8_lossy(&output.stderr))
            ),
        ));
    }
    Ok(())
}

/// Where a restore goes. Never carries the password into argv — it is
/// placed in the child's environment only.
pub(crate) struct RestoreTarget<'a> {
    pub host: &'a str,
    pub port: u16,
    pub database: &'a str,
    pub username: &'a str,
    pub password: &'a str,
}

/// `pg_restore --exit-on-error --single-transaction --no-owner
/// [--no-privileges]` into `target`. `code_on_error` is the detail code the
/// caller wants on failure (`DRILL_RESTORE_FAILED` for the isolated test,
/// `RESTORE_PG_RESTORE_FAILED` for the live restore).
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn run_pg_restore(
    bin_dir: &Path,
    target: &RestoreTarget<'_>,
    dump: &Path,
    with_privileges: bool,
    code_on_error: &'static str,
) -> Result<(), EngineError> {
    let exe = bin_dir.join(PG_RESTORE_EXE);
    let mut command = Command::new(&exe);
    pg_process::hide_console_window(&mut command);
    command
        .arg("--exit-on-error")
        .arg("--single-transaction")
        .arg("--no-owner");
    if !with_privileges {
        command.arg("--no-privileges");
    }
    command
        .arg("--no-password")
        .arg("--host")
        .arg(target.host)
        .arg("--port")
        .arg(target.port.to_string())
        .arg("--username")
        .arg(target.username)
        .arg("--dbname")
        .arg(target.database)
        .arg(dump)
        .env("PGPASSWORD", target.password)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    let output = command.output().map_err(|e| {
        EngineError::new(
            code_on_error,
            format!("could not run {} ({e})", exe.display()),
        )
    })?;
    if !output.status.success() {
        return Err(EngineError::new(
            code_on_error,
            format!(
                "pg_restore exited with {}: {}",
                output.status,
                trim_detail(&String::from_utf8_lossy(&output.stderr))
            ),
        ));
    }
    Ok(())
}

/// `pg_restore --list <dump>`: proves the archive's table of contents is
/// readable (a truncated or corrupt file fails here). Cheap; used as the
/// final check on a safety backup before live data is touched (WS-H-5).
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn run_pg_restore_list(bin_dir: &Path, dump: &Path) -> Result<(), EngineError> {
    let exe = bin_dir.join(PG_RESTORE_EXE);
    let mut command = Command::new(&exe);
    pg_process::hide_console_window(&mut command);
    command
        .arg("--list")
        .arg(dump)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    let output = command.output().map_err(|e| {
        EngineError::new(
            codes::RESTORE_SAFETY_BACKUP_FAILED,
            format!("could not run {} --list ({e})", exe.display()),
        )
    })?;
    if !output.status.success() {
        return Err(EngineError::new(
            codes::RESTORE_SAFETY_BACKUP_FAILED,
            format!(
                "pg_restore --list reports the dump is not readable: {}",
                trim_detail(&String::from_utf8_lossy(&output.stderr))
            ),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_binary_is_a_version_failure_not_a_panic() {
        let bin_dir = std::env::temp_dir().join("sk-recovery-tools-no-such-bin-dir");
        let error = pg_tool_version(&bin_dir, PG_DUMP_EXE).unwrap_err();
        assert_eq!(error.code, codes::BACKUP_PG_DUMP_VERSION_FAILED);
        assert!(error.log_detail.contains("pg_dump.exe"));
    }

    #[test]
    fn a_missing_pg_restore_reports_the_caller_chosen_code() {
        let bin_dir = std::env::temp_dir().join("sk-recovery-tools-no-such-bin-dir");
        let dump = bin_dir.join("database.dump");
        let target = RestoreTarget {
            host: "127.0.0.1",
            port: 1,
            database: "db",
            username: "u",
            password: "s3cr3t-value-never-logged",
        };
        let error = run_pg_restore(&bin_dir, &target, &dump, true, codes::DRILL_RESTORE_FAILED)
            .unwrap_err();
        assert_eq!(error.code, codes::DRILL_RESTORE_FAILED);
        assert!(
            !error.log_detail.contains("s3cr3t-value-never-logged"),
            "the password must never appear in a log detail"
        );
    }
}
