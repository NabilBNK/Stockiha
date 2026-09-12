//! WS-K-4 — embedded PostgreSQL process lifecycle.
//!
//! PostgreSQL runs as a plain child process of Stockiha itself: no Windows
//! service, no dedicated service account, no elevation. This module owns
//! every operation that touches that process or its `postmaster.pid` file.
//!
//! # The one rule that matters most
//!
//! Two `postgres.exe` processes writing the same data directory is
//! unrecoverable data corruption, not an inconvenience. Every function here
//! is written so that **uncertainty about whether a process is alive never
//! resolves to "treat it as dead."** See [`PidStatus`] and
//! [`check_postmaster_pid`].

use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// Result of inspecting a PID recorded in `postmaster.pid` against the
/// process table.
///
/// Deliberately three-valued, not a `bool`: an inconclusive check must never
/// collapse into "dead" (which would invite starting a second server on a
/// data directory already in use) nor into "alive forever" (which would make
/// a genuinely stale file impossible to recover from). [`PidStatus::Unknown`]
/// is a distinct outcome callers must handle by refusing to proceed
/// automatically, not by guessing.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PidStatus {
    /// No process is running with this PID, or a different process now
    /// occupies it (the original process — whatever it was — has exited;
    /// Windows does not reuse a PID while its owning process still lives).
    /// Safe to treat `postmaster.pid` as stale.
    Dead,
    /// A process is running with this PID and its image name matches the
    /// one we were checking for (`postgres.exe`). A real server owns this
    /// data directory right now. Never delete the pid file; never start a
    /// second server.
    Alive,
    /// The check could not be completed conclusively (access denied, or the
    /// process's image name could not be read while it is confirmed still
    /// running). Must be treated identically to `Alive` for safety purposes
    /// — refuse to proceed automatically — even though it is not a positive
    /// confirmation.
    Unknown,
}

/// Read the PID recorded in `<pgdata>/postmaster.pid`.
///
/// The file's first line is the PID, as a decimal integer (PostgreSQL's own
/// documented format). Any read or parse failure returns `None` — an absent
/// or malformed pid file is not itself evidence of anything; the caller
/// proceeds as if no prior process was ever recorded.
pub fn read_postmaster_pid(pgdata: &Path) -> Option<u32> {
    let path = pgdata.join("postmaster.pid");
    let contents = std::fs::read_to_string(path).ok()?;
    let first_line = contents.lines().next()?;
    first_line.trim().parse::<u32>().ok()
}

/// Check whether `pid` is a live `postgres.exe` process.
///
/// See [`PidStatus`] for the safety contract every branch here upholds.
#[cfg(windows)]
pub fn check_pid_status(pid: u32, expected_image_name: &str) -> PidStatus {
    windows_impl::check(pid, expected_image_name)
}

#[cfg(not(windows))]
pub fn check_pid_status(_pid: u32, _expected_image_name: &str) -> PidStatus {
    // This module is Windows-only in practice (Stockiha targets Windows
    // exclusively), but a non-Windows build must still compile. Fail safe:
    // never claim "Dead" when the check cannot actually run.
    PidStatus::Unknown
}

/// Convenience wrapper for the one real caller: is this PID a live
/// `postgres.exe`?
pub fn check_postmaster_pid(pid: u32) -> PidStatus {
    check_pid_status(pid, "postgres.exe")
}

#[cfg(windows)]
mod windows_impl {
    use super::PidStatus;
    use windows_sys::Win32::Foundation::{
        CloseHandle, GetLastError, ERROR_INVALID_PARAMETER, STILL_ACTIVE,
    };
    use windows_sys::Win32::System::Threading::{
        GetExitCodeProcess, OpenProcess, QueryFullProcessImageNameW,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };

