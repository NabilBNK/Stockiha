import { useEffect, useRef, useState } from 'react';

import { useI18n } from '../../../shared/i18n';
import { useSession } from '../../../shared/session/SessionContext';
import { getSupplierStatement } from '../../../shared/ipc/reportsGateway';
import { listSuppliers } from '../../../shared/ipc/gateway';
import type { Supplier } from '../../../shared/ipc/dto';
import type { SupplierStatement } from '../../../shared/ipc/reportsDto';
import { useOfficialDocumentContext } from '../../../shared/documents/useOfficialDocumentContext';
import { printDocumentA4, saveDocumentFileWithDialog } from '../../../shared/documents/documentPrintService';
import { renderOfficialDocumentHtml, renderOfficialDocumentPdf } from '../../../shared/documents/officialDocument';
import { presetPeriod, type Period } from '../common/periods';
import { PeriodPicker } from '../common/PeriodPicker';
import { ReportFrame } from '../common/ReportFrame';
import { ReportTable } from '../common/ReportTable';
import { Banner } from '../../../shared/components';
import { buildSupplierStatementModel } from '../common/printModels';
import { entryTypeLabel, useReportCopy } from '../common/reportCopy';

export function SupplierStatementReport({ initialSupplierId }: { initialSupplierId: number | null }) {
  const { locale } = useI18n();
  const copy = useReportCopy();
  const { user } = useSession();
  const token = user?.token ?? '';
  const { identity } = useOfficialDocumentContext(token);

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [supplierId, setSupplierId] = useState<number | null>(initialSupplierId);
  const [period, setPeriod] = useState<Period>(() => presetPeriod('THIS_YEAR'));
  const [data, setData] = useState<SupplierStatement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const reqRef = useRef(0);

  useEffect(() => {
    if (!token) return;
    listSuppliers(token)
      .then(setSuppliers)
      .catch(() => setSuppliers([]));
  }, [token]);

  function load() {
    if (!supplierId) return;
    const reqId = ++reqRef.current;
    setLoading(true);
    setError(null);
    getSupplierStatement(token, supplierId, period.from, period.to)
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
    if (!token || !supplierId) return;
    load();
  }, [token, supplierId, period.from, period.to]);

  async function handlePrint() {
    if (!data || !identity) return;
    const model = buildSupplierStatementModel({ period, copy, locale, todayText: period.to }, data);
    printDocumentA4(renderOfficialDocumentHtml(model, identity));
  }

  async function handlePdf() {
    if (!data || !identity) return;
    setExportBusy(true);
    try {
      const model = buildSupplierStatementModel({ period, copy, locale, todayText: period.to }, data);
      const bytes = await renderOfficialDocumentPdf(model, identity);
      await saveDocumentFileWithDialog({
        defaultFileName: `Releve-${data.supplier.code}-${period.to}.pdf`,
        bytes,
        filterName: 'PDF',
        extension: 'pdf',
      });
    } finally {
      setExportBusy(false);
    }
  }

  const filteredSuppliers = suppliers.filter((s) =>
    `${s.name} ${s.code}`.toLowerCase().includes(supplierSearch.toLowerCase()),
  );

  return (
    <>
      <input
        type="text"
        className="sk-field__input"
        data-testid="statement-supplier"
        value={supplierSearch}
        onChange={(event) => setSupplierSearch(event.target.value)}
        placeholder={copy.supplierStatement}
      />
      {supplierSearch ? (
        <ul className="sk-picker-list">
          {filteredSuppliers.slice(0, 20).map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => {
                  setSupplierId(s.id);
                  setSupplierSearch(`${s.name} (${s.code})`);
                }}
              >
                {s.name} ({s.code})
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <PeriodPicker value={period} onChange={setPeriod} />
      <ReportFrame
        title={copy.supplierStatement}
        period={period}
        loading={loading}
        error={error}
        empty={!loading && !error && !supplierId}
        onRetry={load}
        onPrint={handlePrint}
        onPdf={handlePdf}
        exportBusy={exportBusy}
      >
        {data ? (
          <>
            {data.truncated ? <Banner tone="warning">{copy.exportCapped}</Banner> : null}
            <ReportTable
              testId="table-supplier-statement"
              columns={[
                { key: 'date', label: '', align: 'start' },
                { key: 'document_number', label: '', align: 'start' },
                { key: 'entry_type', label: '', align: 'start' },
                { key: 'increase', label: '', align: 'end' },
                { key: 'decrease', label: '', align: 'end' },
                { key: 'balance', label: '', align: 'end' },
              ]}
              rows={[
                { date: period.from, document_number: '', entry_type: copy.openingBalance, increase: '', decrease: '', balance: data.opening_balance },
                ...data.entries.map((entry) => ({
                  date: entry.date,
                  document_number: entry.document_number ?? '',
                  entry_type: entryTypeLabel(entry.entry_type, copy),
                  increase: entry.increase,
                  decrease: entry.decrease,
                  balance: entry.balance,
                })),
                { date: period.to, document_number: '', entry_type: copy.closingBalance, increase: '', decrease: '', balance: data.closing_balance },
              ]}
            />
          </>
        ) : null}
      </ReportFrame>
    </>
  );
}
