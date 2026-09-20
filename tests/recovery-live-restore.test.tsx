import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

const listenMock = vi.fn();
vi.mock('@tauri-apps/api/event', () => ({ listen: (...args: unknown[]) => listenMock(...args) }));

const openDialogMock = vi.fn();
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: (...args: unknown[]) => openDialogMock(...args) }));

let activeCashSession: { id: number } | null = null;
vi.mock('../src/shared/session/SessionContext', () => ({
  useSession: () => ({ activeCashSession }),
}));

import { I18nProvider } from '../src/shared/i18n';
import { RestoreConfirmDialog } from '../src/features/settings/recovery/RestoreConfirmDialog';
import { LiveRestoreScreen } from '../src/features/settings/recovery/LiveRestoreScreen';
import type { TakeoverRequest } from '../src/features/settings/recovery/RecoveryTakeoverContext';
import type { BackupListItem } from '../src/shared/ipc/recoveryDto';

const ITEM: BackupListItem = {
  bundleIdentifier: 'GestStock-Backup-20260805-150500',
  path: String.raw`C:\backups\GestStock-Backup-20260805-150500`,
  createdAtUtc: '2026-08-05T15:05:00Z',
  backupKind: 'MANUAL',
  formatVersion: 2,
  schemaVersion: '20260805151000',
  schemaVerdict: 'SAME',
  restorable: true,
  totalBytes: 4096,
  manifestReadable: true,
};

const LIVE_REQUEST: TakeoverRequest = {
  kind: 'LIVE',
  sessionToken: 'session-token',
  bundlePath: ITEM.path,
  bundleIdentifier: ITEM.bundleIdentifier,
  requestId: 'backup-live-restore-1',
  confirmationText: 'RESTORE',
};

beforeEach(() => {
  invokeMock.mockReset();
  listenMock.mockReset();
  openDialogMock.mockReset();
  activeCashSession = null;
  cleanup();
  document.documentElement.setAttribute('dir', 'ltr');
});

function renderDialog(onConfirm = vi.fn(), onCancel = vi.fn()) {
  render(
    <I18nProvider initialLocale="en">
      <RestoreConfirmDialog item={ITEM} onConfirm={onConfirm} onCancel={onCancel} />
    </I18nProvider>,
  );
  return { onConfirm, onCancel };
}

