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
  | 'documents'
  | 'suppliers'
  | 'purchase_orders'
  | 'supplier_invoices'
  | 'supplier_liabilities'
  | 'supplier_returns';

const NAV: { view: AppView; labelKey: MessageKey; group: 'main' | 'stock' | 'buy' | 'sales'; icon: string }[] = [
  { view: 'dashboard', labelKey: 'nav.dashboard', group: 'main', icon: '⌂' },
  { view: 'products', labelKey: 'nav.products', group: 'stock', icon: '□' },
  { view: 'stock', labelKey: 'nav.stockReceipt', group: 'stock', icon: '↓' },
  { view: 'adjustment', labelKey: 'nav.stockAdjustment', group: 'stock', icon: '±' },
  { view: 'suppliers', labelKey: 'nav.suppliers', group: 'buy', icon: '◎' },
  { view: 'purchase_orders', labelKey: 'nav.purchaseOrders', group: 'buy', icon: '≡' },
  { view: 'supplier_invoices', labelKey: 'nav.supplierInvoices', group: 'buy', icon: '▤' },
  { view: 'supplier_liabilities', labelKey: 'nav.supplierLiabilities', group: 'buy', icon: '₫' },
  { view: 'supplier_returns', labelKey: 'nav.supplierReturns', group: 'buy', icon: '↩' },
  { view: 'pos', labelKey: 'nav.pos', group: 'sales', icon: '▦' },
  { view: 'session', labelKey: 'nav.cashSession', group: 'sales', icon: '◉' },
  { view: 'documents', labelKey: 'nav.documents', group: 'sales', icon: '▧' },
];

const LOCALE_LABELS: Record<Locale, string> = { fr: 'FR', ar: 'ع', en: 'EN' };
const GROUP_LABELS: Record<Locale, Record<(typeof NAV)[number]['group'], string>> = {
  fr: { main: 'Aperçu', stock: 'Catalogue & stock', buy: 'Achats', sales: 'Ventes & caisse' },
  ar: { main: 'نظرة عامة', stock: 'المنتجات والمخزون', buy: 'المشتريات', sales: 'المبيعات والصندوق' },
  en: { main: 'Overview', stock: 'Catalog & stock', buy: 'Purchasing', sales: 'Sales & cash' },
};

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
        <div className="sk-shell__brand">
          <span className="sk-shell__logo" aria-hidden>S</span>
          <span>
            <strong>{t('app.name')}</strong>
            <small>Inventory control</small>
          </span>
        </div>
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
          {(['main', 'stock', 'buy', 'sales'] as const).map((group) => (
            <div className="sk-nav__group" key={group}>
              <div className="sk-nav__group-label">{GROUP_LABELS[locale][group]}</div>
              {NAV.filter((item) => item.group === group).map((item) => (
                <button
                  key={item.view}
                  type="button"
                  className={`sk-nav__item ${currentView === item.view ? 'sk-nav__item--active' : ''}`}
                  aria-current={currentView === item.view ? 'page' : undefined}
                  onClick={() => onNavigate(item.view)}
                >
                  <span className="sk-nav__icon" aria-hidden>{item.icon}</span>
                  <span>{t(item.labelKey)}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        <main className="sk-main">{children}</main>
      </div>
    </div>
  );
}
