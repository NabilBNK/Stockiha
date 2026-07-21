import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from '../src/App';

// Mock the Tauri invoke function
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
const mockInvoke = vi.mocked(invoke);

const APP_INFO = {
  name: 'Stockiha',
  version: '0.1.0',
  stage: 'Slice 0',
  status: 'Ready',
};

const DB_HEALTH_OK = { status: 'CONNECTED' };

/**
 * Route the two mounted commands independently: `get_app_info` and
 * `check_db_health` (S0-003). Pass a rejection value (any unknown) to
 * simulate a command failure.
 */
function mockCommands({
  appInfo = APP_INFO,
  appInfoRejection,
  dbHealth = DB_HEALTH_OK,
  dbHealthRejection,
}: {
  appInfo?: typeof APP_INFO;
  appInfoRejection?: unknown;
  dbHealth?: unknown;
  dbHealthRejection?: unknown;
} = {}) {
  mockInvoke.mockImplementation((command: string) => {
    if (command === 'get_app_info') {
      return appInfoRejection !== undefined
        ? Promise.reject(appInfoRejection)
        : Promise.resolve(appInfo);
    }
    if (command === 'check_db_health') {
      return dbHealthRejection !== undefined
        ? Promise.reject(dbHealthRejection)
        : Promise.resolve(dbHealth);
    }
    return Promise.reject({ code: 'INTERNAL_ERROR' });
  });
}

/** Wait until both status panels have left their transient states. */
async function waitForSettled() {
  await waitFor(() => {
    expect(screen.getByTestId('backend-status')).not.toHaveTextContent('Connecting...');
    expect(screen.getByTestId('db-status')).not.toHaveTextContent('Checking...');
  });
}

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the application title', async () => {
    mockCommands();
    render(<App />);
    expect(screen.getByText('Stockiha')).toBeInTheDocument();
    await waitForSettled();
  });

  it('renders the slice heading', async () => {
    mockCommands();
    render(<App />);
    expect(screen.getByText('Slice 0 — Technical Foundation')).toBeInTheDocument();
    await waitForSettled();
  });

  it('shows connected status after successful backend call', async () => {
    mockCommands();
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('backend-status')).toHaveTextContent('Connected');
    });
    await waitForSettled();
  });

  it('shows a safe, fixed message for an unknown rejection value', async () => {
    // An Error carries no allowlisted `code`, so it resolves to UNKNOWN_ERROR.
    mockCommands({ appInfoRejection: new Error('IPC error') });
    render(<App />);
    await waitFor(() => {
      expect(
        screen.getByText('An unexpected error occurred. Please try again.'),
      ).toBeInTheDocument();
    });
    // The raw rejection text must never be rendered.
    expect(screen.queryByText(/IPC error/)).not.toBeInTheDocument();
    await waitForSettled();
  });

  it('resolves a recognized backend code to its safe internal message', async () => {
    mockCommands({ appInfoRejection: { code: 'INTERNAL_ERROR' } });
    render(<App />);
    await waitFor(() => {
      expect(
        screen.getByText('An internal error occurred. Please try again.'),
      ).toBeInTheDocument();
    });
    await waitForSettled();
  });

  it('never renders secret-like diagnostic properties from a rejection', async () => {
    mockCommands({
      appInfoRejection: {
        code: 'INTERNAL_ERROR',
        message: 'DO_NOT_EXPOSE_DIAGNOSTIC',
        details: 'DO_NOT_EXPOSE_DIAGNOSTIC',
        stack: 'DO_NOT_EXPOSE_DIAGNOSTIC',
      },
    });
    render(<App />);
    await waitFor(() => {
      expect(
        screen.getByText('An internal error occurred. Please try again.'),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText(/DO_NOT_EXPOSE_DIAGNOSTIC/)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('DO_NOT_EXPOSE_DIAGNOSTIC');
    await waitForSettled();
  });

  it('displays the not-implemented notice', async () => {
    mockCommands();
    render(<App />);
    expect(screen.getByText(/Business modules.*not implemented/i)).toBeInTheDocument();
    await waitForSettled();
  });

  it('calls get_app_info command on mount', async () => {
    mockCommands();
    render(<App />);
    expect(mockInvoke).toHaveBeenCalledWith('get_app_info');
    await waitForSettled();
  });

  // ——— S0-003: database connectivity proof panel ———

  it('calls check_db_health command on mount', async () => {
    mockCommands();
    render(<App />);
    expect(mockInvoke).toHaveBeenCalledWith('check_db_health');
    await waitForSettled();
  });

  it('shows "Connected" when the health check succeeds', async () => {
    mockCommands({ dbHealth: DB_HEALTH_OK });
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('db-status')).toHaveTextContent(
        'Database Status: Connected',
      );
    });
  });

  it('shows "Unavailable" for a malformed resolved health payload', async () => {
    // The command resolved (no rejection) but with an unexpected shape; the
    // runtime validator must never treat any of these as connected.
    const malformedPayloads: unknown[] = [
      { status: 'SOMETHING_ELSE' },
      { status: 'connected' }, // wrong case — must be exactly "CONNECTED"
      { status: 42 },
      {},
      null,
      'CONNECTED', // a bare string is not a valid report object
    ];

    for (const malformed of malformedPayloads) {
      vi.clearAllMocks();
      mockCommands({ dbHealth: malformed });
      const { unmount } = render(<App />);
      await waitFor(() => {
        expect(screen.getByTestId('db-status')).toHaveTextContent(
          'Database Status: Unavailable',
        );
      });
      expect(screen.queryByText(/SOMETHING_ELSE/)).not.toBeInTheDocument();
      unmount();
    }
  });

  it('shows "Not configured" for CONFIGURATION_ERROR', async () => {
    mockCommands({ dbHealthRejection: { code: 'CONFIGURATION_ERROR' } });
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('db-status')).toHaveTextContent(
        'Database Status: Not configured',
      );
    });
  });

  it('shows "Unavailable" for DATABASE_UNAVAILABLE', async () => {
    mockCommands({ dbHealthRejection: { code: 'DATABASE_UNAVAILABLE' } });
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('db-status')).toHaveTextContent(
        'Database Status: Unavailable',
      );
    });
  });

  it('shows "Unavailable" for an unknown health-check rejection', async () => {
    mockCommands({ dbHealthRejection: new Error('boom') });
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('db-status')).toHaveTextContent(
        'Database Status: Unavailable',
      );
    });
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument();
  });

  it('never renders connection details from a health-check rejection', async () => {
    // A hostile/buggy rejection carrying connection-like details: only the
    // allowlisted code may influence the UI; no property is ever rendered.
    mockCommands({
      dbHealthRejection: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'connection refused at db-host.internal:5432',
        host: 'db-host.internal',
        port: 5432,
        database: 'stockiha_dev',
        url: 'postgres://stockiha:DO_NOT_EXPOSE_DIAGNOSTIC@db-host.internal:5432/stockiha_dev',
        serverVersion: 'PostgreSQL 18.1',
        sqlxError: 'pool timed out while waiting for an open connection',
      },
    });
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('db-status')).toHaveTextContent(
        'Database Status: Unavailable',
      );
    });
    const text = document.body.textContent ?? '';
    for (const leak of [
      'db-host.internal',
      '5432',
      'stockiha_dev',
      'DO_NOT_EXPOSE_DIAGNOSTIC',
      'PostgreSQL 18.1',
      'pool timed out',
      'connection refused',
      'postgres://',
    ]) {
      expect(text).not.toContain(leak);
    }
  });
});
