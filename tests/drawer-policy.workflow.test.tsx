import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

import App from '../src/App';

function captured(value: Record<string, unknown> | null): Record<string, unknown> {
  if (value === null) throw new Error('expected captured IPC arguments');
  return value;
}

beforeEach(() => {
  invokeMock.mockReset();
  cleanup();
  document.documentElement.setAttribute('dir', 'ltr');
  document.documentElement.setAttribute('lang', 'en');
  window.localStorage.setItem('stockiha.locale', 'en');
});

describe('S4-003 drawer eligibility settings', () => {
  it('lets an administrator toggle an eligible drawer operation', async () => {
    let updateArgs: Record<string, unknown> | null = null;
    const policies = [
      {
        operation_code: 'CASH_SALE',
        movement_type: 'SALE',
        movement_direction: 'IN',
        is_enabled: true,
        description: 'Cash sale',
        can_manage: true,
      },
      {
        operation_code: 'CUSTOMER_CASH_REFUND',
        movement_type: 'CUSTOMER_REFUND',
        movement_direction: 'OUT',
        is_enabled: true,
        description: 'Customer cash refund',
        can_manage: true,
      },
    ];

    invokeMock.mockImplementation((command: string, args: Record<string, unknown> = {}) => {
      switch (command) {
        case 'get_setup_status':
          return Promise.resolve({
            initialized: true,
            administrator_exists: true,
            warehouse_exists: true,
            open_fiscal_period_exists: true,
            workstation_configured: true,
          });
        case 'login':
          return Promise.resolve({ session_token: 'tok', expires_at: '2026-12-31T23:59:59Z' });
        case 'logout':
          return Promise.resolve(null);
        case 'inspect_active_cash_session':
          return Promise.resolve(null);
        case 'list_warehouses':
          return Promise.resolve([{ id: 1, code: 'WH1', name: 'Main', is_active: true }]);
        case 'get_open_fiscal_period':
          return Promise.resolve({
            id: 9,
            period_code: '2026',
            starts_on: '2026-01-01',
            ends_on: '2026-12-31',
          });
        case 'get_dashboard_summary':
          return Promise.resolve({
            product_count: 0,
            variant_count: 0,
            active_cash_session_id: null,
            latest_document_id: null,
            latest_document_number: null,
            pending_generation_jobs: 0,
            pending_print_jobs: 0,
          });
        case 'list_drawer_operation_policy':
          return Promise.resolve(policies);
        case 'update_drawer_operation_policy': {
          updateArgs = args;
          const payload = args.payload as { operation_code: string; is_enabled: boolean };
          return Promise.resolve({
            ...policies.find((policy) => policy.operation_code === payload.operation_code),
            is_enabled: payload.is_enabled,
            can_manage: true,
          });
        }
        default:
          return Promise.reject({ code: 'INTERNAL_ERROR' });
      }
    });

    render(<App />);
    await screen.findByRole('heading', { name: 'Sign in' });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('heading', { name: 'Dashboard' });

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByText('Cash sale')).toBeInTheDocument();
    expect(screen.getByText('Customer cash refund')).toBeInTheDocument();

    const refundToggle = screen.getByRole('checkbox', { name: /Customer cash refund/ });
    expect(refundToggle).toBeChecked();
    fireEvent.click(refundToggle);

    await waitFor(() => expect(updateArgs).not.toBeNull());
    const update = captured(updateArgs);
    expect(update.sessionToken).toBe('tok');
    expect(update.payload).toEqual({
      operation_code: 'CUSTOMER_CASH_REFUND',
      is_enabled: false,
    });
    await waitFor(() => expect(refundToggle).not.toBeChecked());
    expect(screen.getByText('Drawer policy updated.')).toBeInTheDocument();
  });
});
