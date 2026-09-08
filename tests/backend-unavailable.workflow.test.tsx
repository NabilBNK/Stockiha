/**
 * WS-K-1 — each backend-unavailable state resolves to its own localized
 * message, driven end-to-end through the mocked `get_db_diagnostic` IPC
 * response (not asserted against a hand-written enum): a future change in
 * the shape of `DbDiagnostic` that this screen fails to handle will fail
 * these tests, not just a unit test of the copy-resolution function alone.
 *
 * Also covers: the config-file permission warning renders as a persistent,
 * non-blocking banner once the app is up and running, and that the
 * technical-detail section renders the raw `code`/`detail` verbatim while
 * never containing anything resembling a password (structural guarantee:
 * `DbDiagnostic` has no password-shaped field to begin with).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));

import App from '../src/App';
import type { DbDiagnostic } from '../src/shared/ipc/gateway';

type Handlers = Record<string, (args: Record<string, unknown>) => unknown>;

function wireInvoke(handlers: Handlers) {
  invokeMock.mockImplementation((command: string, args: Record<string, unknown> = {}) => {
    const handler = handlers[command];
    if (!handler) return Promise.reject({ code: 'INTERNAL_ERROR' });
    try {
      return Promise.resolve(handler(args));
    } catch (e) {
      return Promise.reject(e);
    }
  });
}

beforeEach(() => {
  invokeMock.mockReset();
  cleanup();
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.documentElement.style.removeProperty('color-scheme');
  document.documentElement.setAttribute('dir', 'ltr');
});

const CASES: Array<{ name: string; diagnostic: DbDiagnostic; expectedTitle: string }> = [
  {
    name: 'not configured',
    diagnostic: { code: 'NOT_CONFIGURED', detail: 'x', schema: null, config_warning: null },
    expectedTitle: 'Not set up yet',
  },
  {
    name: 'invalid configuration',
    diagnostic: { code: 'INVALID_CONFIGURATION', detail: 'x', schema: null, config_warning: null },
    expectedTitle: 'Settings file problem',
  },
  {
    name: 'connect refused',
    diagnostic: { code: 'CONNECT_REFUSED', detail: 'x', schema: null, config_warning: null },
    expectedTitle: 'Database is not running',
  },
  {
    name: 'connect failed',
    diagnostic: { code: 'CONNECT_FAILED', detail: 'x', schema: null, config_warning: null },
    expectedTitle: 'Cannot reach the database',
  },
  {
    name: 'auth failed',
    diagnostic: { code: 'AUTH_FAILED', detail: 'x', schema: null, config_warning: null },
    expectedTitle: 'Database rejected the connection',
  },
  {
    name: 'database missing',
    diagnostic: { code: 'DATABASE_MISSING', detail: 'x', schema: null, config_warning: null },
    expectedTitle: 'Database not found',
  },
  {
    name: 'pool saturated',
    diagnostic: { code: 'POOL_SATURATED', detail: 'x', schema: null, config_warning: null },
    expectedTitle: 'Internal problem',
  },
  {
    name: 'schema missing (connected, empty database)',
    diagnostic: {
      code: 'OK',
      detail: 'x',
      schema: { status: 'OLDER_THAN_BINARY', applied: 0, latest: 12 },
      config_warning: null,
    },
    expectedTitle: 'Database is empty',
  },
  {
    name: 'schema older than binary',
    diagnostic: {
      code: 'OK',
      detail: 'x',
      schema: { status: 'OLDER_THAN_BINARY', applied: 8, latest: 12 },
      config_warning: null,
    },
    expectedTitle: 'Database needs an update',
  },
  {
    name: 'schema newer than binary',
    diagnostic: {
      code: 'OK',
      detail: 'x',
      schema: { status: 'NEWER_THAN_BINARY', applied: 20, latest: 12 },
      config_warning: null,
    },
    expectedTitle: 'This version of Stockiha is out of date',
  },
];

describe('backend-unavailable states', () => {
  for (const { name, diagnostic, expectedTitle } of CASES) {
    it(`shows the correct message for: ${name}`, async () => {
      wireInvoke({
        get_setup_status: () => {
          throw { code: 'DATABASE_UNAVAILABLE' };
        },
        get_db_diagnostic: () => diagnostic,
      });
      render(<App />);

      expect(await screen.findByTestId('backend-unavailable')).toBeInTheDocument();
      expect(await screen.findByText(expectedTitle)).toBeInTheDocument();

      // Technical details render the real code/detail verbatim, and never
      // contain anything password-shaped — structurally impossible, since
      // DbDiagnostic carries no such field, but assert against the actual
      // rendered output rather than by inspection.
      const details = screen.getByTestId('backend-unavailable-reason');
      expect(details.textContent).toContain(diagnostic.code);
      expect(details.textContent?.toLowerCase()).not.toMatch(/password|pwd|secret/);
    });
  }

  it('falls back to the generic message when the diagnostic itself cannot be fetched', async () => {
    wireInvoke({
      get_setup_status: () => {
        throw { code: 'DATABASE_UNAVAILABLE' };
      },
      // get_db_diagnostic intentionally unwired: default handler rejects.
    });
    render(<App />);

    expect(await screen.findByTestId('backend-unavailable')).toBeInTheDocument();
    expect(await screen.findByText('Service unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('backend-unavailable-details')).not.toBeInTheDocument();
  });
});

describe('config-file permission warning (correction 1: non-blocking)', () => {
  const initialized = () => ({
    initialized: true,
    administrator_exists: true,
    warehouse_exists: true,
    open_fiscal_period_exists: true,
    workstation_configured: true,
  });

  async function loginToDashboard(diagnostic: DbDiagnostic) {
    wireInvoke({
      get_setup_status: initialized,
      get_db_diagnostic: () => diagnostic,
      login: () => ({ session_token: 'tok', expires_at: '2026-01-01T00:00:00Z' }),
      inspect_active_cash_session: () => null,
      list_warehouses: () => [{ id: 1, code: 'WH1', name: 'Main', is_active: true }],
      get_open_fiscal_period: () => ({
        id: 1,
        period_code: '2026',
        starts_on: '2026-01-01',
        ends_on: '2026-12-31',
      }),
      get_dashboard_summary: () => ({
        product_count: 3,
        variant_count: 3,
        active_cash_session_id: null,
        latest_document_id: null,
        latest_document_number: null,
        pending_generation_jobs: 0,
        pending_print_jobs: 0,
      }),
    });
    render(<App />);
    await screen.findByRole('heading', { name: 'Sign in' });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'good' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('heading', { name: 'Dashboard' });
  }

  it('shows a persistent banner when the config file is insecurely permissioned, without blocking the app', async () => {
    await loginToDashboard({
      code: 'OK',
      detail: 'x',
      schema: { status: 'UP_TO_DATE' },
      config_warning: 'INSECURE_PERMISSIONS',
    });

    const banner = await screen.findByTestId('db-config-permission-warning');
    expect(banner.textContent).toContain('other users of this computer');
    // Non-blocking: the app is fully usable — the dashboard content is
    // still there alongside the warning, not replaced by it.
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
  });

  it('shows no banner at all when there is nothing to warn about', async () => {
    await loginToDashboard({
      code: 'OK',
      detail: 'x',
      schema: { status: 'UP_TO_DATE' },
      config_warning: null,
    });

    expect(screen.queryByTestId('db-config-permission-warning')).not.toBeInTheDocument();
  });
});
