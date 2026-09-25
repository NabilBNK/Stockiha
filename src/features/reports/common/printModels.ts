// WS-I-1 §5.8 — one `OfficialDocumentModel` builder per sales report,
// reusing the WS-M shared print/PDF engine (A9). Charts are never printed —
// only the tabular data behind them.

import type {
  OfficialDocumentColumn,
  OfficialDocumentModel,
  OfficialDocumentTotal,
} from '../../../shared/documents/officialDocument';
import type {
  MarginAlerts,
  SalesByCashier,
  SalesByCategory,
  SalesByHour,
  SalesByProduct,
  SalesSummary,
  SalesTimeseries,
} from '../../../shared/ipc/reportsDto';
import { formatQuantityWithPack } from './quantity';
import type { Period } from './periods';
import { WEEKDAY_KEYS } from './reportCopy';

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
