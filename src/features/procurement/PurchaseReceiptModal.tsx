import { useEffect, useRef, useState } from 'react';
import { confirmPurchaseReceipt, getOpenFiscalPeriod } from '../../shared/ipc/gateway';
import type { ConfirmPurchaseReceiptResult, OpenFiscalPeriod, PurchaseOrderDetailDto } from '../../shared/ipc/dto';
import { useI18n } from '../../shared/i18n';
import { useErrorText } from '../../shared/hooks/useErrorText';
import { currentBusinessDate } from '../../shared/utils/businessDate';
import { useAppData } from '../../app/AppDataContext';
import { isDecimalLessThanOrEqual, isPositiveDecimal } from './procurementDecimal';
import { PROCUREMENT_COPY } from './procurementCopy';

interface Props {
  sessionToken: string;
  poDetail: PurchaseOrderDetailDto;
  onClose: () => void;
  onSuccess: (result: ConfirmPurchaseReceiptResult) => void;
}

export default function PurchaseReceiptModal({
  sessionToken,
  poDetail,
  onClose,
  onSuccess,
}: Props) {
  const { t, locale } = useI18n();
  const text = PROCUREMENT_COPY[locale];
  const errorText = useErrorText();
  const { openFiscalPeriod: appOpenPeriod } = useAppData();
  const [fiscalPeriod, setFiscalPeriod] = useState<OpenFiscalPeriod | null>(appOpenPeriod);
  const [documentDate, setDocumentDate] = useState(currentBusinessDate());
  const [lineQtys, setLineQtys] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(crypto.randomUUID());

  useEffect(() => {
    const init = async () => {
      let fp = appOpenPeriod;
      if (!fp && sessionToken) {
        try {
          fp = await getOpenFiscalPeriod(sessionToken);
        } catch {
          // ignore
        }
      }
      setFiscalPeriod(fp);
      if (fp) {
        const today = currentBusinessDate();
        if (today >= fp.starts_on && today <= fp.ends_on) {
          setDocumentDate(today);
        } else {
          setDocumentDate(fp.starts_on);
        }
      }
    };
    void init();

    // Prefill receipt line quantities with remaining quantity
    const initial: Record<number, string> = {};
    for (const l of poDetail.lines) {
      if (isPositiveDecimal(l.remaining_quantity)) {
        initial[l.id] = l.remaining_quantity;
      } else {
        initial[l.id] = '0.000';
      }
    }
    setLineQtys(initial);
  }, [sessionToken, poDetail, appOpenPeriod]);

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

  const handleConfirmReceipt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fiscalPeriod) {
      setError(text.openPeriodRequired);
      return;
    }

    const linesPayload = poDetail.lines
      .map((l) => {
        const qtyStr =
          lineQtys[l.id] !== undefined
            ? lineQtys[l.id]
            : isPositiveDecimal(l.remaining_quantity)
            ? l.remaining_quantity
            : '0.000';
        return {
          po_line_id: l.id,
          quantity_received: qtyStr,
        };
      })
      .filter((l) => isPositiveDecimal(l.quantity_received));

    if (linesPayload.length === 0) {
      setError(text.receiveNow);
      return;
    }

    // Over-receipt client check
    for (const item of linesPayload) {
      const pol = poDetail.lines.find((l) => l.id === item.po_line_id);
      if (pol) {
        if (!isDecimalLessThanOrEqual(item.quantity_received, pol.remaining_quantity)) {
          setError(`Quantity for ${pol.variant_name} exceeds remaining quantity (${pol.remaining_quantity}).`);
          return;
        }
      }
    }

    try {
      setSubmitting(true);
      setError(null);
      const res = await confirmPurchaseReceipt(sessionToken, {
        request_id: requestId.current,
        purchase_order_id: poDetail.document_id,
        fiscal_period_id: fiscalPeriod.id,
        document_date: documentDate,
        lines: linesPayload,
      });
      onSuccess(res);
    } catch (err: unknown) {
      setError(errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="sk-modal-overlay"
      data-testid="purchase-receipt-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sk-modal-content sk-modal-content--large">
        <header className="sk-modal-header">
          <h2>{text.receiveGoods} — {poDetail.document_number ?? `#${poDetail.document_id}`}</h2>
          <button type="button" className="sk-modal-close" onClick={onClose}>
            ×
          </button>
        </header>

        {error && (
          <div className="sk-banner sk-banner--error" data-testid="receipt-modal-error">
            {error}
          </div>
        )}

        <form onSubmit={handleConfirmReceipt}>
          <div className="sk-form-grid" style={{ marginBottom: '1rem' }}>
            <div>
              <strong>{text.supplier}:</strong> {poDetail.supplier_name} ({poDetail.supplier_code})
            </div>
            <div>
              <strong>{text.warehouse}:</strong> {poDetail.warehouse_name}
            </div>
            <label>
              {text.receiptDate} *
              <input
                type="date"
                value={documentDate}
                onChange={(e) => setDocumentDate(e.target.value)}
                required
                data-testid="receipt-date-input"
              />
            </label>
          </div>

          <table className="sk-table" data-testid="receipt-lines-table">
            <thead>
              <tr>
                <th>{text.product}</th>
                <th>{text.unit}</th>
                <th>{text.ordered}</th>
                <th>{text.previouslyReceived}</th>
                <th>{text.remaining}</th>
                <th>{text.receiveNow} *</th>
                <th>{text.unitCost}</th>
              </tr>
            </thead>
            <tbody>
              {poDetail.lines.map((l) => (
                <tr key={l.id}>
                  <td>
                    <strong>{l.variant_sku}</strong> — {l.variant_name}
                  </td>
                  <td>{l.unit_code}</td>
                  <td>{l.quantity_ordered}</td>
                  <td>{l.quantity_received}</td>
                  <td>
                    <strong>{l.remaining_quantity}</strong>
                  </td>
                  <td>
                    <input
                      type="text"
                      className="sk-input-small"
                      value={lineQtys[l.id] ?? '0'}
                      onChange={(e) =>
                        setLineQtys({
                          ...lineQtys,
                          [l.id]: e.target.value,
                        })
                      }
                      disabled={parseFloat(l.remaining_quantity) <= 0}
                      data-testid={`receipt-qty-input-${l.id}`}
                    />
                  </td>
                  <td>{l.unit_cost} DZD</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="sk-form-actions" style={{ marginTop: '1.5rem' }}>
            <button type="button" className="sk-button sk-button--secondary" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className="sk-button sk-button--primary"
              disabled={submitting}
              data-testid="confirm-receipt-submit-btn"
            >
              {submitting ? text.confirming : text.confirmGoodsReceipt}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
