import { useCallback, useEffect, useState } from 'react';

import { Banner, Button, Spinner } from '../../shared/components';
import { useErrorText } from '../../shared/hooks/useErrorText';
import { useI18n, type Locale } from '../../shared/i18n';
import { getJournalDetail, searchJournals } from '../../shared/ipc/gateway';
import type { JournalDetail, JournalLineDto, JournalSearchResult } from '../../shared/ipc/dto';

const ACCOUNT_TRANSLATIONS: Record<string, { scf: string; ar: string; fr: string; en: string }> = {
  INVENTORY_MERCHANDISE: {
    scf: '30',
    ar: 'مخزون البضائع',
    fr: 'Stocks de marchandises',
    en: 'Merchandise inventory',
  },
  GOODS_RECEIVED_NOT_INVOICED: {
    scf: '408',
    ar: 'موردون - فواتير لم تصل بعد',
    fr: 'Fournisseurs - factures non parvenues',
    en: 'Suppliers - invoices not received',
  },
  ACCOUNTS_PAYABLE: {
    scf: '401',
    ar: 'موردو المخزون والخدمات',
    fr: 'Fournisseurs de stocks et services',
    en: 'Trade suppliers',
  },
  ACCOUNTS_RECEIVABLE: {
    scf: '411',
    ar: 'الزبائن',
    fr: 'Clients',
    en: 'Customers',
  },
  TAX_PAYABLE: {
    scf: '445',
    ar: 'الدولة - ضرائب على المبيعات',
    fr: 'État - taxes sur le chiffre d’affaires',
    en: 'State - turnover taxes',
  },
  OTHER_ASSET: {
    scf: '462',
    ar: 'مدينون متنوعون',
    fr: 'Débiteurs divers',
    en: 'Sundry debtors',
  },
  OTHER_LIABILITY: {
    scf: '463',
    ar: 'دائنون متنوعون',
    fr: 'Créditeurs divers',
    en: 'Sundry creditors',
  },
  BANK_ACCOUNT: {
    scf: '512',
    ar: 'البنوك - حسابات جارية',
    fr: 'Banques - comptes courants',
    en: 'Banks - current accounts',
  },
  CASH_DESK: {
    scf: '530',
    ar: 'الصندوق',
    fr: 'Caisse',
    en: 'Cash on hand',
  },
  CASH: {
    scf: '530',
    ar: 'الصندوق',
    fr: 'Caisse',
    en: 'Cash on hand',
  },
  COGS: {
    scf: '600',
    ar: 'تكلفة البضاعة المباعة',
    fr: 'Achats de marchandises vendues',
    en: 'Cost of goods sold',
  },
  PROCUREMENT_VARIANCE: {
    scf: '658',
    ar: 'فروقات الشراء والتكاليف الملحقة',
    fr: 'Autres charges opérationnelles',
    en: 'Procurement variance',
  },
  SALES_REVENUE: {
    scf: '700',
    ar: 'مبيعات البضائع',
    fr: 'Ventes de marchandises',
    en: 'Sales of goods',
  },
  OWNER_CAPITAL: {
    scf: '101',
    ar: 'رأس المال',
    fr: 'Capital émis',
    en: 'Issued capital',
  },
  RETAINED_EARNINGS: {
    scf: '110',
    ar: 'الأرباح المرحلة',
    fr: 'Report à nouveau',
    en: 'Retained earnings',
  },
  LOAN_PAYABLE: {
    scf: '164',
    ar: 'قروض مؤسسات القرض',
    fr: 'Emprunts auprès des établissements de crédit',
    en: 'Loans from credit institutions',
  },
  INVENTORY_ADJUSTMENT_GAIN: {
    scf: '758',
    ar: 'فائض تسوية المخزون',
    fr: 'Produits exceptionnels de gestion',
    en: 'Inventory adjustment gain',
  },
  INVENTORY_ADJUSTMENT_LOSS: {
    scf: '658',
    ar: 'عجز تسوية المخزون',
    fr: 'Charges exceptionnelles de gestion',
    en: 'Inventory adjustment loss',
  },
  PURCHASE_RETURN_CLEARING: {
    scf: '409',
    ar: 'تسوية مردودات المشتريات',
    fr: 'Fournisseurs débiteurs',
    en: 'Supplier debit clearing',
  },
  CUSTOMER_ADVANCE: {
    scf: '419',
    ar: 'تسبيقات الزبائن',
    fr: 'Clients créditeurs',
    en: 'Customer advances',
  },
};

