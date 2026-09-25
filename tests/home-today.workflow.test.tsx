// WS-I-3 STEP I3-11 — the "Today" home page and buildDailySummary.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { buildDailySummary } from '../src/features/dashboard/dailySummaryText';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

vi.mock('../src/shared/documents/useOfficialDocumentContext', () => ({
  useOfficialDocumentContext: () => ({
    identity: { shopName: 'Test Shop', phone: '0555000000', printLocale: 'fr' },
    loading: false,
    reload: () => {},
  }),
}));

import App from '../src/App';

type Handlers = Record<string, (args: Record<string, unknown>) => unknown>;

function wireInvoke(handlers: Handlers) {
  invokeMock.mockImplementation((command: string, args: Record<string, unknown> = {}) => {
    const handler = handlers[command];
    if (!handler) return Promise.reject({ code: 'INTERNAL_ERROR', message: `No mock for ${command}` });
    try {
      return Promise.resolve(handler(args));
    } catch (error) {
      return Promise.reject(error);
    }
  });
}

const todaySummary = {
  from: '2026-09-25', to: '2026-09-25',
  gross_sales: '1000.00', discounts: '0.00', net_sales: '1000.00', cost: '600.00',
  gross_profit: '400.00', margin_pct: '40.0', sale_count: 5, avg_basket: '200.00',
  cash_net: '1000.00', credit_net: '0.00', cash_count: 5, credit_count: 0,
  void_count: 0, void_total: '0.00', units_sold_base: '10',
};

const lastWeekSummary = {
  ...todaySummary,
  from: '2026-09-18', to: '2026-09-18',
  net_sales: '500.00', gross_profit: '200.00', sale_count: 2, avg_basket: '250.00',
};

function todayOverviewFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    today: { date: '2026-09-25', summary: todaySummary },
    same_day_last_week: { date: '2026-09-18', summary: lastWeekSummary },
    hourly_today: Array.from({ length: 24 }, (_, hour) => ({ hour, net_sales: hour === 10 ? '1000.00' : '0.00', sale_count: hour === 10 ? 5 : 0 })),
    top_products_today: [
      { variant_id: 1, product_name: 'Widget', variant_label: 'Red', sku: 'SKU-1', category_name: null, quantity_base: '5', base_unit_name: 'piece', pack_unit_name: null, pack_factor: null, net_revenue: '1000.00', cost: '600.00', gross_profit: '400.00', margin_pct: '40.0', sale_count: 5 },
    ],
    drawer: null,
    receivables_total: '2000.00',
    overdue_total: '500.00',
    payables_total: '300.00',
    low_stock_count: 3,
    out_of_stock_count: 1,
    month_to_date: { from: '2026-09-01', to: '2026-09-25', net_sales: '10000.00', gross_profit: '4000.00' },
    ...overrides,
  };
}

function baseHandlers(extra: Handlers = {}): Handlers {
  return {
    get_setup_status: () => ({
      initialized: true,
      administrator_exists: true,
      warehouse_exists: true,
      open_fiscal_period_exists: true,
      workstation_configured: true,
    }),
    login: () => ({ session_token: 'tok', expires_at: '2026-12-31T23:59:59Z' }),
    logout: () => null,
    inspect_active_cash_session: () => null,
    list_warehouses: () => [{ id: 1, code: 'WH1', name: 'Main Warehouse', is_active: true }],
    get_open_fiscal_period: () => ({ id: 9, period_code: '2026', starts_on: '2026-01-01', ends_on: '2026-12-31' }),
    get_dashboard_summary: () => ({
      product_count: 7,
      variant_count: 12,
      active_cash_session_id: null,
      latest_document_id: null,
      latest_document_number: null,
      pending_generation_jobs: 0,
      pending_print_jobs: 0,
    }),
    get_reports_capabilities: () => ({ can_view_reports: true }),
    get_report_notifications: () => ({ generated_at: '2026-09-25T00:00:00Z', items: [] }),
    get_today_overview: () => todayOverviewFixture(),
    ...extra,
  };
}

