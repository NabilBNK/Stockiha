import { useEffect, useState } from 'react';
import {
  cancelPurchaseOrder,
  confirmPurchaseOrder,
  createPurchaseOrderDraft,
  getPurchaseOrderDetail,
  listProducts,
  listPurchaseOrders,
  listSuppliers,
  listUnits,
  listWarehouses,
} from '../../shared/ipc/gateway';
import type {
  ConfirmPurchaseReceiptResult,
  CreatePoLinePayload,
  ProductListItem,
  PurchaseOrderDetailDto,
  PurchaseOrderSummary,
  Supplier,
  Unit,
  Warehouse,
} from '../../shared/ipc/dto';
import { useI18n } from '../../shared/i18n';
import PurchaseReceiptModal from './PurchaseReceiptModal';

interface Props {
  sessionToken: string;
}

export default function PurchaseOrdersScreen({ sessionToken }: Props) {
  const { t } = useI18n();
  const [orders, setOrders] = useState<PurchaseOrderSummary[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedDetail, setSelectedDetail] = useState<PurchaseOrderDetailDto | null>(null);
  const [receiptPoDetail, setReceiptPoDetail] = useState<PurchaseOrderDetailDto | null>(null);

  // Form state
  const [supplierId, setSupplierId] = useState<number>(0);
  const [warehouseId, setWarehouseId] = useState<number>(0);
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<CreatePoLinePayload[]>([]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [posData, suppsData, whsData, prodsData, unitsData] = await Promise.all([
        listPurchaseOrders(sessionToken),
        listSuppliers(sessionToken),
        listWarehouses(sessionToken),
        listProducts(sessionToken, warehouseId || 1),
        listUnits(sessionToken),
      ]);
      setOrders(posData);
      setSuppliers(suppsData);
      setWarehouses(whsData);
      setProducts(prodsData);
      setUnits(unitsData);

      if (suppsData.length > 0 && supplierId === 0) {
        setSupplierId(suppsData[0].id);
      }
      if (whsData.length > 0 && warehouseId === 0) {
        setWarehouseId(whsData[0].id);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load procurement data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [sessionToken]);

  const addLine = () => {
    if (products.length === 0 || units.length === 0) return;
    setLines([
      ...lines,
      {
        variant_id: products[0].variant_id,
        unit_id: units[0].id,
        quantity_ordered: '10.000',
        unit_cost: products[0].sale_price || '100.00',
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
  };

  const calculateSubtotal = () => {
    return lines
      .reduce((sum, l) => {
        const qty = parseFloat(l.quantity_ordered) || 0;
        const cost = parseFloat(l.unit_cost) || 0;
        return sum + qty * cost;
      }, 0)
      .toFixed(2);
  };

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (supplierId <= 0 || warehouseId <= 0 || lines.length === 0) {
      setError('Please select a supplier, warehouse, and add at least one line.');
      return;
    }

    try {
      setError(null);
      await createPurchaseOrderDraft(sessionToken, {
        supplier_id: supplierId,
        warehouse_id: warehouseId,
        note: note || null,
        lines,
      });
      setShowCreateForm(false);
      setLines([]);
      setNote('');
      setSuccessBanner('Purchase order draft created successfully.');
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create purchase order');
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
      setError(err instanceof Error ? err.message : 'Failed to confirm purchase order');
    }
  };

  const handleCancelOrder = async (orderId: number) => {
    try {
      setError(null);
      await cancelPurchaseOrder(sessionToken, orderId);
      setSuccessBanner(`Purchase Order cancelled.`);
      await loadData();
      if (selectedDetail && selectedDetail.document_id === orderId) {
        const updated = await getPurchaseOrderDetail(sessionToken, orderId);
        setSelectedDetail(updated);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to cancel purchase order');
    }
  };

  const viewDetail = async (orderId: number) => {
    try {
      setError(null);
      const detail = await getPurchaseOrderDetail(sessionToken, orderId);
      setSelectedDetail(detail);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load PO details');
    }
  };

  const openReceiptModal = async (orderId: number) => {
    try {
      setError(null);
      const detail = await getPurchaseOrderDetail(sessionToken, orderId);
      setReceiptPoDetail(detail);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load PO details for receipt');
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

  return (
    <div className="sk-screen">
      <header className="sk-screen__header">
        <h1>{t('nav.purchaseOrders')}</h1>
        <button
          type="button"
          className="sk-button sk-button--primary"
          onClick={() => {
            setShowCreateForm(true);
            if (lines.length === 0) addLine();
          }}
          data-testid="create-po-btn"
        >
          New Purchase Order
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
          <h2>Create Purchase Order (Draft)</h2>
          <div className="sk-form-grid">
            <label>
              Supplier *
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
              Destination Warehouse *
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

            <label className="sk-grid-full">
              Note
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional PO notes"
              />
            </label>
          </div>

          <h3>Order Lines</h3>
          <table className="sk-table" data-testid="po-lines-input-table">
            <thead>
              <tr>
                <th>Product / Variant</th>
                <th>Unit</th>
                <th>Quantity</th>
                <th>Unit Cost (DZD)</th>
                <th>Total</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, idx) => (
                <tr key={idx}>
                  <td>
                    <select
                      value={line.variant_id}
                      onChange={(e) =>
                        updateLine(idx, { ...line, variant_id: parseInt(e.target.value, 10) })
                      }
                    >
                      {products.map((p) => (
                        <option key={p.variant_id} value={p.variant_id}>
                          {p.sku} — {p.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      value={line.unit_id}
                      onChange={(e) => updateLine(idx, { ...line, unit_id: parseInt(e.target.value, 10) })}
                    >
                      {units.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.code}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="text"
                      className="sk-input-small"
                      value={line.quantity_ordered}
                      onChange={(e) => updateLine(idx, { ...line, quantity_ordered: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      className="sk-input-small"
                      value={line.unit_cost}
                      onChange={(e) => updateLine(idx, { ...line, unit_cost: e.target.value })}
                    />
                  </td>
                  <td>
                    {(
                      (parseFloat(line.quantity_ordered) || 0) * (parseFloat(line.unit_cost) || 0)
                    ).toFixed(2)}{' '}
                    DZD
                  </td>
                  <td>
                    <button
                      type="button"
                      className="sk-button sk-button--small sk-button--danger"
                      onClick={() => removeLine(idx)}
                    >
                      Remove
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
              + Add Line
            </button>
            <span style={{ marginLeft: '1rem', fontWeight: 'bold' }}>
              Subtotal Preview: {calculateSubtotal()} DZD
            </span>
          </div>

          <div className="sk-form-actions">
            <button
              type="button"
              className="sk-button sk-button--secondary"
              onClick={() => setShowCreateForm(false)}
            >
              {t('common.cancel')}
            </button>
            <button type="submit" className="sk-button sk-button--primary" data-testid="save-po-draft-btn">
              Save Draft PO
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
                <th>PO Number</th>
                <th>Supplier</th>
                <th>Warehouse</th>
                <th>Status</th>
                <th>Total Amount</th>
                <th>Created</th>
                <th>Actions</th>
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
                        View
                      </button>{' '}
                      {po.status === 'DRAFT' && (
                        <button
                          type="button"
                          className="sk-button sk-button--small sk-button--primary"
                          onClick={() => handleConfirmOrder(po.document_id)}
                          data-testid={`confirm-po-${po.document_id}`}
                        >
                          Confirm
                        </button>
                      )}{' '}
                      {(po.status === 'CONFIRMED' || po.status === 'PARTIALLY_RECEIVED') && (
                        <button
                          type="button"
                          className="sk-button sk-button--small sk-button--success"
                          onClick={() => openReceiptModal(po.document_id)}
                          data-testid={`receive-po-${po.document_id}`}
                        >
                          Receive Goods
                        </button>
                      )}{' '}
                      {po.status !== 'RECEIVED' && po.status !== 'CANCELLED' && (
                        <button
                          type="button"
                          className="sk-button sk-button--small sk-button--danger"
                          onClick={() => handleCancelOrder(po.document_id)}
                          data-testid={`cancel-po-${po.document_id}`}
                        >
                          Cancel
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

      {selectedDetail && (
        <div className="sk-modal-overlay" data-testid="po-detail-modal">
          <div className="sk-modal-content sk-modal-content--large">
            <header className="sk-modal-header">
              <h2>
                Purchase Order Detail: {selectedDetail.document_number ?? `Draft #${selectedDetail.document_id}`}
              </h2>
              <button type="button" className="sk-modal-close" onClick={() => setSelectedDetail(null)}>
                ×
              </button>
            </header>

            <div className="sk-form-grid" style={{ marginBottom: '1rem' }}>
              <div>
                <strong>Supplier:</strong> {selectedDetail.supplier_name} ({selectedDetail.supplier_code})
              </div>
              <div>
                <strong>Warehouse:</strong> {selectedDetail.warehouse_name}
              </div>
              <div>
                <strong>Status:</strong> {selectedDetail.status}
              </div>
              <div>
                <strong>Total:</strong> {selectedDetail.total_amount} DZD
              </div>
              {selectedDetail.note && (
                <div className="sk-grid-full">
                  <strong>Note:</strong> {selectedDetail.note}
                </div>
              )}
            </div>

            <h3>Lines</h3>
            <table className="sk-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Variant SKU</th>
                  <th>Variant Name</th>
                  <th>Ordered</th>
                  <th>Received</th>
                  <th>Remaining</th>
                  <th>Unit Cost</th>
                  <th>Total</th>
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
    </div>
  );
}
