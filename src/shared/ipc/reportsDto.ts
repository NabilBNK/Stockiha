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

// WS-I-2 — finance, money owed and accountant reports.

export interface CashOutLine {
  date: string;
  note: string | null;
  amount: string;
}

export interface ProfitAndLoss {
  from: string;
  to: string;
  net_sales: string;
  cost_of_sales: string;
  gross_profit: string;
  margin_pct: string | null;
  expenses: string;
  expense_lines: CashOutLine[];
  cash_shortages: string;
  cash_overages: string;
  other_cash_out: string;
  other_cash_out_lines: CashOutLine[];
  net_result: string;
}

export interface CashFlow {
  from: string;
  to: string;
  in: {
    cash_sales: string;
    customer_payments_cash: string;
    cash_in: string;
    cash_in_by_reason: Record<string, string>;
  };
  out: {
    refunds: string;
    cancellations: string;
    cash_out: string;
    cash_out_by_reason: Record<string, string>;
  };
  supplier_payments_all_methods: string;
  net_drawer_flow: string;
}

export interface MonthlySummary {
  period: { from: string; to: string };
  pnl: ProfitAndLoss;
  purchases_total: string;
  receivables_now: string;
  payables_now: string;
  stock_value_now: string;
  top_products: SalesByProductRow[];
  previous_month: {
    from: string;
    to: string;
    net_sales: string;
    gross_profit: string;
    net_result: string;
  };
}

export interface ReceivablesAgingRow {
  customer_id: number;
  code: string;
  name: string;
  phone: string | null;
  credit_limit: string;
  total_open: string;
  not_due: string;
  d1_30: string;
  d31_60: string;
  d61_90: string;
  d90_plus: string;
  overdue_total: string;
  oldest_due_date: string | null;
  days_overdue: number;
  last_payment_date: string | null;
  last_payment_amount: string | null;
}

export interface ReceivablesAgingTotals {
  total_open: string;
  not_due: string;
  d1_30: string;
  d31_60: string;
  d61_90: string;
  d90_plus: string;
  overdue_total: string;
}

export interface ReceivablesAging {
  as_of: string;
  total_count: number;
  rows: ReceivablesAgingRow[];
  totals: ReceivablesAgingTotals;
}

export interface StatementEntry {
  date: string;
  entry_type: string;
  document_number: string | null;
  balance: string;
}

export interface CustomerStatementEntry extends StatementEntry {
  entry_id: number;
  debit: string;
  credit: string;
}

export interface CustomerStatement {
  customer: {
    customer_id: number;
    code: string;
    name: string;
    phone: string | null;
    address: string | null;
    credit_limit: string;
  };
  from: string;
  to: string;
  opening_balance: string;
  entries: CustomerStatementEntry[];
  truncated: boolean;
  total_debit: string;
  total_credit: string;
  closing_balance: string;
}

export interface SupplierBalanceRow {
  supplier_id: number;
  code: string;
  name: string;
  phone: string | null;
  total_purchased: string;
  total_returned: string;
  total_paid: string;
  balance_due: string;
  last_purchase_date: string | null;
  last_payment_date: string | null;
}

export interface SupplierBalances {
  total_count: number;
  rows: SupplierBalanceRow[];
  totals: { balance_due: string };
}

export interface SupplierStatementEntry extends StatementEntry {
  document_id: number;
  increase: string;
  decrease: string;
}

export interface SupplierStatement {
  supplier: { supplier_id: number; code: string; name: string; phone: string | null };
  from: string;
  to: string;
  opening_balance: string;
  entries: SupplierStatementEntry[];
  truncated: boolean;
  closing_balance: string;
}

export interface TrialBalanceRow {
  account_id: number | null;
  scf_code: string | null;
  name_fr: string | null;
  name_ar: string | null;
  name_en: string | null;
  opening_debit: string;
  opening_credit: string;
  period_debit: string;
  period_credit: string;
  closing_debit: string;
  closing_credit: string;
}

export interface TrialBalanceTotals {
  opening_debit: string;
  opening_credit: string;
  period_debit: string;
  period_credit: string;
  closing_debit: string;
  closing_credit: string;
  is_balanced: boolean;
  difference: string;
}

export interface TrialBalance {
  from: string;
  to: string;
  rows: TrialBalanceRow[];
  totals: TrialBalanceTotals;
}

export interface AccountLedgerRow {
  date: string;
  journal_id: number;
  journal_number: string | null;
  description: string | null;
  source_document_number: string | null;
  debit: string;
  credit: string;
  balance: string;
}

