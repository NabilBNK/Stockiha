/**
 * WS-D-15 (D-7) — global barcode-first search. Covers the shell's Ctrl+K /
 * search-button entry point, the barcode-first-then-text-fallback resolution
 * order, the 300ms debounce on plain typing, and that POS routes its own
 * Enter-to-search through the exact same shared resolver
 * (src/shared/search/barcodeFirstSearch.ts) rather than a second copy of the
 * lookup logic.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));

import App from '../src/App';

type Handlers = Record<string, (args: Record<string, unknown>) => unknown>;

function wireInvoke(handlers: Handlers) {
  invokeMock.mockImplementation((command: string, args: Record<string, unknown> = {}) => {
    const handler = handlers[command];
    if (!handler) return Promise.reject({ code: 'INTERNAL_ERROR' });
    try { return Promise.resolve(handler(args)); }
    catch (e) { return Promise.reject(e); }
  });
}

const initialized = () => ({
  initialized: true, administrator_exists: true, warehouse_exists: true,
  open_fiscal_period_exists: true, workstation_configured: true,
});

function activeCashSession() {
  return {
    id: 77,
    warehouse_id: 1,
    opened_by_user_id: 10,
    opening_float: '1000.00',
    opened_at: '2026-07-31T08:00:00Z',
  };
}

function baseHandlers(extra: Handlers = {}): Handlers {
  return {
    get_setup_status: initialized,
    login: () => ({ session_token: 'tok', expires_at: '2026-12-31T23:59:59Z' }),
    inspect_active_cash_session: () => null,
    list_warehouses: () => [{ id: 1, code: 'WH1', name: 'Main', is_active: true }],
    get_open_fiscal_period: () => ({ id: 1, period_code: '2026', starts_on: '2026-01-01', ends_on: '2026-12-31' }),
    get_dashboard_summary: () => ({
      product_count: 0, variant_count: 0, active_cash_session_id: null,
      latest_document_id: null, latest_document_number: null,
      pending_generation_jobs: 0, pending_print_jobs: 0,
    }),
    get_inventory_capabilities: () => ({
      can_manage_catalog: true, can_post_stock_receipt: true,
      can_view_inventory: true, can_manage_inventory: true,
    }),
    list_products_v2: () => [],
    list_categories: () => [],
    list_attributes: () => [],
    list_units: () => [{ id: 1, code: 'PCS', name: 'Pieces' }],
    list_units_v2: () => [{ id: 1, code: 'PCS', name: 'Pieces', is_active: true, usage_count: 1 }],
    ...extra,
  };
}

function resolvedBarcode(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

function productListRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    product_id: 1,
    variant_id: 10,
    sku: 'PIL-1',
    product_name: 'Pillow',
    variant_name: 'Pillow',
    primary_barcode: '6130000000017',
    display_identifier: '6130000000017',
    identifier_type: 'BARCODE',
    sale_price: '1250.50',
    minimum_stock: '0',
    is_active: true,
    product_is_active: true,
    category_id: null,
    category_name: null,
    quantity_on_hand: '12',
    last_known_wac: '900',
    attributes: [],
    total_count: 1,
    ...overrides,
  };
}

function detailFixture(overrides: Record<string, unknown> = {}) {
  return {
    product_id: 1,
    name: 'Pillow',
    unit_id: 1,
    unit_code: 'PCS',
    unit_name: 'Pieces',
    is_active: true,
    category_id: null,
    variants: [{
      variant_id: 10,
      sku: 'PIL-1',
      name_override: null,
      effective_variant_name: 'Pillow',
      primary_barcode: '6130000000017',
      operational_identifier: '6130000000017',
      identifier_type: 'BARCODE',
      sale_price: '1250.50',
      minimum_stock: '0',
      is_active: true,
      attribute_signature: '',
      attributes: [],
      barcodes: [{ id: 1, barcode: '6130000000017', is_primary: true }],
    }],
    ...overrides,
  };
}

async function login() {
  await screen.findByRole('heading', { name: 'Sign in' });
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await screen.findByRole('heading', { name: 'Dashboard' });
}

function openGlobalSearch() {
  fireEvent.click(screen.getByTestId('global-search-button'));
}

beforeEach(() => {
  invokeMock.mockReset();
  cleanup();
  window.localStorage.clear();
  window.localStorage.setItem('stockiha.locale', 'en');
  document.documentElement.setAttribute('lang', 'en');
  document.documentElement.setAttribute('dir', 'ltr');
});

describe('WS-D-15 (D-7) global shell search', () => {
  it('an exact barcode navigates directly to the matched variant with no intermediate list', async () => {
    const listProductsV2 = vi.fn(() => []);
    wireInvoke(baseHandlers({
      resolve_barcode: () => resolvedBarcode(),
      list_products_v2: listProductsV2,
      get_product_detail: () => detailFixture(),
    }));
    render(<App />);
    await login();
    openGlobalSearch();

    const input = await screen.findByTestId('item-search-input');
    fireEvent.change(input, { target: { value: '6130000000017' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Lands directly on the Products page with the matched variant's panel
    // open and that variant selected — no results list is ever shown.
    await screen.findByTestId('catalog2-variant-detail');
    expect(screen.queryByTestId('item-search-modal')).not.toBeInTheDocument();
    const row = screen.getByTestId('catalog2-variant-row-10');
    expect(row.getAttribute('aria-selected')).toBe('true');

    // The direct-navigation path never routed the scanned barcode through the
    // text-search fallback (the Products page's own unrelated list load,
    // search: null, is expected and is not this path).
    expect(listProductsV2).not.toHaveBeenCalledWith(
      expect.objectContaining({ search: '6130000000017' }),
    );
  });

  it('an unmatched barcode falls back to text search and never silently picks a near match', async () => {
    const resolveBarcode = vi.fn(() => null);
    const listProductsV2 = vi.fn(() => [productListRow({ product_name: 'Pillow Cover' })]);
    wireInvoke(baseHandlers({
      resolve_barcode: resolveBarcode,
      list_products_v2: listProductsV2,
    }));
    render(<App />);
    await login();
    openGlobalSearch();

    const input = await screen.findByTestId('item-search-input');
    fireEvent.change(input, { target: { value: '9999999999999' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(resolveBarcode).toHaveBeenCalled();
    // Says plainly that the scan was not found, rather than silently landing
    // on an unrelated item.
    await screen.findByTestId('item-search-notice');
    expect(screen.getByTestId('item-search-notice').textContent).toContain('9999999999999');
    // The modal stays open with text-search results — no auto-navigation.
    await screen.findByTestId('item-search-result-10');
    expect(screen.queryByTestId('catalog2-variant-detail')).not.toBeInTheDocument();
    await waitFor(() => expect(listProductsV2).toHaveBeenCalled());
  });

  it('typing without pressing Enter never calls resolve_barcode, only the debounced text search', async () => {
    const resolveBarcode = vi.fn(() => null);
    const listProductsV2 = vi.fn(() => [productListRow()]);
    wireInvoke(baseHandlers({
      resolve_barcode: resolveBarcode,
      list_products_v2: listProductsV2,
    }));
    render(<App />);
    await login();
    openGlobalSearch();

    const input = await screen.findByTestId('item-search-input');
    fireEvent.change(input, { target: { value: 'pillow' } });

    // Give the 300ms debounce time to fire, without ever pressing Enter.
    await waitFor(() => expect(listProductsV2).toHaveBeenCalled(), { timeout: 2000 });
    expect(resolveBarcode).not.toHaveBeenCalled();
  });
});

describe('WS-D-15 (D-7) POS shares the same resolver', () => {
  it('an exact barcode scanned in POS adds the matched line via the shared resolver, no duplicated lookup logic', async () => {
    const resolveBarcode = vi.fn(() => resolvedBarcode());
    wireInvoke(baseHandlers({
      inspect_active_cash_session: activeCashSession,
      resolve_barcode: resolveBarcode,
      list_products_v2: () => [productListRow()],
      list_customers: () => [],
    }));
    render(<App />);
    await login();
    fireEvent.click(screen.getByRole('button', { name: 'Point of sale' }));
    await screen.findByTestId('pos-search');

    const posInput = screen.getByTestId('pos-search');
    fireEvent.change(posInput, { target: { value: '6130000000017' } });
    fireEvent.keyDown(posInput, { key: 'Enter' });

    await screen.findByTestId('pos-cart');
    expect(screen.getByTestId('qty-10').textContent).toBe('1');
    expect(resolveBarcode).toHaveBeenCalledWith(
      expect.objectContaining({ barcode: '6130000000017' }),
    );
  });

  it('an unmatched barcode in POS says so plainly instead of adding nothing silently', async () => {
    const resolveBarcode = vi.fn(() => null);
    wireInvoke(baseHandlers({
      inspect_active_cash_session: activeCashSession,
      resolve_barcode: resolveBarcode,
      list_products: () => [],
      list_customers: () => [],
    }));
    render(<App />);
    await login();
    fireEvent.click(screen.getByRole('button', { name: 'Point of sale' }));
    await screen.findByTestId('pos-search');

    const posInput = screen.getByTestId('pos-search');
    fireEvent.change(posInput, { target: { value: '0000000000000' } });
    fireEvent.keyDown(posInput, { key: 'Enter' });

    await screen.findByTestId('pos-banner');
    expect(screen.getByTestId('pos-banner').textContent).toContain('0000000000000');
    expect(screen.queryByTestId('pos-cart')).not.toBeInTheDocument();
  });
});
