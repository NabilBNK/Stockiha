import { useEffect, useRef, useState } from 'react';

import { useI18n } from '../../../shared/i18n';
import { useSession } from '../../../shared/session/SessionContext';
import { getProfitAndLoss } from '../../../shared/ipc/reportsGateway';
import type { ProfitAndLoss } from '../../../shared/ipc/reportsDto';
import { useOfficialDocumentContext } from '../../../shared/documents/useOfficialDocumentContext';
import { printDocumentA4, saveDocumentFileWithDialog } from '../../../shared/documents/documentPrintService';
import { renderOfficialDocumentHtml, renderOfficialDocumentPdf } from '../../../shared/documents/officialDocument';
import { presetPeriod, type Period } from '../common/periods';
import { PeriodPicker } from '../common/PeriodPicker';
import { ReportFrame } from '../common/ReportFrame';
import { buildProfitLossModel } from '../common/printModels';
import { useReportCopy } from '../common/reportCopy';

export function ProfitLossReport() {
  const { locale } = useI18n();
  const copy = useReportCopy();
  const { user } = useSession();
  const token = user?.token ?? '';
  const { identity } = useOfficialDocumentContext(token);

  const [period, setPeriod] = useState<Period>(() => presetPeriod('THIS_MONTH'));
  const [data, setData] = useState<ProfitAndLoss | null>(null);
  const [showExpenses, setShowExpenses] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const reqRef = useRef(0);

  function load() {
    const reqId = ++reqRef.current;
    setLoading(true);
    setError(null);
    getProfitAndLoss(token, period.from, period.to)
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
    const model = buildProfitLossModel({ period, copy, locale, todayText: period.to }, data);
    printDocumentA4(renderOfficialDocumentHtml(model, identity));
  }

  async function handlePdf() {
    if (!data || !identity) return;
    setExportBusy(true);
    try {
      const model = buildProfitLossModel({ period, copy, locale, todayText: period.to }, data);
      const bytes = await renderOfficialDocumentPdf(model, identity);
      await saveDocumentFileWithDialog({
        defaultFileName: `profit-loss-${period.from}_${period.to}.pdf`,
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
        title={copy.profitLoss}
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
          <div data-testid="pl-statement">
            <div className="sk-table-wrap">
            <table className="sk-table">
              <tbody>
                <tr>
                  <td>{copy.netSales}</td>
                  <td>{data.net_sales}</td>
                </tr>
                <tr>
                  <td>{copy.costOfSales}</td>
                  <td>{data.cost_of_sales}</td>
                </tr>
                <tr>
                  <td style={{ fontWeight: 'bold' }}>{copy.grossProfit}</td>
                  <td style={{ fontWeight: 'bold' }}>{data.gross_profit}</td>
                </tr>
                <tr>
                  <td>
                    {copy.expenses}
                    <button
                      type="button"
                      className="sk-btn sk-btn--secondary"
                      data-testid="pl-expand-expenses"
                      onClick={() => setShowExpenses((v) => !v)}
                    >
                      {showExpenses ? '−' : '+'}
                    </button>
                  </td>
                  <td>{data.expenses}</td>
                </tr>
                {showExpenses
                  ? data.expense_lines.map((line, i) => (
                      <tr key={i}>
                        <td>
                          {line.date} — {line.note ?? ''}
                        </td>
                        <td>{line.amount}</td>
                      </tr>
                    ))
                  : null}
                <tr>
                  <td>{copy.cashShortages}</td>
                  <td>{data.cash_shortages}</td>
                </tr>
                <tr>
                  <td>{copy.cashOverages}</td>
                  <td>{data.cash_overages}</td>
                </tr>
                <tr>
                  <td style={{ fontWeight: 'bold' }}>{copy.netResult}</td>
                  <td style={{ fontWeight: 'bold' }}>{data.net_result}</td>
                </tr>
              </tbody>
            </table>
            </div>
            <hr />
            <p>{copy.otherCashOutNote}</p>
            <div className="sk-table-wrap">
            <table className="sk-table">
              <tbody>
                {data.other_cash_out_lines.map((line, i) => (
                  <tr key={i}>
                    <td>
                      {line.date} — {line.note ?? ''}
                    </td>
                    <td>{line.amount}</td>
                  </tr>
                ))}
                <tr>
                  <td>Total</td>
                  <td>{data.other_cash_out}</td>
                </tr>
              </tbody>
            </table>
            </div>
            <p className="sk-report-frame__footnote">{copy.managementViewNote}</p>
          </div>
        ) : null}
      </ReportFrame>
    </>
  );
}
