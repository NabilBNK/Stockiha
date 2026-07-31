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
    try { return Promise.resolve(handler(args)); } catch (error) { return Promise.reject(error); }
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

function lifecycle(status: 'OPEN' | 'CLOSING' | 'PENDING_APPROVAL' | 'SUSPENDED', overrides: Record<string, unknown> = {}) {
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
    login: (args) => args.username === 'manager'
      ? { session_token: 'manager-token', expires_at: '2026-12-31T23:59:59Z' }
      : { session_token: 'cashier-token', expires_at: '2026-12-31T23:59:59Z' },
    logout: () => null,
    inspect_active_cash_session: activeSession,
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

describe('S4-002 cash-session workflow', () => {
  it('keeps expected cash hidden during CLOSING, then requires a temporary manager for material variance', async () => {
    let state: ReturnType<typeof lifecycle> | null = lifecycle('OPEN');
    let submittedCounts: unknown = null;
    let approvalArgs: Record<string, unknown> | null = null;
    const logoutTokens: string[] = [];

    wireInvoke(baseHandlers({
      logout: (args) => { logoutTokens.push(String(args.sessionToken)); return null; },
      inspect_active_cash_session: () => state?.status === 'OPEN' ? activeSession() : null,
      inspect_current_cash_session: () => state,
      list_cash_denominations: () => [
        { id: 1, code: 'DZD_1000', value: '1000.00', display_order: 10 },
        { id: 2, code: 'DZD_100', value: '100.00', display_order: 20 },
      ],
      begin_cash_session_close: () => { state = lifecycle('CLOSING'); return 77; },
      submit_cash_session_count: (args) => {
        submittedCounts = args.counts;
        state = lifecycle('PENDING_APPROVAL', {
          close_attempt_id: 501,
          expected_amount: '1000.00',
          counted_amount: '900.00',
          variance_amount: '-100.00',
          requires_manager_approval: true,
        });
        return {
          cash_session_id: 77,
          close_attempt_id: 501,
          status: 'PENDING_APPROVAL',
          expected_amount: '1000.00',
          counted_amount: '900.00',
          variance_amount: '-100.00',
          requires_manager_approval: true,
          approved_by_user_id: null,
        };
      },
      approve_cash_session_variance: (args) => {
        approvalArgs = args;
        state = null;
        return {
          cash_session_id: 77,
          close_attempt_id: 501,
          status: 'CLOSED',
          expected_amount: '1000.00',
          counted_amount: '900.00',
          variance_amount: '-100.00',
          requires_manager_approval: true,
          approved_by_user_id: 20,
        };
      },
      get_cash_session: () => ({
        id: 77,
        warehouse_id: 1,
        status: 'CLOSED',
        opening_float: '1000.00',
        expected_amount: '1000.00',
        counted_amount: '900.00',
        variance_amount: '-100.00',
        opened_at: '2026-07-31T08:00:00Z',
        closed_at: '2026-07-31T09:00:00Z',
      }),
    }));

    render(<App />);
    await loginAndOpenCashSessionPage();

    fireEvent.click(screen.getByRole('button', { name: 'Begin blind close' }));
    expect(await screen.findByTestId('blind-count-form')).toBeInTheDocument();
    expect(screen.queryByText('Expected cash')).not.toBeInTheDocument();
    expect(screen.getByText(/Expected cash stays hidden until you submit/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('1000.00 DZD'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('100.00 DZD'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit blind count' }));

    await waitFor(() => expect(submittedCounts).toEqual([
      { denomination_id: 1, quantity: 0 },
      { denomination_id: 2, quantity: 9 },
    ]));

    const approvalForm = await screen.findByTestId('variance-approval-form');
    expect(approvalForm).toHaveTextContent('Expected cash: 1000.00');
    expect(approvalForm).toHaveTextContent('Counted cash: 900.00');
    expect(approvalForm).toHaveTextContent('Variance: -100.00');

    fireEvent.change(screen.getByLabelText('Manager username'), { target: { value: 'manager' } });
    fireEvent.change(screen.getByLabelText('Manager password'), { target: { value: 'manager-pw' } });
    fireEvent.change(screen.getByLabelText('Approval reason'), { target: { value: 'Physical variance verified' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve and close' }));

    await waitFor(() => expect(approvalArgs).not.toBeNull());
    expect(approvalArgs).toMatchObject({
      sessionToken: 'manager-token',
      cashSessionId: 77,
      closeAttemptId: 501,
      reason: 'Physical variance verified',
    });
    await waitFor(() => expect(logoutTokens).toContain('manager-token'));
    expect(await screen.findByTestId('closed-summary')).toHaveTextContent('Variance: -100.00');
  });

  it('suspends, performs manager handover, and does not silently reactivate the drawer', async () => {
    let state: ReturnType<typeof lifecycle> | null = lifecycle('OPEN');
    let handoverArgs: Record<string, unknown> | null = null;
    const logoutTokens: string[] = [];

    wireInvoke(baseHandlers({
      logout: (args) => { logoutTokens.push(String(args.sessionToken)); return null; },
      inspect_active_cash_session: () => state?.status === 'OPEN' ? activeSession() : null,
      inspect_current_cash_session: () => state,
      list_cash_denominations: () => [{ id: 1, code: 'DZD_1000', value: '1000.00', display_order: 10 }],
      suspend_cash_session: () => {
        state = lifecycle('SUSPENDED', { suspension_reason: 'Shift change' });
        return 77;
      },
      handover_cash_session: (args) => {
        handoverArgs = args;
        state = lifecycle('SUSPENDED', {
          current_cashier_user_id: 11,
          current_cashier_display_name: 'Cashier Two',
          suspension_reason: 'Shift change',
        });
        return 77;
      },
      resume_cash_session: () => { throw { code: 'PERMISSION_DENIED' }; },
    }));

    render(<App />);
    await loginAndOpenCashSessionPage();

    fireEvent.change(screen.getByLabelText('Suspension reason'), { target: { value: 'Shift change' } });
    fireEvent.click(screen.getByRole('button', { name: 'Suspend session' }));
    expect(await screen.findByText(/Session suspended/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Manager username'), { target: { value: 'manager' } });
    fireEvent.change(screen.getByLabelText('Manager password'), { target: { value: 'manager-pw' } });
    fireEvent.change(screen.getByLabelText('Target cashier username'), { target: { value: 'cashier2' } });
    fireEvent.change(screen.getByLabelText('Handover reason'), { target: { value: 'End of shift' } });
    fireEvent.click(screen.getByRole('button', { name: 'Transfer ownership' }));

    await waitFor(() => expect(handoverArgs).not.toBeNull());
    expect(handoverArgs).toMatchObject({
      sessionToken: 'manager-token',
      cashSessionId: 77,
      targetUsername: 'cashier2',
      reason: 'End of shift',
    });
    await waitFor(() => expect(logoutTokens).toContain('manager-token'));
    expect(screen.getByTestId('cash-session-lifecycle')).toHaveTextContent('Cashier Two');
    expect(screen.getByTestId('cash-session-lifecycle')).toHaveTextContent('SUSPENDED');

    fireEvent.click(screen.getByRole('button', { name: 'Resume session' }));
    expect(await screen.findByTestId('session-error')).toHaveTextContent('You do not have permission to perform this action.');
  });
});
