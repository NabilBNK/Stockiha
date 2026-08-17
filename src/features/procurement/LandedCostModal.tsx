import { useEffect, useRef, useState } from 'react';

import { useI18n } from '../../shared/i18n';
import { useErrorText } from '../../shared/hooks/useErrorText';
import { currentBusinessDate } from '../../shared/utils/businessDate';
import { allocateLandedCost } from '../../shared/ipc/gateway';
import type { AllocateLandedCostResult, PurchaseReceiptSummary } from '../../shared/ipc/dto';
import { isPositiveDecimal } from './procurementDecimal';
import { PROCUREMENT_COPY } from './procurementCopy';

interface Props {
  receipt: PurchaseReceiptSummary;
  sessionToken: string;
  fiscalPeriodId: number;
  onClose: () => void;
  onSuccess: (result: AllocateLandedCostResult) => void;
}

export function LandedCostModal({
  receipt,
  sessionToken,
  fiscalPeriodId,
  onClose,
  onSuccess,
}: Props) {
  const { locale } = useI18n();
  const text = PROCUREMENT_COPY[locale];
  const errorText = useErrorText();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'BY_QTY' | 'BY_VALUE' | 'EQUAL_PER_LINE'>('BY_QTY');
  const [documentDate, setDocumentDate] = useState(currentBusinessDate());
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(crypto.randomUUID());

  // Close on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!isPositiveDecimal(amount)) {
      setError(text.amount);
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      const result = await allocateLandedCost(sessionToken, {
        request_id: requestId.current,
        receipt_id: receipt.document_id,
        landed_cost_amount: amount,
        allocation_method: method,
        fiscal_period_id: fiscalPeriodId,
        document_date: documentDate,
        note: note.trim() || null,
      });
      onSuccess(result);
    } catch (caught: unknown) {
      setError(errorText(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="sk-modal-overlay"
      data-testid="landed-cost-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sk-modal-content">
        <header className="sk-modal-header">
          <div>
            <h2>{text.allocateLandedCost}</h2>
            <p className="sk-muted">
              {receipt.document_number} · {receipt.supplier_name} · {receipt.total_amount} DZD
            </p>
          </div>
          <button type="button" className="sk-modal-close" onClick={onClose} aria-label={text.close}>×</button>
        </header>

        {error ? <div className="sk-banner sk-banner--error">{error}</div> : null}

        <form className="sk-form" onSubmit={handleSubmit}>
          <label>
            {text.amount} (DZD)
            <input
              value={amount}
              inputMode="decimal"
              onChange={(event) => setAmount(event.target.value)}
              required
              data-testid="landed-cost-amount"
            />
          </label>
          <label>
            {text.allocationMethod}
            <select value={method} onChange={(event) => setMethod(event.target.value as typeof method)}>
              <option value="BY_QTY">{text.byQuantity}</option>
              <option value="BY_VALUE">{text.byValue}</option>
              <option value="EQUAL_PER_LINE">{text.equalPerLine}</option>
            </select>
          </label>
          <label>
            {text.date}
            <input type="date" value={documentDate} onChange={(event) => setDocumentDate(event.target.value)} required />
          </label>
          <label>
            {text.note}
            <input value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
          <div className="sk-form-actions">
            <button type="button" className="sk-button sk-button--secondary" onClick={onClose} disabled={submitting}>
              {text.cancel}
            </button>
            <button type="submit" className="sk-button sk-button--primary" disabled={submitting} data-testid="post-landed-cost">
              {submitting ? text.processing : text.allocateLandedCost}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
