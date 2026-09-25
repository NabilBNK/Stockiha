// WS-I-1 §5.8 — one `OfficialDocumentModel` builder per sales report,
// reusing the WS-M shared print/PDF engine (A9). Charts are never printed —
// only the tabular data behind them.

import type {
  OfficialDocumentColumn,
  OfficialDocumentModel,
  OfficialDocumentTotal,
} from '../../../shared/documents/officialDocument';
import type {
  AccountLedger,
  CashFlow,
  CustomerStatement,
  LowStock,
  MarginAlerts,
  MonthlySummary,
  ProductHistory,
  ProfitAndLoss,
  ReceivablesAging,
  SalesByCashier,
  SalesByCategory,
  SalesByHour,
  SalesByProduct,
  SalesSummary,
  SalesTimeseries,
  SlowMovers,
  StockValuation,
  SupplierBalances,
  SupplierStatement,
  TrialBalance,
} from '../../../shared/ipc/reportsDto';
import { formatQuantityWithPack } from './quantity';
import type { Period } from './periods';
import { entryTypeLabel, WEEKDAY_KEYS } from './reportCopy';

export interface ReportPrintContext {
  period: Period;
  comparison?: Period | null;
  copy: Record<string, string>;
  locale: 'fr' | 'ar' | 'en';
  todayText: string;
}

function periodRange(p: Period): string {
  return `${p.from} → ${p.to}`;
}

function buildReportModel(
  ctx: ReportPrintContext,
  kind: OfficialDocumentModel['kind'],
  title: string,
  columns: OfficialDocumentColumn[],
  rows: Array<Record<string, string>>,
  totals?: OfficialDocumentTotal[],
): OfficialDocumentModel {
  const metaRows = [{ label: ctx.copy.periodText, value: periodRange(ctx.period) }];
  if (ctx.comparison) {
    metaRows.push({ label: ctx.copy.periodText, value: periodRange(ctx.comparison) });
  }
  return {
    kind,
    title,
    documentNumber: `RPT-${ctx.period.from}_${ctx.period.to}`,
    documentDateText: ctx.todayText,
    metaBlock: { title: ctx.copy.periodText, rows: metaRows },
    columns,
    rows,
    totals,
  };
}

export function buildSalesSummaryModel(
  ctx: ReportPrintContext,
  summary: SalesSummary,
  previous: SalesSummary | null,
): OfficialDocumentModel {
  const metrics: Array<[string, string]> = [
    [ctx.copy.netSales, summary.net_sales],
    [ctx.copy.grossProfit, summary.gross_profit],
    [ctx.copy.marginPct, summary.margin_pct ?? '—'],
    [ctx.copy.saleCount, String(summary.sale_count)],
    [ctx.copy.avgBasket, summary.avg_basket ?? '—'],
    [ctx.copy.cashSales, summary.cash_net],
    [ctx.copy.creditSales, summary.credit_net],
    [ctx.copy.cancellations, String(summary.void_count)],
  ];
  const previousMetrics: Record<string, string> = previous
    ? {
        [ctx.copy.netSales]: previous.net_sales,
        [ctx.copy.grossProfit]: previous.gross_profit,
        [ctx.copy.marginPct]: previous.margin_pct ?? '—',
        [ctx.copy.saleCount]: String(previous.sale_count),
        [ctx.copy.avgBasket]: previous.avg_basket ?? '—',
        [ctx.copy.cashSales]: previous.cash_net,
        [ctx.copy.creditSales]: previous.credit_net,
        [ctx.copy.cancellations]: String(previous.void_count),
      }
    : {};
  return buildReportModel(
    ctx,
    'SALES_SUMMARY',
    ctx.copy.salesSummary,
    [
      { key: 'metric', label: '', align: 'start' },
      { key: 'value', label: ctx.copy.netSales, align: 'end' },
      { key: 'previous', label: ctx.copy.periodText, align: 'end' },
    ],
    metrics.map(([label, value]) => ({
      metric: label,
      value,
      previous: previous ? (previousMetrics[label] ?? '') : '',
    })),
  );
}

