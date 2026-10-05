import { useMemo } from 'react';
import { useI18n } from '../../../shared/i18n';
import type { DashboardAgingRow } from '../../../shared/ipc/dashboardDto';
import { formatDisplayAmount } from '../../../shared/utils/formatters';
import { formatCount } from '../dashboardFormat';
import {
  ChartCard,
  ChartErrorBoundary,
  ChartTable,
  RankingBars,
  toPlotNumber,
  type ChartTableColumn,
  type RankingBarRow,
} from '../../../shared/charts';
import type { SectionState } from '../useDashboardData';

interface AgingChartProps {
  aging: SectionState<DashboardAgingRow[]>;
  onRetry?: () => void;
}

const ORDERED_BUCKETS = ['0_30', '31_60', '61_90', '91_PLUS'] as const;
const BUCKET_TOKENS: Record<(typeof ORDERED_BUCKETS)[number], string> = {
  '0_30': '--sk-chart-age-1',
  '31_60': '--sk-chart-age-2',
  '61_90': '--sk-chart-age-3',
  '91_PLUS': '--sk-chart-age-4',
};

export function AgingChart({ aging, onRetry }: AgingChartProps) {
  const { t } = useI18n();

  const bucketLabel = (bucket: string): string => {
    switch (bucket) {
      case '0_30':
        return t('dash.charts.aging.b0_30');
      case '31_60':
        return t('dash.charts.aging.b31_60');
      case '61_90':
        return t('dash.charts.aging.b61_90');
      case '91_PLUS':
        return t('dash.charts.aging.b91');
      default:
        return bucket;
    }
  };

  const agingMap = useMemo(() => {
    const map = new Map<string, DashboardAgingRow>();
    for (const r of aging.data ?? []) {
      map.set(r.bucket, r);
    }
    return map;
  }, [aging.data]);

  const rows: RankingBarRow[] = useMemo(() => {
    return ORDERED_BUCKETS.map((b) => {
      const row = agingMap.get(b);
      const amount = row?.amount ?? '0';
      const count = row?.item_count ?? 0;
      const countText = t('dash.charts.aging.items', { count: formatCount(count) });

      return {
        key: b,
        label: bucketLabel(b),
        value: amount,
        valueText: `${formatDisplayAmount(amount)} · ${countText}`,
        token: BUCKET_TOKENS[b],
      };
    });
  }, [agingMap, t]);

  const unappliedRow = agingMap.get('UNAPPLIED');
  const totalRow = agingMap.get('TOTAL');

  const unappliedAmount = unappliedRow?.amount ?? '0';
  const hasUnapplied = toPlotNumber(unappliedAmount) !== 0;

  const totalAmount = totalRow?.amount ?? '0';

  const columns: ChartTableColumn[] = useMemo(
    () => [
      { key: 'age', label: t('dash.charts.col.age') },
      { key: 'openSales', label: t('dash.charts.col.openSales'), numeric: true },
      { key: 'amount', label: t('dash.charts.col.amount'), numeric: true },
    ],
    [t],
  );

  const tableRows = useMemo(() => {
    const list: Record<string, string>[] = ORDERED_BUCKETS.map((b) => {
      const row = agingMap.get(b);
      const amt = row?.amount ?? '0';
      const count = row?.item_count ?? 0;
      return {
        age: bucketLabel(b),
        openSales: formatCount(count),
        amount: formatDisplayAmount(amt),
      };
    });

    if (unappliedRow) {
      list.push({
        age: 'Unapplied',
        openSales: '—',
        amount: formatDisplayAmount(unappliedRow.amount),
      });
    }

    if (totalRow) {
      list.push({
        age: 'Total',
        openSales: '—',
        amount: formatDisplayAmount(totalRow.amount),
      });
    }

    return list;
  }, [agingMap, unappliedRow, totalRow, t]);

  const isEmpty =
    aging.status === 'ready' &&
    (!aging.data ||
      aging.data.length === 0 ||
      (toPlotNumber(totalAmount) === 0 &&
        ORDERED_BUCKETS.every((b) => toPlotNumber(agingMap.get(b)?.amount ?? '0') === 0)));

  const state =
    aging.status === 'loading'
      ? 'loading'
      : aging.status === 'error'
      ? 'error'
      : isEmpty
      ? 'empty'
      : 'ready';

  return (
    <ChartCard
      title={t('dash.charts.aging.title')}
      subtitle={t('dash.charts.aging.subtitle')}
      state={state}
      refreshing={aging.refreshing}
      errorText={aging.errorMessage}
      onRetry={onRetry}
      emptyText={t('dash.list.empty.debtors')}
      table={
        <ChartTable
          caption={t('dash.charts.aging.title')}
          columns={columns}
          rows={tableRows}
        />
      }
    >
      <ChartErrorBoundary fallbackText={t('dash.charts.failed')}>
        <div className="sk-chart-aging">
          <RankingBars rows={rows} defaultToken="--sk-chart-age-1" />

          <div className="sk-chart-aging__summary">
            {hasUnapplied && (
              <div className="sk-chart-aging__unapplied sk-muted sk-body-sm">
                {t('dash.charts.aging.unapplied', {
                  amount: formatDisplayAmount(unappliedAmount),
                })}
              </div>
            )}
            <div className="sk-chart-aging__total">
              <strong>
                {t('dash.charts.aging.total', {
                  amount: formatDisplayAmount(totalAmount),
                })}
              </strong>
            </div>
          </div>
        </div>
      </ChartErrorBoundary>
    </ChartCard>
  );
}
