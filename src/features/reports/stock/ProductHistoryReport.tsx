// WS-I-3 §7.5 — product history: every inventory movement for one variant,
// with a running quantity, over a period.

import { useEffect, useRef, useState } from 'react';

import { useI18n } from '../../../shared/i18n';
import { useSession } from '../../../shared/session/SessionContext';
import { listPurchaseProductOptions } from '../../../shared/ipc/gateway';
import { getProductHistory } from '../../../shared/ipc/reportsGateway';
import type { ProductHistory, ProductHistoryRow } from '../../../shared/ipc/reportsDto';
import type { PurchaseProductOption } from '../../../shared/ipc/dto';
import { useOfficialDocumentContext } from '../../../shared/documents/useOfficialDocumentContext';
import { printDocumentA4, saveDocumentFileWithDialog } from '../../../shared/documents/documentPrintService';
import { renderOfficialDocumentHtml, renderOfficialDocumentPdf } from '../../../shared/documents/officialDocument';
import { presetPeriod, type Period } from '../common/periods';
import { PeriodPicker } from '../common/PeriodPicker';
import { ReportFrame } from '../common/ReportFrame';
import { ReportTable } from '../common/ReportTable';
import { csvBytes, toCsv } from '../common/csv';
import { fetchAllPages } from '../common/exportAll';
import { useReportCopy } from '../common/reportCopy';
import { buildProductHistoryModel } from '../common/printModels';

const LIMIT = 50;

export function ProductHistoryReport() {
  const { locale } = useI18n();
  const copy = useReportCopy();
  const { user } = useSession();
  const token = user?.token ?? '';
  const { identity } = useOfficialDocumentContext(token);

  const [period, setPeriod] = useState<Period>(() => presetPeriod('THIS_MONTH'));
  const [products, setProducts] = useState<PurchaseProductOption[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [variantId, setVariantId] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<ProductHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [capped, setCapped] = useState(false);
  const reqRef = useRef(0);

  useEffect(() => {
    if (!token) return;
    listPurchaseProductOptions(token)
      .then(setProducts)
      .catch(() => setProducts([]));
  }, [token]);

  function load() {
    if (variantId === null) return;
    const reqId = ++reqRef.current;
    setLoading(true);
    setError(null);
    getProductHistory(token, variantId, period.from, period.to, LIMIT, offset)
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
    if (!token || variantId === null) return;
    load();
  }, [token, variantId, period.from, period.to, offset]);

  async function collectAll(): Promise<ProductHistoryRow[]> {
    if (variantId === null) return [];
    const { rows, capped: wasCapped } = await fetchAllPages<ProductHistoryRow>((pageOffset, pageLimit) =>
      getProductHistory(token, variantId, period.from, period.to, pageLimit, pageOffset),
    );
    setCapped(wasCapped);
    return rows;
  }

  async function handlePrint() {
    if (!data || !identity) return;
    setExportBusy(true);
    try {
      const rows = await collectAll();
      const model = buildProductHistoryModel(
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
      const model = buildProductHistoryModel(
        { period, copy, locale, todayText: period.to },
        { ...data, rows, total_count: rows.length },
      );
      const bytes = await renderOfficialDocumentPdf(model, identity);
      await saveDocumentFileWithDialog({
        defaultFileName: `product-history-${period.from}_${period.to}.pdf`,
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
          { key: 'occurred_at', label: copy.dateTime },
          { key: 'movement_type', label: copy.movement },
          { key: 'document_number', label: copy.document },
          { key: 'quantity_delta', label: copy.quantityChange, numeric: true },
          { key: 'running_quantity', label: copy.runningQuantity, numeric: true },
        ],
        rows,
        locale,
      );
      await saveDocumentFileWithDialog({
        defaultFileName: `product-history-${period.from}_${period.to}.csv`,
        bytes: csvBytes(csv),
        filterName: 'CSV',
        extension: 'csv',
      });
    } finally {
      setExportBusy(false);
    }
  }

  const filteredProducts = products.filter((p) =>
    `${p.product_name} ${p.variant_name ?? ''} ${p.sku}`.toLowerCase().includes(productSearch.toLowerCase()),
  );

  return (
    <>
      <input
        type="text"
        className="sk-field__input"
        data-testid="history-product"
        value={productSearch}
        onChange={(event) => setProductSearch(event.target.value)}
        placeholder={copy.productHistorySearch}
      />
      {productSearch ? (
        <ul className="sk-picker-list">
          {filteredProducts.slice(0, 20).map((p) => (
            <li key={p.variant_id}>
              <button
                type="button"
                onClick={() => {
                  setVariantId(p.variant_id);
                  setOffset(0);
                  setProductSearch(`${p.product_name}${p.variant_name ? ` — ${p.variant_name}` : ''} (${p.sku})`);
                }}
              >
                {p.product_name}
                {p.variant_name ? ` — ${p.variant_name}` : ''} ({p.sku})
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <PeriodPicker value={period} onChange={setPeriod} />
      {capped ? <p>{copy.exportCapped}</p> : null}
      {variantId === null ? null : (
        <ReportFrame
          title={copy.productHistory}
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
            <>
              <p>
                {copy.openingQuantity}: {data.opening_quantity} · {copy.closingQuantity}: {data.closing_quantity}
              </p>
              <ReportTable
                testId="table-product-history"
                columns={[
                  { key: 'occurred_at', label: copy.dateTime, align: 'start' },
                  { key: 'movement_type', label: copy.movement, align: 'start' },
                  { key: 'document_number', label: copy.document, align: 'start', render: (r) => r.document_number ?? '—' },
                  { key: 'quantity_delta', label: copy.quantityChange, align: 'end' },
                  { key: 'running_quantity', label: copy.runningQuantity, align: 'end' },
                ]}
                rows={data.rows}
                page={{ offset, limit: LIMIT, total: data.total_count, onPage: setOffset }}
              />
            </>
          ) : null}
        </ReportFrame>
      )}
    </>
  );
}
