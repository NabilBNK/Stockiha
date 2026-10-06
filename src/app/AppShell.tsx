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
import type { ReportsCapabilities } from '../shared/ipc/reportsDto';
import { NotificationBell } from '../features/notifications/NotificationBell';
import { isNavViewVisible } from './navigationAccess';
import { PageGuideModal } from './PageGuideModal';

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
  | 'purchases'
  | 'reports';

type NavGroup = 'operations' | 'sales' | 'buy' | 'stock' | 'finance' | 'system';
type NavItem = {
  view: AppView;
  group: NavGroup;
  icon?: string;
  labelKey?: MessageKey;
  labels?: Record<Locale, string>;
};

function renderNavIcon(view: AppView): ReactNode {
  switch (view) {
    case 'dashboard':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect width="7" height="9" x="3" y="3" rx="1" />
          <rect width="7" height="5" x="14" y="3" rx="1" />
          <rect width="7" height="9" x="14" y="12" rx="1" />
          <rect width="7" height="5" x="3" y="16" rx="1" />
        </svg>
      );
    case 'pos':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect width="20" height="14" x="2" y="5" rx="2" />
          <line x1="2" x2="22" y1="10" y2="10" />
          <circle cx="7" cy="15" r="1" />
          <circle cx="12" cy="15" r="1" />
          <circle cx="17" cy="15" r="1" />
        </svg>
      );
    case 'session':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect width="18" height="18" x="3" y="3" rx="2" />
          <circle cx="12" cy="12" r="3" />
          <line x1="12" x2="12" y1="9" y2="15" />
          <line x1="9" x2="15" y1="12" y2="12" />
        </svg>
      );
    case 'documents':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" x2="8" y1="13" y2="13" />
          <line x1="16" x2="8" y1="17" y2="17" />
        </svg>
      );
    case 'customers':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case 'purchases':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="8" cy="21" r="1" />
          <circle cx="19" cy="21" r="1" />
          <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
        </svg>
      );
    case 'suppliers':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 21h18" />
          <path d="M5 21V7l8-4v18" />
          <path d="M19 21V11l-6-4" />
          <line x1="9" x2="9" y1="9" y2="9" />
          <line x1="9" x2="9" y1="13" y2="13" />
          <line x1="9" x2="9" y1="17" y2="17" />
        </svg>
      );
    case 'products':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m7.5 4.27 9 5.15" />
          <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
          <path d="m3.3 7 8.7 5 8.7-5" />
          <path d="M12 22V12" />
        </svg>
      );
    case 'inventory':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 3h18v18H3z" />
          <path d="M3 9h18" />
          <path d="M3 15h18" />
          <path d="M9 3v18" />
          <path d="M15 3v18" />
        </svg>
      );
    case 'stock':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v12" />
          <path d="m8 11 4 4 4-4" />
          <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
        </svg>
      );
    case 'adjustment':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
          <path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
          <path d="M7 21h10" />
          <path d="M12 3v18" />
          <path d="M3 7h18" />
        </svg>
      );
    case 'catalogueSetup':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z" />
          <circle cx="7" cy="7" r="1.5" />
        </svg>
      );
    case 'reports':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" x2="18" y1="20" y2="10" />
          <line x1="12" x2="12" y1="20" y2="4" />
          <line x1="6" x2="6" y1="20" y2="14" />
          <line x1="3" x2="21" y1="20" y2="20" />
        </svg>
      );
    case 'journals':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z" />
          <path d="M6 6h10" />
          <path d="M6 10h10" />
          <path d="M6 14h6" />
        </svg>
      );
    case 'historical_finance':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z" />
          <polyline points="10 8 10 12 14 12" />
        </svg>
      );
    case 'settings':
    default:
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
  }
}

