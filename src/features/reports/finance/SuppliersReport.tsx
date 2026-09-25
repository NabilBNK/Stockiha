import { useEffect, useRef, useState } from 'react';

import { useI18n } from '../../../shared/i18n';
import { useSession } from '../../../shared/session/SessionContext';
import { getSupplierBalances } from '../../../shared/ipc/reportsGateway';
import type { SupplierBalances } from '../../../shared/ipc/reportsDto';
import { useOfficialDocumentContext } from '../../../shared/documents/useOfficialDocumentContext';
import { printDocumentA4, saveDocumentFileWithDialog } from '../../../shared/documents/documentPrintService';
import { renderOfficialDocumentHtml, renderOfficialDocumentPdf } from '../../../shared/documents/officialDocument';
import { presetPeriod, type Period } from '../common/periods';
import { ReportFrame } from '../common/ReportFrame';
import { ReportTable } from '../common/ReportTable';
import { csvBytes, toCsv } from '../common/csv';
import { buildSupplierBalancesModel } from '../common/printModels';
import { useReportCopy } from '../common/reportCopy';

const LIMIT = 50;
const DEBOUNCE_MS = 400;

export function SuppliersReport({ onOpenStatement }: { onOpenStatement: (supplierId: number) => void }) {
  const { locale } = useI18n();
  const copy = useReportCopy();
  const { user } = useSession();
  const token = user?.token ?? '';
  const { identity } = useOfficialDocumentContext(token);
  const period: Period = presetPeriod('THIS_YEAR');

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<SupplierBalances | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
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
    getSupplierBalances(token, search || null, LIMIT, offset)
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

  async function handlePrint() {
    if (!data || !identity) return;
    const model = buildSupplierBalancesModel({ period, copy, locale, todayText: period.to }, data);
    printDocumentA4(renderOfficialDocumentHtml(model, identity));
  }

  async function handlePdf() {
    if (!data || !identity) return;
    setExportBusy(true);
    try {
      const model = buildSupplierBalancesModel({ period, copy, locale, todayText: period.to }, data);
      const bytes = await renderOfficialDocumentPdf(model, identity);
      await saveDocumentFileWithDialog({
        defaultFileName: `supplier-balances-${period.to}.pdf`,
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
          { key: 'name', label: copy.suppliersBalances },
          { key: 'phone', label: '' },
          { key: 'total_purchased', label: '', numeric: true },
          { key: 'total_returned', label: '', numeric: true },
          { key: 'total_paid', label: '', numeric: true },
          { key: 'balance_due', label: copy.balanceDue, numeric: true },
        ],
        data.rows,
        locale,
      );
      await saveDocumentFileWithDialog({
        defaultFileName: `supplier-balances-${period.to}.csv`,
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
      <input type="search" data-testid="suppliers-search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} />
      <ReportFrame
        title={copy.suppliersBalances}
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
            testId="table-suppliers"
            columns={[
              { key: 'name', label: copy.suppliersBalances, align: 'start', render: (r) => `${r.name} (${r.code})` },
              { key: 'phone', label: '', align: 'start', render: (r) => r.phone ?? '' },
              { key: 'total_purchased', label: '', align: 'end' },
              { key: 'total_returned', label: '', align: 'end' },
              { key: 'total_paid', label: '', align: 'end' },
              { key: 'balance_due', label: copy.balanceDue, align: 'end' },
              {
                key: 'actions',
                label: '',
                align: 'end',
                render: (r) => (
                  <button type="button" data-testid={`open-supplier-statement-${r.supplier_id}`} onClick={() => onOpenStatement(r.supplier_id)}>
                    {copy.supplierStatement}
                  </button>
                ),
              },
            ]}
            rows={data.rows}
            totals={{ name: 'Total', balance_due: data.totals.balance_due }}
            page={{ offset, limit: LIMIT, total: data.total_count, onPage: setOffset }}
          />
        ) : null}
      </ReportFrame>
    </>
  );
}