export function buildSalesOverTimeModel(
  ctx: ReportPrintContext,
  timeseries: SalesTimeseries,
): OfficialDocumentModel {
  return buildReportModel(
    ctx,
    'SALES_REPORT',
    ctx.copy.salesOverTime,
    [
      { key: 'bucket', label: ctx.copy.periodText, align: 'start' },
      { key: 'net', label: ctx.copy.netSales, align: 'end' },
      { key: 'profit', label: ctx.copy.grossProfit, align: 'end' },
      { key: 'count', label: ctx.copy.saleCount, align: 'end' },
    ],
    timeseries.rows.map((row) => ({
      bucket: row.bucket_start,
      net: row.net_sales,
      profit: row.gross_profit,
      count: String(row.sale_count),
    })),
  );
}

export function buildSalesByProductModel(ctx: ReportPrintContext, report: SalesByProduct): OfficialDocumentModel {
  return buildReportModel(
    ctx,
    'SALES_REPORT',
    ctx.copy.salesByProduct,
    [
      { key: 'product', label: ctx.copy.salesByProduct, align: 'start' },
      { key: 'sku', label: 'SKU', align: 'start' },
      { key: 'category', label: ctx.copy.salesByCategory, align: 'start' },
      { key: 'quantity', label: '', align: 'end' },
      { key: 'net', label: ctx.copy.netSales, align: 'end' },
      { key: 'cost', label: '', align: 'end' },
      { key: 'profit', label: ctx.copy.grossProfit, align: 'end' },
      { key: 'margin', label: ctx.copy.marginPct, align: 'end' },
    ],
    report.rows.map((row) => ({
      product: `${row.product_name} — ${row.variant_label}`,
      sku: row.sku,
      category: row.category_name ?? ctx.copy.noCategory,
      quantity: formatQuantityWithPack(row.quantity_base, row.base_unit_name, row.pack_unit_name, row.pack_factor, ctx.locale),
      net: row.net_revenue,
      cost: row.cost,
      profit: row.gross_profit,
      margin: row.margin_pct ?? '—',
    })),
    [
      { label: ctx.copy.netSales, value: report.totals.net_revenue },
      { label: ctx.copy.grossProfit, value: report.totals.gross_profit, emphasis: true },
    ],
  );
}

export function buildBestSellersModel(
  ctx: ReportPrintContext,
  byQuantity: SalesByProduct,
  byProfit: SalesByProduct,
): OfficialDocumentModel {
  const rows = [
    ...byQuantity.rows.slice(0, 10).map((row, index) => ({
      section: ctx.copy.saleCount,
      rank: String(index + 1),
      product: `${row.product_name} — ${row.variant_label}`,
      value: formatQuantityWithPack(row.quantity_base, row.base_unit_name, row.pack_unit_name, row.pack_factor, ctx.locale),
    })),
    ...byProfit.rows.slice(0, 10).map((row, index) => ({
      section: ctx.copy.grossProfit,
      rank: String(index + 1),
      product: `${row.product_name} — ${row.variant_label}`,
      value: row.gross_profit,
    })),
  ];
  return buildReportModel(
    ctx,
    'SALES_REPORT',
    ctx.copy.bestSellers,
    [
      { key: 'section', label: '', align: 'start' },
      { key: 'rank', label: '#', align: 'start' },
      { key: 'product', label: ctx.copy.salesByProduct, align: 'start' },
      { key: 'value', label: '', align: 'end' },
    ],
    rows,
  );
}

export function buildSalesByCategoryModel(ctx: ReportPrintContext, report: SalesByCategory): OfficialDocumentModel {
  return buildReportModel(
    ctx,
    'SALES_REPORT',
    ctx.copy.salesByCategory,
    [
      { key: 'category', label: ctx.copy.salesByCategory, align: 'start' },
      { key: 'net', label: ctx.copy.netSales, align: 'end' },
      { key: 'profit', label: ctx.copy.grossProfit, align: 'end' },
      { key: 'margin', label: ctx.copy.marginPct, align: 'end' },
      { key: 'quantity', label: '', align: 'end' },
      { key: 'share', label: '%', align: 'end' },
    ],
    report.rows.map((row) => ({
      category: row.category_name ?? ctx.copy.noCategory,
      net: row.net_revenue,
      profit: row.gross_profit,
      margin: row.margin_pct ?? '—',
      quantity: row.quantity_base,
      share: row.share_pct ?? '—',
    })),
  );
}

