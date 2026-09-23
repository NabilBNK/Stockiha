import React, { useEffect, useState } from 'react';
import { useSession } from '../../shared/session/SessionContext';
import { useI18n, type Locale } from '../../shared/i18n';
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
import { printDocumentA4, saveDocumentFileWithDialog } from '../../shared/documents/documentPrintService';
import {
  renderOfficialDocumentHtml,
  renderOfficialDocumentPdf,
  type OfficialDocumentColumn,
  type OfficialDocumentModel,
  type OfficialDocumentTotal,
} from '../../shared/documents/officialDocument';
import { useOfficialDocumentContext } from '../../shared/documents/useOfficialDocumentContext';
import { buildSaleInvoiceModel } from '../../shared/documents/models/saleInvoiceModel';
import { buildPaymentReceiptModel } from '../../shared/documents/models/paymentReceiptModel';
import { buildSaleVoidModel } from '../../shared/documents/models/saleVoidModel';
import { buildPurchaseReceiptModel } from '../../shared/documents/models/purchaseReceiptModel';
import { buildGenericModel } from '../../shared/documents/models/genericModel';

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
  const { identity } = useOfficialDocumentContext(token);
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

  const copy: Record<string, string> = ({
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
      recordedBy: 'Recorded by',
      workstation: 'Workstation',
      discount: 'Discount',
      reason: 'Reason',
      note: 'Note',
      cancelledBanner: 'This document was cancelled by {number}.',
      reason_CUSTOMER_CHANGED_MIND: 'Customer changed mind',
      reason_WRONG_ITEM: 'Wrong item',
      reason_WRONG_PRICE: 'Wrong price',
      reason_CASHIER_MISTAKE: 'Cashier mistake',
      reason_OTHER: 'Custom reason',
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
      recordedBy: 'Saisi par',
      workstation: 'Poste',
      discount: 'Remise',
      reason: 'Motif',
      note: 'Note',
      cancelledBanner: 'Ce document a été annulé par {number}.',
      reason_CUSTOMER_CHANGED_MIND: 'Le client a changé d’avis',
      reason_WRONG_ITEM: 'Mauvais article',
      reason_WRONG_PRICE: 'Mauvais prix',
      reason_CASHIER_MISTAKE: 'Erreur de caisse',
      reason_OTHER: 'Motif personnalisé',
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
      recordedBy: 'سجّله',
      workstation: 'الجهاز',
      discount: 'الخصم',
      reason: 'السبب',
      note: 'ملاحظة',
      cancelledBanner: 'تم إلغاء هذا المستند بواسطة {number}.',
      reason_CUSTOMER_CHANGED_MIND: 'غيّر العميل رأيه',
      reason_WRONG_ITEM: 'منتج خاطئ',
      reason_WRONG_PRICE: 'سعر خاطئ',
      reason_CASHIER_MISTAKE: 'خطأ من أمين الصندوق',
      reason_OTHER: 'سبب مخصص',
    },
  } as Record<Locale, Record<string, string>>)[locale];

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

  const recordedByUsername = header?.created_by_username ?? null;
  const recordedOnWorkstation = header?.created_on_workstation_id ?? null;
  const cancellationRel = relationships.find((rel) => rel.document_type === 'SALE_VOID');
  const discountAmount = getSubtypeString(sub, 'discount_amount');
  const showDiscount = discountAmount != null && Number(discountAmount) !== 0;
  const voidReasonCode = getSubtypeString(sub, 'reason_code');
  const voidNote = getSubtypeString(sub, 'note');

  const buildModel = (): OfficialDocumentModel | null => {
    if (!detail || !identity) return null;

    const title = humanDocumentType(docType, locale);
    const documentNumber = docNum || `DOC-${documentId}`;
    const documentDateText = formatDisplayDate(docDate, locale);
    const statusText = humanStatus(docStatus, locale);
    const printLocale = identity.printLocale;

    if (docType === 'CASH_SALE' || docType === 'CREDIT_SALE') {
      return buildSaleInvoiceModel(
        {
          title,
          documentNumber,
          documentDateText,
          statusText,
          customerName: customerName || null,
          lines: lines.map((l, idx) => ({
            designation: String(l.product_name || l.product_name_snapshot || 'Article'),
            quantity: String(l.quantity ?? l.received_quantity ?? idx),
            unitPrice: formatDisplayAmount(String(l.unit_price || l.unit_cost || 0)),
            lineTotal: formatDisplayAmount(String(l.line_total || 0)),
          })),
          subtotal: totalMonetaryVal ? formatDisplayAmount(subtotalVal) : null,
          discount: showDiscount ? formatDisplayAmount(discountAmount as string) : null,
          total: formatDisplayAmount(grandTotalVal),
          totalNumeric: grandTotalVal,
        },
        printLocale,
      );
    }

    if (docType === 'CUSTOMER_PAYMENT' || docType === 'CUSTOMER_REFUND' || docType === 'SUPPLIER_PAYMENT') {
      const isSupplier = docType === 'SUPPLIER_PAYMENT';
      return buildPaymentReceiptModel(
        {
          title,
          kind: isSupplier ? 'SUPPLIER_PAYMENT' : 'PAYMENT_RECEIPT',
          documentNumber,
          documentDateText,
          statusText,
          partyLabel: isSupplier ? copy.supplier : copy.customer,
          partyName: partyNameDisplay || null,
          paymentMethod: payMethod && payMethod !== 'N/A' ? payMethod : null,
          lines: [{ label: title, amount: formatDisplayAmount(grandTotalVal) }],
          total: formatDisplayAmount(grandTotalVal),
          totalNumeric: grandTotalVal,
        },
        printLocale,
      );
    }

    if (docType === 'SALE_VOID') {
      const originalSaleRel = relationships.find(
        (rel) => rel.document_type === 'CASH_SALE' || rel.document_type === 'CREDIT_SALE',
      );
      return buildSaleVoidModel(
        {
          title,
          documentNumber,
          documentDateText,
          statusText,
          originalDocumentNumber: originalSaleRel?.document_number ?? '—',
          customerName: customerName || null,
          reasonText: voidReasonCode ? (copy[`reason_${voidReasonCode}`] ?? voidReasonCode) : null,
          note: voidNote,
          lines: lines.map((l, idx) => ({
            designation: String(l.product_name || l.product_name_snapshot || 'Article'),
            quantity: String(l.quantity ?? l.received_quantity ?? idx),
            unitPrice: formatDisplayAmount(String(l.unit_price || l.unit_cost || 0)),
            lineTotal: formatDisplayAmount(String(l.line_total || 0)),
          })),
          total: formatDisplayAmount(grandTotalVal),
          totalNumeric: grandTotalVal,
        },
        printLocale,
      );
    }

    if (docType === 'PURCHASE_RECEIPT') {
      return buildPurchaseReceiptModel(
        {
          title,
          documentNumber,
          documentDateText,
          statusText,
          supplierName: supplierName || null,
          warehouseName: warehouseName || null,
          purchaseOrderNumber: extDocNum || null,
          lines: lines.map((l, idx) => ({
            designation: String(l.product_name || l.product_name_snapshot || 'Article'),
            quantity: String(l.quantity ?? l.received_quantity ?? idx),
            unitPrice: formatDisplayAmount(String(l.unit_cost || l.unit_price || 0)),
            lineTotal: formatDisplayAmount(String(l.line_total || 0)),
          })),
          total: formatDisplayAmount(grandTotalVal),
          totalNumeric: grandTotalVal,
        },
        printLocale,
      );
    }

    // Generic fallback for document types without a dedicated layout
    // (e.g. STOCK_RECEIPT, STOCK_ADJUSTMENT).
    const hasPrices = lines.length > 0 && lines.some((l) => l.unit_price || l.unit_cost);
    const columns: OfficialDocumentColumn[] = hasPrices
      ? [
          { key: 'designation', label: 'Désignation', align: 'start' },
          { key: 'sku', label: 'SKU', align: 'start' },
          { key: 'unit', label: 'Unité', align: 'start' },
          { key: 'quantity', label: 'Qté', align: 'end' },
          { key: 'unitPrice', label: 'P.U', align: 'end' },
          { key: 'lineTotal', label: 'Total', align: 'end' },
        ]
      : [
          { key: 'designation', label: 'Désignation', align: 'start' },
          { key: 'sku', label: 'SKU', align: 'start' },
          { key: 'unit', label: 'Unité', align: 'start' },
          { key: 'quantity', label: 'Quantité', align: 'end' },
        ];
    const rows = lines.map((l, idx) => ({
      designation: String(l.product_name || l.product_name_snapshot || 'Article'),
      sku: String(l.sku || l.sku_snapshot || '—'),
      unit: String(l.unit_code || l.unit_code_snapshot || 'U'),
      quantity: String(l.quantity ?? l.received_quantity ?? idx),
      unitPrice: formatDisplayAmount(String(l.unit_price || l.unit_cost || 0)),
      lineTotal: formatDisplayAmount(String(l.line_total || 0)),
    }));
    const totals: OfficialDocumentTotal[] = totalMonetaryVal
      ? [
          { label: 'Sous-total', value: formatDisplayAmount(subtotalVal) },
          ...(Number(addCostVal) > 0
            ? [{ label: 'Frais additionnels', value: `+${formatDisplayAmount(addCostVal)}` }]
            : []),
          { label: 'Total', value: formatDisplayAmount(grandTotalVal), emphasis: true },
          ...(Number(paidVal) > 0 ? [{ label: 'Payé', value: formatDisplayAmount(paidVal) }] : []),
          ...(Number(remainingVal) > 0 ? [{ label: 'Solde dû', value: formatDisplayAmount(remainingVal) }] : []),
        ]
      : [];
    const notes = journal
      ? [
          `${copy.linkedJournal}: ${journal.document_number ?? `#${journal.document_id}`} — Débit ${formatDisplayAmount(journal.total_debit)} / Crédit ${formatDisplayAmount(journal.total_credit)}`,
        ]
      : undefined;

    return buildGenericModel({
      title,
      documentNumber,
      documentDateText,
      statusText,
      partyBlock: partyNameDisplay
        ? {
            title: partyLabelDisplay,
            rows: [
              { label: partyLabelDisplay, value: partyNameDisplay },
              ...(supplierCode ? [{ label: 'Code', value: supplierCode }] : []),
            ],
          }
        : undefined,
      metaBlock: warehouseName || docFiscalYear
        ? {
            title: copy.warehouse,
            rows: [
              ...(warehouseName ? [{ label: copy.warehouse, value: warehouseName }] : []),
              { label: copy.fiscalYear, value: String(docFiscalYear || '—') },
            ],
          }
        : undefined,
      columns,
      rows,
      totals,
      notes,
    });
  };

  const handlePrintA4 = () => {
    const model = buildModel();
    if (!model || !identity) return;
    printDocumentA4(renderOfficialDocumentHtml(model, identity));
  };

  const handleDownloadPdf = async () => {
    if (downloadingPdf) return;
    const model = buildModel();
    if (!model || !identity) return;
    try {
      setDownloadingPdf(true);
      const bytes = await renderOfficialDocumentPdf(model, identity);
      const safeDocType = (docType || 'Document').replace(/[^a-zA-Z0-9_-]/g, '_');
      const safeNum = (docNum || String(documentId)).replace(/[^a-zA-Z0-9_-]/g, '_');

      await saveDocumentFileWithDialog({
        defaultFileName: `${safeDocType}_${safeNum}.pdf`,
        bytes,
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

          {!loading && !error && detail && docStatus === 'REVERSED' && (
            <div className="sk-banner sk-banner--warning" style={{ marginBottom: '14px' }}>
              {copy.cancelledBanner.replace('{number}', cancellationRel?.document_number ?? '—')}
            </div>
          )}

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

                  {showDiscount && (
                    <div className="sk-detail-dialog__field">
                      <span className="sk-detail-dialog__field-label">{copy.discount}</span>
                      <span className="sk-detail-dialog__field-val">
                        {formatDisplayAmount(discountAmount as string)}
                      </span>
                    </div>
                  )}

                  {docType === 'SALE_VOID' && (
                    <div className="sk-detail-dialog__field">
                      <span className="sk-detail-dialog__field-label">{copy.reason}</span>
                      <span className="sk-detail-dialog__field-val">
                        {voidReasonCode ? (copy[`reason_${voidReasonCode}`] ?? voidReasonCode) : '—'}
                      </span>
                    </div>
                  )}

                  {docType === 'SALE_VOID' && (
                    <div className="sk-detail-dialog__field">
                      <span className="sk-detail-dialog__field-label">{copy.note}</span>
                      <span className="sk-detail-dialog__field-val">{voidNote ?? '—'}</span>
                    </div>
                  )}

                  <div className="sk-detail-dialog__field">
                    <span className="sk-detail-dialog__field-label">{copy.recordedBy}</span>
                    <span className="sk-detail-dialog__field-val">{recordedByUsername ?? '—'}</span>
                  </div>

                  <div className="sk-detail-dialog__field">
                    <span className="sk-detail-dialog__field-label">{copy.workstation}</span>
                    <span className="sk-detail-dialog__field-val">{recordedOnWorkstation ?? '—'}</span>
                  </div>
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
