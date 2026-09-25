// WS-I-3 §7.5 / A12 — low stock report with the "Prepare purchase" flow:
// select rows, adjust suggested quantities, and hand off to the Purchases
// screen via a sessionStorage prefill.

import { useEffect, useRef, useState } from 'react';

import { useI18n } from '../../../shared/i18n';
import { useSession } from '../../../shared/session/SessionContext';
import { getLowStock } from '../../../shared/ipc/reportsGateway';
import type { LowStockRow } from '../../../shared/ipc/reportsDto';
import { useOfficialDocumentContext } from '../../../shared/documents/useOfficialDocumentContext';
import { printDocumentA4, saveDocumentFileWithDialog } from '../../../shared/documents/documentPrintService';
import { renderOfficialDocumentHtml, renderOfficialDocumentPdf } from '../../../shared/documents/officialDocument';
import { presetPeriod } from '../common/periods';
import { ReportFrame } from '../common/ReportFrame';
import { ReportTable } from '../common/ReportTable';
import { csvBytes, toCsv } from '../common/csv';
import { fetchAllPages } from '../common/exportAll';
import { formatQuantityWithPack } from '../common/quantity';
import { buildLowStockModel } from '../common/printModels';
import { useReportCopy } from '../common/reportCopy';
import type { AppView } from '../../../app/AppShell';

const LIMIT = 50;
const DEBOUNCE_MS = 400;

export const PURCHASE_PREFILL_STORAGE_KEY = 'stockiha.purchasePrefill';

export interface PurchasePrefillLine {
  variant_id: number;
  quantity_base: number;
  unit_cost: string | null;
}

export interface PurchasePrefillPayload {
  created_at: string;
  supplier_id: number | null;
  lines: PurchasePrefillLine[];
}

