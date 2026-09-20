/**
 * WS-H-6 — the daily automatic backup trigger and the "no backup in 7 days"
 * overdue warning, both driven from `AppRouter.tsx`'s `AuthenticatedApp`.
 *
 * The daily trigger uses module-level state (`dailyBackupDone`,
 * `dailyBackupTimer`) so one attempt per app process survives remounts —
 * exactly what this file's tests must prove, and exactly why each
 * daily-trigger test gets its own fresh module instance via
 * `vi.resetModules()` + a dynamic re-import of `App`: sharing one module
 * instance across tests would let an earlier test's fired flag silently
 * make a later test's "did it fire" assertion meaningless.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentType } from 'react';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));
vi.mock('@tauri-apps/plugin-updater', () => ({ check: () => Promise.resolve(null) }));

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
    inspect_active_cash_session: () => null,
    list_warehouses: () => [{ id: 1, code: 'WH1', name: 'Main', is_active: true }],
    get_open_fiscal_period: () => ({ id: 1, period_code: '2026', starts_on: '2026-01-01', ends_on: '2026-12-31' }),
    get_dashboard_summary: () => ({
      product_count: 0, variant_count: 0, active_cash_session_id: null,
      latest_document_id: null, latest_document_number: null,
      pending_generation_jobs: 0, pending_print_jobs: 0,
    }),
    get_inventory_capabilities: () => ({
      can_manage_catalog: false, can_post_stock_receipt: false,
      can_view_inventory: false, can_manage_inventory: false,
    }),
    get_procurement_capabilities: () => ({
      can_manage_procurement: false, can_post_purchase_receipt: false,
      can_post_supplier_invoice: false, can_post_supplier_return: false,
      can_post_supplier_payment: false,
    }),
    get_customer_capabilities: () => ({
      can_view_customers: false, can_manage_customers: false, can_post_credit_sale: false,
      can_post_customer_payment: false, can_post_customer_refund: false,
      can_manage_drawer_policy: false, can_override_credit_limit: false,
    }),
    get_inventory_corrections_setting: () => ({ enabled: false }),
    get_recovery_capabilities: () => ({
      mode: 'EMBEDDED', canCreateBackup: true, canValidateBackup: true,
      canVerifyRestore: true, canRestoreLive: true,
    }),
    get_backup_status: () => ({
      lastSuccessAt: '2026-09-19T12:00:00Z', lastSuccessBundle: null,
      lastFailureAt: null, lastFailureCode: null, lastRestoreAt: null, lastRestoreBundle: null,
    }),
    run_automatic_backup: () => ({ status: 'CREATED', usedFallbackDestination: false }),
    // RecoverySettingsScreen's own mount-time reads, so navigating to
    // Settings in the last test renders its heading cleanly.
    get_backup_destination_setting: () => ({
      path: null, effectivePath: 'C:/backups', isDefault: true, available: true, sameDriveWarning: false,
    }),
    get_restore_verification_setting: () => ({ enabled: true }),
    list_backups: () => ({ destination: 'C:/backups', items: [] }),
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

/** A fresh module graph (including `AppRouter.tsx`'s daily-trigger module
 * state) for tests that must observe the timer from a clean slate. */
async function freshApp(): Promise<ComponentType> {
  vi.resetModules();
  const mod = await import('../src/App');
  return mod.default;
}

