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

function lifecycle(
  status: 'OPEN' | 'CLOSING' | 'PENDING_APPROVAL' | 'SUSPENDED',
  overrides: Record<string, unknown> = {},
) {
  return {
    id: 77,
    warehouse_id: 1,
    workstation_id: 'STOCKIHA-01',
    opened_by_user_id: 10,
    current_cashier_user_id: 10,
    current_cashier_display_name: 'Cashier One',
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

function baseHandlers(extra: Handlers = {}): Handlers {
  return {
    get_setup_status: initialized,
    login: (args) =>
      args.username === 'manager'
        ? { session_token: 'manager-token', expires_at: '2026-12-31T23:59:59Z' }
        : { session_token: 'cashier-token', expires_at: '2026-12-31T23:59:59Z' },
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

describe('WS-F-005 cash-movement workflow', () => {
  it('1. With an OPEN session, cash-movement-panel is present', async () => {
    wireInvoke(
      baseHandlers({
        inspect_current_cash_session: () => lifecycle('OPEN'),
      }),
    );
    render(<App />);
    await loginAndOpenCashSessionPage();
    expect(await screen.findByTestId('cash-movement-panel')).toBeInTheDocument();
  });

  it('2. With a CLOSING session, cash-movement-panel is absent', async () => {
    wireInvoke(
      baseHandlers({
        inspect_active_cash_session: () => null,
        inspect_current_cash_session: () => lifecycle('CLOSING'),
      }),
    );
    render(<App />);
    await loginAndOpenCashSessionPage();
    expect(await screen.findByTestId('blind-count-form')).toBeInTheDocument();
    expect(screen.queryByTestId('cash-movement-panel')).not.toBeInTheDocument();
  });

  it('3. Entering 500, reason EXPENSE, direction CASH_OUT, and submitting calls record_cash_movement once with those values and amount string 500', async () => {
    let recordedArgs: Record<string, unknown> | null = null;
    wireInvoke(
      baseHandlers({
        inspect_current_cash_session: () => lifecycle('OPEN'),
        record_cash_movement: (args) => {
          recordedArgs = args;
          return {
            movement_id: 1,
            cash_session_id: 77,
            movement_type: 'CASH_OUT',
            amount: '500.00',
            reason_code: 'EXPENSE',
            journal_document_id: 101,
          };
        },
      }),
    );
    render(<App />);
    await loginAndOpenCashSessionPage();
    expect(await screen.findByTestId('cash-movement-panel')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('cash-movement-direction'), {
      target: { value: 'CASH_OUT' },
    });
    fireEvent.change(screen.getByTestId('cash-movement-amount'), { target: { value: '500' } });
    fireEvent.change(screen.getByTestId('cash-movement-reason'), { target: { value: 'EXPENSE' } });
    fireEvent.click(screen.getByTestId('cash-movement-submit'));

    await waitFor(() => expect(recordedArgs).not.toBeNull());
    expect(recordedArgs).toMatchObject({
      sessionToken: 'cashier-token',
      cashSessionId: 77,
      movementType: 'CASH_OUT',
      amount: '500',
      reasonCode: 'EXPENSE',
    });
  });

  it('4. Entering 0 shows the invalid-amount message and calls nothing', async () => {
    let called = false;
    wireInvoke(
      baseHandlers({
        inspect_current_cash_session: () => lifecycle('OPEN'),
        record_cash_movement: () => {
          called = true;
          return {};
        },
      }),
    );
    render(<App />);
    await loginAndOpenCashSessionPage();
    expect(await screen.findByTestId('cash-movement-panel')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('cash-movement-amount'), { target: { value: '0' } });
    fireEvent.click(screen.getByTestId('cash-movement-submit'));

    expect(
      await screen.findByText(/Enter an amount greater than zero, for example 500 or 500.50/),
    ).toBeInTheDocument();
    expect(called).toBe(false);
  });

  it('5. Cashier capabilities (can_approve_cash_out: false), CASH_OUT shows the approval box', async () => {
    wireInvoke(
      baseHandlers({
        inspect_current_cash_session: () => lifecycle('OPEN'),
        get_cash_capabilities: () => ({ can_record_cash_movement: true, can_approve_cash_out: false }),
      }),
    );
    render(<App />);
    await loginAndOpenCashSessionPage();
    fireEvent.change(screen.getByTestId('cash-movement-direction'), { target: { value: 'CASH_OUT' } });
    expect(await screen.findByTestId('cash-out-approval')).toBeInTheDocument();
  });

  it('6. Same user, direction CASH_IN, the approval box is absent', async () => {
    wireInvoke(
      baseHandlers({
        inspect_current_cash_session: () => lifecycle('OPEN'),
        get_cash_capabilities: () => ({ can_record_cash_movement: true, can_approve_cash_out: false }),
      }),
    );
    render(<App />);
    await loginAndOpenCashSessionPage();
    fireEvent.change(screen.getByTestId('cash-movement-direction'), { target: { value: 'CASH_IN' } });
    await screen.findByTestId('cash-movement-panel');
    expect(screen.queryByTestId('cash-out-approval')).not.toBeInTheDocument();
  });

  it('7. Manager capabilities (can_approve_cash_out: true), CASH_OUT: approval box absent', async () => {
    wireInvoke(
      baseHandlers({
        inspect_current_cash_session: () => lifecycle('OPEN'),
        get_cash_capabilities: () => ({ can_record_cash_movement: true, can_approve_cash_out: true }),
      }),
    );
    render(<App />);
    await loginAndOpenCashSessionPage();
    fireEvent.change(screen.getByTestId('cash-movement-direction'), { target: { value: 'CASH_OUT' } });
    await screen.findByTestId('cash-movement-panel');
    expect(screen.queryByTestId('cash-out-approval')).not.toBeInTheDocument();
  });

  it('8. Capabilities call rejects: the approval box is shown as the safe default', async () => {
    wireInvoke(
      baseHandlers({
        inspect_current_cash_session: () => lifecycle('OPEN'),
        get_cash_capabilities: () => {
          throw { code: 'INTERNAL_ERROR' };
        },
      }),
    );
    render(<App />);
    await loginAndOpenCashSessionPage();
    fireEvent.change(screen.getByTestId('cash-movement-direction'), { target: { value: 'CASH_OUT' } });
    expect(await screen.findByTestId('cash-out-approval')).toBeInTheDocument();
  });

  it('9. Cashier submits CASH_OUT without approver fields: shows the required message, calls nothing', async () => {
    let recordCalled = false;
    wireInvoke(
      baseHandlers({
        inspect_current_cash_session: () => lifecycle('OPEN'),
        get_cash_capabilities: () => ({ can_record_cash_movement: true, can_approve_cash_out: false }),
        record_cash_movement: () => {
          recordCalled = true;
          return {};
        },
      }),
    );
    render(<App />);
    await loginAndOpenCashSessionPage();
    // Only the initial sign-in should have called login by this point; track
    // any call made after this as the approver flow under test.
    const loginsBeforeSubmit = invokeMock.mock.calls.filter(([command]) => command === 'login').length;
    fireEvent.change(screen.getByTestId('cash-movement-direction'), { target: { value: 'CASH_OUT' } });
    fireEvent.change(screen.getByTestId('cash-movement-amount'), { target: { value: '500' } });
    fireEvent.click(screen.getByTestId('cash-movement-submit'));

    expect(
      await screen.findByText(/Enter the manager.s username and password\./),
    ).toBeInTheDocument();
    const loginsAfterSubmit = invokeMock.mock.calls.filter(([command]) => command === 'login').length;
    expect(loginsAfterSubmit).toBe(loginsBeforeSubmit);
    expect(recordCalled).toBe(false);
  });

  it('10. Cashier submits CASH_OUT with approver fields: login, then record_cash_movement, then logout in order', async () => {
    const calls: string[] = [];
    let recordArgs: Record<string, unknown> | null = null;
    let logoutToken: string | null = null;
    let tracking = false;
    wireInvoke(
      baseHandlers({
        inspect_current_cash_session: () => lifecycle('OPEN'),
        get_cash_capabilities: () => ({ can_record_cash_movement: true, can_approve_cash_out: false }),
        login: (args) => {
          if (tracking) calls.push('login');
          return args.username === 'manager'
            ? { session_token: 'manager-token', expires_at: '2026-12-31T23:59:59Z' }
            : { session_token: 'cashier-token', expires_at: '2026-12-31T23:59:59Z' };
        },
        record_cash_movement: (args) => {
          if (tracking) calls.push('record_cash_movement');
          recordArgs = args;
          return {
            movement_id: 1,
            cash_session_id: 77,
            movement_type: 'CASH_OUT',
            amount: '500.00',
            reason_code: 'EXPENSE',
            journal_document_id: 101,
            approved_by_user_id: 5,
          };
        },
        logout: (args) => {
          if (tracking) calls.push('logout');
          logoutToken = args.sessionToken as string;
          return null;
        },
      }),
    );
    render(<App />);
    await loginAndOpenCashSessionPage();
    tracking = true;
    fireEvent.change(screen.getByTestId('cash-movement-direction'), { target: { value: 'CASH_OUT' } });
    fireEvent.change(screen.getByTestId('cash-movement-amount'), { target: { value: '500' } });
    fireEvent.change(screen.getByTestId('cash-movement-reason'), { target: { value: 'EXPENSE' } });
    await screen.findByTestId('cash-out-approval');
    fireEvent.change(screen.getByTestId('cash-out-approver-username'), { target: { value: 'manager' } });
    fireEvent.change(screen.getByTestId('cash-out-approver-password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByTestId('cash-movement-submit'));

    await waitFor(() => expect(calls).toEqual(['login', 'record_cash_movement', 'logout']));
    expect(recordArgs).toMatchObject({ approverSessionToken: 'manager-token' });
    expect(logoutToken).toBe('manager-token');
  });

  it('11. record_cash_movement rejects: logout is still called with the approver token, password cleared', async () => {
    let logoutToken: string | null = null;
    wireInvoke(
      baseHandlers({
        inspect_current_cash_session: () => lifecycle('OPEN'),
        get_cash_capabilities: () => ({ can_record_cash_movement: true, can_approve_cash_out: false }),
        login: () => ({ session_token: 'manager-token', expires_at: '2026-12-31T23:59:59Z' }),
        record_cash_movement: () => {
          throw { code: 'VALIDATION_ERROR' };
        },
        logout: (args) => {
          logoutToken = args.sessionToken as string;
          return null;
        },
      }),
    );
    render(<App />);
    await loginAndOpenCashSessionPage();
    fireEvent.change(screen.getByTestId('cash-movement-direction'), { target: { value: 'CASH_OUT' } });
    fireEvent.change(screen.getByTestId('cash-movement-amount'), { target: { value: '500' } });
    await screen.findByTestId('cash-out-approval');
    fireEvent.change(screen.getByTestId('cash-out-approver-username'), { target: { value: 'manager' } });
    fireEvent.change(screen.getByTestId('cash-out-approver-password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByTestId('cash-movement-submit'));

    await waitFor(() => expect(logoutToken).toBe('manager-token'));
    expect((screen.getByTestId('cash-out-approver-password') as HTMLInputElement).value).toBe('');
  });

  it('12. Reason OTHER with an empty note shows the required message and calls nothing', async () => {
    let called = false;
    wireInvoke(
      baseHandlers({
        inspect_current_cash_session: () => lifecycle('OPEN'),
        record_cash_movement: () => {
          called = true;
          return {};
        },
      }),
    );
    render(<App />);
    await loginAndOpenCashSessionPage();
    fireEvent.change(screen.getByTestId('cash-movement-amount'), { target: { value: '500' } });
    fireEvent.change(screen.getByTestId('cash-movement-reason'), { target: { value: 'OTHER' } });
    fireEvent.click(screen.getByTestId('cash-movement-submit'));

    expect(
      await screen.findByText(/Describe the reason before recording\./),
    ).toBeInTheDocument();
    expect(called).toBe(false);
  });

  it('13. A 201-character note shows the length message and calls nothing', async () => {
    let called = false;
    wireInvoke(
      baseHandlers({
        inspect_current_cash_session: () => lifecycle('OPEN'),
        record_cash_movement: () => {
          called = true;
          return {};
        },
      }),
    );
    render(<App />);
    await loginAndOpenCashSessionPage();
    fireEvent.change(screen.getByTestId('cash-movement-amount'), { target: { value: '500' } });
    fireEvent.change(screen.getByTestId('cash-movement-note'), { target: { value: 'x'.repeat(201) } });
    fireEvent.click(screen.getByTestId('cash-movement-submit'));

    expect(
      await screen.findByText(/The note can be at most 200 characters\./),
    ).toBeInTheDocument();
    expect(called).toBe(false);
  });

  it('14. The movement list renders CASH_IN and CASH_OUT rows but not SALE, CUSTOMER_PAYMENT or CUSTOMER_REFUND', async () => {
    wireInvoke(
      baseHandlers({
        inspect_current_cash_session: () => lifecycle('OPEN'),
        list_cash_movements: () => [
          { movement_id: 1, movement_type: 'CASH_IN', amount: '100.00', reason_code: 'CHANGE_FLOAT', note: null, business_document_id: null, journal_document_id: 1, created_at: '2026-07-31T09:00:00Z' },
          { movement_id: 2, movement_type: 'CASH_OUT', amount: '50.00', reason_code: 'EXPENSE', note: null, business_document_id: null, journal_document_id: 2, created_at: '2026-07-31T09:05:00Z' },
          { movement_id: 3, movement_type: 'SALE', amount: '200.00', reason_code: null, note: null, business_document_id: 10, journal_document_id: 3, created_at: '2026-07-31T09:10:00Z' },
          { movement_id: 4, movement_type: 'CUSTOMER_PAYMENT', amount: '150.00', reason_code: null, note: null, business_document_id: 11, journal_document_id: 4, created_at: '2026-07-31T09:15:00Z' },
          { movement_id: 5, movement_type: 'CUSTOMER_REFUND', amount: '-75.00', reason_code: null, note: null, business_document_id: 12, journal_document_id: 5, created_at: '2026-07-31T09:20:00Z' },
        ],
      }),
    );
    render(<App />);
    await loginAndOpenCashSessionPage();
    await screen.findByTestId('cash-movement-panel');

    expect(screen.getByTestId('cash-movement-1')).toBeInTheDocument();
    expect(screen.getByTestId('cash-movement-2')).toBeInTheDocument();
    expect(screen.queryByTestId('cash-movement-3')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cash-movement-4')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cash-movement-5')).not.toBeInTheDocument();
  });

  it('15. The reason dropdown shows "Custom reason" for the OTHER option', async () => {
    wireInvoke(
      baseHandlers({
        inspect_current_cash_session: () => lifecycle('OPEN'),
      }),
    );
    render(<App />);
    await loginAndOpenCashSessionPage();
    await screen.findByTestId('cash-movement-panel');
    const option = screen.getByRole('option', { name: 'Custom reason' }) as HTMLOptionElement;
    expect(option.value).toBe('OTHER');
  });
});
