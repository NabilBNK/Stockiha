import { useEffect, useMemo, useRef, useState } from 'react';
import {
  confirmDirectPurchase,
  listPurchaseProductOptions,
  listPurchaseReceipts,
  listSuppliers,
  listWarehouses,
  newRequestId,
} from '../../shared/ipc/gateway';
import type {
  ConfirmDirectPurchasePayload,
  CreatePoLinePayload,
  PurchaseProductOption,
  PurchaseReceiptSummary,
  ProcurementCapabilities,
  Supplier,
  Warehouse,
} from '../../shared/ipc/dto';
import { currentBusinessDate } from '../../shared/utils/businessDate';
import { formatDisplayDate } from '../../shared/utils/formatters';
import { useI18n } from '../../shared/i18n';
import { useErrorText } from '../../shared/hooks/useErrorText';
import { PurchaseReceiptDetailModal } from './PurchaseReceiptDetailModal';
import { PurchaseItemPicker } from './PurchaseItemPicker';
import { JournalDetailModal } from '../accounting/JournalsScreen';
import { addExactDecimals, isPositiveDecimal, multiplyExactDecimals } from './procurementDecimal';
import { PROCUREMENT_COPY } from './procurementCopy';
import './procurement.css';

interface Props {
  sessionToken: string;
  capabilities: ProcurementCapabilities;
  openFiscalPeriodId: number | null;
}

