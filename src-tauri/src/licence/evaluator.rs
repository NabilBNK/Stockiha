//! WS-K-7 — the licence evaluator (plan §4). Pure with respect to its
//! input: every timestamp, file value, and database value is passed in by
//! the caller ([`super::runtime::LicenceRuntime`]), so this module performs
//! no IO and is fully unit-testable.

use time::{Duration, OffsetDateTime};

use super::{
    payload, signature, LicenceDetails, LicenceMode, LicenceStatus, ALGERIA_OFFSET_HOURS,
    CLOCK_ROLLBACK_TOLERANCE_HOURS, EXPIRY_WARNING_DAYS, GRACE_DAYS,
};

/// Every value the evaluator's algorithm reads (plan §4.2).
pub(crate) struct EvaluationInput<'a> {
    pub developer_mode: bool,
    pub machine_code: Option<&'a str>,
    /// Contents of `licence.key`, or `None` if no licence is installed.
    pub licence_key: Option<&'a str>,
    pub public_key_text: &'a str,
    pub now_utc: OffsetDateTime,
    pub file_first_seen: Option<OffsetDateTime>,
    pub file_last_seen: Option<OffsetDateTime>,
    pub db_first_seen: Option<OffsetDateTime>,
    pub db_last_seen: Option<OffsetDateTime>,
}

/// The evaluator's verdict (plan §4.3). `first_seen`/`last_seen` are the
/// values the caller must persist to both the file and the database.
#[derive(Clone)]
pub(crate) struct Evaluation {
    pub status: LicenceStatus,
    pub mode: LicenceMode,
    pub licence: Option<LicenceDetails>,
    pub days_left: Option<i64>,
    pub grace_days_left: Option<i64>,
    pub first_seen: OffsetDateTime,
    pub last_seen: OffsetDateTime,
}

/// `first_seen = min(file_first_seen, db_first_seen, now_utc)` over the
/// values that exist (`now_utc` always exists, so this always yields a
/// value). `last_seen_prev = max(file_last_seen, db_last_seen)` over the
/// values that exist, `None` if neither does.
fn first_seen_and_last_seen_prev(
    input: &EvaluationInput,
) -> (OffsetDateTime, Option<OffsetDateTime>) {
    let mut first_seen = input.now_utc;
    if let Some(file_value) = input.file_first_seen {
        first_seen = first_seen.min(file_value);
    }
    if let Some(db_value) = input.db_first_seen {
        first_seen = first_seen.min(db_value);
    }

    let last_seen_prev = match (input.file_last_seen, input.db_last_seen) {
        (Some(a), Some(b)) => Some(a.max(b)),
        (Some(a), None) | (None, Some(a)) => Some(a),
        (None, None) => None,
    };

    (first_seen, last_seen_prev)
}

