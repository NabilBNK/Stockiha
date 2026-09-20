import { Banner, Button, Spinner } from '../../../shared/components';
import { useI18n } from '../../../shared/i18n';
import type { BackupListItem } from '../../../shared/ipc/recoveryDto';
import { formatBytes, formatDateTime, kindLabel, verdictLabel } from './recoveryCopy';

export type BackupRowAction = 'check' | 'test' | 'copy';

export interface BackupListBusy {
  bundleIdentifier: string;
  action: BackupRowAction;
}

interface Props {
  title: string;
  items: BackupListItem[];
  loading: boolean;
  error: string | null;
  canCheck: boolean;
  canTest: boolean;
  testPolicyEnabled: boolean;
  canCopy: boolean;
  busy: BackupListBusy | null;
  onCheck: (item: BackupListItem) => void;
  onTest: (item: BackupListItem) => void;
  onCopy: (item: BackupListItem) => void;
  emptyLabel?: string;
  testId?: string;
}

export function BackupList({
  title,
  items,
  loading,
  error,
  canCheck,
  canTest,
  testPolicyEnabled,
  canCopy,
  busy,
  onCheck,
  onTest,
  onCopy,
  emptyLabel,
  testId,
}: Props) {
  const { locale, t } = useI18n();
  const showTestNote = canTest && !testPolicyEnabled && items.length > 0;

  return (
    <div className="sk-recovery-box" data-testid={testId}>
      <div className="sk-recovery-box__header">
        <div>
          <h3 className="sk-recovery-box__title">{title}</h3>
        </div>
      </div>

      {error ? <Banner tone="error">{error}</Banner> : null}
      {loading ? <Spinner /> : null}

      {!loading && !error && items.length === 0 ? (
        <p className="sk-recovery-box__desc">{emptyLabel ?? t('recovery.listEmpty')}</p>
      ) : null}

      {!loading && items.length > 0 ? (
        <table className="sk-table" style={{ width: '100%', textAlign: 'start' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'start' }}>{t('recovery.colDate')}</th>
              <th style={{ textAlign: 'start' }}>{t('recovery.colType')}</th>
              <th style={{ textAlign: 'start' }}>{t('recovery.colSize')}</th>
              <th style={{ textAlign: 'start' }}>{t('recovery.colVersion')}</th>
              <th style={{ textAlign: 'start' }}>{t('recovery.colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const dateLabel = item.createdAtUtc
                ? formatDateTime(item.createdAtUtc, locale)
                : item.bundleIdentifier;
              const rowBusy = busy?.bundleIdentifier === item.bundleIdentifier ? busy.action : null;
              const disableRow = busy !== null;
              return (
                <tr key={item.path}>
                  <td>{dateLabel}</td>
                  <td>{kindLabel(item.backupKind, t)}</td>
                  <td>{formatBytes(item.totalBytes, locale)}</td>
                  <td>{verdictLabel(item.schemaVerdict, t)}</td>
                  <td>
                    <div className="sk-recovery-row-actions">
                      {canCheck ? (
                        <Button
                          type="button"
                          variant="secondary"
                          loading={rowBusy === 'check'}
                          disabled={disableRow}
                          aria-label={t('recovery.ariaCheckOf', { date: dateLabel })}
                          onClick={() => onCheck(item)}
                        >
                          {t('recovery.actionCheck')}
                        </Button>
                      ) : null}
                      {canTest && testPolicyEnabled ? (
                        <Button
                          type="button"
                          variant="secondary"
                          loading={rowBusy === 'test'}
                          disabled={disableRow}
                          aria-label={t('recovery.ariaTestOf', { date: dateLabel })}
                          onClick={() => onTest(item)}
                        >
                          {t('recovery.actionTest')}
                        </Button>
                      ) : null}
                      {canCopy ? (
                        <Button
                          type="button"
                          variant="secondary"
                          loading={rowBusy === 'copy'}
                          disabled={disableRow}
                          aria-label={t('recovery.ariaCopyOf', { date: dateLabel })}
                          onClick={() => onCopy(item)}
                        >
                          {t('recovery.actionCopyTo')}
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}

      {showTestNote ? <small className="sk-field-help">{t('recovery.testDisabledNote')}</small> : null}
    </div>
  );
}
