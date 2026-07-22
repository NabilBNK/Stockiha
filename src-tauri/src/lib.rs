pub mod commands;
// S0-003: the error contract gained its first genuine fallible consumer
// (`check_db_health`), so the S0-002 dead-code exemption is removed. The module
// stays crate-private: the typed error contract and the database infrastructure
// are internal API. The connectivity tests live inside the crate
// (`infrastructure::db` `#[cfg(test)]`), so no external test crate needs access.
// S1-001: domain value types, typed identifiers, status enums, and
// validation constructors for the new production schemas (products,
// warehouse stock, cash sales, journal entries, fiscal periods, document
// sequences). Crate-private and consumer-free (no Tauri command, no IPC,
// no application service reads/writes the database through it yet); dead
// code in non-test builds until a later slice's application service is a
// real consumer. The exemption is removed then — same posture as every
// Slice 0 proof module below.
#[cfg_attr(not(test), allow(dead_code))]
mod domain;
mod error;
mod infrastructure;
pub mod state;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(state::AppState {
            stage: "Slice 0".to_string(),
        })
        // Safe on missing/invalid configuration: the app starts and the health
        // command reports the state. The URL value itself is never logged.
        // block_on provides the Tokio context SQLx requires to spawn the
        // pool's background maintenance task at construction (the pool itself
        // stays lazy — no connection is attempted here).
        .manage(tauri::async_runtime::block_on(async {
            infrastructure::db::database_state_from_env()
        }))
        .invoke_handler(tauri::generate_handler![
            commands::app_info::get_app_info,
            commands::db_health::check_db_health
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
