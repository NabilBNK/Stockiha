import type { AppView } from '../../../app/AppShell';
import type { NavAccess } from '../../../app/navigationAccess';
import { Button } from '../../../shared/components';
import { useI18n } from '../../../shared/i18n';
import type { ReportNotifications } from '../../../shared/ipc/reportsDto';
import { resolveTarget } from '../quickActions';
import type { SectionState } from '../useDashboardData';

interface AlertsCardProps {
  alerts: SectionState<ReportNotifications>;
  access: NavAccess;
  onNavigate: (view: AppView) => void;
  onRetry: () => void;
}

export function AlertsCard({
  alerts,
  access,
  onNavigate,
  onRetry,
}: AlertsCardProps) {
  const { t } = useI18n();
  const notifTarget = resolveTarget(['M-NOTIFICATIONS'], access);

  const count = alerts.data?.items?.length ?? 0;

  return (
    <div className="sk-card sk-dash-card sk-dash-alerts-card">
      <div className="sk-dash-card__header">
        <h3 className="sk-dash-card__title">{t('dash.alerts.title')}</h3>
        {notifTarget && (
          <button
            type="button"
            className="sk-dash-card__link"
            onClick={() => onNavigate(notifTarget)}
          >
            {t('dash.alerts.open')}
          </button>
        )}
      </div>

      <div className="sk-dash-card__content">
        {alerts.status === 'loading' ? (
          <div className="sk-dash-skeleton sk-dash-skeleton--sub" />
        ) : alerts.status === 'error' ? (
          <div className="sk-dash-card__error" role="alert">
            <p className="sk-dash-card__error-text">
              {t('dash.section.error')}{' '}
              {alerts.errorMessage ? <span className="sk-muted">({alerts.errorMessage})</span> : null}
            </p>
            <Button type="button" variant="secondary" onClick={onRetry}>
              {t('common.retry')}
            </Button>
          </div>
        ) : count > 0 ? (
          <div className="sk-dash-alerts__active">
            <span className="sk-badge sk-badge--warning">
              {t('dash.alerts.unread', { count })}
            </span>
          </div>
        ) : (
          <div className="sk-dash-alerts__none sk-muted">
            {t('dash.alerts.none')}
          </div>
        )}
      </div>
    </div>
  );
}
