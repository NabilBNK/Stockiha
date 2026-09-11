import { useEffect, useMemo, useState } from 'react';
import { confirmPurchaseReturn, listPurchaseReturnableLines, newRequestId } from '../../shared/ipc/gateway';
import type {
  ConfirmPurchaseReturnPayload,
  ConfirmPurchaseReturnResult,
  PurchaseReturnReason,
  PurchaseReturnableLineDto,
} from '../../shared/ipc/dto';
import { useI18n } from '../../shared/i18n';
import { useErrorText } from '../../shared/hooks/useErrorText';
import { currentBusinessDate } from '../../shared/utils/businessDate';
import { addExactDecimals, multiplyExactDecimals } from './procurementDecimal';
import { PROCUREMENT_COPY } from './procurementCopy';
import './procurement.css';

interface Props {
  sessionToken: string;
  receiptDocumentId: number;
  receiptDocumentNumber: string;
  supplierName: string;
  fiscalPeriodId: number | null;
  onClose: () => void;
  onPosted: (result: ConfirmPurchaseReturnResult) => void;
}

export function PurchaseReturnModal({
  sessionToken,
  receiptDocumentId,
  receiptDocumentNumber,
  supplierName,
  fiscalPeriodId,
  onClose,
  onPosted,
}: Props) {
  const { locale } = useI18n();
  const text = PROCUREMENT_COPY[locale];
  const errorText = useErrorText();

  const [lines, setLines] = useState<PurchaseReturnableLineDto[]>([]);
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [reason, setReason] = useState<PurchaseReturnReason>('DEFECTIVE_GOODS');
  const [documentDate, setDocumentDate] = useState(currentBusinessDate());
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await listPurchaseReturnableLines(sessionToken, receiptDocumentId);
        if (!active) return;
        setLines(data);
      } catch (err: unknown) {
        if (active) setError(errorText(err));
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [sessionToken, receiptDocumentId]);

  const refundPreview = useMemo(() => {
    let total = '0';
    lines.forEach((line) => {
      const quantity = quantities[line.receipt_line_id];
      if (!quantity || quantity.trim() === '') return;
      total = addExactDecimals([total, multiplyExactDecimals(quantity, line.unit_cost)]);
    });
    return total;
  }, [lines, quantities]);

  const handleSubmit = async () => {
    const payloadLines = lines
      .filter((line) => {
        const quantity = (quantities[line.receipt_line_id] ?? '').trim();
        return quantity !== '' && quantity !== '0';
      })
      .map((line) => ({
        receipt_line_id: line.receipt_line_id,
        quantity: (quantities[line.receipt_line_id] ?? '').trim(),
      }));

    if (payloadLines.length === 0) {
      setError(text.returnNeedsLine);
      return;
    }
    if (reason === 'OTHER' && note.trim() === '') {
      setError(text.noteRequiredForOther);
      return;
    }
    if (!fiscalPeriodId) {
      setError(text.openPeriodRequired);
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      const payload: ConfirmPurchaseReturnPayload = {
        request_id: newRequestId(),
        receipt_document_id: receiptDocumentId,
        fiscal_period_id: fiscalPeriodId,
        document_date: documentDate,
        reason_code: reason,
        note: note.trim() || null,
        lines: payloadLines,
      };
      const result = await confirmPurchaseReturn(sessionToken, payload);
      onPosted(result);
    } catch (err: unknown) {
      setError(errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="sk-modal__backdrop" role="presentation" data-testid="purchase-return-backdrop">
      <div
        className="sk-modal sk-modal-content--large"
        role="dialog"
        aria-modal="true"
        aria-label={text.returnToSupplier}
        style={{ width: 'min(100%, 820px)', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
        data-testid="purchase-return-modal"
      >
        <div className="sk-modal-header">
          <h2 className="sk-modal__title">{text.returnToSupplier}</h2>
          <button
            type="button"
            className="sk-modal-close"
            onClick={onClose}
            aria-label={text.close}
            data-testid="purchase-return-close"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="sk-banner sk-banner--error" role="alert" data-testid="purchase-return-error">
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
        </div>

        <div className="sk-form-grid">
          <label>
            {text.returnReason} *
            <select
              value={reason}
              onChange={(event) => setReason(event.target.value as PurchaseReturnReason)}
              data-testid="purchase-return-reason"
            >
              <option value="DEFECTIVE_GOODS">{text.reasonDefective}</option>
              <option value="EXCESS_DELIVERY">{text.reasonExcess}</option>
              <option value="WRONG_ITEM">{text.reasonWrongItem}</option>
              <option value="OTHER">{text.reasonOther}</option>
            </select>
          </label>

          <label>
            {text.date} *
            <input
              type="date"
              className="sk-field__input"
              value={documentDate}
              onChange={(event) => setDocumentDate(event.target.value)}
              data-testid="purchase-return-date"
            />
          </label>

          <label className="sk-grid-full">
            {text.supplierRefNote} {reason === 'OTHER' ? '*' : `(${text.optional})`}
            <input
              type="text"
              className="sk-field__input"
              value={note}
              placeholder={reason === 'OTHER' ? text.noteRequiredForOther : ''}
              required={reason === 'OTHER'}
              onChange={(event) => setNote(event.target.value)}
              data-testid="purchase-return-note"
            />
          </label>
        </div>

        <div className="sk-table-wrap" style={{ flex: 1, overflowY: 'auto' }}>
          <table className="sk-table" data-testid="purchase-return-lines-table">
            <thead>
              <tr>
                <th>{text.product}</th>
                <th>{text.unit}</th>
                <th className="sk-num">{text.unitCost} (DZD)</th>
                <th className="sk-num">{text.quantityReturnable}</th>
                <th className="sk-num">{text.quantityToReturn}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5}>{text.loading}</td>
                </tr>
              ) : (
                lines.map((line) => (
                  <tr key={line.receipt_line_id}>
                    <td>
                      {line.product_name}
                      {line.variant_name ? ` — ${line.variant_name}` : ''}
                      <div style={{ fontSize: '0.75rem', color: 'var(--sk-muted)' }}>{line.sku}</div>
                    </td>
                    <td>{line.unit_code}</td>
                    <td className="sk-num">{line.unit_cost}</td>
                    <td className="sk-num">{line.quantity_returnable}</td>
                    <td className="sk-num">
                      <input
                        type="text"
                        className="sk-input-small"
                        value={quantities[line.receipt_line_id] ?? ''}
                        disabled={Number(line.quantity_returnable) <= 0}
                        onChange={(event) =>
                          setQuantities((prev) => ({
                            ...prev,
                            [line.receipt_line_id]: event.target.value,
                          }))
                        }
                        data-testid={`return-quantity-${line.receipt_line_id}`}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div
          style={{ display: 'flex', justifyContent: 'flex-end', padding: '10px 0', fontWeight: 700 }}
          data-testid="purchase-return-refund-preview"
        >
          {text.refundPreview}: {refundPreview} DZD
        </div>

        <div className="sk-form-actions">
          <button
            type="button"
            className="sk-button sk-button--secondary"
            onClick={onClose}
            data-testid="purchase-return-cancel"
          >
            {text.cancel}
          </button>
          <button
            type="button"
            className="sk-button sk-button--primary"
            onClick={handleSubmit}
            disabled={submitting || loading}
            data-testid="purchase-return-submit"
          >
            {submitting ? text.confirming : text.confirmReturn}
          </button>
        </div>
      </div>
    </div>
  );
}
