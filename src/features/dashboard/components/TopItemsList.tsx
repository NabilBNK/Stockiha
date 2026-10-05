import { useMemo } from 'react';
import type { AppView } from '../../../app/AppShell';
import type { NavAccess } from '../../../app/navigationAccess';
import { PackQuantity } from '../../../shared/components/PackQuantity';
import { usePrimaryPacks } from '../../../shared/hooks/usePrimaryPacks';
import { useI18n } from '../../../shared/i18n';
import type { DashboardTopItem } from '../../../shared/ipc/dashboardDto';
import { formatDisplayAmount } from '../../../shared/utils/formatters';
import { resolveTarget } from '../quickActions';
import type { SectionState } from '../useDashboardData';
import { ShortListCard } from './ShortListCard';

interface TopItemsListProps {
  topItems: SectionState<DashboardTopItem[]>;
  access: NavAccess;
  onNavigate: (view: AppView) => void;
  onRetry: () => void;
}

export function TopItemsList({
  topItems,
  access,
  onNavigate,
  onRetry,
}: TopItemsListProps) {
  const { t } = useI18n();
  const seeAllTarget = resolveTarget(['M-REPORT-SALES'], access);

  const rows = (topItems.data || []).slice(0, 5);
  const variantIds = useMemo(() => rows.map((r) => r.variant_id), [rows]);
  const { packs } = usePrimaryPacks(variantIds);

  const isEmpty = topItems.status === 'ready' && rows.length === 0;

  return (
    <ShortListCard
      title={t('dash.list.topItems')}
      seeAllLabel={seeAllTarget ? t('dash.list.seeAll') : undefined}
      onSeeAll={seeAllTarget ? () => onNavigate(seeAllTarget) : undefined}
      loading={topItems.status === 'loading'}
      isError={topItems.status === 'error'}
      errorMessage={topItems.errorMessage}
      onRetry={onRetry}
      isEmpty={isEmpty}
      emptyText={t('dash.list.empty.period')}
      className="sk-dash-top-items-card"
      headerExtra={
        <span className="sk-dash-card__header-note sk-muted">
          {t('dash.list.salesBeforeDiscount')}
        </span>
      }
    >
      <ol className="sk-dash-list sk-dash-list--ranked">
        {rows.map((row, index) => {
          const pack = packs.get(row.variant_id);
          return (
            <li key={row.variant_id} className="sk-dash-row">
              <div className="sk-dash-row__primary">
                <span className="sk-dash-row__rank sk-muted">{index + 1}.</span>
                <span
                  className="sk-dash-row__name sk-dash-truncate"
                  title={row.item_name}
                >
                  {row.item_name}
                </span>
                <span className="sk-dash-row__amount sk-dash-tnum">
                  {formatDisplayAmount(row.sales_before_discount)}
                </span>
              </div>
              <div className="sk-dash-row__sub sk-muted">
                <PackQuantity
                  baseQuantity={row.quantity_sold}
                  baseUnitName={row.base_unit_name}
                  pack={pack}
                />
              </div>
            </li>
          );
        })}
      </ol>
    </ShortListCard>
  );
}
