import React, { useState } from 'react';
import { SupplierLiabilityDto } from '../../shared/ipc/dto';
import { postSupplierPayment } from '../../shared/ipc/gateway';

interface Props {
  liability: SupplierLiabilityDto;
  sessionToken: string;
  onClose: () => void;
  onPaymentPosted: () => void;
}

export const SupplierPaymentModal: React.FC<Props> = ({
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
      await postSupplierPayment(sessionToken, {
        request_id: crypto.randomUUID(),
        supplier_id: liability.supplier_id,
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
      setError((err as Error)?.message || 'Failed to post supplier payment.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div className="modal-card" style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '24px', maxWidth: '500px', width: '100%', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
        <h3 style={{ marginTop: 0, fontSize: '1.25rem', fontWeight: 600 }}>Pay Supplier Liability</h3>
        <p style={{ color: '#666', fontSize: '0.9rem', marginBottom: '16px' }}>
          Supplier: <strong>{liability.supplier_name}</strong> ({liability.supplier_code})<br />
          Outstanding Liability: <strong>{liability.remaining_amount} DZD</strong>
        </p>

        {error && (
          <div style={{ backgroundColor: '#fee2e2', color: '#991b1b', padding: '12px', borderRadius: '6px', marginBottom: '16px', fontSize: '0.9rem' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '4px' }}>Payment Amount (DZD)</label>
            <input
              type="number"
              step="0.01"
              max={liability.remaining_amount}
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #ccc' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '4px' }}>Payment Method</label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as 'CASH' | 'BANK_TRANSFER' | 'CHECK')}
              style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #ccc' }}
            >
              <option value="CASH">Cash Desk (530000)</option>
              <option value="BANK_TRANSFER">Bank Transfer (512000)</option>
              <option value="CHECK">Check (512000)</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '4px' }}>Payment Date</label>
            <input
              type="date"
              required
              value={documentDate}
              onChange={(e) => setDocumentDate(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #ccc' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '4px' }}>Note / Reference</label>
            <input
              type="text"
              placeholder="e.g. Bank receipt #98765"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #ccc' }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '16px' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #ccc', backgroundColor: '#f3f4f6', cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', backgroundColor: '#2563eb', color: '#fff', fontWeight: 500, cursor: 'pointer' }}
            >
              {submitting ? 'Processing...' : 'Confirm Payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
