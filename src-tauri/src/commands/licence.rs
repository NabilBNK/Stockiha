//! WS-K-7 — thin Tauri commands for licence status, activation, and
//! removal (plan §5.8). Every command delegates entirely to
//! `licence::LicenceRuntime`; a missing or unusable database is not an
//! error here (the licence engine works file-only, per plan §5.5/§5.6) —
//! it is simply treated as "no pool available".

use tauri::State;

use crate::error::IpcError;
use crate::infrastructure::db::{self, DatabaseState};
use crate::licence::{LicenceRuntime, LicenceStatusDto};

/// Returns the current cached snapshot. Never errors — a licence problem is
/// reported through `status`/`mode`, not through the IPC error channel, so
/// the frontend's fail-open provider never needs to special-case this call.
#[tauri::command]
pub(crate) async fn get_licence_status(
    runtime: State<'_, LicenceRuntime>,
) -> Result<LicenceStatusDto, IpcError> {
    Ok(LicenceStatusDto::from_evaluation(runtime.snapshot()))
}

/// Forces a full `refresh()` (file + DB), used by the Licence screen's
/// "Check again" button.
#[tauri::command]
pub(crate) async fn refresh_licence_status(
    runtime: State<'_, LicenceRuntime>,
    db: State<'_, DatabaseState>,
) -> Result<LicenceStatusDto, IpcError> {
    let pool = db::pool_or_unavailable(db.inner()).ok();
    Ok(LicenceStatusDto::from_evaluation(
        runtime.refresh(pool).await,
    ))
}

#[tauri::command]
pub(crate) async fn activate_licence(
    runtime: State<'_, LicenceRuntime>,
    db: State<'_, DatabaseState>,
    session_token: String,
    licence_key: String,
) -> Result<LicenceStatusDto, IpcError> {
    let pool = db::pool_or_unavailable(db.inner()).ok();
    let evaluation = runtime
        .activate(&licence_key, pool, Some(&session_token))
        .await
        .map_err(IpcError::from)?;
    Ok(LicenceStatusDto::from_evaluation(evaluation))
}

#[tauri::command]
pub(crate) async fn remove_licence(
    runtime: State<'_, LicenceRuntime>,
    db: State<'_, DatabaseState>,
    session_token: String,
) -> Result<LicenceStatusDto, IpcError> {
    let pool = db::pool_or_unavailable(db.inner()).ok();
    let evaluation = runtime
        .remove(pool, Some(&session_token))
        .await
        .map_err(IpcError::from)?;
    Ok(LicenceStatusDto::from_evaluation(evaluation))
}
