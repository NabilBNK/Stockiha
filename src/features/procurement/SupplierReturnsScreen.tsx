import React, { useEffect, useState, useCallback } from 'react';
import { listSupplierReturns, createSupplierReturnDraft, confirmSupplierReturn } from '../../shared/ipc/gateway';
import type { SupplierReturnSummary } from '../../shared/ipc/dto';

interface SupplierReturnsScreenProps {
  sessionToken: string;
}

export const SupplierReturnsScreen: React.FC<SupplierReturnsScreenProps> = ({ sessionToken }) => {
  const [returns, setReturns] = useState<SupplierReturnSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form State
  const [supplierId, setSupplierId] = useState(1);
  const [warehouseId, setWarehouseId] = useState(1);
  const [purchaseOrderId, setPurchaseOrderId] = useState<number | ''>('');
  const [reasonCode, setReasonCode] = useState('DEFECTIVE_GOODS');
  const [note, setNote] = useState('');
  const [variantId, setVariantId] = useState(1);
  const [quantity, setQuantity] = useState('1.00');
  const [unitCost, setUnitCost] = useState('100.00');

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await listSupplierReturns(sessionToken);
      setReturns(res);
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to load supplier returns.');
    } finally {
      setLoading(false);
    }
  }, [sessionToken]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await createSupplierReturnDraft(sessionToken, {
        supplier_id: supplierId,
        warehouse_id: warehouseId,
        purchase_order_id: purchaseOrderId !== '' ? Number(purchaseOrderId) : null,
        reason_code: reasonCode,
        note: note.trim() || null,
        lines: [
          {
            variant_id: variantId,
            quantity,
            unit_cost: unitCost,
          },
        ],
      });
      setShowCreateModal(false);
      loadData();
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to create return draft.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmReturn = async (returnDocId: number) => {
    setError(null);
    setSubmitting(true);
    try {
      await confirmSupplierReturn(sessionToken, {
        request_id: crypto.randomUUID(),
        return_document_id: returnDocId,
        fiscal_period_id: 1,
        document_date: new Date().toISOString().split('T')[0],
      });
      loadData();
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to confirm supplier return.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ padding: '24px', color: '#f8fafc' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h2 style={{ margin: 0 }}>Supplier Returns & Debit Notes</h2>
          <div style={{ fontSize: '14px', color: '#94a3b8', marginTop: '4px' }}>
            Goods returns to suppliers and debit note issuance
          </div>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={loadData}
            style={{ padding: '8px 16px', borderRadius: '4px', border: '1px solid #475569', backgroundColor: '#1e293b', color: '#fff', cursor: 'pointer' }}
          >
            Refresh
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            style={{ padding: '8px 16px', borderRadius: '4px', border: 'none', backgroundColor: '#2563eb', color: '#fff', fontWeight: 500, cursor: 'pointer' }}
          >
            + New Return Draft
          </button>
        </div>
      </div>

      {error && (
        <div style={{ backgroundColor: '#7f1d1d', color: '#fecaca', padding: '12px', borderRadius: '6px', marginBottom: '16px' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div>Loading supplier returns…</div>
      ) : returns.length === 0 ? (
        <div style={{ padding: '32px', textAlign: 'center', backgroundColor: '#1e293b', borderRadius: '8px' }}>
          No supplier return records found.
        </div>
      ) : (
        <div style={{ overflowX: 'auto', backgroundColor: '#1e293b', borderRadius: '8px', border: '1px solid #334155' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155', backgroundColor: '#0f172a' }}>
                <th style={{ padding: '12px' }}>Document #</th>
                <th style={{ padding: '12px' }}>Supplier</th>
                <th style={{ padding: '12px' }}>Reason</th>
                <th style={{ padding: '12px' }}>Status</th>
                <th style={{ padding: '12px' }}>Created At</th>
                <th style={{ padding: '12px' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {returns.map((r) => (
                <tr key={r.document_id} style={{ borderBottom: '1px solid #334155' }}>
                  <td style={{ padding: '12px', fontWeight: 600 }}>{r.document_number || `Draft #${r.document_id}`}</td>
                  <td style={{ padding: '12px' }}>{r.supplier_name}</td>
                  <td style={{ padding: '12px' }}>{r.reason_code}</td>
                  <td style={{ padding: '12px' }}>
                    <span style={{
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      backgroundColor: r.status === 'POSTED' ? '#065f46' : '#9a3412',
                      color: r.status === 'POSTED' ? '#34d399' : '#fdba74'
                    }}>
                      {r.status}
                    </span>
                  </td>
                  <td style={{ padding: '12px' }}>{new Date(r.created_at).toLocaleString()}</td>
                  <td style={{ padding: '12px' }}>
                    {r.status === 'DRAFT' && (
                      <button
                        onClick={() => handleConfirmReturn(r.document_id)}
                        disabled={submitting}
                        style={{ padding: '6px 12px', borderRadius: '4px', border: 'none', backgroundColor: '#059669', color: '#fff', fontSize: '0.85rem', cursor: 'pointer' }}
                      >
                        Confirm Return
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreateModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ backgroundColor: '#1e293b', borderRadius: '8px', padding: '24px', maxWidth: '500px', width: '100%', border: '1px solid #334155' }}>
            <h3 style={{ marginTop: 0 }}>Create Supplier Return Draft</h3>
            <form onSubmit={handleCreateDraft} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px' }}>Supplier ID</label>
                <input
                  type="number"
                  required
                  value={supplierId}
                  onChange={(e) => setSupplierId(Number(e.target.value))}
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #475569', backgroundColor: '#0f172a', color: '#fff' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px' }}>Warehouse ID</label>
                <input
                  type="number"
                  required
                  value={warehouseId}
                  onChange={(e) => setWarehouseId(Number(e.target.value))}
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #475569', backgroundColor: '#0f172a', color: '#fff' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px' }}>Purchase Order ID (Optional)</label>
                <input
                  type="number"
                  placeholder="e.g. 1"
                  value={purchaseOrderId}
                  onChange={(e) => setPurchaseOrderId(e.target.value !== '' ? Number(e.target.value) : '')}
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #475569', backgroundColor: '#0f172a', color: '#fff' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px' }}>Reason Code</label>
                <select
                  value={reasonCode}
                  onChange={(e) => setReasonCode(e.target.value)}
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #475569', backgroundColor: '#0f172a', color: '#fff' }}
                >
                  <option value="DEFECTIVE_GOODS">Defective / Damaged Goods</option>
                  <option value="EXCESS_DELIVERY">Excess Delivery</option>
                  <option value="WRONG_ITEM">Wrong Item Shipped</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px' }}>Note / Reference</label>
                <input
                  type="text"
                  placeholder="e.g. Defective batch return"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #475569', backgroundColor: '#0f172a', color: '#fff' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px' }}>Variant ID</label>
                <input
                  type="number"
                  required
                  value={variantId}
                  onChange={(e) => setVariantId(Number(e.target.value))}
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #475569', backgroundColor: '#0f172a', color: '#fff' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px' }}>Quantity</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #475569', backgroundColor: '#0f172a', color: '#fff' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px' }}>Unit Cost (DZD)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={unitCost}
                    onChange={(e) => setUnitCost(e.target.value)}
                    style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #475569', backgroundColor: '#0f172a', color: '#fff' }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '16px' }}>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  disabled={submitting}
                  style={{ padding: '8px 16px', borderRadius: '4px', border: '1px solid #475569', backgroundColor: 'transparent', color: '#fff', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  style={{ padding: '8px 16px', borderRadius: '4px', border: 'none', backgroundColor: '#2563eb', color: '#fff', cursor: 'pointer' }}
                >
                  Save Draft
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
