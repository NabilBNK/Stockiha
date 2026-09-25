//! WS-K-7 — offline, signed licence activation (see
//! `WS-K-7-LICENCE-ACTIVATION-PLAN.md` for the full specification this
//! module implements exactly).
//!
//! A licence is a short, signed text key the Owner creates offline (Ed25519
//! via `tauri signer sign`) and sends to a shop. This application verifies
//! it against a public key compiled in; it never signs, so a leaked binary
//! can never mint a licence. The licence key pair is deliberately a
//! *separate* key pair from the update-signing one (plan §A3): if one
//! leaks, the other stays safe.
//!
//! An invalid or missing licence never refuses to open the app — it drops
//! selling into read-only mode (plan §O4, enforced centrally by
//! [`gate::is_blocked`]) while data stays viewable and every safety
//! operation (backup, closing the till, printing) keeps working.

pub(crate) mod evaluator;
pub(crate) mod gate;
pub(crate) mod machine;
pub(crate) mod payload;
pub(crate) mod runtime;
pub(crate) mod signature;
pub(crate) mod storage;

use serde::Serialize;
use time::OffsetDateTime;

pub(crate) use runtime::LicenceRuntime;

// ——— Constants (plan §4.1) ———

pub(crate) const GRACE_DAYS: i64 = 14;
pub(crate) const EXPIRY_WARNING_DAYS: i64 = 14;
pub(crate) const CLOCK_ROLLBACK_TOLERANCE_HOURS: i64 = 48;
pub(crate) const REEVALUATE_EVERY_MINUTES: u64 = 60;
pub(crate) const ALGERIA_OFFSET_HOURS: i8 = 1;
pub(crate) const MAX_KEY_LENGTH: usize = 4096;
pub(crate) const LICENCE_FILE: &str = "licence.key";
pub(crate) const STATE_FILE: &str = "licence-state.json";
pub(crate) const LOG_FILE: &str = "licence.log";

/// Public key selection: the real, committed production key in every
/// non-test build; a deliberately-public, test-only key pair under
/// `#[cfg(test)]` (plan §5.1, §9.1). Paths are relative to this file.
#[cfg(not(test))]
pub(crate) const PUBLIC_KEY_TEXT: &str = include_str!("../../licence/licence-public.key");
#[cfg(test)]
pub(crate) const PUBLIC_KEY_TEXT: &str = include_str!("../../licence/test-licence-public.key");

/// Status returned to the frontend (plan §3.7). `SCREAMING_SNAKE_CASE` to
/// match every other stable, wire-facing enum in this crate (see
/// `error::ErrorCode`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum LicenceStatus {
    Developer,
    Active,
    ExpiringSoon,
    Grace,
    GraceOver,
    Expired,
    Invalid,
    WrongMachine,
    ClockRollback,
    MachineUnavailable,
}

/// `FULL` for `DEVELOPER`/`ACTIVE`/`EXPIRING_SOON`/`GRACE`; `READ_ONLY` for
/// every other status (plan §3.7). The one value [`gate::is_blocked`] reads
/// at IPC-call time.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum LicenceMode {
    Full,
    ReadOnly,
}

impl LicenceStatus {
    pub(crate) fn mode(self) -> LicenceMode {
        match self {
            LicenceStatus::Developer
            | LicenceStatus::Active
            | LicenceStatus::ExpiringSoon
            | LicenceStatus::Grace => LicenceMode::Full,
            LicenceStatus::GraceOver
            | LicenceStatus::Expired
            | LicenceStatus::Invalid
            | LicenceStatus::WrongMachine
            | LicenceStatus::ClockRollback
            | LicenceStatus::MachineUnavailable => LicenceMode::ReadOnly,
        }
    }
}

/// The installed licence's own, non-secret details — shown even when the
/// licence is expired or belongs to another machine, so the Settings screen
/// can display what is actually installed (plan §3.7).
#[derive(Debug, Clone, Serialize)]
pub(crate) struct LicenceDetails {
    pub licence_id: String,
    pub licensee: String,
    pub issued_on: String,
    pub expires_on: Option<String>,
}

/// The exact shape `get_licence_status`/`activate_licence`/`remove_licence`/
/// `refresh_licence_status` return (plan §3.7), and the payload of the
/// `licence-status-changed` Tauri event.
#[derive(Debug, Clone, Serialize)]
pub(crate) struct LicenceStatusDto {
    pub status: LicenceStatus,
    pub mode: LicenceMode,
    pub machine_code: Option<String>,
    pub licence: Option<LicenceDetails>,
    pub days_left: Option<i64>,
    pub grace_days_left: Option<i64>,
    #[serde(with = "time::serde::rfc3339")]
    pub evaluated_at: OffsetDateTime,
}

impl LicenceStatusDto {
    /// The one place an [`evaluator::Evaluation`] becomes the wire-facing
    /// shape — shared by every IPC command and by the `licence-status-
    /// changed` Tauri event, so they can never disagree. `machine_code` is
    /// not part of `Evaluation` (it is an *input* to evaluation, not an
    /// output), so it is read fresh here.
    pub(crate) fn from_evaluation(evaluation: evaluator::Evaluation) -> Self {
        Self {
            status: evaluation.status,
            mode: evaluation.mode,
            machine_code: machine::machine_code(),
            licence: evaluation.licence,
            days_left: evaluation.days_left,
            grace_days_left: evaluation.grace_days_left,
            evaluated_at: evaluation.last_seen,
        }
    }
}
