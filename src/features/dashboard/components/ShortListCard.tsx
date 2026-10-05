import { useId, type ReactNode } from 'react';
import { Button } from '../../../shared/components';
import { useI18n } from '../../../shared/i18n';

interface ShortListCardProps {
  title: string;
  seeAllLabel?: string;
  onSeeAll?: () => void;
  loading?: boolean;
  isError?: boolean;
  errorMessage?: string | null;
  onRetry?: () => void;
  emptyText?: string;
  isEmpty?: boolean;
  headerExtra?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function ShortListCard({
  title,
  seeAllLabel,
  onSeeAll,
  loading = false,
  isError = false,
  errorMessage,
  onRetry,
  emptyText,
  isEmpty = false,
  headerExtra,
  children,
  className = '',
}: ShortListCardProps) {
  const { t } = useI18n();
  const headingId = useId();

  return (
    <div className={`sk-card sk-dash-card ${className}`.trim()}>
      <div className="sk-dash-card__header">
        <h3 id={headingId} className="sk-dash-card__title">
          {title}
        </h3>
        {headerExtra}
        {onSeeAll && seeAllLabel ? (
          <button
            type="button"
            className="sk-dash-card__see-all"
            onClick={onSeeAll}
          >
            {seeAllLabel}
          </button>
        ) : null}
      </div>

      <div className="sk-dash-card__content">
        {loading ? (
          <div className="sk-dash-card__skeleton-rows">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="sk-dash-skeleton sk-dash-skeleton--row" />
            ))}
          </div>
        ) : isError ? (
          <div className="sk-dash-card__error" role="alert">
            <p className="sk-dash-card__error-text">
              {t('dash.section.error')}{' '}
              {errorMessage ? <span className="sk-muted">({errorMessage})</span> : null}
            </p>
            {onRetry && (
              <Button type="button" variant="secondary" onClick={onRetry}>
                {t('common.retry')}
              </Button>
            )}
          </div>
        ) : isEmpty ? (
          <div className="sk-dash-card__empty">{emptyText}</div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
