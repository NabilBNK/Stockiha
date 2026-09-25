import { useEffect, useRef, useState } from 'react';

import { useI18n } from '../../../shared/i18n';
import { useSession } from '../../../shared/session/SessionContext';
import { getSalesByHour } from '../../../shared/ipc/reportsGateway';
import type { SalesByHour } from '../../../shared/ipc/reportsDto';
import { useOfficialDocumentContext } from '../../../shared/documents/useOfficialDocumentContext';
import { printDocumentA4, saveDocumentFileWithDialog } from '../../../shared/documents/documentPrintService';
import { renderOfficialDocumentHtml, renderOfficialDocumentPdf } from '../../../shared/documents/officialDocument';
import { presetPeriod, type Period } from '../common/periods';
import { HeatGrid } from '../common/charts/HeatGrid';
import { PeriodPicker } from '../common/PeriodPicker';
import { ReportFrame } from '../common/ReportFrame';
import { buildBusyHoursModel } from '../common/printModels';
import { useReportCopy, WEEKDAY_KEYS } from '../common/reportCopy';

type Metric = 'COUNT' | 'AMOUNT';

export function BusyHoursReport() {
  const { locale } = useI18n();
  const copy = useReportCopy();
  const { user } = useSession();
  const token = user?.token ?? '';
  const { identity } = useOfficialDocumentContext(token);

  const [period, setPeriod] = useState<Period>(() => presetPeriod('THIS_MONTH'));
  const [metric, setMetric] = useState<Metric>('COUNT');
  const [data, setData] = useState<SalesByHour | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown | null>(null);
  const reqRef = useRef(0);

  function load() {
    const reqId = ++reqRef.current;
    setLoading(true);
    setError(null);
    getSalesByHour(token, period.from, period.to)
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
    const model = buildBusyHoursModel({ period, copy, locale, todayText: period.to }, data);
    printDocumentA4(renderOfficialDocumentHtml(model, identity));
  }

  async function handlePdf() {
    if (!data || !identity) return;
    const model = buildBusyHoursModel({ period, copy, locale, todayText: period.to }, data);
    const bytes = await renderOfficialDocumentPdf(model, identity);
    await saveDocumentFileWithDialog({
      defaultFileName: `busy-hours-${period.from}_${period.to}.pdf`,
      bytes,
      filterName: 'PDF',
      extension: 'pdf',
    });
  }

  const cells = (data?.rows ?? []).map((r) => ({
    row: r.weekday,
    col: r.hour,
    value: metric === 'COUNT' ? r.sale_count : Number(r.net_sales),
  }));
  const top3 = [...cells].sort((a, b) => b.value - a.value).slice(0, 3).filter((c) => c.value > 0);

  return (
    <>
      <PeriodPicker value={period} onChange={setPeriod} />
      <div className="sk-report-toggle" data-testid="busy-metric">
        <button
          type="button"
          className={metric === 'COUNT' ? 'sk-btn sk-btn--primary' : 'sk-btn sk-btn--secondary'}
          onClick={() => setMetric('COUNT')}
        >
          {copy.saleCount}
        </button>
        <button
          type="button"
          className={metric === 'AMOUNT' ? 'sk-btn sk-btn--primary' : 'sk-btn sk-btn--secondary'}
          onClick={() => setMetric('AMOUNT')}
        >
          {copy.netSales}
        </button>
      </div>
      <ReportFrame
        title={copy.busyHours}
        period={period}
        loading={loading}
        error={error}
        empty={!loading && !error && cells.every((c) => c.value === 0)}
        onRetry={load}
        onPrint={handlePrint}
        onPdf={handlePdf}
      >
      {data ? (
        <>
          <HeatGrid
            testId="heat-busy-hours"
            cells={cells}
            rowLabels={WEEKDAY_KEYS.map((key) => copy[key])}
            colLabels={Array.from({ length: 24 }, (_, h) => String(h))}
          />
          <p data-testid="busy-hours-top">
            {top3
              .map((c) => `${copy[WEEKDAY_KEYS[c.row]]} ${String(c.col).padStart(2, '0')}:00–${String((c.col + 1) % 24).padStart(2, '0')}:00`)
              .join(', ')}
          </p>
        </>
      ) : null}
      </ReportFrame>
    </>
  );
}
