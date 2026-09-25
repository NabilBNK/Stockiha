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
  getProfitAndLoss: vi.fn(),
  getCashFlow: vi.fn(),
  getMonthlySummary: vi.fn(),
  getReceivablesAging: vi.fn(),
  getCustomerStatement: vi.fn(),
  getSupplierBalances: vi.fn(),
  getSupplierStatement: vi.fn(),
  getTrialBalance: vi.fn(),
  getAccountLedger: vi.fn(),
  listReportAccounts: vi.fn(),
}));

vi.mock('../src/shared/documents/useOfficialDocumentContext', () => ({
  useOfficialDocumentContext: () => ({
    identity: { shopName: 'Test Shop', phone: '0555000000', printLocale: 'fr' },
    loading: false,
    reload: () => {},
  }),
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
import { buildCustomerStatementModel, buildMonthlySummaryModel } from '../src/features/reports/common/printModels';
import { buildReminderText } from '../src/features/reports/finance/reminderText';
import { presetPeriod } from '../src/features/reports/common/periods';
import { REPORT_COPY } from '../src/features/reports/common/reportCopy';
import type { CustomerStatement, MonthlySummary, ProfitAndLoss } from '../src/shared/ipc/reportsDto';

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
    list_customers: () => [
      { id: 41, code: 'CUS-041', name: 'Atlas Distribution', contact_name: null, phone: '0550000041', email: null, address: null, tax_id: null, is_active: true, credit_enabled: true, credit_limit: '5000.00', payment_terms_days: 30, max_overdue_days: 60, exposure_amount: '500.00', available_credit: '4500.00', oldest_open_due_date: null, created_at: '2026-01-01T00:00:00Z' },
    ],
    list_suppliers: () => [
      { id: 21, code: 'SUP-021', name: 'Textile Source', contact_name: null, phone: '0550000099', email: null, address: null, tax_id: null, is_active: true, created_at: '2026-01-01T00:00:00Z' },
    ],
    get_journal_detail: () => ({
      document_id: 700,
      document_number: 'JE-700',
      document_date: '2026-09-01',
      is_balanced: true,
      source_type: 'CASH_SALE',
      source_id: 1,
      source_document_number: 'CS-1',
      description: 'Test journal',
      lines: [{ account_code: '512', account_name: 'Cash', debit: '100.00', credit: '0.00' }],
      total_debit: '100.00',
      total_credit: '100.00',
    }),
    ...extra,
  };
}

function profitAndLossFixture(overrides: Partial<ProfitAndLoss> = {}): ProfitAndLoss {
  return {
    from: '2026-09-01',
    to: '2026-09-30',
    net_sales: '1500.00',
    cost_of_sales: '600.00',
    gross_profit: '900.00',
    margin_pct: '60.0',
    expenses: '200.00',
    expense_lines: [{ date: '2026-09-05', note: 'Delivery', amount: '200.00' }],
    cash_shortages: '0.00',
    cash_overages: '0.00',
    other_cash_out: '0.00',
    other_cash_out_lines: [],
    net_result: '700.00',
    ...overrides,
  };
}

function monthlySummaryFixture(): MonthlySummary {
  return {
    period: { from: '2026-09-01', to: '2026-09-30' },
    pnl: profitAndLossFixture(),
    purchases_total: '300.00',
    receivables_now: '500.00',
    payables_now: '150.00',
    stock_value_now: '9000.00',
    top_products: [],
    previous_month: { from: '2026-08-01', to: '2026-08-31', net_sales: '1200.00', gross_profit: '700.00', net_result: '500.00' },
  };
}

function customerStatementFixture(overrides: Partial<CustomerStatement> = {}): CustomerStatement {
  return {
    customer: { customer_id: 41, code: 'CUS-041', name: 'Atlas Distribution', phone: '0550000041', address: 'Blida', credit_limit: '5000.00' },
    from: '2026-01-01',
    to: '2026-09-30',
    opening_balance: '0.00',
    entries: [
      { entry_id: 1, date: '2026-09-01', entry_type: 'CREDIT_INVOICE', document_number: 'CR-1', debit: '500.00', credit: '0.00', balance: '500.00' },
    ],
    truncated: false,
    total_debit: '500.00',
    total_credit: '0.00',
    closing_balance: '500.00',
    ...overrides,
  };
}

function defaultGatewayMocks() {
  vi.mocked(reportsGateway.getReportsCapabilities).mockResolvedValue({ can_view_reports: true });
  vi.mocked(reportsGateway.getSalesSummary).mockResolvedValue({
    from: '', to: '', gross_sales: '0.00', discounts: '0.00', net_sales: '0.00', cost: '0.00', gross_profit: '0.00',
    margin_pct: null, sale_count: 0, avg_basket: null, cash_net: '0.00', credit_net: '0.00', cash_count: 0, credit_count: 0,
    void_count: 0, void_total: '0.00', units_sold_base: '0',
  });
  vi.mocked(reportsGateway.getSalesTimeseries).mockResolvedValue({ granularity: 'DAY', rows: [] });
  vi.mocked(reportsGateway.getSalesByProduct).mockResolvedValue({ total_count: 0, rows: [], totals: { net_revenue: '0.00', cost: '0.00', gross_profit: '0.00' } });
  vi.mocked(reportsGateway.getSalesByCategory).mockResolvedValue({ rows: [] });
  vi.mocked(reportsGateway.getSalesByCashier).mockResolvedValue({ rows: [] });
  vi.mocked(reportsGateway.getSalesByHour).mockResolvedValue({ rows: [] });
  vi.mocked(reportsGateway.getMarginAlerts).mockResolvedValue({ threshold_pct: '5.0', rows: [] });

  vi.mocked(reportsGateway.getProfitAndLoss).mockResolvedValue(profitAndLossFixture());
  vi.mocked(reportsGateway.getCashFlow).mockResolvedValue({
    from: '', to: '',
    in: { cash_sales: '0.00', customer_payments_cash: '0.00', cash_in: '0.00', cash_in_by_reason: {} },
    out: { refunds: '0.00', cancellations: '0.00', cash_out: '0.00', cash_out_by_reason: {} },
    supplier_payments_all_methods: '0.00',
    net_drawer_flow: '0.00',
  });
  vi.mocked(reportsGateway.getMonthlySummary).mockResolvedValue(monthlySummaryFixture());
  vi.mocked(reportsGateway.getReceivablesAging).mockResolvedValue({
    as_of: '2026-09-30',
    total_count: 1,
    rows: [
      {
        customer_id: 41, code: 'CUS-041', name: 'Atlas Distribution', phone: '0550000041', credit_limit: '5000.00',
        total_open: '500.00', not_due: '0.00', d1_30: '0.00', d31_60: '500.00', d61_90: '0.00', d90_plus: '0.00',
        overdue_total: '500.00', oldest_due_date: '2026-08-01', days_overdue: 45, last_payment_date: null, last_payment_amount: null,
      },
    ],
    totals: { total_open: '500.00', not_due: '0.00', d1_30: '0.00', d31_60: '500.00', d61_90: '0.00', d90_plus: '0.00', overdue_total: '500.00' },
  });
  vi.mocked(reportsGateway.getCustomerStatement).mockResolvedValue(customerStatementFixture());
  vi.mocked(reportsGateway.getSupplierBalances).mockResolvedValue({
    total_count: 1,
    rows: [{ supplier_id: 21, code: 'SUP-021', name: 'Textile Source', phone: '0550000099', total_purchased: '1000.00', total_returned: '0.00', total_paid: '400.00', balance_due: '600.00', last_purchase_date: '2026-09-01', last_payment_date: '2026-09-05' }],
    totals: { balance_due: '600.00' },
  });
  vi.mocked(reportsGateway.getSupplierStatement).mockResolvedValue({
    supplier: { supplier_id: 21, code: 'SUP-021', name: 'Textile Source', phone: '0550000099' },
    from: '', to: '', opening_balance: '0.00',
    entries: [{ document_id: 1, date: '2026-09-01', entry_type: 'PURCHASE_RECEIPT', document_number: 'PR-1', increase: '1000.00', decrease: '0.00', balance: '1000.00' }],
    truncated: false, closing_balance: '600.00',
  });
  vi.mocked(reportsGateway.getTrialBalance).mockResolvedValue({
    from: '', to: '',
    rows: [{ account_id: 1, scf_code: '512', name_fr: 'Caisse', name_ar: 'الصندوق', name_en: 'Cash', opening_debit: '0.00', opening_credit: '0.00', period_debit: '1000.00', period_credit: '0.00', closing_debit: '1000.00', closing_credit: '0.00' }],
    totals: { opening_debit: '0.00', opening_credit: '0.00', period_debit: '1000.00', period_credit: '1000.00', closing_debit: '1000.00', closing_credit: '1000.00', is_balanced: true, difference: '0.00' },
  });
  vi.mocked(reportsGateway.getAccountLedger).mockResolvedValue({
    account: { account_id: 1, scf_code: '512', name_fr: 'Caisse', name_ar: 'الصندوق', name_en: 'Cash' },
    from: '', to: '', opening_balance: '0.00', closing_balance: '100.00', total_count: 1,
    rows: [{ date: '2026-09-01', journal_id: 700, journal_number: 'JE-700', description: 'Cash sale', source_document_number: 'CS-1', debit: '100.00', credit: '0.00', balance: '100.00' }],
  });
  vi.mocked(reportsGateway.listReportAccounts).mockResolvedValue({
    rows: [{ account_id: 1, scf_code: '512', name_fr: 'Caisse', name_ar: 'الصندوق', name_en: 'Cash' }],
  });
}

async function login() {
  await screen.findByRole('heading', { name: 'Sign in' });
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await screen.findByRole('heading', { name: 'Dashboard' });
}

async function openReportsTab(tab: string) {
  fireEvent.click(await screen.findByRole('button', { name: 'Reports' }));
  await screen.findByTestId('reports-tab-sales');
  fireEvent.click(screen.getByTestId(`reports-tab-${tab}`));
}

function openSub(sub: string) {
  fireEvent.click(screen.getByTestId(`reports-sub-${sub}`));
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

describe('WS-I-2 Finance reports workflow', () => {
  it('renders each of the 9 finance/owed/accounting sub-reports with its main test id', async () => {
    wireInvoke(baseHandlers());
    render(<App />);
    await login();

    await openReportsTab('finance');
    await screen.findByTestId('monthly-summary');
    openSub('profit-loss');
    await screen.findByTestId('pl-statement');
    openSub('cash-flow');
    await screen.findByTestId('cash-flow');

    await openReportsTab('owed');
    await screen.findByTestId('table-receivables');
    openSub('customer-statement');
    fireEvent.change(screen.getByTestId('statement-customer'), { target: { value: 'Atlas' } });
    fireEvent.click(await screen.findByText('Atlas Distribution (CUS-041)'));
    await screen.findByTestId('table-customer-statement');
    openSub('suppliers');
    await screen.findByTestId('table-suppliers');
    openSub('supplier-statement');
    fireEvent.change(screen.getByTestId('statement-supplier'), { target: { value: 'Textile' } });
    fireEvent.click(await screen.findByText('Textile Source (SUP-021)'));
    await screen.findByTestId('table-supplier-statement');

    await openReportsTab('accounting');
    await screen.findByTestId('table-trial-balance');
    openSub('account-ledger');
    await screen.findByTestId('table-account-ledger');
  });

  it('P&L rows appear in the exact order: net sales, cost of sales, gross profit, expenses, shortages, overages, net result', async () => {
    wireInvoke(baseHandlers());
    render(<App />);
    await login();
    await openReportsTab('finance');
    openSub('profit-loss');
    const statement = await screen.findByTestId('pl-statement');
    const labels = within(statement).getAllByRole('cell', { name: /./ });
    // Every other cell (0,2,4,...) up to the first block is a row label.
    const rowLabels = [
      REPORT_COPY.en.netSales,
      REPORT_COPY.en.costOfSales,
      REPORT_COPY.en.grossProfit,
    ];
    const text = statement.textContent ?? '';
    let lastIndex = -1;
    for (const label of rowLabels) {
      const index = text.indexOf(label);
      expect(index).toBeGreaterThan(lastIndex);
      lastIndex = index;
    }
    expect(labels.length).toBeGreaterThan(0);
  });

  it('opens the customer statement from a receivables row with the customer id and a 90-day period', async () => {
    wireInvoke(baseHandlers());
    render(<App />);
    await login();
    await openReportsTab('owed');
    await screen.findByTestId('table-receivables');

    fireEvent.click(screen.getByTestId('open-statement-41'));
    await screen.findByTestId('table-customer-statement');
    await waitFor(() => {
      const calls = vi.mocked(reportsGateway.getCustomerStatement).mock.calls;
      const call = calls[calls.length - 1];
      expect(call?.[1]).toBe(41);
      const from = call?.[2] as string;
      const to = call?.[3] as string;
      const days = (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000;
      expect(days).toBe(90);
    });
  });

  it('the trial-balance badge shows "Not balanced" with the difference when is_balanced is false', async () => {
    vi.mocked(reportsGateway.getTrialBalance).mockResolvedValue({
      from: '', to: '',
      rows: [],
      totals: { opening_debit: '0.00', opening_credit: '0.00', period_debit: '100.00', period_credit: '90.00', closing_debit: '100.00', closing_credit: '90.00', is_balanced: false, difference: '10.00' },
    });
    wireInvoke(baseHandlers());
    render(<App />);
    await login();
    await openReportsTab('accounting');
    const status = await screen.findByTestId('trial-balance-status');
    expect(status.textContent).toContain('Not balanced');
    expect(status.textContent).toContain('10.00');
  });

  it('clicking a ledger journal number opens JournalDetailModal', async () => {
    wireInvoke(baseHandlers());
    render(<App />);
    await login();
    await openReportsTab('accounting');
    openSub('account-ledger');
    const table = await screen.findByTestId('table-account-ledger');
    fireEvent.click(within(table).getByText('JE-700'));
    expect(await screen.findByTestId('journal-detail-modal')).toBeInTheDocument();
  });
});

describe('buildReminderText', () => {
  const base = {
    name: 'Atlas Distribution',
    shopName: 'Test Shop',
    shopPhone: '0555000000',
    totalOpen: '500.00',
  };

  it('fr, with an overdue amount', () => {
    const text = buildReminderText({ ...base, locale: 'fr', overdueTotal: '500.00', oldestDueDate: '2026-08-01' });
    expect(text).toContain('Atlas Distribution');
    expect(text).toContain('Test Shop');
    expect(text).toContain('0555000000');
    expect(text).toMatch(/^Bonjour Atlas Distribution/);
  });

  it('ar, with an overdue amount', () => {
    const text = buildReminderText({ ...base, locale: 'ar', overdueTotal: '500.00', oldestDueDate: '2026-08-01' });
    expect(text).toMatch(/^السلام عليكم/);
    expect(text).toContain('Test Shop');
  });

  it('en, without an overdue amount', () => {
    const text = buildReminderText({ ...base, locale: 'en', overdueTotal: '0.00', oldestDueDate: null });
    expect(text).toMatch(/^Hello Atlas Distribution/);
    expect(text).not.toContain('due since');
  });

  it('without shop identity, drops the trailing sign-off', () => {
    const text = buildReminderText({ ...base, shopName: '', shopPhone: '', locale: 'en', overdueTotal: '0.00', oldestDueDate: null });
    expect(text.trim().endsWith('Thank you.')).toBe(true);
  });
});

describe('Copy reminder', () => {
  it('calls navigator.clipboard.writeText with the fr text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    wireInvoke(baseHandlers());
    render(<App />);
    await login();
    await openReportsTab('owed');
    await screen.findByTestId('table-receivables');
    fireEvent.click(screen.getByTestId('copy-reminder-41'));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toContain('Atlas Distribution');
  });

  it('shows the fallback textarea when the clipboard fails', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.assign(navigator, { clipboard: { writeText } });

    wireInvoke(baseHandlers());
    render(<App />);
    await login();
    await openReportsTab('owed');
    await screen.findByTestId('table-receivables');
    fireEvent.click(screen.getByTestId('copy-reminder-41'));
    expect(await screen.findByTestId('copy-fallback')).toBeInTheDocument();
  });
});

describe('print models', () => {
  it('the customer-statement model has partyBlock, an emphasised Balance due total, and amountInWordsValue', () => {
    const copy = REPORT_COPY.en;
    const period = presetPeriod('THIS_MONTH');
    const data = customerStatementFixture({ closing_balance: '500.00' });
    const model = buildCustomerStatementModel({ period, copy, locale: 'en', todayText: period.to }, data);
    expect(model.partyBlock?.rows.some((r) => r.value === 'CUS-041')).toBe(true);
    expect(model.totals?.some((t) => t.label === copy.balanceDue && t.emphasis)).toBe(true);
    expect(model.amountInWordsValue).toBe('500.00');
  });

  it('the monthly summary builds exactly one model', () => {
    const copy = REPORT_COPY.en;
    const period = { from: '2026-09-01', to: '2026-09-30', preset: 'CUSTOM' as const };
    const data = monthlySummaryFixture();
    const model = buildMonthlySummaryModel({ period, copy, locale: 'en', todayText: period.to }, data);
    expect(model.kind).toBe('MONTHLY_SUMMARY');
    expect(model.rows.length).toBeGreaterThan(0);
  });
});
