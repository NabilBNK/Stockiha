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
});