const NAV: NavItem[] = [
  // 1. Daily Operations
  { view: 'dashboard', labelKey: 'nav.dashboard', group: 'operations' },
  { view: 'pos', labelKey: 'nav.pos', group: 'operations' },
  { view: 'session', labelKey: 'nav.cashSession', group: 'operations' },

  // 2. Sales & Customers
  { view: 'documents', labelKey: 'nav.documents', group: 'sales' },
  { view: 'customers', labels: { fr: 'Clients', ar: 'العملاء', en: 'Customers' }, group: 'sales' },

  // 3. Purchasing & Suppliers
  { view: 'purchases', labels: { en: 'Purchases', fr: 'Achats', ar: 'المشتريات' }, group: 'buy' },
  { view: 'suppliers', labelKey: 'nav.suppliers', group: 'buy' },

  // 4. Catalog & Stock
  { view: 'products', labelKey: 'nav.products', group: 'stock' },
  { view: 'inventory', labelKey: 'nav.inventory', group: 'stock' },
  { view: 'stock', labelKey: 'nav.stockReceipt', group: 'stock' },
  { view: 'adjustment', labelKey: 'nav.stockAdjustment', group: 'stock' },
  { view: 'catalogueSetup', labelKey: 'nav.catalogueSetup', group: 'stock' },

  // 5. Finance & Reports
  { view: 'reports', labels: { fr: 'Rapports', ar: 'التقارير', en: 'Reports' }, group: 'finance' },
  { view: 'journals', labels: { fr: 'Journaux', ar: 'اليومية', en: 'Journals' }, group: 'finance' },
  { view: 'historical_finance', labels: { fr: 'Livre papier (historique)', ar: 'دفتر ورقي (أرشيف)', en: 'Paper book (history)' }, group: 'finance' },

  // 6. System (Settings)
  { view: 'settings', labels: { fr: 'Paramètres', ar: 'الإعدادات', en: 'Settings' }, group: 'system' },
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
  fr: {
    operations: 'Opérations',
    sales: 'Ventes & Clients',
    buy: 'Achats & Fournisseurs',
    stock: 'Catalogue & Stock',
    finance: 'Comptabilité & Rapports',
    system: 'Système',
  },
  ar: {
    operations: 'العمليات',
    sales: 'المبيعات والعملاء',
    buy: 'المشتريات والموردون',
    stock: 'المنتجات والمخزون',
    finance: 'المالية والتقارير',
    system: 'النظام',
  },
  en: {
    operations: 'Operations',
    sales: 'Sales & Customers',
    buy: 'Purchases & Suppliers',
    stock: 'Catalog & Stock',
    finance: 'Finance & Reports',
    system: 'System',
  },
};

