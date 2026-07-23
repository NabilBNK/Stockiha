/**
 * Slice 1 — posted-receipt view: official document number, date, lines, and
 * cash total, plus the generation / print / drawer job statuses. Job status
 * is polled modestly and the interval is cleared on unmount. A clear note
 * states that a print failure does not cancel a posted sale.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { Banner, Button, Spinner } from '../../shared/components';
import { useI18n } from '../../shared/i18n';
import { useErrorText } from '../../shared/hooks/useErrorText';
import { useSession } from '../../shared/session/SessionContext';
import * as ipc from '../../shared/ipc/gateway';
import type { DocumentJob, SaleDocument, SaleLine } from '../../shared/ipc/dto';

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

export function ReceiptView({ documentId }: { documentId: number }) {
  const { t } = useI18n();
  const { user } = useSession();
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

  if (loading) return <Spinner />;
  if (error) return <Banner tone="error">{error}</Banner>;
  if (!doc) return <Banner tone="info">{t('common.none')}</Banner>;

  return (
    <div className="sk-card sk-receipt" data-testid="receipt">
      <h2>{t('receipt.title')}</h2>
      <p>
        <strong>{t('receipt.number')}:</strong>{' '}
        <span data-testid="receipt-number">{doc.document_number ?? '—'}</span>
      </p>
      <p>
        <strong>{t('receipt.date')}:</strong> {doc.posted_at ?? doc.document_date}
      </p>
      <p>{t('receipt.payment')}</p>

      <table className="sk-table">
        <thead>
          <tr>
            <th>{t('receipt.line')}</th>
            <th className="sk-num">{t('receipt.qty')}</th>
            <th className="sk-num">{t('receipt.unitPrice')}</th>
            <th className="sk-num">{t('receipt.lineTotal')}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.line_number}>
              <td>{l.variant_name_snapshot} ({l.variant_sku_snapshot})</td>
              <td className="sk-num">{l.quantity}</td>
              <td className="sk-num">{l.unit_price}</td>
              <td className="sk-num">{l.line_total}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="sk-receipt__total">
        <strong>{t('receipt.total')}: {doc.total_amount}</strong>
      </p>

      <h3>{t('jobs.title')}</h3>
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
              <td>{t(JOB_KIND_KEY[j.job_kind])}</td>
              <td>{j.status}</td>
              <td className="sk-num">{j.attempt_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Button variant="secondary" onClick={() => void loadJobs()}>
        {t('jobs.refresh')}
      </Button>
      <Banner tone="info">{t('receipt.printNote')}</Banner>
    </div>
  );
}
