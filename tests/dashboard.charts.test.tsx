import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  heatClass,
  bucketLabel,
  compactTick,
  toPlotNumber,
} from '../src/shared/charts/chartFormat';
import { ChartCard } from '../src/shared/charts/ChartCard';
import { RankingBars } from '../src/shared/charts/RankingBars';
import { HeatmapGrid, type HeatmapCell } from '../src/shared/charts/HeatmapGrid';
import { DashboardScreen } from '../src/features/dashboard/DashboardScreen';
import { SessionContext } from '../src/shared/session/SessionContext';
import { I18nProvider } from '../src/shared/i18n';
import { resetDashboardPrefsForTests } from '../src/features/dashboard/dashboardPrefs';
import type { DashboardPeriod, DashboardSeriesRow } from '../src/shared/ipc/dashboardDto';

type Handlers = Record<string, (args: Record<string, unknown>) => unknown>;

function wireInvoke(handlers: Handlers) {
  invokeMock.mockImplementation((command: string, args: Record<string, unknown> = {}) => {
    const handler = handlers[command];
    if (!handler) {
      return Promise.reject({ code: 'INTERNAL_ERROR', message: `Unknown command ${command}` });
    }
    try {
      return Promise.resolve(handler(args));
    } catch (e) {
      return Promise.reject(e);
    }
  });
}

const appendixFPeriod: DashboardPeriod = {
  cur_from: '2026-09-24',
  cur_to: '2026-09-24',
  prev_from: '2026-09-23',
  prev_to: '2026-09-23',
  cut_time: '12:00:00',
  bucket: 'HOUR',
  today: '2026-09-24',
};

const appendixFMoney = {
  sales: '58500.00',
  prev_sales: '0',
  sales_change_kind: 'NO_BASE',
  sales_change_pct: null,
  profit: '18300.00',
  prev_profit: '0',
  profit_change_kind: 'NO_BASE',
  profit_change_pct: null,
  margin_pct: '31.3',
  sale_count: 7,
  prev_sale_count: 0,
  count_change_kind: 'NO_BASE',
  count_change_pct: null,
  average_sale: '8357.14',
  discount_total: '250.00',
  cash_sales: '43200.00',
  credit_sales: '15300.00',
  cash_in_drawer: '45700.00',
  open_session_count: 1,
  receivables_total: '12800.00',
  payables_total: '51000.00',
};

const appendixFStockSummary = {
  stock_value: '40800.00',
  low_count: 1,
  out_count: 1,
  dead_count: 0,
  dead_value: '0',
};

const appendixFLowItems = [
  {
    variant_id: 2,
    product_id: 2,
    item_name: 'Couette 2p',
    display_identifier: 'SKU-000002',
    identifier_type: 'sku',
    base_unit_name: 'Unit',
    quantity: '4.000',
    minimum_stock: '5.000',
    stock_value: '6000.00',
    last_sold_on: '2026-09-24',
    total_count: 1,
  },
];

const appendixFTopItems = [
  {
    variant_id: 1,
    item_name: 'Oreiller blanc',
    base_unit_name: 'Unit',
    quantity_sold: '39.000',
    sales_before_discount: '46450.00',
  },
  {
    variant_id: 2,
    item_name: 'Couette 2p',
    base_unit_name: 'Unit',
    quantity_sold: '6.000',
    sales_before_discount: '12300.00',
  },
];

const appendixFTopCustomers = [
  { customer_id: 1, customer_name: 'Karim', sale_count: 2, sales: '9000.00' },
  { customer_id: 2, customer_name: 'Samir', sale_count: 1, sales: '6300.00' },
];

const appendixFTopDebtors = [
  {
    customer_id: 1,
    customer_name: 'Karim',
    amount_owed: '9000.00',
    oldest_open_on: '2026-09-24',
    oldest_open_days: 0,
  },
  {
    customer_id: 2,
    customer_name: 'Samir',
    amount_owed: '3800.00',
    oldest_open_on: '2026-09-24',
    oldest_open_days: 0,
  },
];

const appendixFLatestSales = [
  {
    document_id: 19,
    document_number: 'CR-2026-000004',
    posted_local: '2026-09-24T10:15:00',
    sale_kind: 'CREDIT',
    customer_name: 'Samir',
    total: '2000.00',
    is_voided: true,
  },
  {
    document_id: 17,
    document_number: 'CS-2026-000005',
    posted_local: '2026-09-24T10:14:00',
    sale_kind: 'CASH',
    customer_name: null,
    total: '2200.00',
    is_voided: false,
  },
];

