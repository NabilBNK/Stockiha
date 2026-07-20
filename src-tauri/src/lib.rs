pub mod commands;
pub mod error;
pub mod state;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(state::AppState {
            stage: "Slice 0".to_string(),
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info::get_app_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::app_info::{get_app_info, AppInfo};
    use crate::state::AppState;

    #[test]
    fn test_get_app_info() {
        let app = tauri::test::mock_builder()
            .manage(AppState {
                stage: "Slice 0".to_string(),
            })
            .build(tauri::generate_context!())
            .unwrap();

        let state = app.state::<AppState>();
        let result = get_app_info(state).unwrap();

        assert_eq!(result.name, "Stockiha");
        assert_eq!(result.stage, "Slice 0");
        assert_eq!(result.status, "Ready");
    }
}
