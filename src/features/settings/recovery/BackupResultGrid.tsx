import { useI18n } from '../../../shared/i18n';
import type { OperatorBackupValidationResult } from '../../../shared/ipc/recoveryDto';
import { compatibilityLabel, kindLabel } from './recoveryCopy';

export function BackupResultGrid({ result }: { result: OperatorBackupValidationResult }) {
  const { locale, t } = useI18n();
  return (
    <dl className="sk-details-grid" data-testid="backup-result" style={{ marginTop: '20px' }}>
      <div><dt>{t('recovery.bundle')}</dt><dd>{result.bundleIdentifier}</dd></div>
      {/* WS-H-3 (R5): the application version is informational; only a
          mismatch is worth a label. */}
      <div>
        <dt>{t('recovery.application')}</dt>
        <dd>
          {result.applicationCompatible
            ? result.applicationVersion
            : `${result.applicationVersion} · ${t('recovery.incompatible')}`}
        </dd>
      </div>
      <div>
        <dt>{t('recovery.schema')}</dt>
        <dd>{result.schemaVersion} · {compatibilityLabel(result.schemaCompatible, t)}</dd>
      </div>
      <div>
        <dt>{t('recovery.postgres')}</dt>
        <dd>{result.postgresMajorVersion} · {compatibilityLabel(result.postgresCompatible, t)}</dd>
      </div>
      {result.backupKind !== undefined ? (
        <div><dt>{t('recovery.kind')}</dt><dd>{kindLabel(result.backupKind, t)}</dd></div>
      ) : null}
      {result.restorable !== undefined ? (
        <div>
          <dt>{t('recovery.restorable')}</dt>
          <dd>{result.restorable ? t('recovery.yes') : t('recovery.no')}</dd>
        </div>
      ) : null}
      <div><dt>{t('recovery.files')}</dt><dd>{new Intl.NumberFormat(locale).format(result.fileCount)}</dd></div>
      <div><dt>{t('recovery.bytes')}</dt><dd>{new Intl.NumberFormat(locale).format(result.totalBytes)}</dd></div>
    </dl>
  );
}