// 24 series rows for 2026-09-24 (10:00 has the values, others 0)
const appendixFSeries: DashboardSeriesRow[] = Array.from({ length: 24 }, (_, h) => {
  const hourStr = String(h).padStart(2, '0');
  const is10 = h === 10;
  return {
    bucket_start: `2026-09-24T${hourStr}:00:00`,
    sales: is10 ? '58500.00' : '0',
    profit: is10 ? '18300.00' : '0',
    cash_sales: is10 ? '43200.00' : '0',
    credit_sales: is10 ? '15300.00' : '0',
    purchases: is10 ? '81000.00' : '0',
    sale_count: is10 ? 7 : 0,
  };
});

const appendixFCategories = [
  {
    sort_order: 1,
    category_key: 'ID:1',
    category_name: 'Oreillers',
    sales_before_discount: '46450.00',
    share_pct: '79.1',
  },
  {
    sort_order: 2,
    category_key: 'ID:2',
    category_name: 'Couettes',
    sales_before_discount: '12300.00',
    share_pct: '20.9',
  },
];

// 168 cells: Thursday (4), 10:00 has 7 sales, 58500.00
const appendixFBusyHours = Array.from({ length: 7 * 24 }, (_, i) => {
  const weekday = Math.floor(i / 24);
  const hour = i % 24;
  const isTarget = weekday === 4 && hour === 10;
  return {
    weekday,
    hour,
    sale_count: isTarget ? 7 : 0,
    sales: isTarget ? '58500.00' : '0',
  };
});

const appendixFAging = [
  { sort_order: 1, bucket: '0_30', amount: '13300.00', item_count: 3 },
  { sort_order: 2, bucket: '31_60', amount: '0', item_count: 0 },
  { sort_order: 3, bucket: '61_90', amount: '0', item_count: 0 },
  { sort_order: 4, bucket: '91_PLUS', amount: '0', item_count: 0 },
  { sort_order: 5, bucket: 'UNAPPLIED', amount: '-500.00', item_count: 0 },
  { sort_order: 6, bucket: 'TOTAL', amount: '12800.00', item_count: 0 },
];

const defaultSessionValue = {
  user: { username: 'admin', token: 'valid-test-token' },
  activeCashSession: null,
  workstationId: 'WS-01',
  login: vi.fn(),
  logout: vi.fn(),
  clearSession: vi.fn(),
  refreshActiveCashSession: vi.fn(),
  setActiveCashSession: vi.fn(),
};

function renderDashboard() {
  return render(
    <I18nProvider initialLocale="en">
      <SessionContext.Provider value={defaultSessionValue}>
        <DashboardScreen />
      </SessionContext.Provider>
    </I18nProvider>,
  );
}

function setupFullDashboardMocks(overrides: Handlers = {}) {
  wireInvoke({
    dashboard_get_period: () => appendixFPeriod,
    dashboard_get_money_summary: () => appendixFMoney,
    dashboard_get_stock_summary: () => appendixFStockSummary,
    dashboard_list_stock_items: () => appendixFLowItems,
    dashboard_list_top_items: () => appendixFTopItems,
    dashboard_list_top_customers: () => appendixFTopCustomers,
    dashboard_list_top_debtors: () => appendixFTopDebtors,
    dashboard_list_latest_sales: () => appendixFLatestSales,
    dashboard_get_sales_series: () => appendixFSeries,
    dashboard_get_sales_by_category: () => appendixFCategories,
    dashboard_get_busy_hours: () => appendixFBusyHours,
    dashboard_get_receivables_aging: () => appendixFAging,
    get_report_notifications: () => ({ generated_at: '2026-09-24T12:00:00', items: [] }),
    get_dashboard_summary: () => ({
      product_count: 2,
      variant_count: 2,
      active_cash_session_id: 1,
      latest_document_id: 19,
      latest_document_number: 'CR-2026-000004',
      pending_generation_jobs: 0,
      pending_print_jobs: 0,
    }),
    get_primary_packs: () => [],
    ...overrides,
  });
}

