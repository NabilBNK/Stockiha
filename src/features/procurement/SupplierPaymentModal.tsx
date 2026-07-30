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
    <div className="modal-overlay">
      <div className="modal-card">
        <h3>Pay Supplier Liability</h3>
        <p className="sk-muted">
          Supplier: <strong>{liability.supplier_name}</strong> ({liability.supplier_code})<br />
          Outstanding Liability: <strong>{liability.remaining_amount} DZD</strong>
        </p>

        {error && (
          <div className="sk-banner sk-banner--error">
            {error}
          </div>
        )}

        <form className="sk-form" onSubmit={handleSubmit}>
          <label>
            Payment Amount (DZD)
            <input
              type="number"
              step="0.01"
              max={liability.remaining_amount}
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>

          <label>
            Payment Method
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as 'CASH' | 'BANK_TRANSFER' | 'CHECK')}
            >
              <option value="CASH">Cash Desk (530000)</option>
              <option value="BANK_TRANSFER">Bank Transfer (512000)</option>
              <option value="CHECK">Check (512000)</option>
            </select>
          </label>

          <label>
            Payment Date
            <input
              type="date"
              required
              value={documentDate}
              onChange={(e) => setDocumentDate(e.target.value)}
            />
          </label>

          <label>
            Note / Reference
            <input
              type="text"
              placeholder="e.g. Bank receipt #98765"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>

          <div className="sk-form-actions">
            <button
              type="button"
              className="sk-button sk-button--secondary"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="sk-button sk-button--primary"
              disabled={submitting}
            >
              {submitting ? 'Processing...' : 'Confirm Payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
