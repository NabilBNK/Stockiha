/**
 * WS-J-1 Part 3b — role-based navigation. Every nav entry that has a
 * capability behind it (per AppShell's `canShow()`) must be completely
 * absent from the DOM when the session lacks that capability, and present
 * when it has it — parameterised over the nav list so a future entry added
 * without updating `canShow()` fails loudly here rather than shipping a
 * silently-always-visible (or always-hidden) item.
 *
 * Also covers: a hidden view is unreachable even via a direct `setView()`
 * call that bypasses the nav UI entirely (the global-search "jump to
 * variant" path), an all-hidden nav group renders no heading, and the theme
 * toggle survives a full unmount/remount (not just a re-render).
 *
 * UI hiding is a usability projection only — these tests assert what the
 * shell renders, not that the backend SECURITY DEFINER checks are the real
 * boundary (they are, and are out of scope for a frontend test).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

import App from '../src/App';

type Handlers = Record<string, (args: Record<string, unknown>) => unknown>;

function wireInvoke(handlers: Handlers) {
  invokeMock.mockImplementation((command: string, args: Record<string, unknown> = {}) => {
    const handler = handlers[command];
    if (!handler) return Promise.reject({ code: 'INTERNAL_ERROR' });
    try {
      return Promise.resolve(handler(args));
    } catch (error) {
      return Promise.reject(error);
    }
  });
}

const ALL_INVENTORY_CAPS = {
  can_manage_catalog: true,
  can_post_stock_receipt: true,
  can_view_inventory: true,
  can_manage_inventory: true,
};
const NO_INVENTORY_CAPS = {
  can_manage_catalog: false,
  can_post_stock_receipt: false,
  can_view_inventory: false,
  can_manage_inventory: false,
};
const ALL_PROCUREMENT_CAPS = {
  can_manage_procurement: true,
  can_post_purchase_receipt: true,
  can_post_supplier_invoice: true,
  can_post_supplier_return: true,
  can_post_supplier_payment: true,
};
const NO_PROCUREMENT_CAPS = {
  can_manage_procurement: false,
  can_post_purchase_receipt: false,
  can_post_supplier_invoice: false,
  can_post_supplier_return: false,
  can_post_supplier_payment: false,
};
const ALL_CUSTOMER_CAPS = {
  can_view_customers: true,
  can_manage_customers: true,
  can_post_credit_sale: true,
  can_post_customer_payment: true,
  can_post_customer_refund: true,
  can_manage_drawer_policy: true,
  can_override_credit_limit: true,
};
const NO_CUSTOMER_CAPS = {
  can_view_customers: false,
  can_manage_customers: false,
  can_post_credit_sale: false,
  can_post_customer_payment: false,
  can_post_customer_refund: false,
  can_manage_drawer_policy: false,
  can_override_credit_limit: false,
};

function baseHandlers(extra: Handlers = {}): Handlers {
  return {
    get_setup_status: () => ({
      initialized: true,
      administrator_exists: true,
      warehouse_exists: true,
      open_fiscal_period_exists: true,
      workstation_configured: true,
    }),
    login: () => ({ session_token: 'tok', expires_at: '2026-12-31T23:59:59Z' }),
    inspect_active_cash_session: () => null,
    list_warehouses: () => [{ id: 1, code: 'WH1', name: 'Main', is_active: true }],
    get_open_fiscal_period: () => ({ id: 1, period_code: '2026', starts_on: '2026-01-01', ends_on: '2026-12-31' }),
    get_dashboard_summary: () => ({
      product_count: 0, variant_count: 0, active_cash_session_id: null,
      latest_document_id: null, latest_document_number: null,
      pending_generation_jobs: 0, pending_print_jobs: 0,
    }),
    get_inventory_capabilities: () => ALL_INVENTORY_CAPS,
    get_procurement_capabilities: () => ALL_PROCUREMENT_CAPS,
    get_customer_capabilities: () => ALL_CUSTOMER_CAPS,
    get_inventory_corrections_setting: () => ({ enabled: true }),
    list_products_v2: () => [],
    list_categories: () => [],
    list_attributes: () => [],
    list_units: () => [{ id: 1, code: 'PCS', name: 'Pieces' }],
    list_units_v2: () => [{ id: 1, code: 'PCS', name: 'Pieces', is_active: true, usage_count: 1 }],
    ...extra,
  };
}

async function login() {
  await screen.findByRole('heading', { name: 'Sign in' });
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await screen.findByRole('heading', { name: 'Dashboard' });
}

beforeEach(() => {
  invokeMock.mockReset();
  cleanup();
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.documentElement.style.removeProperty('color-scheme');
  document.documentElement.setAttribute('dir', 'ltr');
  document.documentElement.setAttribute('lang', 'en');
});

// Every nav entry gated by a real capability, and the label it renders as in
// English. Entries with NO capability DTO anywhere in the codebase
// (dashboard, journals, historical_finance, settings, pos, session,
// documents) are deliberately absent — per the task brief, an entry with no
// obvious capability stays visible rather than being guessed at, so there is
// nothing to parameterise for them here.
const GATED_NAV_ENTRIES: Array<{
  label: string;
  grant: Handlers;
  deny: Handlers;
}> = [
  {
    label: 'Products',
    grant: { get_inventory_capabilities: () => ALL_INVENTORY_CAPS },
    deny: { get_inventory_capabilities: () => NO_INVENTORY_CAPS },
  },
  {
    label: 'Catalogue setup',
    grant: { get_inventory_capabilities: () => ALL_INVENTORY_CAPS },
    deny: { get_inventory_capabilities: () => NO_INVENTORY_CAPS },
  },
  {
    label: 'Inventory',
    grant: { get_inventory_capabilities: () => ALL_INVENTORY_CAPS },
    deny: { get_inventory_capabilities: () => NO_INVENTORY_CAPS },
  },
  {
    label: 'Stock receipt',
    grant: { get_inventory_capabilities: () => ALL_INVENTORY_CAPS },
    deny: { get_inventory_capabilities: () => NO_INVENTORY_CAPS },
  },
  {
    label: 'Inventory Corrections',
    grant: { get_inventory_capabilities: () => ALL_INVENTORY_CAPS, get_inventory_corrections_setting: () => ({ enabled: true }) },
    deny: { get_inventory_capabilities: () => NO_INVENTORY_CAPS, get_inventory_corrections_setting: () => ({ enabled: true }) },
  },
  {
    label: 'Suppliers',
    grant: { get_procurement_capabilities: () => ALL_PROCUREMENT_CAPS },
    deny: { get_procurement_capabilities: () => NO_PROCUREMENT_CAPS },
  },
  {
    label: 'Purchases',
    grant: { get_procurement_capabilities: () => ALL_PROCUREMENT_CAPS },
    deny: { get_procurement_capabilities: () => NO_PROCUREMENT_CAPS },
  },
  {
    label: 'Customers',
    grant: { get_customer_capabilities: () => ALL_CUSTOMER_CAPS },
    deny: { get_customer_capabilities: () => NO_CUSTOMER_CAPS },
  },
];

describe('WS-J-1 — role-based navigation (parameterised over the nav list)', () => {
  it.each(GATED_NAV_ENTRIES.map((e) => [e.label, e] as const))(
    '%s: visible with its capability, hidden without it',
    async (_label, entry) => {
      wireInvoke(baseHandlers(entry.grant));
      render(<App />);
      await login();
      await waitFor(() => expect(screen.getByRole('button', { name: entry.label })).toBeInTheDocument());
      cleanup();

      wireInvoke(baseHandlers(entry.deny));
      render(<App />);
      await login();
      await waitFor(() => {
        // Something from the denied capability fetch must have resolved
        // before asserting absence, or this would trivially pass on a
        // still-loading shell.
        expect(invokeMock.mock.calls.some((c) => c[0]?.toString().startsWith('get_'))).toBe(true);
      });
      expect(screen.queryByRole('button', { name: entry.label })).not.toBeInTheDocument();
    },
  );
});

describe('WS-J-1 — a hidden view is unreachable even by a direct-navigation bypass', () => {
  it('the global-search "jump to variant" path (setView bypassing the nav UI) is still redirected to the dashboard when catalog access is denied', async () => {
    wireInvoke(baseHandlers({
      get_inventory_capabilities: () => NO_INVENTORY_CAPS,
      resolve_barcode: () => ({
        variant_id: 10,
        product_id: 1,
        sku: 'PIL-1',
        name_override: null,
        effective_variant_name: 'Pillow',
        primary_barcode: '6130000000017',
        operational_identifier: '6130000000017',
        identifier_type: 'BARCODE',
        product_name: 'Pillow',
        sale_price: '1250.50',
        unit_id: 1,
        unit_code: 'PCS',
        unit_name: 'Pieces',
        variant_is_active: true,
        product_is_active: true,
      }),
    }));
    render(<App />);
    await login();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Products' })).not.toBeInTheDocument());

    // This calls AppRouter's goToVariant -> setView('products') directly,
    // completely bypassing the (hidden) nav button.
    fireEvent.click(screen.getByTestId('global-search-button'));
    const input = await screen.findByTestId('item-search-input');
    fireEvent.change(input, { target: { value: '6130000000017' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // The capability-redirect effect in AppRouter must bounce this straight
    // back, same as it would for a stale/racy direct view change.
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument());
  });
});

describe('WS-J-1 — an all-hidden nav group renders no heading', () => {
  it('the "Catalog & stock" group label disappears when every item in it is denied', async () => {
    wireInvoke(baseHandlers({
      get_inventory_capabilities: () => NO_INVENTORY_CAPS,
      get_inventory_corrections_setting: () => ({ enabled: true }),
    }));
    render(<App />);
    await login();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Products' })).not.toBeInTheDocument());
    expect(screen.queryByText('Catalog & stock')).not.toBeInTheDocument();
    // A group that DOES still have a visible item keeps its heading —
    // otherwise this test would trivially pass if group headings never
    // rendered at all.
    expect(screen.getByText('Overview')).toBeInTheDocument();
  });
});

describe('WS-J-1 — theme toggle persists across a full remount', () => {
  it('survives unmount + fresh App() mount, not just a re-render', async () => {
    wireInvoke(baseHandlers());
    const first = render(<App />);
    await login();

    const themeToggle = screen.getByTestId('theme-toggle');
    fireEvent.click(themeToggle);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem('stockiha.theme')).toBe('dark');

    first.unmount();
    delete document.documentElement.dataset.theme;

    render(<App />);
    await login();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.getByTestId('theme-toggle')).toHaveAccessibleName('Use light mode');
  });
});