beforeEach(() => {
  invokeMock.mockReset();
  cleanup();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('WS-H-6 daily automatic backup trigger', () => {
  it('does not fire well before 60 seconds, fires within a short window after 60 seconds, and never fires again on a remount in the same process', async () => {
    // `shouldAdvanceTime` keeps the fake clock ticking in step with real
    // time too, which is what lets React Testing Library's own `findBy*`/
    // `waitFor` polling (used by `login()`) keep progressing while fake
    // timers are active - `@testing-library/dom` detects fake timers and
    // drives its own polling loop through the fake clock, and the login
    // flow's own awaited promises need that clock to keep moving. Because
    // that auto-ticking is tied to real wall-clock time (which varies under
    // load), this test checks well clear of the 60-second boundary (30s
    // "definitely not yet", 70s "definitely by now") rather than the exact
    // millisecond - the boundary itself is a plain `>= 20h`/`60_000`-style
    // comparison already covered precisely by the Rust unit tests.
    const runAutomaticBackup = vi.fn(() => ({ status: 'CREATED', usedFallbackDestination: false }));
    wireInvoke(baseHandlers({ run_automatic_backup: runAutomaticBackup }));
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const App = await freshApp();
    const view = render(<App />);
    await login();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(runAutomaticBackup).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(40_000);
    expect(runAutomaticBackup).toHaveBeenCalledTimes(1);
    expect(runAutomaticBackup).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionToken: 'tok',
        request: expect.objectContaining({ reason: 'DAILY' }),
      }),
    );

    // Remount in the same process (module state persists): no second call,
    // even after another full wait past the 60-second mark.
    view.unmount();
    render(<App />);
    await login();
    await vi.advanceTimersByTimeAsync(70_000);
    expect(runAutomaticBackup).toHaveBeenCalledTimes(1);
  }, 20_000);

  it('unmounting before 60 seconds cancels the timer - no call ever happens', async () => {
    const runAutomaticBackup = vi.fn(() => ({ status: 'CREATED', usedFallbackDestination: false }));
    wireInvoke(baseHandlers({ run_automatic_backup: runAutomaticBackup }));
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const App = await freshApp();
    const view = render(<App />);
    await login();

    await vi.advanceTimersByTimeAsync(30_000);
    view.unmount();
    await vi.advanceTimersByTimeAsync(70_000);

    expect(runAutomaticBackup).not.toHaveBeenCalled();
  }, 20_000);
});

describe('WS-H-6 backup-overdue warning', () => {
  it('is shown when there has never been a successful backup', async () => {
    wireInvoke(baseHandlers({
      get_backup_status: () => ({
        lastSuccessAt: null, lastSuccessBundle: null,
        lastFailureAt: null, lastFailureCode: null, lastRestoreAt: null, lastRestoreBundle: null,
      }),
    }));
    const App = await freshApp();
    render(<App />);
    await login();

    expect(await screen.findByTestId('backup-overdue-warning')).toBeInTheDocument();
  });

  it('is shown when the last successful backup is 8 days old', async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    wireInvoke(baseHandlers({
      get_backup_status: () => ({
        lastSuccessAt: eightDaysAgo, lastSuccessBundle: 'x',
        lastFailureAt: null, lastFailureCode: null, lastRestoreAt: null, lastRestoreBundle: null,
      }),
    }));
    const App = await freshApp();
    render(<App />);
    await login();

    expect(await screen.findByTestId('backup-overdue-warning')).toBeInTheDocument();
  });

  it('is hidden when the last successful backup is 1 hour old', async () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    wireInvoke(baseHandlers({
      get_backup_status: () => ({
        lastSuccessAt: oneHourAgo, lastSuccessBundle: 'x',
        lastFailureAt: null, lastFailureCode: null, lastRestoreAt: null, lastRestoreBundle: null,
      }),
    }));
    const App = await freshApp();
    render(<App />);
    await login();

    await screen.findByRole('heading', { name: 'Dashboard' });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('get_backup_status', expect.anything()));
    expect(screen.queryByTestId('backup-overdue-warning')).not.toBeInTheDocument();
  });

  it('is hidden when this session cannot create a backup at all', async () => {
    wireInvoke(baseHandlers({
      get_recovery_capabilities: () => ({
        mode: 'EMBEDDED', canCreateBackup: false, canValidateBackup: false,
        canVerifyRestore: false, canRestoreLive: false,
      }),
      get_backup_status: () => ({
        lastSuccessAt: null, lastSuccessBundle: null,
        lastFailureAt: null, lastFailureCode: null, lastRestoreAt: null, lastRestoreBundle: null,
      }),
    }));
    const App = await freshApp();
    render(<App />);
    await login();

    await screen.findByRole('heading', { name: 'Dashboard' });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('get_recovery_capabilities', expect.anything()));
    expect(screen.queryByTestId('backup-overdue-warning')).not.toBeInTheDocument();
  });

  it('the warning button switches the view to settings', async () => {
    wireInvoke(baseHandlers({
      get_backup_status: () => ({
        lastSuccessAt: null, lastSuccessBundle: null,
        lastFailureAt: null, lastFailureCode: null, lastRestoreAt: null, lastRestoreBundle: null,
      }),
    }));
    const App = await freshApp();
    render(<App />);
    await login();

    await screen.findByTestId('backup-overdue-warning');
    fireEvent.click(screen.getByRole('button', { name: 'Open backup settings' }));

    // The settings view renders the recovery settings card's own heading -
    // proof the button actually switched the view, not just cleared a flag.
    expect(await screen.findByRole('heading', { name: 'Backup and recovery' })).toBeInTheDocument();
  });
});
