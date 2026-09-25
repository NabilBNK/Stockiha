import { useEffect, useRef, useState } from 'react';

import { useI18n } from '../../../shared/i18n';
import { useSession } from '../../../shared/session/SessionContext';
import { getReceivablesAging } from '../../../shared/ipc/reportsGateway';
import type { ReceivablesAging } from '../../../shared/ipc/reportsDto';
import { useOfficialDocumentContext } from '../../../shared/documents/useOfficialDocumentContext';
import { printDocumentA4, saveDocumentFileWithDialog } from '../../../shared/documents/documentPrintService';
import { renderOfficialDocumentHtml, renderOfficialDocumentPdf } from '../../../shared/documents/officialDocument';
import { todayLocal, type Period } from '../common/periods';
import { ReportFrame } from '../common/ReportFrame';
import { ReportTable } from '../common/ReportTable';
import { csvBytes, toCsv } from '../common/csv';
import { copyText } from '../common/clipboard';
import { buildReceivablesAgingModel } from '../common/printModels';
import { useReportCopy } from '../common/reportCopy';
import { buildReminderText } from './reminderText';

const LIMIT = 50;
const DEBOUNCE_MS = 400;

function last90Days(): Period {
  const to = todayLocal();
  const toDate = new Date(`${to}T00:00:00Z`);
  const from = new Date(toDate.getTime() - 90 * 86_400_000).toISOString().slice(0, 10);
  return { from, to, preset: 'CUSTOM' };
}

export function ReceivablesReport({
  onOpenStatement,
}: {
  onOpenStatement: (customerId: number, period: Period) => void;
}) {
  const { locale } = useI18n();
  const copy = useReportCopy();
  const { user } = useSession();
  const token = user?.token ?? '';
  const { identity } = useOfficialDocumentContext(token);

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<ReceivablesAging | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [fallbackText, setFallbackText] = useState<{ id: number; text: string } | null>(null);
  const reqRef = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setOffset(0);
      setSearch(searchInput);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  function load() {
    const reqId = ++reqRef.current;
    setLoading(true);
    setError(null);
    getReceivablesAging(token, search || null, LIMIT, offset)
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
  }, [token, search, offset]);

  const period: Period | undefined = data ? { from: data.as_of, to: data.as_of, preset: 'TODAY' } : undefined;

  async function handlePrint() {
    if (!data || !identity || !period) return;
    const model = buildReceivablesAgingModel({ period, copy, locale, todayText: data.as_of }, data);
    printDocumentA4(renderOfficialDocumentHtml(model, identity));
  }

  async function handlePdf() {
    if (!data || !identity || !period) return;
    setExportBusy(true);
    try {
      const model = buildReceivablesAgingModel({ period, copy, locale, todayText: data.as_of }, data);
      const bytes = await renderOfficialDocumentPdf(model, identity);
      await saveDocumentFileWithDialog({
        defaultFileName: `receivables-aging-${data.as_of}.pdf`,
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
          { key: 'name', label: copy.receivables },
          { key: 'phone', label: '' },
          { key: 'total_open', label: '', numeric: true },
          { key: 'not_due', label: copy.notDue, numeric: true },
          { key: 'd1_30', label: '1-30', numeric: true },
          { key: 'd31_60', label: '31-60', numeric: true },
          { key: 'd61_90', label: '61-90', numeric: true },
          { key: 'd90_plus', label: '90+', numeric: true },
          { key: 'days_overdue', label: copy.daysOverdue, numeric: true },
        ],
        data.rows,
        locale,
      );
      await saveDocumentFileWithDialog({
        defaultFileName: `receivables-aging-${data.as_of}.csv`,
        bytes: csvBytes(csv),
        filterName: 'CSV',
        extension: 'csv',
      });
    } finally {
      setExportBusy(false);
    }
  }

  async function handleCopyReminder(row: ReceivablesAging['rows'][number]) {
    const text = buildReminderText({
      locale: identity?.printLocale ?? locale,
      name: row.name,
      shopName: identity?.shopName ?? '',
      shopPhone: identity?.phone ?? '',
      totalOpen: row.total_open,
      overdueTotal: row.overdue_total,
      oldestDueDate: row.oldest_due_date,
    });
    const ok = await copyText(text);
    if (ok) {
      setCopiedId(row.customer_id);
      setFallbackText(null);
      setTimeout(() => setCopiedId((current) => (current === row.customer_id ? null : current)), 2000);
    } else {
      setFallbackText({ id: row.customer_id, text });
    }
  }

  return (
    <>
      <input type="search" data-testid="receivables-search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} />
      <ReportFrame
        title={copy.receivables}
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
            testId="table-receivables"
            columns={[
              {
                key: 'name',
                label: copy.receivables,
                align: 'start',
                render: (r) => (
                  <span style={{ fontWeight: r.days_overdue > 0 ? 'bold' : 'normal' }}>
                    {r.name} ({r.code})
                  </span>
                ),
              },
              { key: 'phone', label: '', align: 'start' },
              { key: 'total_open', label: '', align: 'end' },
              { key: 'not_due', label: copy.notDue, align: 'end' },
              { key: 'd1_30', label: '1-30', align: 'end' },
              { key: 'd31_60', label: '31-60', align: 'end' },
              { key: 'd61_90', label: '61-90', align: 'end' },
              { key: 'd90_plus', label: '90+', align: 'end' },
              { key: 'oldest_due_date', label: '', align: 'start' },
              { key: 'days_overdue', label: copy.daysOverdue, align: 'end' },
              {
                key: 'actions',
                label: '',
                align: 'end',
                render: (r) => (
                  <>
                    <button type="button" data-testid={`copy-reminder-${r.customer_id}`} onClick={() => handleCopyReminder(r)}>
                      {copiedId === r.customer_id ? copy.copied : copy.copyReminder}
                    </button>
                    <button
                      type="button"
                      data-testid={`open-statement-${r.customer_id}`}
                      onClick={() => onOpenStatement(r.customer_id, last90Days())}
                    >
                      {copy.customerStatement}
                    </button>
                    {fallbackText?.id === r.customer_id ? (
                      <textarea readOnly data-testid="copy-fallback" value={fallbackText.text} />
                    ) : null}
                  </>
                ),
              },
            ]}
            rows={data.rows}
            totals={{
              name: 'Total',
              total_open: data.totals.total_open,
              not_due: data.totals.not_due,
              d1_30: data.totals.d1_30,
              d31_60: data.totals.d31_60,
              d61_90: data.totals.d61_90,
              d90_plus: data.totals.d90_plus,
            }}
            page={{ offset, limit: LIMIT, total: data.total_count, onPage: setOffset }}
          />
        ) : null}
      </ReportFrame>
    </>
  );
}
