/**
 * Slice 1 — the authenticated application shell: touchscreen-friendly primary
 * navigation, a header showing the current user + active cash-session status
 * + language switcher + logout. Large touch targets; responsive.
 */
import type { ReactNode } from 'react';

import { Button } from '../shared/components';
import { LOCALES, useI18n, type Locale, type MessageKey } from '../shared/i18n';
import { useSession } from '../shared/session/SessionContext';

export type AppView =
  | 'dashboard'
  | 'products'
  | 'stock'
  | 'adjustment'
  | 'pos'
  | 'session'
  | 'documents';

const NAV: { view: AppView; labelKey: MessageKey }[] = [
  { view: 'dashboard', labelKey: 'nav.dashboard' },
  { view: 'products', labelKey: 'nav.products' },
  { view: 'stock', labelKey: 'nav.stockReceipt' },
  { view: 'adjustment', labelKey: 'nav.stockAdjustment' },
  { view: 'pos', labelKey: 'nav.pos' },
  { view: 'session', labelKey: 'nav.cashSession' },
  { view: 'documents', labelKey: 'nav.documents' },
];

const LOCALE_LABELS: Record<Locale, string> = { fr: 'FR', ar: 'ع', en: 'EN' };

export function AppShell({
  currentView,
  onNavigate,
  children,
}: {
  currentView: AppView;
  onNavigate: (view: AppView) => void;
  children: ReactNode;
}) {
  const { t, locale, setLocale } = useI18n();
  const { user, activeCashSession, logout } = useSession();

  return (
    <div className="sk-shell">
      <header className="sk-shell__header">
        <div className="sk-shell__brand">{t('app.name')}</div>
        <div className="sk-shell__header-right">
          <span
            className={`sk-badge ${activeCashSession ? 'sk-badge--ok' : 'sk-badge--muted'}`}
            data-testid="session-status"
          >
            {activeCashSession ? t('header.session.open') : t('header.session.closed')}
          </span>
          <span className="sk-shell__user" data-testid="header-user">
            {user?.username ?? ''}
          </span>
          <div className="sk-lang" role="group" aria-label={t('common.language')}>
            {LOCALES.map((l) => (
              <button
                key={l}
                type="button"
                className={`sk-lang__btn ${l === locale ? 'sk-lang__btn--active' : ''}`}
                aria-pressed={l === locale}
                onClick={() => setLocale(l)}
              >
                {LOCALE_LABELS[l]}
              </button>
            ))}
          </div>
          <Button variant="secondary" onClick={() => void logout()}>
            {t('common.logout')}
          </Button>
        </div>
      </header>

      <div className="sk-shell__body">
        <nav className="sk-nav" aria-label={t('nav.dashboard')}>
          {NAV.map((item) => (
            <button
              key={item.view}
              type="button"
              className={`sk-nav__item ${currentView === item.view ? 'sk-nav__item--active' : ''}`}
              aria-current={currentView === item.view ? 'page' : undefined}
              onClick={() => onNavigate(item.view)}
            >
              {t(item.labelKey)}
            </button>
          ))}
        </nav>

        <main className="sk-main">{children}</main>
      </div>
    </div>
  );
}
