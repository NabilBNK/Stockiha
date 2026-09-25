// WS-I-1 §5.8 — the common chrome around every report: title, period text,
// print/PDF/CSV actions, and the loading/error/empty states. Reuses the
// existing .sk-section-heading / .sk-empty-card / .sk-centered system
// instead of unstyled markup.

import type { ReactNode } from 'react';

import { Banner, Button, Spinner } from '../../../shared/components';
import { useErrorText } from '../../../shared/hooks/useErrorText';
import { formatReportCopy, useReportCopy } from './reportCopy';
import type { Period } from './periods';

export interface ReportFrameProps {
  title: string;
  period?: Period;
  loading: boolean;
  error: unknown | null;
  empty: boolean;
  onRetry: () => void;
  onPrint?: () => void;
  onPdf?: () => void;
  onCsv?: () => void;
  exportBusy?: boolean;
  children: ReactNode;
}

export function ReportFrame({
  title,
  period,
  loading,
  error,
  empty,
  onRetry,
  onPrint,
  onPdf,
  onCsv,
  exportBusy,
  children,
}: ReportFrameProps) {
  const copy = useReportCopy();
  const errorText = useErrorText();
  const hasActions = Boolean(onPrint || onPdf || onCsv);

  return (
    <section className="sk-report-frame">
      <div className="sk-section-heading">
        <div>
          <h2 className="sk-report-frame__title">{title}</h2>
          {period ? (
            <p>{formatReportCopy(copy.periodText, { from: period.from, to: period.to })}</p>
          ) : null}
        </div>
        {hasActions ? (
          <div className="sk-section-heading__actions" data-testid="report-actions">
            {onPrint ? (
              <Button type="button" variant="secondary" onClick={onPrint} disabled={exportBusy} data-testid="report-print">
                {copy.print}
              </Button>
            ) : null}
            {onPdf ? (
              <Button type="button" variant="secondary" onClick={onPdf} disabled={exportBusy} data-testid="report-pdf">
                {copy.pdf}
              </Button>
            ) : null}
            {onCsv ? (
              <Button type="button" variant="secondary" onClick={onCsv} disabled={exportBusy} data-testid="report-csv">
                {copy.csv}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {loading ? (
        <div className="sk-centered sk-reports-loading">
          <Spinner />
        </div>
      ) : error ? (
        <Banner tone="error">
          <p>{errorText(error)}</p>
          <Button type="button" variant="secondary" onClick={onRetry} data-testid="report-retry">
            {copy.retry}
          </Button>
        </Banner>
      ) : empty ? (
        <div className="sk-empty-card">
          <p className="sk-empty-card__title">{copy.empty}</p>
        </div>
      ) : (
        children
      )}
    </section>
  );
}
