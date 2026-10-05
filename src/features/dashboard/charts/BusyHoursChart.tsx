import { useMemo } from 'react';
import { useI18n, type MessageKey } from '../../../shared/i18n';
import type { DashboardBusyCell } from '../../../shared/ipc/dashboardDto';
import { formatDisplayAmount } from '../../../shared/utils/formatters';
import { formatCount } from '../dashboardFormat';
import {
  ChartCard,
  ChartErrorBoundary,
  ChartTable,
  HeatmapGrid,
  type ChartTableColumn,
  type HeatmapCell,
} from '../../../shared/charts';
import type { SectionState } from '../useDashboardData';

interface BusyHoursChartProps {
  busyHours: SectionState<DashboardBusyCell[]>;
  onRetry?: () => void;
}

export function BusyHoursChart({ busyHours, onRetry }: BusyHoursChartProps) {
  const { t } = useI18n();

  const dayLabels = useMemo(
    () => [
      t('dash.weekdayShort.0'),
      t('dash.weekdayShort.1'),
      t('dash.weekdayShort.2'),
      t('dash.weekdayShort.3'),
      t('dash.weekdayShort.4'),
      t('dash.weekdayShort.5'),
      t('dash.weekdayShort.6'),
    ],
    [t],
  );

  const cells: HeatmapCell[] = useMemo(() => {
    return (busyHours.data ?? []).map((c) => ({
      weekday: c.weekday,
      hour: c.hour,
      count: c.sale_count,
      valueText: formatDisplayAmount(c.sales),
    }));
  }, [busyHours.data]);

  const cellLabel = (cell: HeatmapCell): string => {
    const dayName = t(`dash.weekday.${cell.weekday}` as MessageKey);
    const hourStr = String(cell.hour).padStart(2, '0');
    const hourEndStr = String(cell.hour + 1).padStart(2, '0');
    return t('dash.charts.busy.cell', {
      day: dayName,
      hour: hourStr,
      hourEnd: hourEndStr,
      count: formatCount(cell.count),
      amount: cell.valueText,
    });
  };

  const columns: ChartTableColumn[] = useMemo(
    () => [
      { key: 'day', label: t('dash.charts.col.day') },
      { key: 'hour', label: t('dash.charts.col.hour') },
      { key: 'count', label: t('dash.charts.col.count'), numeric: true },
      { key: 'amount', label: t('dash.charts.col.amount'), numeric: true },
    ],
    [t],
  );

  // Table view: only cells with count > 0, ordered by weekday then hour
  const tableRows = useMemo(() => {
    const active = (busyHours.data ?? [])
      .filter((c) => c.sale_count > 0)
      .sort((a, b) => (a.weekday !== b.weekday ? a.weekday - b.weekday : a.hour - b.hour));

    return active.map((c) => ({
      day: t(`dash.weekday.${c.weekday}` as MessageKey),
      hour: `${String(c.hour).padStart(2, '0')}:00–${String(c.hour + 1).padStart(2, '0')}:00`,
      count: formatCount(c.sale_count),
      amount: formatDisplayAmount(c.sales),
    }));
  }, [busyHours.data, t]);

  const isEmpty =
    busyHours.status === 'ready' &&
    ((busyHours.data?.length ?? 0) === 0 ||
      busyHours.data!.every((c) => c.sale_count === 0));

  const state =
    busyHours.status === 'loading'
      ? 'loading'
      : busyHours.status === 'error'
      ? 'error'
      : isEmpty
      ? 'empty'
      : 'ready';

  return (
    <ChartCard
      title={t('dash.charts.busy.title')}
      subtitle={t('dash.charts.busy.subtitle')}
      state={state}
      refreshing={busyHours.refreshing}
      errorText={busyHours.errorMessage}
      onRetry={onRetry}
      emptyText={t('dash.charts.empty')}
      table={
        <ChartTable
          caption={t('dash.charts.busy.title')}
          columns={columns}
          rows={tableRows}
        />
      }
    >
      <ChartErrorBoundary fallbackText={t('dash.charts.failed')}>
        <HeatmapGrid
          cells={cells}
          dayLabels={dayLabels}
          cellLabel={cellLabel}
          legend={{
            none: t('dash.charts.busy.none'),
            fewer: t('dash.charts.busy.fewer'),
            more: t('dash.charts.busy.more'),
          }}
        />
      </ChartErrorBoundary>
    </ChartCard>
  );
}
