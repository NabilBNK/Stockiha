/**
 * WS-K-5 — safe automatic database upgrade screen.
 *
 * Shown by `AppRouter` in place of `BackendUnavailableScreen` specifically
 * when the diagnostic reports `code: 'OK'`, `schema.status ===
 * 'OLDER_THAN_BINARY'`, and `self_upgrade_available` — an embedded install
 * that can bring its own schema up to date, safely, itself.
 *
 * Unlike `EmbeddedSetupScreen`, there is no Start button: applying this
 * upgrade is not optional for the app to work at all, so it begins the
 * moment this screen mounts. The body copy says so explicitly, so the
 * operator understands why nothing asked for confirmation.
 *
 * Progress arrives live over `SAFE_UPGRADE_PROGRESS_EVENT` and is also
 * written to `upgrade.log` on the Rust side. On success the Rust command
 * restarts the app process itself, exactly like first-run setup — this
 * screen never needs to render a final "done" state, the window reloads out
 * from under it. On failure, `SAFE_UPGRADE_OUTCOME_EVENT` arrives exactly
 * once, and its three shapes get three different screens: the database was
 * never touched, it was rolled back to its exact prior state, or (the worst
 * case) rollback itself failed.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';

import { Banner, Button } from '../../shared/components';
import { useI18n, type MessageKey } from '../../shared/i18n';
import { APP_VERSION_MARKER } from '../../shared/version';
import {
  SAFE_UPGRADE_OUTCOME_EVENT,
  SAFE_UPGRADE_PROGRESS_EVENT,
  SAFE_UPGRADE_STEPS,
  runSafeDatabaseUpgrade,
  type SafeUpgradeOutcomeEvent,
  type SafeUpgradeProgress,
  type SafeUpgradeStep,
} from '../../shared/ipc/gateway';

type StepUiStatus = 'pending' | 'running' | 'done' | 'failed';

const STEP_MESSAGE_KEY: Record<SafeUpgradeStep, string> = {
  PREFLIGHT: 'preflight',
  BACKUP: 'backup',
  VERIFY_BACKUP: 'verifyBackup',
  MIGRATE: 'migrate',
  VERIFY_SCHEMA: 'verifySchema',
  ROLLBACK: 'rollback',
};

function stepLabelKey(step: SafeUpgradeStep): MessageKey {
  return `databaseUpgrade.step.${STEP_MESSAGE_KEY[step]}` as MessageKey;
}

function freshStatuses(): Record<SafeUpgradeStep, StepUiStatus> {
  return Object.fromEntries(
    SAFE_UPGRADE_STEPS.map((step) => [step, 'pending' as StepUiStatus]),
  ) as Record<SafeUpgradeStep, StepUiStatus>;
}

// A `ROLLBACK` step that never left `pending` is not a failure — it simply
// never had to run. Only steps that actually reported something are shown.
const VISIBLE_WHEN_PENDING: SafeUpgradeStep[] = [
  'PREFLIGHT',
  'BACKUP',
  'VERIFY_BACKUP',
  'MIGRATE',
  'VERIFY_SCHEMA',
];

export function DatabaseUpgradeScreen() {
  const { t } = useI18n();
  const [statuses, setStatuses] = useState<Record<SafeUpgradeStep, StepUiStatus>>(freshStatuses);
  const [rollbackTouched, setRollbackTouched] = useState(false);
  const [outcome, setOutcome] = useState<SafeUpgradeOutcomeEvent | null>(null);
  const [dispatchFailed, setDispatchFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  const progressUnlistenRef = useRef<null | (() => void)>(null);
  const outcomeUnlistenRef = useRef<null | (() => void)>(null);

  useEffect(() => {
    let active = true;

    void listen<SafeUpgradeProgress>(SAFE_UPGRADE_PROGRESS_EVENT, (event) => {
      if (!active) return;
      const { step, status } = event.payload;
      if (step === 'ROLLBACK') setRollbackTouched(true);
      setStatuses((prev) => ({
        ...prev,
        [step]: status === 'RUNNING' ? 'running' : status === 'DONE' ? 'done' : 'failed',
      }));
    }).then((unlisten) => {
      if (active) {
        progressUnlistenRef.current = unlisten;
      } else {
        unlisten();
      }
    });

    void listen<SafeUpgradeOutcomeEvent>(SAFE_UPGRADE_OUTCOME_EVENT, (event) => {
      if (!active) return;
      setOutcome(event.payload);
    }).then((unlisten) => {
      if (active) {
        outcomeUnlistenRef.current = unlisten;
      } else {
        unlisten();
      }
    });

    // No Start button: this is not optional, so it begins the moment the
    // screen is on screen.
    void runSafeDatabaseUpgrade().catch(() => {
      setDispatchFailed(true);
    });

    return () => {
      active = false;
      progressUnlistenRef.current?.();
      progressUnlistenRef.current = null;
      outcomeUnlistenRef.current?.();
      outcomeUnlistenRef.current = null;
    };
  }, []);

  const handleCopyDetails = useCallback(() => {
    if (!outcome) return;
    const lines = [`outcome: ${outcome.outcome}`, `reason: ${outcome.reason}`];
    if ('backup_path' in outcome && outcome.backup_path) {
      lines.push(`backup: ${outcome.backup_path}`);
    }
    if (outcome.outcome === 'ROLLBACK_FAILED') {
      lines.push(`rollback error: ${outcome.rollback_error}`);
    }
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
        aria-labelledby="database-upgrade-title"
        data-testid="database-upgrade-screen"
      >
        <h1 id="database-upgrade-title">{t('databaseUpgrade.title')}</h1>
        <div
          className="sk-muted"
          style={{ fontSize: '0.8rem', fontWeight: 500, marginBlock: '2px 8px' }}
          data-testid="database-upgrade-version"
        >
          [ version = {APP_VERSION_MARKER} ]
        </div>
        <p>{t('databaseUpgrade.body')}</p>

        {dispatchFailed ? (
          <Banner tone="error" testId="database-upgrade-dispatch-failed">
            {t('databaseUpgrade.dispatchFailed')}
          </Banner>
        ) : (
          <ul className="sk-list" data-testid="database-upgrade-steps">
            {SAFE_UPGRADE_STEPS.filter(
              (step) => step !== 'ROLLBACK' || rollbackTouched,
            ).map((step) => {
              const status = statuses[step];
              const shown = VISIBLE_WHEN_PENDING.includes(step) || status !== 'pending';
              if (!shown) return null;
              return (
                <li key={step} data-testid={`database-upgrade-step-${step}`} data-status={status}>
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

        {outcome ? <OutcomeBanner outcome={outcome} onCopy={handleCopyDetails} copied={copied} /> : null}
      </div>
    </div>
  );
}

function OutcomeBanner({
  outcome,
  onCopy,
  copied,
}: {
  outcome: SafeUpgradeOutcomeEvent;
  onCopy: () => void;
  copied: boolean;
}) {
  const { t } = useI18n();

  const headlineKey: MessageKey =
    outcome.outcome === 'ABORTED_BEFORE_MIGRATION'
      ? 'databaseUpgrade.outcome.abortedTitle'
      : outcome.outcome === 'ROLLED_BACK'
        ? 'databaseUpgrade.outcome.rolledBackTitle'
        : 'databaseUpgrade.outcome.rollbackFailedTitle';

  return (
    <Banner tone={outcome.outcome === 'ROLLBACK_FAILED' ? 'error' : 'warning'} testId="database-upgrade-outcome">
      <p>
        <strong>{t(headlineKey)}</strong>
      </p>
      {outcome.outcome === 'ROLLED_BACK' ? (
        <p>{t('databaseUpgrade.outcome.rolledBackBody')}</p>
      ) : null}
      {outcome.outcome === 'ABORTED_BEFORE_MIGRATION' ? (
        <p>{t('databaseUpgrade.outcome.abortedBody')}</p>
      ) : null}
      {outcome.outcome === 'ROLLBACK_FAILED' ? (
        <>
          <p>{t('databaseUpgrade.outcome.rollbackFailedBody')}</p>
          <p data-testid="database-upgrade-rollback-failed-backup-path">
            {t('databaseUpgrade.outcome.backupPathLabel', { path: outcome.backup_path })}
          </p>
        </>
      ) : null}
      <details className="sk-muted" data-testid="database-upgrade-outcome-details">
        <summary>{t('backend.unavailable.technicalDetails')}</summary>
        <p>{outcome.reason}</p>
        {'backup_path' in outcome && outcome.backup_path ? (
          <p>{t('databaseUpgrade.outcome.backupPathLabel', { path: outcome.backup_path })}</p>
        ) : null}
        {outcome.outcome === 'ROLLBACK_FAILED' ? <p>{outcome.rollback_error}</p> : null}
      </details>
      <div className="sk-modal__actions">
        <Button type="button" variant="secondary" onClick={onCopy} data-testid="database-upgrade-copy-details">
          {copied ? t('embeddedSetup.copied') : t('embeddedSetup.copyDetails')}
        </Button>
      </div>
    </Banner>
  );
}
