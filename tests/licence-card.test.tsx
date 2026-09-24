/**
 * WS-K-7-B — LicenceSettingsCard (plan §9.5).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));

import { LicenceSettingsCard } from '../src/features/licence/LicenceSettingsCard';
import { I18nProvider } from '../src/shared/i18n';
import type { LicenceStatus } from '../src/shared/ipc/licenceDto';

function status(overrides: Partial<LicenceStatus> = {}): LicenceStatus {
  return {
    status: 'ACTIVE',
    mode: 'FULL',
    machine_code: 'STKH-TEST-0000-0000-0001',
    licence: {
      licence_id: 'L-20260926-0001',
      licensee: 'Boutique El Nour',
      issued_on: '2026-09-26',
      expires_on: '2027-09-26',
    },
    days_left: 300,
    grace_days_left: null,
    evaluated_at: '2026-09-26T10:00:00Z',
    ...overrides,
  };
}

function renderCard(locale: 'en' | 'fr' | 'ar' = 'en') {
  render(
    <I18nProvider initialLocale={locale}>
      <LicenceSettingsCard sessionToken="test-session-token" />
    </I18nProvider>,
  );
}

function wireInvoke(handlers: Record<string, (args: Record<string, unknown>) => unknown>) {
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
});

describe('WS-K-7-B LicenceSettingsCard', () => {
  it.each([
    ['ACTIVE', 'Active'],
    ['EXPIRING_SOON', 'Active — expiring soon'],
    ['GRACE', 'Not activated yet'],
    ['GRACE_OVER', 'Not activated — read-only'],
    ['EXPIRED', 'Expired — read-only'],
    ['INVALID', 'Invalid licence — read-only'],
    ['WRONG_MACHINE', 'Licence for another computer — read-only'],
    ['CLOCK_ROLLBACK', 'Computer date problem — read-only'],
    ['MACHINE_UNAVAILABLE', 'Cannot identify this computer — read-only'],
    ['DEVELOPER', 'Developer mode'],
  ] as const)('renders the label for status %s', async (code, label) => {
    wireInvoke({ get_licence_status: () => status({ status: code, licence: null, days_left: null }) });
    renderCard();
    expect(await screen.findByTestId('licence-status-label')).toHaveTextContent(label);
  });

  it('shows the machine code and Copy writes it to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    wireInvoke({ get_licence_status: () => status() });
    renderCard();

    const code = await screen.findByTestId('licence-machine-code');
    expect(code).toHaveTextContent('STKH-TEST-0000-0000-0001');

    fireEvent.click(screen.getByTestId('licence-copy-code'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('STKH-TEST-0000-0000-0001'));
    await screen.findByText('Copied');
  });

  it('disables Activate when the input is empty', async () => {
    wireInvoke({ get_licence_status: () => status({ status: 'GRACE', licence: null, days_left: null, grace_days_left: 10 }) });
    renderCard();

    const activate = await screen.findByTestId('licence-activate');
    expect(activate).toBeDisabled();

    fireEvent.change(screen.getByTestId('licence-key-input'), { target: { value: 'STKL1.abc.def' } });
    expect(activate).not.toBeDisabled();
  });

  it('activation success refreshes and shows the success banner', async () => {
    const activated = status();
    wireInvoke({
      get_licence_status: () => status({ status: 'GRACE', licence: null, days_left: null, grace_days_left: 10 }),
      activate_licence: () => activated,
    });
    renderCard();

    fireEvent.change(await screen.findByTestId('licence-key-input'), { target: { value: 'STKL1.abc.def' } });
    fireEvent.click(screen.getByTestId('licence-activate'));

    await screen.findByTestId('licence-card-banner');
    expect(screen.getByTestId('licence-card-banner')).toHaveTextContent('Licence activated.');
    expect((screen.getByTestId('licence-key-input') as HTMLTextAreaElement).value).toBe('');
  });

  it.each([
    ['LICENCE_MALFORMED', 'This licence key is incomplete or damaged. Paste the whole key again.'],
    ['LICENCE_INVALID', 'This licence key is not valid. Contact your supplier.'],
    ['LICENCE_WRONG_MACHINE', 'This licence key was issued for another computer.'],
    ['LICENCE_EXPIRED', 'This licence key has already expired.'],
    ['LICENCE_MACHINE_UNAVAILABLE', 'This computer cannot be identified. Contact your supplier.'],
  ])('shows the localized message for %s', async (code, message) => {
    wireInvoke({
      get_licence_status: () => status({ status: 'GRACE', licence: null, days_left: null, grace_days_left: 10 }),
      activate_licence: () => {
        throw { code };
      },
    });
    renderCard();

    fireEvent.change(await screen.findByTestId('licence-key-input'), { target: { value: 'STKL1.abc.def' } });
    fireEvent.click(screen.getByTestId('licence-activate'));

    await screen.findByTestId('licence-card-banner');
    expect(screen.getByTestId('licence-card-banner')).toHaveTextContent(message);
    // The pasted key is kept so the operator can fix it.
    expect((screen.getByTestId('licence-key-input') as HTMLTextAreaElement).value).toBe('STKL1.abc.def');
  });

  it('Remove asks for confirmation, and cancel calls nothing', async () => {
    const removeLicence = vi.fn();
    wireInvoke({
      get_licence_status: () => status(),
      remove_licence: removeLicence,
    });
    renderCard();

    fireEvent.click(await screen.findByTestId('licence-remove'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(removeLicence).not.toHaveBeenCalled();
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
  });

  it('Check again calls refresh_licence_status', async () => {
    const refreshLicenceStatus = vi.fn(() => status({ status: 'ACTIVE' }));
    wireInvoke({
      get_licence_status: () => status({ status: 'GRACE', licence: null, days_left: null, grace_days_left: 10 }),
      refresh_licence_status: refreshLicenceStatus,
    });
    renderCard();

    fireEvent.click(await screen.findByTestId('licence-refresh'));
    await waitFor(() => expect(refreshLicenceStatus).toHaveBeenCalled());
  });
});
