/**
 * Slice 1 — frontend workflow/integration tests. Mocks ONLY the Tauri IPC
 * boundary (`invoke`), dispatching by command name; no business logic is
 * mocked. Covers setup-state routing, backend-unavailable handling, login
 * failure (safe localized message), and a successful login reaching the
 * dashboard (backend-authoritative figures).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));

import App from '../src/App';

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

describe('setup-state routing', () => {
  it('shows the backend-unavailable screen when setup status fails', async () => {
    wireInvoke({ get_setup_status: () => { throw { code: 'DATABASE_UNAVAILABLE' }; } });
    render(<App />);
    expect(await screen.findByTestId('backend-unavailable')).toBeInTheDocument();
  });

  it('routes to first-run setup when not initialized', async () => {
    wireInvoke({
      get_setup_status: () => ({
        initialized: false,
        administrator_exists: false,
        warehouse_exists: false,
        open_fiscal_period_exists: false,
        workstation_configured: false,
      }),
    });
    render(<App />);
    // English default setup title.
    expect(await screen.findByText('Initial setup')).toBeInTheDocument();
  });

  it('routes to login when initialized but no session', async () => {
    wireInvoke({
      get_setup_status: () => ({
        initialized: true,
        administrator_exists: true,
        warehouse_exists: true,
        open_fiscal_period_exists: true,
        workstation_configured: true,
      }),
    });
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});

describe('login', () => {
  const initialized = () => ({
    initialized: true,
    administrator_exists: true,
    warehouse_exists: true,
    open_fiscal_period_exists: true,
    workstation_configured: true,
  });

  it('shows a safe localized message on invalid credentials', async () => {
    wireInvoke({
      get_setup_status: initialized,
      login: () => {
        throw { code: 'SESSION_INVALID', message: 'DO_NOT_LEAK' };
      },
    });
    render(<App />);
    await screen.findByRole('heading', { name: 'Sign in' });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'bad' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    const banner = await screen.findByTestId('login-error');
    expect(banner.textContent).toBe('Your session has expired. Please sign in again.');
    expect(banner.textContent).not.toContain('DO_NOT_LEAK');
  });

  it('reaches the dashboard after a successful login', async () => {
    wireInvoke({
      get_setup_status: initialized,
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

    // Dashboard renders with the backend-provided product count.
    await waitFor(() => expect(screen.getAllByText('3')[0]).toBeInTheDocument());

    const sidebarToggle = screen.getByTestId('sidebar-toggle');
    fireEvent.click(sidebarToggle);
    expect(document.querySelector('.sk-shell')).toHaveClass('sk-shell--nav-collapsed');
    expect(window.localStorage.getItem('stockiha.sidebarCollapsed')).toBe('true');

    const themeToggle = screen.getByTestId('theme-toggle');
    fireEvent.click(themeToggle);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem('stockiha.theme')).toBe('dark');
    expect(themeToggle).toHaveAccessibleName('Use light mode');
  });
});
