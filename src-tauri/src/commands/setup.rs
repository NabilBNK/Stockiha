//! Slice 1 Frontend MVP batch — thin Tauri commands for first-run setup.

use serde::Serialize;
use tauri::State;

use crate::application::{self, setup};
use crate::error::IpcError;
use crate::infrastructure::db::{self, DatabaseState};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SetupStatusResponse {
    pub initialized: bool,
    pub administrator_exists: bool,
    pub warehouse_exists: bool,
    pub open_fiscal_period_exists: bool,
    pub workstation_configured: bool,
}

/// Unauthenticated setup-status read for first-run routing.
#[tauri::command]
pub(crate) async fn get_setup_status(
    state: State<'_, DatabaseState>,
) -> Result<SetupStatusResponse, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    setup::get_setup_status(pool)
        .await
        .map(|s| SetupStatusResponse {
            initialized: s.initialized,
            administrator_exists: s.administrator_exists,
            warehouse_exists: s.warehouse_exists,
            open_fiscal_period_exists: s.open_fiscal_period_exists,
            workstation_configured: s.workstation_configured,
        })
        .map_err(IpcError::from)
}

/// One-time first-admin bootstrap. `password` is raw plaintext, hashed in the
/// application layer and never persisted or returned.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn bootstrap_first_admin(
    state: State<'_, DatabaseState>,
    username: String,
    password: String,
    display_name: String,
    workstation_id: String,
    warehouse_code: String,
    warehouse_name: String,
    period_code: String,
    period_starts_on: String,
    period_ends_on: String,
) -> Result<i64, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    let starts_on = application::parse_iso_date(&period_starts_on).map_err(IpcError::from)?;
    let ends_on = application::parse_iso_date(&period_ends_on).map_err(IpcError::from)?;

    setup::bootstrap_first_admin(
        pool,
        setup::BootstrapRequest {
            username,
            password,
            display_name,
            workstation_id,
            warehouse_code,
            warehouse_name,
            period_code,
            period_starts_on: starts_on,
            period_ends_on: ends_on,
        },
    )
    .await
    .map_err(IpcError::from)
}