export function buildSalesByCashierModel(ctx: ReportPrintContext, report: SalesByCashier): OfficialDocumentModel {
  return buildReportModel(
    ctx,
    'SALES_REPORT',
    ctx.copy.salesByCashier,
    [
      { key: 'user', label: ctx.copy.salesByCashier, align: 'start' },
      { key: 'count', label: ctx.copy.saleCount, align: 'end' },
      { key: 'net', label: ctx.copy.netSales, align: 'end' },
      { key: 'profit', label: ctx.copy.grossProfit, align: 'end' },
      { key: 'avg', label: ctx.copy.avgBasket, align: 'end' },
      { key: 'cash', label: ctx.copy.cashSales, align: 'end' },
      { key: 'credit', label: ctx.copy.creditSales, align: 'end' },
    ],
    report.rows.map((row) => ({
      user: row.username ?? '—',
      count: String(row.sale_count),
      net: row.net_revenue,
      profit: row.gross_profit,
      avg: row.avg_basket ?? '—',
      cash: row.cash_net,
      credit: row.credit_net,
    })),
  );
}

export function buildBusyHoursModel(ctx: ReportPrintContext, report: SalesByHour): OfficialDocumentModel {
  return buildReportModel(
    ctx,
    'SALES_REPORT',
    ctx.copy.busyHours,
    [
      { key: 'weekday', label: '', align: 'start' },
      { key: 'hour', label: '', align: 'start' },
      { key: 'count', label: ctx.copy.saleCount, align: 'end' },
      { key: 'net', label: ctx.copy.netSales, align: 'end' },
    ],
    report.rows
      .filter((row) => row.sale_count > 0)
      .map((row) => ({
        weekday: ctx.copy[WEEKDAY_KEYS[row.weekday]] ?? String(row.weekday),
        hour: `${String(row.hour).padStart(2, '0')}:00`,
        count: String(row.sale_count),
        net: row.net_sales,
      })),
  );
}

export function buildMarginAlertsModel(ctx: ReportPrintContext, report: MarginAlerts): OfficialDocumentModel {
  return buildReportModel(
    ctx,
    'MARGIN_REPORT',
    ctx.copy.marginAlerts,
    [
      { key: 'product', label: ctx.copy.salesByProduct, align: 'start' },
      { key: 'quantity', label: '', align: 'end' },
      { key: 'net', label: ctx.copy.netSales, align: 'end' },
      { key: 'cost', label: '', align: 'end' },
      { key: 'profit', label: ctx.copy.grossProfit, align: 'end' },
      { key: 'margin', label: ctx.copy.marginPct, align: 'end' },
      { key: 'price', label: '', align: 'end' },
      { key: 'wac', label: '', align: 'end' },
      { key: 'suggested', label: ctx.copy.suggestedMinPrice, align: 'end' },
    ],
    report.rows.map((row) => ({
      product: `${row.product_name} — ${row.variant_label}`,
      quantity: formatQuantityWithPack(row.quantity_base, row.base_unit_name, row.pack_unit_name, row.pack_factor, ctx.locale),
      net: row.net_revenue,
      cost: row.cost,
      profit: row.gross_profit,
      margin: row.margin_pct ?? '—',
      price: row.current_sale_price ?? '—',
      wac: row.current_wac ?? '—',
      suggested: row.suggested_min_price ?? '—',
    })),
  );
}

// ============================================================================
// WS-I-2 — finance, money owed and accountant reports.
// ============================================================================

