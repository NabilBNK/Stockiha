import { useEffect, useRef, useState } from 'react';

import { useI18n } from '../../../shared/i18n';
import { useSession } from '../../../shared/session/SessionContext';
import { getTrialBalance } from '../../../shared/ipc/reportsGateway';
import type { TrialBalance } from '../../../shared/ipc/reportsDto';
import { useOfficialDocumentContext } from '../../../shared/documents/useOfficialDocumentContext';
import { printDocumentA4, saveDocumentFileWithDialog } from '../../../shared/documents/documentPrintService';
import { renderOfficialDocumentHtml, renderOfficialDocumentPdf } from '../../../shared/documents/officialDocument';
import { presetPeriod, type Period } from '../common/periods';
import { PeriodPicker } from '../common/PeriodPicker';
import { ReportFrame } from '../common/ReportFrame';
import { ReportTable } from '../common/ReportTable';
import { formatReportCopy } from '../common/reportCopy';
import { buildTrialBalanceModel } from '../common/printModels';
import { useReportCopy } from '../common/reportCopy';

function accountName(row: TrialBalance['rows'][number], locale: 'fr' | 'ar' | 'en'): string {
  const byLocale = locale === 'fr' ? row.name_fr : locale === 'ar' ? row.name_ar : row.name_en;
  return byLocale ?? row.name_fr ?? row.scf_code ?? '';
}

export function TrialBalanceReport() {
  const { locale } = useI18n();
  const copy = useReportCopy();
  const { user } = useSession();
  const token = user?.token ?? '';
  const { identity } = useOfficialDocumentContext(token);

  const [period, setPeriod] = useState<Period>(() => presetPeriod('THIS_YEAR'));
  const [data, setData] = useState<TrialBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const reqRef = useRef(0);

  function load() {
    const reqId = ++reqRef.current;
    setLoading(true);
    setError(null);
    getTrialBalance(token, period.from, period.to)
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
    const model = buildTrialBalanceModel({ period, copy, locale, todayText: period.to }, data);
    printDocumentA4(renderOfficialDocumentHtml(model, identity));
  }

  async function handlePdf() {
    if (!data || !identity) return;
    setExportBusy(true);
    try {
      const model = buildTrialBalanceModel({ period, copy, locale, todayText: period.to }, data);
      const bytes = await renderOfficialDocumentPdf(model, identity);
      await saveDocumentFileWithDialog({
        defaultFileName: `trial-balance-${period.from}_${period.to}.pdf`,
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
        title={copy.trialBalance}
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
          <>
            <p data-testid="trial-balance-status">
              {data.totals.is_balanced
                ? copy.balanced
                : formatReportCopy(copy.notBalanced, { x: data.totals.difference })}
            </p>
            <ReportTable
              testId="table-trial-balance"
              columns={[
                { key: 'scf_code', label: '', align: 'start' },
                { key: 'name', label: '', align: 'start', render: (r) => accountName(r, locale) },
                { key: 'opening_debit', label: '', align: 'end' },
                { key: 'opening_credit', label: '', align: 'end' },
                { key: 'period_debit', label: '', align: 'end' },
                { key: 'period_credit', label: '', align: 'end' },
                { key: 'closing_debit', label: '', align: 'end' },
                { key: 'closing_credit', label: '', align: 'end' },
              ]}
              rows={data.rows}
              totals={{
                scf_code: 'Total',
                opening_debit: data.totals.opening_debit,
                opening_credit: data.totals.opening_credit,
                period_debit: data.totals.period_debit,
                period_credit: data.totals.period_credit,
                closing_debit: data.totals.closing_debit,
                closing_credit: data.totals.closing_credit,
              }}
            />
          </>
        ) : null}
      </ReportFrame>
    </>
  );
}
