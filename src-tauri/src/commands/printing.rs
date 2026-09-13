//! WS-F-002 — IPC surface for till receipt printing.

use tauri::State;

use crate::application::printing;
use crate::domain::printing::PrintingSettingsDto;
use crate::error::IpcError;
use crate::infrastructure::db::{self, DatabaseState};

#[tauri::command]
pub(crate) async fn print_raw_receipt(
    _state: State<'_, DatabaseState>,
    printer_name: String,
    payload: Vec<u8>,
) -> Result<u32, IpcError> {
    let written = printing::print_raw(&printer_name, payload).map_err(IpcError::from)?;
    Ok(written as u32)
}

#[tauri::command]
pub(crate) async fn get_printing_settings(
    state: State<'_, DatabaseState>,
    session_token: String,
) -> Result<PrintingSettingsDto, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    printing::get_printing_settings(pool, &session_token)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn save_printing_settings(
    state: State<'_, DatabaseState>,
    session_token: String,
    receipt_printing_enabled: bool,
    receipt_target: String,
    thermal_printer_name: Option<String>,
    thermal_columns: i16,
    shop_name: Option<String>,
    shop_address: Option<String>,
    shop_phone: Option<String>,
    receipt_footer: Option<String>,
) -> Result<PrintingSettingsDto, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    printing::save_printing_settings(
        pool,
        &session_token,
        receipt_printing_enabled,
        &receipt_target,
        thermal_printer_name.as_deref(),
        thermal_columns,
        shop_name.as_deref(),
        shop_address.as_deref(),
        shop_phone.as_deref(),
        receipt_footer.as_deref(),
    )
    .await
    .map_err(IpcError::from)
}
