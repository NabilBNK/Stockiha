import { useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';

import { Banner, Button, ConfirmDialog } from '../../shared/components';
import { codeForError, useErrorText } from '../../shared/hooks/useErrorText';
import { useI18n } from '../../shared/i18n';
import type {
  BackupDestinationSetting,
  BackupListItem,
  BackupStatus,
  OperatorBackupValidationResult,
  OperatorRestoreVerificationResult,
  RecoveryCapabilities,
} from '../../shared/ipc/recoveryDto';
import {
  copyBackupTo,
  createOperatorBackup,
  getBackupDestinationSetting,
  getBackupStatus,
  getRecoveryCapabilities,
  getRestoreVerificationSetting,
  listBackups,
  updateBackupDestinationSetting,
  updateRestoreVerificationSetting,
  validateOperatorBackup,
  verifyOperatorBackupRestore,
} from '../../shared/ipc/recoveryGateway';
import { BackupList, type BackupListBusy, type BackupRowAction } from './recovery/BackupList';
import { BackupResultGrid } from './recovery/BackupResultGrid';
import { BackupStatusLine } from './recovery/BackupStatusLine';
import { DestinationBox } from './recovery/DestinationBox';
import { formatDateTime, nextRequestId } from './recovery/recoveryCopy';
import { RestoreTestResultGrid } from './recovery/RestoreTestResultGrid';

interface Props {
  sessionToken: string;
}

type LastResult =
  | { kind: 'validate'; heading: string; result: OperatorBackupValidationResult }
  | { kind: 'test'; heading: string; result: OperatorRestoreVerificationResult }
  | null;

export function RecoverySettingsScreen({ sessionToken }: Props) {
  const { locale, t } = useI18n();
  const errorText = useErrorText();

  // `undefined` = still loading (render nothing); `null` = the user may not
  // see this screen at all (no capability, or the call failed) (WS-H-3).
  const [capabilities, setCapabilities] = useState<RecoveryCapabilities | null | undefined>(
    undefined,
  );
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [statusRefresh, setStatusRefresh] = useState(0);
  const [destination, setDestination] = useState<BackupDestinationSetting | null>(null);
  const [restoreEnabled, setRestoreEnabled] = useState<boolean | null>(null);

  const [items, setItems] = useState<BackupListItem[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [listRefresh, setListRefresh] = useState(0);

  const [selected, setSelected] = useState<BackupListItem | null>(null);

  const [busy, setBusy] = useState<BackupListBusy | { action: 'create' | 'destination' | 'setting'; bundleIdentifier: null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [createResult, setCreateResult] = useState<OperatorBackupValidationResult | null>(null);
  const [lastResult, setLastResult] = useState<LastResult>(null);
  const [confirmingTest, setConfirmingTest] = useState<BackupListItem | null>(null);

  useEffect(() => {
    let active = true;
    void getRecoveryCapabilities(sessionToken)
      .then((loaded) => {
        if (active) setCapabilities(loaded);
      })
      .catch(() => {
        // A failed capabilities call (including SESSION_INVALID, handled by
        // the session layer) hides the screen rather than showing errors.
        if (active) setCapabilities(null);
      });
    return () => {
      active = false;
    };
  }, [sessionToken]);

  const mode = capabilities?.mode ?? null;
  const usable = capabilities !== null && capabilities !== undefined && mode !== 'UNAVAILABLE';
  const canCreate = usable && capabilities.canCreateBackup;
  const canValidate = usable && capabilities.canValidateBackup;
  const canVerify = usable && capabilities.canVerifyRestore;

  useEffect(() => {
    if (!canVerify) return;
    let active = true;
    void getRestoreVerificationSetting(sessionToken)
      .then((setting) => {
        if (active) setRestoreEnabled(setting.enabled);
      })
      .catch((settingError) => {
        if (active) setError(errorText(settingError));
      });
    return () => {
      active = false;
    };
  }, [canVerify, errorText, sessionToken]);

  useEffect(() => {
    if (!canCreate) return;
    let active = true;
    void getBackupDestinationSetting(sessionToken)
      .then((setting) => {
        if (active) setDestination(setting);
      })
      .catch((settingError) => {
        if (active) setError(errorText(settingError));
      });
    return () => {
      active = false;
    };
  }, [canCreate, errorText, sessionToken]);

  useEffect(() => {
    if (!canCreate) return;
    let active = true;
    void getBackupStatus(sessionToken)
      .then((loaded) => {
        if (active) setStatus(loaded);
      })
      .catch(() => {
        // The status line is informational; a failure just leaves it off.
        if (active) setStatus(null);
      });
    return () => {
      active = false;
    };
  }, [canCreate, sessionToken, statusRefresh]);

  useEffect(() => {
    if (!canValidate) return;
    let active = true;
    setListLoading(true);
    setListError(null);
    void listBackups(sessionToken)
      .then((response) => {
        if (!active) return;
        setItems(response.items);
      })
      .catch((listErrorValue) => {
        if (active) setListError(errorText(listErrorValue));
      })
      .finally(() => {
        if (active) setListLoading(false);
      });
    return () => {
      active = false;
    };
  }, [canValidate, errorText, sessionToken, listRefresh]);

  function resetMessages() {
    setError(null);
    setFeedback(null);
  }

  function refreshAfterChange() {
    setStatusRefresh((value) => value + 1);
    setListRefresh((value) => value + 1);
  }

  async function changeRestoreSetting(enabled: boolean) {
    if (busy || restoreEnabled === null) return;
    setBusy({ action: 'setting', bundleIdentifier: null });
    resetMessages();
    try {
      const updated = await updateRestoreVerificationSetting(sessionToken, enabled);
      setRestoreEnabled(updated.enabled);
      setFeedback(t('recovery.settingUpdated'));
    } catch (settingError) {
      setError(errorText(settingError));
    } finally {
      setBusy(null);
    }
  }

  async function changeDestination(path: string) {
    if (busy) return;
    setBusy({ action: 'destination', bundleIdentifier: null });
    resetMessages();
    try {
      await updateBackupDestinationSetting(sessionToken, { path });
      // Re-fetch: the effective path, default flag and same-drive warning
      // are computed by the backend, not by the setter's response.
      setDestination(await getBackupDestinationSetting(sessionToken));
      setFeedback(t('recovery.destinationUpdated'));
      refreshAfterChange();
    } catch (destinationError) {
      setError(errorText(destinationError));
    } finally {
      setBusy(null);
    }
  }

  async function createBackup() {
    if (busy) return;
    setBusy({ action: 'create', bundleIdentifier: null });
    resetMessages();
    setCreateResult(null);
    try {
      const created = await createOperatorBackup(sessionToken, {
        requestId: nextRequestId('create'),
      });
      setCreateResult(created);
      setFeedback(t('recovery.created'));
      refreshAfterChange();
    } catch (creationError) {
      setError(
        codeForError(creationError) === 'BACKUP_CREATION_FAILED'
          ? t('recovery.creationFailed')
          : errorText(creationError),
      );
    } finally {
      setBusy(null);
    }
  }

  function headingFor(item: BackupListItem): string {
    return item.createdAtUtc ? formatDateTime(item.createdAtUtc, locale) : item.bundleIdentifier;
  }

  async function checkItem(item: BackupListItem, action: BackupRowAction = 'check') {
    if (busy) return;
    setBusy({ bundleIdentifier: item.bundleIdentifier, action });
    resetMessages();
    try {
      const result = await validateOperatorBackup(sessionToken, {
        requestId: nextRequestId('validate'),
        bundlePath: item.path,
      });
      setLastResult({ kind: 'validate', heading: headingFor(item), result });
      setFeedback(t('recovery.valid'));
      return result;
    } catch (validationError) {
      setError(
        codeForError(validationError) === 'BACKUP_VALIDATION_FAILED'
          ? t('recovery.invalid')
          : errorText(validationError),
      );
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function runTest(item: BackupListItem) {
    setConfirmingTest(null);
    setBusy({ bundleIdentifier: item.bundleIdentifier, action: 'test' });
    resetMessages();
    try {
      const restored = await verifyOperatorBackupRestore(sessionToken, {
        requestId: nextRequestId('restore'),
        bundlePath: item.path,
        confirmed: true,
      });
      setLastResult({ kind: 'test', heading: headingFor(item), result: restored });
      setFeedback(t('recovery.restored'));
      refreshAfterChange();
    } catch (restoreError) {
      setError(
        codeForError(restoreError) === 'BACKUP_VALIDATION_FAILED'
          ? t('recovery.restoreFailed')
          : errorText(restoreError),
      );
    } finally {
      setBusy(null);
    }
  }

  async function copyItem(item: BackupListItem) {
    if (busy) return;
    const target = await open({
      directory: true,
      multiple: false,
      title: t('recovery.copyTargetTitle'),
    });
    if (!target || Array.isArray(target)) return;
    setBusy({ bundleIdentifier: item.bundleIdentifier, action: 'copy' });
    resetMessages();
    try {
      const copied = await copyBackupTo(sessionToken, {
        requestId: nextRequestId('copy'),
        bundlePath: item.path,
        targetDirectory: target,
      });
      setFeedback(t('recovery.copySuccess', { path: copied.copiedPath }));
    } catch (copyError) {
      setError(
        codeForError(copyError) === 'BACKUP_COPY_FAILED'
          ? t('recovery.copyFailed')
          : errorText(copyError),
      );
    } finally {
      setBusy(null);
    }
  }

  async function openOtherFolder() {
    if (busy) return;
    const picked = await open({
      directory: true,
      multiple: false,
      title: t('recovery.browseTitle'),
    });
    if (!picked || Array.isArray(picked)) return;
    setBusy({ bundleIdentifier: picked, action: 'check' });
    resetMessages();
    try {
      const result = await validateOperatorBackup(sessionToken, {
        requestId: nextRequestId('validate'),
        bundlePath: picked,
      });
      const item: BackupListItem = {
        bundleIdentifier: result.bundleIdentifier,
        path: picked,
        createdAtUtc: result.createdAtUtc ?? null,
        backupKind: result.backupKind ?? 'UNKNOWN',
        formatVersion: result.formatVersion ?? null,
        schemaVersion: result.schemaVersion,
        schemaVerdict: result.schemaVerdict ?? 'UNKNOWN',
        restorable: result.restorable ?? false,
        totalBytes: result.totalBytes,
        manifestReadable: true,
      };
      setSelected(item);
      setLastResult({ kind: 'validate', heading: headingFor(item), result });
      setFeedback(t('recovery.valid'));
    } catch (validationError) {
      setError(
        codeForError(validationError) === 'BACKUP_VALIDATION_FAILED'
          ? t('recovery.invalid')
          : errorText(validationError),
      );
    } finally {
      setBusy(null);
    }
  }

  // WS-H-3: nothing is rendered until the capabilities are known, and
  // nothing at all for a user without any recovery permission (cashier).
  if (capabilities === undefined) return null;
  if (mode === 'UNAVAILABLE') {
    return (
      <section className="sk-page sk-settings-page" aria-labelledby="recovery-settings-title">
        <div className="sk-settings-card">
          <div className="sk-settings-card__header">
            <div className="sk-settings-card__title-group">
              <h2 id="recovery-settings-title" className="sk-settings-card__title">{t('recovery.title')}</h2>
            </div>
          </div>
          <Banner tone="error">{t('errors.recoveryUnavailable')}</Banner>
        </div>
      </section>
    );
  }
  if (!canCreate && !canValidate && !canVerify && !capabilities?.canRestoreLive) return null;

  const busyBundleId = busy && 'bundleIdentifier' in busy ? busy.bundleIdentifier : null;
  const rowBusy: BackupListBusy | null =
    busy && busyBundleId ? { bundleIdentifier: busyBundleId, action: busy.action as BackupRowAction } : null;

  return (
    <section className="sk-page sk-settings-page" aria-labelledby="recovery-settings-title">
      <div className="sk-settings-card">
        <div className="sk-settings-card__header">
          <div className="sk-settings-card__title-group">
            <h2 id="recovery-settings-title" className="sk-settings-card__title">{t('recovery.title')}</h2>
            <p className="sk-settings-card__desc">{t('recovery.subtitle')}</p>
          </div>
        </div>

        {canCreate && status ? <BackupStatusLine status={status} /> : null}

        {error ? <Banner tone="error">{error}</Banner> : null}
        {feedback ? <Banner tone="success">{feedback}</Banner> : null}

        <div className="sk-recovery-section">
          {canCreate ? (
            <DestinationBox
              destination={destination}
              busy={busy?.action === 'destination'}
              onChange={(path) => void changeDestination(path)}
            />
          ) : null}

          {canCreate ? (
            <div className="sk-recovery-box">
              <div className="sk-recovery-box__header">
                <div>
                  <h3 className="sk-recovery-box__title">{t('recovery.create')}</h3>
                  <p className="sk-recovery-box__desc">{t('recovery.createHelp')}</p>
                </div>
                <Button
                  type="button"
                  loading={busy?.action === 'create'}
                  disabled={busy !== null}
                  onClick={() => void createBackup()}
                >
                  {t('recovery.create')}
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        {createResult ? <BackupResultGrid result={createResult} /> : null}
      </div>

      {canValidate ? (
        <div className="sk-settings-card">
          <BackupList
            testId="backup-list"
            title={t('recovery.listTitle')}
            items={items}
            loading={listLoading}
            error={listError}
            canCheck={canValidate}
            canTest={canVerify}
            testPolicyEnabled={restoreEnabled === true}
            canCopy={canCreate}
            busy={rowBusy}
            onCheck={(item) => void checkItem(item)}
            onTest={(item) => setConfirmingTest(item)}
            onCopy={(item) => void copyItem(item)}
          />

          <div className="sk-recovery-box">
            <Button
              type="button"
              variant="secondary"
              disabled={busy !== null}
              onClick={() => void openOtherFolder()}
            >
              {t('recovery.openOtherFolder')}
            </Button>
          </div>

          {selected ? (
            <BackupList
              testId="selected-backup-list"
              title={t('recovery.selectedBackup')}
              items={[selected]}
              loading={false}
              error={null}
              canCheck={canValidate}
              canTest={canVerify}
              testPolicyEnabled={restoreEnabled === true}
              canCopy={canCreate}
              busy={rowBusy}
              onCheck={(item) => void checkItem(item)}
              onTest={(item) => setConfirmingTest(item)}
              onCopy={(item) => void copyItem(item)}
            />
          ) : null}

          {lastResult ? (
            <div style={{ marginTop: '16px' }}>
              <h3 className="sk-recovery-box__title">{lastResult.heading}</h3>
              {lastResult.kind === 'validate' ? (
                <BackupResultGrid result={lastResult.result} />
              ) : (
                <RestoreTestResultGrid result={lastResult.result} />
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {canVerify ? (
        <div className="sk-settings-card" aria-labelledby="recovery-advanced-title">
          <div className="sk-settings-card__header">
            <div className="sk-settings-card__title-group">
              <h2 id="recovery-advanced-title" className="sk-settings-card__title">
                {t('recovery.advancedTitle')}
              </h2>
              <p className="sk-settings-card__desc">{t('recovery.recoveryBoundary')}</p>
            </div>
          </div>
          <fieldset className="sk-form">
            <div className="sk-field">
              <label className="sk-checkbox-row">
                <input
                  type="checkbox"
                  aria-label={t('recovery.setting')}
                  checked={restoreEnabled === true}
                  disabled={busy !== null}
                  onChange={(event) => void changeRestoreSetting(event.target.checked)}
                />
                <span>{t('recovery.setting')}</span>
              </label>
              <small className="sk-field-help">{t('recovery.settingHelp')}</small>
            </div>
          </fieldset>
        </div>
      ) : null}

      {confirmingTest ? (
        <ConfirmDialog
          title={t('recovery.testDialogTitle')}
          body={t('recovery.testDialogBody')}
          confirmLabel={t('recovery.testDialogConfirm')}
          cancelLabel={t('common.cancel')}
          onConfirm={() => void runTest(confirmingTest)}
          onCancel={() => setConfirmingTest(null)}
        />
      ) : null}
    </section>
  );
}