export function buildMonthlySummaryModel(ctx: ReportPrintContext, data: MonthlySummary): OfficialDocumentModel {
  const rows: Record<string, string>[] = [
    { metric: ctx.copy.netSales, value: data.pnl.net_sales },
    { metric: ctx.copy.costOfSales, value: data.pnl.cost_of_sales },
    { metric: ctx.copy.grossProfit, value: data.pnl.gross_profit },
    { metric: ctx.copy.marginPct, value: data.pnl.margin_pct ?? '—' },
    { metric: ctx.copy.expenses, value: data.pnl.expenses },
    { metric: ctx.copy.cashShortages, value: data.pnl.cash_shortages },
    { metric: ctx.copy.cashOverages, value: data.pnl.cash_overages },
    { metric: ctx.copy.netResult, value: data.pnl.net_result },
    { metric: ctx.copy.purchases, value: data.purchases_total },
    { metric: ctx.copy.owedToYou, value: data.receivables_now },
    { metric: ctx.copy.youOwe, value: data.payables_now },
    { metric: ctx.copy.stockValue, value: data.stock_value_now },
    ...data.top_products.map((p, i) => ({
      metric: `${ctx.copy.grossProfit} #${i + 1}: ${p.product_name} — ${p.variant_label}`,
      value: p.gross_profit,
    })),
  ];
  return buildReportModel(
    ctx,
    'MONTHLY_SUMMARY',
    `${ctx.copy.monthlySummary} — ${data.period.from} → ${data.period.to}`,
    [
      { key: 'metric', label: '', align: 'start' },
      { key: 'value', label: '', align: 'end' },
    ],
    rows,
    [{ label: ctx.copy.netResult, value: data.pnl.net_result, emphasis: true }],
  );
}

export function buildProfitLossModel(ctx: ReportPrintContext, data: ProfitAndLoss): OfficialDocumentModel {
  return buildReportModel(
    ctx,
    'PROFIT_LOSS',
    ctx.copy.profitLoss,
    [
      { key: 'label', label: '', align: 'start' },
      { key: 'amount', label: '', align: 'end' },
    ],
    [
      { label: ctx.copy.netSales, amount: data.net_sales },
      { label: ctx.copy.costOfSales, amount: data.cost_of_sales },
      { label: ctx.copy.grossProfit, amount: data.gross_profit },
      { label: ctx.copy.expenses, amount: data.expenses },
      { label: ctx.copy.cashShortages, amount: data.cash_shortages },
      { label: ctx.copy.cashOverages, amount: data.cash_overages },
    ],
    [
      { label: ctx.copy.grossProfit, value: data.gross_profit, emphasis: true },
      { label: ctx.copy.netResult, value: data.net_result, emphasis: true },
    ],
  );
}

export function buildCashFlowModel(ctx: ReportPrintContext, data: CashFlow): OfficialDocumentModel {
  const rows: Record<string, string>[] = [
    { section: ctx.copy.reports, label: 'Cash sales', amount: data.in.cash_sales },
    { section: ctx.copy.reports, label: 'Customer payments', amount: data.in.customer_payments_cash },
    { section: ctx.copy.reports, label: 'Cash in', amount: data.in.cash_in },
    { section: ctx.copy.reports, label: 'Refunds', amount: data.out.refunds },
    { section: ctx.copy.reports, label: 'Cancellations', amount: data.out.cancellations },
    { section: ctx.copy.reports, label: 'Cash out', amount: data.out.cash_out },
  ];
  return buildReportModel(
    ctx,
    'CASH_FLOW',
    ctx.copy.cashFlow,
    [
      { key: 'label', label: '', align: 'start' },
      { key: 'amount', label: '', align: 'end' },
    ],
    rows,
    [
      { label: 'Net drawer flow', value: data.net_drawer_flow, emphasis: true },
      { label: 'Paid to suppliers (all methods)', value: data.supplier_payments_all_methods },
    ],
  );
}

export function buildReceivablesAgingModel(ctx: ReportPrintContext, data: ReceivablesAging): OfficialDocumentModel {
  return buildReportModel(
    ctx,
    'AGING_REPORT',
    ctx.copy.receivables,
    [
      { key: 'name', label: ctx.copy.receivables, align: 'start' },
      { key: 'phone', label: '', align: 'start' },
      { key: 'total_open', label: '', align: 'end' },
      { key: 'not_due', label: ctx.copy.notDue, align: 'end' },
      { key: 'd1_30', label: '1-30', align: 'end' },
      { key: 'd31_60', label: '31-60', align: 'end' },
      { key: 'd61_90', label: '61-90', align: 'end' },
      { key: 'd90_plus', label: '90+', align: 'end' },
      { key: 'days_overdue', label: ctx.copy.daysOverdue, align: 'end' },
    ],
    data.rows.map((row) => ({
      name: `${row.name} (${row.code})`,
      phone: row.phone ?? '',
      total_open: row.total_open,
      not_due: row.not_due,
      d1_30: row.d1_30,
      d31_60: row.d31_60,
      d61_90: row.d61_90,
      d90_plus: row.d90_plus,
      days_overdue: String(row.days_overdue),
    })),
    [{ label: ctx.copy.receivables, value: data.totals.total_open, emphasis: true }],
  );
}

