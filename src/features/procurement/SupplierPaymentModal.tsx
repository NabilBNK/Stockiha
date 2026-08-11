import { useRef, useState } from 'react';

import { useI18n } from '../../shared/i18n';
import { postSupplierPayment } from '../../shared/ipc/gateway';
import type { PostSupplierPaymentResult, SupplierLiabilityDto } from '../../shared/ipc/dto';
import { isDecimalLessThanOrEqual, isPositiveDecimal } from './procurementDecimal';
import { PROCUREMENT_COPY } from './procurementCopy';

interface Props {
  liability: SupplierLiabilityDto;
  sessionToken: string;
  fiscalPeriodId: number;
  onClose: () => void;
  onPaymentPosted: (result: PostSupplierPaymentResult) => void;
}

export function SupplierPaymentModal({ liability, sessionToken, fiscalPeriodId, onClose, onPaymentPosted }: Props) {
  const { locale } = useI18n();
  const text = PROCUREMENT_COPY[locale];
  const [amount, setAmount] = useState(liability.remaining_amount);
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'BANK_TRANSFER' | 'CHECK'>('CASH');
  const [documentDate, setDocumentDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(crypto.randomUUID());

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!isPositiveDecimal(amount)) {
      setError(text.paymentAmount);
      return;
    }
    if (!isDecimalLessThanOrEqual(amount, liability.remaining_amount)) {
      setError(text.paymentExceedsOutstanding);
      return;
    }
    try {
      setSubmitting(true);
      setError(null);
      const result = await postSupplierPayment(sessionToken, {
        request_id: requestId.current,
        supplier_id: liability.supplier_id,
        liability_id: liability.id,
        amount,
        payment_method: paymentMethod,
        fiscal_period_id: fiscalPeriodId,
        document_date: documentDate,
        note: note.trim() || null,
      });
      onPaymentPosted(result);
    } catch (caught: unknown) {
      setError((caught as Error)?.message || text.requestUncertain);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="sk-modal-overlay" data-testid="supplier-payment-modal">
      <div className="sk-modal-content">
        <header className="sk-modal-header">
          <div><h2>{text.paySupplier}</h2><p className="sk-muted">{liability.supplier_name} · {liability.remaining_amount} DZD</p></div>
          <button type="button" className="sk-modal-close" onClick={onClose} aria-label={text.close}>×</button>
        </header>
        {error ? <div className="sk-banner sk-banner--error">{error}</div> : null}
        <form className="sk-form" onSubmit={handleSubmit}>
          <label>{text.paymentAmount} (DZD)<input value={amount} inputMode="decimal" onChange={(event) => setAmount(event.target.value)} required data-testid="supplier-payment-amount" /></label>
          <label>{text.paymentMethod}<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as typeof paymentMethod)}><option value="CASH">{text.cash}</option><option value="BANK_TRANSFER">{text.bank}</option><option value="CHECK">{text.check}</option></select></label>
          <label>{text.date}<input type="date" value={documentDate} onChange={(event) => setDocumentDate(event.target.value)} required /></label>
          <label>{text.note}<input value={note} onChange={(event) => setNote(event.target.value)} /></label>
          <div className="sk-form-actions"><button type="button" className="sk-button sk-button--secondary" onClick={onClose} disabled={submitting}>{text.cancel}</button><button type="submit" className="sk-button sk-button--primary" disabled={submitting} data-testid="confirm-supplier-payment">{submitting ? text.processing : text.confirmPayment}</button></div>
        </form>
      </div>
    </div>
  );
}
