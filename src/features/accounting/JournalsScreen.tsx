import { useCallback, useEffect, useState } from 'react';

import { Banner, Button, Spinner } from '../../shared/components';
import { useErrorText } from '../../shared/hooks/useErrorText';
import { useI18n, type Locale } from '../../shared/i18n';
import { getJournalDetail, listJournals } from '../../shared/ipc/gateway';
import type { JournalDetail, JournalSummary } from '../../shared/ipc/dto';
import { useSession } from '../../shared/session/SessionContext';
import {
  formatDisplayAmount,
  formatDisplayDate,
  humanDocumentType,
} from '../../shared/utils/formatters';

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

  const [journals, setJournals] = useState<JournalSummary[]>([]);
  const [selectedJournal, setSelectedJournal] = useState<JournalDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterSource, setFilterSource] = useState<string>('ALL');

  const loadJournals = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await listJournals(token, 100, 0);
      setJournals(data);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }, [token, errorText]);

  useEffect(() => {
    void loadJournals();
  }, [loadJournals]);

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

  const filteredJournals = journals.filter((item) => {
    if (filterSource === 'ALL') return true;
    return item.source_type === filterSource;
  });

  const sourceTypes = Array.from(new Set(journals.map((j) => j.source_type)));

  return (
    <section className="sk-screen" data-testid="journals-screen">
      <header className="sk-screen__header">
        <div>
          <h1>{text.title}</h1>
          <p className="sk-muted">{text.subtitle}</p>
        </div>
        <div className="sk-form-actions">
          <Button variant="secondary" onClick={() => void loadJournals()}>
            {text.refresh}
          </Button>
        </div>
      </header>

      {error ? <Banner tone="error">{error}</Banner> : null}

      <div className="sk-card sk-form-row">
        <label>
          {text.sourceType}
          <select value={filterSource} onChange={(e) => setFilterSource(e.target.value)} data-testid="journal-source-filter">
            <option value="ALL">{text.filterAll}</option>
            {sourceTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <Spinner />
      ) : filteredJournals.length === 0 ? (
        <div className="sk-card sk-muted" data-testid="no-journals">{text.empty}</div>
      ) : (
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
                  <th>{text.actions}</th>
                </tr>
              </thead>
              <tbody>
                {filteredJournals.map((j) => (
                  <tr key={j.document_id}>
                    <td>
                      <strong>{j.document_number ?? `#${j.document_id}`}</strong>
                    </td>
                    <td>{j.document_date}</td>
                    <td><span className="sk-badge">{j.source_type}</span></td>
                    <td>{j.source_document_number ?? (j.source_id ? `#${j.source_id}` : '—')}</td>
                    <td><strong>{j.total_debit}</strong></td>
                    <td><strong>{j.total_credit}</strong></td>
                    <td>
                      <span className={`sk-badge ${j.is_balanced ? 'sk-badge--success' : 'sk-badge--danger'}`}>
                        {j.is_balanced ? text.balanced : text.unbalanced}
                      </span>
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
        </div>
      )}

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
              {detail.source_document_number ?? (detail.source_id ? `#${detail.source_id}` : '—')} ·{' '}
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
                {detail.source_document_number ?? (detail.source_id ? `#${detail.source_id}` : '—')}
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
          </section>

          {/* DESCRIPTION */}
          {detail.description ? (
            <section className="sk-detail-dialog__section">
              <div className="sk-detail-dialog__field">
                <span className="sk-detail-dialog__field-label">{text.description}</span>
                <span className="sk-detail-dialog__field-val">{detail.description}</span>
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
                    <th>{text.accountCode}</th>
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
                          <code>{line.account_code}</code>
                        </td>
                        <td>
                          <strong>{line.account_name}</strong>
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
          <Button variant="secondary" onClick={onClose}>
            {text.close}
          </Button>
        </footer>
      </div>
    </div>
  );
}
