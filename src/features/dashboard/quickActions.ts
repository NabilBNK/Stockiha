import type { AppView } from '../../app/AppShell';
import { isNavViewVisible, type NavAccess } from '../../app/navigationAccess';
import type { MessageKey } from '../../shared/i18n';

export type NavPurpose =
  | 'M-POS'
  | 'M-PURCHASE'
  | 'M-CUSTOMERS'
  | 'M-SUPPLIERS'
  | 'M-PRODUCTS'
  | 'M-ADJUSTMENT'
  | 'M-INVENTORY'
  | 'M-SESSION'
  | 'M-DOCUMENTS'
  | 'M-REPORT-SALES'
  | 'M-REPORT-PROFIT'
  | 'M-REPORT-OWED'
  | 'M-REPORT-PAYABLES'
  | 'M-REPORT-STOCK'
  | 'M-NOTIFICATIONS';

/**
 * Maps abstract navigation purposes to live view names.
 * Reports views all map to 'reports' (WS-I unified view).
 * Notifications overlay does not have a dedicated AppView route.
 */
export const NAV_MAP: Record<NavPurpose, AppView | null> = {
  'M-POS': 'pos',
  'M-PURCHASE': 'purchases',
  'M-CUSTOMERS': 'customers',
  'M-SUPPLIERS': 'suppliers',
  'M-PRODUCTS': 'products',
  'M-ADJUSTMENT': 'adjustment',
  'M-INVENTORY': 'inventory',
  'M-SESSION': 'session',
  'M-DOCUMENTS': 'documents',
  'M-REPORT-SALES': 'reports',
  'M-REPORT-PROFIT': 'reports',
  'M-REPORT-OWED': 'reports',
  'M-REPORT-PAYABLES': 'reports',
  'M-REPORT-STOCK': 'reports',
  'M-NOTIFICATIONS': null,
};

/**
 * Resolves the first purpose in the ordered list whose target view is non-null
 * and visible given the user's current NavAccess permissions.
 */
export function resolveTarget(purposes: NavPurpose[], access: NavAccess): AppView | null {
  for (const purpose of purposes) {
    const view = NAV_MAP[purpose];
    if (view && isNavViewVisible(view, access)) {
      return view;
    }
  }
  return null;
}

export interface QuickActionDef {
  id: string;
  labelKey: MessageKey;
  icon: string;
  purposes: NavPurpose[];
}

export const QUICK_ACTIONS: readonly QuickActionDef[] = [
  { id: 'newSale', labelKey: 'dash.actions.newSale', icon: '▦', purposes: ['M-POS'] },
  { id: 'newPurchase', labelKey: 'dash.actions.newPurchase', icon: '≡', purposes: ['M-PURCHASE'] },
  { id: 'customerPayment', labelKey: 'dash.actions.customerPayment', icon: '♙', purposes: ['M-CUSTOMERS'] },
  { id: 'supplierPayment', labelKey: 'dash.actions.supplierPayment', icon: '◎', purposes: ['M-SUPPLIERS'] },
  { id: 'addProduct', labelKey: 'dash.actions.addProduct', icon: '□', purposes: ['M-PRODUCTS'] },
  { id: 'stockAdjustment', labelKey: 'dash.actions.stockAdjustment', icon: '±', purposes: ['M-ADJUSTMENT'] },
] as const;