    pub(super) fn check(pid: u32, expected_image_name: &str) -> PidStatus {
        // SAFETY: `PROCESS_QUERY_LIMITED_INFORMATION` is the least-privileged
        // query right (available since Vista specifically so callers do not
        // need full access to check basic process state); `pid` is a plain
        // integer, no aliasing concerns.
        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if handle.is_null() {
            // SAFETY: immediately after the failing call, no other API in
            // between to clobber it.
            let err = unsafe { GetLastError() };
            return if err == ERROR_INVALID_PARAMETER {
                // The documented meaning of this specific error from
                // OpenProcess: no process with this PID exists at all.
                PidStatus::Dead
            } else {
                // Almost certainly access-denied (e.g. a protected process).
                // The process might genuinely still be our server — never
                // guess Dead here.
                PidStatus::Unknown
            };
        }

        let mut exit_code: u32 = 0;
        // SAFETY: `handle` is a valid, just-opened handle; closed on every
        // exit path below.
        let ok = unsafe { GetExitCodeProcess(handle, &mut exit_code) };
        if ok == 0 {
            unsafe { CloseHandle(handle) };
            return PidStatus::Unknown;
        }
        if exit_code != STILL_ACTIVE as u32 {
            unsafe { CloseHandle(handle) };
            return PidStatus::Dead;
        }

        // The PID is genuinely still running something. Confirm it is
        // actually postgres.exe before trusting it — Windows will not reuse
        // a PID while its original owner is alive, so a live-but-different
        // image safely means our original process is gone.
        let mut buf = [0u16; 260];
        let mut size: u32 = buf.len() as u32;
        // SAFETY: `handle` valid; `buf`/`size` correctly paired per the
        // documented QueryFullProcessImageNameW contract.
        let ok = unsafe { QueryFullProcessImageNameW(handle, 0, buf.as_mut_ptr(), &mut size) };
        unsafe { CloseHandle(handle) };
        if ok == 0 {
            // Alive but unreadable image name: do not guess. A genuinely
            // running process is not safe to declare Dead.
            return PidStatus::Unknown;
        }

        let path = String::from_utf16_lossy(&buf[..size as usize]);
        let matches = std::path::Path::new(&path)
            .file_name()
            .map(|name| {
                name.to_string_lossy()
                    .eq_ignore_ascii_case(expected_image_name)
            })
            .unwrap_or(false);

        if matches {
            PidStatus::Alive
        } else {
            PidStatus::Dead
        }
    }
}

/// Resolve where the PostgreSQL data directory should live for this
/// machine.
///
/// Ordinarily this is just `<app_data_dir>/pgdata`. But `initdb.exe` /
/// `postgres.exe` are Win32 C programs that convert their path arguments
/// through the process's ANSI codepage rather than using wide-char
/// (UTF-16) file APIs throughout — confirmed by directly reproducing it:
/// `initdb` against a real path containing Arabic characters fails with
/// `could not create directory "...????-???...": Invalid argument`, the
/// `?`s being literally what the ANSI codepage conversion produced from
/// characters it cannot represent. `app_data_dir()` is
/// `%APPDATA%\com.raqmenha.stockiha`, and `%APPDATA%` itself contains the
/// Windows account's username — a real risk for a non-Latin username or
/// display name (the Owner's client is in Algeria).
///
/// When `app_data_dir` is not representable in ASCII, relocate `pgdata`
/// to a fixed, ASCII-only location under `%ProgramData%` instead of
/// failing outright — the documented fallback. Purely a function of
/// `app_data_dir`'s own bytes, not persisted anywhere: every launch (first
/// -run setup and every later start) computes the same answer from the
/// same input, so there is nothing to keep in sync or get out of date.
/// `database.json` and `setup.log` are unaffected and stay under the
/// normal (possibly non-ASCII) `app_data_dir` — they are plain files this
/// process itself reads and writes via Rust's own (correctly wide-char)
/// std::fs, never through an external PostgreSQL binary, so they were
/// never at risk.
pub fn resolve_pgdata_dir(app_data_dir: &Path) -> PathBuf {
    let is_ascii_safe = app_data_dir.to_str().map(|s| s.is_ascii()).unwrap_or(false); // not even valid UTF-8 is certainly not ASCII-safe either
    if is_ascii_safe {
        return app_data_dir.join("pgdata");
    }
    let program_data = std::env::var_os("ProgramData")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\ProgramData"));
    program_data.join("Stockiha").join("pgdata")
}

/// Find a free TCP port, starting at `preferred` and trying nine sequential
/// alternates if it is taken. Only ever called once, during first-run setup
/// — the chosen port is then persisted in `database.json` and reused on
/// every later launch (re-probing on every start could pick a *different*
/// port out from under a working install if something else took the old one
/// meanwhile).
///
/// A bind-then-release on loopback is the only check that actually answers
/// "can I use this port": a connect attempt can fail for reasons that do not
/// mean "free" (firewall, service still starting), and can succeed against
/// something that will refuse our own bind a moment later.
pub fn find_free_port(preferred: u16) -> Option<u16> {
    (preferred..=preferred.saturating_add(9)).find(|&candidate| is_port_free(candidate))
}