async function login() {
  await screen.findByRole('heading', { name: 'Sign in' });
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await screen.findByRole('heading', { name: 'Dashboard' });
}

beforeEach(() => {
  invokeMock.mockReset();
  cleanup();
  document.documentElement.setAttribute('dir', 'ltr');
  document.documentElement.setAttribute('lang', 'en');
  window.localStorage.setItem('stockiha.locale', 'en');
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('WS-I-3 Today home page', () => {
  it('shows today\'s KPIs with a comparison arrow against the same day last week', async () => {
    wireInvoke(baseHandlers());
    render(<App />);
    await login();

    const sales = await screen.findByTestId('home-kpi-sales');
    expect(sales.textContent).toContain('1000.00');
    const salesComparison = await screen.findByTestId('home-kpi-sales-comparison');
    expect(salesComparison.textContent).toContain('▲');
  });

  it('shows the no-session drawer state with home-open-session', async () => {
    wireInvoke(baseHandlers());
    render(<App />);
    await login();

    expect(await screen.findByTestId('home-open-session')).toBeInTheDocument();
  });

  it('copy-daily-summary calls the clipboard with the fr text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    wireInvoke(baseHandlers());
    render(<App />);
    await login();

    fireEvent.click(await screen.findByTestId('copy-daily-summary'));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const text = writeText.mock.calls[0][0] as string;
    expect(text).toContain('Résumé du');
    expect(text).toContain('Test Shop');
  });

  it('the old dashboard test id ("dashboard") is still present, inside home-system-status', async () => {
    wireInvoke(baseHandlers());
    render(<App />);
    await login();

    const status = await screen.findByTestId('home-system-status');
    expect(status.querySelector('[data-testid="dashboard"]')).not.toBeNull();
  });

  it('without VIEW_REPORTS, home-no-reports shows and home-system-status still renders', async () => {
    wireInvoke(baseHandlers({ get_today_overview: () => Promise.reject({ code: 'PERMISSION_DENIED' }) }));
    render(<App />);
    await login();

    expect(await screen.findByTestId('home-no-reports')).toBeInTheDocument();
    expect(await screen.findByTestId('home-system-status')).toBeInTheDocument();
  });
});

describe('buildDailySummary', () => {
  const base = {
    shopName: 'Test Shop',
    date: '2026-09-25',
    netSales: '1000.00',
    saleCount: 5,
    grossProfit: '400.00',
    expected: '1200.00',
    receivables: '2000.00',
    overdue: '500.00',
    lowStock: 3,
  };

  it('returns the exact fr text', () => {
    const text = buildDailySummary({ ...base, locale: 'fr' });
    expect(text).toBe(
      [
        'Test Shop — Résumé du 25 sept. 2026',
        'Ventes : 1,000.00 DZD (5 ventes)',
        'Marge brute : 400.00 DZD',
        'Caisse attendue : 1,200.00 DZD',
        'Créances clients : 2,000.00 DZD (dont 500.00 DZD échus)',
        'Stock bas : 3 articles',
      ].join('\n'),
    );
  });

  it('returns the exact en text without a shop name', () => {
    const text = buildDailySummary({ ...base, shopName: '', locale: 'en' });
    expect(text.startsWith('Summary for')).toBe(true);
    expect(text).not.toContain('Test Shop');
  });

  it('returns the no-session cash line variant in all three locales', () => {
    const fr = buildDailySummary({ ...base, expected: null, locale: 'fr' });
    expect(fr).toContain('Caisse : aucune session ouverte');
    const ar = buildDailySummary({ ...base, expected: null, locale: 'ar' });
    expect(ar).toContain('الصندوق: لا توجد حصة مفتوحة');
    const en = buildDailySummary({ ...base, expected: null, locale: 'en' });
    expect(en).toContain('Cash: no session open');
  });

  it('returns the exact ar text', () => {
    const text = buildDailySummary({ ...base, locale: 'ar' });
    expect(text).toContain('ملخص يوم');
    expect(text).toContain('المبيعات:');
    expect(text).toContain('الربح الإجمالي:');
  });
});
