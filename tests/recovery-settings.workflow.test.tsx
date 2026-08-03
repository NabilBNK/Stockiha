import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

import { RecoverySettingsScreen } from '../src/features/settings/RecoverySettingsScreen';
import { I18nProvider } from '../src/shared/i18n';

const SAFE_RESULT = {
  requestId: 'backup-request-1',
  bundleIdentifier: 'GestStock-Backup-20260803-203000',
  createdAtLabel: '20260803-203000',
  applicationVersion: '0.1.0',
  schemaVersion: '20260803201500',
  postgresMajorVersion: 18,
  integrityValid: true,
  applicationCompatible: true,
  schemaCompatible: true,
  postgresCompatible: true,
  fileCount: 9,
  totalBytes: 4096,
};

beforeEach(() => {
  invokeMock.mockReset();
  cleanup();
  document.documentElement.setAttribute('dir', 'ltr');
  document.documentElement.setAttribute('lang', 'en');
});

describe('R6-001 recovery settings', () => {
  it('creates a backup with a request-id-only payload and shows verified metadata', async () => {
    let capturedArgs: Record<string, unknown> | null = null;
    let resolveCreation!: (value: typeof SAFE_RESULT) => void;
    const pendingCreation = new Promise<typeof SAFE_RESULT>((resolve) => {
      resolveCreation = resolve;
    });
    invokeMock.mockImplementation((command: string, args: Record<string, unknown>) => {
      expect(command).toBe('create_operator_backup');
      capturedArgs = args;
      return pendingCreation;
    });

    render(
      <I18nProvider initialLocale="en">
        <RecoverySettingsScreen sessionToken="session-token" />
      </I18nProvider>,
    );

    expect(screen.getByText(/Restore is intentionally unavailable/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /restore/i })).not.toBeInTheDocument();

    const createButton = screen.getByRole('button', { name: 'Create backup' });
    fireEvent.click(createButton);
    expect(createButton).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Validate backup' })).toBeDisabled();

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
    expect(args.request).not.toHaveProperty('destination');
    expect(args.request).not.toHaveProperty('pgDumpPath');

    resolveCreation(SAFE_RESULT);
    expect(await screen.findByText('Backup created and verified.')).toBeInTheDocument();
    expect(screen.getByTestId('backup-result')).toHaveTextContent(
      'GestStock-Backup-20260803-203000',
    );
    expect(screen.getByTestId('backup-result')).toHaveTextContent('20260803201500');
    expect(screen.getByTestId('backup-result')).toHaveTextContent('4,096');
  });

  it('submits a typed read-only validation request and shows safe metadata', async () => {
    let capturedArgs: Record<string, unknown> | null = null;
    invokeMock.mockImplementation((command: string, args: Record<string, unknown>) => {
      expect(command).toBe('validate_operator_backup');
      capturedArgs = args;
      return Promise.resolve(SAFE_RESULT);
    });

    render(
      <I18nProvider initialLocale="en">
        <RecoverySettingsScreen sessionToken="session-token" />
      </I18nProvider>,
    );

    const path = String.raw`C:\Stockiha Backups\GestStock-Backup-20260803-203000`;
    fireEvent.change(screen.getByLabelText('Existing backup folder path'), {
      target: { value: path },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Validate backup' }));

    await screen.findByText('Backup integrity verified.');
    expect(screen.getByTestId('backup-result')).toHaveTextContent(
      'GestStock-Backup-20260803-203000',
    );

    await waitFor(() => expect(capturedArgs).not.toBeNull());
    const args = capturedArgs as unknown as {
      sessionToken: string;
      request: { requestId: string; bundlePath: string };
    };
    expect(args.sessionToken).toBe('session-token');
    expect(args.request.bundlePath).toBe(path);
    expect(args.request.requestId).toMatch(/^backup-validate-\d+-\d+$/);
    expect(args.request).not.toHaveProperty('password');
    expect(args.request).not.toHaveProperty('databaseUrl');
    expect(args.request).not.toHaveProperty('role');
  });

  it('shows fixed Arabic copy and applies RTL direction', () => {
    render(
      <I18nProvider initialLocale="ar">
        <RecoverySettingsScreen sessionToken="session-token" />
      </I18nProvider>,
    );

    expect(screen.getByRole('heading', { name: 'النسخ الاحتياطي والاسترجاع' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'إنشاء نسخة احتياطية' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'التحقق من النسخة' })).toBeDisabled();
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
  });

  it('uses fixed safe copy when creation fails', async () => {
    invokeMock.mockRejectedValue({
      code: 'BACKUP_CREATION_FAILED',
      details: 'DO_NOT_EXPOSE_DIAGNOSTIC',
    });

    render(
      <I18nProvider initialLocale="en">
        <RecoverySettingsScreen sessionToken="session-token" />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create backup' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The backup could not be created. No partial bundle was published.',
    );
    expect(screen.queryByText('DO_NOT_EXPOSE_DIAGNOSTIC')).not.toBeInTheDocument();
  });

  it('uses fixed safe copy for a tampered bundle', async () => {
    invokeMock.mockRejectedValue({ code: 'BACKUP_VALIDATION_FAILED' });

    render(
      <I18nProvider initialLocale="en">
        <RecoverySettingsScreen sessionToken="session-token" />
      </I18nProvider>,
    );

    fireEvent.change(screen.getByLabelText('Existing backup folder path'), {
      target: { value: String.raw`C:\Stockiha Backups\GestStock-Backup-20260803-203000` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Validate backup' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The backup could not be validated. It was not changed or repaired.',
    );
    expect(screen.queryByText(/checksum/i)).not.toBeInTheDocument();
  });
});
