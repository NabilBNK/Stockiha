import { useMemo } from 'react';
import { useI18n } from '../../../shared/i18n';
import type {
  DashboardMoneySummary,
  DashboardPeriod,
  DashboardSeriesRow,
} from '../../../shared/ipc/dashboardDto';
import { formatDisplayAmount } from '../../../shared/utils/formatters';
import {
  ChartCard,
  ChartErrorBoundary,
  ChartTable,
  StackedColumnChart,
  bucketLabel,
  toPlotNumber,
  type ChartTableColumn,
  type LegendItem,
  type SeriesDefinition,
  type SeriesPoint,
} from '../../../shared/charts';
import type { SectionState } from '../useDashboardData';

interface CashCreditChartProps {
  series: SectionState<DashboardSeriesRow[]>;
  money: SectionState<DashboardMoneySummary>;
  period: SectionState<DashboardPeriod>;
  onRetry?: () => void;
}

export function CashCreditChart({
  series,
  money,
  period,
  onRetry,
}: CashCreditChartProps) {
  const { t, locale } = useI18n();

  const seriesDefs: SeriesDefinition[] = useMemo(
    () => [
      { dataKey: 'cash', label: t('dash.charts.series.cash'), token: '--sk-chart-sales' },
      { dataKey: 'credit', label: t('dash.charts.series.credit'), token: '--sk-chart-credit' },
    ],
    [t],
  );

  const legend: LegendItem[] = useMemo(
    () => [
      { label: t('dash.charts.series.cash'), token: '--sk-chart-sales', mark: 'rect' },
      { label: t('dash.charts.series.credit'), token: '--sk-chart-credit', mark: 'rect' },
    ],
    [t],
  );

  const bucket = period.data?.bucket ?? 'DAY';

  const rows: SeriesPoint[] = useMemo(() => {
    return (series.data ?? []).map((r) => ({
      key: r.bucket_start,
      label: bucketLabel(r.bucket_start, bucket, locale),
      values: {
        cash: r.cash_sales,
        credit: r.credit_sales,
      },
    }));
  }, [series.data, bucket, locale]);

  const columns: ChartTableColumn[] = useMemo(
    () => [
      { key: 'period', label: t('dash.charts.col.period') },
      { key: 'cash', label: t('dash.charts.series.cash'), numeric: true },
      { key: 'credit', label: t('dash.charts.series.credit'), numeric: true },
    ],
    [t],
  );

  const tableRows = useMemo(() => {
    return (series.data ?? []).map((r) => ({
      period: bucketLabel(r.bucket_start, bucket, locale),
      cash: formatDisplayAmount(r.cash_sales),
      credit: formatDisplayAmount(r.credit_sales),
    }));
  }, [series.data, bucket, locale]);

  const isEmpty =
    series.status === 'ready' &&
    ((series.data?.length ?? 0) === 0 ||
      series.data!.every(
        (r) =>
          toPlotNumber(r.cash_sales) === 0 && toPlotNumber(r.credit_sales) === 0,
      ));

  const state =
    series.status === 'loading'
      ? 'loading'
      : series.status === 'error'
      ? 'error'
      : isEmpty
      ? 'empty'
      : 'ready';

  const subtitle =
    money.data != null
      ? t('dash.charts.cashCredit.totals', {
          cash: formatDisplayAmount(money.data.cash_sales),
          credit: formatDisplayAmount(money.data.credit_sales),
        })
      : undefined;

  return (
    <ChartCard
      title={t('dash.charts.cashCredit.title')}
      subtitle={subtitle}
      legend={legend}
      state={state}
      refreshing={series.refreshing}
      errorText={series.errorMessage}
      onRetry={onRetry}
      emptyText={t('dash.charts.empty')}
      table={
        <ChartTable
          caption={t('dash.charts.cashCredit.title')}
          columns={columns}
          rows={tableRows}
        />
      }
    >
      <ChartErrorBoundary fallbackText={t('dash.charts.failed')}>
        <StackedColumnChart
          rows={rows}
          series={seriesDefs}
          formatValue={formatDisplayAmount}
          locale={locale}
        />
      </ChartErrorBoundary>
    </ChartCard>
  );
}
