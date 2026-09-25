import { useEffect, useRef, useState } from 'react';

import { useI18n } from '../../../shared/i18n';
import { useSession } from '../../../shared/session/SessionContext';
import { getSalesByCategory } from '../../../shared/ipc/reportsGateway';
import type { SalesByCategory } from '../../../shared/ipc/reportsDto';
import { useOfficialDocumentContext } from '../../../shared/documents/useOfficialDocumentContext';
import { printDocumentA4, saveDocumentFileWithDialog } from '../../../shared/documents/documentPrintService';
import { renderOfficialDocumentHtml, renderOfficialDocumentPdf } from '../../../shared/documents/officialDocument';
import { presetPeriod, type Period } from '../common/periods';
import { BarChart } from '../common/charts/BarChart';
import { PeriodPicker } from '../common/PeriodPicker';
import { ReportFrame } from '../common/ReportFrame';
import { ReportTable } from '../common/ReportTable';
import { csvBytes, toCsv } from '../common/csv';
import { buildSalesByCategoryModel } from '../common/printModels';
import { useReportCopy } from '../common/reportCopy';

export function SalesByCategoryReport() {
  const { locale } = useI18n();
  const copy = useReportCopy();
  const { user } = useSession();
  const token = user?.token ?? '';
  const { identity } = useOfficialDocumentContext(token);

  const [period, setPeriod] = useState<Period>(() => presetPeriod('THIS_MONTH'));
  const [data, setData] = useState<SalesByCategory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const reqRef = useRef(0);

  function load() {
    const reqId = ++reqRef.current;
    setLoading(true);
    setError(null);
    getSalesByCategory(token, period.from, period.to)
      .then((result) => {
        if (reqRef.current !== reqId) return;
        setData(result);
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

  async function handlePrint() {
    if (!data || !identity) return;
    const model = buildSalesByCategoryModel({ period, copy, locale, todayText: period.to }, data);
    printDocumentA4(renderOfficialDocumentHtml(model, identity));
  }

  async function handlePdf() {
    if (!data || !identity) return;
    setExportBusy(true);
    try {
      const model = buildSalesByCategoryModel({ period, copy, locale, todayText: period.to }, data);
      const bytes = await renderOfficialDocumentPdf(model, identity);
      await saveDocumentFileWithDialog({
        defaultFileName: `sales-by-category-${period.from}_${period.to}.pdf`,
        bytes,
        filterName: 'PDF',
        extension: 'pdf',
      });
    } finally {
      setExportBusy(false);
    }
  }

  async function handleCsv() {
    if (!data) return;
    setExportBusy(true);
    try {
      const csv = toCsv(
        [
          { key: 'category_name', label: copy.salesByCategory },
          { key: 'net_revenue', label: copy.netSales, numeric: true },
          { key: 'gross_profit', label: copy.grossProfit, numeric: true },
          { key: 'margin_pct', label: copy.marginPct, numeric: true },
          { key: 'quantity_base', label: '', numeric: true },
          { key: 'share_pct', label: '%', numeric: true },
        ],
        data.rows.map((r) => ({ ...r, category_name: r.category_name ?? copy.noCategory })),
        locale,
      );
      await saveDocumentFileWithDialog({
        defaultFileName: `sales-by-category-${period.from}_${period.to}.csv`,
        bytes: csvBytes(csv),
        filterName: 'CSV',
        extension: 'csv',
      });
    } finally {
      setExportBusy(false);
    }
  }

  return (
    <>
      <PeriodPicker value={period} onChange={setPeriod} />
      <ReportFrame
        title={copy.salesByCategory}
        period={period}
        loading={loading}
        error={error}
        empty={!loading && !error && (data?.rows.length ?? 0) === 0}
        onRetry={load}
        onPrint={handlePrint}
        onPdf={handlePdf}
        onCsv={handleCsv}
        exportBusy={exportBusy}
      >
      {data ? (
        <>
          <BarChart
            points={data.rows.map((r) => ({ label: r.category_name ?? copy.noCategory, value: Number(r.net_revenue) }))}
            formatValue={(n) => n.toFixed(2)}
            testId="chart-sales-category"
          />
          <ReportTable
            testId="table-sales-category"
            columns={[
              { key: 'category_name', label: copy.salesByCategory, align: 'start', render: (r) => (r.category_name as string) ?? copy.noCategory },
              { key: 'net_revenue', label: copy.netSales, align: 'end' },
              { key: 'gross_profit', label: copy.grossProfit, align: 'end' },
              { key: 'margin_pct', label: copy.marginPct, align: 'end', render: (r) => (r.margin_pct as string | null) ?? '—' },
              { key: 'quantity_base', label: '', align: 'end' },
              { key: 'share_pct', label: '%', align: 'end', render: (r) => (r.share_pct as string | null) ?? '—' },
            ]}
            rows={data.rows}
          />
        </>
      ) : null}
      </ReportFrame>
    </>
  );
}
