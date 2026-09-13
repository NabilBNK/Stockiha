/**
 * Slice 1 — the authenticated application shell: touchscreen-friendly primary
 * navigation, a header showing the current user + active cash-session status
 * + language switcher + logout. Large touch targets; responsive.
 *
 * WS-D-15 (D-7) — global barcode-first search. This is the sanctioned D-7
 * blast-radius exception (ws-d-skill.md §1): global search legitimately needs
 * a shell-level entry point, which WS-J otherwise owns. See "Barcode
 * resolution" in the WS-D-15 report for the shared resolver
 * (src/shared/search/barcodeFirstSearch.ts) this reuses rather than
 * reimplementing.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { Button } from '../shared/components';
import { ItemSearchModal } from '../shared/components/ItemSearchModal';
import { LOCALES, useI18n, type Locale, type MessageKey } from '../shared/i18n';
import { useErrorText } from '../shared/hooks/useErrorText';
import { useSession } from '../shared/session/SessionContext';
import { useAppData } from './AppDataContext';
import * as ipc from '../shared/ipc/gateway';
import { resolveBarcodeFirst } from '../shared/search/barcodeFirstSearch';
import type {
  InventoryCapabilities,
  ProcurementCapabilities,
  ProductListItem,
  ProductListItemV2,
} from '../shared/ipc/dto';
import type { CustomerCapabilities } from '../shared/ipc/customerDto';

export type AppView =
  | 'dashboard'
  | 'settings'
  | 'historical_finance'
  | 'opening_state'
  | 'opening_state_application'
  | 'products'
  | 'catalogueSetup'
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
  // WS-D-12: the rebuilt page is now the ONLY Products page. The old one was
  // deleted after Owner acceptance; this entry inherited its view id.
  { view: 'products', labelKey: 'nav.products', group: 'stock', icon: '□' },
  { view: 'catalogueSetup', labelKey: 'nav.catalogueSetup', group: 'stock', icon: '✎' },
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

/**
 * WS-D-15 A2 — ItemSearchModal (and its `onSelect`) speaks `ProductListItem`
 * (the `listProducts`-shaped DTO); the global search's server text fallback
 * uses `listProductsV2` (`ProductListItemV2`), which carries the fields this
 * modal needs under different names. This is a pure field rename, no
 * arithmetic, no rounding — every exact-decimal string crosses untouched.
 */
