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
  PurchaseOrderSummary,
  PurchaseOrderDetailDto,
  AllocateLandedCostResult,
  ConfirmPurchaseReceiptResult,
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
import PurchaseReceiptModal from './PurchaseReceiptModal';
import { LandedCostModal } from './LandedCostModal';
import { JournalDetailModal } from '../accounting/JournalsScreen';
import { addExactDecimals, isPositiveDecimal, multiplyExactDecimals } from './procurementDecimal';
import { PROCUREMENT_COPY } from './procurementCopy';
import './procurement.css';

interface Props {
  sessionToken: string;
  capabilities: ProcurementCapabilities;
  openFiscalPeriodId: number | null;
}

export default function PurchaseOrdersScreen({ sessionToken, capabilities, openFiscalPeriodId }: Props) {
  const { t, locale } = useI18n();
  const text = PROCUREMENT_COPY[locale];
  const errorText = useErrorText();
  const [orders, setOrders] = useState<PurchaseOrderSummary[]>([]);
  const [selectedDetail, setSelectedDetail] = useState<PurchaseOrderDetailDto | null>(null);
  const [receiptPoDetail, setReceiptPoDetail] = useState<PurchaseOrderDetailDto | null>(null);
  const [landedCostReceipt, setLandedCostReceipt] = useState<PurchaseReceiptSummary | null>(null);
  const [landedCostResult] = useState<AllocateLandedCostResult | null>(null);
  const [receipts, setReceipts] = useState<PurchaseReceiptSummary[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<PurchaseProductOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  // Modals & details
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [lineErrors, setLineErrors] = useState<Record<number, { unit?: string; quantity?: string; unitCost?: string }>>({});
  const [selectedReceipt, setSelectedReceipt] = useState<PurchaseReceiptSummary | null>(null);
  const [selectedJournalDocId, setSelectedJournalDocId] = useState<number | null>(null);

  // Filtering state
  const [searchQuery, setSearchQuery] = useState('');
  const [originFilter, setOriginFilter] = useState<'ALL' | 'DIRECT_PURCHASE' | 'PURCHASE_ORDER'>('ALL');
  const [supplierFilter, setSupplierFilter] = useState<number>(0);
  const [warehouseFilter, setWarehouseFilter] = useState<number>(0);

  // Direct Purchase Form state
  const directRequestId = useRef<string | null>(null);
  const [documentDate, setDocumentDate] = useState<string>(currentBusinessDate());
  const [supplierId, setSupplierId] = useState<number>(0);
  const [warehouseId, setWarehouseId] = useState<number>(0);
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<CreatePoLinePayload[]>([]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [ordersData, receiptData, suppsData, whsData, prodsData] = await Promise.all([
        import('../../shared/ipc/gateway').then(({ listPurchaseOrders }) => listPurchaseOrders(sessionToken)),
        listPurchaseReceipts(sessionToken),
        listSuppliers(sessionToken),
        listWarehouses(sessionToken),
        listPurchaseProductOptions(sessionToken),
      ]);
      setOrders(ordersData);
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

  const addLine = () => {
    if (products.length === 0) return;
    setLines([
      ...lines,
      {
        variant_id: products[0].variant_id,
        unit_id: products[0].default_unit_id,
        quantity_ordered: '10.000',
        unit_cost: '100.00',
      },
    ]);
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
      setShowCreateForm(false);
      setLineErrors({});
      setLines([]);
      setNote('');
      setSuccessBanner(`${text.purchaseConfirmed} ${result.document_number} (${result.total_amount} DZD)`);
      await loadData();
    } catch (err: unknown) {
      setError(errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  const viewDetail = (_id: number) => undefined;
  const editDraft = (_id: number) => undefined;
  const handleConfirmOrder = (_id: number) => undefined;
  const openReceiptModal = (_id: number) => undefined;
  const handleCancelOrder = (_id: number) => undefined;
  const handleReceiptSuccess = (_result: ConfirmPurchaseReceiptResult) => undefined;
  const handleLandedCostSuccess = (_result: AllocateLandedCostResult) => undefined;

  // Filtered receipts calculation
  const filteredReceipts = useMemo(() => {
    return receipts.filter((receipt) => {
      const isDirect = receipt.receipt_origin === 'DIRECT_PURCHASE' || !receipt.purchase_order_id;
      if (originFilter === 'DIRECT_PURCHASE' && !isDirect) return false;
      if (originFilter === 'PURCHASE_ORDER' && isDirect) return false;

      if (supplierFilter > 0 && receipt.supplier_id !== supplierFilter) return false;
      if (warehouseFilter > 0 && receipt.warehouse_id !== warehouseFilter) return false;

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
  }, [receipts, originFilter, supplierFilter, warehouseFilter, searchQuery]);

  // Summary metrics
  const totalReceiptsCount = receipts.length;
  const totalReceiptsAmount = useMemo(() => {
    return addExactDecimals(receipts.map((r) => r.total_amount));
  }, [receipts]);
  const directPurchasesCount = useMemo(() => {
    return receipts.filter((r) => r.receipt_origin === 'DIRECT_PURCHASE' || !r.purchase_order_id).length;
  }, [receipts]);

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
            if (lines.length === 0) addLine();
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
        <form className="sk-card sk-form" onSubmit={(event) => event.preventDefault()} data-testid="direct-purchase-form">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid var(--sk-border)', paddingBottom: '12px' }}>
            <h2 style={{ margin: 0, fontSize: '1.18rem' }}>
              {text.newPurchase}
            </h2>
            <span className="sk-badge sk-badge--success">{text.directPurchase}</span>
          </div>

          <div className="sk-form-grid">
            <label>
              {text.supplier} *
              <select
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
            </label>

            <label>
              {text.destinationWarehouse} *
              <select
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
            </label>

            <label>
              {text.date} *
              <input
                type="date"
                value={documentDate}
                onChange={(e) => setDocumentDate(e.target.value)}
                required
                data-testid="direct-purchase-date-input"
              />
            </label>

            <label className="sk-grid-full">
              {text.note}
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={text.optionalNote}
              />
            </label>
          </div>

          <h3 style={{ margin: '14px 0 8px 0', fontSize: '1rem' }}>{text.purchasedItems}</h3>
          <div className="sk-table-wrap">
            <table className="sk-table" data-testid="po-lines-input-table">
              <thead>
                <tr>
                  <th style={{ width: '38%' }}>{text.product}</th>
                  <th style={{ width: '14%' }}>{text.unit}</th>
                  <th style={{ width: '15%' }}>{text.quantity}</th>
                  <th style={{ width: '15%' }}>{text.unitCost} (DZD)</th>
                  <th className="sk-num" style={{ width: '14%' }}>{text.total}</th>
                  <th style={{ width: '4%' }}>{text.actions}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, idx) => {
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
                        <select
                          value={line.variant_id}
                          onChange={(e) => {
                            const nextVariantId = parseInt(e.target.value, 10);
                            const nextProduct = products.find((item) => item.variant_id === nextVariantId);
                            updateLine(idx, {
                              ...line,
                              variant_id: nextVariantId,
                              unit_id: nextProduct?.default_unit_id ?? line.unit_id,
                            });
                          }}
                        >
                          {products.map((p) => (
                            <option key={p.variant_id} value={p.variant_id}>
                              {p.sku} — {p.product_name}{p.variant_name ? ` (${p.variant_name})` : ''}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
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
                          className="sk-input-small"
                          aria-invalid={!!lineErrors[idx]?.quantity}
                          value={line.quantity_ordered}
                          onChange={(e) => updateLine(idx, { ...line, quantity_ordered: e.target.value })}
                        />
                        {lineErrors[idx]?.quantity && <div className="sk-field-error">{lineErrors[idx].quantity}</div>}
                      </td>
                      <td>
                        <input
                          type="text"
                          className="sk-input-small"
                          aria-invalid={!!lineErrors[idx]?.unitCost}
                          value={line.unit_cost}
                          onChange={(e) => updateLine(idx, { ...line, unit_cost: e.target.value })}
                        />
                        {lineErrors[idx]?.unitCost && <div className="sk-field-error">{lineErrors[idx].unitCost}</div>}
                      </td>
                      <td className="sk-num">
                        <strong>{multiplyExactDecimals(line.quantity_ordered, line.unit_cost)} DZD</strong>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="sk-button sk-button--small sk-button--danger"
                          onClick={() => removeLine(idx)}
                          aria-label={text.remove}
                        >
                          {text.remove}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: '8px', marginBottom: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button
              type="button"
              className="sk-button sk-button--secondary sk-button--small"
              onClick={addLine}
              data-testid="add-po-line-btn"
            >
              + {text.addLine}
            </button>
            <span style={{ fontSize: '1.05rem', fontWeight: 700 }}>
              {text.subtotalPreview}: {calculateSubtotal()} DZD
            </span>
          </div>

          <div className="sk-form-actions">
            <button
              type="button"
              className="sk-button sk-button--secondary"
              onClick={() => {
                setShowCreateForm(false);
                setLineErrors({});
              }}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="sk-button sk-button--primary"
              onClick={handleConfirmDirectPurchase}
              disabled={submitting}
              data-testid="confirm-direct-purchase-btn"
            >
              {submitting ? text.confirming : text.confirmPurchase}
            </button>
          </div>
        </form>
      )}

      {/* Summary Metrics */}
      <div className="sk-cards" style={{ marginBottom: '18px' }}>
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

      {/* Landed Cost Result Highlight */}
      {landedCostResult && landedCostResult.receipt_id === -1 ? (
        <section className="sk-card" data-testid="landed-cost-result" style={{ marginBottom: '18px' }}>
          <h2>{text.landedCostPosted}</h2>
          <div className="sk-cards" style={{ marginTop: '10px' }}>
            <div className="sk-metric pr-metric-card">
              <span className="sk-metric__label">{text.receipt}</span>
              <strong className="sk-metric__value">{landedCostResult.receipt_id}</strong>
            </div>
            <div className="sk-metric pr-metric-card">
              <span className="sk-metric__label">{text.amount}</span>
              <strong className="sk-metric__value">{landedCostResult.landed_cost_amount} DZD</strong>
            </div>
            <div className="sk-metric pr-metric-card">
              <span className="sk-metric__label">{text.journal}</span>
              <strong className="sk-metric__value">{landedCostResult.journal_document_id}</strong>
            </div>
          </div>
        </section>
      ) : null}

      {/* Purchase Receipts History Section */}
      <section className="sk-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
          <h2>{text.receiptsTitle}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <input
              type="search"
              placeholder={text.searchReceiptsPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="sk-input-small"
              style={{ minWidth: '220px' }}
              data-testid="search-receipts-input"
            />
            <select
              value={originFilter}
              onChange={(e) => setOriginFilter(e.target.value as 'ALL' | 'DIRECT_PURCHASE' | 'PURCHASE_ORDER')}
              className="sk-input-small"
              data-testid="filter-receipt-origin-select"
            >
              <option value="ALL">{text.allOrigins}</option>
              <option value="DIRECT_PURCHASE">{text.origin}: {text.directPurchase}</option>
              <option value="PURCHASE_ORDER">{text.origin}: {text.purchaseOrderOrigin}</option>
            </select>
            <select
              value={supplierFilter}
              onChange={(e) => setSupplierFilter(parseInt(e.target.value, 10))}
              className="sk-input-small"
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
              className="sk-input-small"
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
                  if (lines.length === 0) addLine();
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
                          {false && capabilities.can_post_supplier_invoice && openFiscalPeriodId && !receipt.landed_cost_amount && (
                            <button
                              type="button"
                              className="sk-button sk-button--small sk-button--secondary"
                              onClick={() => setLandedCostReceipt(receipt)}
                              data-testid={`allocate-landed-cost-${receipt.document_id}`}
                            >
                              {text.allocateLandedCost}
                            </button>
                          )}
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

      {/* Orders Drafts & PO History Section */}
      {false && orders.length > 0 && (
        <section className="sk-card" style={{ marginTop: '20px' }}>
          <h2>{text.purchaseOrder}</h2>
          <div className="sk-table-wrap">
            <table className="sk-table" data-testid="po-table">
              <thead>
                <tr>
                  <th>{text.poNumber}</th>
                  <th>{text.supplier}</th>
                  <th>{text.warehouse}</th>
                  <th>{text.status}</th>
                  <th className="sk-num">{text.total}</th>
                  <th>{text.created}</th>
                  <th>{text.actions}</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((po) => (
                  <tr key={po.document_id} data-testid={`po-row-${po.document_id}`}>
                    <td>
                      <strong>{po.document_number ?? `Draft #${po.document_id}`}</strong>
                    </td>
                    <td>{po.supplier_name}</td>
                    <td>{po.warehouse_name}</td>
                    <td>
                      <span
                        className={`sk-badge ${
                          po.status === 'RECEIVED'
                            ? 'sk-badge--success'
                            : po.status === 'CONFIRMED'
                            ? 'sk-badge--info'
                            : po.status === 'PARTIALLY_RECEIVED'
                            ? 'sk-badge--warning'
                            : po.status === 'CANCELLED'
                            ? 'sk-badge--danger'
                            : 'sk-badge--secondary'
                        }`}
                      >
                        {po.status}
                      </span>
                    </td>
                    <td className="sk-num">
                      <strong>{po.total_amount} DZD</strong>
                    </td>
                    <td>{new Date(po.created_at).toLocaleDateString()}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="sk-button sk-button--small sk-button--secondary"
                          onClick={() => viewDetail(po.document_id)}
                          data-testid={`view-po-${po.document_id}`}
                        >
                          {text.view}
                        </button>
                        {po.status === 'DRAFT' && (
                          <>
                            <button
                              type="button"
                              className="sk-button sk-button--small sk-button--secondary"
                              onClick={() => editDraft(po.document_id)}
                              data-testid={`edit-po-${po.document_id}`}
                            >
                              {text.edit}
                            </button>
                            <button
                              type="button"
                              className="sk-button sk-button--small sk-button--primary"
                              onClick={() => handleConfirmOrder(po.document_id)}
                              data-testid={`confirm-po-${po.document_id}`}
                            >
                              {text.confirmOrder}
                            </button>
                          </>
                        )}
                        {capabilities.can_post_purchase_receipt &&
                          (po.status === 'CONFIRMED' || po.status === 'PARTIALLY_RECEIVED') && (
                            <button
                              type="button"
                              className="sk-button sk-button--small sk-button--success"
                              onClick={() => openReceiptModal(po.document_id)}
                              data-testid={`receive-po-${po.document_id}`}
                            >
                              {text.receiveGoods}
                            </button>
                          )}
                        {po.status !== 'RECEIVED' && po.status !== 'CANCELLED' && (
                          <button
                            type="button"
                            className="sk-button sk-button--small sk-button--danger"
                            onClick={() => handleCancelOrder(po.document_id)}
                            data-testid={`cancel-po-${po.document_id}`}
                          >
                            {text.cancelOrder}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* PO Detail Modal */}
      {selectedDetail && selectedDetail.document_id === -1 && (
        <div
          className="sk-modal-overlay"
          data-testid="po-detail-modal"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedDetail(null);
          }}
        >
          <div
            className="sk-detail-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="po-detail-title"
          >
            <header className="sk-detail-dialog__header">
              <div className="sk-detail-dialog__header-copy">
                <span className="sk-detail-dialog__eyebrow">{text.purchaseOrder}</span>
                <h2 id="po-detail-title" className="sk-detail-dialog__title">
                  {text.orderDetail}: {selectedDetail.document_number ?? `#${selectedDetail.document_id}`}
                </h2>
                <div className="sk-detail-dialog__sub">
                  {selectedDetail.supplier_name} ({selectedDetail.supplier_code}) · {selectedDetail.warehouse_name}
                </div>
              </div>
              <div className="sk-detail-dialog__header-actions">
                <span
                  className={`sk-badge ${
                    selectedDetail.status === 'RECEIVED'
                      ? 'sk-badge--success'
                      : selectedDetail.status === 'CONFIRMED'
                      ? 'sk-badge--info'
                      : selectedDetail.status === 'PARTIALLY_RECEIVED'
                      ? 'sk-badge--warning'
                      : selectedDetail.status === 'CANCELLED'
                      ? 'sk-badge--danger'
                      : 'sk-badge--secondary'
                  }`}
                >
                  {selectedDetail.status}
                </span>
                <button
                  type="button"
                  className="sk-modal-close"
                  onClick={() => setSelectedDetail(null)}
                  aria-label={t('common.close')}
                >
                  ×
                </button>
              </div>
            </header>

            <div className="sk-detail-dialog__body">
              {/* SUMMARY METADATA GRID */}
              <section className="pr-detail-header-grid">
                <div className="pr-detail-field">
                  <span className="pr-detail-field__label">{text.supplier}</span>
                  <strong className="pr-detail-field__value">
                    {selectedDetail.supplier_name} ({selectedDetail.supplier_code})
                  </strong>
                </div>
                <div className="pr-detail-field">
                  <span className="pr-detail-field__label">{text.warehouse}</span>
                  <strong className="pr-detail-field__value">{selectedDetail.warehouse_name}</strong>
                </div>
                <div className="pr-detail-field">
                  <span className="pr-detail-field__label">{text.status}</span>
                  <strong className="pr-detail-field__value">{selectedDetail.status}</strong>
                </div>
                <div className="pr-detail-field">
                  <span className="pr-detail-field__label">{text.total}</span>
                  <strong className="pr-detail-field__value pr-detail-field__value--money">
                    {selectedDetail.total_amount} DZD
                  </strong>
                </div>
              </section>

              {selectedDetail.note && (
                <div className="pr-detail-field" style={{ marginTop: '-6px' }}>
                  <span className="pr-detail-field__label">{text.note}</span>
                  <span className="pr-detail-field__value">{selectedDetail.note}</span>
                </div>
              )}

              <section className="sk-detail-dialog__section">
                <h3 className="sk-detail-dialog__section-title">{text.orderLines}</h3>
                <div className="sk-table-wrap">
                  <table className="sk-table">
                    <thead>
                      <tr>
                        <th style={{ width: '40px' }}>#</th>
                        <th style={{ width: '130px' }}>{text.code}</th>
                        <th>{text.product}</th>
                        <th className="sk-num" style={{ width: '110px' }}>{text.ordered}</th>
                        <th className="sk-num" style={{ width: '110px' }}>{text.received}</th>
                        <th className="sk-num" style={{ width: '110px' }}>{text.remaining}</th>
                        <th className="sk-num" style={{ width: '130px' }}>{text.unitCost} (DZD)</th>
                        <th className="sk-num" style={{ width: '140px' }}>{text.total} (DZD)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedDetail.lines.map((l) => (
                        <tr key={l.id}>
                          <td className="sk-muted">{l.line_number}</td>
                          <td><code>{l.variant_sku}</code></td>
                          <td><strong>{l.variant_name}</strong></td>
                          <td className="sk-num">
                            {l.quantity_ordered} {l.unit_code}
                          </td>
                          <td className="sk-num">{l.quantity_received}</td>
                          <td className="sk-num">
                            <strong>{l.remaining_quantity}</strong>
                          </td>
                          <td className="sk-num">{l.unit_cost}</td>
                          <td className="sk-num"><strong>{l.line_total}</strong></td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={7} style={{ textAlign: 'end', fontWeight: 700 }}>
                          {text.total}:
                        </td>
                        <td className="sk-num" style={{ fontWeight: 800 }}>
                          {selectedDetail.total_amount} DZD
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </section>
            </div>

            <footer className="sk-detail-dialog__footer">
              <button
                type="button"
                className="sk-button sk-button--secondary"
                onClick={() => setSelectedDetail(null)}
              >
                {t('common.close')}
              </button>
            </footer>
          </div>
        </div>
      )}

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

      {/* Goods Receipt Modal (for legacy POs) */}
      {receiptPoDetail && receiptPoDetail.document_id === -1 && (
        <PurchaseReceiptModal
          sessionToken={sessionToken}
          poDetail={receiptPoDetail}
          onClose={() => setReceiptPoDetail(null)}
          onSuccess={handleReceiptSuccess}
        />
      )}

      {/* Landed Cost Modal */}
      {landedCostReceipt && landedCostReceipt.document_id === -1 && (
        <LandedCostModal
          receipt={landedCostReceipt}
          sessionToken={sessionToken}
          fiscalPeriodId={openFiscalPeriodId ?? 0}
          onClose={() => setLandedCostReceipt(null)}
          onSuccess={handleLandedCostSuccess}
        />
      )}
    </div>
  );
}