describe('RestoreConfirmDialog', () => {
  it('keeps the confirm button disabled until the checkbox is checked and RESTORE is typed exactly', () => {
    renderDialog();
    const confirmButton = screen.getByRole('button', { name: 'Restore now' });
    expect(confirmButton).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox'));
    expect(confirmButton).toBeDisabled();

    const wordField = screen.getByLabelText('Type RESTORE to confirm');
    fireEvent.change(wordField, { target: { value: 'restore' } });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(wordField, { target: { value: 'RESTORE' } });
    expect(confirmButton).toBeEnabled();
  });

  it('calls onConfirm with the exact typed word once enabled', () => {
    const { onConfirm } = renderDialog();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByLabelText('Type RESTORE to confirm'), { target: { value: 'RESTORE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Restore now' }));
    expect(onConfirm).toHaveBeenCalledWith('RESTORE');
  });

  it('calls onCancel and never onConfirm when Cancel is clicked', () => {
    const { onConfirm, onCancel } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('disables confirmation entirely while a cash session is open', () => {
    activeCashSession = { id: 1 };
    renderDialog();
    expect(
      screen.getByText('Close the open cash session before restoring.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByLabelText('Type RESTORE to confirm'), { target: { value: 'RESTORE' } });
    expect(screen.getByRole('button', { name: 'Restore now' })).toBeDisabled();
  });

  it('shows a note when the backup is from an older schema', () => {
    renderDialog();
    expect(
      screen.queryByText('This backup is from an older version; it will be updated automatically.'),
    ).not.toBeInTheDocument();
    cleanup();
    render(
      <I18nProvider initialLocale="en">
        <RestoreConfirmDialog item={{ ...ITEM, schemaVerdict: 'OLDER' }} onConfirm={vi.fn()} onCancel={vi.fn()} />
      </I18nProvider>,
    );
    expect(
      screen.getByText('This backup is from an older version; it will be updated automatically.'),
    ).toBeInTheDocument();
  });
});

function renderLiveRestoreScreen(request: TakeoverRequest = LIVE_REQUEST) {
  render(
    <I18nProvider initialLocale="en">
      <LiveRestoreScreen request={request} />
    </I18nProvider>,
  );
}

describe('LiveRestoreScreen', () => {
  it('subscribes to both events before invoking the restore command', async () => {
    const callOrder: string[] = [];
    let progressHandler: ((event: unknown) => void) | null = null;
    let outcomeHandler: ((event: unknown) => void) | null = null;
    listenMock.mockImplementation((eventName: string, handler: (event: unknown) => void) => {
      callOrder.push(`listen:${eventName}`);
      if (eventName === 'recovery-restore-progress') progressHandler = handler;
      if (eventName === 'recovery-restore-outcome') outcomeHandler = handler;
      return Promise.resolve(() => {});
    });
    invokeMock.mockImplementation((command: string) => {
      callOrder.push(`invoke:${command}`);
      return Promise.resolve({ started: true });
    });

    renderLiveRestoreScreen();

    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    expect(callOrder).toEqual([
      'listen:recovery-restore-progress',
      'listen:recovery-restore-outcome',
      'invoke:restore_backup_live',
    ]);
    expect(progressHandler).not.toBeNull();
    expect(outcomeHandler).not.toBeNull();
  });

  it('sends the exact live-restore request payload', async () => {
    listenMock.mockResolvedValue(() => {});
    let capturedArgs: Record<string, unknown> | null = null;
    invokeMock.mockImplementation((command: string, args: Record<string, unknown>) => {
      if (command === 'restore_backup_live') capturedArgs = args;
      return Promise.resolve({ started: true });
    });

    renderLiveRestoreScreen();
    await waitFor(() => expect(capturedArgs).not.toBeNull());
    const args = capturedArgs as unknown as { sessionToken: string; request: Record<string, unknown> };
    expect(args.sessionToken).toBe('session-token');
    expect(args.request).toEqual({
      requestId: 'backup-live-restore-1',
      bundlePath: ITEM.path,
      confirmationText: 'RESTORE',
    });
  });

  it('shows the did-not-start message and a restart button when dispatch fails', async () => {
    listenMock.mockResolvedValue(() => {});
    invokeMock.mockRejectedValue({ code: 'RECOVERY_UNAVAILABLE' });

    renderLiveRestoreScreen();
    expect(
      await screen.findByText('The restore did not start. Your data was not changed.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restart Stockiha' })).toBeInTheDocument();
  });

  it('renders the SUCCEEDED outcome', async () => {
    let outcomeHandler: ((event: { payload: unknown }) => void) | null = null;
    listenMock.mockImplementation((eventName: string, handler: (event: { payload: unknown }) => void) => {
      if (eventName === 'recovery-restore-outcome') outcomeHandler = handler;
      return Promise.resolve(() => {});
    });
    invokeMock.mockResolvedValue({ started: true });

    renderLiveRestoreScreen();
    await waitFor(() => expect(outcomeHandler).not.toBeNull());
    act(() => {
      outcomeHandler!({
        payload: { outcome: 'SUCCEEDED', bundleIdentifier: ITEM.bundleIdentifier, migratedForward: false },
      });
    });
    expect(await screen.findByText('Restore complete. Stockiha is restarting…')).toBeInTheDocument();
  });

  it('renders ROLLBACK_FAILED with a working "Copy details" and "Restart Stockiha"', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    let outcomeHandler: ((event: { payload: unknown }) => void) | null = null;
    listenMock.mockImplementation((eventName: string, handler: (event: { payload: unknown }) => void) => {
      if (eventName === 'recovery-restore-outcome') outcomeHandler = handler;
      return Promise.resolve(() => {});
    });
    invokeMock.mockImplementation((command: string) => {
      if (command === 'restart_after_recovery') return Promise.resolve();
      return Promise.resolve({ started: true });
    });

    renderLiveRestoreScreen();
    await waitFor(() => expect(outcomeHandler).not.toBeNull());
    act(() => {
      outcomeHandler!({
        payload: {
          outcome: 'ROLLBACK_FAILED',
          errorCode: 'RESTORE_ROLLBACK_FAILED',
          safetyBundlePath: 'D:\\safety\\GestStock-Backup-20260805-150500',
          logPath: 'C:\\data\\recovery.log',
        },
      });
    });
    expect(
      await screen.findByText(/Stockiha could not put your data back automatically/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Copy details' }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).toContain('RESTORE_ROLLBACK_FAILED');

    fireEvent.click(screen.getByRole('button', { name: 'Restart Stockiha' }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('restart_after_recovery'));
  });
});
