import type { AppView } from '../../../app/AppShell';
import type { NavAccess } from '../../../app/navigationAccess';
import { useI18n } from '../../../shared/i18n';
import type { DashboardTopDebtor } from '../../../shared/ipc/dashboardDto';
import { formatDisplayAmount } from '../../../shared/utils/formatters';
import { resolveTarget } from '../quickActions';
import type { SectionState } from '../useDashboardData';
import { ShortListCard } from './ShortListCard';

interface DebtorsListProps {
  debtors: SectionState<DashboardTopDebtor[]>;
  access: NavAccess;
  onNavigate: (view: AppView) => void;
  onRetry: () => void;
}

export function DebtorsList({
  debtors,
  access,
  onNavigate,
  onRetry,
}: DebtorsListProps) {
  const { t } = useI18n();
  const seeAllTarget = resolveTarget(['M-REPORT-OWED', 'M-CUSTOMERS'], access);

  const rows = (debtors.data || []).slice(0, 5);
  const isEmpty = debtors.status === 'ready' && rows.length === 0;

  return (
    <ShortListCard
      title={t('dash.list.debtors')}
      seeAllLabel={seeAllTarget ? t('dash.list.seeAll') : undefined}
      onSeeAll={seeAllTarget ? () => onNavigate(seeAllTarget) : undefined}
      loading={debtors.status === 'loading'}
      isError={debtors.status === 'error'}
      errorMessage={debtors.errorMessage}
      onRetry={onRetry}
      isEmpty={isEmpty}
      emptyText={t('dash.list.empty.debtors')}
      className="sk-dash-debtors-card"
    >
      <ul className="sk-dash-list">
        {rows.map((row) => {
          let oldestText = '—';
          if (row.oldest_open_days === 0) {
            oldestText = t('dash.list.oldestUnpaidToday');
          } else if (row.oldest_open_days !== null && row.oldest_open_days !== undefined) {
            oldestText = t('dash.list.oldestUnpaid', { days: row.oldest_open_days });
          }

          return (
            <li key={row.customer_id} className="sk-dash-row">
              <div className="sk-dash-row__primary">
                <span
                  className="sk-dash-row__name sk-dash-truncate"
                  title={row.customer_name}
                >
                  {row.customer_name}
                </span>
                <span className="sk-dash-row__amount sk-dash-tnum">
                  {formatDisplayAmount(row.amount_owed)}
                </span>
              </div>
              <div className="sk-dash-row__sub sk-muted">
                {oldestText}
              </div>
            </li>
          );
        })}
      </ul>
    </ShortListCard>
  );
}
