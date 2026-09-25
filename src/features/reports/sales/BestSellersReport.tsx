import { useEffect, useRef, useState } from 'react';

import { useI18n } from '../../../shared/i18n';
import { useSession } from '../../../shared/session/SessionContext';
import { getSalesByProduct } from '../../../shared/ipc/reportsGateway';
import type { SalesByProduct } from '../../../shared/ipc/reportsDto';
import { useOfficialDocumentContext } from '../../../shared/documents/useOfficialDocumentContext';
import { printDocumentA4, saveDocumentFileWithDialog } from '../../../shared/documents/documentPrintService';
import { renderOfficialDocumentHtml, renderOfficialDocumentPdf } from '../../../shared/documents/officialDocument';
import { presetPeriod, type Period } from '../common/periods';
import { BarChart } from '../common/charts/BarChart';
import { PeriodPicker } from '../common/PeriodPicker';
import { ReportFrame } from '../common/ReportFrame';
import { ReportTable } from '../common/ReportTable';
import { buildBestSellersModel } from '../common/printModels';
import { useReportCopy } from '../common/reportCopy';

export function BestSellersReport() {
  const { locale } = useI18n();
  const copy = useReportCopy();
  const { user } = useSession();
  const token = user?.token ?? '';
  const { identity } = useOfficialDocumentContext(token);

  const [period, setPeriod] = useState<Period>(() => presetPeriod('THIS_MONTH'));
  const [byQuantity, setByQuantity] = useState<SalesByProduct | null>(null);
  const [byProfit, setByProfit] = useState<SalesByProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const reqRef = useRef(0);

  function load() {
    const reqId = ++reqRef.current;
    setLoading(true);
    setError(null);
    Promise.all([
      getSalesByProduct(token, period.from, period.to, 'QUANTITY', null, 10, 0),
      getSalesByProduct(token, period.from, period.to, 'PROFIT', null, 10, 0),
    ])
      .then(([q, p]) => {
        if (reqRef.current !== reqId) return;
        setByQuantity(q);
        setByProfit(p);
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
    if (!byQuantity || !byProfit || !identity) return;
    const model = buildBestSellersModel({ period, copy, locale, todayText: period.to }, byQuantity, byProfit);
    printDocumentA4(renderOfficialDocumentHtml(model, identity));
  }

  async function handlePdf() {
    if (!byQuantity || !byProfit || !identity) return;
    setExportBusy(true);
    try {
      const model = buildBestSellersModel({ period, copy, locale, todayText: period.to }, byQuantity, byProfit);
      const bytes = await renderOfficialDocumentPdf(model, identity);
      await saveDocumentFileWithDialog({
        defaultFileName: `best-sellers-${period.from}_${period.to}.pdf`,
        bytes,
        filterName: 'PDF',
        extension: 'pdf',
      });
    } finally {
      setExportBusy(false);
    }
  }

  return (
    <>
      <PeriodPicker value={period} onChange={setPeriod} />
      <p>{copy.bestSellersNote}</p>
      <ReportFrame
        title={copy.bestSellers}
        period={period}
        loading={loading}
        error={error}
        empty={!loading && !error && (byQuantity?.rows.length ?? 0) === 0}
        onRetry={load}
        onPrint={handlePrint}
        onPdf={handlePdf}
        exportBusy={exportBusy}
      >
      {byQuantity ? (
        <div data-testid="best-by-quantity">
          <BarChart
            points={byQuantity.rows.map((r) => ({ label: r.variant_label, value: Number(r.quantity_base) }))}
            formatValue={(n) => n.toFixed(2)}
            testId="chart-best-by-quantity"
            horizontal
          />
          <ReportTable
            testId="table-best-by-quantity"
            columns={[
              { key: 'product_name', label: copy.salesByProduct, align: 'start' },
              { key: 'quantity_base', label: '', align: 'end' },
            ]}
            rows={byQuantity.rows}
          />
        </div>
      ) : null}
      {byProfit ? (
        <div data-testid="best-by-profit">
          <BarChart
            points={byProfit.rows.map((r) => ({ label: r.variant_label, value: Number(r.gross_profit) }))}
            formatValue={(n) => n.toFixed(2)}
            testId="chart-best-by-profit"
            horizontal
          />
          <ReportTable
            testId="table-best-by-profit"
            columns={[
              { key: 'product_name', label: copy.salesByProduct, align: 'start' },
              { key: 'gross_profit', label: copy.grossProfit, align: 'end' },
            ]}
            rows={byProfit.rows}
          />
        </div>
      ) : null}
      </ReportFrame>
    </>
  );
}
