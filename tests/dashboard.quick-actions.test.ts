import { describe, it, expect } from 'vitest';
import { resolveTarget, QUICK_ACTIONS } from '../src/features/dashboard/quickActions';
import type { NavAccess } from '../src/app/navigationAccess';

describe('quickActions', () => {
  const baseAccess: NavAccess = {
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

  it('resolves primary purpose when visible', () => {
    expect(resolveTarget(['M-POS'], baseAccess)).toBe('pos');
    expect(resolveTarget(['M-REPORT-SALES'], baseAccess)).toBe('reports');
    expect(resolveTarget(['M-REPORT-OWED', 'M-CUSTOMERS'], baseAccess)).toBe('reports');
  });

  it('falls back to secondary purpose when primary is not available or not visible', () => {
    const noReportsAccess: NavAccess = {
      ...baseAccess,
      reportsCapabilities: {
        can_view_reports: false,
      },
    };
    // M-REPORT-OWED maps to reports (not visible), falls back to M-CUSTOMERS -> customers
    expect(resolveTarget(['M-REPORT-OWED', 'M-CUSTOMERS'], noReportsAccess)).toBe('customers');
    expect(resolveTarget(['M-REPORT-PAYABLES', 'M-SUPPLIERS'], noReportsAccess)).toBe('suppliers');
    expect(resolveTarget(['M-REPORT-STOCK', 'M-INVENTORY'], noReportsAccess)).toBe('inventory');
  });

  it('hides adjustment action when inventory corrections are disabled', () => {
    const noCorrectionsAccess: NavAccess = {
      ...baseAccess,
      inventoryCorrectionsEnabled: false,
    };
    expect(resolveTarget(['M-ADJUSTMENT'], noCorrectionsAccess)).toBeNull();
  });

  it('returns null for M-NOTIFICATIONS', () => {
    expect(resolveTarget(['M-NOTIFICATIONS'], baseAccess)).toBeNull();
  });

  it('has valid definitions for all quick actions', () => {
    expect(QUICK_ACTIONS).toHaveLength(6);
    for (const action of QUICK_ACTIONS) {
      expect(action.id).toBeDefined();
      expect(action.labelKey).toBeDefined();
      expect(action.icon).toBeDefined();
      expect(action.purposes.length).toBeGreaterThan(0);
    }
  });
});