const VIEW_HEADERS: Record<Locale, Record<AppView, { title: string; subtitle?: string }>> = {
  en: {
    pos: { title: 'Point of sale', subtitle: 'Select products and complete the sale from the cart.' },
    dashboard: { title: 'Dashboard', subtitle: 'Overview of operations and catalog' },
    products: { title: 'Products', subtitle: 'Manage items, variants, packs, and barcodes' },
    catalogueSetup: { title: 'Catalogue setup', subtitle: 'Categories, units, and attributes' },
    inventory: { title: 'Inventory', subtitle: 'Stock balances and warehouse tracking' },
    stock: { title: 'Stock receipt', subtitle: 'Receive goods and update stock valuation' },
    adjustment: { title: 'Stock adjustment', subtitle: 'Reconcile stock and log adjustments' },
    suppliers: { title: 'Suppliers', subtitle: 'Manage vendors and procurement contacts' },
    purchases: { title: 'Purchases', subtitle: 'Purchase orders and receipts' },
    customers: { title: 'Customers', subtitle: 'Client records and credit limits' },
    session: { title: 'Cash session', subtitle: 'Open, inspect, and close cash drawer sessions' },
    documents: { title: 'Documents', subtitle: 'Sales invoices, receipts, and void slips' },
    journals: { title: 'Journals', subtitle: 'Financial accounting ledger entries' },
    reports: { title: 'Reports', subtitle: 'Business performance and analytics' },
    settings: { title: 'Settings', subtitle: 'Workstation, licence, and system configuration' },
    historical_finance: { title: 'Historical Paper Book', subtitle: 'Records, import from Google Sheets, manual entries, and name clean-up' },
    opening_state: { title: 'Opening state', subtitle: 'Initial balances and setup wizard' },
    opening_state_application: { title: 'Opening state', subtitle: 'Apply initial ledger and stock entries' },
  },
  fr: {
    pos: { title: 'Point de vente', subtitle: 'Sélectionnez les produits et validez la vente depuis le panier.' },
    dashboard: { title: 'Tableau de bord', subtitle: 'Aperçu des opérations et du catalogue' },
    products: { title: 'Produits', subtitle: 'Gérer les articles, variantes, paquets et codes-barres' },
    catalogueSetup: { title: 'Configuration catalogue', subtitle: 'Catégories, unités et attributs' },
    inventory: { title: 'Inventaire', subtitle: 'Soldes de stock et suivi par entrepôt' },
    stock: { title: 'Réception de stock', subtitle: 'Réceptionner des marchandises et actualiser le PUMP' },
    adjustment: { title: 'Ajustement de stock', subtitle: 'Régulariser le stock et consigner les écarts' },
    suppliers: { title: 'Fournisseurs', subtitle: 'Gérer les fournisseurs et contacts' },
    purchases: { title: 'Achats', subtitle: 'Commandes et bons de réception' },
    customers: { title: 'Clients', subtitle: 'Fiches clients et limites de crédit' },
    session: { title: 'Session de caisse', subtitle: 'Ouvrir, inspecter et clôturer les sessions' },
    documents: { title: 'Documents', subtitle: 'Factures de vente, tickets et annulations' },
    journals: { title: 'Journaux', subtitle: 'Écritures comptables' },
    reports: { title: 'Rapports', subtitle: 'Analyses et performances' },
    settings: { title: 'Paramètres', subtitle: 'Poste, licence et configuration système' },
    historical_finance: { title: 'Livre papier (historique)', subtitle: 'Registres, import depuis Google Sheets, saisie manuelle et nettoyage des noms' },
    opening_state: { title: 'État d’ouverture', subtitle: 'Soldes initiaux et configuration' },
    opening_state_application: { title: 'État d’ouverture', subtitle: 'Application des écritures initiales' },
  },
  ar: {
    pos: { title: 'نقطة البيع', subtitle: 'اختر المنتجات وأتمم عملية البيع من السلة.' },
    dashboard: { title: 'لوحة التحكم', subtitle: 'نظرة عامة على العمليات والكتالوج' },
    products: { title: 'المنتجات', subtitle: 'إدارة السلع والمتغيرات والعلب والباركود' },
    catalogueSetup: { title: 'إعداد الكتالوج', subtitle: 'الفئات والوحدات والسمات' },
    inventory: { title: 'المخزون', subtitle: 'أرصدة المخزون وتتبع المستودعات' },
    stock: { title: 'استلام المخزون', subtitle: 'استلام البضائع وتحديث متوسط التكلفة' },
    adjustment: { title: 'تسوية المخزون', subtitle: 'تسوية الكميات وتسجيل الفروقات' },
    suppliers: { title: 'الموردون', subtitle: 'إدارة الموردين وجهات الاتصال' },
    purchases: { title: 'المشتريات', subtitle: 'أوامر وإيصالات الشراء' },
    customers: { title: 'العملاء', subtitle: 'سجلات العملاء والحدود الائتمانية' },
    session: { title: 'جلسة الصندوق', subtitle: 'فتح ومراجعة وإغلاق جلسات الصندوق' },
    documents: { title: 'المستندات', subtitle: 'فواتير البيع والإيصالات ومستندات الإلغاء' },
    journals: { title: 'اليومية', subtitle: 'قيود دفتر اليومية المحاسبية' },
    reports: { title: 'التقارير', subtitle: 'تقارير الأداء وتحليلات الأعمال' },
    settings: { title: 'الإعدادات', subtitle: 'محطة العمل والترخيص وإعدادات النظام' },
    historical_finance: { title: 'دفتر ورقي (أرشيف)', subtitle: 'السجلات، الاستيراد من Google Sheets، الإدخال اليدوي وتصحيح الأسماء' },
    opening_state: { title: 'حالة الافتتاح', subtitle: 'الأرصدة الافتتاحية والإعداد' },
    opening_state_application: { title: 'حالة الافتتاح', subtitle: 'تطبيق القيود الافتتاحية والمخزون' },
  },
};

