import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

vi.mock('../src/shared/ipc/reportsGateway', () => ({
  getReportsCapabilities: vi.fn(),
  getSalesSummary: vi.fn(),
  getSalesTimeseries: vi.fn(),
  getSalesByProduct: vi.fn(),
  getSalesByCategory: vi.fn(),
  getSalesByCashier: vi.fn(),
  getSalesByHour: vi.fn(),
  getMarginAlerts: vi.fn(),
}));

vi.mock('../src/shared/documents/useOfficialDocumentContext', () => ({
  useOfficialDocumentContext: () => ({ identity: { shopName: 'Test Shop' }, loading: false, reload: () => {} }),
}));

vi.mock('../src/shared/documents/documentPrintService', () => ({
  printDocumentA4: vi.fn(),
  saveDocumentFileWithDialog: vi.fn().mockResolvedValue({ saved: true }),
}));

vi.mock('../src/shared/documents/officialDocument', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/shared/documents/officialDocument')>();
  return {
    ...actual,
    renderOfficialDocumentHtml: vi.fn(() => '<html></html>'),
    renderOfficialDocumentPdf: vi.fn(async () => new Uint8Array([1, 2, 3])),
  };
});

import App from '../src/App';
import * as reportsGateway from '../src/shared/ipc/reportsGateway';
import { printDocumentA4, saveDocumentFileWithDialog } from '../src/shared/documents/documentPrintService';
import { presetPeriod } from '../src/features/reports/common/periods';
import type {
  SalesByCategoryRow,
  SalesByHourCell,
  SalesByProductRow,
  SalesSummary,
} from '../src/shared/ipc/reportsDto';

type Handlers = Record<string, (args: Record<string, unknown>) => unknown>;

function wireInvoke(handlers: Handlers) {
  invokeMock.mockImplementation((command: string, args: Record<string, unknown> = {}) => {
    const handler = handlers[command];
    if (!handler) return Promise.reject({ code: 'INTERNAL_ERROR' });
    try {
      return Promise.resolve(handler(args));
    } catch (error) {
      return Promise.reject(error);
    }
  });
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
      product_count: 0,
      variant_count: 0,
      active_cash_session_id: null,
      latest_document_id: null,
      latest_document_number: null,
      pending_generation_jobs: 0,
      pending_print_jobs: 0,
    }),
    ...extra,
  };
}

function summaryFixture(overrides: Partial<SalesSummary> = {}): SalesSummary {
  return {
    from: '2026-09-01',
    to: '2026-09-27',
    gross_sales: '1200.00',
    discounts: '0.00',
    net_sales: '1200.00',
    cost: '600.00',
    gross_profit: '600.00',
    margin_pct: '50.0',
    sale_count: 5,
    avg_basket: '240.00',
    cash_net: '900.00',
    credit_net: '300.00',
    cash_count: 4,
    credit_count: 1,
    void_count: 1,
    void_total: '80.00',
    units_sold_base: '9',
    ...overrides,
  };
}

function categoryRow(overrides: Partial<SalesByCategoryRow> = {}): SalesByCategoryRow {
  return {
    category_id: 1,
    category_name: 'Bedding',
    net_revenue: '100.00',
    gross_profit: '40.00',
    margin_pct: '40.0',
    quantity_base: '10',
    share_pct: '100.0',
    ...overrides,
  };
}

function productRow(index: number, overrides: Partial<SalesByProductRow> = {}): SalesByProductRow {
  return {
    variant_id: index,
    product_name: `Product ${index}`,
    variant_label: `Variant ${index}`,
    sku: `SKU-${index}`,
    category_name: 'Bedding',
    quantity_base: '10',
    base_unit_name: 'pièce',
    pack_unit_name: null,
    pack_factor: null,
    net_revenue: '100.00',
    cost: '60.00',
    gross_profit: '40.00',
    margin_pct: '40.0',
    sale_count: 1,
    ...overrides,
  };
}

function fullHourGrid(overrides: Array<Partial<SalesByHourCell>> = []): SalesByHourCell[] {
  const cells: SalesByHourCell[] = [];
  for (let weekday = 0; weekday < 7; weekday += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      cells.push({ weekday, hour, sale_count: 0, net_sales: '0.00' });
    }
  }
  for (const override of overrides) {
    const target = cells.find((c) => c.weekday === override.weekday && c.hour === override.hour);
    if (target) Object.assign(target, override);
  }
  return cells;
}

