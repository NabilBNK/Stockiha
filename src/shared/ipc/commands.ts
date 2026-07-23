/**
 * Slice 1 — central registry of every production Tauri IPC command name.
 *
 * The frontend NEVER writes a raw command string anywhere else; all invokes
 * go through {@link ../ipc/gateway}. These names must exactly match the
 * `tauri::generate_handler!` list in `src-tauri/src/lib.rs`.
 */
export const COMMANDS = {
  // Diagnostics (Slice 0).
  GET_APP_INFO: 'get_app_info',
  CHECK_DB_HEALTH: 'check_db_health',
  // Setup (unauthenticated).
  GET_SETUP_STATUS: 'get_setup_status',
  BOOTSTRAP_FIRST_ADMIN: 'bootstrap_first_admin',
  // Auth.
  LOGIN: 'login',
  LOGOUT: 'logout',
  // Catalog.
  CREATE_PRODUCT: 'create_product',
  LIST_PRODUCTS: 'list_products',
  // Warehouses.
  CREATE_WAREHOUSE: 'create_warehouse',
  LIST_WAREHOUSES: 'list_warehouses',
  // Reference data + dashboard.
  LIST_FISCAL_PERIODS: 'list_fiscal_periods',
  GET_OPEN_FISCAL_PERIOD: 'get_open_fiscal_period',
  GET_DASHBOARD_SUMMARY: 'get_dashboard_summary',
  // Posting (transaction engine).
  POST_STOCK_RECEIPT: 'post_stock_receipt',
  OPEN_CASH_SESSION: 'open_cash_session',
  INSPECT_ACTIVE_CASH_SESSION: 'inspect_active_cash_session',
  CLOSE_CASH_SESSION: 'close_cash_session',
  GET_CASH_SESSION: 'get_cash_session',
  CONFIRM_CASH_SALE: 'confirm_cash_sale',
  // Posted documents / jobs.
  GET_SALE_DOCUMENT: 'get_sale_document',
  LIST_SALE_LINES: 'list_sale_lines',
  LIST_DOCUMENT_JOBS: 'list_document_jobs',
} as const;

export type CommandName = (typeof COMMANDS)[keyof typeof COMMANDS];
