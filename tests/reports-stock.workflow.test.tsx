// WS-I-3 STEP I3-11 — stock reports and the Prepare purchase -> Purchases
// prefill hand-off.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

vi.mock('../src/shared/documents/useOfficialDocumentContext', () => ({
  useOfficialDocumentContext: () => ({ identity: { shopName: 'Test Shop' }, loading: false, reload: () => {} }),
}));

vi.mock('../src/shared/documents/documentPrintService', () => ({
  printDocumentA4: vi.fn(),
  saveDocumentFileWithDialog: vi.fn().mockResolvedValue({ saved: true }),
}));

vi.mock('../src/shared/documents/officialDocument', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/shared/documents/officialDocument')>();
  return {
    ...actual,
    renderOfficialDocumentHtml: vi.fn(() => '<html></html>'),
    renderOfficialDocumentPdf: vi.fn(async () => new Uint8Array([1, 2, 3])),
  };
});

import App from '../src/App';
import { PURCHASE_PREFILL_STORAGE_KEY } from '../src/features/reports/stock/LowStockReport';

type Handlers = Record<string, (args: Record<string, unknown>) => unknown>;

function wireInvoke(handlers: Handlers) {
  invokeMock.mockImplementation((command: string, args: Record<string, unknown> = {}) => {
    const handler = handlers[command];
    if (!handler) return Promise.reject({ code: 'INTERNAL_ERROR', message: `No mock for ${command}` });
    try {
      return Promise.resolve(handler(args));
    } catch (error) {
      return Promise.reject(error);
    }
  });
}

const lowStockRowV1 = {
  variant_id: 1,
  product_name: 'Widget',
  variant_label: 'Red',
  sku: 'SKU-1',
  on_hand: '20',
  minimum_stock: '50',
  suggested_qty_base: '80',
  suggested_packs: '8',
  base_unit_name: 'piece',
  pack_unit_name: 'carton',
  pack_factor: '10',
  last_supplier_id: 501,
  last_supplier_name: 'Supplier One',
  last_unit_cost: '450.00',
  last_purchase_date: '2026-08-01',
};

