use crate::application::credit_override;
use crate::domain::credit_override::{
    CreditOverrideTokenResult, GenerateCreditOverridePayload,
};
use crate::error::IpcError;
use crate::infrastructure::db::{self, DatabaseState};
use tauri::State;

#[tauri::command]
pub(crate) async fn generate_credit_override_token(
    state: State<'_, DatabaseState>,
    session_token: String,
    payload: GenerateCreditOverridePayload,
) -> Result<CreditOverrideTokenResult, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    credit_override::generate_credit_override_token(pool, &session_token, payload)
        .await
        .map_err(IpcError::from)
}
