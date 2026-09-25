//! WS-K-7 — `LicenceRuntime`: the managed state wrapping the evaluator with
//! real IO (plan §5.5). Owns the only `RwLock` in this module; every other
//! file here is pure or does plain, independent IO.

use std::path::{Path, PathBuf};
use std::sync::RwLock;

use serde::Deserialize;
use sqlx::PgPool;
use time::{Duration, OffsetDateTime};

use crate::error::AppError;

use super::evaluator::{evaluate, Evaluation, EvaluationInput};
#[cfg(not(test))]
use super::machine;
use super::{payload, signature, storage};
use super::{LicenceStatus, ALGERIA_OFFSET_HOURS, PUBLIC_KEY_TEXT};

pub(crate) struct LicenceRuntime {
    snapshot: RwLock<Evaluation>,
    app_data_dir: Option<PathBuf>,
    developer_mode: bool,
}

/// The real clock in production. Under `#[cfg(test)]`, tests can override
/// it per-thread via [`tests::set_test_now`] — needed to exercise the
/// clock-rollback-reset path (plan §4.5 step 5, §9.2), which compares the
/// *real* current time against a fixture's `issued_on` and cannot be tested
/// deterministically against the actual wall clock.
#[cfg(not(test))]
fn now_utc() -> OffsetDateTime {
    OffsetDateTime::now_utc()
}

#[cfg(test)]
fn now_utc() -> OffsetDateTime {
    tests::TEST_NOW.with(|cell| cell.get().unwrap_or_else(OffsetDateTime::now_utc))
}

/// The real, OS-read machine code in production. Under `#[cfg(test)]`,
/// tests override it per-thread via [`tests::set_test_machine_code`] — the
/// real `machine::machine_code()` reads this machine's actual
/// `MachineGuid`, which never matches the `STKH-TEST-...` codes the
/// committed test fixtures (plan §9.1) were issued for.
#[cfg(not(test))]
fn current_machine_code() -> Option<String> {
    machine::machine_code()
}

#[cfg(test)]
fn current_machine_code() -> Option<String> {
    tests::TEST_MACHINE_CODE.with(|cell| cell.borrow().clone())
}

#[derive(Deserialize, Default)]
struct LicenceTouchRow {
    #[serde(default, with = "time::serde::rfc3339::option")]
    grace_started_at: Option<OffsetDateTime>,
    #[serde(default, with = "time::serde::rfc3339::option")]
    last_seen_at: Option<OffsetDateTime>,
}

impl LicenceRuntime {
    /// Computes the initial snapshot synchronously, from file values only
    /// (plan §5.6: "the initial snapshot is computed synchronously in
    /// `.setup()` with `db = None`... this keeps startup fast").
    pub(crate) fn new(app_data_dir: Option<PathBuf>, developer_mode: bool) -> Self {
        storage::set_app_data_dir(app_data_dir.clone());
        let initial = Self::evaluate_now(app_data_dir.as_deref(), developer_mode, None, None);
        Self {
            snapshot: RwLock::new(initial),
            app_data_dir,
            developer_mode,
        }
    }

    /// Cheap: the one value the enforcement gate reads on every IPC call.
    ///
    /// `STOCKIHA_LICENCE_FORCE_MODE=READ_ONLY` forces read-only mode for
    /// manual testing (plan WS-K-7-A acceptance criterion 4) — honoured
    /// only in debug builds, so a release build can never be affected by an
    /// operator's stray environment variable.
    pub(crate) fn mode(&self) -> super::LicenceMode {
        if cfg!(debug_assertions) {
            if let Ok(forced) = std::env::var("STOCKIHA_LICENCE_FORCE_MODE") {
                if forced.trim() == "READ_ONLY" {
                    return super::LicenceMode::ReadOnly;
                }
            }
        }
        self.snapshot
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .mode
    }

