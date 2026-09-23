import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
// @ts-expect-error Node-only test helper reading a fixture font for the PDF path.
import { readFile } from 'node:fs/promises';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

import App from '../src/App';

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

const initialized = () => ({
  initialized: true,
  administrator_exists: true,
  warehouse_exists: true,
  open_fiscal_period_exists: true,
  workstation_configured: true,
});

function activeSession() {
  return {
    id: 77,
    warehouse_id: 1,
    opened_by_user_id: 10,
    opening_float: '1000.00',
    opened_at: '2026-07-31T08:00:00Z',
  };
}

function lifecycle(overrides: Record<string, unknown> = {}) {
  return {
    id: 77,
    warehouse_id: 1,
    workstation_id: 'STOCKIHA-01',
    opened_by_user_id: 10,
    current_cashier_user_id: 10,
    current_cashier_display_name: 'Cashier One',
    status: 'OPEN',
    opening_float: '1000.00',
    opened_at: '2026-07-31T08:00:00Z',
    close_attempt_id: null,
    expected_amount: null,
    counted_amount: null,
    variance_amount: null,
    requires_manager_approval: null,
    suspension_reason: null,
    ...overrides,
  };
}

const PRINTING_SETTINGS_BASE = {
  receipt_printing_enabled: true,
  receipt_target: 'THERMAL',
  thermal_printer_name: 'EPSON-TM88',
  thermal_columns: 42,
  shop_name: 'Stockiha Shop',
  shop_address: null,
  shop_phone: null,
  receipt_footer: null,
  updated_at: '2026-09-25T00:00:00Z',
  shop_legal_name: null,
  shop_email: null,
  shop_website: null,
  tax_id_nif: null,
  tax_id_nis: null,
  trade_register_rc: null,
  article_imposition_ai: null,
  bank_account_rib: null,
  logo_file_name: null,
  logo_updated_at: null,
  print_language: 'FOLLOW_APP',
  show_logo: false,
  show_email: false,
  show_website: false,
  show_rib: false,
  amount_in_words: true,
  a4_footer_note: null,
};

const SESSION_REPORT = {
  session: {
    id: 77,
    status: 'OPEN',
    workstation_id: 'STOCKIHA-01',
    opened_at: '2026-07-31T08:00:00Z',
    closed_at: null,
    opened_by: 'cashier',
    closed_by: null,
    opening_float: '1000.00',
  },
  sales: { cash_count: 0, cash_total: '0.00', credit_count: 0, credit_total: '0.00', void_count: 0, void_total: '0.00' },
  movements: { cash_in_total: '0.00', cash_out_total: '0.00', rows: [] },
  customer: { payments_total: '0.00', refunds_total: '0.00' },
  cash: { expected: '1000.00', counted: null, variance: null, variance_approved_by: null, tolerance: '50.00' },
};

function baseHandlers(extra: Handlers = {}): Handlers {
  return {
    get_setup_status: initialized,
    login: () => ({ session_token: 'cashier-token', expires_at: '2026-12-31T23:59:59Z' }),
    logout: () => null,
    inspect_active_cash_session: activeSession,
    inspect_current_cash_session: () => lifecycle(),
    list_warehouses: () => [{ id: 1, code: 'WH1', name: 'Main Warehouse', is_active: true }],
    get_open_fiscal_period: () => ({ id: 9, period_code: '2026', starts_on: '2026-01-01', ends_on: '2026-12-31' }),
    get_dashboard_summary: () => ({
      product_count: 0,
      variant_count: 0,
      active_cash_session_id: 77,
      latest_document_id: null,
      latest_document_number: null,
      pending_generation_jobs: 0,
      pending_print_jobs: 0,
    }),
    list_cash_movements: () => [],
    get_cash_capabilities: () => ({ can_record_cash_movement: true, can_approve_cash_out: true }),
    get_printing_settings: () => PRINTING_SETTINGS_BASE,
    get_company_logo: () => null,
    get_session_report: () => SESSION_REPORT,
    ...extra,
  };
}

async function loginAndOpenCashSessionPage() {
  await screen.findByRole('heading', { name: 'Sign in' });
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'cashier' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await screen.findByRole('heading', { name: 'Dashboard' });
  fireEvent.click(screen.getByRole('button', { name: 'Cash session' }));
  await screen.findByRole('heading', { name: 'Cash session' });
}

