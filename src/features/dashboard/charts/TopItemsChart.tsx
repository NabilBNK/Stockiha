import { useMemo } from 'react';
import { useI18n } from '../../../shared/i18n';
import type { DashboardTopItem } from '../../../shared/ipc/dashboardDto';
import { usePrimaryPacks } from '../../../shared/hooks/usePrimaryPacks';
import { formatDisplayAmount } from '../../../shared/utils/formatters';
import { formatPackQuantity } from '../../../shared/utils/packMath';
import {
  ChartCard,
  ChartErrorBoundary,
  ChartTable,
  RankingBars,
  type ChartTableColumn,
  type RankingBarRow,
} from '../../../shared/charts';
import type { SectionState } from '../useDashboardData';

interface TopItemsChartProps {
  topItems10: SectionState<DashboardTopItem[]>;
  onRetry?: () => void;
}

export function TopItemsChart({ topItems10, onRetry }: TopItemsChartProps) {
  const { t } = useI18n();

  const variantIds = useMemo(
    () => (topItems10.data ?? []).map((r) => r.variant_id),
    [topItems10.data],
  );
  const { packs } = usePrimaryPacks(variantIds);

  const rows: RankingBarRow[] = useMemo(() => {
    return (topItems10.data ?? []).map((r) => {
      const primaryPack = packs.get(r.variant_id);
      const packObj = primaryPack
        ? { unitName: primaryPack.unit_name, factor: primaryPack.conversion_factor }
        : null;
      const packQtyText = formatPackQuantity(r.quantity_sold, packObj, r.base_unit_name);

      return {
        key: String(r.variant_id),
        label: r.item_name,
        sublabel: packQtyText,
        value: r.sales_before_discount,
        valueText: formatDisplayAmount(r.sales_before_discount),
        token: '--sk-chart-sales',
      };
    });
  }, [topItems10.data, packs]);

  const columns: ChartTableColumn[] = useMemo(
    () => [
      { key: 'item', label: t('dash.charts.col.item') },
      { key: 'quantity', label: t('dash.charts.col.quantity'), numeric: true },
      { key: 'sales', label: t('dash.list.salesBeforeDiscount'), numeric: true },
    ],
    [t],
  );

  const tableRows = useMemo(() => {
    return (topItems10.data ?? []).map((r) => {
      const primaryPack = packs.get(r.variant_id);
      const packObj = primaryPack
        ? { unitName: primaryPack.unit_name, factor: primaryPack.conversion_factor }
        : null;
      const packQtyText = formatPackQuantity(r.quantity_sold, packObj, r.base_unit_name);

      return {
        item: r.item_name,
        quantity: packQtyText,
        sales: formatDisplayAmount(r.sales_before_discount),
      };
    });
  }, [topItems10.data, packs]);

  const isEmpty =
    topItems10.status === 'ready' &&
    (!topItems10.data || topItems10.data.length === 0);

  const state =
    topItems10.status === 'loading'
      ? 'loading'
      : topItems10.status === 'error'
      ? 'error'
      : isEmpty
      ? 'empty'
      : 'ready';

  return (
    <ChartCard
      title={t('dash.charts.topItems.title')}
      state={state}
      refreshing={topItems10.refreshing}
      errorText={topItems10.errorMessage}
      onRetry={onRetry}
      emptyText={t('dash.charts.empty')}
      table={
        <ChartTable
          caption={t('dash.charts.topItems.title')}
          columns={columns}
          rows={tableRows}
        />
      }
    >
      <ChartErrorBoundary fallbackText={t('dash.charts.failed')}>
        <RankingBars rows={rows} defaultToken="--sk-chart-sales" />
      </ChartErrorBoundary>
    </ChartCard>
  );
}