export function AppShell({
  currentView,
  onNavigate,
  onNavigateToVariant,
  inventoryCapabilities,
  inventoryCorrectionsEnabled,
  procurementCapabilities,
  customerCapabilities,
  reportsCapabilities,
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
  reportsCapabilities: ReportsCapabilities | null;
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
  const [guideOpen, setGuideOpen] = useState(false);

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
      const rows = await ipc.listProductsV2(token, selectedWarehouseId, { search: query, limit: 100, offset: 0 });
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
    async function toggleFullscreen() {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const win = getCurrentWindow();
        const isFull = await win.isFullscreen();
        await win.setFullscreen(!isFull);
      } catch {
        if (!document.fullscreenElement) {
          await document.documentElement.requestFullscreen().catch(() => {});
        } else {
          await document.exitFullscreen().catch(() => {});
        }
      }
    }

    function handleGlobalKeyDown(event: KeyboardEvent) {
      // Prevent accidental browser reload on F5 and Ctrl+R in desktop app
      if (
        event.key === 'F5' ||
        ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r')
      ) {
        event.preventDefault();
      }

      // F11 fullscreen toggle
      if (event.key === 'F11') {
        event.preventDefault();
        void toggleFullscreen();
      }

      // Ctrl+K / Cmd+K opens the search
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
    return isNavViewVisible(item.view, {
      inventoryCapabilities,
      inventoryCorrectionsEnabled,
      procurementCapabilities,
      customerCapabilities,
      reportsCapabilities,
    });
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
            <span className="sk-shell__logo" aria-hidden>
              <img
                src="/logo.svg"
                alt=""
                width={24}
                height={24}
                style={{ filter: 'brightness(0) invert(1)', display: 'block' }}
              />
            </span>
            <span className="sk-shell__brand-copy">
              <strong>{t('app.name')}</strong>
              <small>{t('app.tagline')}</small>
            </span>
          </div>
        </div>

        <div className="sk-shell__header-center" data-testid="shell-header-title">
          <div className="sk-shell__title-row">
            {currentView === 'pos' ? (
              <h1 className="sk-shell__page-title">{VIEW_HEADERS[locale]?.[currentView]?.title ?? t('app.name')}</h1>
            ) : (
              <span className="sk-shell__page-title">{VIEW_HEADERS[locale]?.[currentView]?.title ?? t('app.name')}</span>
            )}
            <button
              type="button"
              className="sk-page-guide-trigger"
              onClick={() => setGuideOpen(true)}
              aria-label={locale === 'fr' ? 'Guide de la page' : locale === 'ar' ? 'دليل الصفحة' : 'Page guide'}
              title={locale === 'fr' ? 'Guide de la page' : locale === 'ar' ? 'دليل الصفحة' : 'Page guide'}
              data-testid="page-guide-trigger"
            >
              <span aria-hidden="true">ℹ</span>
            </button>
          </div>
          {VIEW_HEADERS[locale]?.[currentView]?.subtitle ? (
            <p className="sk-shell__page-subtitle">{VIEW_HEADERS[locale]?.[currentView]?.subtitle}</p>
          ) : null}
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
          <NotificationBell setView={onNavigate} />
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
          <div className="sk-nav__main-groups">
            {(['operations', 'sales', 'buy', 'stock', 'finance'] as const).map((group) => {
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
                      <span className="sk-nav__icon" aria-hidden>{renderNavIcon(item.view)}</span>
                      <span className="sk-nav__label">{navLabel(item)}</span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>

          {(() => {
            const systemItems = NAV.filter((item) => item.group === 'system' && canShow(item));
            if (systemItems.length === 0) return null;
            return (
              <div className="sk-nav__group sk-nav__group--system">
                <div className="sk-nav__group-label">{GROUP_LABELS[locale].system}</div>
                {systemItems.map((item) => (
                  <button
                    key={item.view}
                    type="button"
                    className={`sk-nav__item ${currentView === item.view ? 'sk-nav__item--active' : ''}`}
                    aria-current={currentView === item.view ? 'page' : undefined}
                    title={sidebarCollapsed && !isNarrow ? navLabel(item) : undefined}
                    onClick={() => navigate(item.view)}
                  >
                    <span className="sk-nav__icon" aria-hidden>{renderNavIcon(item.view)}</span>
                    <span className="sk-nav__label">{navLabel(item)}</span>
                  </button>
                ))}
              </div>
            );
          })()}
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

      {guideOpen ? (
        <PageGuideModal view={currentView} onClose={() => setGuideOpen(false)} />
      ) : null}
    </div>
  );
}