function defaultGatewayMocks() {
  vi.mocked(reportsGateway.getReportsCapabilities).mockResolvedValue({ can_view_reports: true });
  vi.mocked(reportsGateway.getSalesSummary).mockResolvedValue(summaryFixture());
  vi.mocked(reportsGateway.getSalesTimeseries).mockResolvedValue({ granularity: 'DAY', rows: [] });
  vi.mocked(reportsGateway.getSalesByProduct).mockResolvedValue({
    total_count: 0,
    rows: [],
    totals: { net_revenue: '0.00', cost: '0.00', gross_profit: '0.00' },
  });
  vi.mocked(reportsGateway.getSalesByCategory).mockResolvedValue({ rows: [categoryRow()] });
  vi.mocked(reportsGateway.getSalesByCashier).mockResolvedValue({ rows: [] });
  vi.mocked(reportsGateway.getSalesByHour).mockResolvedValue({ rows: fullHourGrid() });
  vi.mocked(reportsGateway.getMarginAlerts).mockResolvedValue({ threshold_pct: '5.0', rows: [] });
}

async function login() {
  await screen.findByRole('heading', { name: 'Sign in' });
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await screen.findByRole('heading', { name: 'Dashboard' });
}

async function openReports() {
  fireEvent.click(await screen.findByRole('button', { name: 'Reports' }));
  await screen.findByTestId('reports-tab-sales');
}

async function openReportsSub(id: string) {
  await openReports();
  if (id !== 'summary') {
    fireEvent.click(screen.getByTestId(`reports-sub-${id}`));
  }
}

