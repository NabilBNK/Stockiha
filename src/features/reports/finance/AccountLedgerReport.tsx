import { useEffect, useRef, useState } from 'react';

import { useI18n } from '../../../shared/i18n';
import { useSession } from '../../../shared/session/SessionContext';
import { getAccountLedger, listReportAccounts } from '../../../shared/ipc/reportsGateway';
import type { AccountLedger, ReportAccountRow } from '../../../shared/ipc/reportsDto';
import { useOfficialDocumentContext } from '../../../shared/documents/useOfficialDocumentContext';
import { printDocumentA4, saveDocumentFileWithDialog } from '../../../shared/documents/documentPrintService';
import { renderOfficialDocumentHtml, renderOfficialDocumentPdf } from '../../../shared/documents/officialDocument';
import { JournalDetailModal } from '../../accounting/JournalsScreen';
import { presetPeriod, type Period } from '../common/periods';
import { PeriodPicker } from '../common/PeriodPicker';
import { ReportFrame } from '../common/ReportFrame';
import { ReportTable } from '../common/ReportTable';
import { buildAccountLedgerModel } from '../common/printModels';
import { useReportCopy } from '../common/reportCopy';

const LIMIT = 50;

function accountLabel(a: ReportAccountRow, locale: 'fr' | 'ar' | 'en'): string {
  const name = locale === 'fr' ? a.name_fr : locale === 'ar' ? a.name_ar : a.name_en;
  return `${a.scf_code} · ${name}`;
}

export function AccountLedgerReport() {
  const { locale } = useI18n();
  const copy = useReportCopy();
  const { user } = useSession();
  const token = user?.token ?? '';
  const { identity } = useOfficialDocumentContext(token);

  const [accounts, setAccounts] = useState<ReportAccountRow[]>([]);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [period, setPeriod] = useState<Period>(() => presetPeriod('THIS_YEAR'));
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<AccountLedger | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [openJournalId, setOpenJournalId] = useState<number | null>(null);
  const reqRef = useRef(0);

  useEffect(() => {
    if (!token) return;
    listReportAccounts(token)
      .then((result) => {
        setAccounts(result.rows);
        setAccountId((current) => current ?? result.rows[0]?.account_id ?? null);
      })
      .catch(() => setAccounts([]));
  }, [token]);

  function load() {
    if (!accountId) return;
    const reqId = ++reqRef.current;
    setLoading(true);
    setError(null);
    getAccountLedger(token, accountId, period.from, period.to, LIMIT, offset)
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
    if (!token || !accountId) return;
    load();
  }, [token, accountId, period.from, period.to, offset]);

  async function handlePrint() {
    if (!data || !identity) return;
    const model = buildAccountLedgerModel({ period, copy, locale, todayText: period.to }, data);
    printDocumentA4(renderOfficialDocumentHtml(model, identity));
  }

  async function handlePdf() {
    if (!data || !identity) return;
    setExportBusy(true);
    try {
      const model = buildAccountLedgerModel({ period, copy, locale, todayText: period.to }, data);
      const bytes = await renderOfficialDocumentPdf(model, identity);
      await saveDocumentFileWithDialog({
        defaultFileName: `account-ledger-${data.account.scf_code}-${period.from}_${period.to}.pdf`,
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
      <select data-testid="ledger-account" value={accountId ?? ''} onChange={(event) => { setOffset(0); setAccountId(Number(event.target.value)); }}>
        {accounts.map((a) => (
          <option key={a.account_id} value={a.account_id}>
            {accountLabel(a, locale)}
          </option>
        ))}
      </select>
      <PeriodPicker value={period} onChange={setPeriod} />
      <ReportFrame
        title={copy.accountLedger}
        period={period}
        loading={loading}
        error={error}
        empty={!loading && !error && !accountId}
        onRetry={load}
        onPrint={handlePrint}
        onPdf={handlePdf}
        exportBusy={exportBusy}
      >
        {data ? (
          <ReportTable
            testId="table-account-ledger"
            columns={[
              { key: 'date', label: '', align: 'start' },
              {
                key: 'journal_number',
                label: '',
                align: 'start',
                render: (r) =>
                  r.journal_id ? (
                    <button type="button" onClick={() => setOpenJournalId(r.journal_id)}>
                      {r.journal_number ?? r.journal_id}
                    </button>
                  ) : (
                    ''
                  ),
              },
              { key: 'description', label: '', align: 'start' },
              { key: 'debit', label: '', align: 'end' },
              { key: 'credit', label: '', align: 'end' },
              { key: 'balance', label: '', align: 'end' },
            ]}
            rows={[
              { date: period.from, journal_id: 0, journal_number: '', description: copy.openingBalance, debit: '', credit: '', balance: data.opening_balance },
              ...data.rows.map((row) => ({
                date: row.date,
                journal_id: row.journal_id,
                journal_number: row.journal_number ?? '',
                description: [row.description, row.source_document_number].filter(Boolean).join(' — '),
                debit: row.debit,
                credit: row.credit,
                balance: row.balance,
              })),
              { date: period.to, journal_id: 0, journal_number: '', description: copy.closingBalance, debit: '', credit: '', balance: data.closing_balance },
            ]}
            page={{ offset, limit: LIMIT, total: data.total_count, onPage: setOffset }}
          />
        ) : null}
      </ReportFrame>
      {openJournalId ? <JournalDetailModal journalDocId={openJournalId} onClose={() => setOpenJournalId(null)} /> : null}
    </>
  );
}
