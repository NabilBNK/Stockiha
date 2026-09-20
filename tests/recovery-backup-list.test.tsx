import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

const openDialogMock = vi.fn();
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: (...args: unknown[]) => openDialogMock(...args) }));

import { RecoverySettingsScreen } from '../src/features/settings/RecoverySettingsScreen';
import { I18nProvider } from '../src/shared/i18n';

const ADMIN_CAPABILITIES = {
  mode: 'EMBEDDED',
  canCreateBackup: true,
  canValidateBackup: true,
  canVerifyRestore: true,
  canRestoreLive: true,
};

const DEFAULT_DESTINATION = {
  path: null,
  effectivePath: String.raw`C:\Users\shop\AppData\Roaming\com.raqmenha.stockiha\operator-backups`,
  isDefault: true,
  available: true,
  sameDriveWarning: false,
};

const EMPTY_STATUS = {
  lastSuccessAt: null,
  lastSuccessBundle: null,
  lastFailureAt: null,
  lastFailureCode: null,
  lastRestoreAt: null,
  lastRestoreBundle: null,
};

const OLDER_ITEM = {
  bundleIdentifier: 'GestStock-Backup-20260801-090000',
  path: String.raw`C:\backups\GestStock-Backup-20260801-090000`,
  createdAtUtc: '2026-08-01T09:00:00Z',
  backupKind: 'DAILY',
  formatVersion: 2,
  schemaVersion: '20260801090000',
  schemaVerdict: 'OLDER',
  restorable: true,
  totalBytes: 2_500_000,
  manifestReadable: true,
};

