import type { AppView } from '../../../app/AppShell';
import type { NavAccess } from '../../../app/navigationAccess';
import { useI18n } from '../../../shared/i18n';
import type { DashboardTopCustomer } from '../../../shared/ipc/dashboardDto';
import { formatDisplayAmount } from '../../../shared/utils/formatters';
import { resolveTarget } from '../quickActions';
import type { SectionState } from '../useDashboardData';
import { ShortListCard } from './ShortListCard';

interface TopCustomersListProps {
  topCustomers: SectionState<DashboardTopCustomer[]>;
  access: NavAccess;
  onNavigate: (view: AppView) => void;
  onRetry: () => void;
}

export function TopCustomersList({
  topCustomers,
  access,
  onNavigate,
  onRetry,
}: TopCustomersListProps) {
  const { t } = useI18n();
  const seeAllTarget = resolveTarget(['M-CUSTOMERS'], access);

  const rows = (topCustomers.data || []).slice(0, 5);
  const isEmpty = topCustomers.status === 'ready' && rows.length === 0;

  return (
    <ShortListCard
      title={t('dash.list.topCustomers')}
      seeAllLabel={seeAllTarget ? t('dash.list.seeAll') : undefined}
      onSeeAll={seeAllTarget ? () => onNavigate(seeAllTarget) : undefined}
      loading={topCustomers.status === 'loading'}
      isError={topCustomers.status === 'error'}
      errorMessage={topCustomers.errorMessage}
      onRetry={onRetry}
      isEmpty={isEmpty}
      emptyText={t('dash.list.empty.customers')}
      className="sk-dash-top-customers-card"
    >
      <ul className="sk-dash-list">
        {rows.map((row) => (
          <li key={row.customer_id} className="sk-dash-row">
            <div className="sk-dash-row__primary">
              <span
                className="sk-dash-row__name sk-dash-truncate"
                title={row.customer_name}
              >
                {row.customer_name}
              </span>
              <span className="sk-dash-row__amount sk-dash-tnum">
                {formatDisplayAmount(row.sales)}
              </span>
            </div>
            <div className="sk-dash-row__sub sk-muted">
              {t('dash.list.saleCount', { count: row.sale_count })}
            </div>
          </li>
        ))}
      </ul>
    </ShortListCard>
  );
}
