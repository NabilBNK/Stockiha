import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

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

function lifecycle(status: 'OPEN' | 'CLOSING', overrides: Record<string, unknown> = {}) {
  return {
    id: 77,
    warehouse_id: 1,
    workstation_id: 'STOCKIHA-01',
    opened_by_user_id: 10,
    current_cashier_user_id: 10,
    current_cashier_display_name: 'Admin One',
    status,
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

function postedSale(overrides: Record<string, unknown> = {}) {
  return {
    document_id: 501,
    document_number: 'VC-2026-000010',
    sale_kind: 'CASH',
    customer_name: null,
    total_amount: '1000.00',
    status: 'POSTED',
    posted_at: '2026-09-22T09:05:00Z',
    void_document_number: null,
    ...overrides,
  };
}

function voidResult(overrides: Record<string, unknown> = {}) {
  return {
    void_document_id: 900,
    void_document_number: 'AN-2026-000001',
    original_document_id: 501,
    original_document_number: 'VC-2026-000010',
    sale_kind: 'CASH',
    customer_name: null,
    subtotal: '1000.00',
    discount_amount: '0.00',
    total_amount: '1000.00',
    reason_code: 'WRONG_ITEM',
    note: null,
    cash_session_id: 77,
    journal_document_id: 901,
    voided_at: '2026-09-22T09:10:00Z',
    lines: [{ name: 'Cahier 100 pages', quantity: '2', unit_price: '500.00', line_total: '1000.00' }],
    ...overrides,
  };
}

const ENABLED_THERMAL_SETTINGS = {
  receipt_printing_enabled: true,
  receipt_target: 'THERMAL',
  thermal_printer_name: 'EPSON-TM88',
  thermal_columns: 42,
  shop_name: 'Stockiha Shop',
  shop_address: null,
  shop_phone: null,
  receipt_footer: null,
  updated_at: '2026-09-22T00:00:00Z',
};

const DISABLED_SETTINGS = {
  ...ENABLED_THERMAL_SETTINGS,
  receipt_printing_enabled: false,
};

function baseHandlers(extra: Handlers = {}): Handlers {
  return {
    get_setup_status: initialized,
    login: () => ({ session_token: 'admin-token', expires_at: '2026-12-31T23:59:59Z' }),
    logout: () => null,
    inspect_active_cash_session: activeSession,
    list_warehouses: () => [{ id: 1, code: 'WH1', name: 'Main Warehouse', is_active: true }],
    get_open_fiscal_period: () => ({
      id: 9,
      period_code: '2026',
      starts_on: '2026-01-01',
      ends_on: '2026-12-31',
    }),
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
    list_cash_denominations: () => [
      { id: 1, code: 'DZD_1000', value: '1000.00', display_order: 10 },
    ],
    get_cash_capabilities: () => ({ can_record_cash_movement: true, can_approve_cash_out: true }),
    get_printing_settings: () => ENABLED_THERMAL_SETTINGS,
    list_session_sales: () => [],
    ...extra,
  };
}

async function loginAndOpenCashSessionPage() {
  await screen.findByRole('heading', { name: 'Sign in' });
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } });
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

