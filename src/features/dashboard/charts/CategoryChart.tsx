import { useMemo } from 'react';
import { useI18n } from '../../../shared/i18n';
import type { DashboardCategoryRow } from '../../../shared/ipc/dashboardDto';
import { formatDisplayAmount } from '../../../shared/utils/formatters';
import {
  ChartCard,
  ChartErrorBoundary,
  ChartTable,
  RankingBars,
  type ChartTableColumn,
  type RankingBarRow,
} from '../../../shared/charts';
import type { SectionState } from '../useDashboardData';

interface CategoryChartProps {
  categories: SectionState<DashboardCategoryRow[]>;
  onRetry?: () => void;
}

export function CategoryChart({ categories, onRetry }: CategoryChartProps) {
  const { t } = useI18n();

  const resolveCategoryName = (row: DashboardCategoryRow): string => {
    if (row.category_key === 'OTHER') {
      return t('dash.charts.category.other');
    }
    if (row.category_key === 'NONE') {
      return t('dash.charts.category.none');
    }
    return row.category_name || t('dash.charts.category.none');
  };

  const rows: RankingBarRow[] = useMemo(() => {
    const list = [...(categories.data ?? [])].sort(
      (a, b) => a.sort_order - b.sort_order,
    );
    return list.map((r) => {
      const share = r.share_pct ?? '0';
      return {
        key: r.category_key,
        label: resolveCategoryName(r),
        value: r.sales_before_discount,
        valueText: `${formatDisplayAmount(r.sales_before_discount)} · ${share}%`,
        token: '--sk-chart-sales',
      };
    });
  }, [categories.data, t]);

  const columns: ChartTableColumn[] = useMemo(
    () => [
      { key: 'category', label: t('dash.charts.col.category') },
      { key: 'sales', label: t('dash.list.salesBeforeDiscount'), numeric: true },
      { key: 'share', label: t('dash.charts.col.share'), numeric: true },
    ],
    [t],
  );

  const tableRows = useMemo(() => {
    const list = [...(categories.data ?? [])].sort(
      (a, b) => a.sort_order - b.sort_order,
    );
    return list.map((r) => ({
      category: resolveCategoryName(r),
      sales: formatDisplayAmount(r.sales_before_discount),
      share: `${r.share_pct ?? '0'}%`,
    }));
  }, [categories.data, t]);

  const isEmpty =
    categories.status === 'ready' &&
    (!categories.data || categories.data.length === 0);

  const state =
    categories.status === 'loading'
      ? 'loading'
      : categories.status === 'error'
      ? 'error'
      : isEmpty
      ? 'empty'
      : 'ready';

  return (
    <ChartCard
      title={t('dash.charts.category.title')}
      subtitle={t('dash.charts.category.subtitle')}
      state={state}
      refreshing={categories.refreshing}
      errorText={categories.errorMessage}
      onRetry={onRetry}
      emptyText={t('dash.charts.empty')}
      table={
        <ChartTable
          caption={t('dash.charts.category.title')}
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
