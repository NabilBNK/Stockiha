use tauri::State;

use crate::application::opening_state_lifecycle;
use crate::domain::opening_state_lifecycle::{
    OpeningStateOnboardingStatusResult, SetOpeningStateOnboardingChoiceRequest,
};
use crate::error::IpcError;
use crate::infrastructure::db::{self, DatabaseState};

#[tauri::command]
pub(crate) async fn get_opening_state_onboarding_status(
    state: State<'_, DatabaseState>,
    session_token: String,
) -> Result<OpeningStateOnboardingStatusResult, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    opening_state_lifecycle::get_status(pool, &session_token)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn set_opening_state_onboarding_choice(
    state: State<'_, DatabaseState>,
    session_token: String,
    request: SetOpeningStateOnboardingChoiceRequest,
) -> Result<OpeningStateOnboardingStatusResult, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    opening_state_lifecycle::set_choice(pool, &session_token, request)
        .await
        .map_err(IpcError::from)
}
