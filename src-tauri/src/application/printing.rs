//! WS-F-002 — synchronous raw printing for till receipts.
//!
//! Sends ESC/POS bytes to a named Windows printer using the already-tested
//! spooler writer in `infrastructure::escpos_proof`. Printing is synchronous
//! and deliberately has no retry queue: the sale is already recorded before
//! this is called, and a failure is surfaced to the cashier who can reprint.
//!
//! Neither the printer name nor the payload is ever interpolated into an
//! error message — both may carry customer data.

use crate::domain::printing::PrintingSettingsDto;
use crate::error::AppError;
use crate::infrastructure::escpos_proof::{send_raw_job, SpoolerJob};
use serde_json::Value as JsonValue;
use sqlx::{query_scalar, PgPool};

/// Sends raw bytes to a Windows printer by name.
///
/// Returns the number of bytes the spooler accepted.
#[cfg(windows)]
pub(crate) fn print_raw(printer_name: &str, payload: Vec<u8>) -> Result<usize, AppError> {
    let job =
        SpoolerJob::new(printer_name, payload).map_err(|error| AppError::ValidationError {
            diagnostic: format!("Printer job rejected: {error}"),
        })?;

    send_raw_job(&job).map_err(|error| AppError::internal(format!("Printing failed: {error}")))
}

/// Non-Windows builds compile but cannot print. The app ships on Windows only;
/// this arm exists so `cargo check` and CI pass on Linux.
#[cfg(not(windows))]
pub(crate) fn print_raw(printer_name: &str, payload: Vec<u8>) -> Result<usize, AppError> {
    let _ = SpoolerJob::new(printer_name, payload).map_err(|error| AppError::ValidationError {
        diagnostic: format!("Printer job rejected: {error}"),
    })?;

    Err(AppError::internal(
        "Raw printing is only available on Windows".to_string(),
    ))
}

pub(crate) async fn get_printing_settings(
    pool: &PgPool,
    session_token: &str,
) -> Result<PrintingSettingsDto, AppError> {
    let res: JsonValue = query_scalar("SELECT core.get_printing_settings($1)")
        .bind(session_token)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    serde_json::from_value(res)
        .map_err(|e| AppError::internal(format!("Failed to parse printing settings: {e}")))
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn save_printing_settings(
    pool: &PgPool,
    session_token: &str,
    receipt_printing_enabled: bool,
    receipt_target: &str,
    thermal_printer_name: Option<&str>,
    thermal_columns: i16,
    shop_name: Option<&str>,
    shop_address: Option<&str>,
    shop_phone: Option<&str>,
    receipt_footer: Option<&str>,
) -> Result<PrintingSettingsDto, AppError> {
    let res: JsonValue =
        query_scalar("SELECT core.save_printing_settings($1, $2, $3, $4, $5, $6, $7, $8, $9)")
            .bind(session_token)
            .bind(receipt_printing_enabled)
            .bind(receipt_target)
            .bind(thermal_printer_name)
            .bind(thermal_columns)
            .bind(shop_name)
            .bind(shop_address)
            .bind(shop_phone)
            .bind(receipt_footer)
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    serde_json::from_value(res)
        .map_err(|e| AppError::internal(format!("Failed to parse printing settings: {e}")))
}
