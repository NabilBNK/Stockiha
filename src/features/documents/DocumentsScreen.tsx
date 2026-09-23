import React, { useCallback, useEffect, useState } from 'react';
import { Button, Spinner } from '../../shared/components';
import { useErrorText } from '../../shared/hooks/useErrorText';
import { useI18n, type Locale } from '../../shared/i18n';
import {
  getBusinessDocumentReports,
  searchBusinessDocuments,
} from '../../shared/ipc/documentGateway';
import type {
  BusinessDocumentReportResult,
  DocumentReportFilter,
  DocumentSearchFilter,
  DocumentSearchResult,
  PrintableDocument,
} from '../../shared/ipc/documentDto';
import { useSession } from '../../shared/session/SessionContext';
import { BusinessDocumentDetailModal } from './BusinessDocumentDetailModal';
import { CustomerDocumentView } from './CustomerDocumentView';
import { JournalDetailModal } from '../accounting/JournalsScreen';
import {
  formatDisplayAmount,
  formatDisplayDate,
  humanDocumentType,
  humanStatus,
} from '../../shared/utils/formatters';
import { printDocumentA4, saveDocumentFileWithDialog } from '../../shared/documents/documentPrintService';
import { renderOfficialDocumentHtml, renderOfficialDocumentPdf } from '../../shared/documents/officialDocument';
import { useOfficialDocumentContext } from '../../shared/documents/useOfficialDocumentContext';
import { buildDocumentsReportModel } from '../../shared/documents/models/documentsReportModel';

type ActiveTab = 'DOCUMENTS' | 'REPORTS';

const DOC_TYPE_OPTIONS = [
  'CASH_SALE',
  'CREDIT_SALE',
  'SALE_VOID',
  'CUSTOMER_PAYMENT',
  'CUSTOMER_REFUND',
  'PURCHASE_TRANSACTION',
  'PURCHASE_ORDER',
  'PURCHASE_RECEIPT',
  'SUPPLIER_INVOICE',
  'SUPPLIER_PAYMENT',
  'PURCHASE_RETURN',
  'STOCK_RECEIPT',
  'STOCK_ADJUSTMENT',
];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

