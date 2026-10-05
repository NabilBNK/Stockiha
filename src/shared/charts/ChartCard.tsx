import { useId, useState, type ReactNode } from 'react';
import { Button } from '../components';
import { useI18n } from '../i18n';
import { ChartLegend, type LegendItem } from './ChartLegend';

export interface ChartCardProps {
  title: string;
  subtitle?: string;
  legend?: LegendItem[];
  state: 'loading' | 'ready' | 'error' | 'empty';
  refreshing: boolean;
  errorText?: string | null;
  onRetry?: () => void;
  emptyText: string;
  table: ReactNode;
  children: ReactNode;
  wide?: boolean;
}

export function ChartCard({
  title,
  subtitle,
  legend,
  state,
  refreshing,
  errorText,
  onRetry,
  emptyText,
  table,
  children,
  wide = false,
}: ChartCardProps) {
  const { t } = useI18n();
  const titleId = useId();
  const [showTable, setShowTable] = useState(false);

  return (
    <figure
      className={`sk-card sk-chart-card ${wide ? 'sk-chart-card--wide' : ''}`}
      aria-labelledby={titleId}
    >
      <header className="sk-chart-card__header">
        <div className="sk-chart-card__title-group">
          <h3 id={titleId} className="sk-chart-card__title">
            {title}
          </h3>
          {subtitle && <p className="sk-chart-card__subtitle sk-muted">{subtitle}</p>}
        </div>

        {state === 'ready' && (
          <Button
            type="button"
            variant="secondary"
            aria-pressed={showTable}
            onClick={() => setShowTable((prev) => !prev)}
            className="sk-chart-card__toggle"
          >
            {showTable ? t('dash.charts.showChart') : t('dash.charts.showTable')}
          </Button>
        )}
      </header>

      {legend && legend.length >= 2 && !showTable && state === 'ready' && (
        <div className="sk-chart-card__legend-bar">
          <ChartLegend items={legend} />
        </div>
      )}

      <div
        className="sk-chart-card__body"
        data-refreshing={refreshing ? 'true' : undefined}
      >
        {state === 'loading' ? (
          <div className="sk-chart-skeleton" aria-hidden="true" />
        ) : state === 'error' ? (
          <div className="sk-chart-card__error" role="alert">
            <p className="sk-muted">
              {t('dash.section.error')}{' '}
              {errorText ? <span className="sk-muted">({errorText})</span> : null}
            </p>
            {onRetry && (
              <Button type="button" variant="secondary" onClick={onRetry}>
                {t('common.retry')}
              </Button>
            )}
          </div>
        ) : state === 'empty' ? (
          <div className="sk-chart-card__empty">
            <p className="sk-muted">{emptyText}</p>
          </div>
        ) : showTable ? (
          <div className="sk-chart-card__table-view">{table}</div>
        ) : (
          <div className="sk-chart-card__chart-view">{children}</div>
        )}
      </div>
    </figure>
  );
}
