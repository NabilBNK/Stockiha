import { useEffect, useState } from 'react';
import { useI18n } from '../../shared/i18n';
import { useErrorText } from '../../shared/hooks/useErrorText';
import { listPurchaseReceiptLines } from '../../shared/ipc/gateway';
import type { PurchaseReceiptLineDto, PurchaseReceiptSummary } from '../../shared/ipc/dto';
import { PROCUREMENT_COPY } from './procurementCopy';
import { downloadPurchaseReceiptXlsx } from './purchaseReceiptExport';
import { formatDisplayDate } from '../../shared/utils/formatters';
import './procurement.css';

interface Props {
  sessionToken: string;
  receipt: PurchaseReceiptSummary | null;
  onClose: () => void;
  onViewJournal?: (journalDocId: number) => void;
}

export function PurchaseReceiptDetailModal({
  sessionToken,
  receipt,
  onClose,
  onViewJournal,
}: Props) {
  const { locale } = useI18n();
  const text = PROCUREMENT_COPY[locale];
  const errorText = useErrorText();

  const [lines, setLines] = useState<PurchaseReceiptLineDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    if (!receipt) return;
    let active = true;

    const loadReceiptLines = async () => {
      try {
        setLoading(true);
        setError(null);
        const allLines = await listPurchaseReceiptLines(
          sessionToken,
          receipt.purchase_order_id ?? undefined
        );
        if (!active) return;
        const matched = allLines.filter((l) => l.receipt_document_id === receipt.document_id);
        setLines(matched);
      } catch (err: unknown) {
        if (!active) return;
        setError(errorText(err));
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadReceiptLines();

    return () => {
      active = false;
    };
  }, [sessionToken, receipt, errorText]);

  if (!receipt) return null;

  const isDirectPurchase =
    receipt.receipt_origin === 'DIRECT_PURCHASE' || !receipt.purchase_order_id;

  const handleExportXlsx = () => {
    downloadPurchaseReceiptXlsx({
      documentNumber: receipt.document_number,
      documentDate: formatDisplayDate(receipt.posted_at),
      supplierName: receipt.supplier_name,
      supplierDocRef: isDirectPurchase
        ? 'Direct Purchase'
        : (receipt.purchase_order_number ?? `PO #${receipt.purchase_order_id}`),
      paymentStatus: 'POSTED',
      paymentMethod: 'N/A',
      subtotal: receipt.total_amount,
      additionalCosts: receipt.landed_cost_amount ?? '0.00',
      grandTotal: receipt.total_amount,
      paidAmount: '0.00',
      remainingAmount: receipt.total_amount,
      lines: lines.map((l, idx) => ({
        lineNumber: idx + 1,
        sku: l.variant_sku,
        productName: l.variant_name,
        variantName: undefined,
        unitCode: l.unit_code,
        quantity: parseFloat(l.quantity_received) || 0,
        unitCost: parseFloat(l.unit_cost) || 0,
        lineTotal: parseFloat(l.line_total) || 0,
      })),
    });
  };

  return (
    <div
      className="sk-modal-overlay"
      data-testid="purchase-receipt-detail-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="sk-detail-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="receipt-detail-title"
      >
        {/* HEADER */}
        <header className="sk-detail-dialog__header">
          <div className="sk-detail-dialog__header-copy">
            <span className="sk-detail-dialog__eyebrow">
              {isDirectPurchase ? text.directPurchase : text.receiptsTitle}
            </span>
            <h2 id="receipt-detail-title" className="sk-detail-dialog__title">
              {text.receipt}: {receipt.document_number}
            </h2>
            <div className="sk-detail-dialog__sub">
              {formatDisplayDate(receipt.posted_at)} · {receipt.supplier_name} · {receipt.warehouse_name}
            </div>
          </div>
          <div className="sk-detail-dialog__header-actions">
            <span
              className="sk-badge sk-badge--success"
              data-testid="receipt-status-badge"
            >
              POSTED
            </span>
            <span
              className={`sk-badge ${isDirectPurchase ? 'sk-badge--success' : 'sk-badge--info'}`}
              data-testid="receipt-origin-badge"
            >
              {isDirectPurchase
                ? text.directPurchase
                : `${text.purchaseOrderOrigin}: ${receipt.purchase_order_number ?? `#${receipt.purchase_order_id}`}`}
            </span>
            <button
              type="button"
              className="sk-modal-close"
              onClick={onClose}
              aria-label={text.close}
              data-testid="close-receipt-detail-btn"
            >
              ×
            </button>
          </div>
        </header>

        {/* BODY */}
        <div className="sk-detail-dialog__body">
          {error && (
            <div className="sk-banner sk-banner--error" data-testid="receipt-detail-error">
              {error}
            </div>
          )}

          {/* COMPACT SUMMARY METRICS GRID */}
          <section className="pr-detail-header-grid">
            <div className="pr-detail-field">
              <span className="pr-detail-field__label">{text.supplier}</span>
              <strong className="pr-detail-field__value" data-testid="receipt-supplier-value">
                {receipt.supplier_name}
              </strong>
            </div>
            <div className="pr-detail-field">
              <span className="pr-detail-field__label">{text.warehouse}</span>
              <strong className="pr-detail-field__value" data-testid="receipt-warehouse-value">
                {receipt.warehouse_name}
              </strong>
            </div>
            <div className="pr-detail-field">
              <span className="pr-detail-field__label">{text.date}</span>
              <strong className="pr-detail-field__value" data-testid="receipt-date-value">
                {formatDisplayDate(receipt.posted_at)}
              </strong>
            </div>
            <div className="pr-detail-field">
              <span className="pr-detail-field__label">{text.total}</span>
              <strong className="pr-detail-field__value pr-detail-field__value--money" data-testid="receipt-total-value">
                {receipt.total_amount} DZD
              </strong>
            </div>
          </section>

          {/* SECONDARY METADATA DETAILS */}
          <section className="sk-detail-dialog__grid" style={{ marginTop: '-6px' }}>
            <div className="pr-detail-field">
              <span className="pr-detail-field__label">{text.receiptJournal}</span>
              <strong className="pr-detail-field__value pr-detail-field__value--mono" data-testid="receipt-journal-value">
                {receipt.journal_document_number ?? (receipt.journal_document_id ? `#${receipt.journal_document_id}` : '—')}
              </strong>
            </div>
            <div className="pr-detail-field">
              <span className="pr-detail-field__label">{text.origin}</span>
              <strong className="pr-detail-field__value">
                {isDirectPurchase
                  ? text.directPurchase
                  : (receipt.purchase_order_number ?? `PO #${receipt.purchase_order_id}`)}
              </strong>
            </div>
          </section>

          <section className="sk-detail-dialog__section">
            <h3 className="sk-detail-dialog__section-title">{text.purchasedItems}</h3>
            {loading ? (
              <div className="sk-spinner">{text.loading}</div>
            ) : lines.length === 0 ? (
              <div className="sk-muted" style={{ padding: '12px 0' }}>
                {text.noReceipts}
              </div>
            ) : (
              <div className="sk-table-wrap">
                <table className="sk-table" data-testid="receipt-detail-lines-table">
                  <thead>
                    <tr>
                      <th style={{ width: '40px' }}>#</th>
                      <th>{text.product}</th>
                      <th style={{ width: '130px' }}>SKU</th>
                      <th style={{ width: '90px' }}>{text.unit}</th>
                      <th className="sk-num" style={{ width: '110px' }}>{text.quantity}</th>
                      <th className="sk-num" style={{ width: '130px' }}>{text.unitCost} (DZD)</th>
                      <th className="sk-num" style={{ width: '140px' }}>{text.total} (DZD)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line, idx) => (
                      <tr key={line.receipt_line_id} data-testid={`receipt-line-${line.receipt_line_id}`}>
                        <td className="sk-muted">{idx + 1}</td>
                        <td>
                          <strong>{line.variant_name}</strong>
                        </td>
                        <td><code>{line.variant_sku}</code></td>
                        <td>{line.unit_code}</td>
                        <td className="sk-num"><strong>{line.quantity_received}</strong></td>
                        <td className="sk-num">{line.unit_cost}</td>
                        <td className="sk-num"><strong>{line.line_total}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'end', fontWeight: 700 }}>
                        {text.total}:
                      </td>
                      <td className="sk-num" style={{ fontWeight: 800 }}>
                        {receipt.total_amount} DZD
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>

          {/* ACCOUNTING IMPACT SECTION */}
          <section className="sk-card" style={{ padding: '16px', margin: 0 }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '0.92rem', fontWeight: 700 }}>
              {text.accountingImpact}
            </h3>
            <div className="pr-impact-grid">
              <div className="pr-impact-card pr-impact-dr">
                <span className="pr-impact-card__label">{text.inventoryMerchandise}</span>
                <span className="pr-impact-card__value">+{receipt.total_amount} DZD</span>
              </div>
              <div className="pr-impact-card pr-impact-cr">
                <span className="pr-impact-card__label">{text.grniAccount}</span>
                <span className="pr-impact-card__value">+{receipt.total_amount} DZD</span>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <span className="sk-badge sk-badge--success" data-testid="receipt-balanced-badge">
                ✓ {text.balancedJournal}
              </span>
              {receipt.journal_document_id && onViewJournal && (
                <button
                  type="button"
                  className="sk-button sk-button--small sk-button--secondary"
                  onClick={() => onViewJournal(receipt.journal_document_id!)}
                  data-testid="view-receipt-journal-btn"
                >
                  {text.viewJournal} ({receipt.journal_document_number ?? `#${receipt.journal_document_id}`})
                </button>
              )}
            </div>
          </section>
        </div>

        {/* FOOTER */}
        <footer className="sk-detail-dialog__footer">
          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
            <button
              type="button"
              className="sk-button sk-button--secondary"
              onClick={handleExportXlsx}
              disabled={lines.length === 0}
              data-testid="export-receipt-xlsx-btn"
            >
              {text.exportXlsx}
            </button>
            <button
              type="button"
              className="sk-button sk-button--secondary"
              onClick={onClose}
            >
              {text.close}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