export function buildCustomerStatementModel(ctx: ReportPrintContext, data: CustomerStatement): OfficialDocumentModel {
  const model = buildReportModel(
    ctx,
    'CUSTOMER_STATEMENT',
    ctx.copy.customerStatement,
    [
      { key: 'date', label: '', align: 'start' },
      { key: 'document', label: '', align: 'start' },
      { key: 'type', label: '', align: 'start' },
      { key: 'debit', label: '', align: 'end' },
      { key: 'credit', label: '', align: 'end' },
      { key: 'balance', label: '', align: 'end' },
    ],
    [
      { date: ctx.period.from, document: '', type: ctx.copy.openingBalance, debit: '', credit: '', balance: data.opening_balance },
      ...data.entries.map((entry) => ({
        date: entry.date,
        document: entry.document_number ?? '',
        type: entryTypeLabel(entry.entry_type, ctx.copy),
        debit: entry.debit,
        credit: entry.credit,
        balance: entry.balance,
      })),
      { date: ctx.period.to, document: '', type: ctx.copy.closingBalance, debit: '', credit: '', balance: data.closing_balance },
    ],
    [
      { label: ctx.copy.openingBalance, value: data.opening_balance },
      { label: 'Total debit', value: data.total_debit },
      { label: 'Total credit', value: data.total_credit },
      { label: ctx.copy.balanceDue, value: data.closing_balance, emphasis: true },
    ],
  );
  model.partyBlock = {
    title: ctx.copy.customerStatement,
    rows: [
      { label: 'Code', value: data.customer.code },
      { label: ctx.copy.customerStatement, value: data.customer.name },
      { label: 'Phone', value: data.customer.phone ?? '' },
      { label: 'Address', value: data.customer.address ?? '' },
    ],
  };
  const closing = Number(data.closing_balance);
  if (closing > 0) model.amountInWordsValue = data.closing_balance;
  return model;
}

export function buildSupplierStatementModel(ctx: ReportPrintContext, data: SupplierStatement): OfficialDocumentModel {
  const model = buildReportModel(
    ctx,
    'SUPPLIER_STATEMENT',
    ctx.copy.supplierStatement,
    [
      { key: 'date', label: '', align: 'start' },
      { key: 'document', label: '', align: 'start' },
      { key: 'type', label: '', align: 'start' },
      { key: 'increase', label: '', align: 'end' },
      { key: 'decrease', label: '', align: 'end' },
      { key: 'balance', label: '', align: 'end' },
    ],
    [
      { date: ctx.period.from, document: '', type: ctx.copy.openingBalance, increase: '', decrease: '', balance: data.opening_balance },
      ...data.entries.map((entry) => ({
        date: entry.date,
        document: entry.document_number ?? '',
        type: entryTypeLabel(entry.entry_type, ctx.copy),
        increase: entry.increase,
        decrease: entry.decrease,
        balance: entry.balance,
      })),
      { date: ctx.period.to, document: '', type: ctx.copy.closingBalance, increase: '', decrease: '', balance: data.closing_balance },
    ],
    [{ label: ctx.copy.balanceDue, value: data.closing_balance, emphasis: true }],
  );
  model.partyBlock = {
    title: ctx.copy.supplierStatement,
    rows: [
      { label: 'Code', value: data.supplier.code },
      { label: ctx.copy.supplierStatement, value: data.supplier.name },
      { label: 'Phone', value: data.supplier.phone ?? '' },
    ],
  };
  return model;
}

export function buildSupplierBalancesModel(ctx: ReportPrintContext, data: SupplierBalances): OfficialDocumentModel {
  return buildReportModel(
    ctx,
    'SUPPLIER_BALANCES',
    ctx.copy.suppliersBalances,
    [
      { key: 'name', label: ctx.copy.suppliersBalances, align: 'start' },
      { key: 'phone', label: '', align: 'start' },
      { key: 'purchased', label: '', align: 'end' },
      { key: 'returned', label: '', align: 'end' },
      { key: 'paid', label: '', align: 'end' },
      { key: 'balance', label: ctx.copy.balanceDue, align: 'end' },
    ],
    data.rows.map((row) => ({
      name: `${row.name} (${row.code})`,
      phone: row.phone ?? '',
      purchased: row.total_purchased,
      returned: row.total_returned,
      paid: row.total_paid,
      balance: row.balance_due,
    })),
    [{ label: ctx.copy.balanceDue, value: data.totals.balance_due, emphasis: true }],
  );
}

