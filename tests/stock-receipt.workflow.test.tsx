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

const mockCatalog = [
  {
    product_id: 1,
    variant_id: 10,
    sku: 'SKU-HAMMER',
    name: 'Steel Hammer',
    product_name: 'Hammer',
    variant_name: 'Steel Hammer',
    sale_price: '1500.00',
    is_active: true,
    quantity_on_hand: '12.000',
    last_known_wac: '850.000000',
    primary_barcode: '777000111222',
  },
  {
    product_id: 2,
    variant_id: 20,
    sku: 'SKU-SCREW',
    name: 'Wood Screw 50mm',
    product_name: 'Screw',
    variant_name: 'Wood Screw 50mm',
    sale_price: '5.00',
    is_active: true,
    quantity_on_hand: '500.000',
    last_known_wac: '2.500000',
    primary_barcode: '888000333444',
  },
];

const mockPurchaseOptions = [
  {
    product_id: 1,
    variant_id: 10,
    sku: 'SKU-HAMMER',
    product_name: 'Hammer',
    variant_name: 'Steel Hammer',
    primary_barcode: '777000111222',
    brand: { id: 1, name: 'Tolsen' },
    default_unit_id: 1,
    default_unit_code: 'PC',
    default_unit_name: 'Piece',
    alternate_units: [],
    attributes: [],
    is_active: true,
    default_unit_cost: '800.00',
    last_purchase_cost: '820.00',
  },
  {
    product_id: 2,
    variant_id: 20,
    sku: 'SKU-SCREW',
    product_name: 'Screw',
    variant_name: 'Wood Screw 50mm',
    primary_barcode: '888000333444',
    brand: null,
    default_unit_id: 1,
    default_unit_code: 'PC',
    default_unit_name: 'Piece',
    alternate_units: [],
    attributes: [],
    is_active: true,
    default_unit_cost: '2.00',
    last_purchase_cost: '2.40',
  },
];

function handlers(extra: Handlers = {}): Handlers {
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
    get_open_fiscal_period: () => ({
      id: 9,
      period_code: '2026',
      starts_on: '2026-07-01',
      ends_on: '2026-07-31',
    }),
    get_dashboard_summary: () => ({
      product_count: 2,
      variant_count: 2,
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
    }),
    list_products: () => mockCatalog,
    list_purchase_product_options: () => mockPurchaseOptions,
    list_stock_adjustment_units: () => [
      { unit_id: 1, unit_code: 'PC', unit_name: 'Piece', conversion_factor: '1', is_base: true },
    ],
    ...extra,
  };
}

async function loginAndNavigateToStockReceipt() {
  await screen.findByRole('heading', { name: 'Sign in' });
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Stock receipt' }));
  await screen.findByRole('heading', { name: 'Stock receipt' });
}

beforeEach(() => {
  invokeMock.mockReset();
  cleanup();
  document.documentElement.setAttribute('dir', 'ltr');
  document.documentElement.setAttribute('lang', 'en');
});

