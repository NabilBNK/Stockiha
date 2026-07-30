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
    <div className="sk-modal-overlay">
      <div className="sk-modal">
        <h3>
          Allocate Landed Cost — {receipt.document_number}
        </h3>
        {error && (
          <div className="sk-banner sk-banner--error">
            {error}
          </div>
        )}
        <form className="sk-form" onSubmit={handleSubmit}>
          <label>
            Landed Cost Amount (DZD)
            <input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 500.00 (Freight/Customs)"
              required
            />
          </label>

          <label>
            Allocation Method
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as 'BY_QTY' | 'BY_VALUE' | 'EQUAL_PER_LINE')}
            >
              <option value="BY_QTY">Proportional by Received Quantity</option>
              <option value="BY_VALUE">Proportional by Line Value</option>
              <option value="EQUAL_PER_LINE">Equal Split per Line</option>
            </select>
          </label>

          <label>
            Document Date
            <input
              type="date"
              value={documentDate}
              onChange={(e) => setDocumentDate(e.target.value)}
              required
            />
          </label>

          <label>
            Note / Reference
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Customs invoice #9823"
            />
          </label>

          <div className="sk-form-actions">
            <button
              type="button"
              className="sk-button sk-button--secondary"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="sk-button sk-button--primary"
              disabled={loading}
            >
              {loading ? 'Allocating…' : 'Allocate Cost'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
