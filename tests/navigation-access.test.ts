import { describe, it, expect } from 'vitest';
import type { AppView } from '../src/app/AppShell';
import { isNavViewVisible, type NavAccess } from '../src/app/navigationAccess';

const ALL_VIEWS: AppView[] = [
  'dashboard',
  'settings',
  'historical_finance',
  'opening_state',
  'opening_state_application',
  'products',
  'catalogueSetup',
  'inventory',
  'stock',
  'adjustment',
  'pos',
  'session',
  'documents',
  'journals',
  'customers',
  'suppliers',
  'purchases',
  'reports',
];

describe('navigationAccess isNavViewVisible truth-table', () => {
  const case1_allNullOrFalse: NavAccess = {
    inventoryCapabilities: {
      can_manage_catalog: false,
      can_view_inventory: false,
      can_post_stock_receipt: false,
      can_manage_inventory: false,
    },
    inventoryCorrectionsEnabled: false,
    procurementCapabilities: {
      can_manage_procurement: false,
      can_post_purchase_receipt: false,
      can_post_supplier_invoice: false,
      can_post_supplier_return: false,
      can_post_supplier_payment: false,
    },
    customerCapabilities: {
      can_view_customers: false,
      can_manage_customers: false,
      can_post_credit_sale: false,
      can_post_customer_payment: false,
      can_post_customer_refund: false,
      can_manage_drawer_policy: false,
      can_override_credit_limit: false,
      can_apply_sale_discount: false,
    },
    reportsCapabilities: {
      can_view_reports: false,
    },
  };

  const case2_allTrueCorrectionsEnabled: NavAccess = {
    inventoryCapabilities: {
      can_manage_catalog: true,
      can_view_inventory: true,
      can_post_stock_receipt: true,
      can_manage_inventory: true,
    },
    inventoryCorrectionsEnabled: true,
    procurementCapabilities: {
      can_manage_procurement: true,
      can_post_purchase_receipt: true,
      can_post_supplier_invoice: true,
      can_post_supplier_return: true,
      can_post_supplier_payment: true,
    },
    customerCapabilities: {
      can_view_customers: true,
      can_manage_customers: true,
      can_post_credit_sale: true,
      can_post_customer_payment: true,
      can_post_customer_refund: true,
      can_manage_drawer_policy: true,
      can_override_credit_limit: true,
      can_apply_sale_discount: true,
    },
    reportsCapabilities: {
      can_view_reports: true,
    },
  };

  const case3_allTrueCorrectionsDisabled: NavAccess = {
    ...case2_allTrueCorrectionsEnabled,
    inventoryCorrectionsEnabled: false,
  };

  const case4_procurementFalseOnly: NavAccess = {
    ...case2_allTrueCorrectionsEnabled,
    procurementCapabilities: {
      can_manage_procurement: false,
      can_post_purchase_receipt: false,
      can_post_supplier_invoice: false,
      can_post_supplier_return: false,
      can_post_supplier_payment: false,
    },
  };

  it('case 1: all capabilities false/null hides capability-protected views only', () => {
    for (const view of ALL_VIEWS) {
      const visible = isNavViewVisible(view, case1_allNullOrFalse);
      const isProtected = [
        'products',
        'catalogueSetup',
        'inventory',
        'stock',
        'adjustment',
        'suppliers',
        'purchases',
        'customers',
        'reports',
      ].includes(view);
      expect(visible).toBe(!isProtected);
    }
  });

  it('case 2: all true with corrections enabled shows all views', () => {
    for (const view of ALL_VIEWS) {
      expect(isNavViewVisible(view, case2_allTrueCorrectionsEnabled)).toBe(true);
    }
  });

  it('case 3: all true with corrections disabled hides only adjustment', () => {
    for (const view of ALL_VIEWS) {
      const visible = isNavViewVisible(view, case3_allTrueCorrectionsDisabled);
      if (view === 'adjustment') {
        expect(visible).toBe(false);
      } else {
        expect(visible).toBe(true);
      }
    }
  });

  it('case 4: procurement false only hides suppliers and purchases only', () => {
    for (const view of ALL_VIEWS) {
      const visible = isNavViewVisible(view, case4_procurementFalseOnly);
      if (view === 'suppliers' || view === 'purchases') {
        expect(visible).toBe(false);
      } else {
        expect(visible).toBe(true);
      }
    }
  });
});
