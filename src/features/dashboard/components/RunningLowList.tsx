import { useMemo } from 'react';
import { PackQuantity } from '../../../shared/components/PackQuantity';
import { usePrimaryPacks } from '../../../shared/hooks/usePrimaryPacks';
import { useI18n } from '../../../shared/i18n';
import type { DashboardStockItem } from '../../../shared/ipc/dashboardDto';
import type { SectionState } from '../useDashboardData';
import { ShortListCard } from './ShortListCard';

interface RunningLowListProps {
  runningLow: SectionState<DashboardStockItem[]>;
  onOpenStockDialog: (kind: 'low') => void;
  onRetry: () => void;
}

export function RunningLowList({
  runningLow,
  onOpenStockDialog,
  onRetry,
}: RunningLowListProps) {
  const { t } = useI18n();

  const rows = (runningLow.data || []).slice(0, 5);
  const variantIds = useMemo(() => rows.map((r) => r.variant_id), [rows]);
  const { packs } = usePrimaryPacks(variantIds);

  const isEmpty = runningLow.status === 'ready' && rows.length === 0;

  return (
    <ShortListCard
      title={t('dash.list.runningLow')}
      seeAllLabel={t('dash.list.seeAll')}
      onSeeAll={() => onOpenStockDialog('low')}
      loading={runningLow.status === 'loading'}
      isError={runningLow.status === 'error'}
      errorMessage={runningLow.errorMessage}
      onRetry={onRetry}
      isEmpty={isEmpty}
      emptyText={t('dash.list.empty.low')}
      className="sk-dash-low-card"
    >
      <ul className="sk-dash-list">
        {rows.map((row) => {
          const pack = packs.get(row.variant_id);
          return (
            <li key={row.variant_id} className="sk-dash-row">
              <div className="sk-dash-row__primary">
                <span
                  className="sk-dash-row__name sk-dash-truncate"
                  title={row.item_name}
                >
                  {row.item_name}
                </span>
                <span className="sk-dash-row__qty">
                  <PackQuantity
                    baseQuantity={row.quantity}
                    baseUnitName={row.base_unit_name}
                    pack={pack}
                  />
                </span>
              </div>
              <div className="sk-dash-row__sub sk-muted">
                <span>{t('dash.list.minimum', { qty: '' })}</span>{' '}
                <PackQuantity
                  baseQuantity={row.minimum_stock}
                  baseUnitName={row.base_unit_name}
                  pack={pack}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </ShortListCard>
  );
}
