/**
 * Slice 1 — i18n + RTL tests. Verifies French is the default, English and
 * Arabic resolve, Arabic sets document direction to RTL, `{var}`
 * interpolation works, and backend error codes resolve to safe localized
 * messages (never raw text).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';

import { I18nProvider, useI18n } from '../src/shared/i18n';
import { useErrorText } from '../src/shared/hooks/useErrorText';
import { GatewayError } from '../src/shared/ipc/gateway';

afterEach(cleanup);

function Probe() {
  const { t, locale, dir, setLocale } = useI18n();
  const errorText = useErrorText();
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="dir">{dir}</span>
      <span data-testid="nav">{t('nav.pos')}</span>
      <span data-testid="interp">{t('session.active', { id: 7 })}</span>
      <span data-testid="err">{errorText(new GatewayError('PERMISSION_DENIED'))}</span>
      <button onClick={() => setLocale('ar')}>ar</button>
      <button onClick={() => setLocale('en')}>en</button>
    </div>
  );
}

describe('i18n', () => {
  it('defaults to French and localizes navigation', () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId('locale').textContent).toBe('fr');
    expect(screen.getByTestId('dir').textContent).toBe('ltr');
    expect(screen.getByTestId('nav').textContent).toBe('Point de vente');
  });

  it('interpolates variables', () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId('interp').textContent).toContain('7');
  });

  it('switches to Arabic and applies RTL at the document root', () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    act(() => {
      screen.getByText('ar').click();
    });
    expect(screen.getByTestId('locale').textContent).toBe('ar');
    expect(screen.getByTestId('dir').textContent).toBe('rtl');
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    expect(document.documentElement.getAttribute('lang')).toBe('ar');
    expect(screen.getByTestId('nav').textContent).toBe('نقطة البيع');
  });

  it('switches to English', () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    act(() => {
      screen.getByText('en').click();
    });
    expect(screen.getByTestId('nav').textContent).toBe('Point of sale');
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
  });

  it('resolves a backend error code to a safe localized message', () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    // French default message for PERMISSION_DENIED.
    expect(screen.getByTestId('err').textContent).toBe(
      'Vous n’avez pas l’autorisation d’effectuer cette action.',
    );
  });
});
