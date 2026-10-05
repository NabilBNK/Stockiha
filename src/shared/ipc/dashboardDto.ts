/**
 * WS-N-1: TypeScript DTO contracts for Dashboard Data & Calculation Engine.
 * Exact mirror of Appendix A.2 in WS-N-dashboard-spec.md.
 */

export type DashboardPeriodKind = 'today' | 'week' | 'month' | 'year' | 'custom';
export type SeriesBucket = 'HOUR' | 'DAY' | 'MONTH';
export type ChangeKind = 'UP' | 'DOWN' | 'FLAT' | 'NO_BASE' | 'NONE';
export type DeltaKind = ChangeKind;
export type StockItemKind = 'low' | 'out' | 'dead';

export interface DashboardPeriod {
  cur_from: string;
  cur_to: string;
  prev_from: string;
  prev_to: string;
  cut_time: string | null;
  bucket: SeriesBucket;
  today: string;
}

export interface DashboardWindow {
  curFrom: string;
  curTo: string;
  prevFrom: string;
  prevTo: string;
  cutTime: string | null;
}

export function windowOf(p: DashboardPeriod): DashboardWindow {
  return {
    curFrom: p.cur_from,
    curTo: p.cur_to,
    prevFrom: p.prev_from,
    prevTo: p.prev_to,
    cutTime: p.cut_time,
  };
}

export interface DashboardMoneySummary {
  sales: string;
  prev_sales: string;
  sales_change_kind: ChangeKind;
  sales_change_pct: string | null;
  profit: string;
  prev_profit: string;
  profit_change_kind: ChangeKind;
  profit_change_pct: string | null;
  margin_pct: string | null;
  sale_count: number;
  prev_sale_count: number;
  count_change_kind: ChangeKind;
  count_change_pct: string | null;
  average_sale: string | null;
  discount_total: string;
  cash_sales: string;
  credit_sales: string;
  cash_in_drawer: string | null;
  open_session_count: number;
  receivables_total: string;
  payables_total: string;
}

export interface DashboardStockSummary {
  stock_value: string;
  low_count: number;
  out_count: number;
  dead_count: number;
  dead_value: string;
}

export interface DashboardStockItem {
  variant_id: number;
  product_id: number;
  item_name: string;
  display_identifier: string;
  identifier_type: string;
  base_unit_name: string;
  quantity: string;
  minimum_stock: string;
  stock_value: string;
  last_sold_on: string | null;
  total_count: number;
}

export interface DashboardTopItem {
  variant_id: number;
  item_name: string;
  base_unit_name: string;
  quantity_sold: string;
  sales_before_discount: string;
}

export interface DashboardTopCustomer {
  customer_id: number;
  customer_name: string;
  sale_count: number;
  sales: string;
}

export interface DashboardDebtor {
  customer_id: number;
  customer_name: string;
  amount_owed: string;
  oldest_open_on: string | null;
  oldest_open_days: number | null;
}
export type DashboardTopDebtor = DashboardDebtor;

export interface DashboardLatestSale {
  document_id: number;
  document_number: string;
  posted_local: string;
  sale_kind: 'CASH' | 'CREDIT';
  customer_name: string | null;
  total: string;
  is_voided: boolean;
}

export interface DashboardSeriesRow {
  bucket_start: string;
  sales: string;
  profit: string;
  cash_sales: string;
  credit_sales: string;
  purchases: string;
  sale_count: number;
}

export interface DashboardCategoryRow {
  sort_order: number;
  category_key: string;
  category_name: string | null;
  sales_before_discount: string;
  share_pct: string | null;
}

export interface DashboardBusyCell {
  weekday: number;
  hour: number;
  sale_count: number;
  sales: string;
}

export interface DashboardAgingRow {
  sort_order: number;
  bucket: '0_30' | '31_60' | '61_90' | '91_PLUS' | 'UNAPPLIED' | 'TOTAL';
  amount: string;
  item_count: number;
}
