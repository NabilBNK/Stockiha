import React, { useState } from 'react';
import { allocateLandedCost } from '../../shared/ipc/gateway';
import type { PurchaseReceiptSummary } from '../../shared/ipc/dto';

interface LandedCostModalProps {
  receipt: PurchaseReceiptSummary;
  sessionToken: string;
  fiscalPeriodId: number;
  onClose: () => void;
  onSuccess: () => void;
}

export const LandedCostModal: React.FC<LandedCostModalProps> = ({
  receipt,
  sessionToken,
  fiscalPeriodId,
  onClose,
  onSuccess,
}) => {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'BY_QTY' | 'BY_VALUE' | 'EQUAL_PER_LINE'>('BY_QTY');
  const [documentDate, setDocumentDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || parseFloat(amount) <= 0) {
      setError('Please enter a valid positive landed cost amount.');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      await allocateLandedCost(sessionToken, {
        request_id: crypto.randomUUID(),
        receipt_id: receipt.document_id,
        landed_cost_amount: amount,
        allocation_method: method,
        fiscal_period_id: fiscalPeriodId,
        document_date: documentDate,
        note: note || undefined,
      });
      onSuccess();
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to allocate landed cost.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
    }}>
      <div style={{
        backgroundColor: '#1e293b', color: '#f8fafc', padding: '24px', borderRadius: '8px',
        width: '450px', maxWidth: '90vw'
      }}>
        <h3 style={{ marginTop: 0, marginBottom: '16px' }}>
          Allocate Landed Cost — {receipt.document_number}
        </h3>
        {error && (
          <div style={{ backgroundColor: '#7f1d1d', color: '#fecaca', padding: '8px 12px', borderRadius: '4px', marginBottom: '12px' }}>
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>Landed Cost Amount (DZD)</label>
            <input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 500.00 (Freight/Customs)"
              style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #475569', backgroundColor: '#0f172a', color: '#fff' }}
              required
            />
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>Allocation Method</label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as 'BY_QTY' | 'BY_VALUE' | 'EQUAL_PER_LINE')}
              style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #475569', backgroundColor: '#0f172a', color: '#fff' }}
            >
              <option value="BY_QTY">Proportional by Received Quantity</option>
              <option value="BY_VALUE">Proportional by Line Value</option>
              <option value="EQUAL_PER_LINE">Equal Split per Line</option>
            </select>
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>Document Date</label>
            <input
              type="date"
              value={documentDate}
              onChange={(e) => setDocumentDate(e.target.value)}
              style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #475569', backgroundColor: '#0f172a', color: '#fff' }}
              required
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>Note / Reference</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Customs invoice #9823"
              style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #475569', backgroundColor: '#0f172a', color: '#fff' }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button
              type="button"
              onClick={onClose}
              style={{ padding: '8px 16px', borderRadius: '4px', border: '1px solid #475569', backgroundColor: 'transparent', color: '#cbd5e1', cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              style={{ padding: '8px 16px', borderRadius: '4px', border: 'none', backgroundColor: '#2563eb', color: '#fff', cursor: 'pointer', fontWeight: 600 }}
            >
              {loading ? 'Allocating…' : 'Allocate Cost'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
