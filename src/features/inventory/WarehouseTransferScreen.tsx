import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { useSession } from '../../shared/session/SessionContext';
import * as ipc from '../../shared/ipc/gateway';
import type { WarehouseTransferDto, Warehouse, ProductListItem } from '../../shared/ipc/dto';

export function WarehouseTransferScreen() {
  const { user } = useSession();
  const token = user?.token ?? '';

  const [transfers, setTransfers] = useState<WarehouseTransferDto[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<ProductListItem[]>([]);

  const [fromWarehouseId, setFromWarehouseId] = useState<number | ''>('');
  const [toWarehouseId, setToWarehouseId] = useState<number | ''>('');
  const [selectedVariantId, setSelectedVariantId] = useState<number | ''>('');
  const [quantity, setQuantity] = useState('1');
  const [note, setNote] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);

  const loadData = useCallback(async () => {
    if (!token) return;
    try {
      const [list, whs] = await Promise.all([
        ipc.listWarehouseTransfers(token),
        ipc.listWarehouses(token),
      ]);
      setTransfers(list);
      setWarehouses(whs);

      const sourceId = fromWarehouseId !== '' ? Number(fromWarehouseId) : whs[0]?.id;
      if (sourceId) {
        const prods = await ipc.listProducts(token, sourceId);
        setProducts(prods);
      }

      if (whs.length >= 2 && fromWarehouseId === '') {
        setFromWarehouseId(whs[0].id);
        setToWarehouseId(whs[1].id);
      }
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to load transfer data.');
    }
  }, [token, fromWarehouseId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || !fromWarehouseId || !toWarehouseId || !selectedVariantId || !quantity) return;
    if (fromWarehouseId === toWarehouseId) {
      setError('Source and Destination warehouses must be different.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const today = new Date().toISOString().split('T')[0];
      await ipc.confirmWarehouseTransfer(token, {
        request_id: crypto.randomUUID(),
        from_warehouse_id: Number(fromWarehouseId),
        to_warehouse_id: Number(toWarehouseId),
        fiscal_period_id: 1, // Active open period
        document_date: today,
        lines: [
          {
            variant_id: Number(selectedVariantId),
            quantity,
          },
        ],
        note: note || undefined,
      });

      setShowModal(false);
      setQuantity('1');
      setNote('');
      await loadData();
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to process stock transfer.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="sk-page" style={{ padding: '24px', color: '#f8fafc' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.6rem' }}>Warehouse Stock Transfers</h1>
          <p style={{ margin: '4px 0 0 0', color: '#94a3b8', fontSize: '0.9rem' }}>
            Instantly move inventory between store locations.
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          style={{ padding: '10px 18px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }}
        >
          + New Stock Transfer
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
              <th style={{ padding: '12px 16px' }}>From (Source)</th>
              <th style={{ padding: '12px 16px' }}>To (Destination)</th>
              <th style={{ padding: '12px 16px' }}>Note</th>
              <th style={{ padding: '12px 16px' }}>Date & Time</th>
            </tr>
          </thead>
          <tbody>
            {transfers.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>
                  No stock transfers recorded yet.
                </td>
              </tr>
            ) : (
              transfers.map((t) => (
                <tr key={t.id} style={{ borderBottom: '1px solid #334155' }}>
                  <td style={{ padding: '12px 16px', fontWeight: 600, color: '#38bdf8' }}>{t.document_number}</td>
                  <td style={{ padding: '12px 16px', color: '#f87171' }}>{t.from_warehouse_name}</td>
                  <td style={{ padding: '12px 16px', color: '#34d399' }}>{t.to_warehouse_name}</td>
                  <td style={{ padding: '12px 16px', color: '#cbd5e1' }}>{t.note || '—'}</td>
                  <td style={{ padding: '12px 16px', color: '#94a3b8', fontSize: '0.85rem' }}>{t.created_at}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ backgroundColor: '#1e293b', borderRadius: '8px', padding: '24px', maxWidth: '480px', width: '100%', border: '1px solid #334155' }}>
            <h3 style={{ marginTop: 0, color: '#f8fafc' }}>Process 1-Step Stock Transfer</h3>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '4px' }}>From Warehouse (Source)</label>
                <select
                  value={fromWarehouseId}
                  onChange={(e) => setFromWarehouseId(Number(e.target.value))}
                  required
                  style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #475569', backgroundColor: '#0f172a', color: '#fff' }}
                >
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>{w.name} ({w.code})</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '4px' }}>To Warehouse (Destination)</label>
                <select
                  value={toWarehouseId}
                  onChange={(e) => setToWarehouseId(Number(e.target.value))}
                  required
                  style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #475569', backgroundColor: '#0f172a', color: '#fff' }}
                >
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>{w.name} ({w.code})</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '4px' }}>Product</label>
                <select
                  value={selectedVariantId}
                  onChange={(e) => setSelectedVariantId(Number(e.target.value))}
                  required
                  style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #475569', backgroundColor: '#0f172a', color: '#fff' }}
                >
                  <option value="">-- Select Product --</option>
                  {products.map((p) => (
                    <option key={p.variant_id} value={p.variant_id}>{p.name} ({p.sku}) — Stock: {p.quantity_on_hand}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '4px' }}>Transfer Quantity</label>
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
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '4px' }}>Note / Reason</label>
                <input
                  type="text"
                  placeholder="Optional note"
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
                  style={{ padding: '8px 16px', borderRadius: '4px', border: 'none', backgroundColor: '#2563eb', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
                  {busy ? 'Transferring…' : 'Confirm Transfer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
