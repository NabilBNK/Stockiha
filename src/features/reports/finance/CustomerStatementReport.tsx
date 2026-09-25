import { useEffect, useRef, useState } from 'react';

import { useI18n } from '../../../shared/i18n';
import { useSession } from '../../../shared/session/SessionContext';
import { getCustomerStatement } from '../../../shared/ipc/reportsGateway';
import { listCustomers } from '../../../shared/ipc/customerGateway';
import type { Customer } from '../../../shared/ipc/customerDto';
import type { CustomerStatement } from '../../../shared/ipc/reportsDto';
import { useOfficialDocumentContext } from '../../../shared/documents/useOfficialDocumentContext';
import { printDocumentA4, saveDocumentFileWithDialog } from '../../../shared/documents/documentPrintService';
import { renderOfficialDocumentHtml, renderOfficialDocumentPdf } from '../../../shared/documents/officialDocument';
import { presetPeriod, type Period } from '../common/periods';
import { PeriodPicker } from '../common/PeriodPicker';
import { ReportFrame } from '../common/ReportFrame';
import { ReportTable } from '../common/ReportTable';
import { Banner } from '../../../shared/components';
import { buildCustomerStatementModel } from '../common/printModels';
import { entryTypeLabel, useReportCopy } from '../common/reportCopy';

export function CustomerStatementReport({
  initialCustomerId,
  initialPeriod,
}: {
  initialCustomerId: number | null;
  initialPeriod: Period | null;
}) {
  const { locale } = useI18n();
  const copy = useReportCopy();
  const { user } = useSession();
  const token = user?.token ?? '';
  const { identity } = useOfficialDocumentContext(token);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerId, setCustomerId] = useState<number | null>(initialCustomerId);
  const [period, setPeriod] = useState<Period>(() => initialPeriod ?? presetPeriod('THIS_MONTH'));
  const [data, setData] = useState<CustomerStatement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const reqRef = useRef(0);

  useEffect(() => {
    if (!token) return;
    listCustomers(token)
      .then(setCustomers)
      .catch(() => setCustomers([]));
  }, [token]);

  function load() {
    if (!customerId) return;
    const reqId = ++reqRef.current;
    setLoading(true);
    setError(null);
    getCustomerStatement(token, customerId, period.from, period.to)
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
    if (!token || !customerId) return;
    load();
  }, [token, customerId, period.from, period.to]);

  async function handlePrint() {
    if (!data || !identity) return;
    const model = buildCustomerStatementModel({ period, copy, locale, todayText: period.to }, data);
    printDocumentA4(renderOfficialDocumentHtml(model, identity));
  }

  async function handlePdf() {
    if (!data || !identity) return;
    setExportBusy(true);
    try {
      const model = buildCustomerStatementModel({ period, copy, locale, todayText: period.to }, data);
      const bytes = await renderOfficialDocumentPdf(model, identity);
      await saveDocumentFileWithDialog({
        defaultFileName: `Releve-${data.customer.code}-${period.to}.pdf`,
        bytes,
        filterName: 'PDF',
        extension: 'pdf',
      });
    } finally {
      setExportBusy(false);
    }
  }

  const filteredCustomers = customers.filter((c) =>
    `${c.name} ${c.code}`.toLowerCase().includes(customerSearch.toLowerCase()),
  );

  return (
    <>
      <input
        type="text"
        className="sk-field__input"
        data-testid="statement-customer"
        value={customerSearch}
        onChange={(event) => setCustomerSearch(event.target.value)}
        placeholder={copy.customerStatement}
      />
      {customerSearch ? (
        <ul className="sk-picker-list">
          {filteredCustomers.slice(0, 20).map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => {
                  setCustomerId(c.id);
                  setCustomerSearch(`${c.name} (${c.code})`);
                }}
              >
                {c.name} ({c.code})
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <PeriodPicker value={period} onChange={setPeriod} />
      <ReportFrame
        title={copy.customerStatement}
        period={period}
        loading={loading}
        error={error}
        empty={!loading && !error && !customerId}
        onRetry={load}
        onPrint={handlePrint}
        onPdf={handlePdf}
        exportBusy={exportBusy}
      >
        {data ? (
          <>
            {data.truncated ? <Banner tone="warning">{copy.exportCapped}</Banner> : null}
            <ReportTable
              testId="table-customer-statement"
              columns={[
                { key: 'date', label: '', align: 'start' },
                { key: 'document_number', label: '', align: 'start' },
                { key: 'entry_type', label: '', align: 'start' },
                { key: 'debit', label: '', align: 'end' },
                { key: 'credit', label: '', align: 'end' },
                { key: 'balance', label: '', align: 'end' },
              ]}
              rows={[
                { date: period.from, document_number: '', entry_type: copy.openingBalance, debit: '', credit: '', balance: data.opening_balance },
                ...data.entries.map((entry) => ({
                  date: entry.date,
                  document_number: entry.document_number ?? '',
                  entry_type: entryTypeLabel(entry.entry_type, copy),
                  debit: entry.debit,
                  credit: entry.credit,
                  balance: entry.balance,
                })),
                { date: period.to, document_number: '', entry_type: copy.closingBalance, debit: '', credit: '', balance: data.closing_balance },
              ]}
              totals={{
                document_number: 'Total',
                debit: data.total_debit,
                credit: data.total_credit,
              }}
            />
          </>
        ) : null}
      </ReportFrame>
    </>
  );
}
