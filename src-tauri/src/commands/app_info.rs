use crate::error::AppError;
use crate::state::AppState;
use serde::Serialize;
use tauri::State;

#[derive(Debug, Serialize, PartialEq)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub stage: String,
    pub status: String,
}

#[tauri::command]
pub fn get_app_info(state: State<'_, AppState>) -> Result<AppInfo, AppError> {
    // If we wanted to test the error path, we could conditionally return an error.
    // For now, it returns the successful AppInfo.
    Ok(AppInfo {
        name: "Stockiha".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        stage: state.stage.clone(),
        status: "Ready".to_string(),
    })
}
