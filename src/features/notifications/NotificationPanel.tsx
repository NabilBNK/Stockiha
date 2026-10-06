// WS-I-3 STEP I3-06 — the dropdown list shown by the bell.

import type { AppView } from '../../app/AppShell';
import { useI18n } from '../../shared/i18n';
import { useLicence } from '../../shared/licence/LicenceContext';
import { LICENCE_STATUS_LABEL_KEYS } from '../../shared/licence/licenceCopy';
import { formatReportCopy, useReportCopy } from '../reports/common/reportCopy';
import { REPORTS_LAST_TAB_STORAGE_KEY } from '../reports/ReportsScreen';
import { useNotifications, type AnyNotificationId, type NotificationItem } from './NotificationsContext';


function titleFor(id: AnyNotificationId, copy: Record<string, string>, t: ReturnType<typeof useI18n>['t']): string {
  switch (id) {
    case 'OUT_OF_STOCK':
      return copy.notifOutOfStockTitle;
    case 'LOW_STOCK':
      return copy.notifLowStockTitle;
    case 'OVERDUE_DEBTS':
      return copy.notifOverdueDebtsTitle;
    case 'CREDIT_LIMIT_EXCEEDED':
      return copy.notifCreditLimitTitle;
    case 'MARGIN_ALERTS_7D':
      return copy.notifMarginAlertsTitle;
    case 'SLOW_MOVERS_90D':
      return copy.notifSlowMoversTitle;
    case 'CASH_SESSION_LONG_OPEN':
      return copy.notifCashSessionTitle;
    case 'BACKUP_OVERDUE':
      return copy.notifBackupTitle;
    case 'LICENCE_GRACE':
      return t(LICENCE_STATUS_LABEL_KEYS.GRACE);
    case 'LICENCE_EXPIRING':
      return t(LICENCE_STATUS_LABEL_KEYS.EXPIRING_SOON);
    case 'LICENCE_READ_ONLY':
      return t('licence.title');
    default:
      return id;
  }
}

function detailFor(
  item: NotificationItem,
  copy: Record<string, string>,
  t: ReturnType<typeof useI18n>['t'],
  licenceStatus: ReturnType<typeof useLicence>['status'],
): string {
  switch (item.id) {
    case 'LICENCE_GRACE':
      return t('licence.bannerGrace', { days: licenceStatus?.grace_days_left ?? 0 });
    case 'LICENCE_EXPIRING':
      return t('licence.bannerExpiring', { days: licenceStatus?.days_left ?? 0 });
    case 'LICENCE_READ_ONLY':
      return t('licence.bannerReadOnly');
    case 'OUT_OF_STOCK':
      return formatReportCopy(copy.notifOutOfStockDetail, { count: String(item.count ?? 0) });
    case 'LOW_STOCK':
      return formatReportCopy(copy.notifLowStockDetail, { count: String(item.count ?? 0) });
    case 'OVERDUE_DEBTS':
      return formatReportCopy(copy.notifOverdueDebtsDetail, {
        count: String(item.count ?? 0),
        amount: item.amount ?? '0',
      });
    case 'CREDIT_LIMIT_EXCEEDED':
      return formatReportCopy(copy.notifCreditLimitDetail, { count: String(item.count ?? 0) });
    case 'MARGIN_ALERTS_7D':
      return formatReportCopy(copy.notifMarginAlertsDetail, { count: String(item.count ?? 0) });
    case 'SLOW_MOVERS_90D':
      return formatReportCopy(copy.notifSlowMoversDetail, {
        count: String(item.count ?? 0),
        amount: item.amount ?? '0',
      });
    case 'CASH_SESSION_LONG_OPEN':
      return formatReportCopy(copy.notifCashSessionDetail, { hours: String(item.hours ?? 0) });
    case 'BACKUP_OVERDUE':
      return item.last_success_at
        ? formatReportCopy(copy.notifBackupDetailDate, { date: item.last_success_at })
        : copy.notifBackupDetailNever;
    default:
      return '';
  }
}

