import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

import { RecoverySettingsScreen } from '../src/features/settings/RecoverySettingsScreen';
import { I18nProvider } from '../src/shared/i18n';

beforeEach(() => {
  invokeMock.mockReset();
  cleanup();
  document.documentElement.setAttribute('dir', 'ltr');
  document.documentElement.setAttribute('lang', 'en');
});

describe('R6-001 recovery settings', () => {
  it('submits a typed read-only validation request and shows safe metadata', async () => {
    let capturedArgs: Record<string, unknown> | null = null;
    invokeMock.mockImplementation((command: string, args: Record<string, unknown>) => {
      expect(command).toBe('validate_operator_backup');
      capturedArgs = args;
      return Promise.resolve({
        requestId: 'backup-validate-1',
        bundleIdentifier: 'GestStock-Backup-20260803-195700',
        createdAtLabel: '20260803-195700',
        applicationVersion: '0.1.0',
        schemaVersion: '20260803193000',
        postgresMajorVersion: 18,
        integrityValid: true,
        applicationCompatible: true,
        schemaCompatible: true,
        postgresCompatible: true,
        fileCount: 9,
        totalBytes: 4096,
      });
    });

    render(
      <I18nProvider initialLocale="en">
        <RecoverySettingsScreen sessionToken="session-token" />
      </I18nProvider>,
    );

    expect(screen.getByText(/Restore is intentionally unavailable/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /restore/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create backup/i })).not.toBeInTheDocument();

    const path = String.raw`C:\Stockiha Backups\GestStock-Backup-20260803-195700`;
    fireEvent.change(screen.getByLabelText('Backup folder path'), {
      target: { value: path },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Validate backup' }));

    await screen.findByText('Backup integrity verified.');
    expect(screen.getByTestId('backup-validation-result')).toHaveTextContent(
      'GestStock-Backup-20260803-195700',
    );
    expect(screen.getByTestId('backup-validation-result')).toHaveTextContent('20260803193000');
    expect(screen.getByTestId('backup-validation-result')).toHaveTextContent('4,096');

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
    expect(screen.getByRole('button', { name: 'التحقق من النسخة' })).toBeDisabled();
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
  });

  it('uses fixed safe copy for a tampered bundle', async () => {
    invokeMock.mockRejectedValue({ code: 'BACKUP_VALIDATION_FAILED' });

    render(
      <I18nProvider initialLocale="en">
        <RecoverySettingsScreen sessionToken="session-token" />
      </I18nProvider>,
    );

    fireEvent.change(screen.getByLabelText('Backup folder path'), {
      target: { value: String.raw`C:\Stockiha Backups\GestStock-Backup-20260803-195700` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Validate backup' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The backup could not be validated. It was not changed or repaired.',
    );
    expect(screen.queryByText(/checksum/i)).not.toBeInTheDocument();
  });
});
