import { Banner } from '../../../shared/components';
import { useI18n } from '../../../shared/i18n';
import type { BackupStatus } from '../../../shared/ipc/recoveryDto';
import { describeStatus, formatDateTime } from './recoveryCopy';

export function BackupStatusLine({ status }: { status: BackupStatus }) {
  const { locale, t } = useI18n();
  const view = describeStatus(status, Date.now());
  return (
    <div data-testid="backup-status-line">
      <Banner tone={view.tone}>
        {status.lastSuccessAt
          ? t('recovery.lastBackup', { date: formatDateTime(status.lastSuccessAt, locale) })
          : t('recovery.noBackupYet')}
        {view.failed ? ` ${t('recovery.lastBackupFailed')}` : ''}
      </Banner>
    </div>
  );
}
