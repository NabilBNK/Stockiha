import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

import { RecoverySettingsScreen } from '../src/features/settings/RecoverySettingsScreen';
import { I18nProvider } from '../src/shared/i18n';

const SAFE_RESULT = {
  requestId: 'backup-request-1',
  bundleIdentifier: 'GestStock-Backup-20260805-150500',
  createdAtLabel: '20260805-150500',
  applicationVersion: '0.1.0',
  schemaVersion: '20260805150500',
  postgresMajorVersion: 18,
  integrityValid: true,
  applicationCompatible: true,
  schemaCompatible: true,
  postgresCompatible: true,
  fileCount: 9,
  totalBytes: 4096,
};

const SAFE_RESTORE_RESULT = {
  requestId: 'backup-restore-1',
  bundleIdentifier: 'GestStock-Backup-20260805-150500',
  schemaVersion: '20260805150500',
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

function renderScreen(locale: 'en' | 'ar' = 'en') {
  render(
    <I18nProvider initialLocale={locale}>
      <RecoverySettingsScreen sessionToken="session-token" />
    </I18nProvider>,
  );
}

beforeEach(() => {
  invokeMock.mockReset();
  cleanup();
  document.documentElement.setAttribute('dir', 'ltr');
  document.documentElement.setAttribute('lang', 'en');
});

describe('R6 backup and recovery settings', () => {
  it('creates a backup with a request-id-only payload and shows verified metadata', async () => {
    let capturedArgs: Record<string, unknown> | null = null;
    invokeMock.mockImplementation((command: string, args: Record<string, unknown>) => {
      expect(command).toBe('create_operator_backup');
      capturedArgs = args;
      return Promise.resolve(SAFE_RESULT);
    });

    renderScreen();
    expect(screen.getByText(/never replaces or modifies the live Stockiha database/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create backup' }));

    expect(await screen.findByText('Backup created and verified.')).toBeInTheDocument();
    expect(screen.getByTestId('backup-result')).toHaveTextContent('20260805150500');
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

  it('submits a typed read-only validation request', async () => {
    let capturedArgs: Record<string, unknown> | null = null;
    invokeMock.mockImplementation((command: string, args: Record<string, unknown>) => {
      expect(command).toBe('validate_operator_backup');
      capturedArgs = args;
      return Promise.resolve(SAFE_RESULT);
    });

    renderScreen();
    const path = String.raw`C:\Stockiha Backups\GestStock-Backup-20260805-150500`;
    fireEvent.change(screen.getByLabelText('Existing backup folder path'), {
      target: { value: path },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Validate backup' }));

    expect(await screen.findByText('Backup integrity verified.')).toBeInTheDocument();
    await waitFor(() => expect(capturedArgs).not.toBeNull());
    const args = capturedArgs as unknown as {
      request: { requestId: string; bundlePath: string };
    };
    expect(args.request.bundlePath).toBe(path);
    expect(args.request.requestId).toMatch(/^backup-validate-\d+-\d+$/);
    expect(args.request).not.toHaveProperty('password');
    expect(args.request).not.toHaveProperty('databaseUrl');
  });

  it('requires acknowledgement and verifies recovery only in a temporary database', async () => {
    let capturedArgs: Record<string, unknown> | null = null;
    invokeMock.mockImplementation((command: string, args: Record<string, unknown>) => {
      expect(command).toBe('verify_operator_backup_restore');
      capturedArgs = args;
      return Promise.resolve(SAFE_RESTORE_RESULT);
    });

    renderScreen();
    const path = String.raw`C:\Stockiha Backups\GestStock-Backup-20260805-150500`;
    fireEvent.change(screen.getByLabelText('Existing backup folder path'), {
      target: { value: path },
    });

    const restoreButton = screen.getByRole('button', { name: 'Verify temporary restore' });
    expect(restoreButton).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', {
      name: /temporarily creates and then deletes a PostgreSQL database/,
    }));
    expect(restoreButton).toBeEnabled();
    fireEvent.click(restoreButton);

    expect(await screen.findByText(
      'Backup restored and reconciled successfully in a temporary database.',
    )).toBeInTheDocument();
    const result = screen.getByTestId('restore-result');
    expect(result).toHaveTextContent('Yes');
    expect(result).toHaveTextContent('Balanced');
    expect(result).toHaveTextContent('42000');
    expect(result).toHaveTextContent('7000');
    expect(result).toHaveTextContent('8000');

    await waitFor(() => expect(capturedArgs).not.toBeNull());
    const args = capturedArgs as unknown as {
      sessionToken: string;
      request: Record<string, unknown>;
    };
    expect(args.sessionToken).toBe('session-token');
    expect(args.request).toMatchObject({ bundlePath: path, confirmed: true });
    expect(args.request.requestId).toMatch(/^backup-restore-\d+-\d+$/);
    expect(Object.keys(args.request).sort()).toEqual(['bundlePath', 'confirmed', 'requestId']);
    expect(args.request).not.toHaveProperty('password');
    expect(args.request).not.toHaveProperty('databaseUrl');
    expect(args.request).not.toHaveProperty('targetDatabase');
  });

  it('shows fixed Arabic copy under RTL direction', () => {
    renderScreen('ar');
    expect(screen.getByRole('heading', { name: 'النسخ الاحتياطي والاسترجاع' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'إنشاء نسخة احتياطية' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'اختبار الاسترجاع المؤقت' })).toBeDisabled();
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
  });

  it('uses fixed safe copy for validation and restore failures', async () => {
    invokeMock.mockRejectedValue({
      code: 'BACKUP_VALIDATION_FAILED',
      details: 'DO_NOT_EXPOSE_DIAGNOSTIC',
    });

    renderScreen();
    fireEvent.change(screen.getByLabelText('Existing backup folder path'), {
      target: { value: String.raw`C:\Stockiha Backups\GestStock-Backup-20260805-150500` },
    });
    fireEvent.click(screen.getByRole('checkbox', {
      name: /temporarily creates and then deletes a PostgreSQL database/,
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Verify temporary restore' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The temporary restore verification failed. The live database was not replaced.',
    );
    expect(screen.queryByText('DO_NOT_EXPOSE_DIAGNOSTIC')).not.toBeInTheDocument();
  });
});