function accountLineLabel(line: JournalLineDto, locale: Locale): string {
  const trans = ACCOUNT_TRANSLATIONS[line.account_code];
  const scf = line.scf_code || trans?.scf;
  const rawLocalized =
    (locale === 'ar' ? line.name_ar : locale === 'en' ? line.name_en : line.name_fr) ||
    line.name_fr;
  const name =
    rawLocalized && rawLocalized !== line.account_code
      ? rawLocalized
      : trans?.[locale] || rawLocalized || line.account_code;

  return scf ? `${scf} · ${name}` : name;
}

function translateWorkstation(workstationId: string | null | undefined, locale: Locale): string {
  if (!workstationId) return '—';
  const clean = workstationId.trim().toUpperCase();
  const MAP: Record<string, Record<Locale, string>> = {
    'DIRECT-PURCHASE': { en: 'Direct Purchase', fr: 'Achat direct', ar: 'شراء مباشر' },
    'DIRECT_PURCHASE': { en: 'Direct Purchase', fr: 'Achat direct', ar: 'شراء مباشر' },
    'POS': { en: 'POS Terminal', fr: 'Poste caisse', ar: 'نقطة البيع' },
    'POS-SALE': { en: 'POS Sale', fr: 'Vente caisse', ar: 'مبيعات نقطة البيع' },
    'STOCK-ADJUSTMENT': { en: 'Inventory Adjustment', fr: 'Ajustement de stock', ar: 'تسوية المخزون' },
  };
  return MAP[clean]?.[locale] ?? workstationId;
}

function translateJournalDescription(desc: string | null | undefined, locale: Locale): string {
  if (!desc) return '';
  const trimmed = desc.trim();
  const MAP: Record<string, Record<Locale, string>> = {
    'Direct Purchase acceptance': {
      en: 'Direct Purchase acceptance',
      fr: 'Acceptation d’achat direct',
      ar: 'قبول الشراء المباشر',
    },
    'Direct purchase receipt': {
      en: 'Direct purchase receipt',
      fr: 'Réception d’achat direct',
      ar: 'سند استلام شراء مباشر',
    },
    'Stock adjustment gain': {
      en: 'Stock adjustment gain',
      fr: 'Gain d’ajustement de stock',
      ar: 'فائض تسوية المخزون',
    },
    'Stock adjustment loss': {
      en: 'Stock adjustment loss',
      fr: 'Perte d’ajustement de stock',
      ar: 'عجز تسوية المخزون',
    },
    'Cash sale': {
      en: 'Cash sale',
      fr: 'Vente au comptant',
      ar: 'بيع نقدي',
    },
    'Credit sale': {
      en: 'Credit sale',
      fr: 'Vente à crédit',
      ar: 'بيع بالآجل',
    },
  };
  return MAP[trimmed]?.[locale] ?? desc;
}
import { useSession } from '../../shared/session/SessionContext';
import {
  formatDisplayAmount,
  formatDisplayDate,
  humanDocumentType,
  journalSourceLabel,
} from '../../shared/utils/formatters';
import { printDocumentA4, saveDocumentFileWithDialog } from '../../shared/documents/documentPrintService';
import { renderOfficialDocumentHtml, renderOfficialDocumentPdf } from '../../shared/documents/officialDocument';
import { useOfficialDocumentContext } from '../../shared/documents/useOfficialDocumentContext';
import { buildJournalEntryModel } from '../../shared/documents/models/journalEntryModel';
import { buildJournalsReportModel } from '../../shared/documents/models/journalsReportModel';

