import { useEffect, useRef, useState } from 'react';

import { useI18n } from '../../../shared/i18n';
import { useSession } from '../../../shared/session/SessionContext';
import { getSalesSummary, getSalesTimeseries } from '../../../shared/ipc/reportsGateway';
import type { SalesSummary, SalesTimeseries } from '../../../shared/ipc/reportsDto';
import { useOfficialDocumentContext } from '../../../shared/documents/useOfficialDocumentContext';
import { printDocumentA4, saveDocumentFileWithDialog } from '../../../shared/documents/documentPrintService';
import { renderOfficialDocumentHtml, renderOfficialDocumentPdf } from '../../../shared/documents/officialDocument';
import { comparisonPeriod, presetPeriod, type Period } from '../common/periods';
import { KpiCard } from '../common/KpiCard';
import { LineChart } from '../common/charts/LineChart';
import { PeriodPicker } from '../common/PeriodPicker';
import { ReportFrame } from '../common/ReportFrame';
import { csvBytes, toCsv } from '../common/csv';
import { buildSalesSummaryModel } from '../common/printModels';
import { useReportCopy } from '../common/reportCopy';

export function SalesSummaryReport() {
  const { locale } = useI18n();
  const copy = useReportCopy();
  const { user } = useSession();
  const token = user?.token ?? '';
  const { identity } = useOfficialDocumentContext(token);

  const [period, setPeriod] = useState<Period>(() => presetPeriod('THIS_MONTH'));
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [previous, setPrevious] = useState<SalesSummary | null>(null);
  const [timeseries, setTimeseries] = useState<SalesTimeseries | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const reqRef = useRef(0);

  function load() {
    const reqId = ++reqRef.current;
    setLoading(true);
    setError(null);
    const comparison = comparisonPeriod(period);
    Promise.all([
      getSalesSummary(token, period.from, period.to),
      getSalesSummary(token, comparison.from, comparison.to),
      getSalesTimeseries(token, period.from, period.to, 'DAY'),
    ])
      .then(([current, prev, series]) => {
        if (reqRef.current !== reqId) return;
        setSummary(current);
        setPrevious(prev);
        setTimeseries(series);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (reqRef.current !== reqId) return;
        setError(err);
        setLoading(false);
      });
  }

  useEffect(() => {
    if (!token) return;
    load();
  }, [token, period.from, period.to]);

  function buildModel() {
    if (!summary) return null;
    return buildSalesSummaryModel(
      { period, comparison: comparisonPeriod(period), copy, locale, todayText: period.to },
      summary,
      previous,
    );
  }

  async function handlePrint() {
    const model = buildModel();
    if (!model || !identity) return;
    printDocumentA4(renderOfficialDocumentHtml(model, identity));
  }

  async function handlePdf() {
    const model = buildModel();
    if (!model || !identity) return;
    setExportBusy(true);
    try {
      const bytes = await renderOfficialDocumentPdf(model, identity);
      await saveDocumentFileWithDialog({
        defaultFileName: `sales-summary-${period.from}_${period.to}.pdf`,
        bytes,
        filterName: 'PDF',
        extension: 'pdf',
      });
    } finally {
      setExportBusy(false);
    }
  }

  async function handleCsv() {
    if (!summary) return;
    setExportBusy(true);
    try {
      const rows = [
        { metric: copy.netSales, value: summary.net_sales },
        { metric: copy.grossProfit, value: summary.gross_profit },
        { metric: copy.marginPct, value: summary.margin_pct ?? '' },
        { metric: copy.saleCount, value: String(summary.sale_count) },
        { metric: copy.avgBasket, value: summary.avg_basket ?? '' },
        { metric: copy.cashSales, value: summary.cash_net },
        { metric: copy.creditSales, value: summary.credit_net },
        { metric: copy.cancellations, value: String(summary.void_count) },
      ];
      const csv = toCsv(
        [
          { key: 'metric', label: '' },
          { key: 'value', label: copy.netSales, numeric: true },
        ],
        rows,
        locale,
      );
      await saveDocumentFileWithDialog({
        defaultFileName: `sales-summary-${period.from}_${period.to}.csv`,
        bytes: csvBytes(csv),
        filterName: 'CSV',
        extension: 'csv',
      });
    } finally {
      setExportBusy(false);
    }
  }

  const chartSeries =
    timeseries && summary
      ? [
          { name: copy.netSales, points: timeseries.rows.map((r) => ({ label: r.bucket_start, value: Number(r.net_sales) })) },
          {
            name: copy.grossProfit,
            points: timeseries.rows.map((r) => ({ label: r.bucket_start, value: Number(r.gross_profit) })),
            dashed: true,
          },
        ]
      : [];

  return (
    <>
      <PeriodPicker value={period} onChange={setPeriod} />
      <ReportFrame
        title={copy.salesSummary}
        period={period}
        loading={loading}
        error={error}
        empty={!loading && !error && summary?.sale_count === 0}
        onRetry={load}
        onPrint={handlePrint}
        onPdf={handlePdf}
        onCsv={handleCsv}
        exportBusy={exportBusy}
      >
      {summary ? (
        <div className="sk-kpi-grid">
          <KpiCard label={copy.netSales} value={summary.net_sales} previous={previous?.net_sales} testId="kpi-net-sales" />
          <KpiCard label={copy.grossProfit} value={summary.gross_profit} previous={previous?.gross_profit} testId="kpi-gross-profit" />
          <KpiCard label={copy.marginPct} value={summary.margin_pct ?? '—'} previous={previous?.margin_pct ?? null} testId="kpi-margin" />
          <KpiCard label={copy.saleCount} value={String(summary.sale_count)} previous={previous ? String(previous.sale_count) : null} testId="kpi-sale-count" />
          <KpiCard label={copy.avgBasket} value={summary.avg_basket ?? '—'} previous={previous?.avg_basket ?? null} testId="kpi-avg-basket" />
          <KpiCard label={copy.cashSales} value={summary.cash_net} previous={previous?.cash_net} testId="kpi-cash" />
          <KpiCard label={copy.creditSales} value={summary.credit_net} previous={previous?.credit_net} testId="kpi-credit" />
          <KpiCard
            label={copy.cancellations}
            value={String(summary.void_count)}
            previous={previous ? String(previous.void_count) : null}
            testId="kpi-voids"
            invertGood
          />
        </div>
      ) : null}
      <LineChart series={chartSeries} formatValue={(n) => n.toFixed(2)} testId="chart-sales-daily" />
      </ReportFrame>
    </>
  );
}
