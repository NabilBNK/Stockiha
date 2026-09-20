import { open } from '@tauri-apps/plugin-dialog';

import { Banner, Button, TextField } from '../../../shared/components';
import { useI18n } from '../../../shared/i18n';
import type { BackupDestinationSetting } from '../../../shared/ipc/recoveryDto';

interface Props {
  destination: BackupDestinationSetting | null;
  busy: boolean;
  onChange: (path: string) => void;
}

export function DestinationBox({ destination, busy, onChange }: Props) {
  const { t } = useI18n();

  async function pick() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: t('recovery.browseDestinationTitle'),
    });
    if (!selected || Array.isArray(selected)) return;
    onChange(selected);
  }

  return (
    <div className="sk-recovery-box" data-testid="destination-box">
      <div className="sk-recovery-box__header">
        <div>
          <h3 className="sk-recovery-box__title">{t('recovery.destination')}</h3>
          <p className="sk-recovery-box__desc">{t('recovery.destinationHelp')}</p>
        </div>
      </div>
      <div className="sk-recovery-input-row">
        <TextField
          label={t('recovery.destination')}
          value={destination?.effectivePath ?? ''}
          placeholder={t('recovery.destinationNotSet')}
          readOnly
        />
        <Button
          type="button"
          variant="secondary"
          loading={busy}
          disabled={busy}
          onClick={() => void pick()}
        >
          {t('recovery.destinationChange')}
        </Button>
      </div>
      {destination?.isDefault ? (
        <small className="sk-field-help">{t('recovery.destinationDefaultHelp')}</small>
      ) : null}
      {destination && destination.available === false ? (
        <Banner tone="error">{t('errors.backupDestinationUnavailable')}</Banner>
      ) : null}
      {destination?.sameDriveWarning ? (
        <Banner tone="warning">{t('recovery.sameDriveWarning')}</Banner>
      ) : null}
    </div>
  );
}
