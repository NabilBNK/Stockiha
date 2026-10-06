// WS-R — Custom Report & Transaction Explorer
// Allows the pilot user to dynamically slice data across transaction domains,
// custom date ranges, keywords, and export to CSV/Print.

import { useState } from 'react';

import { Button } from '../../../shared/components';
import { useI18n } from '../../../shared/i18n';
import { useSession } from '../../../shared/session/SessionContext';
import * as reportsGateway from '../../../shared/ipc/reportsGateway';
import { saveDocumentFileWithDialog } from '../../../shared/documents/documentPrintService';
import { KpiCard } from '../common/KpiCard';
import { PeriodPicker } from '../common/PeriodPicker';
import { ReportFrame } from '../common/ReportFrame';
import { ReportTable, type ReportTableColumn } from '../common/ReportTable';
import { csvBytes, toCsv } from '../common/csv';
import { presetPeriod, type Period } from '../common/periods';
import { useReportCopy } from '../common/reportCopy';

type DatasetType = 'products' | 'categories' | 'cashiers' | 'margins';

interface CustomRow {
  id: string;
  name: string;
  count: number;
  revenue: number;
  profit?: number;
  margin?: string;
  [key: string]: unknown;
}

export function CustomReportExplorer() {
  const { locale } = useI18n();
  const copy = useReportCopy();
  const { user } = useSession();
  const token = user?.token ?? '';

  const [period, setPeriod] = useState<Period>(() => presetPeriod('THIS_MONTH'));
  const [dataset, setDataset] = useState<DatasetType>('products');
  const [searchTerm, setSearchTerm] = useState('');
  const [rows, setRows] = useState<CustomRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [hasRun, setHasRun] = useState(false);

  async function runQuery() {
    if (!token) return;
    setLoading(true);
    setError(null);
    setHasRun(true);

    try {
      if (dataset === 'products') {
        const res = await reportsGateway.getSalesByProduct(
          token,
          period.from,
          period.to,
          'REVENUE',
          searchTerm.trim() ? searchTerm.trim() : null,
          1000,
          0,
        );
        const mapped: CustomRow[] = res.rows.map((r, idx) => ({
          id: String(r.variant_id ?? idx),
          name: r.product_name + (r.sku ? ` (${r.sku})` : ''),
          count: Number(r.quantity_base || r.sale_count || 0),
          revenue: Number(r.net_revenue || 0),
          profit: Number(r.gross_profit || 0),
          margin: r.margin_pct ? `${r.margin_pct}%` : '—',
        }));
        setRows(mapped);
      } else if (dataset === 'categories') {
        const res = await reportsGateway.getSalesByCategory(token, period.from, period.to);
        const mapped: CustomRow[] = res.rows.map((r, idx) => ({
          id: String(r.category_id ?? idx),
          name: r.category_name || copy.noCategory,
          count: Number(r.quantity_base || 0),
          revenue: Number(r.net_revenue || 0),
          profit: Number(r.gross_profit || 0),
          margin: r.margin_pct ? `${r.margin_pct}%` : '—',
        }));
        setRows(mapped);
      } else if (dataset === 'cashiers') {
        const res = await reportsGateway.getSalesByCashier(token, period.from, period.to);
        const mapped: CustomRow[] = res.rows.map((r, idx) => ({
          id: String(r.user_id ?? idx),
          name: r.username || `User #${r.user_id ?? idx}`,
          count: Number(r.sale_count || 0),
          revenue: Number(r.net_revenue || 0),
          profit: Number(r.gross_profit || 0),
          margin: r.avg_basket ? `Basket: ${r.avg_basket}` : '—',
        }));
        setRows(mapped);
      } else if (dataset === 'margins') {
        const res = await reportsGateway.getMarginAlerts(token, period.from, period.to, 0);
        const mapped: CustomRow[] = res.rows.map((r, idx) => ({
          id: String(r.variant_id ?? idx),
          name: r.product_name,
          count: Number(r.quantity_base || 0),
          revenue: Number(r.net_revenue || 0),
          profit: Number(r.gross_profit || 0),
          margin: r.margin_pct ? `${r.margin_pct}%` : '—',
        }));
        setRows(mapped);
      }
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  // Calculate summary figures
  const totalRecords = rows.length;
  const totalRevenue = rows.reduce((acc, r) => acc + (r.revenue || 0), 0);
  const totalVolume = rows.reduce((acc, r) => acc + (r.count || 0), 0);
  const totalProfit = rows.reduce((acc, r) => acc + (r.profit || 0), 0);

  const columns: ReportTableColumn<CustomRow>[] = [
    { key: 'name', label: copy.salesByProduct, align: 'start' },
    { key: 'count', label: copy.saleCount, align: 'end' },
    {
      key: 'revenue',
      label: copy.netSales,
      align: 'end',
      render: (r: CustomRow) => `${r.revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DZD`,
    },
    ...(dataset !== 'cashiers'
      ? [
          {
            key: 'profit',
            label: copy.grossProfit,
            align: 'end' as const,
            render: (r: CustomRow) =>
              `${(r.profit ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DZD`,
          },
          { key: 'margin', label: copy.marginPct, align: 'end' as const },
        ]
      : [{ key: 'margin', label: copy.avgBasket, align: 'end' as const }]),
  ];

  async function handleCsv() {
    if (rows.length === 0) return;
    setExportBusy(true);
    try {
      const csvCols = columns.map((c) => ({
        key: c.key,
        label: c.label,
        numeric: c.align === 'end',
      }));
      const csv = toCsv(csvCols, rows, locale);
      await saveDocumentFileWithDialog({
        defaultFileName: `custom-report-${dataset}-${period.from}_${period.to}.csv`,
        bytes: csvBytes(csv),
        filterName: 'CSV',
        extension: 'csv',
      });
    } finally {
      setExportBusy(false);
    }
  }

  return (
    <div className="sk-custom-report" data-testid="custom-report-explorer">
      {/* Top Filter Bar */}
      <PeriodPicker value={period} onChange={setPeriod} />

      {/* Dataset & Parameter Toolbar */}
      <div className="sk-custom-report__toolbar">
        <div className="sk-custom-report__field">
          <label htmlFor="custom-dataset-select">{copy.selectDataset}</label>
          <select
            id="custom-dataset-select"
            className="sk-reports-date-input"
            value={dataset}
            onChange={(e) => setDataset(e.target.value as DatasetType)}
          >
            <option value="products">{copy.salesByProduct}</option>
            <option value="categories">{copy.salesByCategory}</option>
            <option value="cashiers">{copy.salesByCashier}</option>
            <option value="margins">{copy.marginAlerts}</option>
          </select>
        </div>

        <div className="sk-custom-report__field">
          <label htmlFor="custom-search-input">{copy.periodLabel} (Search)</label>
          <input
            id="custom-search-input"
            type="search"
            className="sk-reports-date-input"
            placeholder="Keyword, SKU, name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="sk-custom-report__actions">
          <Button type="button" variant="primary" onClick={runQuery} disabled={loading}>
            {loading ? '...' : copy.generateReport}
          </Button>
        </div>
      </div>

      {/* Output Frame */}
      {hasRun && (
        <ReportFrame
          title={`${copy.customReport}: ${
            dataset === 'products'
              ? copy.salesByProduct
              : dataset === 'categories'
                ? copy.salesByCategory
                : dataset === 'cashiers'
                  ? copy.salesByCashier
                  : copy.marginAlerts
          }`}
          period={period}
          loading={loading}
          error={error}
          empty={!loading && !error && rows.length === 0}
          onRetry={runQuery}
          onCsv={handleCsv}
          exportBusy={exportBusy}
        >
          {/* Summary KPIs */}
          <div className="sk-kpi-grid">
            <KpiCard
              label={copy.totalRows}
              value={String(totalRecords)}
              testId="kpi-custom-count"
            />
            <KpiCard
              label={copy.totalRevenue}
              value={`${totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DZD`}
              testId="kpi-custom-revenue"
            />
            <KpiCard
              label={copy.saleCount}
              value={String(totalVolume)}
              testId="kpi-custom-volume"
            />
            {dataset !== 'cashiers' ? (
              <KpiCard
                label={copy.grossProfit}
                value={`${totalProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DZD`}
                testId="kpi-custom-profit"
              />
            ) : null}
          </div>

          {/* Detailed Data Table */}
          <ReportTable
            columns={columns}
            rows={rows}
            testId="custom-report-table"
          />
        </ReportFrame>
      )}
    </div>
  );
}
