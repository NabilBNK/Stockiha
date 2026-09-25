// WS-I-3 STEP I3-11 — the notifications bell/panel.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

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
    get_reports_capabilities: () => ({ can_view_reports: true }),
    get_today_overview: () => Promise.reject({ code: 'INTERNAL_ERROR' }),
    get_report_notifications: () => ({
      generated_at: '2026-09-25T00:00:00Z',
      items: [
        { id: 'LOW_STOCK', kind: 'LOW_STOCK', severity: 'WARNING', count: 3 },
        { id: 'SLOW_MOVERS_90D', kind: 'SLOW_MOVERS_90D', severity: 'INFO', count: 2, amount: '500.00' },
      ],
    }),
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
  window.sessionStorage.removeItem('stockiha.reports.lastTab');
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('WS-I-3 notifications bell', () => {
  it('the badge counts only WARNING/CRITICAL visible items', async () => {
    wireInvoke(baseHandlers());
    render(<App />);
    await login();

    const badge = await screen.findByTestId('notification-badge');
    // 1 WARNING (LOW_STOCK) + 0 CRITICAL; the INFO item (SLOW_MOVERS_90D) does not count.
    expect(badge.textContent).toBe('1');
  });

  it('dismiss hides an item for today', async () => {
    wireInvoke(baseHandlers());
    render(<App />);
    await login();

    fireEvent.click(await screen.findByTestId('notification-bell'));
    await screen.findByTestId('notification-panel');
    fireEvent.click(screen.getByTestId('notification-dismiss-LOW_STOCK'));

    await waitFor(() => {
      expect(screen.queryByTestId('notification-dismiss-LOW_STOCK')).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId('notification-badge')).not.toBeInTheDocument();
  });

  it('a dismissal recorded for a different day does not hide today\'s item (back tomorrow if still true)', async () => {
    // Simulates "yesterday's dismissal, still visible today" without mocking
    // system time: the dismissed-ids list is keyed by calendar date
    // (stockiha.notifications.dismissed.<date>), so seeding a stale key
    // directly proves the same behaviour a real day rollover would.
    window.localStorage.setItem('stockiha.notifications.dismissed.2020-01-01', JSON.stringify(['LOW_STOCK']));
    wireInvoke(baseHandlers());
    render(<App />);
    await login();

    const badge = await screen.findByTestId('notification-badge');
    expect(badge.textContent).toBe('1');
    // The stale key is pruned on mount.
    expect(window.localStorage.getItem('stockiha.notifications.dismissed.2020-01-01')).toBeNull();
  });

  it('the low-stock action sets the reports last-tab to stock/low-stock and navigates to Reports', async () => {
    wireInvoke(baseHandlers());
    render(<App />);
    await login();

    fireEvent.click(await screen.findByTestId('notification-bell'));
    await screen.findByTestId('notification-panel');
    fireEvent.click(screen.getByTestId('notification-action-LOW_STOCK'));

    await screen.findByTestId('reports-tab-stock');
    expect(window.sessionStorage.getItem('stockiha.reports.lastTab')).toBe('stock/low-stock');
  });

  it('a rejecting getReportNotifications shows no badge and does not crash', async () => {
    wireInvoke(baseHandlers({ get_report_notifications: () => Promise.reject({ code: 'INTERNAL_ERROR' }) }));
    render(<App />);
    await login();

    expect(screen.queryByTestId('notification-badge')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('notification-bell'));
    const panel = await screen.findByTestId('notification-panel');
    expect(panel.textContent).toContain('No notifications');
  });

  it('a licence status GRACE adds LICENCE_GRACE to the panel', async () => {
    wireInvoke(
      baseHandlers({
        get_report_notifications: () => ({ generated_at: '2026-09-25T00:00:00Z', items: [] }),
        get_licence_status: () => ({
          status: 'GRACE',
          mode: 'FULL',
          machine_code: 'MC-1',
          licence: null,
          days_left: null,
          grace_days_left: 5,
          evaluated_at: '2026-09-25T00:00:00Z',
        }),
      }),
    );
    render(<App />);
    await login();

    const badge = await screen.findByTestId('notification-badge');
    expect(badge.textContent).toBe('1');
    fireEvent.click(screen.getByTestId('notification-bell'));
    const panel = await screen.findByTestId('notification-panel');
    expect(panel.textContent).toMatch(/not activated/i);
  });
});
