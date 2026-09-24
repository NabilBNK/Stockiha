/**
 * WS-K-7-B — LicenceBanner (plan §9.5): the right banner/testId per status,
 * none for ACTIVE/DEVELOPER/null, and the login-screen variant has no
 * button.
 */
import { describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach } from 'vitest';

import { LicenceBanner } from '../src/features/licence/LicenceBanner';
import { I18nProvider } from '../src/shared/i18n';
import { LicenceContextForTest } from './licenceTestUtils';
import type { LicenceStatus } from '../src/shared/ipc/licenceDto';

function status(overrides: Partial<LicenceStatus> = {}): LicenceStatus {
  return {
    status: 'ACTIVE',
    mode: 'FULL',
    machine_code: 'STKH-TEST-0000-0000-0001',
    licence: null,
    days_left: null,
    grace_days_left: null,
    evaluated_at: '2026-09-26T10:00:00Z',
    ...overrides,
  };
}

function renderBanner(value: LicenceStatus | null, variant: 'app' | 'login' = 'app') {
  render(
    <I18nProvider>
      <LicenceContextForTest value={value}>
        <LicenceBanner variant={variant} onOpenLicence={() => {}} />
      </LicenceContextForTest>
    </I18nProvider>,
  );
}

afterEach(cleanup);

describe('WS-K-7-B LicenceBanner', () => {
  it.each([null, status({ status: 'ACTIVE' }), status({ status: 'DEVELOPER' })])(
    'renders nothing for %j',
    (value) => {
      renderBanner(value);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    },
  );

  it('renders the expiring banner with the right testId', () => {
    renderBanner(status({ status: 'EXPIRING_SOON', days_left: 5 }));
    expect(screen.getByTestId('licence-banner-expiring')).toHaveTextContent('5 days');
  });

  it('renders the grace banner with the right testId', () => {
    renderBanner(status({ status: 'GRACE', grace_days_left: 3 }));
    expect(screen.getByTestId('licence-banner-grace')).toHaveTextContent('3 days');
  });

  it.each(['EXPIRED', 'GRACE_OVER', 'INVALID', 'WRONG_MACHINE', 'MACHINE_UNAVAILABLE'] as const)(
    'renders the read-only banner for %s',
    (code) => {
      renderBanner(status({ status: code }));
      expect(screen.getByTestId('licence-banner-readonly')).toBeInTheDocument();
    },
  );

  it('renders the clock-rollback banner with the right testId', () => {
    renderBanner(status({ status: 'CLOCK_ROLLBACK' }));
    expect(screen.getByTestId('licence-banner-clock')).toBeInTheDocument();
  });

  it('the login-screen variant has no button, only the sign-in hint', () => {
    renderBanner(status({ status: 'GRACE', grace_days_left: 3 }), 'login');
    expect(screen.getByTestId('licence-banner-grace')).toHaveTextContent('Sign in to activate the licence.');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('the app variant shows an "Open licence" button', () => {
    renderBanner(status({ status: 'GRACE', grace_days_left: 3 }), 'app');
    expect(screen.getByRole('button', { name: 'Open licence' })).toBeInTheDocument();
  });
});
