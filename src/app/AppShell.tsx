/**
 * Slice 1 — the authenticated application shell: touchscreen-friendly primary
 * navigation, a header showing the current user + active cash-session status
 * + language switcher + logout. Large touch targets; responsive.
 */
import { useEffect, useState, type ReactNode } from 'react';

import { Button } from '../shared/components';
import { LOCALES, useI18n, type Locale, type MessageKey } from '../shared/i18n';
import { useSession } from '../shared/session/SessionContext';
import type { InventoryCapabilities, ProcurementCapabilities } from '../shared/ipc/dto';

export type AppView =
  | 'dashboard'
  | 'settings'
  | 'historical_finance'
  | 'opening_state'
  | 'opening_state_application'
  | 'products'
  | 'inventory'
  | 'stock'
  | 'adjustment'
  | 'pos'
  | 'session'
  | 'documents'
  | 'journals'
  | 'customers'
  | 'suppliers'
  | 'purchases';

type NavGroup = 'main' | 'stock' | 'buy' | 'sales';
type NavItem = {
  view: AppView;
  group: NavGroup;
  icon: string;
  labelKey?: MessageKey;
  labels?: Record<Locale, string>;
};

const NAV: NavItem[] = [
  { view: 'dashboard', labelKey: 'nav.dashboard', group: 'main', icon: '⌂' },
  { view: 'journals', labels: { fr: 'Journaux', ar: 'اليومية', en: 'Journals' }, group: 'main', icon: '≡' },
  { view: 'historical_finance', labels: { fr: 'Finance historique', ar: 'المالية التاريخية', en: 'Historical finance' }, group: 'main', icon: '▥' },
  { view: 'settings', labels: { fr: 'Paramètres', ar: 'الإعدادات', en: 'Settings' }, group: 'main', icon: '⚙' },
  { view: 'products', labelKey: 'nav.products', group: 'stock', icon: '□' },
  { view: 'inventory', labelKey: 'nav.inventory', group: 'stock', icon: '▤' },
  { view: 'stock', labelKey: 'nav.stockReceipt', group: 'stock', icon: '↓' },
  { view: 'adjustment', labelKey: 'nav.stockAdjustment', group: 'stock', icon: '±' },
  { view: 'suppliers', labelKey: 'nav.suppliers', group: 'buy', icon: '◎' },
  { view: 'purchases', labels: { en: 'Purchases', fr: 'Achats', ar: 'المشتريات' }, group: 'buy', icon: '≡' },
  { view: 'customers', labels: { fr: 'Clients', ar: 'العملاء', en: 'Customers' }, group: 'sales', icon: '♙' },
  { view: 'pos', labelKey: 'nav.pos', group: 'sales', icon: '▦' },
  { view: 'session', labelKey: 'nav.cashSession', group: 'sales', icon: '◉' },
  { view: 'documents', labelKey: 'nav.documents', group: 'sales', icon: '▧' },
];

const LOCALE_LABELS: Record<Locale, string> = { fr: 'FR', ar: 'ع', en: 'EN' };
const SIDEBAR_STORAGE_KEY = 'stockiha.sidebarCollapsed';
const THEME_STORAGE_KEY = 'stockiha.theme';

type Theme = 'light' | 'dark';

