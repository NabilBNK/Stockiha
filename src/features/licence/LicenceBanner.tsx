/**
 * WS-K-7 — the licence banner (plan §7.3). Rendered at the top of
 * `AuthenticatedApp` (above `db-config-permission-warning`) and on
 * `LoginScreen`, above the form. Renders nothing when the status is
 * `null`, `ACTIVE`, or `DEVELOPER`.
 */
import { Banner, Button } from '../../shared/components';
import { useI18n } from '../../shared/i18n';
import { useLicence } from '../../shared/licence/LicenceContext';
import { LICENCE_STATUS_LABEL_KEYS } from '../../shared/licence/licenceCopy';

const READ_ONLY_STATUSES = new Set([
  'EXPIRED',
  'GRACE_OVER',
  'INVALID',
  'WRONG_MACHINE',
  'MACHINE_UNAVAILABLE',
]);

export function LicenceBanner({
  onOpenLicence,
  variant = 'app',
}: {
  onOpenLicence?: () => void;
  variant?: 'app' | 'login';
}) {
  const { status } = useLicence();
  const { t } = useI18n();

  if (!status || status.status === 'ACTIVE' || status.status === 'DEVELOPER') {
    return null;
  }

  let tone: 'warning' | 'error' = 'warning';
  let testId = 'licence-banner-readonly';
  let body: React.ReactNode;

  if (status.status === 'EXPIRING_SOON') {
    testId = 'licence-banner-expiring';
    body = <p>{t('licence.bannerExpiring', { days: status.days_left ?? 0 })}</p>;
  } else if (status.status === 'GRACE') {
    testId = 'licence-banner-grace';
    body = <p>{t('licence.bannerGrace', { days: status.grace_days_left ?? 0 })}</p>;
  } else if (status.status === 'CLOCK_ROLLBACK') {
    tone = 'error';
    testId = 'licence-banner-clock';
    body = <p>{t('licence.bannerClock')}</p>;
  } else if (READ_ONLY_STATUSES.has(status.status)) {
    tone = 'error';
    testId = 'licence-banner-readonly';
    body = (
      <>
        <p>{t('licence.bannerReadOnly')}</p>
        <p>{t(LICENCE_STATUS_LABEL_KEYS[status.status])}</p>
      </>
    );
  } else {
    return null;
  }

  return (
    <Banner tone={tone} testId={testId}>
      {body}
      {variant === 'login' ? (
        <p>{t('licence.signInToActivate')}</p>
      ) : (
        <Button type="button" onClick={onOpenLicence}>
          {t('licence.open')}
        </Button>
      )}
    </Banner>
  );
}
