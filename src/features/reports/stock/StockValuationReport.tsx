// WS-I-3 §7.5 — stock valuation: current on-hand value by product, filtered
// by category and search.

import { useEffect, useRef, useState } from 'react';

import { useI18n } from '../../../shared/i18n';
import { useSession } from '../../../shared/session/SessionContext';
import { listCategories } from '../../../shared/ipc/gateway';
import { getStockValuation } from '../../../shared/ipc/reportsGateway';
import type { StockValuation, StockValuationRow } from '../../../shared/ipc/reportsDto';
import type { ReferenceLifecycleItem } from '../../../shared/ipc/dto';
import { useOfficialDocumentContext } from '../../../shared/documents/useOfficialDocumentContext';
import { printDocumentA4, saveDocumentFileWithDialog } from '../../../shared/documents/documentPrintService';
import { renderOfficialDocumentHtml, renderOfficialDocumentPdf } from '../../../shared/documents/officialDocument';
import { presetPeriod } from '../common/periods';
import { ReportFrame } from '../common/ReportFrame';
import { ReportTable } from '../common/ReportTable';
import { csvBytes, toCsv } from '../common/csv';
import { fetchAllPages } from '../common/exportAll';
import { formatQuantityWithPack } from '../common/quantity';
import { buildStockValuationModel } from '../common/printModels';
import { useReportCopy } from '../common/reportCopy';

const LIMIT = 50;
const DEBOUNCE_MS = 400;

export function StockValuationReport() {
  const { locale } = useI18n();
  const copy = useReportCopy();
  const { user } = useSession();
  const token = user?.token ?? '';
  const { identity } = useOfficialDocumentContext(token);
  // Not a date-range report (this is a point-in-time snapshot); `period` here
  // only feeds the shared print model's meta block and export file names.
  const period = presetPeriod('TODAY');

  const [categories, setCategories] = useState<ReferenceLifecycleItem[]>([]);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<StockValuation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [capped, setCapped] = useState(false);
  const reqRef = useRef(0);

  useEffect(() => {
    if (!token) return;
    listCategories(token)
      .then(setCategories)
      .catch(() => setCategories([]));
  }, [token]);

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
    getStockValuation(token, categoryId, search || null, LIMIT, offset)
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
  }, [token, categoryId, search, offset]);

  async function collectAll(): Promise<StockValuationRow[]> {
    const { rows, capped: wasCapped } = await fetchAllPages<StockValuationRow>((pageOffset, pageLimit) =>
      getStockValuation(token, categoryId, search || null, pageLimit, pageOffset),
    );
    setCapped(wasCapped);
    return rows;
  }

  async function handlePrint() {
    if (!data || !identity) return;
    setExportBusy(true);
    try {
      const rows = await collectAll();
      const model = buildStockValuationModel(
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
      const model = buildStockValuationModel(
        { period, copy, locale, todayText: period.to },
        { ...data, rows, total_count: rows.length },
      );
      const bytes = await renderOfficialDocumentPdf(model, identity);
      await saveDocumentFileWithDialog({
        defaultFileName: `stock-valuation-${period.to}.pdf`,
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
          { key: 'product_name', label: copy.stockValuation },
          { key: 'variant_label', label: '' },
          { key: 'sku', label: 'SKU' },
          { key: 'category_name', label: copy.category },
          { key: 'quantity_base', label: '', numeric: true },
          { key: 'wac', label: copy.avgCost, numeric: true },
          { key: 'stock_value', label: copy.stockValue, numeric: true },
          { key: 'sale_price', label: copy.salePrice, numeric: true },
          { key: 'retail_value', label: copy.retailValue, numeric: true },
          { key: 'potential_margin', label: copy.potentialMargin, numeric: true },
        ],
        rows,
        locale,
      );
      await saveDocumentFileWithDialog({
        defaultFileName: `stock-valuation-${period.to}.csv`,
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
      <div className="sk-reports-filter-card sk-reports-filter-card--compact">
        <div className="sk-reports-filter-grid">
          <div className="sk-reports-filter-cell sk-reports-filter-cell--col-4">
            <span className="sk-reports-filter-label">{copy.category}</span>
            <select
              className="sk-field__input"
              data-testid="valuation-category"
              value={categoryId ?? ''}
              onChange={(event) => {
                setOffset(0);
                setCategoryId(event.target.value ? Number(event.target.value) : null);
              }}
            >
              <option value="">{copy.allCategories}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="sk-reports-filter-cell sk-reports-filter-cell--col-6">
            <span className="sk-reports-filter-label">{copy.search}</span>
            <input
              type="search"
              className="sk-field__input"
              data-testid="valuation-search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </div>
        </div>
      </div>
      {capped ? <p>{copy.exportCapped}</p> : null}
      <ReportFrame
        title={copy.stockValuation}
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
            testId="table-stock-valuation"
            columns={[
              { key: 'product_name', label: copy.stockValuation, align: 'start' },
              { key: 'variant_label', label: '', align: 'start' },
              { key: 'sku', label: 'SKU', align: 'start' },
              { key: 'category_name', label: copy.category, align: 'start', render: (r) => r.category_name ?? copy.noCategory },
              {
                key: 'quantity_base',
                label: '',
                align: 'end',
                render: (r) => formatQuantityWithPack(r.quantity_base, r.base_unit_name, r.pack_unit_name, r.pack_factor, locale),
              },
              { key: 'wac', label: copy.avgCost, align: 'end', render: (r) => r.wac ?? '—' },
              { key: 'stock_value', label: copy.stockValue, align: 'end' },
              { key: 'sale_price', label: copy.salePrice, align: 'end' },
              { key: 'retail_value', label: copy.retailValue, align: 'end' },
              { key: 'potential_margin', label: copy.potentialMargin, align: 'end' },
            ]}
            rows={data.rows}
            totals={{
              product_name: 'Total',
              stock_value: data.totals.stock_value,
              retail_value: data.totals.retail_value,
              potential_margin: data.totals.potential_margin,
            }}
            page={{ offset, limit: LIMIT, total: data.total_count, onPage: setOffset }}
          />
        ) : null}
      </ReportFrame>
    </>
  );
}