describe('WS-F-006 session sales / sale void workflow', () => {
  it('1. list_session_sales rejects with PERMISSION_DENIED: session-sales-panel is absent', async () => {
    wireInvoke(
      baseHandlers({
        inspect_current_cash_session: () => lifecycle('OPEN'),
        list_session_sales: () => {
          throw { code: 'PERMISSION_DENIED' };
        },
      }),
    );
    render(<App />);
    await loginAndOpenCashSessionPage();
    await screen.findByTestId('cash-movement-panel');
    await waitFor(() => expect(screen.queryByTestId('session-sales-panel')).not.toBeInTheDocument());
  });

  it('2. An empty list shows the empty text', async () => {
    wireInvoke(
      baseHandlers({
        inspect_current_cash_session: () => lifecycle('OPEN'),
        list_session_sales: () => [],
      }),
    );
    render(<App />);
    await loginAndOpenCashSessionPage();
    expect(await screen.findByTestId('session-sales-panel')).toBeInTheDocument();
    expect(screen.getByText('No sales in this session yet.')).toBeInTheDocument();
  });

  it('3. A POSTED row shows a cancel button; a REVERSED row shows "Cancelled (AN-...)" with no button', async () => {
    wireInvoke(
      baseHandlers({
        inspect_current_cash_session: () => lifecycle('OPEN'),
        list_session_sales: () => [
          postedSale(),
          postedSale({ document_id: 502, status: 'REVERSED', void_document_number: 'AN-2026-000002' }),
        ],
      }),
    );
    render(<App />);
    await loginAndOpenCashSessionPage();
    expect(await screen.findByTestId('void-sale-501')).toBeInTheDocument();
    expect(screen.queryByTestId('void-sale-502')).not.toBeInTheDocument();
    expect(screen.getByText(/Cancelled \(AN-2026-000002\)/)).toBeInTheDocument();
  });

  it('4. Opening the dialog then Back never calls void_sale', async () => {
    let called = false;
    wireInvoke(
      baseHandlers({
        inspect_current_cash_session: () => lifecycle('OPEN'),
        list_session_sales: () => [postedSale()],
        void_sale: () => {
          called = true;
          return voidResult();
        },
      }),
    );
    render(<App />);
    await loginAndOpenCashSessionPage();
    fireEvent.click(await screen.findByTestId('void-sale-501'));
    await screen.findByTestId('void-sale-dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.queryByTestId('void-sale-dialog')).not.toBeInTheDocument();
    expect(called).toBe(false);
  });

  it('5. Reason OTHER with an empty note shows the required message and calls nothing', async () => {
    let called = false;
    wireInvoke(
      baseHandlers({
        inspect_current_cash_session: () => lifecycle('OPEN'),
        list_session_sales: () => [postedSale()],
        void_sale: () => {
          called = true;
          return voidResult();
        },
      }),
    );
    render(<App />);
    await loginAndOpenCashSessionPage();
    fireEvent.click(await screen.findByTestId('void-sale-501'));
    await screen.findByTestId('void-sale-dialog');
    fireEvent.change(screen.getByTestId('void-reason'), { target: { value: 'OTHER' } });
    fireEvent.click(screen.getByTestId('void-confirm'));

    expect(await screen.findByText('Describe the reason before cancelling.')).toBeInTheDocument();
    expect(called).toBe(false);
  });

  it('6. A 201-character note shows the length message and calls nothing', async () => {
    let called = false;
    wireInvoke(
      baseHandlers({
        inspect_current_cash_session: () => lifecycle('OPEN'),
        list_session_sales: () => [postedSale()],
        void_sale: () => {
          called = true;
          return voidResult();
        },
      }),
    );
    render(<App />);
    await loginAndOpenCashSessionPage();
    fireEvent.click(await screen.findByTestId('void-sale-501'));
    await screen.findByTestId('void-sale-dialog');
    fireEvent.change(screen.getByTestId('void-note'), { target: { value: 'x'.repeat(201) } });
    fireEvent.click(screen.getByTestId('void-confirm'));

    expect(await screen.findByText('The note can be at most 200 characters.')).toBeInTheDocument();
    expect(called).toBe(false);
  });

  it('7. A valid confirm calls void_sale, then print_raw_receipt, shows the AN number, and reloads the list', async () => {
    let voidArgs: Record<string, unknown> | null = null;
    let printArgs: unknown[] | null = null;
    let listCalls = 0;
    wireInvoke(
      baseHandlers({
        inspect_current_cash_session: () => lifecycle('OPEN'),
        list_session_sales: () => {
          listCalls += 1;
          return listCalls === 1 ? [postedSale()] : [postedSale({ status: 'REVERSED', void_document_number: 'AN-2026-000001' })];
        },
        void_sale: (args) => {
          voidArgs = args;
          return voidResult();
        },
        print_raw_receipt: (args) => {
          printArgs = [args.printerName, args.payload];
          return 1;
        },
      }),
    );
    render(<App />);
    await loginAndOpenCashSessionPage();
    fireEvent.click(await screen.findByTestId('void-sale-501'));
    await screen.findByTestId('void-sale-dialog');
    fireEvent.change(screen.getByTestId('void-reason'), { target: { value: 'WRONG_ITEM' } });
    fireEvent.click(screen.getByTestId('void-confirm'));

    await waitFor(() => expect(voidArgs).not.toBeNull());
    expect(voidArgs).toMatchObject({ documentId: 501, reasonCode: 'WRONG_ITEM', note: null });

    await waitFor(() => expect(printArgs).not.toBeNull());
    expect(await screen.findByText(/Sale cancelled\. Cancellation AN-2026-000001 recorded\./)).toBeInTheDocument();
    expect(listCalls).toBeGreaterThanOrEqual(2);
  });

  it('8. Printing disabled: print_raw_receipt is not called, but void-print-again is still shown', async () => {
    let printCalled = false;
    wireInvoke(
      baseHandlers({
        inspect_current_cash_session: () => lifecycle('OPEN'),
        get_printing_settings: () => DISABLED_SETTINGS,
        list_session_sales: () => [postedSale()],
        void_sale: () => voidResult(),
        print_raw_receipt: () => {
          printCalled = true;
          return 1;
        },
      }),
    );
    render(<App />);
    await loginAndOpenCashSessionPage();
    fireEvent.click(await screen.findByTestId('void-sale-501'));
    await screen.findByTestId('void-sale-dialog');
    fireEvent.click(screen.getByTestId('void-confirm'));

    expect(await screen.findByTestId('void-print-again')).toBeInTheDocument();
    expect(printCalled).toBe(false);
  });

  it('9. print_raw_receipt rejects: the printFailed warning shows, success banner still shows', async () => {
    wireInvoke(
      baseHandlers({
        inspect_current_cash_session: () => lifecycle('OPEN'),
        list_session_sales: () => [postedSale()],
        void_sale: () => voidResult(),
        print_raw_receipt: () => {
          throw { code: 'INTERNAL_ERROR' };
        },
      }),
    );
    render(<App />);
    await loginAndOpenCashSessionPage();
    fireEvent.click(await screen.findByTestId('void-sale-501'));
    await screen.findByTestId('void-sale-dialog');
    fireEvent.click(screen.getByTestId('void-confirm'));

    expect(
      await screen.findByText('The cancellation was recorded, but the slip could not be printed.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Sale cancelled\. Cancellation AN-2026-000001 recorded\./)).toBeInTheDocument();
  });

  it('10. void_sale rejects: the dialog stays open, an error is shown, nothing is printed', async () => {
    let printCalled = false;
    wireInvoke(
      baseHandlers({
        inspect_current_cash_session: () => lifecycle('OPEN'),
        list_session_sales: () => [postedSale()],
        void_sale: () => {
          throw { code: 'PRECONDITION_FAILED' };
        },
        print_raw_receipt: () => {
          printCalled = true;
          return 1;
        },
      }),
    );
    render(<App />);
    await loginAndOpenCashSessionPage();
    fireEvent.click(await screen.findByTestId('void-sale-501'));
    await screen.findByTestId('void-sale-dialog');
    fireEvent.click(screen.getByTestId('void-confirm'));

    await waitFor(() =>
      expect(screen.getByText('This action is not allowed in the current state.')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('void-sale-dialog')).toBeInTheDocument();
    expect(printCalled).toBe(false);
  });

  it('11. Clicking void-print-again calls print_raw_receipt again with the same payload', async () => {
    const printCalls: unknown[][] = [];
    wireInvoke(
      baseHandlers({
        inspect_current_cash_session: () => lifecycle('OPEN'),
        list_session_sales: () => [postedSale()],
        void_sale: () => voidResult(),
        print_raw_receipt: (args) => {
          printCalls.push([args.printerName, args.payload]);
          return 1;
        },
      }),
    );
    render(<App />);
    await loginAndOpenCashSessionPage();
    fireEvent.click(await screen.findByTestId('void-sale-501'));
    await screen.findByTestId('void-sale-dialog');
    fireEvent.click(screen.getByTestId('void-confirm'));

    await waitFor(() => expect(printCalls.length).toBe(1));
    fireEvent.click(await screen.findByTestId('void-print-again'));
    await waitFor(() => expect(printCalls.length).toBe(2));
    expect(printCalls[0]).toEqual(printCalls[1]);
  });

  it('12. The panel renders only while the cash session is OPEN', async () => {
    wireInvoke(
      baseHandlers({
        inspect_active_cash_session: () => null,
        inspect_current_cash_session: () => lifecycle('CLOSING'),
        list_session_sales: () => [postedSale()],
      }),
    );
    render(<App />);
    await loginAndOpenCashSessionPage();
    await screen.findByTestId('blind-count-form');
    expect(screen.queryByTestId('session-sales-panel')).not.toBeInTheDocument();
  });
});
