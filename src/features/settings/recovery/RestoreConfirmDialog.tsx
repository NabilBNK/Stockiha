import { useState } from 'react';

import { Banner, Button } from '../../../shared/components';
import { useI18n } from '../../../shared/i18n';
import { useSession } from '../../../shared/session/SessionContext';
import type { BackupListItem } from '../../../shared/ipc/recoveryDto';
import { formatDateTime, kindLabel } from './recoveryCopy';

const CONFIRMATION_WORD = 'RESTORE';

interface Props {
  item: BackupListItem;
  onConfirm: (confirmationText: string) => void;
  onCancel: () => void;
  busy?: boolean;
}

export function RestoreConfirmDialog({ item, onConfirm, onCancel, busy = false }: Props) {
  const { locale, t } = useI18n();
  const { activeCashSession } = useSession();
  const [checked, setChecked] = useState(false);
  const [typedWord, setTypedWord] = useState('');

  const dateLabel = item.createdAtUtc ? formatDateTime(item.createdAtUtc, locale) : item.bundleIdentifier;
  const cashSessionOpen = activeCashSession !== null;
  const canConfirm = !busy && !cashSessionOpen && checked && typedWord.trim() === CONFIRMATION_WORD;

  return (
    <div className="sk-modal__backdrop" role="presentation" onClick={onCancel}>
      <div
        className="sk-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('recovery.restoreConfirmTitle')}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="sk-modal__title">{t('recovery.restoreConfirmTitle')}</h2>
        <div className="sk-modal__body">
          <p>
            {t('recovery.bundle')}: {dateLabel} · {kindLabel(item.backupKind, t)}
          </p>
          <Banner tone="warning">{t('recovery.restoreConfirmWarning', { date: dateLabel })}</Banner>
          {item.schemaVerdict === 'OLDER' ? (
            <Banner tone="info">{t('recovery.restoreConfirmOlderNote')}</Banner>
          ) : null}
          {cashSessionOpen ? (
            <Banner tone="error">{t('recovery.restoreConfirmCashSessionOpen')}</Banner>
          ) : null}

          <label className="sk-checkbox-row">
            <input
              type="checkbox"
              checked={checked}
              disabled={busy || cashSessionOpen}
              onChange={(event) => setChecked(event.target.checked)}
            />
            <span>{t('recovery.restoreConfirmCheckbox')}</span>
          </label>

          <div className="sk-field">
            <label className="sk-field__label" htmlFor="restore-confirmation-word">
              {t('recovery.restoreConfirmWordLabel')}
            </label>
            <input
              id="restore-confirmation-word"
              className="sk-field__input"
              value={typedWord}
              disabled={busy || cashSessionOpen}
              onChange={(event) => setTypedWord(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </div>
        <div className="sk-modal__actions">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="danger"
            loading={busy}
            disabled={!canConfirm}
            onClick={() => onConfirm(typedWord.trim())}
          >
            {t('recovery.restoreConfirmButton')}
          </Button>
        </div>
      </div>
    </div>
  );
}