export default function PurchasesScreen({ sessionToken, openFiscalPeriodId }: Props) {
  const { t, locale } = useI18n();
  const text = PROCUREMENT_COPY[locale];
  const errorText = useErrorText();
  const [receipts, setReceipts] = useState<PurchaseReceiptSummary[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<PurchaseProductOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [lineErrors, setLineErrors] = useState<Record<number, { unit?: string; quantity?: string; unitCost?: string }>>({});
  const [selectedReceipt, setSelectedReceipt] = useState<PurchaseReceiptSummary | null>(null);
  const [selectedJournalDocId, setSelectedJournalDocId] = useState<number | null>(null);

  // Filtering state
  const [searchQuery, setSearchQuery] = useState('');
  const [supplierFilter, setSupplierFilter] = useState<number>(0);
  const [warehouseFilter, setWarehouseFilter] = useState<number>(0);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Direct Purchase Form state
  const directRequestId = useRef<string | null>(null);
  const [documentDate, setDocumentDate] = useState<string>(currentBusinessDate());
  const [supplierId, setSupplierId] = useState<number>(0);
  const [warehouseId, setWarehouseId] = useState<number>(0);
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<CreatePoLinePayload[]>([]);

  // Fast item entry / picker state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTargetIndex, setPickerTargetIndex] = useState<number | null>(null);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [barcodeError, setBarcodeError] = useState<string | null>(null);
  const barcodeInputRef = useRef<HTMLInputElement | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [receiptData, suppsData, whsData, prodsData] = await Promise.all([
        listPurchaseReceipts(sessionToken),
        listSuppliers(sessionToken),
        listWarehouses(sessionToken),
        listPurchaseProductOptions(sessionToken),
      ]);
      setReceipts(receiptData);
      setSuppliers(suppsData);
      setWarehouses(whsData);
      setProducts(prodsData);

      if (suppsData.length > 0 && supplierId === 0) {
        setSupplierId(suppsData[0].id);
      }
      if (whsData.length > 0 && warehouseId === 0) {
        setWarehouseId(whsData[0].id);
      }
    } catch (err: unknown) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [sessionToken]);

  const appendLineFromOption = (option: PurchaseProductOption) => {
    setLines((prev) => [
      ...prev,
      {
        variant_id: option.variant_id,
        unit_id: option.default_unit_id,
        quantity_ordered: '1',
        unit_cost: option.last_purchase_cost ?? option.default_unit_cost ?? '0',
      },
    ]);
  };

  const openPickerForNewLine = () => {
    setPickerTargetIndex(null);
    setPickerOpen(true);
  };

  const openPickerForLine = (index: number) => {
    setPickerTargetIndex(index);
    setPickerOpen(true);
  };

  const handlePickerSelect = (option: PurchaseProductOption) => {
    if (pickerTargetIndex === null) {
      appendLineFromOption(option);
    } else {
      const index = pickerTargetIndex;
      setLines((prev) =>
        prev.map((line, idx) =>
          idx === index
            ? { ...line, variant_id: option.variant_id, unit_id: option.default_unit_id }
            : line,
        ),
      );
    }
    setPickerOpen(false);
    setPickerTargetIndex(null);
  };

  const handleBarcodeSubmit = () => {
    const code = barcodeInput.trim();
    if (!code) return;
    const match = products.find(
      (item) => item.is_active && item.primary_barcode && item.primary_barcode === code,
    );
    if (!match) {
      setBarcodeError(text.barcodeNotFound);
      return;
    }
    if (lines.some((line) => line.variant_id === match.variant_id)) {
      setBarcodeError(text.itemAlreadyAdded);
      return;
    }
    appendLineFromOption(match);
    setBarcodeError(null);
    setBarcodeInput('');
    barcodeInputRef.current?.focus();
  };

  const removeLine = (index: number) => {
    setLines(lines.filter((_, idx) => idx !== index));
  };

  const updateLine = (index: number, updated: CreatePoLinePayload) => {
    const next = [...lines];
    next[index] = updated;
    setLines(next);
    setLineErrors((current) => ({ ...current, [index]: {} }));
  };

  const calculateSubtotal = () => {
    return addExactDecimals(
      lines.map((l) => multiplyExactDecimals(l.quantity_ordered, l.unit_cost)),
    );
  };

  const validateLines = (): { valid: boolean; errors: Record<number, { unit?: string; quantity?: string; unitCost?: string }> } => {
    const effectiveLines = new Set<string>();
    const nextLineErrors: Record<number, { unit?: string; quantity?: string; unitCost?: string }> = {};
    lines.forEach((line, index) => {
      const errors: { unit?: string; quantity?: string; unitCost?: string } = {};
      const product = products.find((item) => item.variant_id === line.variant_id);
      const validUnits = product
        ? [product.default_unit_id, ...product.alternate_units.map((unit) => unit.unit_id)]
        : [];
      if (!product || !validUnits.includes(line.unit_id)) {
        errors.unit = 'Choose a unit configured for this product.';
      }
      if (!isPositiveDecimal(line.quantity_ordered)) {
        errors.quantity = 'Enter a quantity greater than 0, for example 1 or 1.500.';
      }
      const parsedCost = parseFloat(line.unit_cost);
      if (isNaN(parsedCost) || parsedCost < 0 || !/^\d+(?:\.\d+)?$/.test(line.unit_cost.trim())) {
        errors.unitCost = 'Enter a unit cost of 0 or more, for example 1000 or 1000.00.';
      }
      const lineKey = `${line.variant_id}:${line.unit_id}`;
      if (effectiveLines.has(lineKey)) {
        errors.unit = 'This product and unit already appear on another line. Combine the quantities or remove one line.';
      }
      effectiveLines.add(lineKey);
      if (Object.keys(errors).length > 0) {
        nextLineErrors[index] = errors;
      }
    });

    return {
      valid: Object.keys(nextLineErrors).length === 0,
      errors: nextLineErrors,
    };
  };

  const resetForm = () => {
    setShowCreateForm(false);
    setLineErrors({});
    setLines([]);
    setNote('');
    setBarcodeInput('');
    setBarcodeError(null);
  };

  const handleConfirmDirectPurchase = async () => {
    if (supplierId <= 0 || warehouseId <= 0 || lines.length === 0) {
      setError('Please select a supplier, warehouse, and add at least one line.');
      return;
    }

    const { valid, errors } = validateLines();
    if (!valid) {
      setLineErrors(errors);
      setError('Correct the highlighted values, then confirm the purchase.');
      return;
    }

    if (!openFiscalPeriodId) {
      setError(text.openPeriodRequired);
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      directRequestId.current ??= newRequestId();
      const payload: ConfirmDirectPurchasePayload = {
        request_id: directRequestId.current,
        supplier_id: supplierId,
        warehouse_id: warehouseId,
        fiscal_period_id: openFiscalPeriodId,
        document_date: documentDate,
        note: note.trim() || null,
        lines: lines.map((l) => ({
          variant_id: l.variant_id,
          unit_id: l.unit_id,
          quantity_received: l.quantity_ordered,
          unit_cost: l.unit_cost,
        })),
      };
      const result = await confirmDirectPurchase(sessionToken, payload);
      directRequestId.current = null;
      resetForm();
      setSuccessBanner(`${text.purchaseConfirmed} ${result.document_number} (${result.total_amount} DZD)`);
      await loadData();
    } catch (err: unknown) {
      setError(errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  // Filtered receipts calculation
  const filteredReceipts = useMemo(() => {
    return receipts.filter((receipt) => {
      if (supplierFilter > 0 && receipt.supplier_id !== supplierFilter) return false;
      if (warehouseFilter > 0 && receipt.warehouse_id !== warehouseFilter) return false;

      const postedDay = receipt.posted_at ? receipt.posted_at.slice(0, 10) : '';
      if (dateFrom && postedDay && postedDay < dateFrom) return false;
      if (dateTo && postedDay && postedDay > dateTo) return false;

      if (searchQuery.trim().length > 0) {
        const q = searchQuery.toLowerCase();
        const docNumMatch = receipt.document_number.toLowerCase().includes(q);
        const suppMatch = receipt.supplier_name.toLowerCase().includes(q);
        const whMatch = receipt.warehouse_name.toLowerCase().includes(q);
        const poMatch = receipt.purchase_order_number?.toLowerCase().includes(q) ?? false;
        const jMatch = receipt.journal_document_number?.toLowerCase().includes(q) ?? false;
        if (!docNumMatch && !suppMatch && !whMatch && !poMatch && !jMatch) {
          return false;
        }
      }
      return true;
    });
  }, [receipts, supplierFilter, warehouseFilter, searchQuery, dateFrom, dateTo]);

  // Summary metrics
  const totalReceiptsCount = receipts.length;
  const totalReceiptsAmount = useMemo(() => {
    return addExactDecimals(receipts.map((r) => r.total_amount));
  }, [receipts]);
  const directPurchasesCount = receipts.length;

  return (
    <div className="sk-screen">
      <header className="sk-screen__header">
        <div>
          <h1>Purchases</h1>
          <p className="sk-muted" style={{ margin: '4px 0 0 0', fontSize: '0.88rem' }}>
            {text.purchasesTitle}
          </p>
        </div>
        <button
          type="button"
          className="sk-button sk-button--primary"
          onClick={() => {
            setShowCreateForm(true);
            setLineErrors({});
          }}
          data-testid="create-po-btn"
        >
          + {text.newPurchase}
        </button>
      </header>

      {successBanner && (
        <div className="sk-banner sk-banner--success" data-testid="po-success-banner">
          {successBanner}
        </div>
      )}

      {error && (
        <div className="sk-banner sk-banner--error" data-testid="po-error">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{error}</span>
            <button
              type="button"
              className="sk-button sk-button--small sk-button--secondary"
              onClick={loadData}
            >
              {text.retry}
            </button>
          </div>
        </div>
      )}

      {/* Direct Purchase Creation Form */}
      {showCreateForm && (
        <form className="pr-composer-card" onSubmit={(event) => event.preventDefault()} data-testid="direct-purchase-form">
          <div className="pr-composer-header">
            <div className="pr-composer-header__title">
              <h2>{text.newPurchase}</h2>
              <span className="sk-badge sk-badge--success">{text.directPurchase}</span>
            </div>
            <button
              type="button"
              className="sk-modal-close"
              onClick={resetForm}
              aria-label={t('common.cancel')}
              title={t('common.cancel')}
              style={{ width: 30, height: 30 }}
            >
              ✕
            </button>
          </div>

          <div className="pr-order-grid">
            <div className="pr-order-field">
              <label htmlFor="po-supplier-select">
                {text.supplier} *
              </label>
              <select
                id="po-supplier-select"
                value={supplierId}
                onChange={(e) => setSupplierId(parseInt(e.target.value, 10))}
                required
                data-testid="po-supplier-select"
              >
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </select>
            </div>

            <div className="pr-order-field">
              <label htmlFor="po-warehouse-select">
                {text.destinationWarehouse} *
              </label>
              <select
                id="po-warehouse-select"
                value={warehouseId}
                onChange={(e) => setWarehouseId(parseInt(e.target.value, 10))}
                required
                data-testid="po-warehouse-select"
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.code})
                  </option>
                ))}
              </select>
            </div>

            <div className="pr-order-field">
              <label htmlFor="direct-purchase-date-input">
                {text.date} *
              </label>
              <input
                id="direct-purchase-date-input"
                type="date"
                value={documentDate}
                onChange={(e) => setDocumentDate(e.target.value)}
                required
                data-testid="direct-purchase-date-input"
              />
            </div>

            <div className="pr-order-field">
              <label htmlFor="direct-purchase-note-input">
                {text.note}
              </label>
              <input
                id="direct-purchase-note-input"
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={text.optionalNote}
              />
            </div>
          </div>

          <div className="pr-entry-toolbar">
            <div className="pr-scanner-input-group">
              <input
                ref={barcodeInputRef}
                type="text"
                className="pr-scanner-input"
                placeholder={text.scanBarcodePlaceholder}
                aria-label={text.scanBarcodePlaceholder}
                value={barcodeInput}
                onChange={(event) => {
                  setBarcodeInput(event.target.value);
                  setBarcodeError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    handleBarcodeSubmit();
                  }
                }}
                data-testid="purchase-barcode-input"
              />
              {barcodeError && (
                <div className="sk-field-error" data-testid="purchase-barcode-error" style={{ marginTop: 4 }}>
                  {barcodeError}
                </div>
              )}
            </div>

            <button
              type="button"
              className="sk-button sk-button--secondary pr-scanner-btn"
              onClick={openPickerForNewLine}
              data-testid="add-purchase-line-btn"
            >
              <span aria-hidden style={{ fontSize: '1.05rem', lineHeight: 1 }}>⌕</span>
              + {text.chooseItem}
            </button>
          </div>

          <div className="pr-items-table-container">
            <table className="pr-items-table" data-testid="po-lines-input-table">
              <thead>
                <tr>
                  <th style={{ width: '38%' }}>{text.product}</th>
                  <th style={{ width: '14%' }}>{text.unit}</th>
                  <th style={{ width: '14%' }}>{text.quantity}</th>
                  <th style={{ width: '16%' }}>{text.unitCost} (DZD)</th>
                  <th className="sk-num" style={{ width: '14%' }}>{text.total}</th>
                  <th style={{ width: '4%', textAlign: 'center' }}></th>
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: 0 }}>
                      <div className="pr-empty-table-state">
                        <div className="pr-empty-table-state__icon" aria-hidden>🛒</div>
                        <div style={{ fontWeight: 600, color: 'var(--sk-text)' }}>
                          {text.purchasedItems}
                        </div>
                        <div style={{ fontSize: '0.86rem' }}>
                          {locale === 'ar'
                            ? 'امسح الباركود أعلاه أو انقر على اختيار عنصر لإضافة منتجات'
                            : locale === 'fr'
                            ? 'Scannez un code-barres ci-dessus ou cliquez sur Choisir un article'
                            : 'Scan a barcode above or click Choose Item to add products'}
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  lines.map((line, idx) => {
                    const product = products.find((item) => item.variant_id === line.variant_id);
                    const availableUnits = product
                      ? [
                          { id: product.default_unit_id, code: product.default_unit_code, name: product.default_unit_name },
                          ...product.alternate_units.map((unit) => ({
                            id: unit.unit_id,
                            code: unit.unit_code,
                            name: unit.unit_code,
                          })),
                        ]
                      : [];
                    return (
                      <tr key={idx}>
                        <td>
                          <button
                            type="button"
                            className="pr-cell-product-btn"
                            onClick={() => openPickerForLine(idx)}
                            data-testid={`purchase-line-product-${idx}`}
                          >
                            <span style={{ fontWeight: 700, color: 'var(--sk-text)' }}>
                              {product
                                ? `${product.product_name}${product.variant_name ? ` — ${product.variant_name}` : ''}`
                                : text.chooseItem}
                            </span>
                            {product?.primary_barcode && (
                              <span style={{ fontSize: '0.76rem', color: 'var(--sk-muted)' }}>
                                {product.primary_barcode} · {product.sku}
                              </span>
                            )}
                          </button>
                        </td>
                        <td>
                          <select
                            className="pr-cell-input"
                            value={line.unit_id}
                            onChange={(e) => updateLine(idx, { ...line, unit_id: parseInt(e.target.value, 10) })}
                          >
                            {availableUnits.map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.code}
                              </option>
                            ))}
                          </select>
                          {lineErrors[idx]?.unit && <div className="sk-field-error">{lineErrors[idx].unit}</div>}
                        </td>
                        <td>
                          <input
                            type="text"
                            className="pr-cell-input"
                            aria-invalid={!!lineErrors[idx]?.quantity}
                            value={line.quantity_ordered}
                            onChange={(e) => updateLine(idx, { ...line, quantity_ordered: e.target.value })}
                          />
                          {lineErrors[idx]?.quantity && <div className="sk-field-error">{lineErrors[idx].quantity}</div>}
                        </td>
                        <td>
                          <input
                            type="text"
                            className="pr-cell-input"
                            aria-invalid={!!lineErrors[idx]?.unitCost}
                            value={line.unit_cost}
                            onChange={(e) => updateLine(idx, { ...line, unit_cost: e.target.value })}
                          />
                          {lineErrors[idx]?.unitCost && <div className="sk-field-error">{lineErrors[idx].unitCost}</div>}
                        </td>
                        <td className="sk-num" style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                          {multiplyExactDecimals(line.quantity_ordered, line.unit_cost)} DZD
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <button
                            type="button"
                            className="pr-remove-action-btn"
                            onClick={() => removeLine(idx)}
                            aria-label={text.remove}
                            title={text.remove}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="pr-composer-footer">
            <div className="pr-composer-footer__summary">
              <span className="pr-composer-footer__total-label">{text.subtotalPreview}:</span>
              <strong className="pr-composer-footer__total-value">{calculateSubtotal()} DZD</strong>
              {lines.length > 0 && (
                <span style={{ fontSize: '0.82rem', color: 'var(--sk-muted)', marginInlineStart: 8 }}>
                  ({lines.length} {lines.length === 1 ? 'item' : 'items'})
                </span>
              )}
            </div>

            <div className="pr-composer-footer__actions">
              <button
                type="button"
                className="sk-button sk-button--secondary"
                onClick={resetForm}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="sk-button sk-button--primary"
                onClick={handleConfirmDirectPurchase}
                disabled={submitting}
                data-testid="confirm-direct-purchase-btn"
                style={{ minWidth: 150 }}
              >
                {submitting ? text.confirming : text.confirmPurchase}
              </button>
            </div>
          </div>

          <PurchaseItemPicker
            isOpen={pickerOpen}
            items={products}
            disabledVariantIds={pickerTargetIndex === null ? lines.map((line) => line.variant_id) : []}
            onSelect={handlePickerSelect}
            onClose={() => {
              setPickerOpen(false);
              setPickerTargetIndex(null);
            }}
          />
        </form>
      )}

      {/* Summary Metrics */}
      <div className="sk-cards" style={{ marginBottom: '22px' }}>
        <div className="sk-metric pr-metric-card" data-testid="metric-total-receipts">
          <span className="sk-metric__label">{text.totalReceipts}</span>
          <strong className="sk-metric__value">{totalReceiptsCount}</strong>
        </div>
        <div className="sk-metric pr-metric-card" data-testid="metric-direct-purchases">
          <span className="sk-metric__label">{text.directPurchases}</span>
          <strong className="sk-metric__value">{directPurchasesCount}</strong>
        </div>
        <div className="sk-metric pr-metric-card" data-testid="metric-total-value">
          <span className="sk-metric__label">{text.totalValue}</span>
          <strong className="sk-metric__value" style={{ color: 'var(--sk-primary)' }}>{totalReceiptsAmount} DZD</strong>
        </div>
      </div>

      {/* Purchase Receipts History Section */}
      <section className="sk-card" style={{ padding: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px', marginBottom: '18px' }}>
          <h2 style={{ margin: 0 }}>{text.receiptsTitle}</h2>
          <div className="pr-history-toolbar">
            <input
              type="search"
              placeholder={text.searchReceiptsPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pr-filter-input"
              style={{ minWidth: '220px' }}
              data-testid="search-receipts-input"
            />
            <div className="pr-filter-date-badge">
              <span>{text.dateFrom}</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
                data-testid="filter-receipt-date-from"
              />
            </div>
            <div className="pr-filter-date-badge">
              <span>{text.dateTo}</span>
              <input
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
                data-testid="filter-receipt-date-to"
              />
            </div>
            <select
              value={supplierFilter}
              onChange={(e) => setSupplierFilter(parseInt(e.target.value, 10))}
              className="pr-filter-input"
              data-testid="filter-receipt-supplier-select"
            >
              <option value="0">{text.allSuppliers}</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select
              value={warehouseFilter}
              onChange={(e) => setWarehouseFilter(parseInt(e.target.value, 10))}
              className="pr-filter-input"
              data-testid="filter-receipt-warehouse-select"
            >
              <option value="0">{text.allWarehouses}</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="sk-spinner">{text.loading}</div>
        ) : filteredReceipts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '36px 16px' }} data-testid="empty-receipts-state">
            <h3 style={{ marginBottom: '8px' }}>{text.noReceipts}</h3>
            <p className="sk-muted" style={{ maxWidth: '420px', margin: '0 auto 18px auto' }}>
              {text.noReceiptsSubtitle}
            </p>
            {!showCreateForm && (
              <button
                type="button"
                className="sk-button sk-button--primary"
                onClick={() => {
                  setShowCreateForm(true);
                  setLineErrors({});
                }}
              >
                + {text.newPurchase}
              </button>
            )}
          </div>
        ) : (
          <div className="sk-table-wrap">
            <table className="sk-table" data-testid="purchase-receipts-table">
              <thead>
                <tr>
                  <th>{text.receipt}</th>
                  <th>{text.date}</th>
                  <th>{text.supplier}</th>
                  <th>{text.warehouse}</th>
                  <th>{text.origin}</th>
                  <th className="sk-num">{text.total}</th>
                  <th>{text.receiptJournal}</th>
                  <th className="sk-num">{text.landedCost}</th>
                  <th>{text.actions}</th>
                </tr>
              </thead>
              <tbody>
                {filteredReceipts.map((receipt) => {
                  const isDirect = receipt.receipt_origin === 'DIRECT_PURCHASE' || !receipt.purchase_order_id;
                  return (
                    <tr key={receipt.document_id} data-testid={`receipt-row-${receipt.document_id}`}>
                      <td>
                        <strong>{receipt.document_number}</strong>
                      </td>
                      <td>{formatDisplayDate(receipt.posted_at)}</td>
                      <td>{receipt.supplier_name}</td>
                      <td>{receipt.warehouse_name}</td>
                      <td>
                        <span
                          className={`sk-badge ${isDirect ? 'sk-badge--success' : 'sk-badge--info'}`}
                          data-testid={`origin-badge-${receipt.document_id}`}
                        >
                          {isDirect ? text.directPurchase : `${text.purchaseOrderOrigin}: ${receipt.purchase_order_number ?? `#${receipt.purchase_order_id}`}`}
                        </span>
                      </td>
                      <td className="sk-num">
                        <strong>{receipt.total_amount} DZD</strong>
                      </td>
                      <td>
                        {receipt.journal_document_number ? (
                          <button
                            type="button"
                            className="sk-button sk-button--link"
                            style={{ padding: 0, fontSize: 'inherit', textDecoration: 'underline' }}
                            onClick={() => receipt.journal_document_id && setSelectedJournalDocId(receipt.journal_document_id)}
                          >
                            {receipt.journal_document_number}
                          </button>
                        ) : receipt.journal_document_id ? (
                          `#${receipt.journal_document_id}`
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="sk-num">
                        {receipt.landed_cost_amount ? `${receipt.landed_cost_amount} DZD` : '—'}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className="sk-button sk-button--small sk-button--secondary"
                            onClick={() => setSelectedReceipt(receipt)}
                            data-testid={`view-receipt-${receipt.document_id}`}
                          >
                            {text.viewDetails}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Purchase Receipt Detail Modal */}
      {selectedReceipt && (
        <PurchaseReceiptDetailModal
          sessionToken={sessionToken}
          receipt={selectedReceipt}
          onClose={() => setSelectedReceipt(null)}
          onViewJournal={(jDocId) => setSelectedJournalDocId(jDocId)}
        />
      )}

      {/* Journal Detail Modal */}
      {selectedJournalDocId && (
        <JournalDetailModal
          journalDocId={selectedJournalDocId}
          onClose={() => setSelectedJournalDocId(null)}
        />
      )}
    </div>
  );
}
