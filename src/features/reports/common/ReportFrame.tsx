// WS-I-1 §5.8 — the common chrome around every report: title, period text,
// print/PDF/CSV actions, and the loading/error/empty states.

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

  return (
    <section className="sk-report-frame">
      <h2>{title}</h2>
      {period ? (
        <p className="sk-report-frame__period">
          {formatReportCopy(copy.periodText, { from: period.from, to: period.to })}
        </p>
      ) : null}
      {onPrint || onPdf || onCsv ? (
        <div className="sk-report-frame__actions" data-testid="report-actions">
          {onPrint ? (
            <Button
              type="button"
              variant="secondary"
              onClick={onPrint}
              disabled={exportBusy}
              data-testid="report-print"
            >
              {copy.print}
            </Button>
          ) : null}
          {onPdf ? (
            <Button
              type="button"
              variant="secondary"
              onClick={onPdf}
              disabled={exportBusy}
              data-testid="report-pdf"
            >
              {copy.pdf}
            </Button>
          ) : null}
          {onCsv ? (
            <Button
              type="button"
              variant="secondary"
              onClick={onCsv}
              disabled={exportBusy}
              data-testid="report-csv"
            >
              {copy.csv}
            </Button>
          ) : null}
        </div>
      ) : null}
      {loading ? (
        <Spinner />
      ) : error ? (
        <Banner tone="error">
          <p>{errorText(error)}</p>
          <Button type="button" variant="secondary" onClick={onRetry} data-testid="report-retry">
            {copy.retry}
          </Button>
        </Banner>
      ) : empty ? (
        <p className="sk-report-frame__empty">{copy.empty}</p>
      ) : (
        children
      )}
    </section>
  );
}
