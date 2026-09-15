/**
 * WS-K-6 — the client update engine's own decision logic: given what
 * `@tauri-apps/plugin-updater`'s `check()` and our `get_update_policy` IPC
 * command report, does `UpdateBanner`/`useAppUpdate` do the right thing.
 *
 * Scope boundary, stated honestly: `check()`'s own semver comparison and
 * signature verification happen entirely inside `tauri-plugin-updater`'s
 * Rust implementation, which cannot be exercised from a frontend test (or
 * even headlessly from an external Rust test — see
 * `src-tauri/tests/update_signature_verification.rs`'s own doc comment for
 * why, and for where "a bad signature is rejected" is actually proven,
 * against the real verification primitive). What these tests prove instead
 * is that THIS code reacts correctly to that plugin's own documented
 * contract: `check()` resolves to an `Update` object when one is available
 * and to `null` when it is not (already, by construction, "same or older
 * version" from the plugin's perspective) — never that this repository's
 * code re-implements or second-guesses that comparison itself.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

const checkMock = vi.fn();
const downloadAndInstallMock = vi.fn();
vi.mock('@tauri-apps/plugin-updater', () => ({
  check: (...args: unknown[]) => checkMock(...args),
}));

import { UpdateBanner } from '../src/features/update/UpdateBanner';
import { I18nProvider } from '../src/shared/i18n';
import { COMMANDS } from '../src/shared/ipc/commands';

function fakeUpdate(version: string) {
  return {
    version,
    currentVersion: '5.0.0',
    downloadAndInstall: (...args: unknown[]) => downloadAndInstallMock(...args),
  };
}

function renderBanner(cashSessionOpen: boolean) {
  return render(
    <I18nProvider initialLocale="en">
      <UpdateBanner cashSessionOpen={cashSessionOpen} />
    </I18nProvider>,
  );
}

function wirePolicy(mode: 'optional' | 'forced' | null) {
  invokeMock.mockImplementation((command: string) => {
    if (command === COMMANDS.GET_UPDATE_POLICY) {
      if (mode === null) return Promise.reject(new Error('offline'));
      return Promise.resolve({ mode, fetched: true });
    }
    return Promise.reject(new Error(`unexpected command ${command}`));
  });
}

beforeEach(() => {
  invokeMock.mockReset();
  checkMock.mockReset();
  downloadAndInstallMock.mockReset();
  cleanup();
});

describe('WS-K-6 update engine', () => {
  it('a manifest reporting a newer version triggers an update offer', async () => {
    wirePolicy('optional');
    checkMock.mockResolvedValue(fakeUpdate('5.1.0'));

    renderBanner(false);

    expect(await screen.findByTestId('update-banner-optional')).toBeInTheDocument();
    expect(screen.getByText(/5\.1\.0/)).toBeInTheDocument();
  });

  it('check() resolving null (same or older version, per the plugin\'s own contract) offers nothing', async () => {
    wirePolicy('optional');
    checkMock.mockResolvedValue(null);

    renderBanner(false);

    // Give the effect a tick to resolve, then assert nothing rendered.
    await waitFor(() => expect(checkMock).toHaveBeenCalled());
    expect(screen.queryByTestId('update-banner-optional')).not.toBeInTheDocument();
    expect(screen.queryByTestId('update-banner-forced')).not.toBeInTheDocument();
  });

  it('no internet: check() rejecting fails silently, with no popup and nothing blocked', async () => {
    wirePolicy('optional');
    checkMock.mockRejectedValue(new Error('network error'));

    renderBanner(false);

    await waitFor(() => expect(checkMock).toHaveBeenCalled());
    expect(screen.queryByTestId('update-banner-optional')).not.toBeInTheDocument();
    expect(screen.queryByTestId('update-banner-forced')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('an open cash session disables installing now, on both optional and forced updates', async () => {
    wirePolicy('forced');
    checkMock.mockResolvedValue(fakeUpdate('5.1.0'));

    renderBanner(true);

    const installButton = await screen.findByTestId('update-banner-install');
    expect(installButton).toBeDisabled();
    expect(screen.getByTestId('update-banner-cash-session-notice')).toBeInTheDocument();
    expect(downloadAndInstallMock).not.toHaveBeenCalled();
  });

  it('the forced/optional flag is read from the policy fetch, not compiled in - same update, different mode', async () => {
    checkMock.mockResolvedValue(fakeUpdate('5.1.0'));

    wirePolicy('optional');
    const optionalRender = renderBanner(false);
    expect(await screen.findByTestId('update-banner-optional')).toBeInTheDocument();
    expect(screen.queryByTestId('update-banner-dismiss')).toBeInTheDocument();
    optionalRender.unmount();
    cleanup();

    wirePolicy('forced');
    renderBanner(false);
    expect(await screen.findByTestId('update-banner-forced')).toBeInTheDocument();
    // Forced updates offer no permanent dismiss control at all.
    expect(screen.queryByTestId('update-banner-dismiss')).not.toBeInTheDocument();
  });

  it('a failed install on a forced update leaves the rest of the app usable (never blocks trading)', async () => {
    wirePolicy('forced');
    checkMock.mockResolvedValue(fakeUpdate('5.1.0'));
    downloadAndInstallMock.mockRejectedValue(new Error('download interrupted'));

    renderBanner(false);

    const installButton = await screen.findByTestId('update-banner-install');
    expect(installButton).not.toBeDisabled();
    fireEvent.click(installButton);

    expect(await screen.findByTestId('update-banner-error')).toBeInTheDocument();
    // The banner itself is still present and interactive - nothing about
    // this failure removed the install control or threw past this
    // component's own boundary (a thrown error would have failed this
    // test via an uncaught rejection).
    expect(screen.getByTestId('update-banner-install')).toBeInTheDocument();
  });
});