export interface AccountLedger {
  account: { account_id: number; scf_code: string; name_fr: string; name_ar: string; name_en: string };
  from: string;
  to: string;
  opening_balance: string;
  closing_balance: string;
  total_count: number;
  rows: AccountLedgerRow[];
}

export interface ReportAccountRow {
  account_id: number;
  scf_code: string;
  name_fr: string;
  name_ar: string;
  name_en: string;
}

export interface ReportAccountsList {
  rows: ReportAccountRow[];
}

// WS-I-3 — stock reports, notifications and the Today home.

export interface StockValuationRow {
  variant_id: number;
  product_name: string;
  variant_label: string | null;
  sku: string;
  category_name: string | null;
  quantity_base: string;
  base_unit_name: string;
  pack_unit_name: string | null;
  pack_factor: string | null;
  wac: string | null;
  stock_value: string;
  sale_price: string;
  retail_value: string;
  potential_margin: string;
}

export interface StockValuationTotals {
  variant_count: number;
  stock_value: string;
  retail_value: string;
  potential_margin: string;
}

export interface StockValuation {
  total_count: number;
  rows: StockValuationRow[];
  totals: StockValuationTotals;
}

export interface LowStockRow {
  variant_id: number;
  product_name: string;
  variant_label: string | null;
  sku: string;
  on_hand: string;
  minimum_stock: string;
  suggested_qty_base: string;
  suggested_packs: string | null;
  base_unit_name: string;
  pack_unit_name: string | null;
  pack_factor: string | null;
  last_supplier_id: number | null;
  last_supplier_name: string | null;
  last_unit_cost: string | null;
  last_purchase_date: string | null;
}

export interface LowStock {
  total_count: number;
  rows: LowStockRow[];
}

export interface SlowMoverRow {
  variant_id: number;
  product_name: string;
  variant_label: string | null;
  sku: string;
  on_hand: string;
  base_unit_name: string;
  pack_unit_name: string | null;
  pack_factor: string | null;
  stock_value: string;
  last_sale_date: string | null;
  days_since_last_sale: number | null;
  last_purchase_date: string | null;
}

export interface SlowMoversTotals {
  variant_count: number;
  stock_value: string;
}

export interface SlowMovers {
  days: number;
  total_count: number;
  rows: SlowMoverRow[];
  totals: SlowMoversTotals;
}

export interface ProductHistoryRow {
  movement_id: number;
  occurred_at: string;
  movement_type: string;
  reference_type: string;
  document_id: number | null;
  document_number: string | null;
  document_type: string | null;
  quantity_delta: string;
  running_quantity: string;
  value_delta: string;
}

export interface ProductHistory {
  variant: {
    variant_id: number;
    product_name: string;
    variant_label: string | null;
    sku: string;
    base_unit_name: string;
    pack_unit_name: string | null;
    pack_factor: string | null;
  };
  from: string;
  to: string;
  opening_quantity: string;
  closing_quantity: string;
  total_count: number;
  rows: ProductHistoryRow[];
}

export type NotificationKind =
  | 'OUT_OF_STOCK'
  | 'LOW_STOCK'
  | 'OVERDUE_DEBTS'
  | 'CREDIT_LIMIT_EXCEEDED'
  | 'MARGIN_ALERTS_7D'
  | 'SLOW_MOVERS_90D'
  | 'CASH_SESSION_LONG_OPEN'
  | 'BACKUP_OVERDUE';

export type NotificationSeverity = 'CRITICAL' | 'WARNING' | 'INFO';

export interface ReportNotificationItem {
  id: NotificationKind;
  kind: NotificationKind;
  severity: NotificationSeverity;
  count?: number;
  amount?: string;
  max_days?: number;
  session_id?: number;
  hours?: number;
  last_success_at?: string | null;
}

export interface ReportNotifications {
  generated_at: string;
  items: ReportNotificationItem[];
}

export interface TodayDrawer {
  session_id: number;
  status: string;
  opening_float: string;
  expected_now: string;
}

export interface TodayHourlyPoint {
  hour: number;
  net_sales: string;
  sale_count: number;
}

export interface TodayOverview {
  today: { date: string; summary: SalesSummary };
  same_day_last_week: { date: string; summary: SalesSummary };
  hourly_today: TodayHourlyPoint[];
  top_products_today: SalesByProductRow[];
  drawer: TodayDrawer | null;
  receivables_total: string;
  overdue_total: string;
  payables_total: string;
  low_stock_count: number;
  out_of_stock_count: number;
  month_to_date: { from: string; to: string; net_sales: string; gross_profit: string };
}
