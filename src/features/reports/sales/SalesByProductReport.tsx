import { useEffect, useRef, useState } from 'react';

import { useI18n } from '../../../shared/i18n';
import { useSession } from '../../../shared/session/SessionContext';
import { getSalesByProduct } from '../../../shared/ipc/reportsGateway';
import type { SalesByProduct, SalesByProductRow } from '../../../shared/ipc/reportsDto';
import { useOfficialDocumentContext } from '../../../shared/documents/useOfficialDocumentContext';
import { printDocumentA4, saveDocumentFileWithDialog } from '../../../shared/documents/documentPrintService';
import { renderOfficialDocumentHtml, renderOfficialDocumentPdf } from '../../../shared/documents/officialDocument';
import { presetPeriod, type Period } from '../common/periods';
import { PeriodPicker } from '../common/PeriodPicker';
import { ReportFrame } from '../common/ReportFrame';
import { ReportTable } from '../common/ReportTable';
import { csvBytes, toCsv } from '../common/csv';
import { fetchAllPages } from '../common/exportAll';
import { formatQuantityWithPack } from '../common/quantity';
import { buildSalesByProductModel } from '../common/printModels';
import { useReportCopy } from '../common/reportCopy';

type Sort = 'REVENUE' | 'QUANTITY' | 'PROFIT' | 'MARGIN';
const LIMIT = 50;
const DEBOUNCE_MS = 400;

export function SalesByProductReport() {
  const { locale } = useI18n();
  const copy = useReportCopy();
  const { user } = useSession();
  const token = user?.token ?? '';
  const { identity } = useOfficialDocumentContext(token);

  const [period, setPeriod] = useState<Period>(() => presetPeriod('THIS_MONTH'));
  const [sort, setSort] = useState<Sort>('REVENUE');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<SalesByProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [capped, setCapped] = useState(false);
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
    getSalesByProduct(token, period.from, period.to, sort, search || null, LIMIT, offset)
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
  }, [token, period.from, period.to, sort, search, offset]);

  async function collectAll(): Promise<SalesByProductRow[]> {
    const { rows, capped: wasCapped } = await fetchAllPages<SalesByProductRow>(
      (pageOffset, pageLimit) => getSalesByProduct(token, period.from, period.to, sort, search || null, pageLimit, pageOffset),
    );
    setCapped(wasCapped);
    return rows;
  }

  async function handlePrint() {
    if (!data || !identity) return;
    setExportBusy(true);
    try {
      const rows = await collectAll();
      const model = buildSalesByProductModel(
        { period, copy, locale, todayText: period.to },
        { ...data, rows, total_count: rows.length },
      );
      printDocumentA4(renderOfficialDocumentHtml(model, identity));
    } finally {
      setExportBusy(false);
    }
  }

  async function handlePdf() {
    if (!data || !identity) return;
    setExportBusy(true);
    try {
      const rows = await collectAll();
      const model = buildSalesByProductModel(
        { period, copy, locale, todayText: period.to },
        { ...data, rows, total_count: rows.length },
      );
      const bytes = await renderOfficialDocumentPdf(model, identity);
      await saveDocumentFileWithDialog({
        defaultFileName: `sales-by-product-${period.from}_${period.to}.pdf`,
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
      const rows = await collectAll();
      const csv = toCsv(
        [
          { key: 'product_name', label: copy.salesByProduct },
          { key: 'variant_label', label: '' },
          { key: 'sku', label: 'SKU' },
          { key: 'category_name', label: copy.salesByCategory },
          { key: 'quantity_base', label: '', numeric: true },
          { key: 'net_revenue', label: copy.netSales, numeric: true },
          { key: 'cost', label: '', numeric: true },
          { key: 'gross_profit', label: copy.grossProfit, numeric: true },
          { key: 'margin_pct', label: copy.marginPct, numeric: true },
          { key: 'sale_count', label: copy.saleCount, numeric: true },
        ],
        rows,
        locale,
      );
      await saveDocumentFileWithDialog({
        defaultFileName: `sales-by-product-${period.from}_${period.to}.csv`,
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
      <input
        type="search"
        data-testid="product-search"
        value={searchInput}
        onChange={(event) => setSearchInput(event.target.value)}
      />
      <select data-testid="product-sort" value={sort} onChange={(event) => { setOffset(0); setSort(event.target.value as Sort); }}>
        <option value="REVENUE">{copy.netSales}</option>
        <option value="QUANTITY">Quantity</option>
        <option value="PROFIT">{copy.grossProfit}</option>
        <option value="MARGIN">{copy.marginPct}</option>
      </select>
      {capped ? <p>{copy.exportCapped}</p> : null}
      <ReportFrame
        title={copy.salesByProduct}
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
          testId="table-sales-product"
          columns={[
            { key: 'product_name', label: copy.salesByProduct, align: 'start' },
            { key: 'variant_label', label: '', align: 'start' },
            { key: 'sku', label: 'SKU', align: 'start' },
            { key: 'category_name', label: copy.salesByCategory, align: 'start', render: (r) => (r.category_name as string) ?? copy.noCategory },
            {
              key: 'quantity_base',
              label: '',
              align: 'end',
              render: (r) =>
                formatQuantityWithPack(
                  r.quantity_base as string,
                  r.base_unit_name as string,
                  r.pack_unit_name as string | null,
                  r.pack_factor as string | null,
                  locale,
                ),
            },
            { key: 'net_revenue', label: copy.netSales, align: 'end' },
            { key: 'cost', label: '', align: 'end' },
            { key: 'gross_profit', label: copy.grossProfit, align: 'end' },
            { key: 'margin_pct', label: copy.marginPct, align: 'end', render: (r) => (r.margin_pct as string | null) ?? '—' },
            { key: 'sale_count', label: copy.saleCount, align: 'end' },
          ]}
          rows={data.rows}
          totals={{
            product_name: 'Total',
            net_revenue: data.totals.net_revenue,
            cost: data.totals.cost,
            gross_profit: data.totals.gross_profit,
          }}
          page={{ offset, limit: LIMIT, total: data.total_count, onPage: setOffset }}
        />
      ) : null}
      </ReportFrame>
    </>
  );
}