export function buildTrialBalanceModel(ctx: ReportPrintContext, data: TrialBalance): OfficialDocumentModel {
  const accountName = (row: TrialBalance['rows'][number]): string => {
    const byLocale = ctx.locale === 'fr' ? row.name_fr : ctx.locale === 'ar' ? row.name_ar : row.name_en;
    return byLocale ?? row.name_fr ?? row.scf_code ?? '';
  };
  const model = buildReportModel(
    ctx,
    'TRIAL_BALANCE',
    ctx.copy.trialBalance,
    [
      { key: 'scf_code', label: '', align: 'start' },
      { key: 'name', label: '', align: 'start' },
      { key: 'opening_debit', label: '', align: 'end' },
      { key: 'opening_credit', label: '', align: 'end' },
      { key: 'period_debit', label: '', align: 'end' },
      { key: 'period_credit', label: '', align: 'end' },
      { key: 'closing_debit', label: '', align: 'end' },
      { key: 'closing_credit', label: '', align: 'end' },
    ],
    data.rows.map((row) => ({
      scf_code: row.scf_code ?? '',
      name: accountName(row),
      opening_debit: row.opening_debit,
      opening_credit: row.opening_credit,
      period_debit: row.period_debit,
      period_credit: row.period_credit,
      closing_debit: row.closing_debit,
      closing_credit: row.closing_credit,
    })),
    [
      { label: 'Opening', value: `${data.totals.opening_debit} / ${data.totals.opening_credit}` },
      { label: 'Period', value: `${data.totals.period_debit} / ${data.totals.period_credit}` },
      { label: 'Closing', value: `${data.totals.closing_debit} / ${data.totals.closing_credit}`, emphasis: true },
    ],
  );
  model.footerNote = data.totals.is_balanced
    ? ctx.copy.balanced
    : ctx.copy.notBalanced.replace('{x}', data.totals.difference);
  return model;
}

export function buildAccountLedgerModel(ctx: ReportPrintContext, data: AccountLedger): OfficialDocumentModel {
  const accountName = ctx.locale === 'fr' ? data.account.name_fr : ctx.locale === 'ar' ? data.account.name_ar : data.account.name_en;
  return buildReportModel(
    ctx,
    'ACCOUNT_LEDGER',
    `${ctx.copy.accountLedger} — ${data.account.scf_code} · ${accountName}`,
    [
      { key: 'date', label: '', align: 'start' },
      { key: 'journal_number', label: '', align: 'start' },
      { key: 'description', label: '', align: 'start' },
      { key: 'debit', label: '', align: 'end' },
      { key: 'credit', label: '', align: 'end' },
      { key: 'balance', label: '', align: 'end' },
    ],
    [
      { date: ctx.period.from, journal_number: '', description: ctx.copy.openingBalance, debit: '', credit: '', balance: data.opening_balance },
      ...data.rows.map((row) => ({
        date: row.date,
        journal_number: row.journal_number ?? '',
        description: row.description ?? '',
        debit: row.debit,
        credit: row.credit,
        balance: row.balance,
      })),
      { date: ctx.period.to, journal_number: '', description: ctx.copy.closingBalance, debit: '', credit: '', balance: data.closing_balance },
    ],
    [{ label: ctx.copy.closingBalance, value: data.closing_balance, emphasis: true }],
  );
}

