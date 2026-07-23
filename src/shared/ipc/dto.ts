/**
 * Slice 1 — TypeScript DTOs mirroring the backend's serialized IPC payloads.
 *
 * Field names are snake_case because that is exactly what the Rust command
 * response structs serialize to (serde default; verified against
 * `src-tauri/src/commands/*.rs`). Exact-decimal values (money, quantity,
 * WAC, prices, totals) are carried as STRINGS — never JS numbers — so no
 * authoritative value round-trips through IEEE-754 in the browser. React
 * may parse them for provisional display, but the backend result is
 * authoritative.
 */

export interface SetupStatus {
  initialized: boolean;
  administrator_exists: boolean;
  warehouse_exists: boolean;
  open_fiscal_period_exists: boolean;
  workstation_configured: boolean;
}

export interface LoginResult {
  session_token: string;
  /** RFC3339 timestamp. */
  expires_at: string;
}

export interface CreatedProduct {
  product_id: number;
  variant_id: number;
}

export interface ProductListItem {
  product_id: number;
  variant_id: number;
  sku: string;
  name: string;
  /** Exact decimal string. */
  sale_price: string;
  is_active: boolean;
  /** Exact decimal string. */
  quantity_on_hand: string;
  /** Exact decimal string. */
  last_known_wac: string;
}

export interface Warehouse {
  id: number;
  code: string;
  name: string;
  is_active: boolean;
}

export interface FiscalPeriod {
  id: number;
  period_code: string;
  starts_on: string;
  ends_on: string;
  status: string;
}

export interface OpenFiscalPeriod {
  id: number;
  period_code: string;
  starts_on: string;
  ends_on: string;
}

export interface ActiveCashSession {
  id: number;
  warehouse_id: number;
  opened_by_user_id: number;
  /** Exact decimal string. */
  opening_float: string;
  opened_at: string;
}

export interface CashSessionDetail {
  id: number;
  warehouse_id: number;
  status: string;
  /** Exact decimal string. */
  opening_float: string;
  /** Exact decimal string; present once closed. */
  expected_amount: string | null;
  /** Exact decimal string; present once closed. */
  counted_amount: string | null;
  /** Exact decimal string; present once closed. */
  variance_amount: string | null;
  opened_at: string;
  closed_at: string | null;
}

export interface DashboardSummary {
  product_count: number;
  variant_count: number;
  active_cash_session_id: number | null;
  latest_document_id: number | null;
  latest_document_number: string | null;
  pending_generation_jobs: number;
  pending_print_jobs: number;
}

export interface SaleDocument {
  document_id: number;
  document_type: string;
  status: string;
  document_number: string | null;
  document_date: string;
  posted_at: string | null;
  /** Exact decimal string. */
  subtotal: string;
  /** Exact decimal string. */
  total_amount: string;
}

export interface SaleLine {
  line_number: number;
  variant_sku_snapshot: string;
  variant_name_snapshot: string;
  /** Exact decimal string. */
  quantity: string;
  /** Exact decimal string. */
  unit_price: string;
  /** Exact decimal string. */
  line_total: string;
}

export type DocumentJobKind = 'GENERATION' | 'PRINT' | 'DRAWER';

export interface DocumentJob {
  job_kind: DocumentJobKind;
  id: number;
  status: string;
  attempt_count: number;
}

/** One POS cart line as sent to `confirm_cash_sale` (decimals as strings). */
export interface CashSaleLineInput {
  variant_id: number;
  quantity: string;
  unit_price: string;
}