export function LowStockReport({ setView }: { setView: (v: AppView) => void }) {
  const { locale } = useI18n();
  const copy = useReportCopy();
  const { user } = useSession();
  const token = user?.token ?? '';
  const { identity } = useOfficialDocumentContext(token);
  const period = presetPeriod('TODAY');

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ total_count: number; rows: LowStockRow[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [capped, setCapped] = useState(false);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [supplierChoice, setSupplierChoice] = useState<{
    options: Array<{ id: number; name: string }>;
    onChoose: (id: number | null) => void;
  } | null>(null);
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
    getLowStock(token, search || null, LIMIT, offset)
      .then((result) => {
        if (reqRef.current !== reqId) return;
        setData(result);
        setLoading(false);
        setQuantities((prev) => {
          const next = { ...prev };
          for (const row of result.rows) {
            if (!(row.variant_id in next)) next[row.variant_id] = row.suggested_qty_base;
          }
          return next;
        });
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

  async function collectAll(): Promise<LowStockRow[]> {
    const { rows, capped: wasCapped } = await fetchAllPages<LowStockRow>((pageOffset, pageLimit) =>
      getLowStock(token, search || null, pageLimit, pageOffset),
    );
    setCapped(wasCapped);
    return rows;
  }

  async function handlePrint() {
    if (!data || !identity) return;
    setExportBusy(true);
    try {
      const rows = await collectAll();
      const model = buildLowStockModel({ period, copy, locale, todayText: period.to }, { total_count: rows.length, rows });
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
      const model = buildLowStockModel({ period, copy, locale, todayText: period.to }, { total_count: rows.length, rows });
      const bytes = await renderOfficialDocumentPdf(model, identity);
      await saveDocumentFileWithDialog({
        defaultFileName: `low-stock-${period.to}.pdf`,
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
          { key: 'product_name', label: copy.lowStock },
          { key: 'variant_label', label: '' },
          { key: 'sku', label: 'SKU' },
          { key: 'on_hand', label: copy.onHand, numeric: true },
          { key: 'minimum_stock', label: copy.minimumStock, numeric: true },
          { key: 'suggested_qty_base', label: copy.suggestedOrder, numeric: true },
          { key: 'last_supplier_name', label: copy.lastSupplier },
          { key: 'last_unit_cost', label: copy.lastCost, numeric: true },
          { key: 'last_purchase_date', label: copy.lastPurchase },
        ],
        rows,
        locale,
      );
      await saveDocumentFileWithDialog({
        defaultFileName: `low-stock-${period.to}.csv`,
        bytes: csvBytes(csv),
        filterName: 'CSV',
        extension: 'csv',
      });
    } finally {
      setExportBusy(false);
    }
  }

  const pageRows = data?.rows ?? [];
  const anySelected = pageRows.some((r) => selected[r.variant_id]);
  const anyQuantityPositive = pageRows.some(
    (r) => selected[r.variant_id] && Number(quantities[r.variant_id] ?? '0') > 0,
  );

  function toggleAll(checked: boolean) {
    setSelected((prev) => {
      const next = { ...prev };
      for (const row of pageRows) next[row.variant_id] = checked;
      return next;
    });
  }

  function buildPrefillLines(): { lines: PurchasePrefillLine[]; supplierIds: Array<{ id: number; name: string }> } {
    const lines: PurchasePrefillLine[] = [];
    const supplierMap = new Map<number, string>();
    for (const row of pageRows) {
      if (!selected[row.variant_id]) continue;
      const qty = Number(quantities[row.variant_id] ?? '0');
      if (!(qty > 0)) continue;
      lines.push({
        variant_id: row.variant_id,
        quantity_base: qty,
        unit_cost: row.last_unit_cost,
      });
      if (row.last_supplier_id !== null && row.last_supplier_name !== null) {
        supplierMap.set(row.last_supplier_id, row.last_supplier_name);
      }
    }
    return { lines, supplierIds: Array.from(supplierMap, ([id, name]) => ({ id, name })) };
  }

  function writePrefillAndNavigate(supplierId: number | null, lines: PurchasePrefillLine[]) {
    const payload: PurchasePrefillPayload = {
      created_at: new Date().toISOString(),
      supplier_id: supplierId,
      lines,
    };
    try {
      window.sessionStorage.setItem(PURCHASE_PREFILL_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Best effort only.
    }
    setView('purchases');
  }

  function handlePreparePurchase() {
    const { lines, supplierIds } = buildPrefillLines();
    if (lines.length === 0) return;
    if (supplierIds.length === 0) {
      writePrefillAndNavigate(null, lines);
    } else if (supplierIds.length === 1) {
      writePrefillAndNavigate(supplierIds[0].id, lines);
    } else {
      setSupplierChoice({
        options: supplierIds,
        onChoose: (id) => {
          setSupplierChoice(null);
          writePrefillAndNavigate(id, lines);
        },
      });
    }
  }

  return (
    <>
      <div className="sk-reports-filter-card sk-reports-filter-card--compact">
        <div className="sk-reports-filter-grid">
          <div className="sk-reports-filter-cell sk-reports-filter-cell--col-6">
            <span className="sk-reports-filter-label">{copy.search}</span>
            <input
              type="search"
              className="sk-field__input"
              data-testid="low-stock-search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </div>
        </div>
      </div>
      {capped ? <p>{copy.exportCapped}</p> : null}
      <ReportFrame
        title={copy.lowStock}
        loading={loading}
        error={error}
        empty={!loading && !error && pageRows.length === 0}
        onRetry={load}
        onPrint={handlePrint}
        onPdf={handlePdf}
        onCsv={handleCsv}
        exportBusy={exportBusy}
      >
        {data ? (
          <>
            <ReportTable
              testId="table-low-stock"
              columns={[
                {
                  key: 'select',
                  label: '',
                  align: 'center',
                  render: (r) => (
                    <input
                      type="checkbox"
                      data-testid={`low-select-${r.variant_id}`}
                      checked={Boolean(selected[r.variant_id])}
                      onChange={(event) =>
                        setSelected((prev) => ({ ...prev, [r.variant_id]: event.target.checked }))
                      }
                    />
                  ),
                },
                { key: 'product_name', label: copy.lowStock, align: 'start' },
                { key: 'sku', label: 'SKU', align: 'start' },
                { key: 'on_hand', label: copy.onHand, align: 'end' },
                { key: 'minimum_stock', label: copy.minimumStock, align: 'end' },
                {
                  key: 'suggested_qty_base',
                  label: copy.suggestedOrder,
                  align: 'end',
                  render: (r) => (
                    <input
                      type="number"
                      min={0}
                      step={1}
                      className="sk-field__input"
                      data-testid={`low-qty-${r.variant_id}`}
                      value={quantities[r.variant_id] ?? r.suggested_qty_base}
                      onChange={(event) =>
                        setQuantities((prev) => ({ ...prev, [r.variant_id]: event.target.value }))
                      }
                      style={{ width: '90px' }}
                    />
                  ),
                },
                {
                  key: 'packs',
                  label: '',
                  align: 'end',
                  render: (r) =>
                    r.suggested_packs
                      ? formatQuantityWithPack(r.suggested_qty_base, r.base_unit_name, r.pack_unit_name, r.pack_factor, locale)
                      : '',
                },
                { key: 'last_supplier_name', label: copy.lastSupplier, align: 'start', render: (r) => r.last_supplier_name ?? '—' },
                { key: 'last_unit_cost', label: copy.lastCost, align: 'end', render: (r) => r.last_unit_cost ?? '—' },
                { key: 'last_purchase_date', label: copy.lastPurchase, align: 'start', render: (r) => r.last_purchase_date ?? '—' },
              ]}
              rows={pageRows}
              page={{ offset, limit: LIMIT, total: data.total_count, onPage: setOffset }}
            />
            <div className="sk-action-group">
              <label className="sk-checkbox-row">
                <input
                  type="checkbox"
                  data-testid="low-select-all"
                  checked={pageRows.length > 0 && pageRows.every((r) => selected[r.variant_id])}
                  onChange={(event) => toggleAll(event.target.checked)}
                />
                <span>{copy.selectAllOnPage}</span>
              </label>
              <button
                type="button"
                className="sk-btn sk-btn--primary"
                data-testid="prepare-purchase"
                disabled={!anySelected || !anyQuantityPositive}
                onClick={handlePreparePurchase}
              >
                {copy.preparePurchase}
              </button>
            </div>
          </>
        ) : null}
      </ReportFrame>
      {supplierChoice ? (
        <div className="sk-modal__backdrop" role="presentation" data-testid="prepare-supplier-backdrop">
          <div
            className="sk-modal sk-modal-content--large"
            role="dialog"
            aria-modal="true"
            aria-label={copy.prepareSupplierDialogTitle}
            data-testid="prepare-supplier-dialog"
          >
            <div className="sk-modal-header">
              <h2 className="sk-modal__title">{copy.prepareSupplierDialogTitle}</h2>
            </div>
            <div className="sk-action-group" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              {supplierChoice.options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className="sk-btn sk-btn--secondary"
                  data-testid={`prepare-supplier-${option.id}`}
                  onClick={() => supplierChoice.onChoose(option.id)}
                >
                  {option.name}
                </button>
              ))}
              <button
                type="button"
                className="sk-btn sk-btn--secondary"
                data-testid="prepare-supplier-later"
                onClick={() => supplierChoice.onChoose(null)}
              >
                {copy.chooseLater}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
