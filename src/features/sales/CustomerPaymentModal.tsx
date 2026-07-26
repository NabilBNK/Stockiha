import React, { useState } from 'react';
import { postCustomerPayment } from '../../shared/ipc/gateway';
import type { CustomerLiabilityDto } from '../../shared/ipc/dto';

interface CustomerPaymentModalProps {
  liability: CustomerLiabilityDto;
  sessionToken: string;
  onClose: () => void;
  onPaymentPosted: () => void;
}

export const CustomerPaymentModal: React.FC<CustomerPaymentModalProps> = ({
  liability,
  sessionToken,
  onClose,
  onPaymentPosted,
}) => {
  const [amount, setAmount] = useState(liability.remaining_amount);
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'BANK_TRANSFER' | 'CHECK'>('CASH');
  const [documentDate, setDocumentDate] = useState(new Date().toISOString().split('T')[0]);
  const [fiscalPeriodId] = useState(1);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await postCustomerPayment(sessionToken, {
        request_id: crypto.randomUUID(),
        customer_id: liability.customer_id,
        liability_id: liability.id,
        amount,
        payment_method: paymentMethod,
        fiscal_period_id: fiscalPeriodId,
        document_date: documentDate,
        note: note.trim() || null,
      });
      onPaymentPosted();
      onClose();
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to post customer payment.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ backgroundColor: '#1e293b', borderRadius: '8px', padding: '24px', maxWidth: '480px', width: '100%', border: '1px solid #334155' }}>
        <h3 style={{ marginTop: 0, color: '#f8fafc' }}>Collect Customer Payment</h3>
        <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '16px' }}>
          Customer: <strong style={{ color: '#f8fafc' }}>{liability.customer_name}</strong> ({liability.customer_code})<br />
          Outstanding Balance: <strong style={{ color: '#f87171' }}>{liability.remaining_amount} DZD</strong>
        </p>

        {error && (
          <div style={{ backgroundColor: '#7f1d1d', color: '#fecaca', padding: '10px', borderRadius: '6px', marginBottom: '12px', fontSize: '0.9rem' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px', color: '#cbd5e1' }}>Payment Amount (DZD)</label>
            <input type="number" step="0.01" max={liability.remaining_amount} required
              value={amount} onChange={(e) => setAmount(e.target.value)}
              style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #475569', backgroundColor: '#0f172a', color: '#fff' }} />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px', color: '#cbd5e1' }}>Payment Method</label>
            <select value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as 'CASH' | 'BANK_TRANSFER' | 'CHECK')}
              style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #475569', backgroundColor: '#0f172a', color: '#fff' }}>
              <option value="CASH">Cash Desk (530000)</option>
              <option value="BANK_TRANSFER">Bank Transfer (512000)</option>
              <option value="CHECK">Check (512000)</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px', color: '#cbd5e1' }}>Payment Date</label>
            <input type="date" required value={documentDate}
              onChange={(e) => setDocumentDate(e.target.value)}
              style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #475569', backgroundColor: '#0f172a', color: '#fff' }} />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px', color: '#cbd5e1' }}>Note / Reference</label>
            <input type="text" placeholder="e.g. Bank receipt #12345" value={note}
              onChange={(e) => setNote(e.target.value)}
              style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #475569', backgroundColor: '#0f172a', color: '#fff' }} />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px' }}>
            <button type="button" onClick={onClose} disabled={submitting}
              style={{ padding: '8px 16px', borderRadius: '4px', border: '1px solid #475569', backgroundColor: 'transparent', color: '#fff', cursor: 'pointer' }}>
              Cancel
            </button>
            <button type="submit" disabled={submitting}
              style={{ padding: '8px 16px', borderRadius: '4px', border: 'none', backgroundColor: '#059669', color: '#fff', fontWeight: 500, cursor: 'pointer' }}>
              {submitting ? 'Processing…' : 'Confirm Payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
