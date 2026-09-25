import { useEffect, useRef, useState } from 'react';

import { useI18n } from '../../../shared/i18n';
import { useSession } from '../../../shared/session/SessionContext';
import { getSalesTimeseries } from '../../../shared/ipc/reportsGateway';
import type { SalesTimeseries } from '../../../shared/ipc/reportsDto';
import { useOfficialDocumentContext } from '../../../shared/documents/useOfficialDocumentContext';
import { printDocumentA4, saveDocumentFileWithDialog } from '../../../shared/documents/documentPrintService';
import { renderOfficialDocumentHtml, renderOfficialDocumentPdf } from '../../../shared/documents/officialDocument';
import { presetPeriod, type Period } from '../common/periods';
import { BarChart } from '../common/charts/BarChart';
import { PeriodPicker } from '../common/PeriodPicker';
import { ReportFrame } from '../common/ReportFrame';
import { ReportTable } from '../common/ReportTable';
import { csvBytes, toCsv } from '../common/csv';
import { buildSalesOverTimeModel } from '../common/printModels';
import { useReportCopy } from '../common/reportCopy';

type Granularity = 'DAY' | 'WEEK' | 'MONTH';

export function SalesOverTimeReport() {
  const { locale } = useI18n();
  const copy = useReportCopy();
  const { user } = useSession();
  const token = user?.token ?? '';
  const { identity } = useOfficialDocumentContext(token);

  const [period, setPeriod] = useState<Period>(() => presetPeriod('THIS_MONTH'));
  const [granularity, setGranularity] = useState<Granularity>('DAY');
  const [data, setData] = useState<SalesTimeseries | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const reqRef = useRef(0);

  function load() {
    const reqId = ++reqRef.current;
    setLoading(true);
    setError(null);
    getSalesTimeseries(token, period.from, period.to, granularity)
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
  }, [token, period.from, period.to, granularity]);

  async function handlePrint() {
    if (!data || !identity) return;
    const model = buildSalesOverTimeModel({ period, copy, locale, todayText: period.to }, data);
    printDocumentA4(renderOfficialDocumentHtml(model, identity));
  }

  async function handlePdf() {
    if (!data || !identity) return;
    setExportBusy(true);
    try {
      const model = buildSalesOverTimeModel({ period, copy, locale, todayText: period.to }, data);
      const bytes = await renderOfficialDocumentPdf(model, identity);
      await saveDocumentFileWithDialog({
        defaultFileName: `sales-over-time-${period.from}_${period.to}.pdf`,
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
          { key: 'bucket_start', label: copy.periodText },
          { key: 'net_sales', label: copy.netSales, numeric: true },
          { key: 'gross_profit', label: copy.grossProfit, numeric: true },
          { key: 'sale_count', label: copy.saleCount, numeric: true },
        ],
        data.rows,
        locale,
      );
      await saveDocumentFileWithDialog({
        defaultFileName: `sales-over-time-${period.from}_${period.to}.csv`,
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
      <div className="sk-report-granularity">
        {(['DAY', 'WEEK', 'MONTH'] as const).map((g) => (
          <button
            key={g}
            type="button"
            data-testid={`granularity-${g.toLowerCase()}`}
            className={g === granularity ? 'sk-btn sk-btn--primary' : 'sk-btn sk-btn--secondary'}
            onClick={() => setGranularity(g)}
          >
            {g}
          </button>
        ))}
      </div>
      <ReportFrame
        title={copy.salesOverTime}
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
            points={data.rows.map((r) => ({ label: r.bucket_start, value: Number(r.net_sales) }))}
            formatValue={(n) => n.toFixed(2)}
            testId="chart-sales-time"
          />
          <ReportTable
            testId="table-sales-time"
            columns={[
              { key: 'bucket_start', label: copy.periodText, align: 'start' },
              { key: 'net_sales', label: copy.netSales, align: 'end' },
              { key: 'gross_profit', label: copy.grossProfit, align: 'end' },
              { key: 'sale_count', label: copy.saleCount, align: 'end' },
            ]}
            rows={data.rows}
          />
        </>
      ) : null}
      </ReportFrame>
    </>
  );
}
