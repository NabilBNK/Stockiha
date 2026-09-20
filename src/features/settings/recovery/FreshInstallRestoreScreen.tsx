import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';

import { Banner, Button } from '../../../shared/components';
import { codeForError, useErrorText } from '../../../shared/hooks/useErrorText';
import { useI18n } from '../../../shared/i18n';
import type { BackupListItem } from '../../../shared/ipc/recoveryDto';
import { inspectBackupForFreshInstall } from '../../../shared/ipc/recoveryGateway';
import { useRecoveryTakeover } from './RecoveryTakeoverContext';
import { formatBytes, formatDateTime, kindLabel, verdictLabel } from './recoveryCopy';

export function FreshInstallRestoreScreen({ onBack }: { onBack: () => void }) {
  const { locale, t } = useI18n();
  const errorText = useErrorText();
  const takeover = useRecoveryTakeover();

  const [picked, setPicked] = useState<{ path: string; item: BackupListItem } | null>(null);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function chooseFolder() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: t('recovery.freshInstallChoose'),
    });
    if (!selected || Array.isArray(selected)) return;
    setBusy(true);
    setError(null);
    setPicked(null);
    setChecked(false);
    try {
      const item = await inspectBackupForFreshInstall({ bundlePath: selected });
      setPicked({ path: selected, item });
    } catch (inspectError) {
      setError(
        codeForError(inspectError) === 'FRESH_RESTORE_NOT_ALLOWED'
          ? t('errors.freshRestoreNotAllowed')
          : errorText(inspectError),
      );
    } finally {
      setBusy(false);
    }
  }

  function startRestore() {
    if (!picked || !checked) return;
    takeover.begin({
      kind: 'FRESH_INSTALL',
      bundlePath: picked.path,
      bundleIdentifier: picked.item.bundleIdentifier,
    });
  }

  return (
    <div className="sk-centered">
      <div className="sk-card" role="region" aria-labelledby="fresh-install-restore-title">
        <h1 id="fresh-install-restore-title">{t('recovery.freshInstallTitle')}</h1>
        <p>{t('recovery.freshInstallBody')}</p>

        {error ? <Banner tone="error">{error}</Banner> : null}

        <div className="sk-modal__actions">
          <Button type="button" variant="secondary" loading={busy} onClick={() => void chooseFolder()}>
            {t('recovery.freshInstallChoose')}
          </Button>
        </div>

        {picked ? (
          <dl className="sk-details-grid" data-testid="fresh-install-picked-backup">
            <div>
              <dt>{t('recovery.colDate')}</dt>
              <dd>
                {picked.item.createdAtUtc
                  ? formatDateTime(picked.item.createdAtUtc, locale)
                  : picked.item.bundleIdentifier}
              </dd>
            </div>
            <div>
              <dt>{t('recovery.colType')}</dt>
              <dd>{kindLabel(picked.item.backupKind, t)}</dd>
            </div>
            <div>
              <dt>{t('recovery.colVersion')}</dt>
              <dd>{verdictLabel(picked.item.schemaVerdict, t)}</dd>
            </div>
            <div>
              <dt>{t('recovery.colSize')}</dt>
              <dd>{formatBytes(picked.item.totalBytes, locale)}</dd>
            </div>
          </dl>
        ) : null}

        {picked && !picked.item.restorable ? (
          <Banner tone="error">{t('errors.backupNotRestorable')}</Banner>
        ) : null}

        {picked && picked.item.restorable ? (
          <>
            <label className="sk-checkbox-row">
              <input
                type="checkbox"
                checked={checked}
                onChange={(event) => setChecked(event.target.checked)}
              />
              <span>{t('recovery.freshInstallCheckbox')}</span>
            </label>
            <div className="sk-modal__actions">
              <Button type="button" disabled={!checked} onClick={startRestore}>
                {t('recovery.freshInstallRestoreButton')}
              </Button>
            </div>
          </>
        ) : null}

        <div className="sk-modal__actions">
          <Button type="button" variant="secondary" onClick={onBack}>
            {t('recovery.back')}
          </Button>
        </div>
      </div>
    </div>
  );
}
