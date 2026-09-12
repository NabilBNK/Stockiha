/**
 * WS-K-4 — first-run embedded PostgreSQL setup screen.
 *
 * Shown by `AppRouter` in place of `BackendUnavailableScreen` specifically
 * when the diagnostic reason is `NOT_CONFIGURED`: with the embedded
 * architecture, "not configured" always means "this is the first launch and
 * setup has never run," not "something is broken." Every other diagnostic
 * reason still goes through `BackendUnavailableScreen` unchanged.
 *
 * Nothing runs until the user presses Start. Progress arrives live over the
 * `embedded-setup-progress` Tauri event and is also written to
 * `setup.log` on the Rust side — this screen only renders what it receives,
 * it never blocks the window with a synchronous wait. On success the Rust
 * command restarts the app process itself, so this screen does not need to
 * handle a final "all done" state — the window reloads out from under it.
 *
 * Never renders a password: `detail` on every progress event is
 * credential-free by construction on the Rust side (see
 * `embedded_setup::SetupProgress`'s own doc comment), and the "copy
 * details" affordance below copies exactly that same string, verbatim.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';

import { Banner, Button } from '../../shared/components';
import { useI18n, type MessageKey } from '../../shared/i18n';
import {
  EMBEDDED_SETUP_PROGRESS_EVENT,
  EMBEDDED_SETUP_STEPS,
  runEmbeddedSetup,
  type EmbeddedSetupProgress,
  type EmbeddedSetupStep,
} from '../../shared/ipc/gateway';

type StepUiStatus = 'pending' | 'running' | 'done' | 'failed';

const STEP_MESSAGE_KEY: Record<EmbeddedSetupStep, string> = {
  CREATE_DATA_DIRECTORY: 'createDataDirectory',
  INITIALIZE_DATABASE: 'initializeDatabase',
  WRITE_CONFIGURATION: 'writeConfiguration',
  START_DATABASE: 'startDatabase',
  CREATE_ROLES: 'createRoles',
  CREATE_DATABASE: 'createDatabase',
  RUN_MIGRATIONS: 'runMigrations',
  WRITE_CONFIG_FILE: 'writeConfigFile',
  VERIFY_CONNECTION: 'verifyConnection',
};

function stepLabelKey(step: EmbeddedSetupStep): MessageKey {
  return `embeddedSetup.step.${STEP_MESSAGE_KEY[step]}` as MessageKey;
}

function freshStatuses(): Record<EmbeddedSetupStep, StepUiStatus> {
  return Object.fromEntries(
    EMBEDDED_SETUP_STEPS.map((step) => [step, 'pending' as StepUiStatus]),
  ) as Record<EmbeddedSetupStep, StepUiStatus>;
}

export function EmbeddedSetupScreen() {
  const { t } = useI18n();
  const [started, setStarted] = useState(false);
  const [statuses, setStatuses] = useState<Record<EmbeddedSetupStep, StepUiStatus>>(freshStatuses);
  const [failure, setFailure] = useState<{ step: EmbeddedSetupStep; detail: string | null } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);

  const unlistenRef = useRef<null | (() => void)>(null);

  useEffect(() => {
    let active = true;
    void listen<EmbeddedSetupProgress>(EMBEDDED_SETUP_PROGRESS_EVENT, (event) => {
      if (!active) return;
      const { step, status, detail } = event.payload;
      setStatuses((prev) => ({
        ...prev,
        [step]: status === 'RUNNING' ? 'running' : status === 'DONE' ? 'done' : 'failed',
      }));
      if (status === 'FAILED') {
        setFailure({ step, detail });
      }
    }).then((unlisten) => {
      if (active) {
        unlistenRef.current = unlisten;
      } else {
        // The effect was already torn down by the time the listener
        // attached (fast unmount); do not leak the subscription.
        unlisten();
      }
    });
    return () => {
      active = false;
      unlistenRef.current?.();
      unlistenRef.current = null;
    };
  }, []);

  const handleStart = useCallback(() => {
    setStarted(true);
    setFailure(null);
    setCopied(false);
    setStatuses(freshStatuses());
    void runEmbeddedSetup().catch(() => {
      // The command itself could not even be dispatched (distinct from a
      // step failure, which arrives as a progress event) — surface it the
      // same way so the screen never looks silently frozen.
      setFailure({ step: 'CREATE_DATA_DIRECTORY', detail: null });
    });
  }, []);

  const handleCopyDetails = useCallback(() => {
    if (!failure) return;
    const label = t(stepLabelKey(failure.step));
    const text = `${label}: ${failure.detail ?? ''}`;
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        // Best-effort only: clipboard access can be denied by the OS.
      });
  }, [failure, t]);

  return (
    <div className="sk-centered">
      <div
        className="sk-card"
        role="region"
        aria-labelledby="embedded-setup-title"
        data-testid="embedded-setup-screen"
      >
        <h1 id="embedded-setup-title">{t('embeddedSetup.title')}</h1>
        <p>{t('embeddedSetup.body')}</p>

        {!started ? (
          <Button onClick={handleStart} data-testid="embedded-setup-start">
            {t('embeddedSetup.start')}
          </Button>
        ) : (
          <ul className="sk-list" data-testid="embedded-setup-steps">
            {EMBEDDED_SETUP_STEPS.map((step) => {
              const status = statuses[step];
              return (
                <li key={step} data-testid={`embedded-setup-step-${step}`} data-status={status}>
                  <span aria-hidden="true">
                    {status === 'done'
                      ? '✓'
                      : status === 'failed'
                        ? '✗'
                        : status === 'running'
                          ? '…'
                          : '○'}
                  </span>{' '}
                  <span>{t(stepLabelKey(step))}</span>
                </li>
              );
            })}
          </ul>
        )}

        {failure ? (
          <Banner tone="error" testId="embedded-setup-failure">
            <p>{t('embeddedSetup.failureBody', { step: t(stepLabelKey(failure.step)) })}</p>
            {failure.detail ? (
              <details className="sk-muted" data-testid="embedded-setup-failure-details">
                <summary>{t('backend.unavailable.technicalDetails')}</summary>
                <p>{failure.detail}</p>
              </details>
            ) : null}
            <div className="sk-modal__actions">
              <Button
                type="button"
                variant="secondary"
                onClick={handleCopyDetails}
                data-testid="embedded-setup-copy-details"
              >
                {copied ? t('embeddedSetup.copied') : t('embeddedSetup.copyDetails')}
              </Button>
              <Button type="button" onClick={handleStart} data-testid="embedded-setup-retry">
                {t('common.retry')}
              </Button>
            </div>
          </Banner>
        ) : null}
      </div>
    </div>
  );
}
