//! Application services layer — the thin, testable Rust boundary between
//! Tauri IPC commands and the database's owner-controlled `SECURITY
//! DEFINER` posting functions.
//!
//! Every function here takes a `&sqlx::PgPool` and plain typed arguments,
//! never a `tauri::State` or any Tauri type — this module has no
//! compile-time dependency on `tauri` at all, unlike `crate::commands`. It
//! owns no authoritative business logic itself (that lives entirely in the
//! SQL posting functions this module calls); its job is exactly: build
//! canonical idempotency payloads, bind typed parameters, and translate
//! `sqlx::Error` into the crate's typed [`crate::error::AppError`].
//!
//! Crate-private and, for the IPC-adjacent modules, not yet exercised by a
//! Tauri command signature that can be compile-verified in this sandbox
//! (see the crate-level note in `lib.rs`) — dead code in non-test builds
//! until that changes.
pub(crate) mod auth;
pub(crate) mod cash_sale;
pub(crate) mod cash_session;
pub(crate) mod catalog;
pub(crate) mod credit_override;
pub(crate) mod customer_service;
pub(crate) mod dashboard;
pub(crate) mod documents;
pub(crate) mod fiscal;
pub(crate) mod history_service;
pub(crate) mod procurement_service;
pub(crate) mod printing_service;
pub(crate) mod returns_transfers_service;
pub(crate) mod setup;
pub(crate) mod stock_adjustment;
pub(crate) mod stock_receipt;
pub(crate) mod warehouse;

use time::Date;

use crate::error::AppError;

/// Parses an IPC-supplied `"YYYY-MM-DD"` string into a [`Date`]. Deliberately
/// manual (splitting on `-` and parsing three integers) rather than
/// `time`'s `format_description!`/parsing machinery: this crate's `time`
/// dependency only enables the `serde-well-known` feature for
/// `OffsetDateTime` timestamps (see `Cargo.toml`), not general date parsing,
/// and a three-field split needs no additional feature at all.
pub(crate) fn parse_iso_date(value: &str) -> Result<Date, AppError> {
    let mut parts = value.split('-');
    let (Some(year_str), Some(month_str), Some(day_str), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return Err(AppError::ValidationError {
            diagnostic: format!("'{value}' is not a YYYY-MM-DD date"),
        });
    };

    let year: i32 = year_str.parse().map_err(|_| AppError::ValidationError {
        diagnostic: format!("'{value}' has an invalid year"),
    })?;
    let month_num: u8 = month_str.parse().map_err(|_| AppError::ValidationError {
        diagnostic: format!("'{value}' has an invalid month"),
    })?;
    let day: u8 = day_str.parse().map_err(|_| AppError::ValidationError {
        diagnostic: format!("'{value}' has an invalid day"),
    })?;
    let month = time::Month::try_from(month_num).map_err(|_| AppError::ValidationError {
        diagnostic: format!("'{value}' has an out-of-range month"),
    })?;

    Date::from_calendar_date(year, month, day).map_err(|_| AppError::ValidationError {
        diagnostic: format!("'{value}' is not a valid calendar date"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_valid_iso_date() {
        let date = parse_iso_date("2026-01-15").unwrap();
        assert_eq!(date.to_string(), "2026-01-15");
    }

    #[test]
    fn rejects_malformed_input() {
        assert!(parse_iso_date("2026/01/15").is_err());
        assert!(parse_iso_date("not-a-date").is_err());
        assert!(parse_iso_date("2026-13-01").is_err());
        assert!(parse_iso_date("2026-01-99").is_err());
    }
}
