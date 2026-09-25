// WS-I-1 — types for the `reports.*` read-only functions. Field names
// mirror the SQL's `jsonb` keys verbatim (snake_case): the Rust commands
// pass the SQL result straight through as `serde_json::Value`, so no
// camelCase renaming happens on the wire.

export interface ReportsCapabilities {
  can_view_reports: boolean;
}

export interface SalesSummary {
  from: string;
  to: string;
  gross_sales: string;
  discounts: string;
  net_sales: string;
  cost: string;
  gross_profit: string;
  margin_pct: string | null;
  sale_count: number;
  avg_basket: string | null;
  cash_net: string;
  credit_net: string;
  cash_count: number;
  credit_count: number;
  void_count: number;
  void_total: string;
  units_sold_base: string;
}

export interface SalesTimeseriesPoint {
  bucket_start: string;
  net_sales: string;
  gross_profit: string;
  sale_count: number;
}

export interface SalesTimeseries {
  granularity: 'DAY' | 'WEEK' | 'MONTH';
  rows: SalesTimeseriesPoint[];
}

export interface SalesByProductRow {
  variant_id: number;
  product_name: string;
  variant_label: string;
  sku: string;
  category_name: string | null;
  quantity_base: string;
  base_unit_name: string;
  pack_unit_name: string | null;
  pack_factor: string | null;
  net_revenue: string;
  cost: string;
  gross_profit: string;
  margin_pct: string | null;
  sale_count: number;
}

export interface SalesByProductTotals {
  net_revenue: string;
  cost: string;
  gross_profit: string;
}

export interface SalesByProduct {
  total_count: number;
  rows: SalesByProductRow[];
  totals: SalesByProductTotals;
}

export interface SalesByCategoryRow {
  category_id: number | null;
  category_name: string | null;
  net_revenue: string;
  gross_profit: string;
  margin_pct: string | null;
  quantity_base: string;
  share_pct: string | null;
}

export interface SalesByCategory {
  rows: SalesByCategoryRow[];
}

export interface SalesByCashierRow {
  user_id: number | null;
  username: string | null;
  sale_count: number;
  net_revenue: string;
  gross_profit: string;
  avg_basket: string | null;
  cash_net: string;
  credit_net: string;
}

export interface SalesByCashier {
  rows: SalesByCashierRow[];
}

export interface SalesByHourCell {
  weekday: number;
  hour: number;
  sale_count: number;
  net_sales: string;
}

export interface SalesByHour {
  rows: SalesByHourCell[];
}

export interface MarginAlertRow {
  variant_id: number;
  product_name: string;
  variant_label: string;
  sku: string;
  quantity_base: string;
  base_unit_name: string;
  pack_unit_name: string | null;
  pack_factor: string | null;
  net_revenue: string;
  cost: string;
  gross_profit: string;
  margin_pct: string | null;
  below_cost_lines: number;
  current_sale_price: string | null;
  current_wac: string | null;
  suggested_min_price: string | null;
}

export interface MarginAlerts {
  threshold_pct: string;
  rows: MarginAlertRow[];
}