beforeEach(() => {
  invokeMock.mockReset();
  vi.resetAllMocks();
  defaultGatewayMocks();
  cleanup();
  document.documentElement.setAttribute('dir', 'ltr');
  document.documentElement.setAttribute('lang', 'en');
  window.localStorage.setItem('stockiha.locale', 'en');
  window.sessionStorage.removeItem('stockiha.reports.lastTab');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('WS-I-1 Reports workflow', () => {
  it('hides the Reports nav item when the capability is false', async () => {
    vi.mocked(reportsGateway.getReportsCapabilities).mockResolvedValue({ can_view_reports: false });
    wireInvoke(baseHandlers());
    render(<App />);
    await login();
    await waitFor(() => expect(reportsGateway.getReportsCapabilities).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Reports' })).not.toBeInTheDocument();
  });

  it('shows the Reports nav item when the capability is true', async () => {
    wireInvoke(baseHandlers());
    render(<App />);
    await login();
    expect(await screen.findByRole('button', { name: 'Reports' })).toBeInTheDocument();
  });

  it('loads the sales summary for This Month by default', async () => {
    wireInvoke(baseHandlers());
    render(<App />);
    await login();
    await openReports();
    const thisMonth = presetPeriod('THIS_MONTH');
    await waitFor(() => {
      expect(reportsGateway.getSalesSummary).toHaveBeenCalledWith('tok', thisMonth.from, thisMonth.to);
    });
  });

  it('reloads when the period changes and ignores a stale response that resolves after a newer one', async () => {
    let resolveFirst!: (value: unknown) => void;
    let resolveSecond!: (value: unknown) => void;
    const first = new Promise((resolve) => { resolveFirst = resolve; });
    const second = new Promise((resolve) => { resolveSecond = resolve; });
    let call = 0;
    vi.mocked(reportsGateway.getSalesByCategory).mockImplementation(() => {
      call += 1;
      return (call === 1 ? first : second) as ReturnType<typeof reportsGateway.getSalesByCategory>;
    });

    wireInvoke(baseHandlers());
    render(<App />);
    await login();
    await openReportsSub('by-category');
    await waitFor(() => expect(reportsGateway.getSalesByCategory).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByTestId('period-preset'), { target: { value: 'THIS_WEEK' } });
    await waitFor(() => expect(reportsGateway.getSalesByCategory).toHaveBeenCalledTimes(2));

    resolveSecond({ rows: [categoryRow({ category_name: 'Second (newer)' })] });
    // `category_name` doubles as both the BarChart's bar label and the
    // table's row text, so scope the query to the table to avoid an
    // ambiguous multi-match against the chart's own <text> label.
    const table = await screen.findByTestId('table-sales-category');
    await within(table).findByText('Second (newer)');

    resolveFirst({ rows: [categoryRow({ category_name: 'First (stale)' })] });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(within(table).queryByText('First (stale)')).not.toBeInTheDocument();
    expect(within(table).getByText('Second (newer)')).toBeInTheDocument();
  });

  it('KPI cards show ▲ with the percentage, ▼, and — for a zero comparison', async () => {
    const thisMonth = presetPeriod('THIS_MONTH');
    vi.mocked(reportsGateway.getSalesSummary).mockImplementation(async (_token, from) => {
      if (from === thisMonth.from) {
        return summaryFixture({ net_sales: '1200.00', margin_pct: '20.0', sale_count: 5 });
      }
      return summaryFixture({ net_sales: '1000.00', margin_pct: '30.0', sale_count: 0 });
    });

    wireInvoke(baseHandlers());
    render(<App />);
    await login();
    await openReports();

    await screen.findByTestId('kpi-net-sales');
    await waitFor(() => {
      expect(within(screen.getByTestId('kpi-net-sales-comparison')).getByText(/▲/)).toBeInTheDocument();
      expect(within(screen.getByTestId('kpi-margin-comparison')).getByText(/▼/)).toBeInTheDocument();
      expect(within(screen.getByTestId('kpi-sale-count-comparison')).getByText('—')).toBeInTheDocument();
    });
  });

  it('debounces the by-product search by 400ms', async () => {
    wireInvoke(baseHandlers());
    render(<App />);
    await login();
    await openReportsSub('by-product');
    await waitFor(() => expect(reportsGateway.getSalesByProduct).toHaveBeenCalledTimes(1));
    vi.mocked(reportsGateway.getSalesByProduct).mockClear();

    vi.useFakeTimers({ shouldAdvanceTime: true });
    const input = screen.getByTestId('product-search');
    fireEvent.change(input, { target: { value: 'p' } });
    fireEvent.change(input, { target: { value: 'pi' } });
    fireEvent.change(input, { target: { value: 'pil' } });

    expect(reportsGateway.getSalesByProduct).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(400);
    await vi.waitFor(() => expect(reportsGateway.getSalesByProduct).toHaveBeenCalledTimes(1));
    expect(reportsGateway.getSalesByProduct).toHaveBeenCalledWith(
      'tok', expect.any(String), expect.any(String), 'REVENUE', 'pil', 50, 0,
    );
    vi.useRealTimers();
  });

  it('Print calls printDocumentA4 once; PDF and CSV call saveDocumentFileWithDialog with the right extension', async () => {
    wireInvoke(baseHandlers());
    render(<App />);
    await login();
    await openReportsSub('by-category');
    await screen.findByTestId('table-sales-category');

    fireEvent.click(screen.getByTestId('report-print'));
    await waitFor(() => expect(printDocumentA4).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId('report-pdf'));
    await waitFor(() => {
      expect(saveDocumentFileWithDialog).toHaveBeenCalledWith(
        expect.objectContaining({ defaultFileName: expect.stringMatching(/\.pdf$/) }),
      );
    });

    fireEvent.click(screen.getByTestId('report-csv'));
    await waitFor(() => {
      expect(saveDocumentFileWithDialog).toHaveBeenCalledWith(
        expect.objectContaining({ defaultFileName: expect.stringMatching(/\.csv$/) }),
      );
    });
  });

  it('exports a paginated report by calling get_sales_by_product with offsets 0, 500, 1000', async () => {
    const total = 1200;
    vi.mocked(reportsGateway.getSalesByProduct).mockImplementation(async (_token, _from, _to, _sort, _search, limit, offset) => {
      const remaining = Math.max(0, total - offset);
      const rows = Array.from({ length: Math.min(limit, remaining) }, (_unused, i) => productRow(offset + i));
      return { total_count: total, rows, totals: { net_revenue: '0.00', cost: '0.00', gross_profit: '0.00' } };
    });

    wireInvoke(baseHandlers());
    render(<App />);
    await login();
    await openReportsSub('by-product');
    await waitFor(() => expect(reportsGateway.getSalesByProduct).toHaveBeenCalledTimes(1));
    vi.mocked(reportsGateway.getSalesByProduct).mockClear();

    fireEvent.click(screen.getByTestId('report-csv'));
    await waitFor(() => expect(saveDocumentFileWithDialog).toHaveBeenCalled());

    const offsets = vi.mocked(reportsGateway.getSalesByProduct).mock.calls.map((call) => call[6]);
    expect(offsets).toEqual([0, 500, 1000]);
  });

  it('busy hours renders 168 cells', async () => {
    vi.mocked(reportsGateway.getSalesByHour).mockResolvedValue({
      rows: fullHourGrid([{ weekday: 3, hour: 17, sale_count: 4, net_sales: '400.00' }]),
    });
    wireInvoke(baseHandlers());
    render(<App />);
    await login();
    await openReportsSub('busy-hours');
    const grid = await screen.findByTestId('heat-busy-hours');
    expect(grid.querySelectorAll('[data-cell]').length).toBe(168);
  });

  it('margin alerts renders the suggested minimum price', async () => {
    vi.mocked(reportsGateway.getMarginAlerts).mockResolvedValue({
      threshold_pct: '5.0',
      rows: [
        {
          variant_id: 1,
          product_name: 'Cheap Pillow',
          variant_label: 'Standard',
          sku: 'SKU-1',
          quantity_base: '1',
          base_unit_name: 'pièce',
          pack_unit_name: null,
          pack_factor: null,
          net_revenue: '60.00',
          cost: '100.00',
          gross_profit: '-40.00',
          margin_pct: '-66.7',
          below_cost_lines: 1,
          current_sale_price: '60.00',
          current_wac: '100.00',
          suggested_min_price: '105.00',
        },
      ],
    });

    wireInvoke(baseHandlers());
    render(<App />);
    await login();
    await openReportsSub('margin-alerts');
    await screen.findByTestId('table-margin-alerts');
    expect(screen.getByText('105.00')).toBeInTheDocument();
  });
});
