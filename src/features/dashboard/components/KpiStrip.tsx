import { useId, type ReactNode } from 'react';
import { Button } from '../../../shared/components';
import { useI18n } from '../../../shared/i18n';

interface KpiStripProps {
  title: string;
  isError?: boolean;
  errorMessage?: string | null;
  onRetry?: () => void;
  children: ReactNode;
}

export function KpiStrip({
  title,
  isError = false,
  errorMessage,
  onRetry,
  children,
}: KpiStripProps) {
  const { t } = useI18n();
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="sk-dash-strip">
      <h2 id={headingId} className="sk-dash-strip__heading">
        {title}
      </h2>

      {isError ? (
        <div className="sk-dash-strip__error" role="alert">
          <p className="sk-dash-strip__error-text">
            {t('dash.section.error')}{' '}
            {errorMessage ? <span className="sk-muted">({errorMessage})</span> : null}
          </p>
          {onRetry && (
            <Button type="button" variant="secondary" onClick={onRetry}>
              {t('common.retry')}
            </Button>
          )}
        </div>
      ) : (
        <div className="sk-dash-kpis">{children}</div>
      )}
    </section>
  );
}
