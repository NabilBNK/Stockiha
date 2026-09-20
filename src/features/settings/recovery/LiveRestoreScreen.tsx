/**
 * WS-H-5 — the restore takeover screen. Rendered by `AppRouter` in place of
 * everything else the moment a `TakeoverRequest` exists (no navigation, no
 * logout, nothing else) and stays up until the app restarts (success) or
 * the operator clicks "Restart Stockiha" (every other outcome).
 *
 * Modelled directly on `DatabaseUpgradeScreen`: subscribes to both the
 * progress and outcome events, THEN invokes the restore command — never
 * the other way around, since an event emitted before `listen` resolves is
 * lost. On success the Rust side stops the embedded server and restarts
 * the app itself; this screen never needs to render a final "done" state
 * for that path, the window reloads out from under it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';

import { Banner, Button } from '../../../shared/components';
import { useI18n, type MessageKey } from '../../../shared/i18n';
import { APP_VERSION_MARKER } from '../../../shared/version';
import {
  restartAfterRecovery,
  restoreBackupFreshInstall,
  restoreBackupLive,
} from '../../../shared/ipc/recoveryGateway';
import {
  RECOVERY_RESTORE_OUTCOME_EVENT,
  RECOVERY_RESTORE_PROGRESS_EVENT,
  RESTORE_STEPS,
  type RestoreOutcomeEvent,
  type RestoreProgress,
  type RestoreStep,
} from '../../../shared/ipc/recoveryDto';
import type { TakeoverRequest } from './RecoveryTakeoverContext';

type StepUiStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

const STEP_MESSAGE_KEY: Partial<Record<RestoreStep, string>> = {
  VALIDATE_BACKUP: 'validateBackup',
  PREFLIGHT: 'preflight',
  TEST_RESTORE: 'testRestore',
  SAFETY_BACKUP: 'safetyBackup',
  STOP_CONNECTIONS: 'stopConnections',
  REPLACE_DATA: 'replaceData',
  UPDATE_SCHEMA: 'updateSchema',
  VERIFY: 'verify',
  RESTORE_FILES: 'restoreFiles',
  RECORD: 'record',
  ROLLBACK: 'rollback',
};

// RESTART is never a checklist row: its own progress is the SUCCEEDED
// banner ("Stockiha is restarting…").
const CHECKLIST_STEPS: RestoreStep[] = RESTORE_STEPS.filter((step) => step !== 'RESTART');

function stepLabelKey(step: RestoreStep): MessageKey {
  return `recovery.restoreStep.${STEP_MESSAGE_KEY[step]}` as MessageKey;
}

function freshStatuses(): Record<RestoreStep, StepUiStatus> {
  return Object.fromEntries(RESTORE_STEPS.map((step) => [step, 'pending' as StepUiStatus])) as Record<
    RestoreStep,
    StepUiStatus
  >;
}

interface Props {
  request: TakeoverRequest;
}

export function LiveRestoreScreen({ request }: Props) {
  const { t } = useI18n();
  const [statuses, setStatuses] = useState<Record<RestoreStep, StepUiStatus>>(freshStatuses);
  const [rollbackTouched, setRollbackTouched] = useState(false);
  const [outcome, setOutcome] = useState<RestoreOutcomeEvent | null>(null);
  const [dispatchFailed, setDispatchFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  const progressUnlistenRef = useRef<null | (() => void)>(null);
  const outcomeUnlistenRef = useRef<null | (() => void)>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    let active = true;

    void listen<RestoreProgress>(RECOVERY_RESTORE_PROGRESS_EVENT, (event) => {
      if (!active) return;
      const { step, status } = event.payload;
      if (step === 'ROLLBACK') setRollbackTouched(true);
      setStatuses((prev) => ({
        ...prev,
        [step]:
          status === 'RUNNING'
            ? 'running'
            : status === 'DONE'
              ? 'done'
              : status === 'SKIPPED'
                ? 'skipped'
                : 'failed',
      }));
    }).then((unlisten) => {
      if (active) {
        progressUnlistenRef.current = unlisten;
      } else {
        unlisten();
      }
    });

    void listen<RestoreOutcomeEvent>(RECOVERY_RESTORE_OUTCOME_EVENT, (event) => {
      if (!active) return;
      setOutcome(event.payload);
    }).then((unlisten) => {
      if (active) {
        outcomeUnlistenRef.current = unlisten;
      } else {
        unlisten();
      }
    });

    // React StrictMode double-mounts effects in development; a real restore
    // must only ever be started once.
    if (!startedRef.current) {
      startedRef.current = true;
      const invocation =
        request.kind === 'LIVE'
          ? restoreBackupLive(request.sessionToken, {
              requestId: request.requestId,
              bundlePath: request.bundlePath,
              confirmationText: request.confirmationText,
            })
          : restoreBackupFreshInstall({ bundlePath: request.bundlePath });
      void invocation.catch(() => {
        if (active) setDispatchFailed(true);
      });
    }

    return () => {
      active = false;
      progressUnlistenRef.current?.();
      progressUnlistenRef.current = null;
      outcomeUnlistenRef.current?.();
      outcomeUnlistenRef.current = null;
    };
  }, []);

  const handleRestart = useCallback(() => {
    void restartAfterRecovery();
  }, []);

  const handleCopyDetails = useCallback(() => {
    if (!outcome || outcome.outcome !== 'ROLLBACK_FAILED') return;
    const lines = [
      `outcome: ${outcome.outcome}`,
      `errorCode: ${outcome.errorCode}`,
      `safetyBundlePath: ${outcome.safetyBundlePath ?? ''}`,
      `logPath: ${outcome.logPath}`,
      `version: ${APP_VERSION_MARKER}`,
    ];
    void navigator.clipboard
      .writeText(lines.join('\n'))
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        // Best-effort only: clipboard access can be denied by the OS.
      });
  }, [outcome]);

  return (
    <div className="sk-centered">
      <div
        className="sk-card"
        role="region"
        aria-labelledby="live-restore-title"
        data-testid="live-restore-screen"
      >
        <h1 id="live-restore-title">{t('recovery.restoreConfirmTitle')}</h1>
        <div
          className="sk-muted"
          style={{ fontSize: '0.8rem', fontWeight: 500, marginBlock: '2px 8px' }}
        >
          [ version = {APP_VERSION_MARKER} ]
        </div>

        {dispatchFailed ? (
          <>
            <Banner tone="error">{t('recovery.takeoverDidNotStart')}</Banner>
            <div className="sk-modal__actions">
              <Button type="button" onClick={handleRestart}>
                {t('recovery.restartButton')}
              </Button>
            </div>
          </>
        ) : (
          <ul className="sk-list" data-testid="live-restore-steps">
            {CHECKLIST_STEPS.filter((step) => step !== 'ROLLBACK' || rollbackTouched).map((step) => {
              const status = statuses[step];
              return (
                <li key={step} data-testid={`live-restore-step-${step}`} data-status={status}>
                  <span aria-hidden="true">
                    {status === 'done'
                      ? '✓'
                      : status === 'failed'
                        ? '✗'
                        : status === 'running'
                          ? '…'
                          : status === 'skipped'
                            ? '–'
                            : '○'}
                  </span>{' '}
                  <span>
                    {t(stepLabelKey(step))}
                    {status === 'skipped' ? ` (${t('recovery.stepNotNeeded')})` : ''}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {outcome ? (
          <OutcomeBanner outcome={outcome} onRestart={handleRestart} onCopy={handleCopyDetails} copied={copied} />
        ) : null}
      </div>
    </div>
  );
}

function OutcomeBanner({
  outcome,
  onRestart,
  onCopy,
  copied,
}: {
  outcome: RestoreOutcomeEvent;
  onRestart: () => void;
  onCopy: () => void;
  copied: boolean;
}) {
  const { t } = useI18n();

  if (outcome.outcome === 'SUCCEEDED') {
    return (
      <Banner tone="success" testId="live-restore-outcome">
        <p>
          {t('recovery.takeoverSucceeded')}
          {outcome.migratedForward ? t('recovery.takeoverSucceededMigrated') : ''}
        </p>
      </Banner>
    );
  }

  if (outcome.outcome === 'ABORTED_BEFORE_CHANGE') {
    return (
      <Banner tone="warning" testId="live-restore-outcome">
        <p>{t('recovery.takeoverAbortedTitle')}</p>
        <div className="sk-modal__actions">
          <Button type="button" onClick={onRestart}>
            {t('recovery.restartButton')}
          </Button>
        </div>
      </Banner>
    );
  }

  if (outcome.outcome === 'ROLLED_BACK') {
    return (
      <Banner tone="warning" testId="live-restore-outcome">
        <p>{t('recovery.takeoverRolledBackTitle')}</p>
        {outcome.safetyBundleIdentifier ? (
          <p>{t('recovery.takeoverRolledBackSafety', { id: outcome.safetyBundleIdentifier })}</p>
        ) : null}
        <div className="sk-modal__actions">
          <Button type="button" onClick={onRestart}>
            {t('recovery.restartButton')}
          </Button>
        </div>
      </Banner>
    );
  }

  return (
    <Banner tone="error" testId="live-restore-outcome">
      <p>{t('recovery.takeoverRollbackFailedTitle')}</p>
      <div className="sk-details-grid">
        <div>
          <dt>errorCode</dt>
          <dd>{outcome.errorCode}</dd>
        </div>
        <div>
          <dt>safetyBundlePath</dt>
          <dd>{outcome.safetyBundlePath ?? '—'}</dd>
        </div>
        <div>
          <dt>logPath</dt>
          <dd>{outcome.logPath}</dd>
        </div>
      </div>
      <div className="sk-modal__actions">
        <Button type="button" variant="secondary" onClick={onCopy}>
          {copied ? t('embeddedSetup.copied') : t('embeddedSetup.copyDetails')}
        </Button>
        <Button type="button" onClick={onRestart}>
          {t('recovery.restartButton')}
        </Button>
      </div>
    </Banner>
  );
}