describe('Dashboard Charts & Analysis (WS-N-3)', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    cleanup();
    resetDashboardPrefsForTests();
  });

  // T-N3-1: chartFormat unit tests
  it('T-N3-1: chartFormat unit tests verify heatClass, bucketLabel, compactTick, and toPlotNumber', () => {
    // heatClass (max 7: counts 0,1,3,4,5,6,7 -> 0,1,3,3,4,5,5)
    expect(heatClass(0, 7)).toBe(0);
    expect(heatClass(1, 7)).toBe(1);
    expect(heatClass(3, 7)).toBe(3);
    expect(heatClass(4, 7)).toBe(3);
    expect(heatClass(5, 7)).toBe(4);
    expect(heatClass(6, 7)).toBe(5);
    expect(heatClass(7, 7)).toBe(5);

    // bucketLabel
    expect(bucketLabel('2026-09-24T09:00:00', 'HOUR', 'en')).toBe('09:00');
    expect(bucketLabel('2026-09-05T00:00:00', 'DAY', 'en')).toBe('5 Sep');
    expect(bucketLabel('2026-09-01T00:00:00', 'MONTH', 'en')).toBe('Sep 2026');

    // compactTick
    const tick = compactTick(58500, 'en');
    expect(tick.replace(/\s+/g, '')).toMatch(/58\.5K/i);

    // toPlotNumber
    expect(toPlotNumber('58500.00')).toBe(58500);
    expect(toPlotNumber('-1250.50')).toBe(-1250.5);
    expect(toPlotNumber('invalid')).toBe(0);
  });

  // T-N3-2: ChartCard states (loading, ready + toggle, error + retry, empty)
  it('T-N3-2: ChartCard renders skeleton when loading, table when toggled, retry on error, and empty text', () => {
    const onRetry = vi.fn();

    // 1. Loading state
    const { rerender } = render(
      <I18nProvider initialLocale="en">
        <ChartCard
          title="Test Chart"
          state="loading"
          refreshing={false}
          emptyText="No data"
          table={<div>Table Content</div>}
        >
          <div>Chart Content</div>
        </ChartCard>
      </I18nProvider>,
    );
    expect(document.querySelector('.sk-chart-skeleton')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /show as table/i })).not.toBeInTheDocument();

    // 2. Ready state + toggle
    rerender(
      <I18nProvider initialLocale="en">
        <ChartCard
          title="Test Chart"
          state="ready"
          refreshing={false}
          emptyText="No data"
          table={<div>Table Content</div>}
        >
          <div>Chart Content</div>
        </ChartCard>
      </I18nProvider>,
    );
    expect(screen.getByText('Chart Content')).toBeInTheDocument();
    const toggleBtn = screen.getByRole('button', { name: /show as table/i });
    expect(toggleBtn).toBeInTheDocument();
    expect(toggleBtn).toHaveAttribute('aria-pressed', 'false');

    // Toggle to table
    fireEvent.click(toggleBtn);
    expect(screen.getByText('Table Content')).toBeInTheDocument();
    expect(screen.queryByText('Chart Content')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /show as chart/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // 3. Error state with retry
    rerender(
      <I18nProvider initialLocale="en">
        <ChartCard
          title="Test Chart"
          state="error"
          refreshing={false}
          errorText="Network error"
          onRetry={onRetry}
          emptyText="No data"
          table={<div>Table Content</div>}
        >
          <div>Chart Content</div>
        </ChartCard>
      </I18nProvider>,
    );
    const retryBtn = screen.getByRole('button', { name: /retry/i });
    expect(retryBtn).toBeInTheDocument();
    fireEvent.click(retryBtn);
    expect(onRetry).toHaveBeenCalledTimes(1);

    // 4. Empty state
    rerender(
      <I18nProvider initialLocale="en">
        <ChartCard
          title="Test Chart"
          state="empty"
          refreshing={false}
          emptyText="Custom Empty Message"
          table={<div>Table Content</div>}
        >
          <div>Chart Content</div>
        </ChartCard>
      </I18nProvider>,
    );
    expect(screen.getByText('Custom Empty Message')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /show as table/i })).not.toBeInTheDocument();
  });

  // T-N3-3: RankingBars proportional widths and value text
  it('T-N3-3: RankingBars widths are proportional to max value and values are printed', () => {
    const rows = [
      { key: '1', label: 'Item A', value: '1000', valueText: '1,000.00 DZD' },
      { key: '2', label: 'Item B', value: '500', valueText: '500.00 DZD' },
      { key: '3', label: 'Item C', value: '0', valueText: '0.00 DZD' },
    ];

    render(<RankingBars rows={rows} defaultToken="--sk-chart-sales" />);

    expect(screen.getByText('Item A')).toBeInTheDocument();
    expect(screen.getByText('1,000.00 DZD')).toBeInTheDocument();
    expect(screen.getByText('Item B')).toBeInTheDocument();
    expect(screen.getByText('500.00 DZD')).toBeInTheDocument();

    const fills = document.querySelectorAll('.sk-ranking-bars__fill');
    expect(fills).toHaveLength(3);
    // Item A has max (1000/1000 = 100%)
    expect((fills[0] as HTMLElement).style.width).toBe('100%');
    // Item B has half (500/1000 = 50%)
    expect((fills[1] as HTMLElement).style.width).toBe('50%');
    // Item C has 0%
    expect((fills[2] as HTMLElement).style.width).toBe('0%');
  });

  // T-N3-4: HeatmapGrid 168 cells, Sunday first, tooltip focus/hover
  it('T-N3-4: HeatmapGrid renders 168 cells, Sunday first, and displays cell tooltip on focus', () => {
    const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const cells: HeatmapCell[] = Array.from({ length: 7 * 24 }, (_, i) => ({
      weekday: Math.floor(i / 24),
      hour: i % 24,
      count: i === 10 ? 5 : 0,
      valueText: i === 10 ? '5,000.00 DZD' : '0.00 DZD',
    }));

    render(
      <HeatmapGrid
        cells={cells}
        dayLabels={dayLabels}
        cellLabel={(c) => `Day ${c.weekday} Hour ${c.hour}: ${c.count} sales`}
        legend={{ none: 'No sales', fewer: 'Fewer sales', more: 'More sales' }}
      />,
    );

    // Verify day labels: Sunday first
    const labels = document.querySelectorAll('.sk-heatmap-day-label');
    expect(labels[1].textContent).toBe('Sun');

    // Verify 168 interactive cells (plus legend cells)
    const gridCells = document.querySelectorAll('.sk-heatmap-grid .sk-heatmap-cell');
    expect(gridCells).toHaveLength(168);

    // Focus a cell with count = 5
    const cell10 = gridCells[10];
    fireEvent.focus(cell10);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Day 0 Hour 10: 5 sales');
  });

  // T-N3-5: Dashboard workflow with Appendix F data (values match table views)
  it('T-N3-5: Dashboard charts render and table view matches Appendix F fixture values', async () => {
    setupFullDashboardMocks();
    renderDashboard();

    // Wait for initial dashboard load
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();

    // Chart section header
    expect(screen.getByRole('heading', { name: 'Charts & analysis' })).toBeInTheDocument();

    // 7 charts have "Show as table" toggle buttons
    const showTableButtons = await screen.findAllByRole('button', { name: /show as table/i });
    expect(showTableButtons.length).toBe(7);

    // Toggle all 7 charts to table view
    for (const btn of showTableButtons) {
      fireEvent.click(btn);
    }

    // Chart 1 (Sales and profit): row 10 has Sales 58,500.00 DZD, Profit 18,300.00 DZD
    await waitFor(() => {
      expect(screen.getAllByText('58,500.00 DZD').length).toBeGreaterThan(0);
      expect(screen.getAllByText('18,300.00 DZD').length).toBeGreaterThan(0);
    });

    // Chart 4 subtitle totals line: Cash 43,200.00 DZD · Credit 15,300.00 DZD
    expect(
      screen.getByText(/Cash 43,200\.00 DZD · Credit 15,300\.00 DZD/i),
    ).toBeInTheDocument();

    // Chart 7 (Aging table):
    // 0-30 days: 13,300.00 DZD
    expect(screen.getByText('13,300.00 DZD')).toBeInTheDocument();
    // Unapplied: -500.00 DZD
    expect(screen.getByText('-500.00 DZD')).toBeInTheDocument();
    // Total owed: 12,800.00 DZD
    expect(screen.getAllByText('12,800.00 DZD').length).toBeGreaterThan(0);
  });

  // T-N3-6: Isolated error handling
  it('T-N3-6: when one chart command fails, only that chart shows error while others render', async () => {
    setupFullDashboardMocks({
      dashboard_get_sales_by_category: () => {
        throw { code: 'DATABASE_ERROR', message: 'Category table failed' };
      },
    });

    renderDashboard();

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();

    // Other charts load normally (e.g. Sales and profit still has table toggle)
    await waitFor(() => {
      const showTableButtons = screen.getAllByRole('button', { name: /show as table/i });
      expect(showTableButtons.length).toBe(6);
    });

    // Category chart shows error
    expect(screen.getByText(/This part could not be loaded/i)).toBeInTheDocument();
  });
});