beforeEach(() => {
  invokeMock.mockReset();
  cleanup();
  window.localStorage.clear();
  window.localStorage.setItem('stockiha.locale', 'en');
  document.documentElement.setAttribute('lang', 'en');
  document.documentElement.setAttribute('dir', 'ltr');
});

describe('WS-M-3 end-of-day cash session report dialog', () => {
  it('opens the dialog and calls get_session_report + print_raw_receipt for the thermal action', async () => {
    let printedBytes: number[] | null = null;
    let reportCalls = 0;
    wireInvoke(baseHandlers({
      get_session_report: () => {
        reportCalls += 1;
        return SESSION_REPORT;
      },
      print_raw_receipt: (args) => {
        printedBytes = args.payload as number[];
        return 1;
      },
    }));

    render(<App />);
    await loginAndOpenCashSessionPage();

    fireEvent.click(await screen.findByTestId('session-report-print'));
    const dialog = await screen.findByTestId('session-report-dialog');
    expect(dialog).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('session-report-thermal'));

    await waitFor(() => expect(reportCalls).toBeGreaterThan(0));
    await waitFor(() => expect(printedBytes).not.toBeNull());
    await waitFor(() => expect(screen.queryByTestId('session-report-dialog')).not.toBeInTheDocument());
  });

  it('disables the thermal action when receipt printing is off', async () => {
    wireInvoke(baseHandlers({
      get_printing_settings: () => ({ ...PRINTING_SETTINGS_BASE, receipt_printing_enabled: false }),
    }));

    render(<App />);
    await loginAndOpenCashSessionPage();

    fireEvent.click(await screen.findByTestId('session-report-print'));
    await screen.findByTestId('session-report-dialog');

    expect(screen.getByTestId('session-report-thermal')).toBeDisabled();
  });

  it('the A4 action calls get_session_report and renders without throwing', async () => {
    let reportCalls = 0;
    wireInvoke(baseHandlers({
      get_session_report: () => {
        reportCalls += 1;
        return SESSION_REPORT;
      },
    }));

    render(<App />);
    await loginAndOpenCashSessionPage();

    fireEvent.click(await screen.findByTestId('session-report-print'));
    await screen.findByTestId('session-report-dialog');
    fireEvent.click(screen.getByTestId('session-report-a4'));

    await waitFor(() => expect(reportCalls).toBeGreaterThan(0));
    await waitFor(() => expect(screen.queryByTestId('session-report-dialog')).not.toBeInTheDocument());
  });

  it('the Save as PDF action calls get_session_report and saves without throwing', async () => {
    const font = await readFile('src-tauri/src/infrastructure/pdf_proof/fonts/Amiri-Regular.ttf');
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(font, { status: 200 })) as typeof globalThis.fetch;
    // jsdom does not implement these; the browser-download fallback in
    // saveDocumentFileWithDialog needs them when not running inside Tauri.
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:mock') as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn() as typeof URL.revokeObjectURL;

    let reportCalls = 0;
    wireInvoke(baseHandlers({
      get_session_report: () => {
        reportCalls += 1;
        return SESSION_REPORT;
      },
    }));

    try {
      render(<App />);
      await loginAndOpenCashSessionPage();

      fireEvent.click(await screen.findByTestId('session-report-print'));
      await screen.findByTestId('session-report-dialog');
      fireEvent.click(screen.getByTestId('session-report-pdf'));

      await waitFor(() => expect(reportCalls).toBeGreaterThan(0));
      await waitFor(() => expect(screen.queryByTestId('session-report-dialog')).not.toBeInTheDocument(), {
        timeout: 3000,
      });
    } finally {
      globalThis.fetch = originalFetch;
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    }
  });

  it('cancel closes the dialog without calling get_session_report', async () => {
    let reportCalls = 0;
    wireInvoke(baseHandlers({
      get_session_report: () => {
        reportCalls += 1;
        return SESSION_REPORT;
      },
    }));

    render(<App />);
    await loginAndOpenCashSessionPage();

    fireEvent.click(await screen.findByTestId('session-report-print'));
    await screen.findByTestId('session-report-dialog');
    fireEvent.click(screen.getByTestId('session-report-dialog-cancel'));

    expect(screen.queryByTestId('session-report-dialog')).not.toBeInTheDocument();
    expect(reportCalls).toBe(0);
  });
});
