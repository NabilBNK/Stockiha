import type { AppView } from '../../../app/AppShell';
import type { NavAccess } from '../../../app/navigationAccess';
import { Button } from '../../../shared/components';
import { useI18n } from '../../../shared/i18n';
import type { DashboardMoneySummary } from '../../../shared/ipc/dashboardDto';
import { splitAmount } from '../dashboardFormat';
import { resolveTarget } from '../quickActions';
import type { SectionState } from '../useDashboardData';

interface CashDrawerCardProps {
  money: SectionState<DashboardMoneySummary>;
  access: NavAccess;
  onNavigate: (view: AppView) => void;
  onRetry: () => void;
}

export function CashDrawerCard({
  money,
  access,
  onNavigate,
  onRetry,
}: CashDrawerCardProps) {
  const { t } = useI18n();
  const sessionTarget = resolveTarget(['M-SESSION'], access);

  return (
    <div className="sk-card sk-dash-card sk-dash-cash-card">
      <div className="sk-dash-card__header">
        <h3 className="sk-dash-card__title">{t('dash.cash.title')}</h3>
        {sessionTarget && (
          <button
            type="button"
            className="sk-dash-card__link"
            onClick={() => onNavigate(sessionTarget)}
          >
            {t('dash.cash.open')}
          </button>
        )}
      </div>

      <div className="sk-dash-card__content">
        {money.status === 'loading' ? (
          <div className="sk-dash-card__skeleton-cash">
            <div className="sk-dash-skeleton sk-dash-skeleton--val" />
            <div className="sk-dash-skeleton sk-dash-skeleton--sub" />
          </div>
        ) : money.status === 'error' ? (
          <div className="sk-dash-card__error" role="alert">
            <p className="sk-dash-card__error-text">
              {t('dash.section.error')}{' '}
              {money.errorMessage ? <span className="sk-muted">({money.errorMessage})</span> : null}
            </p>
            <Button type="button" variant="secondary" onClick={onRetry}>
              {t('common.retry')}
            </Button>
          </div>
        ) : money.data && money.data.open_session_count > 0 ? (
          <div className="sk-dash-cash__body">
            <div className="sk-dash-cash__amount">
              {(() => {
                const { sign, integer, fraction } = splitAmount(money.data.cash_in_drawer);
                return (
                  <span className="sk-dash-kpi__money">
                    <span className="sk-dash-kpi__int">{sign}{integer}</span>
                    <span className="sk-dash-kpi__frac">{fraction} DZD</span>
                  </span>
                );
              })()}
            </div>
            <div className="sk-dash-cash__sub sk-muted">
              {t('dash.cash.sessions', { count: money.data.open_session_count })}
            </div>
          </div>
        ) : (
          <div className="sk-dash-cash__no-session sk-muted">
            {t('dash.cash.noSession')}
          </div>
        )}
      </div>
    </div>
  );
}
