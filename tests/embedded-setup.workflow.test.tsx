/**
 * WS-K-4 — the first-run embedded PostgreSQL setup screen, end-to-end
 * through `AppRouter` (not mounted in isolation): `get_db_diagnostic`
 * returning `NOT_CONFIGURED` must route here, nothing runs before Start is
 * pressed, pressing it calls `run_embedded_setup` and renders the live
 * checklist as `embedded-setup-progress` events arrive, and a failed step
 * shows a plain-language message with Retry and a credential-free
 * "copy details" affordance.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));

type ProgressListener = (event: { payload: unknown }) => void;
let capturedListener: ProgressListener | null = null;
const unlistenMock = vi.fn();
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((_event: string, cb: ProgressListener) => {
    capturedListener = cb;
    return Promise.resolve(unlistenMock);
  }),
}));

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
  capturedListener = null;
  unlistenMock.mockReset();
  cleanup();
  window.localStorage.clear();
});

async function renderAtEmbeddedSetup(extraHandlers: Handlers = {}) {
  wireInvoke({
    get_setup_status: () => {
      throw { code: 'DATABASE_UNAVAILABLE' };
    },
    get_db_diagnostic: () => ({
      code: 'NOT_CONFIGURED',
      detail: 'x',
      schema: null,
      config_warning: null,
    }),
    ...extraHandlers,
  });
  render(<App />);
  expect(await screen.findByTestId('embedded-setup-screen')).toBeInTheDocument();
}

function emitProgress(step: string, status: 'RUNNING' | 'DONE' | 'FAILED', detail: string | null = null) {
  act(() => {
    capturedListener?.({ payload: { step, status, detail } });
  });
}

describe('embedded setup screen', () => {
  it('runs nothing until Start is pressed', async () => {
    await renderAtEmbeddedSetup();

    expect(screen.queryByTestId('embedded-setup-steps')).not.toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalledWith('run_embedded_setup', expect.anything());
  });

  it('calls run_embedded_setup and renders live progress once Start is pressed', async () => {
    const runEmbeddedSetup = vi.fn(() => undefined);
    await renderAtEmbeddedSetup({ run_embedded_setup: runEmbeddedSetup });

    fireEvent.click(screen.getByTestId('embedded-setup-start'));

    expect(runEmbeddedSetup).toHaveBeenCalled();
    expect(await screen.findByTestId('embedded-setup-steps')).toBeInTheDocument();

    emitProgress('CREATE_DATA_DIRECTORY', 'RUNNING');
    expect(screen.getByTestId('embedded-setup-step-CREATE_DATA_DIRECTORY')).toHaveAttribute(
      'data-status',
      'running',
    );

    emitProgress('CREATE_DATA_DIRECTORY', 'DONE');
    expect(screen.getByTestId('embedded-setup-step-CREATE_DATA_DIRECTORY')).toHaveAttribute(
      'data-status',
      'done',
    );
  });

  it('on a failed step, shows a plain-language message, Retry, and copy details — never a password', async () => {
    const runEmbeddedSetup = vi.fn(() => undefined);
    await renderAtEmbeddedSetup({ run_embedded_setup: runEmbeddedSetup });

    fireEvent.click(screen.getByTestId('embedded-setup-start'));
    await screen.findByTestId('embedded-setup-steps');

    emitProgress(
      'CREATE_ROLES',
      'FAILED',
      'could not create role stockiha_backup (connection refused)',
    );

    const failure = await screen.findByTestId('embedded-setup-failure');
    expect(failure.textContent).not.toMatch(/password|pwd|secret/i);
    expect(screen.getByTestId('embedded-setup-failure-details').textContent).toContain(
      'could not create role stockiha_backup',
    );

    // Retry re-invokes the command and resets the checklist.
    runEmbeddedSetup.mockClear();
    fireEvent.click(screen.getByTestId('embedded-setup-retry'));
    expect(runEmbeddedSetup).toHaveBeenCalled();
    expect(screen.queryByTestId('embedded-setup-failure')).not.toBeInTheDocument();
  });

  it('the copy-details affordance copies the step and detail, never a bare password-shaped string', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const runEmbeddedSetup = vi.fn(() => undefined);
    await renderAtEmbeddedSetup({ run_embedded_setup: runEmbeddedSetup });
    fireEvent.click(screen.getByTestId('embedded-setup-start'));
    await screen.findByTestId('embedded-setup-steps');

    emitProgress('RUN_MIGRATIONS', 'FAILED', 'migrations failed (connection refused)');
    await screen.findByTestId('embedded-setup-failure');

    await act(async () => {
      fireEvent.click(screen.getByTestId('embedded-setup-copy-details'));
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain('migrations failed');
    expect(copied.toLowerCase()).not.toMatch(/password|pwd|secret/);
  });
});