const lowStockRowV2 = {
  variant_id: 2,
  product_name: 'Gadget',
  variant_label: 'Blue',
  sku: 'SKU-2',
  on_hand: '0',
  minimum_stock: '10',
  suggested_qty_base: '20',
  suggested_packs: null,
  base_unit_name: 'piece',
  pack_unit_name: null,
  pack_factor: null,
  last_supplier_id: 502,
  last_supplier_name: 'Supplier Two',
  last_unit_cost: '90.00',
  last_purchase_date: '2026-08-05',
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
    logout: () => null,
    inspect_active_cash_session: () => null,
    list_warehouses: () => [{ id: 1, code: 'WH1', name: 'Main Warehouse', is_active: true }],
    get_open_fiscal_period: () => ({ id: 9, period_code: '2026', starts_on: '2026-01-01', ends_on: '2026-12-31' }),
    get_dashboard_summary: () => ({
      product_count: 0,
      variant_count: 0,
      active_cash_session_id: null,
      latest_document_id: null,
      latest_document_number: null,
      pending_generation_jobs: 0,
      pending_print_jobs: 0,
    }),
    get_reports_capabilities: () => ({ can_view_reports: true }),
    get_today_overview: () => Promise.reject({ code: 'INTERNAL_ERROR' }),
    get_report_notifications: () => ({ generated_at: '2026-09-25T00:00:00Z', items: [] }),
    get_procurement_capabilities: () => ({
      can_manage_procurement: true,
      can_post_purchase_receipt: true,
      can_post_supplier_invoice: true,
      can_post_supplier_return: true,
      can_post_supplier_payment: true,
    }),
    list_categories: () => [],
    get_stock_valuation: () => ({
      total_count: 1,
      rows: [{
        variant_id: 1, product_name: 'Widget', variant_label: 'Red', sku: 'SKU-1', category_name: null,
        quantity_base: '20', base_unit_name: 'piece', pack_unit_name: null, pack_factor: null,
        wac: '100.00', stock_value: '2000.00', sale_price: '150.00', retail_value: '3000.00', potential_margin: '1000.00',
      }],
      totals: { variant_count: 1, stock_value: '2000.00', retail_value: '3000.00', potential_margin: '1000.00' },
    }),
    get_low_stock: () => ({ total_count: 2, rows: [lowStockRowV1, lowStockRowV2] }),
    get_slow_movers: () => ({
      days: 90,
      total_count: 1,
      rows: [{
        variant_id: 3, product_name: 'Dormant', variant_label: null, sku: 'SKU-3', on_hand: '5',
        base_unit_name: 'piece', pack_unit_name: null, pack_factor: null, stock_value: '500.00',
        last_sale_date: null, days_since_last_sale: null, last_purchase_date: null,
      }],
      totals: { variant_count: 1, stock_value: '500.00' },
    }),
    list_purchase_product_options: () => [
      { product_id: 1, variant_id: 1, sku: 'SKU-1', product_name: 'Widget', variant_name: 'Red', default_unit_id: 1, default_unit_code: 'UNIT', default_unit_name: 'Piece', alternate_units: [], attributes: [], is_active: true },
      { product_id: 2, variant_id: 2, sku: 'SKU-2', product_name: 'Gadget', variant_name: 'Blue', default_unit_id: 1, default_unit_code: 'UNIT', default_unit_name: 'Piece', alternate_units: [], attributes: [], is_active: true },
    ],
    list_suppliers: () => [
      { id: 501, code: 'SUP-501', name: 'Supplier One', contact_name: null, phone: null, email: null, address: null, tax_id: null, is_active: true, created_at: '2026-01-01T00:00:00Z' },
      { id: 502, code: 'SUP-502', name: 'Supplier Two', contact_name: null, phone: null, email: null, address: null, tax_id: null, is_active: true, created_at: '2026-01-01T00:00:00Z' },
    ],
    list_purchase_receipts: () => [],
    list_purchase_payment_status: () => [],
    confirm_direct_purchase: () => ({
      document_id: 1,
      document_number: 'PR-1',
      supplier_id: 501,
      warehouse_id: 1,
      total_amount: '100.00',
      receipt_origin: 'DIRECT_PURCHASE',
    }),
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

async function openStockTab() {
  fireEvent.click(await screen.findByRole('button', { name: 'Reports' }));
  await screen.findByTestId('reports-tab-sales');
  fireEvent.click(screen.getByTestId('reports-tab-stock'));
}

beforeEach(() => {
  invokeMock.mockReset();
  cleanup();
  document.documentElement.setAttribute('dir', 'ltr');
  document.documentElement.setAttribute('lang', 'en');
  window.localStorage.setItem('stockiha.locale', 'en');
  window.sessionStorage.removeItem('stockiha.reports.lastTab');
  window.sessionStorage.removeItem(PURCHASE_PREFILL_STORAGE_KEY);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('WS-I-3 stock reports workflow', () => {
  it('renders each stock sub-report with its main test id', async () => {
    wireInvoke(baseHandlers());
    render(<App />);
    await login();
    await openStockTab();

    await screen.findByTestId('table-stock-valuation');
    fireEvent.click(screen.getByTestId('reports-sub-low-stock'));
    await screen.findByTestId('table-low-stock');
    fireEvent.click(screen.getByTestId('reports-sub-slow-movers'));
    await screen.findByTestId('table-slow-movers');
    fireEvent.click(screen.getByTestId('reports-sub-product-history'));
    await screen.findByTestId('history-product');
  });

  it('shows the multi-supplier dialog when the selected rows have 2 different suppliers, and prepares the purchase with the chosen supplier', async () => {
    wireInvoke(baseHandlers());
    render(<App />);
    await login();
    await openStockTab();
    fireEvent.click(screen.getByTestId('reports-sub-low-stock'));
    await screen.findByTestId('table-low-stock');

    fireEvent.click(screen.getByTestId('low-select-1'));
    fireEvent.click(screen.getByTestId('low-select-2'));
    fireEvent.click(screen.getByTestId('prepare-purchase'));

    await screen.findByTestId('prepare-supplier-dialog');
    fireEvent.click(screen.getByTestId('prepare-supplier-501'));

    await waitFor(() => {
      const raw = window.sessionStorage.getItem(PURCHASE_PREFILL_STORAGE_KEY);
      expect(raw).toBeNull(); // consumed by PurchasesScreen's prefill reader below
    });
    await screen.findByTestId('purchase-prefill-banner');
  });

  it('a prefill older than 10 minutes is ignored and removed; malformed JSON is ignored without a crash', async () => {
    window.sessionStorage.setItem(
      PURCHASE_PREFILL_STORAGE_KEY,
      JSON.stringify({ created_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(), supplier_id: null, lines: [{ variant_id: 1, quantity_base: 5, unit_cost: null }] }),
    );
    wireInvoke(baseHandlers());
    render(<App />);
    await login();
    fireEvent.click(await screen.findByRole('button', { name: 'Purchases' }));
    await screen.findByTestId('create-po-btn');
    expect(screen.queryByTestId('purchase-prefill-banner')).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem(PURCHASE_PREFILL_STORAGE_KEY)).toBeNull();
  });

  it('malformed prefill JSON is ignored without crashing the Purchases screen', async () => {
    window.sessionStorage.setItem(PURCHASE_PREFILL_STORAGE_KEY, '{not valid json');
    wireInvoke(baseHandlers());
    render(<App />);
    await login();
    fireEvent.click(await screen.findByRole('button', { name: 'Purchases' }));
    await screen.findByTestId('create-po-btn');
    expect(screen.queryByTestId('purchase-prefill-banner')).not.toBeInTheDocument();
  });
});
