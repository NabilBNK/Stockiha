import { useEffect, useRef, useState } from 'react';
import {
  cancelPurchaseOrder,
  confirmDirectPurchase,
  confirmPurchaseOrder,
  createPurchaseOrderDraft,
  getPurchaseOrderDetail,
  listPurchaseProductOptions,
  listPurchaseOrders,
  listPurchaseReceipts,
  listSuppliers,
  listWarehouses,
  newRequestId,
  updatePurchaseOrderDraft,
} from '../../shared/ipc/gateway';
import type {
  ConfirmDirectPurchasePayload,
  ConfirmPurchaseReceiptResult,
  AllocateLandedCostResult,
  CreatePoLinePayload,
  PurchaseProductOption,
  PurchaseOrderDetailDto,
  PurchaseOrderSummary,
  PurchaseReceiptSummary,
  ProcurementCapabilities,
  Supplier,
  Warehouse,
} from '../../shared/ipc/dto';
import { currentBusinessDate } from '../../shared/utils/businessDate';
import { useI18n } from '../../shared/i18n';
import { useErrorText } from '../../shared/hooks/useErrorText';
import PurchaseReceiptModal from './PurchaseReceiptModal';
import { LandedCostModal } from './LandedCostModal';
import { addExactDecimals, isPositiveDecimal, multiplyExactDecimals } from './procurementDecimal';
import { PROCUREMENT_COPY } from './procurementCopy';

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
  const [receipts, setReceipts] = useState<PurchaseReceiptSummary[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<PurchaseProductOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingPurchaseOrderId, setEditingPurchaseOrderId] = useState<number | null>(null);
  const [lineErrors, setLineErrors] = useState<Record<number, { unit?: string; quantity?: string; unitCost?: string }>>({});
  const [selectedDetail, setSelectedDetail] = useState<PurchaseOrderDetailDto | null>(null);
  const [receiptPoDetail, setReceiptPoDetail] = useState<PurchaseOrderDetailDto | null>(null);
  const [landedCostReceipt, setLandedCostReceipt] = useState<PurchaseReceiptSummary | null>(null);
  const [landedCostResult, setLandedCostResult] = useState<AllocateLandedCostResult | null>(null);

  // Form state
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
      const [posData, receiptData, suppsData, whsData, prodsData] = await Promise.all([
        listPurchaseOrders(sessionToken),
        listPurchaseReceipts(sessionToken),
        listSuppliers(sessionToken),
        listWarehouses(sessionToken),
        listPurchaseProductOptions(sessionToken),
      ]);
      setOrders(posData);
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

  const handleConfirmDirectPurchase = async () => {
    if (supplierId <= 0 || warehouseId <= 0 || lines.length === 0) {
      setError('Please select a supplier, warehouse, and add at least one line.');
      return;
    }
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
      if (!isPositiveDecimal(line.quantity_ordered)) errors.quantity = 'Enter a quantity greater than 0, for example 1 or 1.500.';
      if (!/^\d+(?:\.\d+)?$/.test(line.unit_cost.trim())) errors.unitCost = 'Enter a unit cost of 0 or more, for example 1000 or 1000.00.';
      const effectiveLine = `${line.variant_id}:${line.unit_id}`;
      if (effectiveLines.has(effectiveLine)) {
        errors.quantity = 'This product and unit already appear on another line. Combine the quantities or remove one line.';
      }
      effectiveLines.add(effectiveLine);
      if (errors.unit || errors.quantity || errors.unitCost) nextLineErrors[index] = errors;
    });
    if (Object.keys(nextLineErrors).length > 0) {
      setLineErrors(nextLineErrors);
      setError('Correct the highlighted values, then confirm the purchase.');
      return;
    }
    if (!openFiscalPeriodId) {
      setError(text.openPeriodRequired);
      return;
    }

    try {
      setError(null);
      setSuccessBanner(null);
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
      setLines([]);
      setNote('');
      setSuccessBanner(`${text.purchaseConfirmed} ${result.document_number} (${result.total_amount} DZD)`);
      await loadData();
    } catch (err: unknown) {
      setError(errorText(err));
    }
  };

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (supplierId <= 0 || warehouseId <= 0 || lines.length === 0) {
      setError('Please select a supplier, warehouse, and add at least one line.');
      return;
    }

    try {
      setError(null);
      const payload = {
        supplier_id: supplierId,
        warehouse_id: warehouseId,
        note: note || null,
        lines,
      };
      if (editingPurchaseOrderId === null) {
        await createPurchaseOrderDraft(sessionToken, payload);
      } else {
        await updatePurchaseOrderDraft(sessionToken, { purchase_order_id: editingPurchaseOrderId, ...payload });
      }
      setShowCreateForm(false);
      setEditingPurchaseOrderId(null);
      setLines([]);
      setNote('');
      setSuccessBanner(editingPurchaseOrderId === null ? 'Purchase draft saved.' : 'Purchase draft updated.');
      await loadData();
    } catch (err: unknown) {
      setError(errorText(err));
    }
  };

  const handleConfirmOrder = async (orderId: number) => {
    try {
      setError(null);
      await confirmPurchaseOrder(sessionToken, orderId);
      setSuccessBanner(`Purchase Order confirmed.`);
      await loadData();
      if (selectedDetail && selectedDetail.document_id === orderId) {
        const updated = await getPurchaseOrderDetail(sessionToken, orderId);
        setSelectedDetail(updated);
      }
    } catch (err: unknown) {
      setError(errorText(err));
    }
  };

  const handleCancelOrder = async (orderId: number) => {
    try {
      setError(null);
      await cancelPurchaseOrder(sessionToken, orderId);
      setSuccessBanner(null);
      await loadData();
      if (selectedDetail && selectedDetail.document_id === orderId) {
        const updated = await getPurchaseOrderDetail(sessionToken, orderId);
        setSelectedDetail(updated);
      }
    } catch (err: unknown) {
      setError(errorText(err));
    }
  };

  const viewDetail = async (orderId: number) => {
    try {
      setError(null);
      const detail = await getPurchaseOrderDetail(sessionToken, orderId);
      setSelectedDetail(detail);
    } catch (err: unknown) {
      setError(errorText(err));
    }
  };

  const editDraft = async (orderId: number) => {
    try {
      setError(null);
      setSuccessBanner(null);
      const draft = await getPurchaseOrderDetail(sessionToken, orderId);
      if (draft.status !== 'DRAFT') return;
      setEditingPurchaseOrderId(draft.document_id);
      setSupplierId(draft.supplier_id);
      setWarehouseId(draft.warehouse_id);
      setNote(draft.note ?? '');
      setLines(draft.lines.map((line) => ({
        variant_id: line.variant_id,
        unit_id: line.unit_id,
        quantity_ordered: line.quantity_ordered,
        unit_cost: line.unit_cost,
      })));
      setLineErrors({});
      setShowCreateForm(true);
    } catch (err: unknown) {
      setError(errorText(err));
    }
  };

  const openReceiptModal = async (orderId: number) => {
    try {
      setError(null);
      const detail = await getPurchaseOrderDetail(sessionToken, orderId);
      setReceiptPoDetail(detail);
    } catch (err: unknown) {
      setError(errorText(err));
    }
  };

  const handleReceiptSuccess = async (result: ConfirmPurchaseReceiptResult) => {
    setReceiptPoDetail(null);
    setSuccessBanner(`Goods receipt recorded successfully! Receipt #: ${result.document_number}`);
    await loadData();
    if (selectedDetail && selectedDetail.document_id === result.purchase_order_id) {
      const updated = await getPurchaseOrderDetail(sessionToken, result.purchase_order_id);
      setSelectedDetail(updated);
    }
  };

  const handleLandedCostSuccess = async (result: AllocateLandedCostResult) => {
    setLandedCostResult(result);
    setLandedCostReceipt(null);
    setSuccessBanner(text.landedCostPosted);
    try {
      await loadData();
    } catch {
      // The posting result is already confirmed. A refresh failure must not
      // make the operator repeat the financial operation with a new request.
    }
  };

  return (
    <div className="sk-screen">
      <header className="sk-screen__header">
        <h1>{t('nav.purchaseOrders')}</h1>
        <button
          type="button"
          className="sk-button sk-button--primary"
          onClick={() => {
            setSuccessBanner(null);
            setEditingPurchaseOrderId(null);
            setLineErrors({});
            setShowCreateForm(true);
            if (lines.length === 0) addLine();
          }}
          data-testid="create-po-btn"
        >
          {text.newPurchase}
        </button>
      </header>

      {successBanner && (
        <div className="sk-banner sk-banner--success" data-testid="po-success-banner">
          {successBanner}
        </div>
      )}

      {error && (
        <div className="sk-banner sk-banner--error" data-testid="po-error">
          {error}
        </div>
      )}

      {showCreateForm && (
        <form className="sk-card sk-form" onSubmit={handleCreateOrder} data-testid="create-po-form">
          <h2>{editingPurchaseOrderId === null ? text.newPurchase : 'Edit purchase draft'}</h2>
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

          <h3>{text.orderLines}</h3>
          <table className="sk-table" data-testid="po-lines-input-table">
            <thead>
              <tr>
                <th>{text.product}</th>
                <th>{text.unit}</th>
                <th>{text.quantity}</th>
                <th>{text.unitCost} (DZD)</th>
                <th>{text.total}</th>
                <th>{text.actions}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, idx) => (
                <tr key={idx}>
                  <td>
                    <select
                      value={line.variant_id}
                      onChange={(e) => {
                        const variantId = parseInt(e.target.value, 10);
                        const product = products.find((item) => item.variant_id === variantId);
                        updateLine(idx, {
                          ...line,
                          variant_id: variantId,
                          unit_id: product?.default_unit_id ?? line.unit_id,
                        });
                      }}
                    >
                      {products.map((p) => (
                        <option key={p.variant_id} value={p.variant_id}>
                          {p.sku} — {p.product_name}{p.variant_name ? ` — ${p.variant_name}` : ''}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      value={line.unit_id}
                      onChange={(e) => updateLine(idx, { ...line, unit_id: parseInt(e.target.value, 10) })}
                      aria-invalid={Boolean(lineErrors[idx]?.unit)}
                      aria-describedby={lineErrors[idx]?.unit ? `purchase-line-${idx}-unit-error` : undefined}
                    >
                      {(() => {
                        const product = products.find((item) => item.variant_id === line.variant_id);
                        if (!product) return <option value="">Choose a product first</option>;
                        return <>
                          <option value={product.default_unit_id}>{product.default_unit_code}</option>
                          {product.alternate_units.map((unit) => (
                            <option key={unit.unit_id} value={unit.unit_id}>
                              {unit.unit_code} (x{unit.conversion_factor})
                            </option>
                          ))}
                        </>;
                      })()}
                    </select>
                    {lineErrors[idx]?.unit && <small id={`purchase-line-${idx}-unit-error`} className="sk-field-error">{lineErrors[idx].unit}</small>}
                  </td>
                  <td>
                    <input
                      type="text"
                      inputMode="decimal"
                      className="sk-input-small"
                      value={line.quantity_ordered}
                      onChange={(e) => updateLine(idx, { ...line, quantity_ordered: e.target.value })}
                      aria-invalid={Boolean(lineErrors[idx]?.quantity)}
                      aria-describedby={lineErrors[idx]?.quantity ? `purchase-line-${idx}-quantity-error` : undefined}
                    />
                    {lineErrors[idx]?.quantity && <small id={`purchase-line-${idx}-quantity-error`} className="sk-field-error">{lineErrors[idx].quantity}</small>}
                  </td>
                  <td>
                    <input
                      type="text"
                      inputMode="decimal"
                      className="sk-input-small"
                      value={line.unit_cost}
                      onChange={(e) => updateLine(idx, { ...line, unit_cost: e.target.value })}
                      aria-invalid={Boolean(lineErrors[idx]?.unitCost)}
                      aria-describedby={lineErrors[idx]?.unitCost ? `purchase-line-${idx}-cost-error` : undefined}
                    />
                    {lineErrors[idx]?.unitCost && <small id={`purchase-line-${idx}-cost-error`} className="sk-field-error">{lineErrors[idx].unitCost}</small>}
                  </td>
                  <td>
                    {multiplyExactDecimals(line.quantity_ordered, line.unit_cost)} DZD
                  </td>
                  <td>
                    <button
                      type="button"
                      className="sk-button sk-button--small sk-button--danger"
                      onClick={() => removeLine(idx)}
                    >
                      {text.remove}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ marginTop: '0.5rem', marginBottom: '1rem' }}>
            <button
              type="button"
              className="sk-button sk-button--secondary sk-button--small"
              onClick={addLine}
              data-testid="add-po-line-btn"
            >
              + {text.addLine}
            </button>
            <span style={{ marginLeft: '1rem', fontWeight: 'bold' }}>
              {text.subtotalPreview}: {calculateSubtotal()} DZD
            </span>
          </div>

          <div className="sk-form-actions">
            <button
              type="button"
              className="sk-button sk-button--secondary"
              onClick={() => { setShowCreateForm(false); setEditingPurchaseOrderId(null); setLineErrors({}); }}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="sk-button sk-button--primary"
              onClick={handleConfirmDirectPurchase}
              data-testid="confirm-direct-purchase-btn"
            >
              {text.confirmPurchase}
            </button>
            <button type="submit" className="sk-button sk-button--secondary" data-testid="save-po-draft-btn">
              {editingPurchaseOrderId === null ? text.saveDraft : 'Update draft'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div>{t('common.loading')}</div>
      ) : (
        <div className="sk-card">
          <table className="sk-table" data-testid="po-table">
            <thead>
              <tr>
                <th>{text.poNumber}</th>
                <th>{text.supplier}</th>
                <th>{text.warehouse}</th>
                <th>{text.status}</th>
                <th>{text.total}</th>
                <th>{text.created}</th>
                <th>{text.actions}</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={7}>{t('common.none')}</td>
                </tr>
              ) : (
                orders.map((po) => (
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
                            : 'sk-badge--secondary'
                        }`}
                      >
                        {po.status}
                      </span>
                    </td>
                    <td>{po.total_amount} DZD</td>
                    <td>{new Date(po.created_at).toLocaleDateString()}</td>
                    <td>
                      <button
                        type="button"
                        className="sk-button sk-button--small"
                        onClick={() => viewDetail(po.document_id)}
                        data-testid={`view-po-${po.document_id}`}
                      >
                        {text.view}
                      </button>{' '}
                      {po.status === 'DRAFT' && (
                        <><button
                          type="button"
                          className="sk-button sk-button--small"
                          onClick={() => editDraft(po.document_id)}
                          data-testid={`edit-po-${po.document_id}`}
                        >
                          {text.edit}
                        </button>{' '}<button
                          type="button"
                          className="sk-button sk-button--small sk-button--primary"
                          onClick={() => handleConfirmOrder(po.document_id)}
                          data-testid={`confirm-po-${po.document_id}`}
                        >
                          {text.confirmOrder}
                        </button></>
                      )}{' '}
                      {capabilities.can_post_purchase_receipt
                        && (po.status === 'CONFIRMED' || po.status === 'PARTIALLY_RECEIVED') && (
                        <button
                          type="button"
                          className="sk-button sk-button--small sk-button--success"
                          onClick={() => openReceiptModal(po.document_id)}
                          data-testid={`receive-po-${po.document_id}`}
                        >
                          {text.receiveGoods}
                        </button>
                      )}{' '}
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
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {landedCostResult ? (
        <section className="sk-card" data-testid="landed-cost-result">
          <h2>{text.landedCostPosted}</h2>
          <div className="sk-cards">
            <div className="sk-metric"><span className="sk-metric__label">{text.receipt}</span><strong className="sk-metric__value">{landedCostResult.receipt_id}</strong></div>
            <div className="sk-metric"><span className="sk-metric__label">{text.amount}</span><strong className="sk-metric__value">{landedCostResult.landed_cost_amount} DZD</strong></div>
            <div className="sk-metric"><span className="sk-metric__label">{text.journal}</span><strong className="sk-metric__value">{landedCostResult.journal_document_id}</strong></div>
          </div>
        </section>
      ) : null}

      <section className="sk-card">
        <h2>{text.receiptsTitle}</h2>
        {receipts.length === 0 ? (
          <p className="sk-muted">{text.noReceipts}</p>
        ) : (
          <div className="sk-table-wrap">
            <table className="sk-table" data-testid="purchase-receipts-table">
              <thead>
                <tr>
                  <th>{text.receipt}</th>
                  <th>{text.purchaseOrder}</th>
                  <th>{text.supplier}</th>
                  <th>{text.total}</th>
                  <th>{text.receiptJournal}</th>
                  <th>{text.landedCost}</th>
                  <th>{text.actions}</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((receipt) => (
                  <tr key={receipt.document_id}>
                    <td><strong>{receipt.document_number}</strong></td>
                    <td>{receipt.purchase_order_number ?? (receipt.receipt_origin === 'DIRECT_PURCHASE' ? 'Direct Purchase' : '—')}</td>
                    <td>{receipt.supplier_name}</td>
                    <td className="sk-num">{receipt.total_amount} DZD</td>
                    <td>{receipt.journal_document_number ?? receipt.journal_document_id ?? '—'}</td>
                    <td className="sk-num">
                      {receipt.landed_cost_amount ? `${receipt.landed_cost_amount} DZD` : '—'}
                    </td>
                    <td>
                      {capabilities.can_post_supplier_invoice && openFiscalPeriodId && !receipt.landed_cost_amount ? (
                        <button
                          type="button"
                          className="sk-button sk-button--small sk-button--secondary"
                          onClick={() => setLandedCostReceipt(receipt)}
                          data-testid={`allocate-landed-cost-${receipt.document_id}`}
                        >
                          {text.allocateLandedCost}
                        </button>
                      ) : (
                        <span className="sk-muted">{receipt.landed_cost_amount ? text.alreadyAllocated : '—'}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedDetail && (
        <div className="sk-modal-overlay" data-testid="po-detail-modal">
          <div className="sk-modal-content sk-modal-content--large">
            <header className="sk-modal-header">
              <h2>
                {text.orderDetail}: {selectedDetail.document_number ?? `#${selectedDetail.document_id}`}
              </h2>
              <button type="button" className="sk-modal-close" onClick={() => setSelectedDetail(null)}>
                ×
              </button>
            </header>

            <div className="sk-form-grid" style={{ marginBottom: '1rem' }}>
              <div>
                <strong>{text.supplier}:</strong> {selectedDetail.supplier_name} ({selectedDetail.supplier_code})
              </div>
              <div>
                <strong>{text.warehouse}:</strong> {selectedDetail.warehouse_name}
              </div>
              <div>
                <strong>{text.status}:</strong> {selectedDetail.status}
              </div>
              <div>
                <strong>{text.total}:</strong> {selectedDetail.total_amount} DZD
              </div>
              {selectedDetail.note && (
                <div className="sk-grid-full">
                  <strong>{text.note}:</strong> {selectedDetail.note}
                </div>
              )}
            </div>

            <h3>Lines</h3>
            <table className="sk-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{text.code}</th>
                  <th>{text.product}</th>
                  <th>{text.ordered}</th>
                  <th>{text.received}</th>
                  <th>{text.remaining}</th>
                  <th>{text.unitCost}</th>
                  <th>{text.total}</th>
                </tr>
              </thead>
              <tbody>
                {selectedDetail.lines.map((l) => (
                  <tr key={l.id}>
                    <td>{l.line_number}</td>
                    <td>{l.variant_sku}</td>
                    <td>{l.variant_name}</td>
                    <td>
                      {l.quantity_ordered} {l.unit_code}
                    </td>
                    <td>{l.quantity_received}</td>
                    <td>
                      <strong>{l.remaining_quantity}</strong>
                    </td>
                    <td>{l.unit_cost} DZD</td>
                    <td>{l.line_total} DZD</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="sk-form-actions" style={{ marginTop: '1.5rem' }}>
              <button
                type="button"
                className="sk-button sk-button--secondary"
                onClick={() => setSelectedDetail(null)}
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {receiptPoDetail && (
        <PurchaseReceiptModal
          sessionToken={sessionToken}
          poDetail={receiptPoDetail}
          onClose={() => setReceiptPoDetail(null)}
          onSuccess={handleReceiptSuccess}
        />
      )}

      {landedCostReceipt && (
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