const NEWEST_ITEM = {
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

const TWO_ITEM_LIST = { destination: DEFAULT_DESTINATION.effectivePath, items: [NEWEST_ITEM, OLDER_ITEM] };

const SAFE_RESTORE_RESULT = {
  requestId: 'backup-restore-1',
  bundleIdentifier: NEWEST_ITEM.bundleIdentifier,
  schemaVersion: NEWEST_ITEM.schemaVersion,
  postgresMajorVersion: 18,
  temporaryDatabaseCleaned: true,
  journalBalanced: true,
  controlTotals: {
    schemaCount: 12,
    tableCount: 42,
    userCount: 3,
    productCount: 8,
    customerCount: 4,
    supplierCount: 2,
    inventoryPositionCount: 6,
    inventoryMovementCount: 14,
    cashSaleCount: 5,
    journalCount: 9,
    journalDebitTotal: '42000',
    journalCreditTotal: '42000',
    customerExposureTotal: '7000',
    supplierOutstandingTotal: '8000',
    openingStateApplicationCount: 1,
  },
};

const SAFE_VALIDATE_RESULT = {
  requestId: 'backup-validate-1',
  bundleIdentifier: NEWEST_ITEM.bundleIdentifier,
  createdAtLabel: '20260805-150500',
  createdAtUtc: NEWEST_ITEM.createdAtUtc,
  applicationVersion: '0.1.0',
  schemaVersion: NEWEST_ITEM.schemaVersion,
  postgresMajorVersion: 18,
  integrityValid: true,
  applicationCompatible: true,
  schemaCompatible: true,
  postgresCompatible: true,
  fileCount: 9,
  totalBytes: 4096,
  backupKind: 'MANUAL',
  schemaVerdict: 'SAME',
  restorable: true,
};

interface MockOptions {
  enabled?: boolean;
  list?: Record<string, unknown> | Error;
}

function mockSettingAnd(
  action?: (command: string, args: Record<string, unknown>) => unknown,
  options: MockOptions = {},
) {
  const { enabled = true, list = TWO_ITEM_LIST } = options;
  invokeMock.mockImplementation((command: string, args: Record<string, unknown>) => {
    if (command === 'get_recovery_capabilities') return Promise.resolve(ADMIN_CAPABILITIES);
    if (command === 'get_backup_status') return Promise.resolve(EMPTY_STATUS);
    if (command === 'get_restore_verification_setting') return Promise.resolve({ enabled });
    if (command === 'get_backup_destination_setting') return Promise.resolve(DEFAULT_DESTINATION);
    if (command === 'list_backups') {
      return list instanceof Error ? Promise.reject({ code: 'RECOVERY_UNAVAILABLE' }) : Promise.resolve(list);
    }
    if (action) return action(command, args);
    throw new Error(`Unexpected command: ${command}`);
  });
}

function renderScreen(locale: 'en' | 'ar' = 'en') {
  render(
    <I18nProvider initialLocale={locale}>
      <RecoverySettingsScreen sessionToken="session-token" />
    </I18nProvider>,
  );
}

beforeEach(() => {
  invokeMock.mockReset();
  openDialogMock.mockReset();
  cleanup();
  document.documentElement.setAttribute('dir', 'ltr');
  document.documentElement.setAttribute('lang', 'en');
});

describe('WS-H-4 backup list', () => {
  it('renders rows sorted as returned, with kind, size and verdict labels', async () => {
    mockSettingAnd();
    renderScreen();
    const list = await screen.findByTestId('backup-list');
    await screen.findByText('Manual');
    const rows = list.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Manual');
    expect(rows[0]).toHaveTextContent('4.0 KB');
    expect(rows[0]).toHaveTextContent('Current');
    expect(rows[1]).toHaveTextContent('Daily automatic');
    expect(rows[1]).toHaveTextContent('2.4 MB');
    expect(rows[1]).toHaveTextContent('Older — will be updated');
  });

  it('shows the empty state when there are no backups', async () => {
    mockSettingAnd(undefined, { list: { destination: DEFAULT_DESTINATION.effectivePath, items: [] } });
    renderScreen();
    expect(await screen.findByText('No backups in this folder yet.')).toBeInTheDocument();
  });

  it('shows an error banner when the list call fails', async () => {
    mockSettingAnd(undefined, { list: new Error('RECOVERY_UNAVAILABLE') });
    renderScreen();
    const list = await screen.findByTestId('backup-list');
    await waitFor(() =>
      expect(list).toHaveTextContent(
        "Backup and restore are not available on this computer's setup. Contact your supplier.",
      ),
    );
  });

  it('hides Test buttons and shows a note when the restore-verification policy is off', async () => {
    mockSettingAnd(undefined, { enabled: false });
    renderScreen();
    await screen.findByText('Manual');
    expect(screen.queryByRole('button', { name: /^Test backup of/ })).not.toBeInTheDocument();
    expect(screen.getByText('Backup testing is turned off in Advanced.')).toBeInTheDocument();
  });

  it('disables every action button while one is busy', async () => {
    let resolveCheck: (() => void) | undefined;
    mockSettingAnd((command) => {
      if (command === 'validate_operator_backup') {
        return new Promise<typeof SAFE_VALIDATE_RESULT>((resolve) => {
          resolveCheck = () => {
            resolve(SAFE_VALIDATE_RESULT);
          };
        });
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    renderScreen();
    const checkButton = await screen.findByRole('button', { name: `Check backup of ${formatted(NEWEST_ITEM.createdAtUtc)}` });
    fireEvent.click(checkButton);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: `Test backup of ${formatted(OLDER_ITEM.createdAtUtc)}` }),
      ).toBeDisabled(),
    );
    resolveCheck?.();
    await screen.findByText('Backup integrity verified.');
  });

  describe('Copy to another folder', () => {
    it('opens a picker then calls copy_backup_to, showing the copied path on success', async () => {
      let capturedArgs: Record<string, unknown> | null = null;
      mockSettingAnd((command, args) => {
        expect(command).toBe('copy_backup_to');
        capturedArgs = args;
        return Promise.resolve({ copiedPath: 'F:\\USB\\GestStock-Backup-20260805-150500', totalBytes: 4096 });
      });
      renderScreen();
      openDialogMock.mockResolvedValueOnce('F:\\USB');
      fireEvent.click(
        await screen.findByRole('button', { name: `Copy backup of ${formatted(NEWEST_ITEM.createdAtUtc)}` }),
      );
      expect(await screen.findByText(/Backup copied to F:\\USB\\GestStock-Backup-20260805-150500/)).toBeInTheDocument();
      await waitFor(() => expect(capturedArgs).not.toBeNull());
      const args = capturedArgs as unknown as { request: Record<string, unknown> };
      expect(args.request).toMatchObject({ bundlePath: NEWEST_ITEM.path, targetDirectory: 'F:\\USB' });
    });

    it('does not call the IPC when the picker is cancelled', async () => {
      mockSettingAnd(() => {
        throw new Error('copy_backup_to must not be called');
      });
      renderScreen();
      openDialogMock.mockResolvedValueOnce(null);
      fireEvent.click(
        await screen.findByRole('button', { name: `Copy backup of ${formatted(NEWEST_ITEM.createdAtUtc)}` }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(invokeMock).not.toHaveBeenCalledWith('copy_backup_to', expect.anything());
    });
  });

  describe('Test this backup', () => {
    it('opens a confirmation dialog; cancelling does nothing', async () => {
      mockSettingAnd(() => {
        throw new Error('verify_operator_backup_restore must not be called');
      });
      renderScreen();
      fireEvent.click(
        await screen.findByRole('button', { name: `Test backup of ${formatted(NEWEST_ITEM.createdAtUtc)}` }),
      );
      expect(await screen.findByRole('dialog', { name: 'Test this backup?' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(invokeMock).not.toHaveBeenCalledWith('verify_operator_backup_restore', expect.anything());
    });

    it('confirming calls verify_operator_backup_restore with confirmed: true', async () => {
      let capturedArgs: Record<string, unknown> | null = null;
      mockSettingAnd((command, args) => {
        expect(command).toBe('verify_operator_backup_restore');
        capturedArgs = args;
        return Promise.resolve(SAFE_RESTORE_RESULT);
      });
      renderScreen();
      fireEvent.click(
        await screen.findByRole('button', { name: `Test backup of ${formatted(NEWEST_ITEM.createdAtUtc)}` }),
      );
      await screen.findByRole('dialog', { name: 'Test this backup?' });
      fireEvent.click(screen.getByRole('button', { name: 'Start test' }));

      expect(
        await screen.findByText('Backup restored and reconciled successfully in a temporary database.'),
      ).toBeInTheDocument();
      const result = screen.getByTestId('restore-result');
      expect(result).toHaveTextContent('42000');
      await waitFor(() => expect(capturedArgs).not.toBeNull());
      const args = capturedArgs as unknown as { request: Record<string, unknown> };
      expect(args.request).toMatchObject({ bundlePath: NEWEST_ITEM.path, confirmed: true });
    });
  });

  it('"Open a backup from another folder" validates the pick and shows a selected-backup row', async () => {
    mockSettingAnd((command) => {
      expect(command).toBe('validate_operator_backup');
      return Promise.resolve(SAFE_VALIDATE_RESULT);
    });
    renderScreen();
    await screen.findByRole('button', { name: `Check backup of ${formatted(NEWEST_ITEM.createdAtUtc)}` });
    openDialogMock.mockResolvedValueOnce(NEWEST_ITEM.path);
    fireEvent.click(screen.getByRole('button', { name: 'Open a backup from another folder…' }));

    const selected = await screen.findByTestId('selected-backup-list');
    expect(selected).toHaveTextContent('Selected backup');
    expect(selected).toHaveTextContent('Manual');
    expect(await screen.findByText('Backup integrity verified.')).toBeInTheDocument();
  });

  it('renders with a dir="rtl" ancestor in Arabic', async () => {
    mockSettingAnd();
    renderScreen('ar');
    await screen.findByTestId('backup-list');
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
  });
});

function formatted(iso: string): string {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}
