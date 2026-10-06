import { useI18n } from '../../../shared/i18n';
import type { OperatorBackupValidationResult } from '../../../shared/ipc/recoveryDto';
import { compatibilityLabel, kindLabel } from './recoveryCopy';

export function BackupResultGrid({ result }: { result: OperatorBackupValidationResult }) {
  const { locale, t } = useI18n();
  return (
    <div className="sk-backup-result-card" data-testid="backup-result">
      <div className="sk-backup-result-card__header">
        <div className="sk-backup-result-card__title-wrap">
          <span className="sk-backup-result-card__badge" aria-hidden="true">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            {t('recovery.valid')}
          </span>
          <h4 className="sk-backup-result-card__title">{t('recovery.selectedBackup')}</h4>
        </div>
      </div>
      <dl className="sk-details-grid">
        <div className="sk-details-grid__item sk-details-grid__item--wide">
          <dt>{t('recovery.bundle')}</dt>
          <dd>
            <code className="sk-backup-bundle-code">{result.bundleIdentifier}</code>
          </dd>
        </div>
        {/* WS-H-3 (R5): the application version is informational; only a
            mismatch is worth a label. */}
        <div className="sk-details-grid__item">
          <dt>{t('recovery.application')}</dt>
          <dd>
            {result.applicationCompatible
              ? result.applicationVersion
              : `${result.applicationVersion} · ${t('recovery.incompatible')}`}
          </dd>
        </div>
        <div className="sk-details-grid__item">
          <dt>{t('recovery.schema')}</dt>
          <dd>
            {result.schemaVersion} · {compatibilityLabel(result.schemaCompatible, t)}
          </dd>
        </div>
        <div className="sk-details-grid__item">
          <dt>{t('recovery.postgres')}</dt>
          <dd>
            {result.postgresMajorVersion} · {compatibilityLabel(result.postgresCompatible, t)}
          </dd>
        </div>
        {result.backupKind !== undefined ? (
          <div className="sk-details-grid__item">
            <dt>{t('recovery.kind')}</dt>
            <dd>{kindLabel(result.backupKind, t)}</dd>
          </div>
        ) : null}
        {result.restorable !== undefined ? (
          <div className="sk-details-grid__item">
            <dt>{t('recovery.restorable')}</dt>
            <dd>{result.restorable ? t('recovery.yes') : t('recovery.no')}</dd>
          </div>
        ) : null}
        <div className="sk-details-grid__item">
          <dt>{t('recovery.files')}</dt>
          <dd>{new Intl.NumberFormat(locale).format(result.fileCount)}</dd>
        </div>
        <div className="sk-details-grid__item">
          <dt>{t('recovery.bytes')}</dt>
          <dd>{new Intl.NumberFormat(locale).format(result.totalBytes)}</dd>
        </div>
      </dl>
    </div>
  );
}