fn is_port_free(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}

/// Spawn `postgres.exe` directly (not `pg_ctl start`, which on Windows
/// itself forks a further child and detaches) so this process owns a real
/// `Child` handle it can wait on or escalate against if a graceful stop ever
/// fails to exit in time.
pub fn spawn_postgres(bin_dir: &Path, pgdata: &Path) -> io::Result<std::process::Child> {
    let postgres_exe = bin_dir.join("postgres.exe");
    std::process::Command::new(postgres_exe)
        .arg("-D")
        .arg(pgdata)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
}

/// Poll until a real connection to `port` succeeds or `timeout` elapses.
/// Never a fixed sleep-then-assume: every attempt is a genuine connection,
/// and the function returns as soon as one succeeds rather than always
/// waiting out the full timeout.
pub async fn wait_until_ready(port: u16, timeout: Duration) -> Result<Duration, Duration> {
    let started = Instant::now();
    let poll_interval = Duration::from_millis(200);
    loop {
        // A bare TCP connect is enough here: readiness means "something is
        // listening," not "authentication succeeds" (initdb's own generated
        // superuser credentials are what the caller connects with next, and
        // that is a separate, meaningful failure if it happens).
        if tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .is_ok()
        {
            return Ok(started.elapsed());
        }
        if started.elapsed() >= timeout {
            return Err(started.elapsed());
        }
        tokio::time::sleep(poll_interval).await;
    }
}

/// Stop PostgreSQL gracefully via `pg_ctl stop -m fast`, escalating to
/// `-m immediate` if it does not exit within `graceful_timeout`. Returns
/// which mode actually succeeded, so the caller can log it — an
/// `-m immediate` escalation is worth knowing about even though it is not a
/// failure of this function itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StopOutcome {
    Fast,
    Immediate,
}

pub fn stop_postgres(
    bin_dir: &Path,
    pgdata: &Path,
    graceful_timeout: Duration,
) -> io::Result<StopOutcome> {
    let pg_ctl = bin_dir.join("pg_ctl.exe");
    let graceful = run_pg_ctl_stop(&pg_ctl, pgdata, "fast", graceful_timeout);
    if graceful {
        return Ok(StopOutcome::Fast);
    }
    // -m fast did not finish in time. Escalate: -m immediate skips a clean
    // shutdown checkpoint (crash-recovery replays on next start instead),
    // but does not corrupt the data directory the way killing the process
    // out from under an in-progress checkpoint could.
    let immediate = run_pg_ctl_stop(&pg_ctl, pgdata, "immediate", graceful_timeout);
    if immediate {
        Ok(StopOutcome::Immediate)
    } else {
        Err(io::Error::other(
            "pg_ctl stop did not succeed in either -m fast or -m immediate mode",
        ))
    }
}

