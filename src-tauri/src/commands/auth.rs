//! Slice 1 MVP batch — thin Tauri commands for login/logout.
//!
//! Owns no logic: delegates to `application::auth`, converts
//! [`AppError`](crate::error::AppError) to
//! [`IpcError`](crate::error::IpcError) at the boundary, exactly like
//! `commands::db_health`.

use serde::Serialize;
use tauri::State;
use time::OffsetDateTime;

use crate::application::auth;
use crate::error::IpcError;
use crate::infrastructure::db::{self, DatabaseState};

#[derive(Serialize)]
pub(crate) struct LoginResponse {
    /// The raw opaque session token. The frontend holds this in memory for
    /// the session's lifetime and passes it back on every subsequent
    /// protected command; it is never written to disk by this command, and
    /// the database only ever stores its SHA-256 hash.
    pub session_token: String,
    #[serde(with = "time::serde::rfc3339")]
    pub expires_at: OffsetDateTime,
}

#[tauri::command]
pub(crate) async fn login(
    state: State<'_, DatabaseState>,
    username: String,
    password: String,
    workstation_id: String,
) -> Result<LoginResponse, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    auth::login(pool, &username, &password, &workstation_id)
        .await
        .map(|result| LoginResponse {
            session_token: result.session_token,
            expires_at: result.expires_at,
        })
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn logout(
    state: State<'_, DatabaseState>,
    session_token: String,
) -> Result<(), IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    auth::logout(pool, &session_token)
        .await
        .map_err(IpcError::from)
}
