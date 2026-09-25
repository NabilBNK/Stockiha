import { useEffect, useRef, useState } from 'react';

import { useI18n } from '../../../shared/i18n';
import { useSession } from '../../../shared/session/SessionContext';
import { getCashFlow } from '../../../shared/ipc/reportsGateway';
import type { CashFlow } from '../../../shared/ipc/reportsDto';
import { useOfficialDocumentContext } from '../../../shared/documents/useOfficialDocumentContext';
import { printDocumentA4, saveDocumentFileWithDialog } from '../../../shared/documents/documentPrintService';
import { renderOfficialDocumentHtml, renderOfficialDocumentPdf } from '../../../shared/documents/officialDocument';
import { presetPeriod, type Period } from '../common/periods';
import { PeriodPicker } from '../common/PeriodPicker';
import { ReportFrame } from '../common/ReportFrame';
import { buildCashFlowModel } from '../common/printModels';
import { useReportCopy } from '../common/reportCopy';

function reasonRows(byReason: Record<string, string>): Array<[string, string]> {
  return Object.entries(byReason).filter(([, v]) => Number(v) !== 0);
}

export function CashFlowReport() {
  const { locale } = useI18n();
  const copy = useReportCopy();
  const { user } = useSession();
  const token = user?.token ?? '';
  const { identity } = useOfficialDocumentContext(token);

  const [period, setPeriod] = useState<Period>(() => presetPeriod('THIS_MONTH'));
  const [data, setData] = useState<CashFlow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const reqRef = useRef(0);

  function load() {
    const reqId = ++reqRef.current;
    setLoading(true);
    setError(null);
    getCashFlow(token, period.from, period.to)
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
    const model = buildCashFlowModel({ period, copy, locale, todayText: period.to }, data);
    printDocumentA4(renderOfficialDocumentHtml(model, identity));
  }

  async function handlePdf() {
    if (!data || !identity) return;
    setExportBusy(true);
    try {
      const model = buildCashFlowModel({ period, copy, locale, todayText: period.to }, data);
      const bytes = await renderOfficialDocumentPdf(model, identity);
      await saveDocumentFileWithDialog({
        defaultFileName: `cash-flow-${period.from}_${period.to}.pdf`,
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
      <ReportFrame
        title={copy.cashFlow}
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
          <div data-testid="cash-flow">
            <h3>Money in</h3>
            <div className="sk-table-wrap">
            <table className="sk-table">
              <tbody>
                <tr>
                  <td>Cash sales</td>
                  <td>{data.in.cash_sales}</td>
                </tr>
                <tr>
                  <td>Customer payments</td>
                  <td>{data.in.customer_payments_cash}</td>
                </tr>
                <tr>
                  <td>Cash in</td>
                  <td>{data.in.cash_in}</td>
                </tr>
                {reasonRows(data.in.cash_in_by_reason).map(([reason, amount]) => (
                  <tr key={reason}>
                    <td>&nbsp;&nbsp;{reason}</td>
                    <td>{amount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            <h3>Money out</h3>
            <div className="sk-table-wrap">
            <table className="sk-table">
              <tbody>
                <tr>
                  <td>Refunds</td>
                  <td>{data.out.refunds}</td>
                </tr>
                <tr>
                  <td>Cancellations</td>
                  <td>{data.out.cancellations}</td>
                </tr>
                <tr>
                  <td>Cash out</td>
                  <td>{data.out.cash_out}</td>
                </tr>
                {reasonRows(data.out.cash_out_by_reason).map(([reason, amount]) => (
                  <tr key={reason}>
                    <td>&nbsp;&nbsp;{reason}</td>
                    <td>{amount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            <p style={{ fontWeight: 'bold' }} data-testid="cash-flow-net">
              Net drawer flow: {data.net_drawer_flow}
            </p>
            <p data-testid="cash-flow-supplier-payments">
              Paid to suppliers (all methods): {data.supplier_payments_all_methods}
            </p>
          </div>
        ) : null}
      </ReportFrame>
    </>
  );
}