describe('Stock Receipt modern item search and picker workflow', () => {
  it('opens item picker modal, filters items, and selecting an item updates context and pre-fills cost', async () => {
    wireInvoke(handlers());
    render(<App />);
    await loginAndNavigateToStockReceipt();

    // Verify fast entry toolbar is present
    expect(screen.getByTestId('stock-barcode-input')).toBeInTheDocument();
    const chooseBtn = screen.getByTestId('stock-open-picker-btn');
    expect(chooseBtn).toBeInTheDocument();

    // Open item picker
    fireEvent.click(chooseBtn);
    expect(await screen.findByTestId('purchase-item-picker')).toBeInTheDocument();

    // Search for Screw
    const searchInput = screen.getByTestId('purchase-item-picker-input');
    fireEvent.change(searchInput, { target: { value: 'Screw' } });

    // Option 20 (Screw) is visible, Option 10 (Hammer) is filtered out
    const screwOption = await screen.findByTestId('purchase-item-option-20');
    expect(screwOption).toHaveTextContent('Wood Screw 50mm');
    expect(screen.queryByTestId('purchase-item-option-10')).not.toBeInTheDocument();

    // Select Screw
    fireEvent.click(screwOption);

    // Modal closes
    await waitFor(() => expect(screen.queryByTestId('purchase-item-picker')).not.toBeInTheDocument());

    // Selected item card displays Screw details
    const card = screen.getByTestId('stock-selected-item-card');
    expect(card).toHaveTextContent('Wood Screw 50mm');
    expect(card).toHaveTextContent('SKU-SCREW');
    expect(card).toHaveTextContent('888000333444');

    // Unit cost is pre-filled with last purchase cost (2.40)
    const costInput = screen.getByLabelText('Unit cost') as HTMLInputElement;
    expect(costInput.value).toBe('2.40');
  });

  it('scans barcode via fast barcode input to select item immediately', async () => {
    wireInvoke(handlers());
    render(<App />);
    await loginAndNavigateToStockReceipt();

    const barcodeInput = screen.getByTestId('stock-barcode-input');
    fireEvent.change(barcodeInput, { target: { value: '777000111222' } });
    fireEvent.keyDown(barcodeInput, { key: 'Enter' });

    // Selected item card displays Hammer
    const card = await screen.findByTestId('stock-selected-item-card');
    expect(card).toHaveTextContent('Steel Hammer');
    expect(card).toHaveTextContent('SKU-HAMMER');

    // Unit cost is pre-filled with last purchase cost (820.00)
    const costInput = screen.getByLabelText('Unit cost') as HTMLInputElement;
    expect(costInput.value).toBe('820.00');
  });

  it('shows inline error when unknown barcode is scanned', async () => {
    wireInvoke(handlers());
    render(<App />);
    await loginAndNavigateToStockReceipt();

    const barcodeInput = screen.getByTestId('stock-barcode-input');
    fireEvent.change(barcodeInput, { target: { value: '999999999999' } });
    fireEvent.keyDown(barcodeInput, { key: 'Enter' });

    expect(await screen.findByTestId('stock-barcode-error')).toBeInTheDocument();
  });

  it('posts stock receipt with selected item and displays resulting metrics', async () => {
    let postArgs: Record<string, unknown> | null = null;
    wireInvoke(
      handlers({
        post_stock_receipt: (args) => {
          postArgs = args;
          return {
            document_number: 'SR-2026-000001',
            received_quantity: '5.000',
            received_value: '4100.0000',
            resulting_quantity_on_hand: '17.000',
            resulting_total_value: '14300.0000',
            resulting_wac: '841.176471',
          };
        },
      }),
    );
    render(<App />);
    await loginAndNavigateToStockReceipt();

    // Select Hammer via barcode
    const barcodeInput = screen.getByTestId('stock-barcode-input');
    fireEvent.change(barcodeInput, { target: { value: '777000111222' } });
    fireEvent.keyDown(barcodeInput, { key: 'Enter' });

    // Enter quantity
    const qtyInput = screen.getByTestId('stock-quantity');
    fireEvent.change(qtyInput, { target: { value: '5' } });

    // Submit receipt
    const submitBtn = screen.getByRole('button', { name: 'Receive stock' });
    expect(submitBtn).toBeEnabled();
    fireEvent.click(submitBtn);

    await waitFor(() => expect(postArgs).not.toBeNull());
    expect(postArgs!.variantId).toBe(10);
    expect(postArgs!.quantity).toBe('5');
    expect(postArgs!.unitCost).toBe('820.00');

    expect(await screen.findByTestId('stock-banner')).toHaveTextContent('SR-2026-000001');
    const resultCard = screen.getByTestId('stock-result');
    expect(resultCard).toHaveTextContent('SR-2026-000001');
    expect(resultCard).toHaveTextContent('4100 DZD');
  });
});