export function buildStockValuationModel(ctx: ReportPrintContext, data: StockValuation): OfficialDocumentModel {
  return buildReportModel(
    ctx,
    'STOCK_REPORT',
    ctx.copy.stockValuation,
    [
      { key: 'product', label: ctx.copy.stockValuation, align: 'start' },
      { key: 'sku', label: 'SKU', align: 'start' },
      { key: 'category', label: ctx.copy.category, align: 'start' },
      { key: 'quantity', label: '', align: 'end' },
      { key: 'avg_cost', label: ctx.copy.avgCost, align: 'end' },
      { key: 'stock_value', label: ctx.copy.stockValue, align: 'end' },
      { key: 'retail_value', label: ctx.copy.retailValue, align: 'end' },
    ],
    data.rows.map((row) => ({
      product: `${row.product_name} — ${row.variant_label ?? ''}`,
      sku: row.sku,
      category: row.category_name ?? ctx.copy.noCategory,
      quantity: formatQuantityWithPack(row.quantity_base, row.base_unit_name, row.pack_unit_name, row.pack_factor, ctx.locale),
      avg_cost: row.wac ?? '—',
      stock_value: row.stock_value,
      retail_value: row.retail_value,
    })),
    [
      { label: ctx.copy.stockValue, value: data.totals.stock_value, emphasis: true },
      { label: ctx.copy.retailValue, value: data.totals.retail_value },
    ],
  );
}

export function buildLowStockModel(ctx: ReportPrintContext, data: LowStock): OfficialDocumentModel {
  return buildReportModel(
    ctx,
    'STOCK_REPORT',
    ctx.copy.lowStock,
    [
      { key: 'product', label: ctx.copy.lowStock, align: 'start' },
      { key: 'sku', label: 'SKU', align: 'start' },
      { key: 'on_hand', label: ctx.copy.onHand, align: 'end' },
      { key: 'minimum', label: ctx.copy.minimumStock, align: 'end' },
      { key: 'suggested', label: ctx.copy.suggestedOrder, align: 'end' },
      { key: 'supplier', label: ctx.copy.lastSupplier, align: 'start' },
    ],
    data.rows.map((row) => ({
      product: `${row.product_name} — ${row.variant_label ?? ''}`,
      sku: row.sku,
      on_hand: row.on_hand,
      minimum: row.minimum_stock,
      suggested: row.suggested_qty_base,
      supplier: row.last_supplier_name ?? '—',
    })),
  );
}

export function buildSlowMoversModel(ctx: ReportPrintContext, data: SlowMovers): OfficialDocumentModel {
  return buildReportModel(
    ctx,
    'STOCK_REPORT',
    ctx.copy.slowMovers,
    [
      { key: 'product', label: ctx.copy.slowMovers, align: 'start' },
      { key: 'sku', label: 'SKU', align: 'start' },
      { key: 'on_hand', label: ctx.copy.onHand, align: 'end' },
      { key: 'stock_value', label: ctx.copy.stockValue, align: 'end' },
      { key: 'last_sale', label: ctx.copy.lastSale, align: 'start' },
      { key: 'days_since', label: ctx.copy.daysSince, align: 'end' },
    ],
    data.rows.map((row) => ({
      product: `${row.product_name} — ${row.variant_label ?? ''}`,
      sku: row.sku,
      on_hand: formatQuantityWithPack(row.on_hand, row.base_unit_name, row.pack_unit_name, row.pack_factor, ctx.locale),
      stock_value: row.stock_value,
      last_sale: row.last_sale_date ?? ctx.copy.neverSold,
      days_since: row.days_since_last_sale === null ? '—' : String(row.days_since_last_sale),
    })),
    [{ label: ctx.copy.stockValue, value: data.totals.stock_value, emphasis: true }],
  );
}

export function buildProductHistoryModel(ctx: ReportPrintContext, data: ProductHistory): OfficialDocumentModel {
  return buildReportModel(
    ctx,
    'STOCK_REPORT',
    `${ctx.copy.productHistory} — ${data.variant.product_name} — ${data.variant.variant_label ?? ''}`,
    [
      { key: 'date', label: ctx.copy.dateTime, align: 'start' },
      { key: 'movement', label: ctx.copy.movement, align: 'start' },
      { key: 'document', label: ctx.copy.document, align: 'start' },
      { key: 'delta', label: ctx.copy.quantityChange, align: 'end' },
      { key: 'running', label: ctx.copy.runningQuantity, align: 'end' },
    ],
    [
      { date: data.from, movement: '', document: '', delta: '', running: data.opening_quantity },
      ...data.rows.map((row) => ({
        date: row.occurred_at,
        movement: row.movement_type,
        document: row.document_number ?? '',
        delta: row.quantity_delta,
        running: row.running_quantity,
      })),
      { date: data.to, movement: '', document: '', delta: '', running: data.closing_quantity },
    ],
  );
}