function toProductListItem(row: ProductListItemV2): ProductListItem {
  return {
    product_id: row.product_id,
    variant_id: row.variant_id,
    sku: row.sku,
    name: row.variant_name,
    product_name: row.product_name,
    primary_barcode: row.primary_barcode,
    attributes: row.attributes,
    sale_price: row.sale_price,
    is_active: row.is_active,
    quantity_on_hand: row.quantity_on_hand,
    last_known_wac: row.last_known_wac,
    category_name: row.category_name,
  };
}

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
  onNavigateToVariant,
  inventoryCapabilities,
  inventoryCorrectionsEnabled,
  procurementCapabilities,
  customerCapabilities,
  children,
}: {
  currentView: AppView;
  onNavigate: (view: AppView) => void;
  /**
   * WS-D-15 A3 — set by AppRouter.tsx; when the global search resolves an
   * exact barcode match, this navigates to the Products page with that
   * variant's panel already open. Reuses CatalogPanel's existing
   * initialVariantId mechanism (via CatalogScreen's pendingSelection prop) —
   * see AppRouter.tsx and CatalogScreen.tsx for the other end of this wire.
   */
  onNavigateToVariant: (productId: number, variantId: number) => void;
  inventoryCapabilities: InventoryCapabilities | null;
  inventoryCorrectionsEnabled: boolean | null;
  procurementCapabilities: ProcurementCapabilities | null;
  customerCapabilities: CustomerCapabilities | null;
  children: ReactNode;
}) {
  const { t, locale, setLocale } = useI18n();
  const { user, activeCashSession, logout } = useSession();
  const { selectedWarehouseId } = useAppData();
  const errorText = useErrorText();
  const token = user?.token ?? '';
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

  // -------------------------------------------------------------------
  // WS-D-15 A1/A2/A5 — global barcode-first search.
  // -------------------------------------------------------------------
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<ProductListItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchNotice, setSearchNotice] = useState<string | null>(null);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchResults([]);
    setSearchError(null);
    setSearchNotice(null);
  }, []);

  /**
   * A2 — server text search over name/SKU/barcode via the existing
   * list_products_v2, exactly as the Products page already does. Capped at
   * 25 rows: this is a quick-jump search, not the Products page's own
   * paginated browsing.
   */
  const runTextSearch = useCallback(async (query: string) => {
    if (!token || selectedWarehouseId == null) return;
    setSearchLoading(true);
    setSearchError(null);
    try {
      const rows = await ipc.listProductsV2(token, selectedWarehouseId, { search: query, limit: 25, offset: 0 });
      setSearchResults(rows.map(toProductListItem));
    } catch (err) {
      setSearchError(errorText(err));
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, [token, selectedWarehouseId, errorText]);

  // A2 — typed input with no Enter: debounced text search only, 300ms, same
  // as the Products page. resolveBarcode is NEVER called from this path.
  const [pendingQuery, setPendingQuery] = useState('');
  useEffect(() => {
    if (!searchOpen) return;
    const query = pendingQuery.trim();
    if (!query) {
      void runTextSearch('');
      setSearchNotice(null);
      return;
    }
    const timer = setTimeout(() => { void runTextSearch(query); }, 300);
    return () => clearTimeout(timer);
  }, [pendingQuery, searchOpen, runTextSearch]);

  /**
   * A2 — Enter: barcode-first. An exact match navigates straight to the
   * variant with no intermediate list (A3). No match falls back to the SAME
   * server text search, immediately (not waiting out the debounce, since
   * Enter is a deliberate submit) — and says the scan was not found while
   * keeping the scanned value visible in the field (the modal never clears
   * it on its own).
   */
  const handleEnter = useCallback(async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed || !token) return;
    setSearchNotice(null);
    const result = await resolveBarcodeFirst(token, trimmed);
    if (result.type === 'match') {
      const r = result.resolved;
      closeSearch();
      onNavigateToVariant(r.product_id, r.variant_id);
      return;
    }
    setSearchNotice(t('search.barcodeNotFound', { query: trimmed }));
    await runTextSearch(trimmed);
  }, [token, closeSearch, onNavigateToVariant, runTextSearch, t]);

  const handleSelect = useCallback((item: ProductListItem) => {
    closeSearch();
    onNavigateToVariant(item.product_id, item.variant_id);
  }, [closeSearch, onNavigateToVariant]);

  // A1 — Ctrl+K / Cmd+K opens the search from anywhere. Checked against this
  // codebase (no existing global ctrl/meta shortcut anywhere)
  // and against common browser/WebView2 bindings: Ctrl+F is native
  // find-in-page, Ctrl+P/S/N are print/save/new — none of those is K.
  // Ctrl/Cmd+K is also the established cross-app convention for "open quick
  // search" (VS Code, Slack, GitHub, Linear), so it reads as intentional
  // rather than arbitrary.
  useEffect(() => {
    function handleGlobalKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

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

  /**
   * WS-J-1 Part 3b — extends the existing capability mechanism to every nav
   * entry rather than adding a second one. `dashboard`, `journals`,
   * `historical_finance`, `settings`, `pos`, `session`, and `documents` have
   * NO capability DTO anywhere in the codebase (verified: only
   * InventoryCapabilities, ProcurementCapabilities and CustomerCapabilities
   * exist in src/shared/ipc/*.ts) — per the task brief, an entry with no
   * obvious capability is left visible rather than guessed at, so they fall
   * through to `default: true`. This mirrors Settings' own internal model:
   * access is enforced by server-side RBAC on each action, not by a
   * capabilities projection the shell can gate on.
   *
   * UI HIDING IS NOT AUTHORISATION. Every one of these capability flags is a
   * best-effort projection for usability; the real boundary is the
   * PostgreSQL SECURITY DEFINER check each backend command performs. A user
   * who reaches a hidden view by some other path (or a stale/racy
   * capability read) is still stopped there, same as always.
   */
  function canShow(item: NavItem): boolean {
    switch (item.view) {
      case 'products':
      case 'catalogueSetup':
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
      case 'customers':
        return customerCapabilities?.can_view_customers ?? false;
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
              <small>{t('app.tagline')}</small>
            </span>
          </div>
        </div>
        <div className="sk-shell__header-right">
          {/* WS-D-15 A1 — the visible control. Reuses the existing
              sk-shell__icon-button styling verbatim (no new CSS); the
              keyboard shortcut (Ctrl/Cmd+K) is the same handler. */}
          <button
            type="button"
            className="sk-shell__icon-button"
            aria-label={t('search.openLabel')}
            title={t('search.openTitle')}
            onClick={() => setSearchOpen(true)}
            data-testid="global-search-button"
          >
            <span aria-hidden>⌕</span>
          </button>
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

      {/* WS-D-15 A1-A5 — global barcode-first search. Reuses ItemSearchModal
          (which already existed, used by StockAdjustmentScreen) rather than
          building a second search surface. */}
      <ItemSearchModal
        isOpen={searchOpen}
        onClose={closeSearch}
        onSelect={handleSelect}
        items={searchResults}
        loading={searchLoading}
        error={searchError}
        notice={searchNotice}
        onQueryChange={setPendingQuery}
        onEnter={(query) => void handleEnter(query)}
        title={t('search.title')}
        placeholder={t('search.placeholder')}
      />
    </div>
  );
}