function navigateToSubReport(tab: string, sub: string, setView: (v: AppView) => void) {
  try {
    window.sessionStorage.setItem(REPORTS_LAST_TAB_STORAGE_KEY, `${tab}/${sub}`);
  } catch {
    // Best effort only.
  }
  setView('reports');
}

function scrollToLicenceCard() {
  window.requestAnimationFrame(() => {
    document.getElementById('licence-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function handleAction(id: AnyNotificationId, setView: (v: AppView) => void) {
  switch (id) {
    case 'OUT_OF_STOCK':
    case 'LOW_STOCK':
      navigateToSubReport('stock', 'low-stock', setView);
      return;
    case 'OVERDUE_DEBTS':
    case 'CREDIT_LIMIT_EXCEEDED':
      navigateToSubReport('owed', 'receivables', setView);
      return;
    case 'MARGIN_ALERTS_7D':
      navigateToSubReport('sales', 'margin-alerts', setView);
      return;
    case 'SLOW_MOVERS_90D':
      navigateToSubReport('stock', 'slow-movers', setView);
      return;
    case 'CASH_SESSION_LONG_OPEN':
      setView('session');
      return;
    case 'BACKUP_OVERDUE':
      setView('settings');
      return;
    case 'LICENCE_GRACE':
    case 'LICENCE_EXPIRING':
    case 'LICENCE_READ_ONLY':
      setView('settings');
      scrollToLicenceCard();
      return;
    default:
      return;
  }
}

export function NotificationPanel({
  setView,
  onClose,
}: {
  setView: (v: AppView) => void;
  onClose: () => void;
}) {
  const copy = useReportCopy();
  const { t } = useI18n();
  const { status: licenceStatus } = useLicence();
  const { visible, dismiss } = useNotifications();

  return (
    <div className="sk-notification-panel" data-testid="notification-panel" role="menu">
      <div className="sk-notification-panel__header">
        <div className="sk-notification-panel__header-title">
          <span>{copy.notifications}</span>
          {visible.length > 0 && (
            <span className="sk-notification-panel__count">{visible.length}</span>
          )}
        </div>
        <button
          type="button"
          className="sk-notification-panel__close"
          onClick={onClose}
          aria-label="Close"
          title="Close"
        >
          ✕
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="sk-notification-panel__empty-state">
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{ opacity: 0.35, margin: '8px auto 4px auto', display: 'block' }}
          >
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
          </svg>
          <p className="sk-notification-panel__empty">{copy.noNotifications}</p>
        </div>
      ) : (
        <ul className="sk-notification-panel__list">
          {visible.map((item) => (
            <li
              key={item.id}
              className={`sk-notification-panel__row sk-notification-panel__row--${item.severity.toLowerCase()}`}
            >
              <span className={`sk-notification-panel__mark sk-notification-panel__mark--${item.severity.toLowerCase()}`}>
                {item.severity === 'CRITICAL' ? (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                ) : item.severity === 'WARNING' ? (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                ) : (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                )}
              </span>
              <span className="sk-notification-panel__copy">
                <strong>{titleFor(item.id, copy, t)}</strong>
                <span>{detailFor(item, copy, t, licenceStatus)}</span>
              </span>
              <span className="sk-notification-panel__actions">
                <button
                  type="button"
                  className="sk-btn sk-btn--primary sk-btn--sm"
                  data-testid={`notification-action-${item.id}`}
                  onClick={() => {
                    handleAction(item.id, setView);
                    onClose();
                  }}
                >
                  {copy.notifGoTo}
                </button>
                <button
                  type="button"
                  className="sk-btn sk-btn--secondary sk-btn--sm"
                  data-testid={`notification-dismiss-${item.id}`}
                  onClick={() => dismiss(item.id)}
                >
                  {copy.dismissToday}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
