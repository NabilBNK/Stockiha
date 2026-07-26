import { useState, useEffect, type FormEvent } from 'react';
import * as ipc from '../../shared/ipc/gateway';
import type { Customer, ProductListItem } from '../../shared/ipc/dto';

interface PosReturnModalProps {
  warehouseId: number;
  cashSessionId: number | null;
  sessionToken: string;
  onClose: () => void;
  onReturnConfirmed: () => void;
}

export function PosReturnModal({
  warehouseId,
  cashSessionId,
  sessionToken,
  onClose,
  onReturnConfirmed,
}: PosReturnModalProps) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<ProductListItem[]>([]);

  const [customerId, setCustomerId] = useState<number | ''>('');
  const [refundMethod, setRefundMethod] = useState<'CASH' | 'CREDIT_NOTE' | 'BANK_TRANSFER'>('CASH');
  const [selectedVariantId, setSelectedVariantId] = useState<number | ''>('');
  const [quantity, setQuantity] = useState('1');
  const [unitPrice, setUnitPrice] = useState('0');
  const [note, setNote] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        const [custs, prods] = await Promise.all([
          ipc.listCustomers(sessionToken),
          ipc.listProducts(sessionToken, warehouseId),
        ]);
        setCustomers(custs);
        setProducts(prods);
      } catch (err: unknown) {
        setError((err as Error)?.message || 'Failed to load options.');
      }
    }
    loadData();
  }, [sessionToken, warehouseId]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedVariantId || !quantity || !unitPrice) return;

    setBusy(true);
    setError(null);
    try {
      const today = new Date().toISOString().split('T')[0];
      await ipc.confirmCustomerReturn(sessionToken, {
        request_id: crypto.randomUUID(),
        customer_id: customerId ? Number(customerId) : undefined,
        cash_session_id: cashSessionId || undefined,
        warehouse_id: warehouseId,
        refund_method: refundMethod,
        fiscal_period_id: 1, // Active open period
        document_date: today,
        lines: [
          {
            variant_id: Number(selectedVariantId),
            quantity,
            unit_price: unitPrice,
          },
        ],
        note: note || undefined,
      });

      onReturnConfirmed();
      onClose();
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to confirm customer return.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}>
      <div style={{ backgroundColor: '#1e293b', borderRadius: '8px', padding: '24px', maxWidth: '480px', width: '100%', border: '1px solid #334155' }}>
        <h3 style={{ marginTop: 0, color: '#f8fafc' }}>Process Customer POS Return</h3>

        {error && (
          <div style={{ backgroundColor: '#7f1d1d', color: '#fecaca', padding: '10px', borderRadius: '6px', marginBottom: '14px', fontSize: '0.85rem' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '4px' }}>Customer (Optional for Walk-in)</label>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value ? Number(e.target.value) : '')}
              style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #475569', backgroundColor: '#0f172a', color: '#fff' }}
            >
              <option value="">-- Walk-in / Unregistered Customer --</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '4px' }}>Refund Payment Method</label>
            <select
              value={refundMethod}
              onChange={(e) => setRefundMethod(e.target.value as 'CASH' | 'CREDIT_NOTE' | 'BANK_TRANSFER')}
              required
              style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #475569', backgroundColor: '#0f172a', color: '#fff' }}
            >
              <option value="CASH">Cash Refund (Drawer Cash-out)</option>
              <option value="CREDIT_NOTE">Store Credit Note (Client Balance)</option>
              <option value="BANK_TRANSFER">Bank Transfer / Check</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '4px' }}>Returned Product Variant</label>
            <select
              value={selectedVariantId}
              onChange={(e) => {
                const vId = Number(e.target.value);
                setSelectedVariantId(vId);
                const found = products.find((p) => p.variant_id === vId);
                if (found) setUnitPrice(found.sale_price || '0');
              }}
              required
              style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #475569', backgroundColor: '#0f172a', color: '#fff' }}
            >
              <option value="">-- Select Product --</option>
              {products.map((p) => (
                <option key={p.variant_id} value={p.variant_id}>{p.name} ({p.sku})</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '4px' }}>Return Quantity</label>
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
              <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '4px' }}>Unit Price (DZD)</label>
              <input
                type="number"
                min="0"
                step="any"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                required
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #475569', backgroundColor: '#0f172a', color: '#fff' }}
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '4px' }}>Reason / Note</label>
            <input
              type="text"
              placeholder="Reason for return"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #475569', backgroundColor: '#0f172a', color: '#fff' }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '10px' }}>
            <button type="button" onClick={onClose} disabled={busy}
              style={{ padding: '8px 16px', borderRadius: '4px', border: '1px solid #475569', backgroundColor: 'transparent', color: '#fff', cursor: 'pointer' }}>
              Cancel
            </button>
            <button type="submit" disabled={busy}
              style={{ padding: '8px 16px', borderRadius: '4px', border: 'none', backgroundColor: '#059669', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
              {busy ? 'Processing…' : 'Confirm & Refund'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
