import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

const openDialogMock = vi.fn();
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: (...args: unknown[]) => openDialogMock(...args) }));

import { RecoverySettingsScreen } from '../src/features/settings/RecoverySettingsScreen';
import { I18nProvider } from '../src/shared/i18n';

const SAFE_RESULT = {
  requestId: 'backup-request-1',
  bundleIdentifier: 'GestStock-Backup-20260805-150500',
  createdAtLabel: '20260805-150500',
  applicationVersion: '0.1.0',
  schemaVersion: '20260805151000',
  postgresMajorVersion: 18,
  integrityValid: true,
  applicationCompatible: true,
  schemaCompatible: true,
  postgresCompatible: true,
  fileCount: 9,
  totalBytes: 4096,
};

const ADMIN_CAPABILITIES = {
  mode: 'EMBEDDED',
  canCreateBackup: true,
  canValidateBackup: true,
  canVerifyRestore: true,
  canRestoreLive: true,
};

const NO_CAPABILITIES = {
  mode: 'EMBEDDED',
  canCreateBackup: false,
  canValidateBackup: false,
  canVerifyRestore: false,
  canRestoreLive: false,
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

const EMPTY_LIST = { destination: DEFAULT_DESTINATION.effectivePath, items: [] };

function renderScreen(locale: 'en' | 'ar' = 'en') {
  render(
    <I18nProvider initialLocale={locale}>
      <RecoverySettingsScreen sessionToken="session-token" />
    </I18nProvider>,
  );
}

interface MockOptions {
  enabled?: boolean;
  capabilities?: Record<string, unknown> | Error;
  destination?: Record<string, unknown>;
  status?: Record<string, unknown> | (() => Record<string, unknown>);
  list?: Record<string, unknown>;
}

/**
 * Routes the read-only setup calls the screen makes on mount; `action`
 * answers everything else (create / list_backups / etc.).
 */
function mockSettingAnd(
  action?: (command: string, args: Record<string, unknown>) => unknown,
  options: MockOptions = {},
) {
  const {
    enabled = true,
    capabilities = ADMIN_CAPABILITIES,
    destination = DEFAULT_DESTINATION,
    status = EMPTY_STATUS,
    list = EMPTY_LIST,
  } = options;
  invokeMock.mockImplementation((command: string, args: Record<string, unknown>) => {
    if (command === 'get_recovery_capabilities') {
      return capabilities instanceof Error
        ? Promise.reject({ code: 'SESSION_INVALID' })
        : Promise.resolve(capabilities);
    }
    if (command === 'get_backup_status') {
      return Promise.resolve(typeof status === 'function' ? status() : status);
    }
    if (command === 'get_restore_verification_setting') {
      return Promise.resolve({ enabled });
    }
    if (command === 'get_backup_destination_setting') {
      return Promise.resolve(destination);
    }
    if (command === 'list_backups') {
      return Promise.resolve(list);
    }
    if (action) return action(command, args);
    throw new Error(`Unexpected command: ${command}`);
  });
}

beforeEach(() => {
  invokeMock.mockReset();
  openDialogMock.mockReset();
  cleanup();
  document.documentElement.setAttribute('dir', 'ltr');
  document.documentElement.setAttribute('lang', 'en');
});

describe('R6/WS-H-4 backup and recovery settings', () => {
  it('loads a default-on restore setting and submits a request-id-only backup payload', async () => {
    let capturedArgs: Record<string, unknown> | null = null;
    mockSettingAnd((command, args) => {
      expect(command).toBe('create_operator_backup');
      capturedArgs = args;
      return Promise.resolve(SAFE_RESULT);
    });

    renderScreen();
    const setting = await screen.findByRole('checkbox', {
      name: 'Temporary restore verification enabled',
    });
    await waitFor(() => expect(setting).toBeChecked());
    expect(screen.getByText(/never replaces or modifies the live Stockiha database/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create backup' }));
    expect(await screen.findByText('Backup created and verified.')).toBeInTheDocument();
    expect(screen.getByTestId('backup-result')).toHaveTextContent('20260805151000');
    expect(screen.getByTestId('backup-result')).toHaveTextContent('4,096');

    await waitFor(() => expect(capturedArgs).not.toBeNull());
    const args = capturedArgs as unknown as {
      sessionToken: string;
      request: Record<string, unknown>;
    };
    expect(args.sessionToken).toBe('session-token');
    expect(args.request.requestId).toMatch(/^backup-create-\d+-\d+$/);
    expect(Object.keys(args.request)).toEqual(['requestId']);
    expect(args.request).not.toHaveProperty('password');
    expect(args.request).not.toHaveProperty('databaseUrl');
    expect(args.request).not.toHaveProperty('role');
  });

  it('disables the restore-verification policy independently of backup creation', async () => {
    const calls: Array<{ command: string; args: Record<string, unknown> }> = [];
    invokeMock.mockImplementation((command: string, args: Record<string, unknown>) => {
      calls.push({ command, args });
      if (command === 'get_recovery_capabilities') return Promise.resolve(ADMIN_CAPABILITIES);
      if (command === 'get_backup_status') return Promise.resolve(EMPTY_STATUS);
      if (command === 'get_backup_destination_setting') return Promise.resolve(DEFAULT_DESTINATION);
      if (command === 'list_backups') return Promise.resolve(EMPTY_LIST);
      if (command === 'get_restore_verification_setting') return Promise.resolve({ enabled: true });
      if (command === 'update_restore_verification_setting') {
        return Promise.resolve({ enabled: false });
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    renderScreen();
    const setting = await screen.findByRole('checkbox', {
      name: 'Temporary restore verification enabled',
    });
    await waitFor(() => expect(setting).toBeChecked());
    fireEvent.click(setting);
    await waitFor(() => expect(setting).not.toBeChecked());

    const updateCall = calls.find((call) => call.command === 'update_restore_verification_setting');
    expect(updateCall?.args).toEqual({ sessionToken: 'session-token', enabled: false });
    expect(screen.getByRole('button', { name: 'Create backup' })).toBeEnabled();
  });

  it('shows fixed Arabic copy under RTL direction', async () => {
    mockSettingAnd();
    renderScreen('ar');
    expect(await screen.findByRole('heading', { name: 'النسخ الاحتياطي والاسترجاع' })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'تفعيل اختبار الاسترجاع المؤقت' })).toBeChecked(),
    );
    expect(screen.getByRole('button', { name: 'إنشاء نسخة احتياطية' })).toBeEnabled();
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
  });
});

describe('WS-H-3 capabilities, mode, destination and status', () => {
  it('renders nothing when every capability is false (cashier)', async () => {
    mockSettingAnd(undefined, { capabilities: NO_CAPABILITIES });
    const { container } = render(
      <I18nProvider initialLocale="en">
        <RecoverySettingsScreen sessionToken="session-token" />
      </I18nProvider>,
    );
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('get_recovery_capabilities', {
        sessionToken: 'session-token',
      }),
    );
    // Give any stray render a tick, then assert the card never appeared.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('heading', { name: 'Backup and recovery' })).not.toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalledWith('get_backup_destination_setting', expect.anything());
  });

  it('renders nothing when the capabilities call fails', async () => {
    mockSettingAnd(undefined, { capabilities: new Error('SESSION_INVALID') });
    const { container } = render(
      <I18nProvider initialLocale="en">
        <RecoverySettingsScreen sessionToken="session-token" />
      </I18nProvider>,
    );
    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it('shows only the unavailable banner when the mode is UNAVAILABLE', async () => {
    mockSettingAnd(undefined, { capabilities: { ...NO_CAPABILITIES, mode: 'UNAVAILABLE' } });
    renderScreen();
    expect(await screen.findByRole('heading', { name: 'Backup and recovery' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Backup and restore are not available on this computer's setup. Contact your supplier.",
    );
    expect(screen.queryByRole('button', { name: 'Create backup' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('shows the default destination path with its helper text', async () => {
    mockSettingAnd();
    renderScreen();
    await waitFor(() =>
      expect(screen.getByLabelText('Backup destination')).toHaveValue(DEFAULT_DESTINATION.effectivePath),
    );
    expect(
      screen.getByText('Default folder on this computer. For real protection choose a USB drive or another disk.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/same disk as your data/)).not.toBeInTheDocument();
  });

  it('shows the same-drive warning for a chosen folder on the data disk', async () => {
    mockSettingAnd(undefined, {
      destination: {
        path: 'D:\\Backups',
        effectivePath: 'D:\\Backups',
        isDefault: false,
        available: true,
        sameDriveWarning: true,
      },
    });
    renderScreen();
    await waitFor(() => expect(screen.getByLabelText('Backup destination')).toHaveValue('D:\\Backups'));
    expect(screen.getByText(/same disk as your data/)).toBeInTheDocument();
    expect(screen.queryByText(/Default folder on this computer/)).not.toBeInTheDocument();
  });

  it('shows an error banner when the stored destination is unavailable', async () => {
    mockSettingAnd(undefined, {
      destination: {
        path: 'E:\\Backups',
        effectivePath: 'E:\\Backups',
        isDefault: false,
        available: false,
        sameDriveWarning: false,
      },
    });
    renderScreen();
    await waitFor(() => expect(screen.getByLabelText('Backup destination')).toHaveValue('E:\\Backups'));
    expect(
      screen.getByText('The backup folder is not available. Plug in the drive or choose another folder.'),
    ).toBeInTheDocument();
  });

  it('re-fetches the destination after a successful change', async () => {
    let destinationReads = 0;
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_recovery_capabilities') return Promise.resolve(ADMIN_CAPABILITIES);
      if (command === 'get_backup_status') return Promise.resolve(EMPTY_STATUS);
      if (command === 'get_restore_verification_setting') return Promise.resolve({ enabled: true });
      if (command === 'list_backups') return Promise.resolve(EMPTY_LIST);
      if (command === 'get_backup_destination_setting') {
        destinationReads += 1;
        return Promise.resolve(
          destinationReads === 1
            ? DEFAULT_DESTINATION
            : { path: 'F:\\Shop', effectivePath: 'F:\\Shop', isDefault: false, available: true, sameDriveWarning: false },
        );
      }
      if (command === 'update_backup_destination_setting') {
        return Promise.resolve({ path: 'F:\\Shop', sameDriveWarning: false });
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    renderScreen();
    await screen.findByLabelText('Backup destination');
    openDialogMock.mockResolvedValueOnce('F:\\Shop');
    fireEvent.click(screen.getByRole('button', { name: 'Change destination…' }));
    expect(await screen.findByText('Backup destination updated.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Backup destination')).toHaveValue('F:\\Shop'));
    expect(screen.queryByText(/Default folder on this computer/)).not.toBeInTheDocument();
  });

  it('shows the status line and refreshes it after a successful backup', async () => {
    let statusReads = 0;
    mockSettingAnd(
      (command) => {
        expect(command).toBe('create_operator_backup');
        return Promise.resolve({ ...SAFE_RESULT, backupKind: 'MANUAL', restorable: true });
      },
      {
        status: () => {
          statusReads += 1;
          return statusReads === 1
            ? EMPTY_STATUS
            : {
                ...EMPTY_STATUS,
                lastSuccessAt: new Date().toISOString(),
                lastSuccessBundle: 'GestStock-Backup-20260805-150500',
              };
        },
      },
    );
    renderScreen();
    expect(await screen.findByText('No backup has been made yet.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create backup' }));
    expect(await screen.findByText('Backup created and verified.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('backup-status-line')).toHaveTextContent(/Last successful backup:/));
    expect(statusReads).toBe(2);

    const grid = screen.getByTestId('backup-result');
    expect(grid).toHaveTextContent('Backup type');
    expect(grid).toHaveTextContent('Manual');
    expect(grid).toHaveTextContent('Can be restored by this version');
    // R5: the application version is shown without a compatibility suffix.
    expect(grid).toHaveTextContent('0.1.0');
    expect(grid).not.toHaveTextContent('0.1.0 · Compatible');
  });

  it('flags a failed last attempt and a stale last success', async () => {
    const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
    mockSettingAnd(undefined, {
      status: {
        ...EMPTY_STATUS,
        lastSuccessAt: fourDaysAgo,
        lastFailureAt: new Date().toISOString(),
        lastFailureCode: 'BACKUP_PG_DUMP_FAILED',
      },
    });
    renderScreen();
    const line = await screen.findByTestId('backup-status-line');
    expect(line).toHaveTextContent('The last backup attempt failed.');
    expect(line).toHaveTextContent(/Last successful backup:/);
    expect(line).not.toHaveTextContent('BACKUP_PG_DUMP_FAILED');
  });

  it('shows the localized text for BACKUP_DESTINATION_UNAVAILABLE from create', async () => {
    mockSettingAnd(() => Promise.reject({ code: 'BACKUP_DESTINATION_UNAVAILABLE', details: 'E:\\secret' }));
    renderScreen();
    await screen.findByRole('button', { name: 'Create backup' });
    fireEvent.click(screen.getByRole('button', { name: 'Create backup' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The backup folder is not available. Plug in the drive or choose another folder.',
    );
    expect(screen.queryByText(/E:\\secret/)).not.toBeInTheDocument();
  });

  it('shows only the backup list for a validate-only user', async () => {
    mockSettingAnd(undefined, {
      capabilities: { ...NO_CAPABILITIES, canValidateBackup: true },
    });
    renderScreen();
    expect(await screen.findByRole('button', { name: 'Open a backup from another folder…' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create backup' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Backup destination')).not.toBeInTheDocument();
    expect(screen.queryByTestId('backup-status-line')).not.toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalledWith('get_backup_destination_setting', expect.anything());
    expect(invokeMock).not.toHaveBeenCalledWith('get_restore_verification_setting', expect.anything());
  });
});
