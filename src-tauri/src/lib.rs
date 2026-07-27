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
            commands::stock_adjustment::confirm_stock_adjustment,
            commands::stock_adjustment::list_stock_adjustment_units,
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
            commands::procurement::create_supplier,
            commands::procurement::update_supplier,
            commands::procurement::list_suppliers,
            commands::procurement::create_purchase_order_draft,
            commands::procurement::update_purchase_order_draft,
            commands::procurement::confirm_purchase_order,
            commands::procurement::cancel_purchase_order,
            commands::procurement::list_purchase_orders,
            commands::procurement::get_purchase_order_detail,
            commands::procurement::confirm_purchase_receipt,
            commands::procurement::list_purchase_receipts,
            commands::procurement::allocate_landed_cost,
            commands::procurement::create_supplier_invoice_draft,
            commands::procurement::confirm_supplier_invoice,
            commands::procurement::list_supplier_invoices,
            commands::procurement::list_supplier_liabilities,
            commands::procurement::create_supplier_return_draft,
            commands::procurement::confirm_supplier_return,
            commands::procurement::post_supplier_payment,
            commands::procurement::list_supplier_returns,
            commands::procurement::list_supplier_payments,
            commands::customer::create_customer,
            commands::customer::list_customers,
            commands::customer::list_customer_liabilities,
            commands::customer::list_customer_payments,
            commands::customer::post_customer_payment,
            commands::cash_session::suspend_cash_session,
            commands::cash_session::resume_cash_session,
            commands::cash_session::submit_session_closing,
            commands::cash_session::approve_session_variance,
            commands::cash_session::list_pending_variance_sessions,
            commands::credit_override::generate_credit_override_token,
            commands::returns_transfers::confirm_customer_return,
            commands::returns_transfers::confirm_warehouse_transfer,
            commands::returns_transfers::confirm_stock_write_off,
            commands::returns_transfers::list_customer_returns,
            commands::returns_transfers::list_warehouse_transfers,
            commands::returns_transfers::list_stock_write_offs,
            commands::printing::enqueue_print_job,
            commands::printing::list_print_jobs,
            commands::printing::update_print_job_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}



