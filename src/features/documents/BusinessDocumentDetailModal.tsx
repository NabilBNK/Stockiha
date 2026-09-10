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
import {
  printDocumentA4,
  saveDocumentFileWithDialog,
  buildOfficialDocumentHtml,
  escapeHtml,
} from '../../shared/documents/documentPrintService';
import { generateGenericDocumentPdf } from '../../shared/documents/genericDocumentPdf';

interface DocumentDetailLineItem {
  line_number?: number;
  sku?: string;
  sku_snapshot?: string;
  product_name?: string;
  product_name_snapshot?: string;
  variant_name?: string;
  barcode?: string;
  unit_code?: string;
  unit_code_snapshot?: string;
  quantity?: string | number;
  ordered_quantity?: string | number;
  received_quantity?: string | number;
  invoiced_quantity?: string | number;
  returned_quantity?: string | number;
  unit_cost?: string | number;
  unit_price?: string | number;
  supplier_unit_cost?: string | number;
  line_total?: string | number;
}

function isDocumentDetailLineItem(item: unknown): item is DocumentDetailLineItem {
  return typeof item === 'object' && item !== null;
}

function getSubtypeString(sub: Record<string, unknown>, key: string): string | null {
  const val = sub[key];
  if (typeof val === 'string' && val.trim().length > 0) return val;
  if (typeof val === 'number') return String(val);
  return null;
}

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
  const [downloadingPdf, setDownloadingPdf] = useState<boolean>(false);

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

  const sub: Record<string, unknown> = detail?.subtype_detail || {};
  const lines: DocumentDetailLineItem[] = Array.isArray(sub.lines)
    ? sub.lines.filter(isDocumentDetailLineItem)
    : [];
  const relationships = detail?.relationships || [];
  const journal = detail?.journal;
  const printJobs = detail?.print_jobs;

  const supplierName = getSubtypeString(sub, 'supplier_name');
  const supplierCode = getSubtypeString(sub, 'supplier_code');
  const customerName = getSubtypeString(sub, 'customer_name');
  const warehouseName = getSubtypeString(sub, 'warehouse_name');
  const totalMonetaryVal =
    getSubtypeString(sub, 'total_amount') ||
    getSubtypeString(sub, 'base_total_amount') ||
    getSubtypeString(sub, 'amount');

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
      printA4: 'Print A4',
      downloadPdf: 'Download PDF',
      downloading: 'Downloading...',
      exportXlsx: 'Export Excel (.xlsx)',
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
      printA4: 'Imprimer A4',
      downloadPdf: 'Télécharger PDF',
      downloading: 'Téléchargement...',
      exportXlsx: 'Exporter Excel (.xlsx)',
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
      printA4: 'طباعة A4',
      downloadPdf: 'تحميل PDF',
      downloading: 'جارٍ التحميل...',
      exportXlsx: 'تصدير إكسل (.xlsx)',
    },
  }[locale];

  const extDocNum = getSubtypeString(sub, 'external_supplier_document_number') || '';
  const payStatus = getSubtypeString(sub, 'payment_status') || 'POSTED';
  const payMethod = getSubtypeString(sub, 'payment_method') || 'N/A';
  const subtotalVal = getSubtypeString(sub, 'gross_subtotal') || totalMonetaryVal || '0';
  const addCostVal = getSubtypeString(sub, 'additional_cost_amount') || '0';
  const grandTotalVal = getSubtypeString(sub, 'total_amount') || totalMonetaryVal || '0';
  const paidVal = getSubtypeString(sub, 'paid_amount') || '0';
  const remainingVal = getSubtypeString(sub, 'outstanding_amount') || '0';

  const partyNameDisplay = supplierName || customerName || getSubtypeString(sub, 'party_name') || '';
  const partyLabelDisplay = supplierName ? copy.supplier : customerName ? copy.customer : 'Tiers / Partenaire';

  const handlePrintA4 = () => {
    if (!detail) return;

    const infoCardsHtml = `
      <div class="info-card">
        <div class="info-card-title">${escapeHtml(partyLabelDisplay)}</div>
        <div class="info-row"><span>${escapeHtml(partyLabelDisplay)}:</span><strong>${escapeHtml(partyNameDisplay || '—')}</strong></div>
        ${supplierCode ? `<div class="info-row"><span>Code:</span><strong>${escapeHtml(supplierCode)}</strong></div>` : ''}
        ${extDocNum ? `<div class="info-row"><span>Réf:</span><strong>${escapeHtml(extDocNum)}</strong></div>` : ''}
      </div>
      <div class="info-card">
        <div class="info-card-title">${escapeHtml(copy.warehouse)} & Infos</div>
        <div class="info-row"><span>${escapeHtml(copy.warehouse)}:</span><strong>${escapeHtml(warehouseName || '—')}</strong></div>
        <div class="info-row"><span>${escapeHtml(copy.fiscalYear)}:</span><strong>${escapeHtml(String(docFiscalYear || '—'))}</strong></div>
        <div class="info-row"><span>Règlement:</span><strong>${escapeHtml(payStatus)} (${escapeHtml(payMethod)})</strong></div>
      </div>
    `;

    const tableHeaders = lines.length > 0 && lines.some(l => l.unit_price || l.unit_cost)
      ? ['#', 'Désignation', 'Code / SKU', 'Unité', 'Qté', 'P.U (DZD)', 'Total (DZD)']
      : ['#', 'Désignation', 'Code / SKU', 'Unité', 'Quantité'];

    const tableRowsHtml = lines.length > 0
      ? lines.map((l, idx) => `
        <tr>
          <td style="color: #64748b;">${l.line_number || idx + 1}</td>
          <td><strong>${escapeHtml(l.product_name || l.product_name_snapshot || 'Article')}</strong>${l.variant_name ? ` <small style="color: #64748b;">(${escapeHtml(l.variant_name)})</small>` : ''}</td>
          <td><code>${escapeHtml(l.sku || l.sku_snapshot || '—')}</code></td>
          <td>${escapeHtml(l.unit_code || l.unit_code_snapshot || 'U')}</td>
          <td class="num"><strong>${l.quantity || l.received_quantity || 0}</strong></td>
          ${tableHeaders.length > 5 ? `<td class="num">${formatDisplayAmount(String(l.unit_price || l.unit_cost || 0))}</td>` : ''}
          ${tableHeaders.length > 5 ? `<td class="num"><strong>${formatDisplayAmount(String(l.line_total || 0))}</strong></td>` : ''}
        </tr>
      `).join('')
      : `<tr><td colspan="${tableHeaders.length}" style="text-align: center; color: #64748b; padding: 16px;">${escapeHtml(copy.lineItems)} — ${escapeHtml(docNum || '')}</td></tr>`;

    const totalsRowsHtml = totalMonetaryVal ? `
      <tr>
        <td>Sous-total:</td>
        <td>${formatDisplayAmount(subtotalVal)}</td>
      </tr>
      ${Number(addCostVal) > 0 ? `
      <tr>
        <td>Frais additionnels:</td>
        <td>+${formatDisplayAmount(addCostVal)}</td>
      </tr>` : ''}
      <tr class="grand-total">
        <td>TOTAL GENERAL:</td>
        <td>${formatDisplayAmount(grandTotalVal)}</td>
      </tr>
      ${Number(paidVal) > 0 ? `
      <tr>
        <td style="color: #166534;">Payé:</td>
        <td style="color: #166534;">${formatDisplayAmount(paidVal)}</td>
      </tr>` : ''}
      ${Number(remainingVal) > 0 ? `
      <tr>
        <td style="color: #b91c1c;">Solde dû:</td>
        <td style="color: #b91c1c;">${formatDisplayAmount(remainingVal)}</td>
      </tr>` : ''}
    ` : '';

    const accountingBoxHtml = journal ? `
      <h4>${escapeHtml(copy.linkedJournal)}: ${escapeHtml(journal.document_number ?? `#${journal.document_id}`)}</h4>
      <div class="accounting-box-grid">
        <span>Statut: <strong>${journal.is_balanced ? 'Équilibré ✓' : 'Non équilibré ⚠'}</strong></span>
        <span>Débit: <strong>${formatDisplayAmount(journal.total_debit)}</strong></span>
        <span>Crédit: <strong>${formatDisplayAmount(journal.total_credit)}</strong></span>
      </div>
    ` : undefined;

    const html = buildOfficialDocumentHtml({
      title: humanDocumentType(docType, locale),
      documentNumber: docNum || `DOC-${documentId}`,
      documentDate: formatDisplayDate(docDate, locale),
      statusLabel: humanStatus(docStatus, locale),
      isPosted: docStatus === 'POSTED',
      locale,
      infoCardsHtml,
      tableHeaders,
      tableRowsHtml,
      totalsRowsHtml,
      accountingBoxHtml,
      footerNote: `Stockiha ERP · ${docNum || `DOC-${documentId}`}`,
    });

    printDocumentA4(html);
  };

  const handleDownloadPdf = async () => {
    if (!detail || downloadingPdf) return;
    try {
      setDownloadingPdf(true);
      const tableHeaders = lines.length > 0 && lines.some(l => l.unit_price || l.unit_cost)
        ? ['#', 'Article', 'SKU', 'Unité', 'Qté', 'Total']
        : ['#', 'Article', 'SKU', 'Unité', 'Qté'];

      const pdfBytes = await generateGenericDocumentPdf({
        title: humanDocumentType(docType, locale),
        documentNumber: docNum || `DOC-${documentId}`,
        documentDate: formatDisplayDate(docDate, locale),
        statusText: humanStatus(docStatus, locale),
        locale,
        partyLabel: partyLabelDisplay,
        partyName: partyNameDisplay,
        referenceLabel: extDocNum ? 'Réf' : undefined,
        referenceValue: extDocNum || undefined,
        warehouseLabel: warehouseName ? copy.warehouse : undefined,
        warehouseValue: warehouseName || undefined,
        tableHeaders,
        lines: lines.map((l, idx) => ({
          col1: String(l.line_number || idx + 1),
          col2: String(l.product_name || l.product_name_snapshot || 'Article'),
          col3: String(l.sku || l.sku_snapshot || '—'),
          col4: String(l.unit_code || l.unit_code_snapshot || 'U'),
          col5: String(l.quantity || l.received_quantity || 0),
          col6: l.line_total ? formatDisplayAmount(String(l.line_total)) : undefined,
        })),
        totals: totalMonetaryVal ? [
          { label: 'Sous-total', value: formatDisplayAmount(subtotalVal) },
          ...(Number(addCostVal) > 0 ? [{ label: 'Frais', value: `+${formatDisplayAmount(addCostVal)}` }] : []),
          { label: 'TOTAL GENERAL', value: formatDisplayAmount(grandTotalVal), isGrandTotal: true },
          ...(Number(remainingVal) > 0 ? [{ label: 'Solde restant', value: formatDisplayAmount(remainingVal) }] : []),
        ] : [],
        accountingNote: journal
          ? `Journal: ${journal.document_number ?? `#${journal.document_id}`} — Débit: ${formatDisplayAmount(journal.total_debit)} | Crédit: ${formatDisplayAmount(journal.total_credit)}`
          : undefined,
      });

      const safeDocType = (docType || 'Document').replace(/[^a-zA-Z0-9_-]/g, '_');
      const safeNum = (docNum || String(documentId)).replace(/[^a-zA-Z0-9_-]/g, '_');

      await saveDocumentFileWithDialog({
        defaultFileName: `${safeDocType}_${safeNum}.pdf`,
        bytes: pdfBytes,
        filterName: 'PDF Document',
        extension: 'pdf',
      });
    } catch (err) {
      console.error('Download PDF failed:', err);
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleExportXlsx = () => {
    downloadPurchaseReceiptXlsx({
      documentNumber: docNum || `DOC-${documentId}`,
      documentDate: formatDisplayDate(docDate, locale),
      supplierName: partyNameDisplay || 'Tiers',
      supplierDocRef: extDocNum,
      paymentStatus: payStatus,
      paymentMethod: payMethod,
      subtotal: subtotalVal,
      additionalCosts: addCostVal,
      grandTotal: grandTotalVal,
      paidAmount: paidVal,
      remainingAmount: remainingVal,
      lines: lines.map((l: DocumentDetailLineItem, idx: number) => ({
        lineNumber: l.line_number || idx + 1,
        sku: l.sku || l.sku_snapshot || 'SKU-000',
        productName: l.product_name || l.product_name_snapshot || 'Product',
        variantName: l.variant_name || undefined,
        barcode: l.barcode || undefined,
        unitCode: l.unit_code || l.unit_code_snapshot || 'U',
        quantity: parseFloat(String(l.quantity || l.received_quantity || 0)),
        unitCost: parseFloat(String(l.unit_cost || l.unit_price || 0)),
        lineTotal: parseFloat(String(l.line_total || 0)),
      })),
    });
  };

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
                  {supplierName && (
                    <div className="sk-detail-dialog__field">
                      <span className="sk-detail-dialog__field-label">{copy.supplier}</span>
                      <span className="sk-detail-dialog__field-val">
                        <strong>{supplierName}</strong>
                        {supplierCode && ` (${supplierCode})`}
                      </span>
                    </div>
                  )}

                  {customerName && (
                    <div className="sk-detail-dialog__field">
                      <span className="sk-detail-dialog__field-label">{copy.customer}</span>
                      <span className="sk-detail-dialog__field-val">
                        <strong>{customerName}</strong>
                      </span>
                    </div>
                  )}

                  {warehouseName && (
                    <div className="sk-detail-dialog__field">
                      <span className="sk-detail-dialog__field-label">{copy.warehouse}</span>
                      <span className="sk-detail-dialog__field-val">{warehouseName}</span>
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
                    <div className="sk-detail-dialog__field">
                      <span className="sk-detail-dialog__field-label">{copy.totalAmount}</span>
                      <span className="sk-detail-dialog__field-val sk-detail-dialog__field-val--money">
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
                    {copy.lineItems} ({lines.length}{' '}
                    {lines.length === 1 ? copy.itemSingle : copy.itemPlural})
                  </h3>
                  <div className="sk-table-wrap">
                    <table className="sk-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Article</th>
                          <th>Code / SKU</th>
                          <th>Unité</th>
                          <th className="sk-num">Quantité</th>
                          {lines.some(l => l.unit_price || l.unit_cost) && <th className="sk-num">P.U</th>}
                          {lines.some(l => l.line_total) && <th className="sk-num">Total</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map((item, idx) => (
                          <tr key={idx}>
                            <td className="sk-muted">{item.line_number || idx + 1}</td>
                            <td>
                              <strong>
                                {item.product_name || item.product_name_snapshot || 'Article'}
                              </strong>
                              {item.variant_name && (
                                <span className="sk-muted" style={{ marginInlineStart: '6px', fontSize: '0.8rem' }}>
                                  ({item.variant_name})
                                </span>
                              )}
                            </td>
                            <td>
                              <code>{item.sku || item.sku_snapshot || '—'}</code>
                            </td>
                            <td>{item.unit_code || item.unit_code_snapshot || 'U'}</td>
                            <td className="sk-num">
                              <strong>
                                {item.quantity ?? item.received_quantity ?? item.ordered_quantity ?? 0}
                              </strong>
                            </td>
                            {lines.some(l => l.unit_price || l.unit_cost) && (
                              <td className="sk-num">
                                {formatDisplayAmount(String(item.unit_price || item.unit_cost || 0))}
                              </td>
                            )}
                            {lines.some(l => l.line_total) && (
                              <td className="sk-num">
                                <strong>{formatDisplayAmount(String(item.line_total || 0))}</strong>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {/* SECTION 3: ACCOUNTING JOURNAL LINK */}
              <section className="sk-detail-dialog__section">
                <h3 className="sk-detail-dialog__section-title">{copy.accounting}</h3>
                {journal ? (
                  <div className="sk-detail-dialog__journal-card">
                    <div className="sk-detail-dialog__journal-info">
                      <span className="sk-detail-dialog__journal-badge">
                        {journal.is_balanced ? 'Équilibré' : 'Non équilibré'}
                      </span>
                      <span className="sk-detail-dialog__journal-num">
                        {journal.document_number ?? `#${journal.document_id}`}
                      </span>
                      <span className="sk-detail-dialog__journal-totals">
                        Débit: {formatDisplayAmount(journal.total_debit)} · Crédit:{' '}
                        {formatDisplayAmount(journal.total_credit)}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="sk-btn sk-btn--secondary sk-button--small"
                      onClick={() => setSelectedJournalDocId(journal.document_id)}
                    >
                      {copy.viewJournal}
                    </button>
                  </div>
                ) : (
                  <div className="sk-detail-dialog__no-journal">{copy.noJournal}</div>
                )}
              </section>

              {/* SECTION 4: PRINT / GENERATION JOBS */}
              {printJobs && (printJobs.gen_status || printJobs.prt_status) && (
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
          {detail && (
            <>
              <button
                type="button"
                className="sk-btn sk-btn--primary"
                onClick={handlePrintA4}
              >
                🖨️ {copy.printA4}
              </button>
              <button
                type="button"
                className="sk-btn sk-btn--secondary"
                onClick={handleDownloadPdf}
                disabled={downloadingPdf}
              >
                {downloadingPdf ? copy.downloading : `📄 ${copy.downloadPdf}`}
              </button>
              {lines.length > 0 && (
                <button
                  type="button"
                  className="sk-btn sk-btn--secondary"
                  onClick={handleExportXlsx}
                >
                  📊 {copy.exportXlsx}
                </button>
              )}
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