/// The core algorithm, exactly as ordered in plan §4.4.
pub(crate) fn evaluate(input: &EvaluationInput) -> Evaluation {
    let (first_seen, last_seen_prev) = first_seen_and_last_seen_prev(input);

    // Step 2: developer mode.
    if input.developer_mode {
        let last_seen = last_seen_prev.map_or(input.now_utc, |prev| prev.max(input.now_utc));
        return Evaluation {
            status: LicenceStatus::Developer,
            mode: LicenceMode::Full,
            licence: None,
            days_left: None,
            grace_days_left: None,
            first_seen,
            last_seen,
        };
    }

    // Step 3: clock-rollback protection. `last_seen` is *not* lowered.
    if let Some(prev) = last_seen_prev {
        if input.now_utc < prev - Duration::hours(CLOCK_ROLLBACK_TOLERANCE_HOURS) {
            return Evaluation {
                status: LicenceStatus::ClockRollback,
                mode: LicenceMode::ReadOnly,
                licence: None,
                days_left: None,
                grace_days_left: None,
                first_seen,
                last_seen: prev,
            };
        }
    }

    // Step 4-5.
    let effective_now = last_seen_prev.map_or(input.now_utc, |prev| prev.max(input.now_utc));
    let last_seen = effective_now;
    let today_local = (effective_now + Duration::hours(i64::from(ALGERIA_OFFSET_HOURS))).date();

    // Step 6.
    let Some(machine_code) = input.machine_code else {
        return Evaluation {
            status: LicenceStatus::MachineUnavailable,
            mode: LicenceMode::ReadOnly,
            licence: None,
            days_left: None,
            grace_days_left: None,
            first_seen,
            last_seen,
        };
    };

    // Step 7: a licence key is installed.
    if let Some(licence_key) = input.licence_key {
        let verified = payload::parse_key(licence_key).ok().and_then(|parsed| {
            signature::verify(
                input.public_key_text,
                &parsed.payload_bytes,
                &parsed.sig_file_bytes,
            )
            .ok()
            .map(|()| parsed)
        });

        let Some(parsed) = verified else {
            return Evaluation {
                status: LicenceStatus::Invalid,
                mode: LicenceMode::ReadOnly,
                licence: None,
                days_left: None,
                grace_days_left: None,
                first_seen,
                last_seen,
            };
        };

        let details = LicenceDetails {
            licence_id: parsed.payload.licence_id.clone(),
            licensee: parsed.payload.licensee.clone(),
            issued_on: parsed.payload.issued_on.clone(),
            expires_on: parsed.payload.expires_on.clone(),
        };

        if parsed.payload.machine_code != machine_code {
            return Evaluation {
                status: LicenceStatus::WrongMachine,
                mode: LicenceMode::ReadOnly,
                licence: Some(details),
                days_left: None,
                grace_days_left: None,
                first_seen,
                last_seen,
            };
        }

        let Some(expires_on_str) = parsed.payload.expires_on.as_deref() else {
            return Evaluation {
                status: LicenceStatus::Active,
                mode: LicenceMode::Full,
                licence: Some(details),
                days_left: None,
                grace_days_left: None,
                first_seen,
                last_seen,
            };
        };

        // Already field-validated by `parse_key` (`expires_on >= issued_on`,
        // valid `YYYY-MM-DD`), so this can never fail here.
        let expires_on =
            payload::parse_date(expires_on_str).expect("expires_on already validated by parse_key");
        let days_left = (expires_on - today_local).whole_days();

        let (status, mode) = if days_left < 0 {
            (LicenceStatus::Expired, LicenceMode::ReadOnly)
        } else if days_left <= EXPIRY_WARNING_DAYS {
            (LicenceStatus::ExpiringSoon, LicenceMode::Full)
        } else {
            (LicenceStatus::Active, LicenceMode::Full)
        };

        return Evaluation {
            status,
            mode,
            licence: Some(details),
            days_left: Some(days_left),
            grace_days_left: None,
            first_seen,
            last_seen,
        };
    }

    // Step 8: no licence at all.
    let grace_end = first_seen + Duration::days(GRACE_DAYS);
    if effective_now < grace_end {
        let remaining = grace_end - effective_now;
        // `i64::div_ceil` (signed) is not yet stable; `remaining` is always
        // strictly positive here (`effective_now < grace_end`), so plain
        // ceiling-division arithmetic is safe and exact.
        let seconds = remaining.whole_seconds();
        let grace_days_left = ((seconds + 86_399) / 86_400).max(1);
        Evaluation {
            status: LicenceStatus::Grace,
            mode: LicenceMode::Full,
            licence: None,
            days_left: None,
            grace_days_left: Some(grace_days_left),
            first_seen,
            last_seen,
        }
    } else {
        Evaluation {
            status: LicenceStatus::GraceOver,
            mode: LicenceMode::ReadOnly,
            licence: None,
            days_left: None,
            grace_days_left: None,
            first_seen,
            last_seen,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_MACHINE: &str = "STKH-TEST-0000-0000-0001";
    const OTHER_MACHINE: &str = "STKH-TEST-0000-0000-0002";

    // Real, `tauri signer sign`-generated fixtures (plan §9.1), verifiable
    // against `PUBLIC_KEY_TEXT` under `#[cfg(test)]` (see `super::mod`).
    const VALID_PERMANENT: &str = include_str!("../../licence/test-fixtures/valid-permanent.txt");
    const VALID_2099: &str = include_str!("../../licence/test-fixtures/valid-2099-12-31.txt");
    const TAMPERED: &str = include_str!("../../licence/test-fixtures/tampered.txt");

    fn base(now_utc: OffsetDateTime) -> EvaluationInput<'static> {
        EvaluationInput {
            developer_mode: false,
            machine_code: Some(TEST_MACHINE),
            licence_key: None,
            public_key_text: super::super::PUBLIC_KEY_TEXT,
            now_utc,
            file_first_seen: None,
            file_last_seen: None,
            db_first_seen: None,
            db_last_seen: None,
        }
    }

    fn dt(y: i32, m: u8, d: u8, h: u8, min: u8) -> OffsetDateTime {
        time::PrimitiveDateTime::new(
            time::Date::from_calendar_date(y, time::Month::try_from(m).unwrap(), d).unwrap(),
            time::Time::from_hms(h, min, 0).unwrap(),
        )
        .assume_utc()
    }

    #[test]
    fn active_permanent_licence() {
        let mut input = base(dt(2030, 1, 1, 12, 0));
        input.licence_key = Some(VALID_PERMANENT);
        let eval = evaluate(&input);
        assert_eq!(eval.status, LicenceStatus::Active);
        assert_eq!(eval.mode, LicenceMode::Full);
        assert_eq!(eval.days_left, None);
        assert!(eval.licence.is_some());
    }

    #[test]
    fn active_dated_licence_with_correct_days_left() {
        // VALID_2099 expires 2099-12-31; 100 days before that at local
        // midday is comfortably outside the 14-day warning window.
        let mut input = base(dt(2099, 9, 23, 12, 0));
        input.licence_key = Some(VALID_2099);
        let eval = evaluate(&input);
        assert_eq!(eval.status, LicenceStatus::Active);
        assert_eq!(eval.mode, LicenceMode::Full);
        assert_eq!(eval.days_left, Some(99));
    }

    #[test]
    fn expiring_soon_at_exactly_fourteen_days_left() {
        // 2099-12-31 minus 14 days = 2099-12-17; local date at UTC noon is
        // the same as UTC (offset never crosses midnight here).
        let mut input = base(dt(2099, 12, 17, 12, 0));
        input.licence_key = Some(VALID_2099);
        let eval = evaluate(&input);
        assert_eq!(eval.status, LicenceStatus::ExpiringSoon);
        assert_eq!(eval.mode, LicenceMode::Full);
        assert_eq!(eval.days_left, Some(14));
    }

    #[test]
    fn expiring_soon_at_zero_days_left() {
        let mut input = base(dt(2099, 12, 31, 12, 0));
        input.licence_key = Some(VALID_2099);
        let eval = evaluate(&input);
        assert_eq!(eval.status, LicenceStatus::ExpiringSoon);
        assert_eq!(eval.mode, LicenceMode::Full);
        assert_eq!(eval.days_left, Some(0));
    }

    #[test]
    fn expired_the_day_after_expiry_in_local_time() {
        // 2099-12-31T23:30Z is already 2100-01-01 in Algeria (UTC+1) — one
        // day past the 2099-12-31 expiry, so it must already be expired.
        let mut input = base(dt(2099, 12, 31, 23, 30));
        input.licence_key = Some(VALID_2099);
        let eval = evaluate(&input);
        assert_eq!(eval.status, LicenceStatus::Expired);
        assert_eq!(eval.mode, LicenceMode::ReadOnly);
        assert_eq!(eval.days_left, Some(-1));
    }

    #[test]
    fn wrong_machine_is_reported_with_licence_details_still_present() {
        let mut input = base(dt(2030, 1, 1, 12, 0));
        input.machine_code = Some(OTHER_MACHINE);
        input.licence_key = Some(VALID_PERMANENT);
        let eval = evaluate(&input);
        assert_eq!(eval.status, LicenceStatus::WrongMachine);
        assert_eq!(eval.mode, LicenceMode::ReadOnly);
        assert!(eval.licence.is_some());
    }

    #[test]
    fn tampered_key_is_invalid_with_no_licence_details() {
        let mut input = base(dt(2030, 1, 1, 12, 0));
        input.licence_key = Some(TAMPERED);
        let eval = evaluate(&input);
        assert_eq!(eval.status, LicenceStatus::Invalid);
        assert_eq!(eval.mode, LicenceMode::ReadOnly);
        assert!(eval.licence.is_none());
    }

    #[test]
    fn grace_on_day_zero_and_day_thirteen() {
        let first_seen = dt(2026, 1, 1, 9, 0);

        let mut input_day0 = base(first_seen);
        input_day0.file_first_seen = Some(first_seen);
        let eval_day0 = evaluate(&input_day0);
        assert_eq!(eval_day0.status, LicenceStatus::Grace);
        assert_eq!(eval_day0.grace_days_left, Some(14));

        let mut input_day13 = base(first_seen + Duration::days(13));
        input_day13.file_first_seen = Some(first_seen);
        let eval_day13 = evaluate(&input_day13);
        assert_eq!(eval_day13.status, LicenceStatus::Grace);
        assert_eq!(eval_day13.grace_days_left, Some(1));
    }

    #[test]
    fn grace_over_on_day_fourteen() {
        let first_seen = dt(2026, 1, 1, 9, 0);
        let mut input = base(first_seen + Duration::days(14));
        input.file_first_seen = Some(first_seen);
        let eval = evaluate(&input);
        assert_eq!(eval.status, LicenceStatus::GraceOver);
        assert_eq!(eval.mode, LicenceMode::ReadOnly);
    }

    #[test]
    fn clock_rollback_at_forty_nine_hours_but_not_forty_seven() {
        let last_seen = dt(2026, 5, 1, 12, 0);

        let mut rollback = base(last_seen - Duration::hours(49));
        rollback.file_last_seen = Some(last_seen);
        let eval_rollback = evaluate(&rollback);
        assert_eq!(eval_rollback.status, LicenceStatus::ClockRollback);
        assert_eq!(eval_rollback.mode, LicenceMode::ReadOnly);
        // last_seen must not be lowered.
        assert_eq!(eval_rollback.last_seen, last_seen);

        let mut within_tolerance = base(last_seen - Duration::hours(47));
        within_tolerance.file_last_seen = Some(last_seen);
        let eval_within = evaluate(&within_tolerance);
        assert_ne!(eval_within.status, LicenceStatus::ClockRollback);
        // effective_now = last_seen (the later of the two), so last_seen is
        // unchanged even though `now_utc` itself was earlier.
        assert_eq!(eval_within.last_seen, last_seen);
    }

    #[test]
    fn first_seen_takes_the_earlier_of_file_and_db() {
        let file_value = dt(2026, 3, 10, 9, 0);
        let db_value = dt(2026, 3, 5, 9, 0);
        let mut input = base(dt(2026, 3, 20, 9, 0));
        input.file_first_seen = Some(file_value);
        input.db_first_seen = Some(db_value);
        let eval = evaluate(&input);
        assert_eq!(eval.first_seen, db_value);
    }

    #[test]
    fn last_seen_never_decreases() {
        let earlier_now = dt(2026, 3, 1, 9, 0);
        let later_stored = dt(2026, 3, 10, 9, 0);
        let mut input = base(earlier_now);
        input.file_last_seen = Some(later_stored);
        let eval = evaluate(&input);
        // Within the 48h clock-rollback tolerance is not the case here (9
        // days earlier), so this must be treated as a rollback, not a
        // silent lowering — proving `last_seen` is never simply set to
        // `now_utc` when a later value is already on record.
        assert_eq!(eval.status, LicenceStatus::ClockRollback);
        assert_eq!(eval.last_seen, later_stored);
    }

    #[test]
    fn developer_mode_is_full_regardless_of_licence_state() {
        let mut input = base(dt(2026, 1, 1, 9, 0));
        input.developer_mode = true;
        let eval = evaluate(&input);
        assert_eq!(eval.status, LicenceStatus::Developer);
        assert_eq!(eval.mode, LicenceMode::Full);
    }

    #[test]
    fn machine_unavailable_when_no_machine_code() {
        let mut input = base(dt(2026, 1, 1, 9, 0));
        input.machine_code = None;
        let eval = evaluate(&input);
        assert_eq!(eval.status, LicenceStatus::MachineUnavailable);
        assert_eq!(eval.mode, LicenceMode::ReadOnly);
    }
}