const COPY: Record<Locale, Record<string, string>> = {
  en: {
    title: 'Accounting Journals',
    subtitle: 'Immutable posted journal entries and balanced general ledger evidence.',
    refresh: 'Refresh',
    empty: 'No journal entries recorded.',
    journalNumber: 'Journal #',
    date: 'Date',
    sourceType: 'Source Type',
    sourceDocument: 'Source Doc',
    totalDebit: 'Total Debit (DZD)',
    totalCredit: 'Total Credit (DZD)',
    balanced: 'Balanced',
    unbalanced: 'Unbalanced',
    actions: 'Action',
    viewDetail: 'View Lines',
    close: 'Close',
    line: 'Line #',
    accountCode: 'Account Code',
    accountName: 'Account Name',
    debit: 'Debit',
    credit: 'Credit',
    journalLines: 'Journal Entry Lines',
    description: 'Description',
    filterAll: 'All Sources',
    printA4: 'Print A4',
    downloadPdf: 'Download PDF',
    downloading: 'Downloading...',
    dateFrom: 'From Date',
    dateTo: 'To Date',
    search: 'Search',
    searchPlaceholder: 'Journal or source document number…',
    reset: 'Clear Filters',
    recordedBy: 'Recorded by',
    showing: 'Showing {from}–{to} of {total}',
    previous: 'Previous',
    next: 'Next',
    dateRangeInvalid: 'The start date is after the end date.',
    errorTitle: 'Unable to load journals.',
    retry: 'Retry',
  },
  fr: {
    title: 'Journaux comptables',
    subtitle: 'Écritures comptables publiées immuables et pièces justificatives du grand livre.',
    refresh: 'Actualiser',
    empty: 'Aucune écriture comptable enregistrée.',
    journalNumber: 'N° Journal',
    date: 'Date',
    sourceType: 'Type source',
    sourceDocument: 'Doc source',
    totalDebit: 'Total Débit (DZD)',
    totalCredit: 'Total Crédit (DZD)',
    balanced: 'Équilibré',
    unbalanced: 'Déséquilibré',
    actions: 'Action',
    viewDetail: 'Voir lignes',
    close: 'Fermer',
    line: 'Ligne n°',
    accountCode: 'Code compte',
    accountName: 'Intitulé compte',
    debit: 'Débit',
    credit: 'Crédit',
    journalLines: 'Lignes d’écriture du journal',
    description: 'Description',
    filterAll: 'Toutes les sources',
    printA4: 'Imprimer A4',
    downloadPdf: 'Télécharger PDF',
    downloading: 'Téléchargement...',
    dateFrom: 'Date de début',
    dateTo: 'Date de fin',
    search: 'Rechercher',
    searchPlaceholder: 'N° journal ou document source…',
    reset: 'Réinitialiser les filtres',
    recordedBy: 'Saisi par',
    showing: 'Affichage {from}–{to} sur {total}',
    previous: 'Précédent',
    next: 'Suivant',
    dateRangeInvalid: 'La date de début est après la date de fin.',
    errorTitle: 'Impossible de charger les journaux.',
    retry: 'Réessayer',
  },
  ar: {
    title: 'اليومية المحاسبية',
    subtitle: 'قيود اليومية المعتمدة غير القابلة للتعديل وأدلة دفتر الأستاذ المتوازنة.',
    refresh: 'تحديث',
    empty: 'لا توجد قيود يومية مسجلة.',
    journalNumber: 'رقم القيد',
    date: 'التاريخ',
    sourceType: 'نوع المصدر',
    sourceDocument: 'مستند المصدر',
    totalDebit: 'إجمالي المدين (د.ج)',
    totalCredit: 'إجمالي الدائن (د.ج)',
    balanced: 'متوازن',
    unbalanced: 'غير متوازن',
    actions: 'الإجراء',
    viewDetail: 'عرض الأسطر',
    close: 'إغلاق',
    line: 'رقم السطر',
    accountCode: 'رمز الحساب',
    accountName: 'اسم الحساب',
    debit: 'مدين',
    credit: 'دائن',
    journalLines: 'أسطر قيد اليومية',
    description: 'الوصف',
    filterAll: 'جميع المصادر',
    printA4: 'طباعة A4',
    downloadPdf: 'تحميل PDF',
    downloading: 'جارٍ التحميل...',
    dateFrom: 'من تاريخ',
    dateTo: 'إلى تاريخ',
    search: 'بحث',
    searchPlaceholder: 'رقم القيد أو مستند المصدر…',
    reset: 'مسح الفلاتر',
    recordedBy: 'سجّله',
    showing: 'عرض {from}–{to} من {total}',
    previous: 'السابق',
    next: 'التالي',
    dateRangeInvalid: 'تاريخ البداية بعد تاريخ النهاية.',
    errorTitle: 'تعذر تحميل اليومية.',
    retry: 'إعادة المحاولة',
  },
};

