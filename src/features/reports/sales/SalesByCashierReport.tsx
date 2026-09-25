import { useEffect, useRef, useState } from 'react';

import { useI18n } from '../../../shared/i18n';
import { useSession } from '../../../shared/session/SessionContext';
import { getSalesByCashier } from '../../../shared/ipc/reportsGateway';
import type { SalesByCashier } from '../../../shared/ipc/reportsDto';
import { useOfficialDocumentContext } from '../../../shared/documents/useOfficialDocumentContext';
import { printDocumentA4, saveDocumentFileWithDialog } from '../../../shared/documents/documentPrintService';
import { renderOfficialDocumentHtml, renderOfficialDocumentPdf } from '../../../shared/documents/officialDocument';
import { presetPeriod, type Period } from '../common/periods';
import { PeriodPicker } from '../common/PeriodPicker';
import { ReportFrame } from '../common/ReportFrame';
import { ReportTable } from '../common/ReportTable';
import { csvBytes, toCsv } from '../common/csv';
import { buildSalesByCashierModel } from '../common/printModels';
import { useReportCopy } from '../common/reportCopy';

export function SalesByCashierReport() {
  const { locale } = useI18n();
  const copy = useReportCopy();
  const { user } = useSession();
  const token = user?.token ?? '';
  const { identity } = useOfficialDocumentContext(token);

  const [period, setPeriod] = useState<Period>(() => presetPeriod('THIS_MONTH'));
  const [data, setData] = useState<SalesByCashier | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const reqRef = useRef(0);

  function load() {
    const reqId = ++reqRef.current;
    setLoading(true);
    setError(null);
    getSalesByCashier(token, period.from, period.to)
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
    const model = buildSalesByCashierModel({ period, copy, locale, todayText: period.to }, data);
    printDocumentA4(renderOfficialDocumentHtml(model, identity));
  }

  async function handlePdf() {
    if (!data || !identity) return;
    setExportBusy(true);
    try {
      const model = buildSalesByCashierModel({ period, copy, locale, todayText: period.to }, data);
      const bytes = await renderOfficialDocumentPdf(model, identity);
      await saveDocumentFileWithDialog({
        defaultFileName: `sales-by-cashier-${period.from}_${period.to}.pdf`,
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
          { key: 'username', label: copy.salesByCashier },
          { key: 'sale_count', label: copy.saleCount, numeric: true },
          { key: 'net_revenue', label: copy.netSales, numeric: true },
          { key: 'gross_profit', label: copy.grossProfit, numeric: true },
          { key: 'avg_basket', label: copy.avgBasket, numeric: true },
          { key: 'cash_net', label: copy.cashSales, numeric: true },
          { key: 'credit_net', label: copy.creditSales, numeric: true },
        ],
        data.rows,
        locale,
      );
      await saveDocumentFileWithDialog({
        defaultFileName: `sales-by-cashier-${period.from}_${period.to}.csv`,
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
        title={copy.salesByCashier}
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
        <ReportTable
          testId="table-sales-cashier"
          columns={[
            { key: 'username', label: copy.salesByCashier, align: 'start', render: (r) => (r.username as string | null) ?? '—' },
            { key: 'sale_count', label: copy.saleCount, align: 'end' },
            { key: 'net_revenue', label: copy.netSales, align: 'end' },
            { key: 'gross_profit', label: copy.grossProfit, align: 'end' },
            { key: 'avg_basket', label: copy.avgBasket, align: 'end', render: (r) => (r.avg_basket as string | null) ?? '—' },
            { key: 'cash_net', label: copy.cashSales, align: 'end' },
            { key: 'credit_net', label: copy.creditSales, align: 'end' },
          ]}
          rows={data.rows}
        />
      ) : null}
      </ReportFrame>
    </>
  );
}
