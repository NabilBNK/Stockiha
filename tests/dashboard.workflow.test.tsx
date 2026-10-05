import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { DashboardScreen } from '../src/features/dashboard/DashboardScreen';
import { SessionContext } from '../src/shared/session/SessionContext';
import { I18nProvider } from '../src/shared/i18n';
import { resetDashboardPrefsForTests } from '../src/features/dashboard/dashboardPrefs';
import type { NavAccess } from '../src/app/navigationAccess';
import type { DashboardPeriod } from '../src/shared/ipc/dashboardDto';

type Handlers = Record<string, (args: Record<string, unknown>) => unknown>;

function wireInvoke(handlers: Handlers) {
  invokeMock.mockImplementation((command: string, args: Record<string, unknown> = {}) => {
    const handler = handlers[command];
    if (!handler) return Promise.reject({ code: 'INTERNAL_ERROR', message: `Unknown command ${command}` });
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
  {
    document_id: 16,
    document_number: 'CR-2026-000003',
    posted_local: '2026-09-24T10:13:00',
    sale_kind: 'CREDIT',
    customer_name: 'Karim',
    total: '5000.00',
    is_voided: false,
  },
  {
    document_id: 14,
    document_number: 'CR-2026-000002',
    posted_local: '2026-09-24T10:12:00',
    sale_kind: 'CREDIT',
    customer_name: 'Samir',
    total: '6300.00',
    is_voided: false,
  },
  {
    document_id: 13,
    document_number: 'CS-2026-000004',
    posted_local: '2026-09-24T10:11:00',
    sale_kind: 'CASH',
    customer_name: null,
    total: '36000.00',
    is_voided: false,
  },
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

function renderDashboard(
  props: { onNavigate?: (v: string) => void; access?: NavAccess } = {},
  sessionOverrides: Partial<typeof defaultSessionValue> = {},
) {
  const session = { ...defaultSessionValue, ...sessionOverrides };
  return render(
    <I18nProvider initialLocale="en">
      <SessionContext.Provider value={session}>
        <DashboardScreen {...props} />
      </SessionContext.Provider>
    </I18nProvider>,
  );
}

describe('Dashboard Integration Tests (Sub-plan N-2)', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    cleanup();
    resetDashboardPrefsForTests();
  });

  function setupAppendixFMocks(overrides: Handlers = {}) {
    wireInvoke({
      dashboard_get_period: () => appendixFPeriod,
      dashboard_get_money_summary: () => appendixFMoney,
      dashboard_get_stock_summary: () => appendixFStockSummary,
      dashboard_list_stock_items: () => appendixFLowItems,
      dashboard_list_top_items: () => appendixFTopItems,
      dashboard_list_top_customers: () => appendixFTopCustomers,
      dashboard_list_top_debtors: () => appendixFTopDebtors,
      dashboard_list_latest_sales: () => appendixFLatestSales,
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

  // T-N2-1
  it('T-N2-1: happy path renders heading, KPIs, deltas, and lists from Appendix F fixtures', async () => {
    setupAppendixFMocks();
    renderDashboard();

    // 1. Heading renders immediately
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();

    // 2. Sales KPI shows "58,500" and ".00 DZD"
    await waitFor(() => {
      expect(screen.getByText('58,500')).toBeInTheDocument();
      expect(screen.getAllByText('.00 DZD')[0]).toBeInTheDocument();
    });

    // 3. Profit "18,300" and margin "Margin 31.3%"
    expect(screen.getByText('18,300')).toBeInTheDocument();
    expect(screen.getByText('Margin 31.3%')).toBeInTheDocument();

    // 4. Number of sales "7" with "Average sale 8,357.14 DZD"
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText(/Average sale 8,357\.14 DZD/)).toBeInTheDocument();

    // 5. Delta line shows "Previous period: 0.00 DZD"
    expect(screen.getAllByText('Previous period: 0.00 DZD').length).toBeGreaterThan(0);

    // 6. Customers owe you "12,800"
    expect(screen.getByText('12,800')).toBeInTheDocument();

    // 7. Low stock "1" and Out of stock "1"
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(2);

    // 8. Best-selling items lists Oreiller blanc and Couette 2p
    expect(screen.getByText('Oreiller blanc')).toBeInTheDocument();
    expect(screen.getAllByText('Couette 2p').length).toBeGreaterThanOrEqual(1);

    // 9. Latest sales shows voided badge
    expect(screen.getByText('Voided')).toBeInTheDocument();
  });

  // T-N2-2
  it('T-N2-2: isolation - failing money summary shows error + Retry while other sections render', async () => {
    let moneyFail = true;
    setupAppendixFMocks({
      dashboard_get_money_summary: () => {
        if (moneyFail) {
          throw { code: 'DATABASE_ERROR', message: 'DB down' };
        }
        return appendixFMoney;
      },
    });

    renderDashboard();

    // Money section displays error
    await waitFor(() => {
      expect(document.body.textContent).toContain('This part could not be loaded');
    });

    // Stock and Lists still render
    expect(screen.getByText('Stock value')).toBeInTheDocument();
    expect(screen.getByText('Best-selling items')).toBeInTheDocument();

    // Retry recovers money section
    moneyFail = false;
    const retryButtons = screen.getAllByRole('button', { name: 'Retry' });
    fireEvent.click(retryButtons[0]);

    await waitFor(() => {
      expect(screen.getByText('58,500')).toBeInTheDocument();
    });
  });

  // T-N2-3
  it('T-N2-3: unknown commands - heading still renders without unhandled rejection', async () => {
    wireInvoke({
      get_dashboard_summary: () => ({
        product_count: 2,
        variant_count: 2,
        active_cash_session_id: null,
        latest_document_id: null,
        latest_document_number: null,
        pending_generation_jobs: 0,
        pending_print_jobs: 0,
      }),
    });

    renderDashboard();

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
  });

  // T-N2-4
  it('T-N2-4: stale response discarded when changing periods quickly', async () => {
    let resolveMonth: (val: DashboardPeriod) => void;
    const slowMonthPromise = new Promise<DashboardPeriod>((resolve) => {
      resolveMonth = resolve;
    });

    setupAppendixFMocks({
      dashboard_get_period: ({ period }: { period?: unknown }) => {
        if (period === 'month') {
          return slowMonthPromise;
        }
        if (period === 'week') {
          return {
            ...appendixFPeriod,
            cur_from: '2026-09-21',
            cur_to: '2026-09-24',
          };
        }
        return appendixFPeriod;
      },
      dashboard_get_money_summary: ({ curFrom }: { curFrom?: unknown }) => {
        if (curFrom === '2026-09-01') {
          return { ...appendixFMoney, sales: '99999.00' };
        }
        if (curFrom === '2026-09-21') {
          return { ...appendixFMoney, sales: '11111.00' };
        }
        return appendixFMoney;
      },
    });

    renderDashboard();
    await screen.findByText('58,500');

    // Click "This month" (slow)
    fireEvent.click(screen.getByRole('button', { name: 'This month' }));
    // Immediately click "This week" (fast)
    fireEvent.click(screen.getByRole('button', { name: 'This week' }));

    // Week resolves first
    await waitFor(() => {
      expect(screen.getByText('11,111')).toBeInTheDocument();
    });

    // Now month resolves late
    resolveMonth!({
      ...appendixFPeriod,
      cur_from: '2026-09-01',
      cur_to: '2026-09-24',
    });

    // The screen must NOT overwrite with month's 99,999!
    await new Promise((r) => setTimeout(r, 60));
    expect(screen.queryByText('99,999')).not.toBeInTheDocument();
    expect(screen.getByText('11,111')).toBeInTheDocument();
  });

  // T-N2-5
  it('T-N2-5: custom validation shows error when from > to and makes no call', async () => {
    const periodSpy = vi.fn().mockReturnValue(appendixFPeriod);
    setupAppendixFMocks({
      dashboard_get_period: periodSpy,
    });

    renderDashboard();
    await screen.findByRole('heading', { name: 'Dashboard' });

    // Click "Custom"
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));

    const fromInput = screen.getByLabelText('From');
    const toInput = screen.getByLabelText('To');
    const applyBtn = screen.getByRole('button', { name: 'Apply' });

    periodSpy.mockClear();

    // Set from > to
    fireEvent.change(fromInput, { target: { value: '2026-09-25' } });
    fireEvent.change(toInput, { target: { value: '2026-09-20' } });
    fireEvent.click(applyBtn);

    expect(screen.getByText('The start date must be on or before the end date.')).toBeInTheDocument();
    expect(periodSpy).not.toHaveBeenCalled();
  });

  // T-N2-6
  it('T-N2-6: compare switch hides delta lines without any new IPC call', async () => {
    const periodSpy = vi.fn().mockReturnValue(appendixFPeriod);
    setupAppendixFMocks({
      dashboard_get_period: periodSpy,
    });

    renderDashboard();
    await screen.findByText('58,500');

    expect(screen.getAllByText('Previous period: 0.00 DZD').length).toBeGreaterThan(0);
    periodSpy.mockClear();

    const compareCheckbox = screen.getByLabelText('Compare with previous period');
    fireEvent.click(compareCheckbox);

    // Deltas are hidden
    expect(screen.queryByText('Previous period: 0.00 DZD')).not.toBeInTheDocument();
    expect(periodSpy).not.toHaveBeenCalled();
  });

  // T-N2-7
  it('T-N2-7: quick actions hide adjustment when corrections are disabled and navigate on click', async () => {
    setupAppendixFMocks();
    const navMock = vi.fn();

    renderDashboard({
      onNavigate: navMock,
      access: {
        inventoryCapabilities: {
          can_manage_catalog: true,
          can_view_inventory: true,
          can_post_stock_receipt: true,
          can_manage_inventory: true,
        },
        inventoryCorrectionsEnabled: false, // Disabled!
        procurementCapabilities: {
          can_manage_procurement: true,
          can_post_purchase_receipt: true,
          can_post_supplier_invoice: true,
          can_post_supplier_return: true,
          can_post_supplier_payment: true,
        },
        customerCapabilities: {
          can_view_customers: true,
          can_manage_customers: true,
          can_post_credit_sale: true,
          can_post_customer_payment: true,
          can_post_customer_refund: true,
          can_manage_drawer_policy: true,
          can_override_credit_limit: true,
          can_apply_sale_discount: true,
        },
        reportsCapabilities: {
          can_view_reports: true,
        },
      },
    });

    await screen.findByRole('heading', { name: 'Dashboard' });

    // Stock adjustment action is absent
    expect(screen.queryByRole('button', { name: /Stock adjustment/ })).not.toBeInTheDocument();

    // New sale action is present and navigates to pos
    const newSaleBtn = screen.getByRole('button', { name: /New sale/ });
    fireEvent.click(newSaleBtn);
    expect(navMock).toHaveBeenCalledWith('pos');
  });

  // T-N2-8
  it('T-N2-8: stock dialog opens, shows page 1 items, and closes on Escape', async () => {
    setupAppendixFMocks();
    renderDashboard();
    await screen.findByText('Low stock');

    // Click Low stock KPI
    const lowStockBtn = screen.getByRole('button', { name: /Low stock/i });
    fireEvent.click(lowStockBtn);

    // Dialog opens with title "Low stock items"
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Low stock items' })).toBeInTheDocument();
    expect(screen.getByText('SKU-000002')).toBeInTheDocument();

    // Press Escape to close
    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  // T-N2-9
  it('T-N2-9: SESSION_INVALID triggers clearSession once', async () => {
    const clearSessionMock = vi.fn();
    setupAppendixFMocks({
      dashboard_get_period: () => {
        throw { code: 'SESSION_INVALID', message: 'SESSION_INVALID' };
      },
    });

    renderDashboard({}, { clearSession: clearSessionMock });

    await waitFor(() => {
      expect(clearSessionMock).toHaveBeenCalledTimes(1);
    });
  });
});
