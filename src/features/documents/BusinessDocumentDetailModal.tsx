import React, { useEffect, useState } from 'react';
import { useSession } from '../../shared/session/SessionContext';
import { useI18n } from '../../shared/i18n';
import { getBusinessDocumentDetail } from '../../shared/ipc/documentGateway';
import type { BusinessDocumentDetail } from '../../shared/ipc/documentDto';
import { JournalDetailModal } from '../accounting/JournalsScreen';
import { downloadPurchaseReceiptXlsx } from '../procurement/purchaseReceiptExport';
import {
  formatDisplayAmount,
  formatDisplayDate,
  humanDocumentType,
  humanStatus,
} from '../../shared/utils/formatters';

interface BusinessDocumentDetailModalProps {
  documentId: number | null;
  onClose: () => void;
}

export const BusinessDocumentDetailModal: React.FC<BusinessDocumentDetailModalProps> = ({
  documentId,
  onClose,
}) => {
  const { locale } = useI18n();
  const { user } = useSession();
  const token = user?.token ?? '';
  const [detail, setDetail] = useState<BusinessDocumentDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedJournalDocId, setSelectedJournalDocId] = useState<number | null>(null);

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
    if (!documentId || !token) return;
    setLoading(true);
    setError(null);
    getBusinessDocumentDetail(token, documentId)
      .then((data) => {
        setDetail(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load document detail:', err);
        setError(err.message || 'Failed to load document detail');
        setLoading(false);
      });
  }, [documentId, token]);

  const header = detail?.header;
  const docType = header?.document_type;
  const docNum = header?.document_number;
  const docStatus = header?.status;
  const docDate = header?.document_date;
  const docFiscalYear = header?.fiscal_year;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sub = (detail?.subtype_detail || {}) as Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lines: any[] = Array.isArray(sub.lines) ? sub.lines : [];
  const relationships = detail?.relationships || [];
  const journal = detail?.journal;
  const printJobs = detail?.print_jobs;

  const copy = {
    en: {
      overview: 'Overview',
      supplier: 'Supplier',
      customer: 'Customer',
      warehouse: 'Warehouse',
      documentDate: 'Document Date',
      fiscalYear: 'Fiscal Year',
      totalAmount: 'Total Value',
      lineItems: 'Line Items',
      accounting: 'Accounting',
      noJournal: 'No accounting journal is required for this document.',
      linkedJournal: 'Linked Journal',
      viewJournal: 'View Journal',
      documentOutput: 'Document Output',
      pdfGen: 'PDF Generation',
      thermalPrint: 'Thermal Print',
      relatedDocs: 'Related Documents',
      view: 'View',
      close: 'Close',
      itemSingle: 'item',
      itemPlural: 'items',
    },
    fr: {
      overview: 'Aperçu',
      supplier: 'Fournisseur',
      customer: 'Client',
      warehouse: 'Entrepôt',
      documentDate: 'Date du document',
      fiscalYear: 'Exercice',
      totalAmount: 'Valeur totale',
      lineItems: 'Articles',
      accounting: 'Comptabilité',
      noJournal: "Aucune écriture comptable n'est requise pour ce document.",
      linkedJournal: 'Journal lié',
      viewJournal: 'Voir journal',
      documentOutput: 'Sorties de document',
      pdfGen: 'Génération PDF',
      thermalPrint: 'Impression thermique',
      relatedDocs: 'Documents liés',
      view: 'Voir',
      close: 'Fermer',
      itemSingle: 'article',
      itemPlural: 'articles',
    },
    ar: {
      overview: 'نظرة عامة',
      supplier: 'المورد',
      customer: 'الزبون',
      warehouse: 'المستودع',
      documentDate: 'تاريخ المستند',
      fiscalYear: 'السنة المالية',
      totalAmount: 'القيمة الإجمالية',
      lineItems: 'العناصر',
      accounting: 'المحاسبة',
      noJournal: 'لا يتطلب هذا المستند قيداً محاسبياً.',
      linkedJournal: 'القيد المرتبط',
      viewJournal: 'عرض القيد',
      documentOutput: 'مخرجات المستند',
      pdfGen: 'إنشاء PDF',
      thermalPrint: 'طباعة حرارية',
      relatedDocs: 'المستندات ذات الصلة',
      view: 'عرض',
      close: 'إغلاق',
      itemSingle: 'عنصر',
      itemPlural: 'عناصر',
    },
  }[locale];

  const totalMonetaryVal = sub.total_amount || sub.base_total_amount || sub.amount;

  return (
    <div
      className="sk-modal-overlay"
      data-testid="business-document-detail-dialog"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="sk-detail-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="doc-detail-title"
      >
        {/* HEADER */}
        <header className="sk-detail-dialog__header">
          <div className="sk-detail-dialog__header-copy">
            <span className="sk-detail-dialog__eyebrow">
              {humanDocumentType(docType, locale)}
            </span>
            <h2 id="doc-detail-title" className="sk-detail-dialog__title">
              {docNum || `Document #${documentId}`}
            </h2>
            <div className="sk-detail-dialog__sub">
              {formatDisplayDate(docDate, locale)} · {copy.fiscalYear} {docFiscalYear || '—'}
            </div>
          </div>
          <div className="sk-detail-dialog__header-actions">
            <span
              className={`sk-badge ${
                docStatus === 'POSTED'
                  ? 'sk-badge--success'
                  : docStatus === 'DRAFT'
                  ? 'sk-badge--warning'
                  : 'sk-badge--secondary'
              }`}
            >
              {humanStatus(docStatus, locale)}
            </span>
            <button
              type="button"
              className="sk-modal-close"
              onClick={onClose}
              aria-label={copy.close}
            >
              ×
            </button>
          </div>
        </header>

        {/* BODY */}
        <div className="sk-detail-dialog__body">
          {loading && (
            <div className="sk-spinner">
              <span className="sk-spinner__dot" />
              <span>Loading inspection details...</span>
            </div>
          )}

          {error && <div className="sk-banner sk-banner--error">{error}</div>}

          {!loading && !error && detail && (
            <>
              {/* SECTION 1: OVERVIEW */}
              <section className="sk-detail-dialog__section">
                <h3 className="sk-detail-dialog__section-title">{copy.overview}</h3>
                <div className="sk-detail-dialog__grid">
                  {sub.supplier_name && (
                    <div className="sk-detail-dialog__field">
                      <span className="sk-detail-dialog__field-label">{copy.supplier}</span>
                      <span className="sk-detail-dialog__field-val">{sub.supplier_name}</span>
                      {sub.supplier_code && (
                        <span className="sk-detail-dialog__field-sub">Code: {sub.supplier_code}</span>
                      )}
                    </div>
                  )}

                  {sub.customer_name && (
                    <div className="sk-detail-dialog__field">
                      <span className="sk-detail-dialog__field-label">{copy.customer}</span>
                      <span className="sk-detail-dialog__field-val">{sub.customer_name}</span>
                    </div>
                  )}

                  {sub.warehouse_name && (
                    <div className="sk-detail-dialog__field">
                      <span className="sk-detail-dialog__field-label">{copy.warehouse}</span>
                      <span className="sk-detail-dialog__field-val">{sub.warehouse_name}</span>
                    </div>
                  )}

                  <div className="sk-detail-dialog__field">
                    <span className="sk-detail-dialog__field-label">{copy.documentDate}</span>
                    <span className="sk-detail-dialog__field-val">
                      {formatDisplayDate(docDate, locale)}
                    </span>
                  </div>

                  <div className="sk-detail-dialog__field">
                    <span className="sk-detail-dialog__field-label">{copy.fiscalYear}</span>
                    <span className="sk-detail-dialog__field-val">{docFiscalYear || '—'}</span>
                  </div>

                  {totalMonetaryVal && (
                    <div className="sk-detail-dialog__field sk-detail-dialog__field--highlight">
                      <span className="sk-detail-dialog__field-label">{copy.totalAmount}</span>
                      <span className="sk-detail-dialog__field-val--money">
                        {formatDisplayAmount(totalMonetaryVal)}
                      </span>
                    </div>
                  )}
                </div>
              </section>

              {/* SECTION 2: LINE ITEMS */}
              {lines.length > 0 && (
                <section className="sk-detail-dialog__section">
                  <h3 className="sk-detail-dialog__section-title">
                    {copy.lineItems} ({lines.length} {lines.length === 1 ? copy.itemSingle : copy.itemPlural})
                  </h3>
                  <div className="sk-table-wrap">
                    <table className="sk-table" data-testid="doc-detail-lines-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>SKU</th>
                          <th>Product</th>
                          <th className="sk-num">Quantity</th>
                          <th className="sk-num">Unit Cost / Price</th>
                          <th className="sk-num">Line Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map((line, idx) => {
                          const qty =
                            line.ordered_quantity ||
                            line.received_quantity ||
                            line.invoiced_quantity ||
                            line.returned_quantity ||
                            line.quantity;
                          const price = line.unit_cost || line.unit_price || line.supplier_unit_cost;
                          return (
                            <tr key={idx}>
                              <td className="sk-muted">{line.line_number || idx + 1}</td>
                              <td>
                                <code>{line.sku}</code>
                              </td>
                              <td>
                                <strong>{line.product_name}</strong>
                              </td>
                              <td className="sk-num">{qty}</td>
                              <td className="sk-num">{formatDisplayAmount(price)}</td>
                              <td className="sk-num">
                                <strong>{formatDisplayAmount(line.line_total)}</strong>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {/* SECTION 3: ACCOUNTING */}
              <section className="sk-detail-dialog__section">
                <h3 className="sk-detail-dialog__section-title">{copy.accounting}</h3>
                {journal ? (
                  <div className="sk-detail-dialog__field sk-detail-dialog__field--highlight">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <span className="sk-detail-dialog__field-label">{copy.linkedJournal}</span>
                        <div className="sk-detail-dialog__field-val" style={{ fontFamily: 'monospace' }}>
                          {journal.document_number}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="sk-btn sk-btn--secondary"
                        onClick={() => setSelectedJournalDocId(journal.document_id)}
                      >
                        {copy.viewJournal}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="sk-muted" style={{ margin: 0, fontStyle: 'italic' }}>
                    {copy.noJournal}
                  </p>
                )}
              </section>

              {/* SECTION 4: DOCUMENT OUTPUT */}
              {printJobs && (
                <section className="sk-detail-dialog__section">
                  <h3 className="sk-detail-dialog__section-title">{copy.documentOutput}</h3>
                  <div className="sk-detail-dialog__grid">
                    <div className="sk-detail-dialog__field">
                      <span className="sk-detail-dialog__field-label">{copy.pdfGen}</span>
                      <span className="sk-detail-dialog__field-val">
                        {humanStatus(printJobs.gen_status, locale)}
                      </span>
                    </div>
                    <div className="sk-detail-dialog__field">
                      <span className="sk-detail-dialog__field-label">{copy.thermalPrint}</span>
                      <span className="sk-detail-dialog__field-val">
                        {humanStatus(printJobs.prt_status, locale)}
                      </span>
                    </div>
                  </div>
                </section>
              )}

              {/* SECTION 5: RELATED DOCUMENTS */}
              {relationships.length > 0 && (
                <section className="sk-detail-dialog__section">
                  <h3 className="sk-detail-dialog__section-title">{copy.relatedDocs}</h3>
                  <div className="sk-detail-dialog__rel-grid">
                    {relationships.map((rel) => (
                      <div key={rel.document_id} className="sk-detail-dialog__rel-card">
                        <div className="sk-detail-dialog__rel-info">
                          <span className="sk-detail-dialog__rel-type">
                            {humanDocumentType(rel.document_type, locale)}
                          </span>
                          <span className="sk-detail-dialog__rel-num">{rel.document_number}</span>
                        </div>
                        <span className="sk-badge sk-badge--success">
                          {humanStatus(rel.status, locale)}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>

        {/* FOOTER */}
        <footer className="sk-detail-dialog__footer">
          {(docType === 'PURCHASE_TRANSACTION' || docType === 'PURCHASE_RECEIPT') && detail && (
            <>
              <button
                type="button"
                className="sk-btn sk-btn--primary"
                onClick={() => window.print()}
              >
                Print / PDF
              </button>
              <button
                type="button"
                className="sk-btn sk-btn--secondary"
                onClick={() => {
                  downloadPurchaseReceiptXlsx({
                    documentNumber: docNum || `PUR-${documentId}`,
                    documentDate: docDate || '',
                    supplierName: sub.supplier_name || 'Supplier',
                    supplierDocRef: sub.external_supplier_document_number || '',
                    paymentStatus: sub.payment_status || 'PAID',
                    paymentMethod: sub.payment_method || 'N/A',
                    subtotal: String(sub.gross_subtotal || sub.total_amount || 0),
                    additionalCosts: String(sub.additional_cost_amount || 0),
                    grandTotal: String(sub.total_amount || 0),
                    paidAmount: String(sub.paid_amount || 0),
                    remainingAmount: String(sub.outstanding_amount || 0),
                    lines: lines.map((l: any, idx: number) => ({
                      lineNumber: l.line_number || idx + 1,
                      sku: l.sku || l.sku_snapshot || 'SKU-000',
                      productName: l.product_name || l.product_name_snapshot || 'Product',
                      variantName: l.variant_name || undefined,
                      barcode: l.barcode || undefined,
                      unitCode: l.unit_code || l.unit_code_snapshot || 'U',
                      quantity: parseFloat(l.quantity || l.received_quantity || 0),
                      unitCost: parseFloat(l.unit_cost || 0),
                      lineTotal: parseFloat(l.line_total || 0),
                    })),
                  });
                }}
              >
                Export Excel (.xlsx)
              </button>
            </>
          )}
          <button type="button" className="sk-btn sk-btn--secondary" onClick={onClose}>
            {copy.close}
          </button>
        </footer>
      </div>

      {/* Linked Journal Detail Modal */}
      {selectedJournalDocId && (
        <JournalDetailModal
          journalDocId={selectedJournalDocId}
          onClose={() => setSelectedJournalDocId(null)}
        />
      )}
    </div>
  );
};
