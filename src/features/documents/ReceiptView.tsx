/**
 * Slice 1 — posted-receipt view: official document number, date, lines, and
 * cash total, plus the generation / print / drawer job statuses. Job status
 * is polled modestly and the interval is cleared on unmount. A clear note
 * states that a print failure does not cancel a posted sale.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { Banner, Button, Spinner } from '../../shared/components';
import { useI18n, type Locale } from '../../shared/i18n';
import { useErrorText } from '../../shared/hooks/useErrorText';
import { useSession } from '../../shared/session/SessionContext';
import * as ipc from '../../shared/ipc/gateway';
import type { DocumentJob, SaleDocument, SaleLine } from '../../shared/ipc/dto';
import { formatDisplayAmount, formatDisplayDate } from '../../shared/utils/formatters';
import {
  buildOfficialDocumentHtml,
  escapeHtml,
  printDocumentA4,
} from '../../shared/documents/documentPrintService';

const TERMINAL_STATUSES = new Set([
  'COMPLETED',
  'PERMANENT_FAILURE',
  'UNKNOWN_DELIVERY',
  'CANCELLED',
  'PULSE_SUBMITTED',
  'PULSE_FAILED',
]);

const JOB_KIND_KEY = {
  GENERATION: 'jobs.generation',
  PRINT: 'jobs.print',
  DRAWER: 'jobs.drawer',
} as const;

function formatReceiptDateTime(dateStr: string | null | undefined, locale: Locale): string {
  if (!dateStr) return '—';
  const displayDate = formatDisplayDate(dateStr, locale);
  if (dateStr.includes('T')) {
    const timePart = dateStr.split('T')[1]?.slice(0, 5);
    if (timePart) {
      return `${displayDate} · ${timePart}`;
    }
  }
  return displayDate;
}

export function ReceiptView({
  documentId,
  onClose,
}: {
  documentId: number;
  onClose?: () => void;
}) {
  const { t, locale } = useI18n();
  const { user, activeCashSession } = useSession();
  const errorText = useErrorText();
  const token = user?.token ?? '';

  const [doc, setDoc] = useState<SaleDocument | null>(null);
  const [lines, setLines] = useState<SaleLine[]>([]);
  const [jobs, setJobs] = useState<DocumentJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadJobs = useCallback(async () => {
    if (!token) return;
    try {
      setJobs(await ipc.listDocumentJobs(token, documentId));
    } catch {
      // Non-fatal for the receipt itself; leave prior job snapshot in place.
    }
  }, [token, documentId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all([
      ipc.getSaleDocument(token, documentId),
      ipc.listSaleLines(token, documentId),
      ipc.listDocumentJobs(token, documentId),
    ])
      .then(([d, l, j]) => {
        if (!active) return;
        setDoc(d);
        setLines(l);
        setJobs(j);
      })
      .catch((err) => active && setError(errorText(err)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [token, documentId, errorText]);

  // Modest polling: refresh job statuses every 2s until all are terminal;
  // always cleared on unmount.
  useEffect(() => {
    const anyPending = jobs.some((j) => !TERMINAL_STATUSES.has(j.status));
    if (!anyPending) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    if (pollRef.current) return;
    pollRef.current = setInterval(() => void loadJobs(), 2000);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [jobs, loadJobs]);

  const handlePrint = useCallback(() => {
    if (!doc) return;

    const infoCardsHtml = `
      <div class="info-card">
        <div class="info-card-title">${escapeHtml(t('receipt.number'))}</div>
        <div class="info-row"><span>Réf:</span><strong>${escapeHtml(doc.document_number ?? `DOC-${doc.document_id}`)}</strong></div>
        <div class="info-row"><span>Date:</span><strong>${escapeHtml(formatReceiptDateTime(doc.posted_at ?? doc.document_date, locale))}</strong></div>
      </div>
      <div class="info-card">
        <div class="info-card-title">${escapeHtml(t('receipt.paymentMethod'))}</div>
        <div class="info-row"><span>Mode:</span><strong>${escapeHtml(t('receipt.payment'))}</strong></div>
        <div class="info-row"><span>${escapeHtml(t('receipt.cashier'))}:</span><strong>${escapeHtml(user?.username || '—')}</strong></div>
      </div>
    `;

    const tableHeaders = ['#', t('receipt.line'), 'SKU', t('receipt.qty'), t('receipt.unitPrice'), t('receipt.lineTotal')];
    const tableRowsHtml = lines
      .map(
        (l) => `
        <tr>
          <td style="color: #64748b;">${l.line_number}</td>
          <td><strong>${escapeHtml(l.variant_name_snapshot)}</strong></td>
          <td><code>${escapeHtml(l.variant_sku_snapshot)}</code></td>
          <td class="num"><strong>${l.quantity}</strong></td>
          <td class="num">${formatDisplayAmount(l.unit_price)}</td>
          <td class="num"><strong>${formatDisplayAmount(l.line_total)}</strong></td>
        </tr>
      `,
      )
      .join('');

    const totalsRowsHtml = `
      <tr class="grand-total">
        <td>TOTAL:</td>
        <td>${formatDisplayAmount(doc.total_amount)}</td>
      </tr>
    `;

    const html = buildOfficialDocumentHtml({
      title: t('receipt.officialDocument'),
      documentNumber: doc.document_number ?? `DOC-${doc.document_id}`,
      documentDate: formatReceiptDateTime(doc.posted_at ?? doc.document_date, locale),
      statusLabel: doc.status || 'POSTED',
      isPosted: true,
      locale,
      infoCardsHtml,
      tableHeaders,
      tableRowsHtml,
      totalsRowsHtml,
      footerNote: `Stockiha ERP · ${doc.document_number ?? `DOC-${doc.document_id}`}`,
    });

    printDocumentA4(html);
  }, [doc, lines, locale, t, user]);

  if (loading) return <Spinner />;
  if (error) return <Banner tone="error">{error}</Banner>;
  if (!doc) return <Banner tone="info">{t('common.none')}</Banner>;

  const totalQuantityUnits = lines.reduce((acc, l) => {
    const num = Number(l.quantity);
    return Number.isFinite(num) ? acc + num : acc;
  }, 0);

  return (
    <div className="sk-receipt-document-container">
      <div className="sk-card sk-receipt sk-receipt-document" data-testid="receipt">
        {/* Document Header */}
        <header className="sk-receipt__doc-header">
          <div className="sk-receipt__doc-brand">
            <div className="sk-receipt__logo-badge" aria-hidden="true">S</div>
            <div>
              <div className="sk-receipt__doc-eyebrow">{t('app.name')} · {t('pos.title')}</div>
              <h2 className="sk-receipt__doc-title">{t('receipt.officialDocument')}</h2>
            </div>
          </div>
          <div className="sk-receipt__doc-badges">
            <span className="sk-badge sk-badge--success">
              ✓ {doc.status || 'POSTED'}
            </span>
            <span className="sk-receipt__doc-num" data-testid="receipt-number">
              {doc.document_number ?? '—'}
            </span>
          </div>
        </header>

        {/* Metadata Details Grid */}
        <div className="sk-receipt__meta-grid">
          <div className="sk-receipt__meta-card">
            <span className="sk-receipt__meta-label">{t('receipt.number')}</span>
            <strong className="sk-receipt__meta-value">{doc.document_number ?? '—'}</strong>
          </div>
          <div className="sk-receipt__meta-card">
            <span className="sk-receipt__meta-label">{t('receipt.date')}</span>
            <strong className="sk-receipt__meta-value">
              {formatReceiptDateTime(doc.posted_at ?? doc.document_date, locale)}
            </strong>
          </div>
          <div className="sk-receipt__meta-card">
            <span className="sk-receipt__meta-label">{t('receipt.paymentMethod')}</span>
            <strong className="sk-receipt__meta-value sk-receipt__payment-badge">
              💵 {t('receipt.payment')}
            </strong>
          </div>
          <div className="sk-receipt__meta-card">
            <span className="sk-receipt__meta-label">{t('receipt.cashier')}</span>
            <strong className="sk-receipt__meta-value">
              {user?.username || '—'}
              {activeCashSession ? ` (Caisse #${activeCashSession.id})` : ''}
            </strong>
          </div>
        </div>

        {/* Line Items Table */}
        <div className="sk-receipt__lines-section">
          <div className="sk-table-wrap sk-receipt__table-wrap">
            <table className="sk-table sk-receipt__table">
              <thead>
                <tr>
                  <th style={{ width: '6%' }}>#</th>
                  <th>{t('receipt.line')}</th>
                  <th className="sk-num" style={{ width: '15%' }}>{t('receipt.qty')}</th>
                  <th className="sk-num" style={{ width: '22%' }}>{t('receipt.unitPrice')}</th>
                  <th className="sk-num" style={{ width: '25%' }}>{t('receipt.lineTotal')}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.line_number}>
                    <td className="sk-receipt__line-num">{l.line_number}</td>
                    <td>
                      <div className="sk-receipt__line-name">{l.variant_name_snapshot}</div>
                      <code className="sk-receipt__line-sku">{l.variant_sku_snapshot}</code>
                    </td>
                    <td className="sk-num sk-receipt__cell-qty">{l.quantity}</td>
                    <td className="sk-num">{formatDisplayAmount(l.unit_price)}</td>
                    <td className="sk-num sk-receipt__cell-total">{formatDisplayAmount(l.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Totals Summary */}
        <div className="sk-receipt__total-card">
          <div className="sk-receipt__total-stats">
            <span>{t('pos.items', { count: lines.length })}</span>
            <span>·</span>
            <span>{totalQuantityUnits} {t('receipt.qty').toLowerCase()}</span>
          </div>
          <div className="sk-receipt__total-main">
            <span className="sk-receipt__total-label">{t('receipt.total')}</span>
            <strong className="sk-receipt__total-amount" data-testid="receipt-total-amount">
              {formatDisplayAmount(doc.total_amount)}
            </strong>
          </div>
        </div>

        {/* Jobs & Hardware Status */}
        <div className="sk-receipt__jobs-card">
          <div className="sk-receipt__jobs-title-row">
            <h3>{t('jobs.title')}</h3>
            <Button variant="secondary" className="sk-button--small" onClick={() => void loadJobs()}>
              ↻ {t('jobs.refresh')}
            </Button>
          </div>
          <div className="sk-table-wrap">
            <table className="sk-table" data-testid="receipt-jobs">
              <thead>
                <tr>
                  <th>{t('jobs.kind')}</th>
                  <th>{t('jobs.status')}</th>
                  <th className="sk-num">{t('jobs.attempts')}</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={`${j.job_kind}-${j.id}`}>
                    <td><strong>{t(JOB_KIND_KEY[j.job_kind])}</strong></td>
                    <td>
                      <span
                        className={`sk-badge ${
                          j.status === 'COMPLETED' || j.status === 'PULSE_SUBMITTED'
                            ? 'sk-badge--success'
                            : j.status === 'PENDING'
                            ? 'sk-badge--warning'
                            : 'sk-badge--secondary'
                        }`}
                      >
                        {j.status}
                      </span>
                    </td>
                    <td className="sk-num">{j.attempt_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Print Note Info Banner */}
        <Banner tone="info">{t('receipt.printNote')}</Banner>

        {/* Footer Actions */}
        <div className="sk-receipt__footer-actions">
          <Button variant="secondary" onClick={handlePrint}>
            🖨️ {t('receipt.print')}
          </Button>
          {onClose ? (
            <Button variant="primary" onClick={onClose}>
              ✓ {t('receipt.newSale')}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