interface Props {
  initialJournalId?: number | null;
}

export function JournalsScreen({ initialJournalId }: Props) {
  const { locale } = useI18n();
  const text = COPY[locale];
  const { user } = useSession();
  const errorText = useErrorText();
  const token = user?.token ?? '';
  const { identity: printIdentity } = useOfficialDocumentContext(token);
  const [downloadingReportPdf, setDownloadingReportPdf] = useState(false);

  const [selectedJournal, setSelectedJournal] = useState<JournalDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterSource, setFilterSource] = useState<string>('ALL');

  const todayIso = () => new Date().toISOString().slice(0, 10);
  const daysAgoIso = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  };

  const [filters, setFilters] = useState<{ dateFrom: string; dateTo: string; search: string }>({
    dateFrom: daysAgoIso(29),
    dateTo: todayIso(),
    search: '',
  });
  const [searchInput, setSearchInput] = useState<string>('');
  const [page, setPage] = useState<number>(0);
  const [result, setResult] = useState<JournalSearchResult | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => {
      setFilters((f) => (f.search === searchInput ? f : { ...f, search: searchInput }));
      setPage(0);
    }, 400);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const dateRangeInvalid = !!filters.dateFrom && !!filters.dateTo && filters.dateFrom > filters.dateTo;

  const loadJournals = useCallback(async () => {
    if (!token) return;
    if (dateRangeInvalid) {
      setResult(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await searchJournals(token, {
        date_from: filters.dateFrom || null,
        date_to: filters.dateTo || null,
        source_type: filterSource === 'ALL' ? null : filterSource,
        search: filters.search.trim() || null,
        limit: 50,
        offset: page * 50,
      });
      setResult(data);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }, [token, errorText, filters, filterSource, page, dateRangeInvalid]);

  useEffect(() => {
    void loadJournals();
  }, [loadJournals]);

  const resetFilters = () => {
    setFilters({ dateFrom: daysAgoIso(29), dateTo: todayIso(), search: '' });
    setSearchInput('');
    setFilterSource('ALL');
    setPage(0);
  };

  const viewDetail = useCallback(async (journalDocId: number) => {
    if (!token) return;
    setDetailLoading(true);
    try {
      const detail = await getJournalDetail(token, journalDocId);
      setSelectedJournal(detail);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setDetailLoading(false);
    }
  }, [token, errorText]);

  useEffect(() => {
    if (initialJournalId) {
      void viewDetail(initialJournalId);
    }
  }, [initialJournalId, viewDetail]);

  const rows = result?.rows ?? [];
  const total = result?.total_count ?? 0;
  const from = page * 50 + 1;
  const to = page * 50 + rows.length;
  const sourceTypes = result?.available_source_types ?? [];

  const buildReportModel = () => {
    if (!printIdentity || rows.length === 0) return null;
    const reportTitle =
      locale === 'fr' ? 'Registre des journaux' : locale === 'ar' ? 'سجل اليوميات' : 'Journals Register';
    let totalDebit = 0;
    let totalCredit = 0;
    for (const row of rows) {
      totalDebit += Number(row.total_debit) || 0;
      totalCredit += Number(row.total_credit) || 0;
    }
    return buildJournalsReportModel(
      {
        title: reportTitle,
        documentNumber: `JRN-${new Date().toISOString().slice(0, 10)}`,
        documentDateText: formatDisplayDate(new Date().toISOString(), locale),
        periodText: `${filters.dateFrom || '—'} — ${filters.dateTo || '—'}`,
        totalCountText: `${total}`,
        rows: rows.map((row) => ({
          number: row.document_number ?? `#${row.document_id}`,
          date: formatDisplayDate(row.document_date, locale),
          source: journalSourceLabel(row.source_type, row.source_id, row.source_document_number, locale),
          debit: formatDisplayAmount(row.total_debit),
          credit: formatDisplayAmount(row.total_credit),
        })),
        totalDebit: formatDisplayAmount(String(totalDebit)),
        totalCredit: formatDisplayAmount(String(totalCredit)),
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
        defaultFileName: `Registre_Journaux_${todayStr}.pdf`,
        bytes,
        filterName: 'PDF Document',
        extension: 'pdf',
      });
    } catch (err) {
      console.error('Download journals report PDF failed:', err);
    } finally {
      setDownloadingReportPdf(false);
    }
  };

  return (
    <section className="sk-screen" data-testid="journals-screen">
      <header className="sk-screen__header">
        <div>
          <h1>{text.title}</h1>
          <p className="sk-muted">{text.subtitle}</p>
        </div>
        <div className="sk-form-actions">
          {rows.length > 0 && (
            <>
              <Button variant="secondary" onClick={handlePrintReportA4} data-testid="journals-report-print">
                🖨️ {text.printA4}
              </Button>
              <Button
                variant="secondary"
                onClick={() => void handleDownloadReportPdf()}
                disabled={downloadingReportPdf}
                data-testid="journals-report-download-pdf"
              >
                {downloadingReportPdf ? text.downloading : `📄 ${text.downloadPdf}`}
              </Button>
            </>
          )}
          <Button variant="secondary" onClick={() => void loadJournals()}>
            {text.refresh}
          </Button>
        </div>
      </header>

      {error ? (
        <Banner tone="error">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{error}</span>
            <Button variant="secondary" onClick={() => void loadJournals()}>
              {text.retry}
            </Button>
          </div>
        </Banner>
      ) : null}

      <div className="sk-reports-filter-card">
        <div className="sk-reports-filter-grid">
          <div className="sk-reports-filter-cell sk-reports-filter-cell--col-2">
            <span className="sk-reports-filter-label">{text.dateFrom}</span>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) => {
                setFilters((f) => ({ ...f, dateFrom: e.target.value }));
                setPage(0);
              }}
              className="sk-field__input"
              data-testid="journal-filter-date-from"
            />
          </div>
          <div className="sk-reports-filter-cell sk-reports-filter-cell--col-2">
            <span className="sk-reports-filter-label">{text.dateTo}</span>
            <input
              type="date"
              value={filters.dateTo}
              onChange={(e) => {
                setFilters((f) => ({ ...f, dateTo: e.target.value }));
                setPage(0);
              }}
              className="sk-field__input"
              data-testid="journal-filter-date-to"
            />
          </div>
          <div className="sk-reports-filter-cell sk-reports-filter-cell--col-3">
            <span className="sk-reports-filter-label">{text.sourceType}</span>
            <select
              value={filterSource}
              onChange={(e) => {
                setFilterSource(e.target.value);
                setPage(0);
              }}
              className="sk-field__input"
              data-testid="journal-source-filter"
            >
              <option value="ALL">{text.filterAll}</option>
              {sourceTypes.map((type) => (
                <option key={type} value={type}>
                  {humanDocumentType(type, locale)}
                </option>
              ))}
            </select>
          </div>
          <div className="sk-reports-filter-cell sk-reports-filter-cell--col-12">
            <span className="sk-reports-filter-label">{text.search}</span>
            <input
              type="text"
              placeholder={text.searchPlaceholder}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="sk-field__input"
              data-testid="journal-filter-search"
            />
          </div>
        </div>
        <div className="sk-reports-filter-actions">
          <Button variant="secondary" onClick={resetFilters} data-testid="journal-filter-reset">
            {text.reset}
          </Button>
        </div>
      </div>

      {dateRangeInvalid && <Banner tone="error">{text.dateRangeInvalid}</Banner>}

      {loading ? (
        <Spinner />
      ) : !dateRangeInvalid && rows.length === 0 ? (
        <div className="sk-card sk-muted" data-testid="no-journals">{text.empty}</div>
      ) : !dateRangeInvalid ? (
        <div className="sk-card">
          <div className="sk-table-wrap">
            <table className="sk-table" data-testid="journals-table">
              <thead>
                <tr>
                  <th>{text.journalNumber}</th>
                  <th>{text.date}</th>
                  <th>{text.sourceType}</th>
                  <th>{text.sourceDocument}</th>
                  <th>{text.totalDebit}</th>
                  <th>{text.totalCredit}</th>
                  <th>{text.balanced}</th>
                  <th>{text.recordedBy}</th>
                  <th>{text.actions}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((j) => (
                  <tr key={j.document_id}>
                    <td>
                      <strong>{j.document_number ?? `#${j.document_id}`}</strong>
                    </td>
                    <td>{formatDisplayDate(j.document_date, locale)}</td>
                    <td><span className="sk-badge">{humanDocumentType(j.source_type, locale)}</span></td>
                    <td>{journalSourceLabel(j.source_type, j.source_id, j.source_document_number, locale)}</td>
                    <td className="sk-num"><strong>{formatDisplayAmount(j.total_debit)}</strong></td>
                    <td className="sk-num"><strong>{formatDisplayAmount(j.total_credit)}</strong></td>
                    <td>
                      <span className={`sk-badge ${j.is_balanced ? 'sk-badge--success' : 'sk-badge--danger'}`}>
                        {j.is_balanced ? text.balanced : text.unbalanced}
                      </span>
                    </td>
                    <td>
                      {j.created_by_username ?? '—'}
                      {j.created_on_workstation_id ? (
                        <div className="sk-muted sk-small">{j.created_on_workstation_id}</div>
                      ) : null}
                    </td>
                    <td>
                      <Button
                        variant="secondary"
                        onClick={() => void viewDetail(j.document_id)}
                        disabled={detailLoading}
                        data-testid={`view-journal-${j.document_id}`}
                      >
                        {text.viewDetail}
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
                .replace('{from}', String(rows.length ? from : 0))
                .replace('{to}', String(to))
                .replace('{total}', String(total))}
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <Button
                variant="secondary"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                data-testid="journal-page-prev"
              >
                {text.previous}
              </Button>
              <Button
                variant="secondary"
                disabled={to >= total}
                onClick={() => setPage((p) => p + 1)}
                data-testid="journal-page-next"
              >
                {text.next}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {selectedJournal ? (
        <JournalDetailModal
          journalDocId={selectedJournal.document_id}
          initialDetail={selectedJournal}
          onClose={() => setSelectedJournal(null)}
        />
      ) : null}
    </section>
  );
}

export function JournalDetailModal({
  journalDocId,
  initialDetail,
  onClose,
}: {
  journalDocId: number;
  initialDetail?: JournalDetail | null;
  onClose: () => void;
}) {
  const { locale } = useI18n();
  const text = COPY[locale];
  const { user } = useSession();
  const token = user?.token ?? '';
  const { identity: printIdentity } = useOfficialDocumentContext(token);
  const [detail, setDetail] = useState<JournalDetail | null>(initialDetail ?? null);
  const [loading, setLoading] = useState(!initialDetail);

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
    if (!journalDocId || !token) return;
    if (initialDetail && initialDetail.document_id === journalDocId) {
      setDetail(initialDetail);
      setLoading(false);
      return;
    }
    setLoading(true);
    getJournalDetail(token, journalDocId)
      .then((res) => {
        setDetail(res);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load journal detail:', err);
        setLoading(false);
      });
  }, [journalDocId, token, initialDetail]);

  const [downloadingPdf, setDownloadingPdf] = useState(false);

  const buildModel = () => {
    if (!detail || !printIdentity) return null;
    return buildJournalEntryModel(
      {
        title: locale === 'fr' ? 'Pièce comptable' : locale === 'ar' ? 'سند قيد محاسبي' : 'Journal Voucher',
        documentNumber: detail.document_number ?? `JE-${detail.document_id}`,
        documentDateText: formatDisplayDate(detail.document_date, locale),
        statusText: detail.is_balanced ? text.balanced : text.unbalanced,
        sourceLabel: text.sourceType,
        sourceValue: `${humanDocumentType(detail.source_type, locale)}${detail.source_document_number ? ` · ${detail.source_document_number}` : detail.source_id ? ` · #${detail.source_id}` : ''}`,
        description: translateJournalDescription(detail.description, printIdentity.printLocale),
        lines: detail.lines.map((line) => ({
          account: line.scf_code || ACCOUNT_TRANSLATIONS[line.account_code]?.scf || line.account_code,
          label: accountLineLabel(line, printIdentity.printLocale),
          debit: Number(line.debit) > 0 ? formatDisplayAmount(line.debit) : '—',
          credit: Number(line.credit) > 0 ? formatDisplayAmount(line.credit) : '—',
        })),
        totalDebit: formatDisplayAmount(detail.total_debit),
        totalCredit: formatDisplayAmount(detail.total_credit),
      },
      printIdentity.printLocale,
    );
  };

  const handlePrintA4 = () => {
    const model = buildModel();
    if (!model || !printIdentity) return;
    printDocumentA4(renderOfficialDocumentHtml(model, printIdentity));
  };

  const handleDownloadPdf = async () => {
    if (downloadingPdf) return;
    const model = buildModel();
    if (!model || !printIdentity || !detail) return;
    try {
      setDownloadingPdf(true);
      const bytes = await renderOfficialDocumentPdf(model, printIdentity);
      const safeNum = (detail.document_number ?? `JE-${detail.document_id}`).replace(/[^a-zA-Z0-9_-]/g, '_');
      await saveDocumentFileWithDialog({
        defaultFileName: `Piece_Comptable_${safeNum}.pdf`,
        bytes,
        filterName: 'PDF Document',
        extension: 'pdf',
      });
    } catch (err) {
      console.error('Failed to download journal PDF:', err);
    } finally {
      setDownloadingPdf(false);
    }
  };

  if (!detail && loading) {
    return (
      <div className="sk-modal-overlay" data-testid="journal-detail-modal">
        <div className="sk-detail-dialog" style={{ padding: '32px' }}>
          <Spinner />
        </div>
      </div>
    );
  }

  if (!detail) return null;

  return (
    <div
      className="sk-modal-overlay"
      data-testid="journal-detail-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="sk-detail-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="journal-detail-title"
      >
        {/* HEADER */}
        <header className="sk-detail-dialog__header">
          <div className="sk-detail-dialog__header-copy">
            <span className="sk-detail-dialog__eyebrow">
              {humanDocumentType('JOURNAL_ENTRY', locale)}
            </span>
            <h2 id="journal-detail-title" className="sk-detail-dialog__title">
              {detail.document_number ?? `#${detail.document_id}`}
            </h2>
            <div className="sk-detail-dialog__sub">
              {humanDocumentType(detail.source_type, locale)} ·{' '}
              {journalSourceLabel(detail.source_type, detail.source_id, detail.source_document_number, locale)} ·{' '}
              {formatDisplayDate(detail.document_date, locale)}
            </div>
          </div>
          <div className="sk-detail-dialog__header-actions">
            <span
              className={`sk-badge ${
                detail.is_balanced ? 'sk-badge--success' : 'sk-badge--danger'
              }`}
            >
              {detail.is_balanced ? text.balanced : text.unbalanced}
            </span>
            <button
              type="button"
              className="sk-modal-close"
              onClick={onClose}
              aria-label={text.close}
            >
              ×
            </button>
          </div>
        </header>

        {/* BODY */}
        <div className="sk-detail-dialog__body">
          {/* SUMMARY METRICS GRID */}
          <section className="sk-detail-dialog__summary-grid">
            <div className="sk-detail-dialog__metric-card">
              <span className="sk-detail-dialog__metric-card-label">{text.date}</span>
              <span className="sk-detail-dialog__metric-card-val">
                {formatDisplayDate(detail.document_date, locale)}
              </span>
            </div>

            <div className="sk-detail-dialog__metric-card">
              <span className="sk-detail-dialog__metric-card-label">{text.sourceDocument}</span>
              <span className="sk-detail-dialog__metric-card-val" style={{ fontFamily: 'monospace' }}>
                {journalSourceLabel(detail.source_type, detail.source_id, detail.source_document_number, locale)}
              </span>
            </div>

            <div className="sk-detail-dialog__metric-card">
              <span className="sk-detail-dialog__metric-card-label">{text.totalDebit}</span>
              <span className="sk-detail-dialog__metric-card-val sk-detail-dialog__metric-card-val--money">
                {formatDisplayAmount(detail.total_debit)}
              </span>
            </div>

            <div className="sk-detail-dialog__metric-card">
              <span className="sk-detail-dialog__metric-card-label">{text.totalCredit}</span>
              <span className="sk-detail-dialog__metric-card-val sk-detail-dialog__metric-card-val--money">
                {formatDisplayAmount(detail.total_credit)}
              </span>
            </div>

            <div className="sk-detail-dialog__metric-card">
              <span className="sk-detail-dialog__metric-card-label">{text.recordedBy}</span>
              <span className="sk-detail-dialog__metric-card-val">
                {detail.created_by_username ?? '—'}
                {detail.created_on_workstation_id ? (
                  <div className="sk-muted sk-small">{translateWorkstation(detail.created_on_workstation_id, locale)}</div>
                ) : null}
              </span>
            </div>
          </section>

          {/* DESCRIPTION */}
          {detail.description ? (
            <section className="sk-detail-dialog__section">
              <div className="sk-detail-dialog__field">
                <span className="sk-detail-dialog__field-label">{text.description}</span>
                <span className="sk-detail-dialog__field-val">{translateJournalDescription(detail.description, locale)}</span>
              </div>
            </section>
          ) : null}

          {/* JOURNAL LINES TABLE */}
          <section className="sk-detail-dialog__section">
            <h3 className="sk-detail-dialog__section-title">
              {text.journalLines} ({detail.lines.length})
            </h3>
            <div className="sk-table-wrap">
              <table className="sk-table" data-testid="journal-lines-table">
                <thead>
                  <tr>
                    <th>{text.line}</th>
                    <th>{text.accountName}</th>
                    <th className="sk-num">{text.debit}</th>
                    <th className="sk-num">{text.credit}</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.lines.map((line) => {
                    const hasDebit = Number(line.debit) > 0;
                    const hasCredit = Number(line.credit) > 0;
                    return (
                      <tr key={line.line_number}>
                        <td className="sk-muted">{line.line_number}</td>
                        <td>
                          <strong>{accountLineLabel(line, locale)}</strong>
                        </td>
                        <td className="sk-num">
                          {hasDebit ? (
                            <strong>{formatDisplayAmount(line.debit)}</strong>
                          ) : (
                            <span className="sk-muted">—</span>
                          )}
                        </td>
                        <td className="sk-num">
                          {hasCredit ? (
                            <strong>{formatDisplayAmount(line.credit)}</strong>
                          ) : (
                            <span className="sk-muted">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        {/* FOOTER */}
        <footer className="sk-detail-dialog__footer">
          <Button variant="primary" onClick={handlePrintA4}>
            🖨️ {text.printA4}
          </Button>
          <Button variant="secondary" onClick={handleDownloadPdf} disabled={downloadingPdf}>
            {downloadingPdf ? text.downloading : `📄 ${text.downloadPdf}`}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            {text.close}
          </Button>
        </footer>
      </div>
    </div>
  );
}
