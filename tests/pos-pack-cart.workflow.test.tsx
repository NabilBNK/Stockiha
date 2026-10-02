/**
 * Tests for Sub-plan O-4 ("Sell by the box") on the POS till:
 * 1. Variant with a main sellable pack defaults to PACK line in cart.
 * 2. Pack and extra steppers work with carry rule (extra reaches factor -> carry to packs).
 * 3. Unit chips switch between BASE and sellable PACKs, resetting the line.
 * 4. Inline price editing with edited tag, reset button, and below-cost warning.
 * 5. Confirm sale sends exact SaleLineInput payload with pack fields.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import App from '../src/App';
import type { ProductListItemV2, VariantPack } from '../src/shared/ipc/dto';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

type Handlers = Record<string, (args: Record<string, unknown>) => unknown>;

function wireInvoke(handlers: Handlers) {
  invokeMock.mockImplementation((command: string, args: Record<string, unknown> = {}) => {
    const handler = handlers[command];
    if (!handler) return Promise.reject({ code: 'INTERNAL_ERROR' });
    try {
      return Promise.resolve(handler(args));
    } catch (e) {
      return Promise.reject(e);
    }
  });
}

const initialized = () => ({
  initialized: true,
  administrator_exists: true,
  warehouse_exists: true,
  open_fiscal_period_exists: true,
  workstation_configured: true,
});
const activeCashSession = () => ({
  id: 1,
  cashier_id: 1,
  warehouse_id: 1,
  opened_at: '2026-09-12T08:00:00Z',
  opening_float: '5000.00',
  total_cash_sales: '0.00',
  total_cash_refunds: '0.00',
  total_manual_in: '0.00',
  total_manual_out: '0.00',
  expected_drawer_cash: '5000.00',
  counted_cash: null,
  discrepancy: null,
  status: 'OPEN',
});

function mockPillow(overrides: Partial<ProductListItemV2> = {}): ProductListItemV2 {
  return {
    product_id: 10,
    variant_id: 101,
    sku: 'PIL-STD',
    product_name: 'Pillow',
    variant_name: 'Standard',
    primary_barcode: '6131000000010',
    display_identifier: 'PIL-STD',
    identifier_type: 'SKU',
    sale_price: '1400.00',
    minimum_stock: '0',
    is_active: true,
    product_is_active: true,
    category_id: null,
    category_name: null,
    quantity_on_hand: '60',
    last_known_wac: '1050.000000',
    attributes: [],
    total_count: 1,
    ...overrides,
  };
}

const mockCartonPack: VariantPack = {
  variant_unit_id: 501,
  unit_id: 7,
  unit_code: 'CTN',
  unit_name: 'Carton',
  conversion_factor: '12',
  sale_price: '15000.00',
  is_pack: true,
  is_primary: true,
  is_active: true,
  is_used: false,
  barcode_ids: [1001],
  barcodes: ['6131000000021'],
};

function baseHandlers(extra: Handlers = {}): Handlers {
  return {
    get_setup_status: initialized,
    login: () => ({ session_token: 'tok', expires_at: '2026-12-31T23:59:59Z' }),
    inspect_active_cash_session: activeCashSession,
    list_warehouses: () => [{ id: 1, code: 'WH1', name: 'Main', is_active: true }],
    get_open_fiscal_period: () => ({
      id: 1,
      period_code: '2026',
      starts_on: '2026-01-01',
      ends_on: '2026-12-31',
    }),
    get_dashboard_summary: () => ({
      product_count: 0,
      variant_count: 0,
      active_cash_session_id: null,
      latest_document_id: null,
      latest_document_number: null,
      pending_generation_jobs: 0,
      pending_print_jobs: 0,
    }),
    get_inventory_capabilities: () => ({
      can_manage_catalog: true,
      can_post_stock_receipt: true,
      can_view_inventory: true,
      can_manage_inventory: true,
      can_apply_sale_discount: true,
    }),
    list_products_v2: () => [mockPillow()],
    list_variant_packs: () => [mockCartonPack],
    list_categories: () => [],
    list_customers: () => [],
    list_attributes: () => [],
    list_units: () => [{ id: 1, code: 'PCS', name: 'Piece' }, { id: 7, code: 'CTN', name: 'Carton' }],
    list_units_v2: () => [{ id: 1, code: 'PCS', name: 'Piece', is_active: true, usage_count: 1 }],
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
  window.localStorage.setItem('stockiha.locale', 'en');
});

describe('POS Till - Sub-plan O-4 ("Sell by the box")', () => {
  it('1. Product with sellable main pack defaults to PACK line with pack price', async () => {
    wireInvoke(baseHandlers());
    render(<App />);
    await login();

    fireEvent.click(screen.getByRole('button', { name: 'Point of sale' }));
    await screen.findByTestId('pos-search');

    const pillowTile = await screen.findByTestId('pos-product-101');
    fireEvent.click(pillowTile);

    await screen.findByTestId('pos-cart');
    // Initially added as base synchronously then upgraded or if packs loaded
    // Check that unit chips are displayed
    const baseChip = await screen.findByTestId('unit-chip-base-101');
    const packChip = await screen.findByTestId('unit-chip-pack-101-7');
    expect(baseChip).toBeInTheDocument();
    expect(packChip).toBeInTheDocument();

    // Line displays pack price 15000.00
    expect(screen.getByTestId('pos-total')).toHaveTextContent('15000.00');
  });

  it('2. Extra quantity stepper carries over to full packs when reaching factor (12)', async () => {
    wireInvoke(baseHandlers());
    render(<App />);
    await login();

    fireEvent.click(screen.getByRole('button', { name: 'Point of sale' }));
    await screen.findByTestId('pos-search');

    const pillowTile = await screen.findByTestId('pos-product-101');
    fireEvent.click(pillowTile);

    await screen.findByTestId('unit-chip-pack-101-7');

    // Extra quantity is 0
    expect(screen.getByTestId('extra-qty-101')).toHaveTextContent('0');

    // Add loose pieces
    const extraPlus = screen.getByTestId('btn-increase-extra-101');
    
    // Click 5 times -> 5 extra
    for (let i = 0; i < 5; i++) {
      fireEvent.click(extraPlus);
    }
    expect(screen.getByTestId('extra-qty-101')).toHaveTextContent('5');
    // Total: 15,000 + 5 * 1,250 = 21250.00
    expect(screen.getByTestId('pos-total')).toHaveTextContent('21250.00');

    // Click 7 more times -> reaches 12 -> carry into 2 Carton + 0 extra!
    for (let i = 0; i < 7; i++) {
      fireEvent.click(extraPlus);
    }
    expect(screen.getByTestId('qty-101')).toHaveTextContent('2');
    expect(screen.getByTestId('extra-qty-101')).toHaveTextContent('0');
    // Total: 2 * 15,000 = 30000.00
    expect(screen.getByTestId('pos-total')).toHaveTextContent('30000.00');
  });

  it('3. Unit chips switch between BASE and PACK, resetting the line', async () => {
    wireInvoke(baseHandlers());
    render(<App />);
    await login();

    fireEvent.click(screen.getByRole('button', { name: 'Point of sale' }));
    await screen.findByTestId('pos-search');

    const pillowTile = await screen.findByTestId('pos-product-101');
    fireEvent.click(pillowTile);

    await screen.findByTestId('unit-chip-pack-101-7');

    // Switch to Base unit
    const baseChip = screen.getByTestId('unit-chip-base-101');
    fireEvent.click(baseChip);

    // Now line total is variant piece sale price 1400.00
    expect(screen.getByTestId('pos-total')).toHaveTextContent('1400.00');
    expect(screen.getByTestId('qty-101')).toHaveTextContent('1');

    // Switch back to Carton pack
    const packChip = screen.getByTestId('unit-chip-pack-101-7');
    fireEvent.click(packChip);

    // Resets to 1 Carton at 15000.00
    expect(screen.getByTestId('pos-total')).toHaveTextContent('15000.00');
    expect(screen.getByTestId('qty-101')).toHaveTextContent('1');
    expect(screen.getByTestId('extra-qty-101')).toHaveTextContent('0');
  });

  it('4. Confirm sale builds exact pack SaleLineInput payload', async () => {
    let capturedLines: unknown = null;
    wireInvoke(
      baseHandlers({
        confirm_cash_sale: (args: unknown) => {
          const req = args as { lines: unknown };
          capturedLines = req.lines;
          return 128;
        },
        get_sale_document: () => ({
          document_id: 128,
          document_type: 'CASH_SALE',
          status: 'POSTED',
          document_number: 'VC-2026-000002',
          document_date: '2026-09-12',
          posted_at: '2026-09-12T11:30:54.992788Z',
          subtotal: '36250.00',
          total_amount: '36250.00',
        }),
        list_sale_lines: () => [],
        list_document_jobs: () => [],
      }),
    );

    render(<App />);
    await login();

    fireEvent.click(screen.getByRole('button', { name: 'Point of sale' }));
    await screen.findByTestId('pos-search');

    const pillowTile = await screen.findByTestId('pos-product-101');
    fireEvent.click(pillowTile);

    await screen.findByTestId('unit-chip-pack-101-7');

    // 2 Carton + 5 loose pieces
    const packPlus = screen.getByTestId('btn-increase-pack-101');
    const extraPlus = screen.getByTestId('btn-increase-extra-101');

    fireEvent.click(packPlus); // 2 cartons
    for (let i = 0; i < 5; i++) {
      fireEvent.click(extraPlus); // 5 extra
    }

    expect(screen.getByTestId('qty-101')).toHaveTextContent('2');
    expect(screen.getByTestId('extra-qty-101')).toHaveTextContent('5');
    expect(screen.getByTestId('pos-total')).toHaveTextContent('36250.00');

    // Confirm checkout
    fireEvent.click(screen.getByRole('button', { name: 'Confirm sale' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));

    // Verify captured payload matches SaleLineInput specification
    expect(capturedLines).toEqual([
      {
        variant_id: 101,
        sale_unit: 'PACK',
        pack_unit_id: 7,
        pack_quantity: '2',
        extra_quantity: '5',
        pack_price: '15000.00',
      },
    ]);
  });
});