const COPY: Record<Locale, Record<string, string>> = {
  en: {
    title: 'Business Documents',
    subtitle: 'Review operational documents, posted transactions, and general ledger reports.',
    refresh: 'Refresh',
    tabDocuments: 'Documents',
    tabReports: 'Reports',
    filterAll: 'All Documents',
    filterSales: 'Sales & Receivables',
    filterProcurement: 'Procurement & Payables',
    number: 'Document #',
    type: 'Document Type',
    date: 'Date',
    status: 'Status',
    generation: 'Generation',
    print: 'Print',
    journal: 'Linked Journal',
    action: 'Action',
    view: 'View Details',
    viewJournal: 'View Journal',
    none: 'No business documents found.',
    dateFrom: 'From Date',
    dateTo: 'To Date',
    journalFilter: 'Journal Link',
    allJournals: 'All Documents',
    withJournal: 'With Journal',
    withoutJournal: 'Without Journal',
    search: 'Search',
    searchPlaceholder: 'Number, customer or supplier…',
    reset: 'Clear Filters',
    totalDocs: 'Total Documents',
    postedDocs: 'Posted',
    draftDocs: 'Draft',
    reversedDocs: 'Reversed',
    withJournalDocs: 'Linked Journal',
    withoutJournalDocs: 'Unlinked',
    nonAdditiveNotice:
      'Amounts are shown by document type and are not additive across workflow stages.',
    emptyTitle: 'No business documents match these filters.',
    emptySub: 'Try changing the date range or clearing one or more filters.',
    errorTitle: 'Unable to load business documents report.',
    retry: 'Retry',
    breakdown: 'Document Type Breakdown',
    count: 'Count',
    totalAmount: 'Total Amount',
    party: 'Customer / Supplier',
    printReportA4: 'Print Report A4',
    downloadReportPdf: 'Download Report PDF',
    downloading: 'Downloading...',
    amount: 'Amount',
    recordedBy: 'Recorded by',
    walkIn: 'Walk-in customer',
    cancelledBy: 'Cancelled by',
    cancels: 'Cancels',
    statusFilter: 'Status',
    allTypes: 'All types',
    allStatuses: 'All statuses',
    showing: 'Showing {from}–{to} of {total}',
    previous: 'Previous',
    next: 'Next',
    dateRangeInvalid: 'The start date is after the end date.',
  },
  fr: {
    title: 'Documents Commerciaux',
    subtitle: 'Consultez les documents opérationnels, transactions validées et rapports comptables.',
    refresh: 'Actualiser',
    tabDocuments: 'Documents',
    tabReports: 'Rapports',
    filterAll: 'Tous les documents',
    filterSales: 'Ventes & Créances',
    filterProcurement: 'Achats & Dettes',
    number: 'N° Document',
    type: 'Type de document',
    date: 'Date',
    status: 'Statut',
    generation: 'Génération',
    print: 'Impression',
    journal: 'Journal lié',
    action: 'Action',
    view: 'Voir détails',
    viewJournal: 'Voir journal',
    none: 'Aucun document trouvé.',
    dateFrom: 'Date de début',
    dateTo: 'Date de fin',
    journalFilter: 'Lien journal',
    allJournals: 'Tous les documents',
    withJournal: 'Avec journal',
    withoutJournal: 'Sans journal',
    search: 'Rechercher',
    searchPlaceholder: 'Numéro, client ou fournisseur…',
    reset: 'Réinitialiser les filtres',
    totalDocs: 'Total Documents',
    postedDocs: 'Validés',
    draftDocs: 'Brouillons',
    reversedDocs: 'Annulés',
    withJournalDocs: 'Liés au journal',
    withoutJournalDocs: 'Non liés',
    nonAdditiveNotice:
      "Les montants sont affichés par type et ne s'additionnent pas entre étapes du flux.",
    emptyTitle: 'Aucun document ne correspond à ces filtres.',
    emptySub: 'Essayez de modifier la plage de dates ou de réinitialiser les filtres.',
    errorTitle: 'Impossible de charger le rapport des documents.',
    retry: 'Réessayer',
    breakdown: 'Répartition par type de document',
    count: 'Nombre',
    totalAmount: 'Montant total',
    party: 'Client / Fournisseur',
    printReportA4: 'Imprimer Rapport A4',
    downloadReportPdf: 'Télécharger Rapport PDF',
    downloading: 'Téléchargement...',
    amount: 'Montant',
    recordedBy: 'Saisi par',
    walkIn: 'Client comptoir',
    cancelledBy: 'Annulé par',
    cancels: 'Annule',
    statusFilter: 'Statut',
    allTypes: 'Tous les types',
    allStatuses: 'Tous les statuts',
    showing: 'Affichage {from}–{to} sur {total}',
    previous: 'Précédent',
    next: 'Suivant',
    dateRangeInvalid: 'La date de début est après la date de fin.',
  },
  ar: {
    title: 'المستندات التجارية',
    subtitle: 'مراجعة المستندات التشغيلية والمعاملات المرحّلة وتقارير الدفتر العام.',
    refresh: 'تحديث',
    tabDocuments: 'المستندات',
    tabReports: 'التقارير',
    filterAll: 'جميع المستندات',
    filterSales: 'المبيعات والذمم',
    filterProcurement: 'المشتريات والموردين',
    number: 'رقم المستند',
    type: 'نوع المستند',
    date: 'التاريخ',
    status: 'الحالة',
    generation: 'الإنشاء',
    print: 'الطباعة',
    journal: 'القيد المرتبط',
    action: 'الإجراء',
    view: 'عرض التفاصيل',
    viewJournal: 'عرض القيد',
    none: 'لم يتم العثور على مستندات.',
    dateFrom: 'من تاريخ',
    dateTo: 'إلى تاريخ',
    journalFilter: 'ربط القيد',
    allJournals: 'جميع المستندات',
    withJournal: 'مرتبط بقيد',
    withoutJournal: 'غير مرتبط بقيد',
    search: 'بحث',
    searchPlaceholder: 'الرقم أو العميل أو المورد…',
    reset: 'مسح الفلاتر',
    totalDocs: 'إجمالي المستندات',
    postedDocs: 'المرحّلة',
    draftDocs: 'مسودة',
    reversedDocs: 'المعكوسة',
    withJournalDocs: 'مرتبطة بقيد',
    withoutJournalDocs: 'غير مرتبطة بقيد',
    nonAdditiveNotice: 'المبالغ معروضة حسب نوع المستند ولا تُجمع عبر مراحل سير العمل.',
    emptyTitle: 'لا توجد مستندات تطابق هذه الفلاتر.',
    emptySub: 'جرب تغيير النطاق الزمني أو مسح الفلاتر.',
    errorTitle: 'تعذر تحميل تقرير المستندات.',
    retry: 'إعادة المحاولة',
    breakdown: 'تفصيل حسب نوع المستند',
    count: 'العدد',
    totalAmount: 'المبلغ الإجمالي',
    party: 'العميل / المورد',
    printReportA4: 'طباعة التقرير A4',
    downloadReportPdf: 'تحميل التقرير PDF',
    downloading: 'جارٍ التحميل...',
    amount: 'المبلغ',
    recordedBy: 'سجّله',
    walkIn: 'عميل عابر',
    cancelledBy: 'أُلغي بواسطة',
    cancels: 'يلغي',
    statusFilter: 'الحالة',
    allTypes: 'كل الأنواع',
    allStatuses: 'كل الحالات',
    showing: 'عرض {from}–{to} من {total}',
    previous: 'السابق',
    next: 'التالي',
    dateRangeInvalid: 'تاريخ البداية بعد تاريخ النهاية.',
  },
};