function initialTheme(): Theme {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function initialSidebarState(): boolean {
  return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true';
}

const GROUP_LABELS: Record<Locale, Record<NavGroup, string>> = {
  fr: { main: 'Aperçu', stock: 'Catalogue & stock', buy: 'Achats', sales: 'Ventes & caisse' },
  ar: { main: 'نظرة عامة', stock: 'المنتجات والمخزون', buy: 'المشتريات', sales: 'المبيعات والصندوق' },
  en: { main: 'Overview', stock: 'Catalog & stock', buy: 'Purchasing', sales: 'Sales & cash' },
};

export function AppShell({
  currentView,
  onNavigate,
  inventoryCapabilities,
  inventoryCorrectionsEnabled,
  procurementCapabilities,
  children,
}: {
  currentView: AppView;
  onNavigate: (view: AppView) => void;
  inventoryCapabilities: InventoryCapabilities | null;
  inventoryCorrectionsEnabled: boolean | null;
  procurementCapabilities: ProcurementCapabilities | null;
  children: ReactNode;
}) {
  const { t, locale, setLocale } = useI18n();
  const { user, activeCashSession, logout } = useSession();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(initialSidebarState);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [isNarrow, setIsNarrow] = useState(
    () => window.matchMedia?.('(max-width: 760px)').matches ?? false,
  );
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    const query = window.matchMedia?.('(max-width: 760px)');
    if (!query) return;
    const handleChange = (event: MediaQueryListEvent) => {
      setIsNarrow(event.matches);
      if (!event.matches) setMobileNavigationOpen(false);
    };
    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  const navigationToggleLabel = isNarrow
    ? mobileNavigationOpen
      ? t('header.closeNavigation')
      : t('header.openNavigation')
    : sidebarCollapsed
      ? t('header.expandSidebar')
      : t('header.collapseSidebar');

  function toggleNavigation() {
    if (isNarrow) {
      setMobileNavigationOpen((open) => !open);
    } else {
      setSidebarCollapsed((collapsed) => !collapsed);
    }
  }

  function navigate(view: AppView) {
    onNavigate(view);
    setMobileNavigationOpen(false);
  }

  function navLabel(item: NavItem): string {
    if (item.labels) return item.labels[locale];
    if (item.labelKey) return t(item.labelKey);
    return item.view;
  }

  function canShow(item: NavItem): boolean {
    switch (item.view) {
      case 'products':
        return inventoryCapabilities?.can_manage_catalog ?? false;
      case 'inventory':
        return inventoryCapabilities?.can_view_inventory ?? false;
      case 'stock':
        return inventoryCapabilities?.can_post_stock_receipt ?? false;
      case 'adjustment':
        return (inventoryCapabilities?.can_manage_inventory ?? false) && inventoryCorrectionsEnabled === true;
      case 'suppliers':
      case 'purchases':
        return procurementCapabilities?.can_manage_procurement ?? false;
      default:
        return true;
    }
  }

  return (
    <div
      className={[
        'sk-shell',
        sidebarCollapsed ? 'sk-shell--nav-collapsed' : '',
        mobileNavigationOpen ? 'sk-shell--nav-open' : '',
      ].filter(Boolean).join(' ')}
    >
      <header className="sk-shell__header">
        <div className="sk-shell__header-left">
          <button
            type="button"
            className="sk-shell__icon-button"
            aria-label={navigationToggleLabel}
            title={navigationToggleLabel}
            aria-expanded={isNarrow ? mobileNavigationOpen : !sidebarCollapsed}
            onClick={toggleNavigation}
            data-testid="sidebar-toggle"
          >
            <span aria-hidden>{isNarrow && mobileNavigationOpen ? '×' : '☰'}</span>
          </button>
          <div className="sk-shell__brand">
            <span className="sk-shell__logo" aria-hidden>S</span>
            <span className="sk-shell__brand-copy">
              <strong>{t('app.name')}</strong>
              <small>Inventory control</small>
            </span>
          </div>
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
          <button
            type="button"
            className="sk-shell__icon-button"
            aria-label={theme === 'dark' ? t('header.themeLight') : t('header.themeDark')}
            title={theme === 'dark' ? t('header.themeLight') : t('header.themeDark')}
            aria-pressed={theme === 'dark'}
            onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
            data-testid="theme-toggle"
          >
            <span aria-hidden>{theme === 'dark' ? '☀' : '☾'}</span>
          </button>
          <Button variant="secondary" onClick={() => void logout()}>
            {t('common.logout')}
          </Button>
        </div>
      </header>

      <div className="sk-shell__body">
        <nav className="sk-nav" aria-label={t('nav.dashboard')}>
          {(['main', 'stock', 'buy', 'sales'] as const).map((group) => {
            const items = NAV.filter((item) => item.group === group && canShow(item));
            if (items.length === 0) return null;
            return (
              <div className="sk-nav__group" key={group}>
                <div className="sk-nav__group-label">{GROUP_LABELS[locale][group]}</div>
                {items.map((item) => (
                  <button
                    key={item.view}
                    type="button"
                    className={`sk-nav__item ${currentView === item.view ? 'sk-nav__item--active' : ''}`}
                    aria-current={currentView === item.view ? 'page' : undefined}
                    title={sidebarCollapsed && !isNarrow ? navLabel(item) : undefined}
                    onClick={() => navigate(item.view)}
                  >
                    <span className="sk-nav__icon" aria-hidden>{item.icon}</span>
                    <span className="sk-nav__label">{navLabel(item)}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </nav>
        {mobileNavigationOpen ? (
          <button
            type="button"
            className="sk-nav-backdrop"
            aria-label={t('header.closeNavigation')}
            onClick={() => setMobileNavigationOpen(false)}
          />
        ) : null}

        <main className="sk-main">{children}</main>
      </div>
    </div>
  );
}
