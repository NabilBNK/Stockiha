use crate::state::AppState;
use serde::Serialize;
use tauri::State;

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub stage: String,
    pub status: String,
}

pub fn build_app_info(stage: &str) -> AppInfo {
    AppInfo {
        name: "Stockiha".to_owned(),
        version: env!("CARGO_PKG_VERSION").to_owned(),
        stage: stage.to_owned(),
        status: "Ready".to_owned(),
    }
}

#[tauri::command]
pub fn get_app_info(state: State<'_, AppState>) -> AppInfo {
    build_app_info(&state.stage)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_app_info() {
        let info = build_app_info("Slice 0");
        assert_eq!(info.name, "Stockiha");
        assert_eq!(info.version, env!("CARGO_PKG_VERSION"));
        assert_eq!(info.stage, "Slice 0");
        assert_eq!(info.status, "Ready");
    }
}
