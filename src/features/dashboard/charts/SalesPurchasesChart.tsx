import { useMemo } from 'react';
import { useI18n } from '../../../shared/i18n';
import type { DashboardPeriod, DashboardSeriesRow } from '../../../shared/ipc/dashboardDto';
import { formatDisplayAmount } from '../../../shared/utils/formatters';
import {
  ChartCard,
  ChartErrorBoundary,
  ChartTable,
  TimeSeriesChart,
  bucketLabel,
  toPlotNumber,
  type ChartTableColumn,
  type LegendItem,
  type SeriesDefinition,
  type SeriesPoint,
} from '../../../shared/charts';
import type { SectionState } from '../useDashboardData';

interface SalesPurchasesChartProps {
  series: SectionState<DashboardSeriesRow[]>;
  period: SectionState<DashboardPeriod>;
  onRetry?: () => void;
}

export function SalesPurchasesChart({
  series,
  period,
  onRetry,
}: SalesPurchasesChartProps) {
  const { t, locale } = useI18n();

  const seriesDefs: SeriesDefinition[] = useMemo(
    () => [
      { dataKey: 'sales', label: t('dash.charts.series.sales'), token: '--sk-chart-sales' },
      { dataKey: 'purchases', label: t('dash.charts.series.purchases'), token: '--sk-chart-purchases' },
    ],
    [t],
  );

  const legend: LegendItem[] = useMemo(
    () => [
      { label: t('dash.charts.series.sales'), token: '--sk-chart-sales', mark: 'line' },
      { label: t('dash.charts.series.purchases'), token: '--sk-chart-purchases', mark: 'line' },
    ],
    [t],
  );

  const bucket = period.data?.bucket ?? 'DAY';

  const rows: SeriesPoint[] = useMemo(() => {
    return (series.data ?? []).map((r) => ({
      key: r.bucket_start,
      label: bucketLabel(r.bucket_start, bucket, locale),
      values: {
        sales: r.sales,
        purchases: r.purchases,
      },
    }));
  }, [series.data, bucket, locale]);

  const columns: ChartTableColumn[] = useMemo(
    () => [
      { key: 'period', label: t('dash.charts.col.period') },
      { key: 'sales', label: t('dash.charts.series.sales'), numeric: true },
      { key: 'purchases', label: t('dash.charts.series.purchases'), numeric: true },
    ],
    [t],
  );

  const tableRows = useMemo(() => {
    return (series.data ?? []).map((r) => ({
      period: bucketLabel(r.bucket_start, bucket, locale),
      sales: formatDisplayAmount(r.sales),
      purchases: formatDisplayAmount(r.purchases),
    }));
  }, [series.data, bucket, locale]);

  const isEmpty =
    series.status === 'ready' &&
    ((series.data?.length ?? 0) === 0 ||
      series.data!.every(
        (r) =>
          toPlotNumber(r.sales) === 0 && toPlotNumber(r.purchases) === 0,
      ));

  const state =
    series.status === 'loading'
      ? 'loading'
      : series.status === 'error'
      ? 'error'
      : isEmpty
      ? 'empty'
      : 'ready';

  return (
    <ChartCard
      title={t('dash.charts.salesPurchases.title')}
      subtitle={t('dash.charts.salesPurchases.subtitle')}
      legend={legend}
      state={state}
      refreshing={series.refreshing}
      errorText={series.errorMessage}
      onRetry={onRetry}
      emptyText={t('dash.charts.empty')}
      table={
        <ChartTable
          caption={t('dash.charts.salesPurchases.title')}
          columns={columns}
          rows={tableRows}
        />
      }
    >
      <ChartErrorBoundary fallbackText={t('dash.charts.failed')}>
        <TimeSeriesChart
          rows={rows}
          series={seriesDefs}
          formatValue={formatDisplayAmount}
          locale={locale}
        />
      </ChartErrorBoundary>
    </ChartCard>
  );
}
