/**
 * WS-K-7 — shared between `LicenceBanner` and `LicenceSettingsCard` so the
 * status label text can never drift between the two places it is shown.
 */
import type { MessageKey } from '../i18n/locales';
import type { LicenceStatusCode } from '../ipc/licenceDto';

export const LICENCE_STATUS_LABEL_KEYS: Record<LicenceStatusCode, MessageKey> = {
  DEVELOPER: 'licence.status.DEVELOPER',
  ACTIVE: 'licence.status.ACTIVE',
  EXPIRING_SOON: 'licence.status.EXPIRING_SOON',
  GRACE: 'licence.status.GRACE',
  GRACE_OVER: 'licence.status.GRACE_OVER',
  EXPIRED: 'licence.status.EXPIRED',
  INVALID: 'licence.status.INVALID',
  WRONG_MACHINE: 'licence.status.WRONG_MACHINE',
  CLOCK_ROLLBACK: 'licence.status.CLOCK_ROLLBACK',
  MACHINE_UNAVAILABLE: 'licence.status.MACHINE_UNAVAILABLE',
};
