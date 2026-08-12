import React, { useCallback, useEffect, useState } from 'react';
import { Button, Spinner } from '../../shared/components';
import { useErrorText } from '../../shared/hooks/useErrorText';
import { useI18n, type Locale } from '../../shared/i18n';
import {
  listBusinessDocuments,
  getBusinessDocumentReports,
} from '../../shared/ipc/documentGateway';
import type {
  BusinessDocument,
  BusinessDocumentReportResult,
  DocumentReportFilter,
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

type ActiveTab = 'DOCUMENTS' | 'REPORTS';
type CategoryFilter = 'ALL' | 'SALES' | 'PROCUREMENT';

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
    searchPlaceholder: 'Search document number...',
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
    party: 'Party / Counterparty',
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
    searchPlaceholder: 'Rechercher n° document...',
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
    party: 'Tiers / Contrepartie',
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
    searchPlaceholder: 'بحث برقم المستند...',
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
    party: 'الطرف / المتعامل',
  },
};

export const DocumentsScreen: React.FC = () => {
  const { locale } = useI18n();
  const text = COPY[locale];
  const { user } = useSession();
  const token = user?.token ?? '';
  const errorText = useErrorText();

  const [activeTab, setActiveTab] = useState<ActiveTab>('DOCUMENTS');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('ALL');

  // Documents state
  const [documents, setDocuments] = useState<BusinessDocument[]>([]);
  const [docLoading, setDocLoading] = useState<boolean>(true);
  const [docError, setDocError] = useState<string | null>(null);

  // Reports state
  const [reportFilter, setReportFilter] = useState<DocumentReportFilter>({});
  const [reportResult, setReportResult] = useState<BusinessDocumentReportResult | null>(null);
  const [reportLoading, setReportLoading] = useState<boolean>(false);
  const [reportError, setReportError] = useState<string | null>(null);

  // Modals state
  const [inspectDocId, setInspectDocId] = useState<number | null>(null);
  const [selectedPrintable, setSelectedPrintable] = useState<PrintableDocument | null>(null);
  const [selectedJournalDocId, setSelectedJournalDocId] = useState<number | null>(null);

  // Load Documents Registry
  const loadDocuments = useCallback(async () => {
    if (!token) return;
    setDocLoading(true);
    setDocError(null);
    try {
      const rows = await listBusinessDocuments(token, 100);
      setDocuments(rows);
    } catch (err) {
      setDocError(errorText(err));
    } finally {
      setDocLoading(false);
    }
  }, [token, errorText]);

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

  const filteredDocuments = documents.filter((doc) => {
    if (categoryFilter === 'SALES') {
      return ['CASH_SALE', 'CREDIT_SALE', 'CUSTOMER_PAYMENT', 'CUSTOMER_REFUND'].includes(
        doc.document_type
      );
    }
    if (categoryFilter === 'PROCUREMENT') {
      return [
        'PURCHASE_ORDER',
        'PURCHASE_RECEIPT',
        'SUPPLIER_INVOICE',
        'PURCHASE_RETURN',
        'SUPPLIER_PAYMENT',
      ].includes(doc.document_type);
    }
    return true;
  });

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
          <div className="sk-card sk-form-row" style={{ marginBottom: '18px' }}>
            <label className="sk-field">
              <span className="sk-field__label">{text.type}</span>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value as CategoryFilter)}
                className="sk-field__input"
                data-testid="document-category-filter"
              >
                <option value="ALL">{text.filterAll}</option>
                <option value="SALES">{text.filterSales}</option>
                <option value="PROCUREMENT">{text.filterProcurement}</option>
              </select>
            </label>
          </div>

          {docError && (
            <div className="sk-banner sk-banner--error" style={{ marginBottom: '18px' }}>
              {docError}
            </div>
          )}

          {docLoading ? (
            <Spinner />
          ) : filteredDocuments.length === 0 ? (
            <div className="sk-empty-card">
              <p className="sk-empty-card__title">{text.none}</p>
            </div>
          ) : (
            <div className="sk-card">
              <div className="sk-table-wrap">
                <table className="sk-table" data-testid="printable-documents-table">
                  <thead>
                    <tr>
                      <th>{text.number}</th>
                      <th>{text.type}</th>
                      <th>{text.date}</th>
                      <th>{text.status}</th>
                      <th>{text.generation}</th>
                      <th>{text.print}</th>
                      <th>{text.journal}</th>
                      <th>{text.action}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDocuments.map((doc) => (
                      <tr key={doc.document_id}>
                        <td>
                          <strong>{doc.document_number ?? `#${doc.document_id}`}</strong>
                          {doc.detail_summary ? (
                            <div className="sk-muted sk-small">{doc.detail_summary}</div>
                          ) : null}
                        </td>
                        <td>{humanDocumentType(doc.document_type, locale)}</td>
                        <td>{formatDisplayDate(doc.document_date, locale)}</td>
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
                          <span className="sk-badge sk-badge--secondary">
                            {humanStatus(doc.generation_status, locale)}
                          </span>
                        </td>
                        <td>
                          <span className="sk-badge sk-badge--secondary">
                            {humanStatus(doc.print_status, locale)}
                          </span>
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
                                setSelectedPrintable(doc as any);
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
            </div>
          )}
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

            <div className="sk-reports-filter-actions">
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
