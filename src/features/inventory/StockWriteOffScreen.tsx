import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { useSession } from '../../shared/session/SessionContext';
import * as ipc from '../../shared/ipc/gateway';
import type { StockWriteOffDto, Warehouse, ProductListItem } from '../../shared/ipc/dto';

const REASON_CODES = [
  { code: 'DAMAGED', label: 'Damaged Goods' },
  { code: 'EXPIRED', label: 'Expired Product' },
  { code: 'DEFECTIVE', label: 'Factory Defect' },
  { code: 'STOLEN', label: 'Stolen / Shrinkage' },
  { code: 'OTHER', label: 'Other Reason' },
];

export function StockWriteOffScreen() {
  const { user } = useSession();
  const token = user?.token ?? '';

  const [writeOffs, setWriteOffs] = useState<StockWriteOffDto[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<ProductListItem[]>([]);

  const [warehouseId, setWarehouseId] = useState<number | ''>('');
  const [reasonCode, setReasonCode] = useState('DAMAGED');
  const [selectedVariantId, setSelectedVariantId] = useState<number | ''>('');
  const [quantity, setQuantity] = useState('1');
  const [unitCost, setUnitCost] = useState('0');
  const [note, setNote] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);

  const loadData = useCallback(async () => {
    if (!token) return;
    try {
      const [list, whs] = await Promise.all([
        ipc.listStockWriteOffs(token),
        ipc.listWarehouses(token),
      ]);
      setWriteOffs(list);
      setWarehouses(whs);

      const targetWh = warehouseId !== '' ? Number(warehouseId) : whs[0]?.id;
      if (targetWh) {
        const prods = await ipc.listProducts(token, targetWh);
        setProducts(prods);
      }

      if (whs.length > 0 && warehouseId === '') {
        setWarehouseId(whs[0].id);
      }
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to load write-off data.');
    }
  }, [token, warehouseId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || !warehouseId || !selectedVariantId || !quantity) return;

    setBusy(true);
    setError(null);
    try {
      const today = new Date().toISOString().split('T')[0];
      await ipc.confirmStockWriteOff(token, {
        request_id: crypto.randomUUID(),
        warehouse_id: Number(warehouseId),
        reason_code: reasonCode as 'DAMAGED' | 'EXPIRED' | 'DEFECTIVE' | 'STOLEN' | 'OTHER',
        fiscal_period_id: 1, // Active open period
        document_date: today,
        lines: [
          {
            variant_id: Number(selectedVariantId),
            quantity,
            unit_cost: unitCost || '0',
          },
        ],
        note: note || undefined,
      });

      setShowModal(false);
      setQuantity('1');
      setUnitCost('0');
      setNote('');
      await loadData();
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to confirm stock write-off.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="sk-page" style={{ padding: '24px', color: '#f8fafc' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.6rem' }}>Damaged Stock Write-Offs</h1>
          <p style={{ margin: '4px 0 0 0', color: '#94a3b8', fontSize: '0.9rem' }}>
            Record damaged, expired, or defective inventory loss.
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          style={{ padding: '10px 18px', backgroundColor: '#dc2626', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }}
        >
          + Record Stock Write-Off
        </button>
      </div>

      {error && (
        <div style={{ backgroundColor: '#7f1d1d', color: '#fecaca', padding: '12px', borderRadius: '6px', marginBottom: '16px' }}>
          {error}
        </div>
      )}

      <div style={{ backgroundColor: '#1e293b', borderRadius: '8px', border: '1px solid #334155', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ backgroundColor: '#0f172a', borderBottom: '1px solid #334155', color: '#94a3b8', fontSize: '0.85rem' }}>
              <th style={{ padding: '12px 16px' }}>Document #</th>
              <th style={{ padding: '12px 16px' }}>Warehouse</th>
              <th style={{ padding: '12px 16px' }}>Reason</th>
              <th style={{ padding: '12px 16px' }}>Total Cost Loss</th>
              <th style={{ padding: '12px 16px' }}>Note</th>
              <th style={{ padding: '12px 16px' }}>Date</th>
            </tr>
          </thead>
          <tbody>
            {writeOffs.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>
                  No stock write-offs recorded yet.
                </td>
              </tr>
            ) : (
              writeOffs.map((w) => (
                <tr key={w.id} style={{ borderBottom: '1px solid #334155' }}>
                  <td style={{ padding: '12px 16px', fontWeight: 600, color: '#f87171' }}>{w.document_number}</td>
                  <td style={{ padding: '12px 16px' }}>{w.warehouse_name}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ backgroundColor: '#7f1d1d', color: '#fecaca', padding: '2px 8px', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 600 }}>
                      {w.reason_code}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', fontWeight: 700, color: '#f87171' }}>{w.total_cost} DZD</td>
                  <td style={{ padding: '12px 16px', color: '#cbd5e1' }}>{w.note || '—'}</td>
                  <td style={{ padding: '12px 16px', color: '#94a3b8', fontSize: '0.85rem' }}>{w.created_at}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ backgroundColor: '#1e293b', borderRadius: '8px', padding: '24px', maxWidth: '480px', width: '100%', border: '1px solid #7f1d1d' }}>
            <h3 style={{ marginTop: 0, color: '#f87171' }}>Record Damaged Goods Write-Off</h3>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '4px' }}>Warehouse</label>
                <select
                  value={warehouseId}
                  onChange={(e) => setWarehouseId(Number(e.target.value))}
                  required
                  style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #475569', backgroundColor: '#0f172a', color: '#fff' }}
                >
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>{w.name} ({w.code})</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '4px' }}>Reason for Write-off</label>
                <select
                  value={reasonCode}
                  onChange={(e) => setReasonCode(e.target.value)}
                  required
                  style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #475569', backgroundColor: '#0f172a', color: '#fff' }}
                >
                  {REASON_CODES.map((r) => (
                    <option key={r.code} value={r.code}>{r.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '4px' }}>Product</label>
                <select
                  value={selectedVariantId}
                  onChange={(e) => {
                    const vId = Number(e.target.value);
                    setSelectedVariantId(vId);
                    const found = products.find((p) => p.variant_id === vId);
                    if (found) setUnitCost(found.last_known_wac || '0');

                  }}
                  required
                  style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #475569', backgroundColor: '#0f172a', color: '#fff' }}
                >
                  <option value="">-- Select Product --</option>
                  {products.map((p) => (
                    <option key={p.variant_id} value={p.variant_id}>{p.name} ({p.sku}) — Stock: {p.quantity_on_hand}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '4px' }}>Quantity Damaged</label>
                  <input
                    type="number"
                    min="0.001"
                    step="any"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    required
                    style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #475569', backgroundColor: '#0f172a', color: '#fff' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '4px' }}>Unit Cost (DZD)</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={unitCost}
                    onChange={(e) => setUnitCost(e.target.value)}
                    required
                    style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #475569', backgroundColor: '#0f172a', color: '#fff' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '4px' }}>Reason / Details</label>
                <input
                  type="text"
                  placeholder="Details about damage"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #475569', backgroundColor: '#0f172a', color: '#fff' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '10px' }}>
                <button type="button" onClick={() => setShowModal(false)} disabled={busy}
                  style={{ padding: '8px 16px', borderRadius: '4px', border: '1px solid #475569', backgroundColor: 'transparent', color: '#fff', cursor: 'pointer' }}>
                  Cancel
                </button>
                <button type="submit" disabled={busy}
                  style={{ padding: '8px 16px', borderRadius: '4px', border: 'none', backgroundColor: '#dc2626', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
                  {busy ? 'Processing…' : 'Confirm Write-Off'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
