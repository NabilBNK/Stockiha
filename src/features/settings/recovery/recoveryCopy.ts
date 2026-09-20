import type { Locale } from '../../../shared/i18n';
import type { MessageKey } from '../../../shared/i18n/locales';
import type { BackupKind, SchemaVerdict } from '../../../shared/ipc/recoveryDto';

type Translate = (key: MessageKey) => string;

let requestSequence = 0;

export function nextRequestId(
  operation: 'create' | 'validate' | 'restore' | 'copy' | 'live-restore',
): string {
  requestSequence += 1;
  return `backup-${operation}-${Date.now()}-${requestSequence}`;
}

export function formatDateTime(iso: string, locale: Locale): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
}

/** Bytes formatted as B/KB/MB/GB with one decimal place (plan §H4-06). */
export function formatBytes(bytes: number, locale: Locale): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const formatted = unitIndex === 0
    ? new Intl.NumberFormat(locale).format(value)
    : new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(value);
  return `${formatted} ${units[unitIndex]}`;
}

export function kindLabel(kind: BackupKind | string | undefined, t: Translate): string {
  switch (kind) {
    case 'MANUAL':
      return t('recovery.kindManual');
    case 'DAILY':
      return t('recovery.kindDaily');
    case 'PRE_UPDATE':
      return t('recovery.kindPreUpdate');
    case 'PRE_RESTORE':
      return t('recovery.kindPreRestore');
    default:
      return t('recovery.kindUnknown');
  }
}

export function verdictLabel(verdict: SchemaVerdict | string | undefined, t: Translate): string {
  switch (verdict) {
    case 'SAME':
      return t('recovery.verdictSame');
    case 'OLDER':
      return t('recovery.verdictOlder');
    case 'NEWER':
      return t('recovery.verdictNewer');
    default:
      return t('recovery.verdictUnknown');
  }
}

export function compatibilityLabel(compatible: boolean, t: Translate): string {
  return compatible ? t('recovery.compatible') : t('recovery.incompatible');
}

/** A backup older than this is flagged on the status line (WS-H-3). */
const STALE_BACKUP_MS = 3 * 24 * 60 * 60 * 1000;

export type StatusTone = 'success' | 'warning' | 'error';

/**
 * WS-H-3 status line: warning when no backup exists or the last one is older
 * than three days; error when the most recent attempt failed after the last
 * success.
 */
export function describeStatus(
  status: { lastSuccessAt: string | null; lastFailureAt: string | null },
  now: number,
): { tone: StatusTone; failed: boolean; stale: boolean } {
  const successAt = status.lastSuccessAt ? new Date(status.lastSuccessAt).getTime() : null;
  const failureAt = status.lastFailureAt ? new Date(status.lastFailureAt).getTime() : null;
  const failed = failureAt !== null && (successAt === null || failureAt > successAt);
  const stale = successAt === null || now - successAt > STALE_BACKUP_MS;
  if (failed) return { tone: 'error', failed, stale };
  if (stale) return { tone: 'warning', failed, stale };
  return { tone: 'success', failed, stale };
}