fn run_pg_ctl_stop(pg_ctl: &Path, pgdata: &Path, mode: &str, timeout: Duration) -> bool {
    let timeout_secs = timeout.as_secs().max(1).to_string();
    std::process::Command::new(pg_ctl)
        .arg("stop")
        .arg("-D")
        .arg(pgdata)
        .arg("-m")
        .arg(mode)
        .arg("-w")
        .arg("-t")
        .arg(&timeout_secs)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

/// Honor the stale-`postmaster.pid` safety rule, then start (or confirm
/// already-running) PostgreSQL against `pgdata`/`port`. Returns the spawned
/// `Child` — `None` if a pre-existing, confirmed-alive server is already
/// servicing this data directory (nothing new was spawned).
///
/// Shared by first-run setup (`embedded_setup::run_setup`) and every later
/// app launch (`lib.rs`'s `.setup()`) — both need the exact same
/// stale-pid-safe start behavior, so there is exactly one implementation of
/// it.
pub async fn ensure_running(
    bin_dir: PathBuf,
    pgdata: PathBuf,
    port: u16,
) -> Result<Option<std::process::Child>, String> {
    if let Some(pid) = read_postmaster_pid(&pgdata) {
        match check_postmaster_pid(pid) {
            PidStatus::Alive => {
                return match wait_until_ready(port, Duration::from_secs(5)).await {
                    Ok(_) => Ok(None),
                    Err(_) => Err(
                        "a PostgreSQL process is already running against this data directory, \
                         but it is not answering on the expected port. Refusing to start a \
                         second server on the same data directory."
                            .to_string(),
                    ),
                };
            }
            PidStatus::Unknown => {
                return Err(
                    "found a record of a previous database process that could not be \
                     conclusively confirmed as stopped. Refusing to start a second one on the \
                     same data — please check Task Manager for a postgres.exe process and \
                     close it, then retry."
                        .to_string(),
                );
            }
            PidStatus::Dead => {
                // Stale file from an unclean exit; safe to remove and start
                // fresh. PostgreSQL itself would also refuse to start with a
                // stale-but-present postmaster.pid, so this is required, not
                // just tidy.
                let _ = std::fs::remove_file(pgdata.join("postmaster.pid"));
            }
        }
    }

    let child = spawn_postgres(&bin_dir, &pgdata)
        .map_err(|e| format!("could not start the database server ({e})"))?;

    match wait_until_ready(port, Duration::from_secs(30)).await {
        Ok(_) => Ok(Some(child)),
        Err(elapsed) => Err(format!(
            "the database server did not become ready within {:.0}s",
            elapsed.as_secs_f64()
        )),
    }
}

/// Everything needed to manage the embedded PostgreSQL child process for the
/// lifetime of this app run. Managed as Tauri state behind a `Mutex` so the
/// shutdown hook (running on whatever thread Tauri's event loop calls it
/// on) can reach the same handle the setup/startup path created.
pub struct EmbeddedPostgresHandle {
    pub child: Option<std::process::Child>,
    pub bin_dir: PathBuf,
    pub pgdata: PathBuf,
    pub port: u16,
}

impl EmbeddedPostgresHandle {
    pub fn new(bin_dir: PathBuf, pgdata: PathBuf, port: u16) -> Self {
        Self {
            child: None,
            bin_dir,
            pgdata,
            port,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_dead_process_is_reported_dead() {
        // Any short-lived process works here: the check reaches its
        // exit-code branch before ever looking at the image name.
        let mut child = std::process::Command::new("cmd.exe")
            .args(["/C", "exit 0"])
            .spawn()
            .expect("spawn a short-lived process");
        let pid = child.id();
        child.wait().expect("wait for it to exit");
        // Give Windows a moment to fully tear down the process object.
        std::thread::sleep(Duration::from_millis(200));
        assert_eq!(check_pid_status(pid, "cmd.exe"), PidStatus::Dead);
    }

    /// A genuinely long-lived process, spawned directly: `powershell.exe`
    /// running `Start-Sleep` blocks for the given duration and is a normal,
    /// non-single-instance console process (unlike `notepad.exe` on modern
    /// Windows, which can hand off to an already-running shared instance
    /// rather than staying alive as the specific process this test just
    /// spawned — confirmed by observing a stray `notepad.exe` survive a
    /// `kill()` in an earlier version of this test). Also avoids the
    /// earlier flake from relying on `cmd.exe` + whichever `timeout`/`ping`
    /// happens to be first on PATH in a given shell.
    fn spawn_long_lived_process() -> std::process::Child {
        std::process::Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Start-Sleep -Seconds 30",
            ])
            .spawn()
            .expect("spawn a long-lived process (powershell.exe)")
    }

    #[test]
    fn a_live_process_with_matching_image_name_is_alive() {
        let mut child = spawn_long_lived_process();
        let pid = child.id();
        std::thread::sleep(Duration::from_millis(300));
        assert_eq!(check_pid_status(pid, "powershell.exe"), PidStatus::Alive);
        let _ = child.kill();
        let _ = child.wait();
    }

    #[test]
    fn a_live_process_with_a_different_image_name_is_treated_as_dead() {
        // Simulates a stale pid file whose original process (postgres.exe)
        // has exited and the PID has since been reused by something else —
        // safe to clean up, since our specific target is provably gone.
        let mut child = spawn_long_lived_process();
        let pid = child.id();
        std::thread::sleep(Duration::from_millis(300));
        assert_eq!(check_pid_status(pid, "postgres.exe"), PidStatus::Dead);
        let _ = child.kill();
        let _ = child.wait();
    }

    #[test]
    fn a_pid_that_never_existed_is_dead() {
        // PID 0 is reserved (the System Idle Process) and OpenProcess with
        // PROCESS_QUERY_LIMITED_INFORMATION against it fails with
        // ERROR_INVALID_PARAMETER on real Windows, exercising the same path
        // as a genuinely nonexistent PID.
        assert_eq!(check_pid_status(0, "postgres.exe"), PidStatus::Dead);
    }

    #[test]
    fn missing_postmaster_pid_file_reads_as_none() {
        let dir =
            std::env::temp_dir().join(format!("sk-pgproc-{}-{}", std::process::id(), line!()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(read_postmaster_pid(&dir), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn postmaster_pid_file_is_parsed_from_its_first_line() {
        let dir =
            std::env::temp_dir().join(format!("sk-pgproc-{}-{}", std::process::id(), line!()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("postmaster.pid"), "12345\n/some/data/dir\n5433\n").unwrap();
        assert_eq!(read_postmaster_pid(&dir), Some(12345));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn find_free_port_returns_the_preferred_port_when_free() {
        // Bind briefly to a random ephemeral port to learn one that's free,
        // then release it and confirm find_free_port picks it up as the
        // preferred candidate.
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        assert_eq!(find_free_port(port), Some(port));
    }

    #[test]
    fn find_free_port_skips_a_taken_preferred_port() {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let taken_port = listener.local_addr().unwrap().port();
        let found = find_free_port(taken_port);
        assert!(found.is_some());
        assert_ne!(found, Some(taken_port));
        drop(listener);
    }

    // --- Stale-pid / single-instance lifecycle tests -----------------------
    //
    // These exercise the real bundled PostgreSQL binaries against a
    // disposable temp data directory — the same binaries the installer
    // ships, per the task's explicit "not optional" list of required tests.
    // `trust` auth is used here (never in shipped code): these tests only
    // care about process lifecycle, not credentials.

    fn bundled_bin_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("postgres")
            .join("win64")
            .join("bin")
    }

    fn temp_pgdata(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "sk-pgproc-lifecycle-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Initializes a throwaway, trust-authenticated data directory — enough
    /// to start/stop a real `postgres.exe` for lifecycle testing, without
    /// any of the role/credential machinery `embedded_setup` owns.
    fn init_temp_pgdata(bin_dir: &Path, pgdata: &Path) {
        let status = std::process::Command::new(bin_dir.join("initdb.exe"))
            .arg("-D")
            .arg(pgdata)
            .arg("-U")
            .arg("postgres")
            .arg("-A")
            .arg("trust")
            .arg("--locale=C")
            .arg("-E")
            .arg("UTF8")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .expect("run initdb against a temp directory");
        assert!(status.success(), "initdb failed against a temp directory");
    }

    #[tokio::test]
    #[ignore = "spawns a real, disposable PostgreSQL instance; run explicitly with -- --ignored"]
    async fn stale_pid_file_with_a_dead_process_is_cleaned_up_and_a_fresh_server_starts() {
        let bin_dir = bundled_bin_dir();
        let pgdata = temp_pgdata("dead-pid");
        init_temp_pgdata(&bin_dir, &pgdata);
        let port = find_free_port(58520).expect("a free port for this test");
        write_server_config_for_test(&pgdata, port);

        // Simulate an unclean shutdown: a postmaster.pid file naming a
        // process that is provably not running (and not even postgres.exe),
        // left behind in an otherwise-freshly-initialized data directory.
        let mut dead = std::process::Command::new("cmd.exe")
            .args(["/C", "exit 0"])
            .spawn()
            .expect("spawn a short-lived process");
        let dead_pid = dead.id();
        dead.wait().unwrap();
        std::thread::sleep(Duration::from_millis(200));
        std::fs::write(
            pgdata.join("postmaster.pid"),
            format!("{dead_pid}\n{}\n{port}\n", pgdata.display()),
        )
        .unwrap();

        let result = ensure_running(bin_dir.clone(), pgdata.clone(), port).await;
        match result {
            Ok(Some(mut child)) => {
                // A fresh server actually started (not just "no error") —
                // confirm it answers on the port before tearing down.
                assert!(wait_until_ready(port, Duration::from_secs(10))
                    .await
                    .is_ok());
                let _ = stop_postgres(&bin_dir, &pgdata, Duration::from_secs(10));
                let _ = child.wait();
            }
            other => panic!(
                "expected the stale dead pid to be cleaned up and a server started, got {other:?}"
            ),
        }

        let _ = std::fs::remove_dir_all(&pgdata);
    }

    #[tokio::test]
    #[ignore = "spawns a real, disposable PostgreSQL instance; run explicitly with -- --ignored"]
    async fn stale_pid_file_with_a_live_process_refuses_a_second_server_and_keeps_the_file() {
        let bin_dir = bundled_bin_dir();
        let pgdata = temp_pgdata("live-pid");
        init_temp_pgdata(&bin_dir, &pgdata);
        let port = find_free_port(58540).expect("a free port for this test");
        write_server_config_for_test(&pgdata, port);

        // Start a genuinely running server first, so postmaster.pid names a
        // real, live postgres.exe process.
        let mut first = spawn_postgres(&bin_dir, &pgdata).expect("start the first server");
        assert!(wait_until_ready(port, Duration::from_secs(15))
            .await
            .is_ok());
        assert!(pgdata.join("postmaster.pid").exists());

        let result = ensure_running(bin_dir.clone(), pgdata.clone(), port).await;

        // Must not delete the pid file, and must not report a second child
        // to manage — the existing live server is left exactly as it was.
        assert!(
            pgdata.join("postmaster.pid").exists(),
            "the pid file for a live server must never be deleted"
        );
        match result {
            Ok(None) => {}
            other => panic!(
                "expected ensure_running to confirm the existing live server without starting a \
                 second one, got {other:?}"
            ),
        }

        let _ = stop_postgres(&bin_dir, &pgdata, Duration::from_secs(10));
        let _ = first.wait();
        let _ = std::fs::remove_dir_all(&pgdata);
    }

    #[tokio::test]
    #[ignore = "spawns a real, disposable PostgreSQL instance; run explicitly with -- --ignored"]
    async fn postgres_process_is_gone_after_stop_postgres() {
        let bin_dir = bundled_bin_dir();
        let pgdata = temp_pgdata("stop-then-gone");
        init_temp_pgdata(&bin_dir, &pgdata);
        let port = find_free_port(58560).expect("a free port for this test");
        write_server_config_for_test(&pgdata, port);

        let mut child = spawn_postgres(&bin_dir, &pgdata).expect("start the server");
        let pid = child.id();
        assert!(wait_until_ready(port, Duration::from_secs(15))
            .await
            .is_ok());
        assert_eq!(check_pid_status(pid, "postgres.exe"), PidStatus::Alive);

        let outcome = stop_postgres(&bin_dir, &pgdata, Duration::from_secs(10));
        assert!(outcome.is_ok(), "stop_postgres should succeed: {outcome:?}");
        let _ = child.wait();

        // Give Windows a moment to fully tear the process down, matching
        // the same allowance the other liveness tests make.
        std::thread::sleep(Duration::from_millis(300));
        assert_eq!(
            check_pid_status(pid, "postgres.exe"),
            PidStatus::Dead,
            "postgres.exe must not still be running after a normal stop"
        );

        let _ = std::fs::remove_dir_all(&pgdata);
    }

    /// Minimal `postgresql.conf`/`pg_hba.conf` writer for these
    /// lifecycle-only tests — deliberately separate from
    /// `embedded_setup::write_server_config` (which is private to that
    /// module and carries the real, credentialed `pg_hba.conf`). These
    /// tests use `trust` auth, so they need a matching, simpler config.
    fn write_server_config_for_test(pgdata: &Path, port: u16) {
        use std::io::Write as _;
        let mut conf = std::fs::OpenOptions::new()
            .append(true)
            .open(pgdata.join("postgresql.conf"))
            .unwrap();
        writeln!(conf, "\nlisten_addresses = '127.0.0.1'\nport = {port}\n").unwrap();
        std::fs::write(
            pgdata.join("pg_hba.conf"),
            "local   all             all                                     trust\n\
             host    all             all             127.0.0.1/32            trust\n\
             host    all             all             ::1/128                 trust\n",
        )
        .unwrap();
    }
}
