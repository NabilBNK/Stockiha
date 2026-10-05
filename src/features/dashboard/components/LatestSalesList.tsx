import type { AppView } from '../../../app/AppShell';
import type { NavAccess } from '../../../app/navigationAccess';
import { useI18n } from '../../../shared/i18n';
import type { DashboardLatestSale, DashboardPeriod } from '../../../shared/ipc/dashboardDto';
import { currentBusinessDate } from '../../../shared/utils/businessDate';
import { formatDisplayAmount } from '../../../shared/utils/formatters';
import { formatTimeOfSale } from '../dashboardFormat';
import { resolveTarget } from '../quickActions';
import type { SectionState } from '../useDashboardData';
import { ShortListCard } from './ShortListCard';

interface LatestSalesListProps {
  latest: SectionState<DashboardLatestSale[]>;
  period: SectionState<DashboardPeriod>;
  access: NavAccess;
  onNavigate: (view: AppView) => void;
  onRetry: () => void;
}

export function LatestSalesList({
  latest,
  period,
  access,
  onNavigate,
  onRetry,
}: LatestSalesListProps) {
  const { t, locale } = useI18n();
  const seeAllTarget = resolveTarget(['M-DOCUMENTS'], access);

  const todayStr = period.data?.today || currentBusinessDate();
  const rows = (latest.data || []).slice(0, 5);
  const isEmpty = latest.status === 'ready' && rows.length === 0;

  return (
    <ShortListCard
      title={t('dash.list.latestSales')}
      seeAllLabel={seeAllTarget ? t('dash.list.seeAll') : undefined}
      onSeeAll={seeAllTarget ? () => onNavigate(seeAllTarget) : undefined}
      loading={latest.status === 'loading'}
      isError={latest.status === 'error'}
      errorMessage={latest.errorMessage}
      onRetry={onRetry}
      isEmpty={isEmpty}
      emptyText={t('dash.list.empty.latest')}
      className="sk-dash-latest-sales-card"
    >
      <ul className="sk-dash-list">
        {rows.map((row) => {
          const timeText = formatTimeOfSale(row.posted_local, todayStr, locale);
          const customerText = row.customer_name || t('dash.list.walkIn');
          const isCash = row.sale_kind === 'CASH';

          return (
            <li key={row.document_id} className="sk-dash-row">
              <div className="sk-dash-row__primary">
                <div className="sk-dash-row__leading">
                  <span className="sk-dash-row__time sk-muted sk-dash-tnum">
                    {timeText}
                  </span>
                  <span
                    className="sk-dash-row__name sk-dash-truncate"
                    title={customerText}
                  >
                    {customerText}
                  </span>
                </div>

                <div className="sk-dash-row__trailing">
                  <span
                    className={`sk-badge ${isCash ? 'sk-badge--neutral' : 'sk-badge--info'}`}
                  >
                    {t(isCash ? 'dash.list.cash' : 'dash.list.credit')}
                  </span>
                  {row.is_voided && (
                    <span className="sk-badge sk-badge--danger">
                      {t('dash.list.voided')}
                    </span>
                  )}
                  <span
                    className={`sk-dash-row__amount sk-dash-tnum ${
                      row.is_voided ? 'sk-dash-strike sk-muted' : ''
                    }`}
                  >
                    {formatDisplayAmount(row.total)}
                  </span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </ShortListCard>
  );
}
