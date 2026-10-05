import { useI18n } from '../../../shared/i18n';
import type {
  DashboardAgingRow,
  DashboardBusyCell,
  DashboardCategoryRow,
  DashboardMoneySummary,
  DashboardPeriod,
  DashboardSeriesRow,
  DashboardTopItem,
} from '../../../shared/ipc/dashboardDto';
import { formatRange } from '../dashboardFormat';
import type { SectionKey, SectionState } from '../useDashboardData';
import { SalesProfitChart } from './SalesProfitChart';
import { CategoryChart } from './CategoryChart';
import { TopItemsChart } from './TopItemsChart';
import { CashCreditChart } from './CashCreditChart';
import { SalesPurchasesChart } from './SalesPurchasesChart';
import { BusyHoursChart } from './BusyHoursChart';
import { AgingChart } from './AgingChart';

interface ChartsSectionProps {
  period: SectionState<DashboardPeriod>;
  money: SectionState<DashboardMoneySummary>;
  series: SectionState<DashboardSeriesRow[]>;
  categories: SectionState<DashboardCategoryRow[]>;
  topItems10: SectionState<DashboardTopItem[]>;
  busyHours: SectionState<DashboardBusyCell[]>;
  aging: SectionState<DashboardAgingRow[]>;
  onRetry: (section: SectionKey) => void;
}

export function ChartsSection({
  period,
  money,
  series,
  categories,
  topItems10,
  busyHours,
  aging,
  onRetry,
}: ChartsSectionProps) {
  const { t, locale } = useI18n();

  const rangeText =
    period.data && period.data.cur_from && period.data.cur_to
      ? formatRange(period.data.cur_from, period.data.cur_to, locale, t)
      : '';

  return (
    <section className="sk-dash__charts-section" aria-label={t('dash.charts.title')}>
      <div className="sk-dash__charts-header">
        <h2 className="sk-dash__charts-title">{t('dash.charts.title')}</h2>
        {rangeText && (
          <p className="sk-dash__charts-subtitle sk-muted">
            {t('dash.charts.subtitle', { range: rangeText })}
          </p>
        )}
      </div>

      <div className="sk-chart-grid">
        {/* 1. Sales and Profit (Wide) */}
        <SalesProfitChart
          series={series}
          period={period}
          onRetry={() => onRetry('series')}
        />

        {/* 2. Sales by Category */}
        <CategoryChart
          categories={categories}
          onRetry={() => onRetry('categories')}
        />

        {/* 3. Top 10 Items */}
        <TopItemsChart
          topItems10={topItems10}
          onRetry={() => onRetry('topItems10')}
        />

        {/* 4. Cash and Credit Sales */}
        <CashCreditChart
          series={series}
          money={money}
          period={period}
          onRetry={() => onRetry('series')}
        />

        {/* 5. Sales and Purchases */}
        <SalesPurchasesChart
          series={series}
          period={period}
          onRetry={() => onRetry('series')}
        />

        {/* 6. Busiest Days and Hours */}
        <BusyHoursChart
          busyHours={busyHours}
          onRetry={() => onRetry('busyHours')}
        />

        {/* 7. Receivables Aging */}
        <AgingChart
          aging={aging}
          onRetry={() => onRetry('aging')}
        />
      </div>
    </section>
  );
}
