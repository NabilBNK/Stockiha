pub mod commands;
// S0-002 defines the typed error contract before the first genuinely fallible
// command consumes it. Remove this exemption when the first consumer is added.
#[cfg_attr(not(test), allow(dead_code))]
mod error;
pub mod state;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(state::AppState {
            stage: "Slice 0".to_string(),
        })
        .invoke_handler(tauri::generate_handler![commands::app_info::get_app_info])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