    pub(crate) fn snapshot(&self) -> Evaluation {
        self.snapshot
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    fn store_snapshot(&self, evaluation: Evaluation) {
        *self
            .snapshot
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = evaluation;
    }

    /// Read the machine code and the on-disk licence key/state, and run the
    /// pure evaluator (plan §4.4) against them plus whatever database
    /// values are supplied.
    fn evaluate_now(
        app_data_dir: Option<&Path>,
        developer_mode: bool,
        db_first_seen: Option<OffsetDateTime>,
        db_last_seen: Option<OffsetDateTime>,
    ) -> Evaluation {
        let machine_code = current_machine_code();
        let (licence_key, file_first_seen, file_last_seen) = match app_data_dir {
            Some(dir) => {
                let key = storage::read_licence_key(dir);
                let state = storage::read_state_file(dir);
                (key, state.first_seen, state.last_seen)
            }
            None => (None, None, None),
        };

        let input = EvaluationInput {
            developer_mode,
            machine_code: machine_code.as_deref(),
            licence_key: licence_key.as_deref(),
            public_key_text: PUBLIC_KEY_TEXT,
            now_utc: now_utc(),
            file_first_seen,
            file_last_seen,
            db_first_seen,
            db_last_seen,
        };
        evaluate(&input)
    }

    /// `SELECT core.licence_touch()` — no session needed, called before
    /// anyone has logged in. On any failure, logs `DB_TOUCH_FAILED` and
    /// falls back to file-only values (plan §5.5 step 2).
    async fn touch_db(
        &self,
        db: Option<&PgPool>,
    ) -> (Option<OffsetDateTime>, Option<OffsetDateTime>) {
        let Some(pool) = db else {
            return (None, None);
        };
        let row: Option<LicenceTouchRow> =
            sqlx::query_scalar::<_, serde_json::Value>("SELECT core.licence_touch()")
                .fetch_one(pool)
                .await
                .ok()
                .and_then(|value| serde_json::from_value(value).ok());

        match row {
            Some(row) => (row.grace_started_at, row.last_seen_at),
            None => {
                storage::log_event(self.app_data_dir.as_deref(), "DB_TOUCH_FAILED", "");
                (None, None)
            }
        }
    }

    /// The whole refresh cycle (plan §5.5): read files, touch the DB,
    /// evaluate, persist to both file and DB, store the snapshot, and log
    /// on a status change. Tauri event emission for
    /// `licence-status-changed` is the caller's responsibility (this
    /// module stays Tauri-free): compare `snapshot().status` before and
    /// after calling this and emit if they differ — see `lib.rs`'s
    /// periodic refresh task.
    pub(crate) async fn refresh(&self, db: Option<&PgPool>) -> Evaluation {
        let (db_first_seen, db_last_seen) = self.touch_db(db).await;
        let previous_status = self.snapshot().status;

        let evaluation = Self::evaluate_now(
            self.app_data_dir.as_deref(),
            self.developer_mode,
            db_first_seen,
            db_last_seen,
        );

        if let Some(dir) = self.app_data_dir.as_deref() {
            let _ = storage::write_state_file(dir, evaluation.first_seen, evaluation.last_seen);
        }
        if let Some(pool) = db {
            let _ = sqlx::query("SELECT core.licence_record_seen($1, $2)")
                .bind(evaluation.first_seen)
                .bind(evaluation.last_seen)
                .execute(pool)
                .await;
        }

        if evaluation.status != previous_status {
            storage::log_event(
                self.app_data_dir.as_deref(),
                "EVALUATED",
                &format!("status={:?} mode={:?}", evaluation.status, evaluation.mode),
            );
        }

        self.store_snapshot(evaluation.clone());
        evaluation
    }

    /// `core.record_licence_event`, or `AUDIT_SKIPPED_NO_DB` when no pool
    /// or no session is available (plan §5.5 note). Errors (in particular
    /// an invalid session — SQLSTATE `28000`) are propagated so the caller
    /// can decide what they mean for the overall result.
    async fn record_event(
        &self,
        db: Option<&PgPool>,
        session_token: Option<&str>,
        event_type: &str,
        licence_id: Option<&str>,
        machine_code: Option<&str>,
        reason_code: Option<&str>,
    ) -> Result<(), AppError> {
        let (Some(pool), Some(token)) = (db, session_token) else {
            storage::log_event(
                self.app_data_dir.as_deref(),
                "AUDIT_SKIPPED_NO_DB",
                event_type,
            );
            return Ok(());
        };
        sqlx::query("SELECT core.record_licence_event($1, $2, $3, $4, $5)")
            .bind(token)
            .bind(event_type)
            .bind(licence_id)
            .bind(machine_code)
            .bind(reason_code)
            .execute(pool)
            .await
            .map(|_| ())
            .map_err(AppError::from_posting_error)
    }

    /// Records `ACTIVATION_REJECTED` with `reason_code` (never the key
    /// text), then returns whichever error the caller should surface: the
    /// original rejection reason if the audit write succeeded (including
    /// the "no DB" no-op case), or the audit failure itself (in practice,
    /// an invalid session) if it did not — plan §5.8's "if the session is
    /// invalid, the whole call returns `SESSION_INVALID`".
    async fn reject(
        &self,
        db: Option<&PgPool>,
        session_token: Option<&str>,
        reason_code: &str,
        licence_id: Option<&str>,
        machine_code: Option<&str>,
        original: AppError,
    ) -> AppError {
        storage::log_event(
            self.app_data_dir.as_deref(),
            "ACTIVATION_REJECTED",
            &format!("reason={reason_code}"),
        );
        match self
            .record_event(
                db,
                session_token,
                "ACTIVATION_REJECTED",
                licence_id,
                machine_code,
                Some(reason_code),
            )
            .await
        {
            Ok(()) => original,
            Err(session_error) => session_error,
        }
    }

    /// `activate(key_text)` — plan §4.5, exact order.
    pub(crate) async fn activate(
        &self,
        key_text: &str,
        db: Option<&PgPool>,
        session_token: Option<&str>,
    ) -> Result<Evaluation, AppError> {
        let now_utc = now_utc();

        // Steps 1-2: parse (whitespace-stripping and the length bound are
        // enforced inside `parse_key` itself) and verify the signature.
        let parsed = match payload::parse_key(key_text) {
            Ok(parsed) => parsed,
            Err(key_error) => {
                let reason = key_error.reason();
                let original = if key_error.is_malformed() {
                    AppError::LicenceMalformed {
                        diagnostic: reason.clone(),
                    }
                } else {
                    AppError::LicenceInvalid {
                        diagnostic: reason.clone(),
                    }
                };
                return Err(self
                    .reject(db, session_token, &reason, None, None, original)
                    .await);
            }
        };

        if signature::verify(
            PUBLIC_KEY_TEXT,
            &parsed.payload_bytes,
            &parsed.sig_file_bytes,
        )
        .is_err()
        {
            return Err(self
                .reject(
                    db,
                    session_token,
                    "BAD_SIGNATURE",
                    Some(&parsed.payload.licence_id),
                    Some(&parsed.payload.machine_code),
                    AppError::LicenceInvalid {
                        diagnostic: "bad signature".to_owned(),
                    },
                )
                .await);
        }

        // Step 3: machine code.
        let Some(machine_code) = current_machine_code() else {
            return Err(self
                .reject(
                    db,
                    session_token,
                    "MACHINE_UNAVAILABLE",
                    Some(&parsed.payload.licence_id),
                    None,
                    AppError::LicenceMachineUnavailable {
                        diagnostic: "machine code unavailable".to_owned(),
                    },
                )
                .await);
        };
        if parsed.payload.machine_code != machine_code {
            return Err(self
                .reject(
                    db,
                    session_token,
                    "WRONG_MACHINE",
                    Some(&parsed.payload.licence_id),
                    Some(&parsed.payload.machine_code),
                    AppError::LicenceWrongMachine {
                        diagnostic: "licence issued for a different machine".to_owned(),
                    },
                )
                .await);
        }

        // Current status (as it would evaluate without this new key) is
        // needed both for the ordinary effective-now/today-local
        // calculation and to detect a currently-active clock rollback.
        let (db_first_seen, db_last_seen) = self.touch_db(db).await;
        let current = Self::evaluate_now(
            self.app_data_dir.as_deref(),
            self.developer_mode,
            db_first_seen,
            db_last_seen,
        );

        // Step 5: clock-rollback reset.
        let mut last_seen_override = None;
        if current.status == LicenceStatus::ClockRollback {
            let real_today_local =
                (now_utc + Duration::hours(i64::from(ALGERIA_OFFSET_HOURS))).date();
            let issued_on = payload::parse_date(&parsed.payload.issued_on)
                .expect("issued_on already validated by parse_key");
            let diff_days = (issued_on - real_today_local).whole_days().abs();
            if diff_days > 2 {
                return Err(self
                    .reject(
                        db,
                        session_token,
                        "CLOCK_ROLLBACK_REQUIRES_FRESH_LICENCE",
                        Some(&parsed.payload.licence_id),
                        Some(&parsed.payload.machine_code),
                        AppError::LicenceInvalid {
                            diagnostic: "clock rollback requires a fresh licence".to_owned(),
                        },
                    )
                    .await);
            }
            last_seen_override = Some(now_utc);
        }

        // Step 4: expiry, using the ordinary effective-now unless the
        // rollback reset above just established a fresh one.
        let effective_now = last_seen_override.unwrap_or(current.last_seen);
        let today_local = (effective_now + Duration::hours(i64::from(ALGERIA_OFFSET_HOURS))).date();
        if let Some(expires_on_str) = &parsed.payload.expires_on {
            let expires_on = payload::parse_date(expires_on_str)
                .expect("expires_on already validated by parse_key");
            if expires_on < today_local {
                return Err(self
                    .reject(
                        db,
                        session_token,
                        "EXPIRED",
                        Some(&parsed.payload.licence_id),
                        Some(&parsed.payload.machine_code),
                        AppError::LicenceExpired {
                            diagnostic: "licence already expired".to_owned(),
                        },
                    )
                    .await);
            }
        }

        // Step 6: write, audit, re-evaluate.
        if let Some(dir) = self.app_data_dir.as_deref() {
            storage::write_licence_key(dir, key_text)
                .map_err(|err| AppError::internal(err.to_string()))?;
            if let Some(reset_at) = last_seen_override {
                let _ = storage::write_state_file(dir, current.first_seen, reset_at);
            }
        }
        if let (Some(pool), Some(reset_at)) = (db, last_seen_override) {
            if let Some(token) = session_token {
                let _ = sqlx::query("SELECT core.licence_reset_last_seen($1, $2)")
                    .bind(token)
                    .bind(reset_at)
                    .execute(pool)
                    .await;
            }
        }

        storage::log_event(
            self.app_data_dir.as_deref(),
            "ACTIVATION_OK",
            &format!("licence_id={}", parsed.payload.licence_id),
        );
        self.record_event(
            db,
            session_token,
            "ACTIVATED",
            Some(&parsed.payload.licence_id),
            Some(&parsed.payload.machine_code),
            None,
        )
        .await?;

        Ok(self.refresh(db).await)
    }

    /// `remove()` — deletes `licence.key`, records `REMOVED`, refreshes.
    pub(crate) async fn remove(
        &self,
        db: Option<&PgPool>,
        session_token: Option<&str>,
    ) -> Result<Evaluation, AppError> {
        let licence_id = self.snapshot().licence.map(|details| details.licence_id);

        if let Some(dir) = self.app_data_dir.as_deref() {
            storage::remove_licence_key(dir).map_err(|err| AppError::internal(err.to_string()))?;
        }

        storage::log_event(
            self.app_data_dir.as_deref(),
            "REMOVED",
            &format!("licence_id={}", licence_id.clone().unwrap_or_default()),
        );
        self.record_event(
            db,
            session_token,
            "REMOVED",
            licence_id.as_deref(),
            None,
            None,
        )
        .await?;

        Ok(self.refresh(db).await)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};

    thread_local! {
        pub(super) static TEST_NOW: Cell<Option<OffsetDateTime>> = const { Cell::new(None) };
        pub(super) static TEST_MACHINE_CODE: RefCell<Option<String>> = const { RefCell::new(None) };
    }

    /// Resets the overridden clock/machine-code back to their defaults when
    /// dropped, so one test's override can never leak into the next test
    /// scheduled on the same worker thread.
    struct Overrides;
    impl Drop for Overrides {
        fn drop(&mut self) {
            TEST_NOW.with(|cell| cell.set(None));
            TEST_MACHINE_CODE.with(|cell| *cell.borrow_mut() = None);
        }
    }
    fn set_overrides(now: OffsetDateTime, machine_code: &str) -> Overrides {
        TEST_NOW.with(|cell| cell.set(Some(now)));
        TEST_MACHINE_CODE.with(|cell| *cell.borrow_mut() = Some(machine_code.to_owned()));
        Overrides
    }

    const TEST_MACHINE: &str = "STKH-TEST-0000-0000-0001";

    const VALID_PERMANENT: &str = include_str!("../../licence/test-fixtures/valid-permanent.txt");
    const EXPIRED: &str = include_str!("../../licence/test-fixtures/expired-2020-01-31.txt");
    const OTHER_MACHINE_KEY: &str = include_str!("../../licence/test-fixtures/other-machine.txt");
    const ISSUED_FRESH: &str =
        include_str!("../../licence/test-fixtures/issued-2026-09-26-permanent.txt");

    fn dt(y: i32, m: u8, d: u8, h: u8, min: u8) -> OffsetDateTime {
        time::PrimitiveDateTime::new(
            time::Date::from_calendar_date(y, time::Month::try_from(m).unwrap(), d).unwrap(),
            time::Time::from_hms(h, min, 0).unwrap(),
        )
        .assume_utc()
    }

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "sk-licence-runtime-{label}-{}-{}",
            std::process::id(),
            line!()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[tokio::test]
    async fn valid_activation_writes_the_file() {
        let _guard = set_overrides(dt(2030, 1, 1, 12, 0), TEST_MACHINE);
        let dir = temp_dir("valid-activate");
        let runtime = LicenceRuntime::new(Some(dir.clone()), false);

        let result = runtime.activate(VALID_PERMANENT, None, None).await;
        assert!(
            result.is_ok(),
            "expected activation to succeed: {:?}",
            result.err().map(|e| format!("{e}"))
        );
        assert!(storage::read_licence_key(&dir).is_some());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn expired_activation_is_rejected_and_not_written() {
        let _guard = set_overrides(dt(2030, 1, 1, 12, 0), TEST_MACHINE);
        let dir = temp_dir("expired-activate");
        let runtime = LicenceRuntime::new(Some(dir.clone()), false);

        let result = runtime.activate(EXPIRED, None, None).await;
        assert!(matches!(result, Err(AppError::LicenceExpired { .. })));
        assert!(storage::read_licence_key(&dir).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn wrong_machine_activation_is_rejected_and_not_written() {
        // OTHER_MACHINE_KEY is issued for STKH-TEST-0000-0000-0002; this
        // runtime's machine code is TEST_MACHINE (...0001).
        let _guard = set_overrides(dt(2030, 1, 1, 12, 0), TEST_MACHINE);
        let dir = temp_dir("wrong-machine-activate");
        let runtime = LicenceRuntime::new(Some(dir.clone()), false);

        let result = runtime.activate(OTHER_MACHINE_KEY, None, None).await;
        assert!(matches!(result, Err(AppError::LicenceWrongMachine { .. })));
        assert!(storage::read_licence_key(&dir).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn clock_rollback_with_a_stale_issued_fixture_is_rejected() {
        // "Now" is 2020-06-01; the on-disk state claims a last-seen 62 days
        // later — well past the 48h tolerance, so this must already read as
        // CLOCK_ROLLBACK before activation is even attempted.
        let real_now = dt(2020, 6, 1, 12, 0);
        let stored_last_seen = dt(2020, 8, 1, 12, 0);
        let _guard = set_overrides(real_now, TEST_MACHINE);
        let dir = temp_dir("rollback-stale");
        storage::write_state_file(&dir, real_now, stored_last_seen).unwrap();
        let runtime = LicenceRuntime::new(Some(dir.clone()), false);
        assert_eq!(runtime.snapshot().status, LicenceStatus::ClockRollback);

        // VALID_PERMANENT's issued_on (fixed at fixture-generation time, far
        // from 2020-06-01) is not within ±2 days of "now" — rejected.
        let result = runtime.activate(VALID_PERMANENT, None, None).await;
        assert!(matches!(result, Err(AppError::LicenceInvalid { .. })));
        assert!(storage::read_licence_key(&dir).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn clock_rollback_with_a_fresh_issued_fixture_is_accepted_and_last_seen_reset() {
        // ISSUED_FRESH's issued_on is exactly 2026-09-26; "now" matches it.
        let real_now = dt(2026, 9, 26, 10, 0);
        let stored_last_seen = dt(2026, 12, 1, 10, 0);
        let _guard = set_overrides(real_now, TEST_MACHINE);
        let dir = temp_dir("rollback-fresh");
        storage::write_state_file(&dir, real_now, stored_last_seen).unwrap();
        let runtime = LicenceRuntime::new(Some(dir.clone()), false);
        assert_eq!(runtime.snapshot().status, LicenceStatus::ClockRollback);

        let result = runtime.activate(ISSUED_FRESH, None, None).await;
        let evaluation = result.expect("a fresh-issued licence must reset the rollback");
        assert_eq!(evaluation.status, LicenceStatus::Active);
        assert!(storage::read_licence_key(&dir).is_some());

        let state = storage::read_state_file(&dir);
        assert_eq!(state.last_seen, Some(real_now));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn remove_deletes_the_file_and_reevaluates() {
        let _guard = set_overrides(dt(2030, 1, 1, 12, 0), TEST_MACHINE);
        let dir = temp_dir("remove");
        let runtime = LicenceRuntime::new(Some(dir.clone()), false);
        runtime
            .activate(VALID_PERMANENT, None, None)
            .await
            .expect("activation must succeed");
        assert!(storage::read_licence_key(&dir).is_some());

        let evaluation = runtime
            .remove(None, None)
            .await
            .expect("remove must succeed");
        assert!(storage::read_licence_key(&dir).is_none());
        assert!(matches!(
            evaluation.status,
            LicenceStatus::Grace | LicenceStatus::GraceOver
        ));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