export const DocumentsScreen: React.FC = () => {
  const { locale } = useI18n();
  const text = COPY[locale];
  const { user } = useSession();
  const token = user?.token ?? '';
  const { identity: printIdentity } = useOfficialDocumentContext(token);
  const errorText = useErrorText();

  const [activeTab, setActiveTab] = useState<ActiveTab>('DOCUMENTS');

  // Documents state
  const [docFilters, setDocFilters] = useState<{
    dateFrom: string;
    dateTo: string;
    documentType: string;
    status: string;
    search: string;
  }>({ dateFrom: daysAgoIso(29), dateTo: todayIso(), documentType: '', status: '', search: '' });
  const [docSearchInput, setDocSearchInput] = useState<string>('');
  const [docPage, setDocPage] = useState<number>(0);
  const [docResult, setDocResult] = useState<DocumentSearchResult | null>(null);
  const [docLoading, setDocLoading] = useState<boolean>(true);
  const [docError, setDocError] = useState<string | null>(null);

  // Reports state
  const [reportFilter, setReportFilter] = useState<DocumentReportFilter>({});
  const [reportResult, setReportResult] = useState<BusinessDocumentReportResult | null>(null);
  const [reportLoading, setReportLoading] = useState<boolean>(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [downloadingReportPdf, setDownloadingReportPdf] = useState<boolean>(false);

  // Modals state
  const [inspectDocId, setInspectDocId] = useState<number | null>(null);
  const [selectedPrintable, setSelectedPrintable] = useState<PrintableDocument | null>(null);
  const [selectedJournalDocId, setSelectedJournalDocId] = useState<number | null>(null);

  // Debounce free-text search into the filter object (400ms).
  useEffect(() => {
    const handle = setTimeout(() => {
      setDocFilters((f) => (f.search === docSearchInput ? f : { ...f, search: docSearchInput }));
      setDocPage(0);
    }, 400);
    return () => clearTimeout(handle);
  }, [docSearchInput]);

  const docDateRangeInvalid =
    !!docFilters.dateFrom && !!docFilters.dateTo && docFilters.dateFrom > docFilters.dateTo;

  // Load Documents Registry (server-side filters + pagination)
  const loadDocuments = useCallback(async () => {
    if (!token) return;
    if (docDateRangeInvalid) {
      setDocResult(null);
      setDocError(null);
      setDocLoading(false);
      return;
    }
    setDocLoading(true);
    setDocError(null);
    try {
      const res = await searchBusinessDocuments(token, {
        date_from: docFilters.dateFrom || null,
        date_to: docFilters.dateTo || null,
        document_type: docFilters.documentType || null,
        status: (docFilters.status || null) as DocumentSearchFilter['status'],
        search: docFilters.search.trim() || null,
        limit: 50,
        offset: docPage * 50,
      });
      setDocResult(res);
    } catch (err) {
      setDocError(errorText(err));
    } finally {
      setDocLoading(false);
    }
  }, [token, errorText, docFilters, docPage, docDateRangeInvalid]);

  // Load Reports
  const loadReports = useCallback(async () => {
    if (!token) return;
    setReportLoading(true);
    setReportError(null);
    try {
      const res = await getBusinessDocumentReports(token, reportFilter);
      setReportResult(res);
    } catch (err) {
      setReportError(errorText(err));
    } finally {
      setReportLoading(false);
    }
  }, [token, reportFilter, errorText]);

  useEffect(() => {
    if (activeTab === 'DOCUMENTS') {
      void loadDocuments();
    } else {
      void loadReports();
    }
  }, [activeTab, loadDocuments, loadReports]);

  // Handle deterministic refresh
  const handleRefresh = () => {
    if (activeTab === 'DOCUMENTS') {
      void loadDocuments();
    } else {
      void loadReports();
    }
  };

  const buildReportModel = () => {
    if (!reportResult || !printIdentity) return null;

    const repSummary = reportResult.summary;
    const repRows = reportResult.rows || [];
    const repTypeAmounts = repSummary?.type_amounts || [];

    const dateRangeStr = reportFilter.date_from || reportFilter.date_to
      ? `${reportFilter.date_from ? formatDisplayDate(reportFilter.date_from, locale) : '—'} — ${reportFilter.date_to ? formatDisplayDate(reportFilter.date_to, locale) : '—'}`
      : text.allDates ?? '—';

    const reportTitle =
      locale === 'fr'
        ? "Rapport d'activité des documents"
        : locale === 'ar'
          ? 'تقرير نشاط المستندات التجارية'
          : 'Business Documents Activity Report';

    return buildDocumentsReportModel(
      {
        title: reportTitle,
        documentNumber: `RAP-${new Date().toISOString().slice(0, 10)}`,
        documentDateText: formatDisplayDate(new Date().toISOString(), locale),
        periodText: dateRangeStr,
        totalCountText: `${repSummary?.total_count || 0} ${text.totalDocs}`,
        rows: repRows.map((row) => ({
          number: row.document_number ?? `#${row.document_id}`,
          type: humanDocumentType(row.document_type, locale),
          date: formatDisplayDate(row.document_date, locale),
          party: row.party_name || '—',
          amount: row.amount ? formatDisplayAmount(row.amount) : '—',
          status: humanStatus(row.status, locale),
        })),
        typeAmounts: repTypeAmounts.map((ta) => ({
          label: `${humanDocumentType(ta.type, locale)} (${ta.count})`,
          value: formatDisplayAmount(ta.total_amount),
        })),
      },
      printIdentity.printLocale,
    );
  };

  const handlePrintReportA4 = () => {
    const model = buildReportModel();
    if (!model || !printIdentity) return;
    printDocumentA4(renderOfficialDocumentHtml(model, printIdentity));
  };

  const handleDownloadReportPdf = async () => {
    if (downloadingReportPdf) return;
    const model = buildReportModel();
    if (!model || !printIdentity) return;
    try {
      setDownloadingReportPdf(true);
      const bytes = await renderOfficialDocumentPdf(model, printIdentity);
      const todayStr = new Date().toISOString().slice(0, 10);
      await saveDocumentFileWithDialog({
        defaultFileName: `Rapport_Documents_${todayStr}.pdf`,
        bytes,
        filterName: 'PDF Document',
        extension: 'pdf',
      });
    } catch (err) {
      console.error('Download report PDF failed:', err);
    } finally {
      setDownloadingReportPdf(false);
    }
  };


  const docRows = docResult?.rows ?? [];
  const docTotal = docResult?.total_count ?? 0;
  const docFrom = docPage * 50 + 1;
  const docTo = docPage * 50 + docRows.length;

  const resetDocFilters = () => {
    setDocFilters({ dateFrom: daysAgoIso(29), dateTo: todayIso(), documentType: '', status: '', search: '' });
    setDocSearchInput('');
    setDocPage(0);
  };

  const summary = reportResult?.summary;
  const reportRows = reportResult?.rows || [];
  const typeAmounts = summary?.type_amounts || [];

  return (
    <div className="sk-screen" data-testid="documents-screen">
      {/* SCREEN HEADER */}
      <header className="sk-screen__header">
        <div>
          <h1 className="sk-screen__title">{text.title}</h1>
          <p className="sk-screen__subtitle">{text.subtitle}</p>
        </div>
        <Button variant="secondary" onClick={handleRefresh} disabled={docLoading || reportLoading}>
          {text.refresh}
        </Button>
      </header>

      {/* VIEW SWITCHER COMPONENT */}
      <nav
        className="sk-view-switcher"
        role="tablist"
        aria-label={text.title}
        data-testid="documents-view-switcher"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'DOCUMENTS'}
          className={`sk-view-switcher__item ${
            activeTab === 'DOCUMENTS' ? 'sk-view-switcher__item--active' : ''
          }`}
          onClick={() => setActiveTab('DOCUMENTS')}
          data-testid="tab-documents-registry"
        >
          {text.tabDocuments}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'REPORTS'}
          className={`sk-view-switcher__item ${
            activeTab === 'REPORTS' ? 'sk-view-switcher__item--active' : ''
          }`}
          onClick={() => setActiveTab('REPORTS')}
          data-testid="tab-documents-reports"
        >
          {text.tabReports}
        </button>
      </nav>

      {/* TAB 1: DOCUMENTS REGISTRY */}
      {activeTab === 'DOCUMENTS' && (
        <div className="sk-screen__content">
          <div className="sk-reports-filter-card" style={{ marginBottom: '18px' }}>
            <div className="sk-reports-filter-grid">
              <div className="sk-reports-filter-cell sk-reports-filter-cell--col-2">
                <span className="sk-reports-filter-label">{text.dateFrom}</span>
                <input
                  type="date"
                  value={docFilters.dateFrom}
                  onChange={(e) => {
                    setDocFilters((f) => ({ ...f, dateFrom: e.target.value }));
                    setDocPage(0);
                  }}
                  className="sk-field__input"
                  data-testid="doc-filter-date-from"
                />
              </div>
              <div className="sk-reports-filter-cell sk-reports-filter-cell--col-2">
                <span className="sk-reports-filter-label">{text.dateTo}</span>
                <input
                  type="date"
                  value={docFilters.dateTo}
                  onChange={(e) => {
                    setDocFilters((f) => ({ ...f, dateTo: e.target.value }));
                    setDocPage(0);
                  }}
                  className="sk-field__input"
                  data-testid="doc-filter-date-to"
                />
              </div>
              <div className="sk-reports-filter-cell sk-reports-filter-cell--col-3">
                <span className="sk-reports-filter-label">{text.type}</span>
                <select
                  value={docFilters.documentType}
                  onChange={(e) => {
                    setDocFilters((f) => ({ ...f, documentType: e.target.value }));
                    setDocPage(0);
                  }}
                  className="sk-field__input"
                  data-testid="doc-filter-type"
                >
                  <option value="">{text.allTypes}</option>
                  {DOC_TYPE_OPTIONS.map((t) => (
                    <option key={t} value={t}>
                      {humanDocumentType(t, locale)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sk-reports-filter-cell sk-reports-filter-cell--col-2">
                <span className="sk-reports-filter-label">{text.statusFilter}</span>
                <select
                  value={docFilters.status}
                  onChange={(e) => {
                    setDocFilters((f) => ({ ...f, status: e.target.value }));
                    setDocPage(0);
                  }}
                  className="sk-field__input"
                  data-testid="doc-filter-status"
                >
                  <option value="">{text.allStatuses}</option>
                  <option value="POSTED">{humanStatus('POSTED', locale)}</option>
                  <option value="REVERSED">{humanStatus('REVERSED', locale)}</option>
                  <option value="DRAFT">{humanStatus('DRAFT', locale)}</option>
                </select>
              </div>
              <div className="sk-reports-filter-cell sk-reports-filter-cell--col-12">
                <span className="sk-reports-filter-label">{text.search}</span>
                <input
                  type="text"
                  placeholder={text.searchPlaceholder}
                  value={docSearchInput}
                  onChange={(e) => setDocSearchInput(e.target.value)}
                  className="sk-field__input"
                  data-testid="doc-filter-search"
                />
              </div>
            </div>
            <div className="sk-reports-filter-actions">
              <Button variant="secondary" onClick={resetDocFilters} data-testid="doc-filter-reset">
                {text.reset}
              </Button>
            </div>
          </div>

          {docDateRangeInvalid && (
            <div className="sk-banner sk-banner--error" style={{ marginBottom: '18px' }}>
              {text.dateRangeInvalid}
            </div>
          )}

          {docError && (
            <div className="sk-banner sk-banner--error" style={{ marginBottom: '18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{docError}</span>
                <Button variant="secondary" onClick={() => void loadDocuments()}>
                  {text.retry}
                </Button>
              </div>
            </div>
          )}

          {docLoading ? (
            <Spinner />
          ) : !docError && !docDateRangeInvalid && docRows.length === 0 ? (
            <div className="sk-empty-card">
              <h3 className="sk-empty-card__title">{text.emptyTitle}</h3>
              <p className="sk-empty-card__sub">{text.emptySub}</p>
            </div>
          ) : !docError && !docDateRangeInvalid ? (
            <div className="sk-card">
              <div className="sk-table-wrap">
                <table className="sk-table" data-testid="printable-documents-table">
                  <thead>
                    <tr>
                      <th>{text.number}</th>
                      <th>{text.type}</th>
                      <th>{text.date}</th>
                      <th>{text.party}</th>
                      <th className="sk-num">{text.amount}</th>
                      <th>{text.status}</th>
                      <th>{text.recordedBy}</th>
                      <th>{text.journal}</th>
                      <th>{text.action}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {docRows.map((doc) => (
                      <tr key={doc.document_id}>
                        <td>
                          <strong>{doc.document_number ?? `#${doc.document_id}`}</strong>
                          {doc.reversed_by_document_number ? (
                            <div className="sk-muted sk-small">
                              {text.cancelledBy} {doc.reversed_by_document_number}
                            </div>
                          ) : doc.reverses_document_number ? (
                            <div className="sk-muted sk-small">
                              {text.cancels} {doc.reverses_document_number}
                            </div>
                          ) : null}
                        </td>
                        <td>{humanDocumentType(doc.document_type, locale)}</td>
                        <td>
                          {formatDisplayDate(doc.document_date, locale)}
                          {doc.posted_at ? (
                            <span className="sk-muted sk-small">
                              {' '}
                              {new Date(doc.posted_at).toISOString().slice(11, 16)}
                            </span>
                          ) : null}
                        </td>
                        <td>
                          {doc.party_name ??
                            (doc.document_type === 'CASH_SALE' ? text.walkIn : '—')}
                        </td>
                        <td className="sk-num">
                          {doc.amount ? formatDisplayAmount(doc.amount) : '—'}
                        </td>
                        <td>
                          <span
                            className={`sk-badge ${
                              doc.status === 'POSTED'
                                ? 'sk-badge--success'
                                : doc.status === 'DRAFT'
                                ? 'sk-badge--warning'
                                : 'sk-badge--secondary'
                            }`}
                          >
                            {humanStatus(doc.status, locale)}
                          </span>
                        </td>
                        <td>
                          {doc.created_by_username ?? '—'}
                          {doc.created_on_workstation_id ? (
                            <div className="sk-muted sk-small">{doc.created_on_workstation_id}</div>
                          ) : null}
                        </td>
                        <td>
                          {doc.linked_journal_id ? (
                            <button
                              type="button"
                              onClick={() => setSelectedJournalDocId(doc.linked_journal_id)}
                              className="sk-btn sk-btn--secondary sk-button--small"
                              style={{ fontFamily: 'monospace' }}
                            >
                              {doc.linked_journal_number ?? `JE #${doc.linked_journal_id}`}
                            </button>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>
                          <Button
                            variant="secondary"
                            onClick={() => {
                              setInspectDocId(doc.document_id);
                              if (
                                ['CASH_SALE', 'CREDIT_SALE', 'CUSTOMER_PAYMENT'].includes(
                                  doc.document_type
                                )
                              ) {
                                setSelectedPrintable(doc as unknown as PrintableDocument);
                              }
                            }}
                            data-testid={`view-doc-${doc.document_id}`}
                          >
                            {text.view}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div
                className="sk-form-row"
                style={{ padding: '12px 16px', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <span className="sk-muted sk-small">
                  {text.showing
                    .replace('{from}', String(docRows.length ? docFrom : 0))
                    .replace('{to}', String(docTo))
                    .replace('{total}', String(docTotal))}
                </span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <Button
                    variant="secondary"
                    disabled={docPage === 0}
                    onClick={() => setDocPage((p) => Math.max(0, p - 1))}
                    data-testid="doc-page-prev"
                  >
                    {text.previous}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={docTo >= docTotal}
                    onClick={() => setDocPage((p) => p + 1)}
                    data-testid="doc-page-next"
                  >
                    {text.next}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* TAB 2: BUSINESS DOCUMENTS REPORTS */}
      {activeTab === 'REPORTS' && (
        <div className="sk-screen__content">
          {/* RESPONSIVE FILTER CARD */}
          <div className="sk-reports-filter-card">
            <div className="sk-reports-filter-grid">
              {/* FROM DATE */}
              <div className="sk-reports-filter-cell sk-reports-filter-cell--col-2">
                <span className="sk-reports-filter-label">{text.dateFrom}</span>
                <input
                  type="date"
                  value={reportFilter.date_from || ''}
                  onChange={(e) =>
                    setReportFilter((f) => ({ ...f, date_from: e.target.value || undefined }))
                  }
                  className="sk-field__input"
                  data-testid="report-filter-date-from"
                />
              </div>

              {/* TO DATE */}
              <div className="sk-reports-filter-cell sk-reports-filter-cell--col-2">
                <span className="sk-reports-filter-label">{text.dateTo}</span>
                <input
                  type="date"
                  value={reportFilter.date_to || ''}
                  onChange={(e) =>
                    setReportFilter((f) => ({ ...f, date_to: e.target.value || undefined }))
                  }
                  className="sk-field__input"
                  data-testid="report-filter-date-to"
                />
              </div>

              {/* DOCUMENT TYPE */}
              <div className="sk-reports-filter-cell sk-reports-filter-cell--col-3">
                <span className="sk-reports-filter-label">{text.type}</span>
                <select
                  value={reportFilter.document_type || ''}
                  onChange={(e) =>
                    setReportFilter((f) => ({ ...f, document_type: e.target.value || undefined }))
                  }
                  className="sk-field__input"
                  data-testid="report-filter-type"
                >
                  <option value="">{text.filterAll}</option>
                  <option value="PURCHASE_ORDER">{humanDocumentType('PURCHASE_ORDER', locale)}</option>
                  <option value="PURCHASE_RECEIPT">{humanDocumentType('PURCHASE_RECEIPT', locale)}</option>
                  <option value="SUPPLIER_INVOICE">{humanDocumentType('SUPPLIER_INVOICE', locale)}</option>
                  <option value="PURCHASE_RETURN">{humanDocumentType('PURCHASE_RETURN', locale)}</option>
                  <option value="SUPPLIER_PAYMENT">{humanDocumentType('SUPPLIER_PAYMENT', locale)}</option>
                  <option value="CASH_SALE">{humanDocumentType('CASH_SALE', locale)}</option>
                  <option value="CREDIT_SALE">{humanDocumentType('CREDIT_SALE', locale)}</option>
                  <option value="CUSTOMER_PAYMENT">{humanDocumentType('CUSTOMER_PAYMENT', locale)}</option>
                </select>
              </div>

              {/* STATUS */}
              <div className="sk-reports-filter-cell sk-reports-filter-cell--col-2">
                <span className="sk-reports-filter-label">{text.status}</span>
                <select
                  value={reportFilter.status || ''}
                  onChange={(e) =>
                    setReportFilter((f) => ({ ...f, status: e.target.value || undefined }))
                  }
                  className="sk-field__input"
                  data-testid="report-filter-status"
                >
                  <option value="">{text.filterAll}</option>
                  <option value="POSTED">{humanStatus('POSTED', locale)}</option>
                  <option value="DRAFT">{humanStatus('DRAFT', locale)}</option>
                  <option value="REVERSED">{humanStatus('REVERSED', locale)}</option>
                </select>
              </div>

              {/* JOURNAL LINK */}
              <div className="sk-reports-filter-cell sk-reports-filter-cell--col-3">
                <span className="sk-reports-filter-label">{text.journalFilter}</span>
                <select
                  value={
                    reportFilter.has_journal === undefined ? '' : String(reportFilter.has_journal)
                  }
                  onChange={(e) =>
                    setReportFilter((f) => ({
                      ...f,
                      has_journal:
                        e.target.value === '' ? undefined : e.target.value === 'true',
                    }))
                  }
                  className="sk-field__input"
                  data-testid="report-filter-journal"
                >
                  <option value="">{text.allJournals}</option>
                  <option value="true">{text.withJournal}</option>
                  <option value="false">{text.withoutJournal}</option>
                </select>
              </div>

              {/* SEARCH */}
              <div className="sk-reports-filter-cell sk-reports-filter-cell--col-12">
                <span className="sk-reports-filter-label">{text.search}</span>
                <input
                  type="text"
                  placeholder={text.searchPlaceholder}
                  value={reportFilter.search || ''}
                  onChange={(e) =>
                    setReportFilter((f) => ({ ...f, search: e.target.value || undefined }))
                  }
                  className="sk-field__input"
                  data-testid="report-filter-search"
                />
              </div>
            </div>

            <div className="sk-reports-filter-actions" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {reportRows.length > 0 && (
                <>
                  <Button variant="primary" onClick={handlePrintReportA4}>
                    🖨️ {text.printReportA4}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={handleDownloadReportPdf}
                    disabled={downloadingReportPdf}
                  >
                    {downloadingReportPdf ? text.downloading : `📄 ${text.downloadReportPdf}`}
                  </Button>
                </>
              )}
              <Button
                variant="secondary"
                onClick={() => setReportFilter({})}
                data-testid="report-filter-reset"
              >
                {text.reset}
              </Button>
            </div>
          </div>

          {/* MUTUALLY EXCLUSIVE STATE MACHINE */}
          {reportLoading ? (
            <Spinner />
          ) : reportError ? (
            /* ERROR STATE */
            <div className="sk-banner sk-banner--error" style={{ marginBottom: '18px' }} role="alert">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{text.errorTitle}</span>
                <Button variant="secondary" onClick={loadReports}>
                  {text.retry}
                </Button>
              </div>
            </div>
          ) : reportRows.length === 0 ? (
            /* EMPTY STATE */
            <div className="sk-empty-card" data-testid="report-empty-state">
              <h3 className="sk-empty-card__title">{text.emptyTitle}</h3>
              <p className="sk-empty-card__sub">{text.emptySub}</p>
              <Button variant="secondary" onClick={() => setReportFilter({})}>
                {text.reset}
              </Button>
            </div>
          ) : (
            /* SUCCESS WITH DATA */
            <>
              {/* SUMMARY CARDS */}
              {summary && (
                <div className="sk-reports-summary-grid">
                  <div className="sk-reports-summary-card">
                    <span className="sk-reports-summary-card__label">{text.totalDocs}</span>
                    <span className="sk-reports-summary-card__val">{summary.total_count}</span>
                  </div>
                  <div className="sk-reports-summary-card">
                    <span className="sk-reports-summary-card__label">{text.postedDocs}</span>
                    <span className="sk-reports-summary-card__val" style={{ color: 'var(--sk-ok)' }}>
                      {summary.posted_count}
                    </span>
                  </div>
                  <div className="sk-reports-summary-card">
                    <span className="sk-reports-summary-card__label">{text.draftDocs}</span>
                    <span className="sk-reports-summary-card__val" style={{ color: 'var(--sk-warn)' }}>
                      {summary.draft_count}
                    </span>
                  </div>
                  <div className="sk-reports-summary-card">
                    <span className="sk-reports-summary-card__label">{text.reversedDocs}</span>
                    <span className="sk-reports-summary-card__val" style={{ color: 'var(--sk-muted)' }}>
                      {summary.reversed_count}
                    </span>
                  </div>
                  <div className="sk-reports-summary-card">
                    <span className="sk-reports-summary-card__label">{text.withJournalDocs}</span>
                    <span className="sk-reports-summary-card__val">{summary.linked_journal_count}</span>
                  </div>
                  <div className="sk-reports-summary-card">
                    <span className="sk-reports-summary-card__label">{text.withoutJournalDocs}</span>
                    <span className="sk-reports-summary-card__val">{summary.unlinked_journal_count}</span>
                  </div>
                </div>
              )}

              {/* DOCUMENT TYPE BREAKDOWN & MONETARY TOTALS */}
              {typeAmounts.length > 0 && (
                <div className="sk-card" style={{ marginBottom: '22px' }}>
                  <h3 className="sk-detail-dialog__section-title" style={{ padding: '16px 20px 8px' }}>
                    {text.breakdown}
                  </h3>
                  <p className="sk-muted" style={{ padding: '0 20px 14px', fontSize: '0.8rem' }}>
                    {text.nonAdditiveNotice}
                  </p>
                  <div className="sk-table-wrap sk-table-wrap--flat">
                    <table className="sk-table">
                      <thead>
                        <tr>
                          <th>{text.type}</th>
                          <th className="sk-num">{text.totalAmount}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {typeAmounts.map((ta) => (
                          <tr key={ta.type}>
                            <td>
                              <strong>{humanDocumentType(ta.type, locale)}</strong>
                              <span className="sk-muted" style={{ marginInlineStart: '8px', fontSize: '0.8rem' }}>
                                ({ta.semantic_label})
                              </span>
                            </td>
                            <td className="sk-num">
                              <strong>{formatDisplayAmount(ta.total_amount)}</strong>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* REPORT RESULTS TABLE */}
              <div className="sk-card">
                <div className="sk-table-wrap">
                  <table className="sk-table" data-testid="business-documents-report-table">
                    <thead>
                      <tr>
                        <th>{text.number}</th>
                        <th>{text.type}</th>
                        <th>{text.date}</th>
                        <th>{text.status}</th>
                        <th>{text.party}</th>
                        <th className="sk-num">{text.totalAmount}</th>
                        <th>{text.journal}</th>
                        <th>{text.action}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportRows.map((row) => (
                        <tr key={row.document_id}>
                          <td>
                            <strong>{row.document_number ?? `#${row.document_id}`}</strong>
                          </td>
                          <td>{humanDocumentType(row.document_type, locale)}</td>
                          <td>{formatDisplayDate(row.document_date, locale)}</td>
                          <td>
                            <span
                              className={`sk-badge ${
                                row.status === 'POSTED'
                                  ? 'sk-badge--success'
                                  : row.status === 'DRAFT'
                                  ? 'sk-badge--warning'
                                  : 'sk-badge--secondary'
                              }`}
                            >
                              {humanStatus(row.status, locale)}
                            </span>
                          </td>
                          <td>{row.party_name || '—'}</td>
                          <td className="sk-num">
                            {row.amount ? formatDisplayAmount(row.amount) : '—'}
                          </td>
                          <td>
                            {row.linked_journal_id ? (
                              <button
                                type="button"
                                onClick={() => setSelectedJournalDocId(row.linked_journal_id)}
                                className="sk-btn sk-btn--secondary sk-button--small"
                                style={{ fontFamily: 'monospace' }}
                              >
                                {row.linked_journal_number ?? `JE #${row.linked_journal_id}`}
                              </button>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td>
                            <Button
                              variant="secondary"
                              onClick={() => setInspectDocId(row.document_id)}
                            >
                              {text.view}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* INSPECTION DETAIL MODAL */}
      {inspectDocId && (
        <BusinessDocumentDetailModal
          documentId={inspectDocId}
          onClose={() => setInspectDocId(null)}
        />
      )}

      {/* CUSTOMER PRINT MODAL */}
      {selectedPrintable && (
        <div
          className="sk-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedPrintable(null);
          }}
        >
          <div className="sk-detail-dialog">
            <header className="sk-detail-dialog__header">
              <h2 className="sk-detail-dialog__title">
                {selectedPrintable.document_number ?? `#${selectedPrintable.document_id}`}
              </h2>
              <button
                type="button"
                className="sk-modal-close"
                onClick={() => setSelectedPrintable(null)}
                aria-label="Close"
              >
                ×
              </button>
            </header>
            <div className="sk-detail-dialog__body">
              <CustomerDocumentView
                document={selectedPrintable}
                onChanged={() => void loadDocuments()}
              />
            </div>
            <footer className="sk-detail-dialog__footer">
              <Button variant="secondary" onClick={() => setSelectedPrintable(null)}>
                {text.reset}
              </Button>
            </footer>
          </div>
        </div>
      )}

      {/* LINKED JOURNAL MODAL */}
      {selectedJournalDocId && (
        <JournalDetailModal
          journalDocId={selectedJournalDocId}
          onClose={() => setSelectedJournalDocId(null)}
        />
      )}
    </div>
  );
};
