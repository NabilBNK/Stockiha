#![allow(dead_code)]
mod application;
pub mod commands;
#[cfg_attr(not(test), allow(dead_code))]
mod domain;
mod error;
mod infrastructure;
pub mod state;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(state::AppState {
            stage: "Slice 1".to_string(),
        })
        .manage(tauri::async_runtime::block_on(async {
            infrastructure::db::database_state_from_env()
        }))
        .invoke_handler(tauri::generate_handler![
            commands::app_info::get_app_info,
            commands::db_health::check_db_health,
            commands::auth::login,
            commands::auth::logout,
            commands::stock_receipt::post_stock_receipt,
            commands::cash_sale::confirm_cash_sale,
            commands::cash_session::open_cash_session,
            commands::cash_session::inspect_active_cash_session,
            commands::cash_session::close_cash_session,
            commands::cash_session::get_cash_session,
            commands::setup::get_setup_status,
            commands::setup::bootstrap_first_admin,
            commands::catalog::create_product,
            commands::catalog::list_products,
            commands::catalog::create_product_with_variants,
            commands::catalog::add_variant,
            commands::catalog::update_variant,
            commands::catalog::set_variant_active,
            commands::catalog::update_product,
            commands::catalog::create_attribute,
            commands::catalog::add_attribute_value,
            commands::catalog::list_attributes,
            commands::catalog::create_unit,
            commands::catalog::list_units,
            commands::catalog::set_variant_attributes,
            commands::catalog::add_variant_barcode,
            commands::catalog::remove_variant_barcode,
            commands::catalog::add_variant_alt_unit,
            commands::catalog::remove_variant_alt_unit,
            commands::catalog::set_variant_base_unit,
            commands::catalog::resolve_barcode,
            commands::catalog::list_catalog_products,
            commands::catalog::get_product_detail,
            commands::warehouse::create_warehouse,
            commands::warehouse::list_warehouses,
            commands::reference::list_fiscal_periods,
            commands::reference::get_open_fiscal_period,
            commands::reference::get_dashboard_summary,
            commands::documents::get_sale_document,
            commands::documents::list_sale_lines,
            commands::documents::list_document_jobs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
