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
 *
 * Also covers the real-hardware install-ordering defect fix: `performUpdate`
 * must call `download()`, then `prepare_for_update_install` (Rust — stops
 * the embedded database and confirms its files are unlocked), then
 * `install()`, in that exact order, and must call
 * `resume_after_failed_update_install` if anything after the database was
 * stopped then fails. The Rust-side stop/restart logic itself is proven in
 * `src-tauri` (`pg_process`'s own tests); what is testable here is that
 * THIS code invokes it at the right moments, in the right order.
 *
 * WS-H-6 adds a mandatory `PRE_UPDATE` automatic backup between `download()`
 * and `prepare_for_update_install`: a failed/skipped-for-a-real-reason
 * backup must stop the update before either of those Rust calls, and the
 * backup itself must never run without a signed-in session.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

const checkMock = vi.fn();
const downloadMock = vi.fn();
const installMock = vi.fn();
vi.mock('@tauri-apps/plugin-updater', () => ({
  check: (...args: unknown[]) => checkMock(...args),
}));

// WS-H-6: `UpdateBanner` now reads the session itself via `useSession()`
// rather than taking a token prop. Mocked here (not a real `SessionProvider`)
// so every test controls the signed-in token directly, including the "no
// session" case the new login-required guard exists for.
let mockSessionToken: string | null = 'test-session-token';
vi.mock('../src/shared/session/SessionContext', () => ({
  useSession: () => ({
    user: mockSessionToken ? { username: 'tester', token: mockSessionToken } : null,
  }),
}));

import { UpdateBanner } from '../src/features/update/UpdateBanner';
import { I18nProvider } from '../src/shared/i18n';
import { COMMANDS } from '../src/shared/ipc/commands';

function fakeUpdate(version: string) {
  return {
    version,
    currentVersion: '5.0.0',
    download: (...args: unknown[]) => downloadMock(...args),
    install: (...args: unknown[]) => installMock(...args),
  };
}

function renderBanner(cashSessionOpen: boolean) {
  return render(
    <I18nProvider initialLocale="en">
      <UpdateBanner cashSessionOpen={cashSessionOpen} />
    </I18nProvider>,
  );
}

/**
 * Wires `invoke()` for the policy fetch plus both update-shutdown commands,
 * and (WS-H-6) `run_automatic_backup`, which by default resolves as a
 * successful backup so every pre-existing test's install flow still
 * completes. Individual tests override via `invokeMock` directly when they
 * need one of these to behave differently.
 */
function wirePolicy(mode: 'optional' | 'forced' | null) {
  invokeMock.mockImplementation((command: string) => {
    if (command === COMMANDS.GET_UPDATE_POLICY) {
      if (mode === null) return Promise.reject(new Error('offline'));
      return Promise.resolve({ mode, fetched: true });
    }
    if (command === COMMANDS.RUN_AUTOMATIC_BACKUP) {
      return Promise.resolve({ status: 'CREATED', usedFallbackDestination: false });
    }
    if (
      command === COMMANDS.PREPARE_FOR_UPDATE_INSTALL
      || command === COMMANDS.RESUME_AFTER_FAILED_UPDATE_INSTALL
    ) {
      return Promise.resolve();
    }
    return Promise.reject(new Error(`unexpected command ${command}`));
  });
}

beforeEach(() => {
  invokeMock.mockReset();
  checkMock.mockReset();
  downloadMock.mockReset();
  installMock.mockReset();
  mockSessionToken = 'test-session-token';
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
    expect(downloadMock).not.toHaveBeenCalled();
    expect(installMock).not.toHaveBeenCalled();
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
    downloadMock.mockRejectedValue(new Error('download interrupted'));

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
    // download() failing must never even attempt to touch the database.
    expect(invokeMock).not.toHaveBeenCalledWith(COMMANDS.PREPARE_FOR_UPDATE_INSTALL);
  });

  it('stops the database (prepare_for_update_install) strictly between the backup and install(), never before download or instead of it', async () => {
    wirePolicy('optional');
    checkMock.mockResolvedValue(fakeUpdate('5.1.0'));
    const callOrder: string[] = [];
    downloadMock.mockImplementation(async () => {
      callOrder.push('download');
    });
    installMock.mockImplementation(async () => {
      callOrder.push('install');
    });
    invokeMock.mockImplementation((command: string) => {
      if (command === COMMANDS.GET_UPDATE_POLICY) {
        return Promise.resolve({ mode: 'optional', fetched: true });
      }
      if (command === COMMANDS.RUN_AUTOMATIC_BACKUP) {
        callOrder.push('backup');
        return Promise.resolve({ status: 'CREATED', usedFallbackDestination: false });
      }
      if (command === COMMANDS.PREPARE_FOR_UPDATE_INSTALL) {
        callOrder.push('prepare');
        return Promise.resolve();
      }
      return Promise.reject(new Error(`unexpected command ${command}`));
    });

    renderBanner(false);
    const installButton = await screen.findByTestId('update-banner-install');
    fireEvent.click(installButton);

    await waitFor(() => expect(callOrder).toEqual(['download', 'backup', 'prepare', 'install']));
  });

  it('restarts the database (resume_after_failed_update_install) when install() fails after the database was already stopped', async () => {
    wirePolicy('optional');
    checkMock.mockResolvedValue(fakeUpdate('5.1.0'));
    downloadMock.mockResolvedValue(undefined);
    installMock.mockRejectedValue(new Error('NSIS launch failed'));
    const resumeMock = vi.fn().mockResolvedValue(undefined);
    invokeMock.mockImplementation((command: string) => {
      if (command === COMMANDS.GET_UPDATE_POLICY) {
        return Promise.resolve({ mode: 'optional', fetched: true });
      }
      if (command === COMMANDS.RUN_AUTOMATIC_BACKUP) {
        return Promise.resolve({ status: 'CREATED', usedFallbackDestination: false });
      }
      if (command === COMMANDS.PREPARE_FOR_UPDATE_INSTALL) {
        return Promise.resolve();
      }
      if (command === COMMANDS.RESUME_AFTER_FAILED_UPDATE_INSTALL) {
        return resumeMock();
      }
      return Promise.reject(new Error(`unexpected command ${command}`));
    });

    renderBanner(false);
    const installButton = await screen.findByTestId('update-banner-install');
    fireEvent.click(installButton);

    await screen.findByTestId('update-banner-error');
    expect(resumeMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT attempt to restart the database when download() itself fails (the database was never stopped)', async () => {
    wirePolicy('optional');
    checkMock.mockResolvedValue(fakeUpdate('5.1.0'));
    downloadMock.mockRejectedValue(new Error('network dropped'));
    const resumeMock = vi.fn().mockResolvedValue(undefined);
    invokeMock.mockImplementation((command: string) => {
      if (command === COMMANDS.GET_UPDATE_POLICY) {
        return Promise.resolve({ mode: 'optional', fetched: true });
      }
      if (command === COMMANDS.RESUME_AFTER_FAILED_UPDATE_INSTALL) {
        return resumeMock();
      }
      return Promise.reject(new Error(`unexpected command ${command}`));
    });

    renderBanner(false);
    const installButton = await screen.findByTestId('update-banner-install');
    fireEvent.click(installButton);

    await screen.findByTestId('update-banner-error');
    expect(resumeMock).not.toHaveBeenCalled();
  });

  // ---- WS-H-6: mandatory pre-update backup --------------------------------

  describe('WS-H-6 pre-update backup', () => {
    it('a thrown backup error stops the update before prepare/install and shows the backup-failed message', async () => {
      wirePolicy('optional');
      checkMock.mockResolvedValue(fakeUpdate('5.1.0'));
      downloadMock.mockResolvedValue(undefined);
      invokeMock.mockImplementation((command: string) => {
        if (command === COMMANDS.GET_UPDATE_POLICY) {
          return Promise.resolve({ mode: 'optional', fetched: true });
        }
        if (command === COMMANDS.RUN_AUTOMATIC_BACKUP) {
          return Promise.reject(new Error('disk full'));
        }
        return Promise.reject(new Error(`unexpected command ${command}`));
      });

      renderBanner(false);
      const installButton = await screen.findByTestId('update-banner-install');
      fireEvent.click(installButton);

      expect(await screen.findByTestId('update-banner-backup-failed')).toBeInTheDocument();
      expect(invokeMock).not.toHaveBeenCalledWith(COMMANDS.PREPARE_FOR_UPDATE_INSTALL);
      expect(installMock).not.toHaveBeenCalled();
    });

    it('SKIPPED/MODE_UNSUPPORTED (a developer machine) still proceeds to install', async () => {
      wirePolicy('optional');
      checkMock.mockResolvedValue(fakeUpdate('5.1.0'));
      downloadMock.mockResolvedValue(undefined);
      installMock.mockResolvedValue(undefined);
      invokeMock.mockImplementation((command: string) => {
        if (command === COMMANDS.GET_UPDATE_POLICY) {
          return Promise.resolve({ mode: 'optional', fetched: true });
        }
        if (command === COMMANDS.RUN_AUTOMATIC_BACKUP) {
          return Promise.resolve({ status: 'SKIPPED', skipReason: 'MODE_UNSUPPORTED', usedFallbackDestination: false });
        }
        if (command === COMMANDS.PREPARE_FOR_UPDATE_INSTALL) {
          return Promise.resolve();
        }
        return Promise.reject(new Error(`unexpected command ${command}`));
      });

      renderBanner(false);
      const installButton = await screen.findByTestId('update-banner-install');
      fireEvent.click(installButton);

      await waitFor(() => expect(installMock).toHaveBeenCalledTimes(1));
      expect(screen.queryByTestId('update-banner-backup-failed')).not.toBeInTheDocument();
    });

    it('SKIPPED/BUSY stops the update with the backup-failed message', async () => {
      wirePolicy('optional');
      checkMock.mockResolvedValue(fakeUpdate('5.1.0'));
      downloadMock.mockResolvedValue(undefined);
      invokeMock.mockImplementation((command: string) => {
        if (command === COMMANDS.GET_UPDATE_POLICY) {
          return Promise.resolve({ mode: 'optional', fetched: true });
        }
        if (command === COMMANDS.RUN_AUTOMATIC_BACKUP) {
          return Promise.resolve({ status: 'SKIPPED', skipReason: 'BUSY', usedFallbackDestination: false });
        }
        return Promise.reject(new Error(`unexpected command ${command}`));
      });

      renderBanner(false);
      const installButton = await screen.findByTestId('update-banner-install');
      fireEvent.click(installButton);

      expect(await screen.findByTestId('update-banner-backup-failed')).toBeInTheDocument();
      expect(invokeMock).not.toHaveBeenCalledWith(COMMANDS.PREPARE_FOR_UPDATE_INSTALL);
    });

    it('shows "sign in required" and calls nothing at all when there is no session token', async () => {
      mockSessionToken = null;
      wirePolicy('optional');
      checkMock.mockResolvedValue(fakeUpdate('5.1.0'));

      renderBanner(false);
      const installButton = await screen.findByTestId('update-banner-install');
      fireEvent.click(installButton);

      expect(await screen.findByTestId('update-banner-login-required')).toBeInTheDocument();
      expect(downloadMock).not.toHaveBeenCalled();
      expect(invokeMock).not.toHaveBeenCalledWith(COMMANDS.RUN_AUTOMATIC_BACKUP);
      expect(invokeMock).not.toHaveBeenCalledWith(COMMANDS.PREPARE_FOR_UPDATE_INSTALL);
    });

    it('shows "saving a safety backup" while the backup step runs', async () => {
      wirePolicy('optional');
      checkMock.mockResolvedValue(fakeUpdate('5.1.0'));
      downloadMock.mockResolvedValue(undefined);
      let resolveBackup: (() => void) | undefined;
      invokeMock.mockImplementation((command: string) => {
        if (command === COMMANDS.GET_UPDATE_POLICY) {
          return Promise.resolve({ mode: 'optional', fetched: true });
        }
        if (command === COMMANDS.RUN_AUTOMATIC_BACKUP) {
          return new Promise((resolve) => {
            resolveBackup = () =>
              resolve({ status: 'CREATED', usedFallbackDestination: false });
          });
        }
        if (command === COMMANDS.PREPARE_FOR_UPDATE_INSTALL) {
          return Promise.resolve();
        }
        return Promise.reject(new Error(`unexpected command ${command}`));
      });

      renderBanner(false);
      const installButton = await screen.findByTestId('update-banner-install');
      fireEvent.click(installButton);

      expect(await screen.findByTestId('update-banner-backing-up')).toBeInTheDocument();
      resolveBackup?.();
      await waitFor(() =>
        expect(screen.queryByTestId('update-banner-backing-up')).not.toBeInTheDocument(),
      );
    });
  });
});
