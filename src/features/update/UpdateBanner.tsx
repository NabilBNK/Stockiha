/**
 * WS-K-6 — the update notice. Optional updates are a small, dismissible
 * banner; forced updates are a persistent one with no way to make it go
 * away for good — but in both cases this is the ONLY thing this component
 * ever renders. It never wraps, gates, or replaces the rest of the screen:
 * a forced update sits above the dashboard/POS/whatever screen is active,
 * never instead of it (Owner ruling 2b).
 */
import { useState } from 'react';

import { Banner, Button } from '../../shared/components';
import { useI18n } from '../../shared/i18n';
import { useSession } from '../../shared/session/SessionContext';
import { useAppUpdate } from './useAppUpdate';

export interface UpdateBannerProps {
  cashSessionOpen: boolean;
}

const PHASE_TEXT_KEY = {
  downloading: 'update.downloading',
  backing_up: 'update.backingUp',
  installing: 'update.installing',
} as const;

const PHASE_TEST_ID = {
  downloading: 'update-banner-downloading',
  backing_up: 'update-banner-backing-up',
  installing: 'update-banner-installing',
} as const;

export function UpdateBanner({ cashSessionOpen }: UpdateBannerProps) {
  const { t } = useI18n();
  const { user } = useSession();
  const { available, mode, phase, errorKind, error, canInstallNow, performUpdate, dismiss } =
    useAppUpdate({ cashSessionOpen, sessionToken: user?.token ?? null });
  const [dismissedForSession, setDismissedForSession] = useState(false);

  if (!available) return null;
  if (mode === 'optional' && dismissedForSession) return null;

  const version = available.version;

  return (
    <Banner
      tone={mode === 'forced' ? 'warning' : 'info'}
      testId={mode === 'forced' ? 'update-banner-forced' : 'update-banner-optional'}
    >
      <p>
        {mode === 'forced'
          ? t('update.forcedBody', { version })
          : t('update.optionalBody', { version })}
      </p>
      {phase !== 'idle' ? (
        <p data-testid={PHASE_TEST_ID[phase]}>{t(PHASE_TEXT_KEY[phase])}</p>
      ) : (
        <div className="sk-modal__actions">
          <Button
            type="button"
            onClick={() => void performUpdate()}
            disabled={!canInstallNow}
            title={canInstallNow ? undefined : t('update.blockedByCashSession')}
            data-testid="update-banner-install"
          >
            {t('update.installNow')}
          </Button>
          {mode === 'optional' ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setDismissedForSession(true)}
              data-testid="update-banner-dismiss"
            >
              {t('update.dismiss')}
            </Button>
          ) : null}
        </div>
      )}
      {!canInstallNow ? (
        <p className="sk-muted" data-testid="update-banner-cash-session-notice">
          {t('update.blockedByCashSession')}
        </p>
      ) : null}
      {errorKind === 'backup' ? (
        <Banner tone="error" testId="update-banner-backup-failed">
          <p>{t('update.backupFailed')}</p>
          <Button type="button" variant="secondary" onClick={dismiss} data-testid="update-banner-error-dismiss">
            {t('common.retry')}
          </Button>
        </Banner>
      ) : errorKind === 'login_required' ? (
        <Banner tone="error" testId="update-banner-login-required">
          <p>{t('update.loginRequired')}</p>
          <Button type="button" variant="secondary" onClick={dismiss} data-testid="update-banner-error-dismiss">
            {t('common.retry')}
          </Button>
        </Banner>
      ) : error ? (
        <Banner tone="error" testId="update-banner-error">
          <p>{t('update.failed')}</p>
          <Button type="button" variant="secondary" onClick={dismiss} data-testid="update-banner-error-dismiss">
            {t('common.retry')}
          </Button>
        </Banner>
      ) : null}
    </Banner>
  );
}
