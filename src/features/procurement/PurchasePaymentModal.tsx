import { useState } from 'react';
import { newRequestId, postPurchasePayment } from '../../shared/ipc/gateway';
import type {
  PostPurchasePaymentPayload,
  PostPurchasePaymentResult,
  PurchaseSettlementMethod,
} from '../../shared/ipc/dto';
import { useI18n } from '../../shared/i18n';
import { useErrorText } from '../../shared/hooks/useErrorText';
import { currentBusinessDate } from '../../shared/utils/businessDate';
import { isPositiveDecimal } from './procurementDecimal';
import { PROCUREMENT_COPY } from './procurementCopy';
import './procurement.css';

interface Props {
  sessionToken: string;
  receiptDocumentId: number;
  receiptDocumentNumber: string;
  supplierName: string;
  outstandingAmount: string;
  fiscalPeriodId: number | null;
  onClose: () => void;
  onPosted: (result: PostPurchasePaymentResult) => void;
}

export function PurchasePaymentModal({
  sessionToken,
  receiptDocumentId,
  receiptDocumentNumber,
  supplierName,
  outstandingAmount,
  fiscalPeriodId,
  onClose,
  onPosted,
}: Props) {
  const { locale } = useI18n();
  const text = PROCUREMENT_COPY[locale];
  const errorText = useErrorText();

  const [amount, setAmount] = useState(outstandingAmount);
  const [method, setMethod] = useState<PurchaseSettlementMethod>('CASH');
  const [documentDate, setDocumentDate] = useState(currentBusinessDate());
  const [reference, setReference] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!isPositiveDecimal(amount)) {
      setError(text.paymentAmountInvalid);
      return;
    }
    if (!fiscalPeriodId) {
      setError(text.openPeriodRequired);
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      const payload: PostPurchasePaymentPayload = {
        request_id: newRequestId(),
        receipt_document_id: receiptDocumentId,
        fiscal_period_id: fiscalPeriodId,
        document_date: documentDate,
        payment_method: method,
        amount: amount.trim(),
        reference_number: reference.trim() || null,
      };
      const result = await postPurchasePayment(sessionToken, payload);
      onPosted(result);
    } catch (err: unknown) {
      setError(errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="sk-modal__backdrop" role="presentation" data-testid="purchase-payment-backdrop">
      <div
        className="sk-modal"
        role="dialog"
        aria-modal="true"
        aria-label={text.recordPayment}
        style={{ width: 'min(100%, 520px)' }}
        data-testid="purchase-payment-modal"
      >
        <div className="sk-modal-header">
          <h2 className="sk-modal__title">{text.recordPayment}</h2>
          <button
            type="button"
            className="sk-modal-close"
            onClick={onClose}
            aria-label={text.close}
            data-testid="purchase-payment-close"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="sk-banner sk-banner--error" role="alert" data-testid="purchase-payment-error">
            {error}
          </div>
        )}

        <div className="pr-detail-header-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
          <div className="pr-detail-field">
            <span className="pr-detail-field__label">{text.receipt}</span>
            <span className="pr-detail-field__value">{receiptDocumentNumber}</span>
          </div>
          <div className="pr-detail-field">
            <span className="pr-detail-field__label">{text.supplier}</span>
            <span className="pr-detail-field__value">{supplierName}</span>
          </div>
          <div className="pr-detail-field">
            <span className="pr-detail-field__label">{text.outstanding}</span>
            <span className="pr-detail-field__value pr-detail-field__value--money">
              {outstandingAmount} DZD
            </span>
          </div>
        </div>

        <div className="sk-form-grid">
          <label>
            {text.paymentAmount} (DZD) *
            <input
              type="text"
              className="sk-field__input"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              data-testid="purchase-payment-amount"
            />
          </label>

          <label>
            {text.paymentMethod} *
            <select
              value={method}
              onChange={(event) => setMethod(event.target.value as PurchaseSettlementMethod)}
              data-testid="purchase-payment-method"
            >
              <option value="CASH">{text.methodCash}</option>
              <option value="BANK_TRANSFER">{text.methodBankTransfer}</option>
            </select>
          </label>

          <label>
            {text.date} *
            <input
              type="date"
              className="sk-field__input"
              value={documentDate}
              onChange={(event) => setDocumentDate(event.target.value)}
              data-testid="purchase-payment-date"
            />
          </label>

          <label>
            {text.paymentReference}
            <input
              type="text"
              className="sk-field__input"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              data-testid="purchase-payment-reference"
            />
          </label>
        </div>

        <div className="sk-form-actions">
          <button
            type="button"
            className="sk-button sk-button--secondary"
            onClick={onClose}
            data-testid="purchase-payment-later"
          >
            {text.payLater}
          </button>
          <button
            type="button"
            className="sk-button sk-button--primary"
            onClick={handleSubmit}
            disabled={submitting}
            data-testid="purchase-payment-submit"
          >
            {submitting ? text.confirming : text.confirmPayment}
          </button>
        </div>
      </div>
    </div>
  );
}
