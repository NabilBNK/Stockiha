import { useEffect, useRef, useState } from 'react';

import { useI18n } from '../../../shared/i18n';
import { useSession } from '../../../shared/session/SessionContext';
import { getMonthlySummary } from '../../../shared/ipc/reportsGateway';
import type { MonthlySummary } from '../../../shared/ipc/reportsDto';
import { useOfficialDocumentContext } from '../../../shared/documents/useOfficialDocumentContext';
import { printDocumentA4, saveDocumentFileWithDialog } from '../../../shared/documents/documentPrintService';
import { renderOfficialDocumentHtml, renderOfficialDocumentPdf } from '../../../shared/documents/officialDocument';
import { todayLocal } from '../common/periods';
import { ReportFrame } from '../common/ReportFrame';
import { KpiCard } from '../common/KpiCard';
import { buildMonthlySummaryModel } from '../common/printModels';
import { useReportCopy } from '../common/reportCopy';

function previousMonth(): { year: number; month: number } {
  const [y, m] = todayLocal().split('-').map(Number);
  return m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 };
}

export function MonthlySummaryReport() {
  const { locale } = useI18n();
  const copy = useReportCopy();
  const { user } = useSession();
  const token = user?.token ?? '';
  const { identity } = useOfficialDocumentContext(token);

  const [{ year, month }, setYearMonth] = useState(previousMonth);
  const [data, setData] = useState<MonthlySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const reqRef = useRef(0);

  function load() {
    const reqId = ++reqRef.current;
    setLoading(true);
    setError(null);
    getMonthlySummary(token, year, month)
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
  }, [token, year, month]);

  const period = data ? { from: data.period.from, to: data.period.to, preset: 'CUSTOM' as const } : undefined;

  async function handlePrint() {
    if (!data || !identity || !period) return;
    const model = buildMonthlySummaryModel({ period, copy, locale, todayText: data.period.to }, data);
    printDocumentA4(renderOfficialDocumentHtml(model, identity));
  }

  async function handlePdf() {
    if (!data || !identity || !period) return;
    setExportBusy(true);
    try {
      const model = buildMonthlySummaryModel({ period, copy, locale, todayText: data.period.to }, data);
      const bytes = await renderOfficialDocumentPdf(model, identity);
      await saveDocumentFileWithDialog({
        defaultFileName: `monthly-summary-${data.period.from}_${data.period.to}.pdf`,
        bytes,
        filterName: 'PDF',
        extension: 'pdf',
      });
    } finally {
      setExportBusy(false);
    }
  }

  const currentYear = Number(todayLocal().slice(0, 4));
  const years = Array.from({ length: 5 }, (_, i) => currentYear - i);

  return (
    <>
      <select
        data-testid="summary-year"
        value={year}
        onChange={(event) => setYearMonth({ year: Number(event.target.value), month })}
      >
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
      <select
        data-testid="summary-month"
        value={month}
        onChange={(event) => setYearMonth({ year, month: Number(event.target.value) })}
      >
        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <ReportFrame
        title={copy.monthlySummary}
        period={period}
        loading={loading}
        error={error}
        empty={false}
        onRetry={load}
        onPrint={handlePrint}
        onPdf={handlePdf}
        exportBusy={exportBusy}
      >
        {data ? (
          <div className="sk-kpi-grid" data-testid="monthly-summary">
            <KpiCard label={copy.netSales} value={data.pnl.net_sales} previous={data.previous_month.net_sales} testId="msum-net-sales" />
            <KpiCard label={copy.grossProfit} value={data.pnl.gross_profit} previous={data.previous_month.gross_profit} testId="msum-gross-profit" />
            <KpiCard label={copy.netResult} value={data.pnl.net_result} previous={data.previous_month.net_result} testId="msum-net-result" />
            <KpiCard label={copy.expenses} value={data.pnl.expenses} testId="msum-expenses" />
            <KpiCard label={copy.cashShortages} value={data.pnl.cash_shortages} testId="msum-shortages" />
            <KpiCard label={copy.cashOverages} value={data.pnl.cash_overages} testId="msum-overages" />
            <KpiCard label={copy.purchases} value={data.purchases_total} testId="msum-purchases" />
            <KpiCard label={copy.owedToYou} value={data.receivables_now} testId="msum-receivables" />
            <KpiCard label={copy.youOwe} value={data.payables_now} testId="msum-payables" />
            <KpiCard label={copy.stockValue} value={data.stock_value_now} testId="msum-stock" />
            <div data-testid="msum-top-products">
              {data.top_products.map((p) => (
                <div key={p.variant_id}>
                  {p.product_name} — {p.variant_label}: {p.gross_profit}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </ReportFrame>
    </>
  );
}
