import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

import App from '../src/App';

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
    list_warehouses: () => [{ id: 1, code: 'WH1', name: 'Main Warehouse', is_active: true }],
    get_open_fiscal_period: () => ({
      id: 9,
      period_code: '2026-Q1',
      starts_on: '2026-01-01',
      ends_on: '2026-03-31',
    }),
    get_dashboard_summary: () => ({
      product_count: 1,
      variant_count: 1,
      active_cash_session_id: null,
      latest_document_id: null,
      latest_document_number: null,
      pending_generation_jobs: 0,
      pending_print_jobs: 0,
    }),
    get_procurement_capabilities: () => ({
      can_manage_procurement: true,
      can_post_purchase_receipt: true,
      can_post_supplier_invoice: true,
      can_post_supplier_return: true,
      can_post_supplier_payment: true,
    }),
    get_inventory_capabilities: () => ({
      can_manage_catalog: true,
      can_post_stock_receipt: true,
      can_view_inventory: true,
      can_manage_inventory: true,
    }),
    list_products: () => [
      {
        product_id: 1,
        variant_id: 7,
        sku: 'SKU-PK',
        name: 'Pack Biscuit',
        sale_price: '150.00',
        is_active: true,
        quantity_on_hand: '0.000',
        last_known_wac: '0.000000',
      },
    ],
    list_catalog_products: () => [
      {
        product_id: 1,
        variant_id: 7,
        sku: 'SKU-PK',
        name: 'Pack Biscuit',
        sale_price: '150.00',
        is_active: true,
        quantity_on_hand: '0.000',
        last_known_wac: '0.000000',
      },
    ],
    list_units: () => [
      { id: 1, code: 'PCS', name: 'Piece', is_base: true },
      { id: 2, code: 'BX12', name: 'Boite de 12', is_base: false },
    ],
    list_purchase_product_options: () => [
      {
        product_id: 1,
        variant_id: 7,
        sku: 'SKU-PK',
        product_name: 'Pack Biscuit',
        variant_name: null,
        primary_barcode: 'BASE-1111',
        default_unit_id: 1,
        default_unit_code: 'PCS',
        default_unit_name: 'Piece',
        primary_pack_unit_id: 2,
        alternate_units: [
          {
            variant_unit_id: 10,
            unit_id: 2,
            unit_code: 'BX12',
            unit_name: 'Boite de 12',
            conversion_factor: '12.000000',
            is_primary: true,
            barcode: 'PACK-9999',
            sale_price: '1500.00',
          },
        ],
        attributes: [],
        is_active: true,
        default_unit_cost: '1200.00',
        last_purchase_cost: '1200.00',
      },
    ],
    list_suppliers: () => [
      {
        id: 1,
        code: 'SUP-1',
        name: 'Supplier Alpha',
        contact_name: null,
        phone: null,
        email: null,
        tax_id: null,
        address: null,
        is_active: true,
        outstanding_balance: '0.00',
      },
    ],
    list_purchase_orders: () => [],
    list_purchase_receipts: () => [],
    list_purchase_receipt_lines: () => [],
    list_supplier_invoices: () => [],
    list_supplier_liabilities: () => [],
    list_supplier_returns: () => [],
    list_supplier_payments: () => [],
    list_purchase_payment_status: () => [],
    get_active_licence: () => null,
    get_licence_status: () => ({ is_valid: true, is_read_only: false }),
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

describe('WS-O-3 Buy by the pack workflow', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    cleanup();
    document.documentElement.setAttribute('dir', 'ltr');
    document.documentElement.setAttribute('lang', 'en');
  });

  it('defaults unit to primary pack, shows extra pieces column, and live calculates pack rate preview', async () => {
    let capturedPayload: unknown = null;
    wireInvoke(
      baseHandlers({
        confirm_direct_purchase: (args) => {
          capturedPayload = args.payload;
          return {
            document_id: 101,
            document_number: 'PR-2026-000101',
            receipt_origin: 'DIRECT_PURCHASE',
            purchase_order_id: null,
            purchase_order_number: null,
            supplier_id: 1,
            warehouse_id: 1,
            total_amount: '6400.00',
            journal_document_id: 501,
            journal_document_number: 'J-2026-000501',
            order_status: 'POSTED',
            posted_at: '2026-03-15T10:00:00Z',
          };
        },
      }),
    );

    render(<App />);
    await login();

    // Navigate to Purchases
    fireEvent.click(await screen.findByRole('button', { name: 'Purchases' }));
    expect(await screen.findByRole('heading', { name: 'Purchases' })).toBeInTheDocument();

    await screen.findByTestId('empty-receipts-state');

    // Click "+ New purchase"
    fireEvent.click(screen.getByTestId('create-po-btn'));
    expect(screen.getByTestId('direct-purchase-form')).toBeInTheDocument();

    // Add item via picker
    fireEvent.click(screen.getByTestId('add-purchase-line-btn'));
    fireEvent.click(await screen.findByTestId('purchase-item-option-7'));

    // Verify unit defaults to primary pack unit BX12 (id 2)
    const unitSelect = screen.getByTestId('purchase-line-unit-0') as HTMLSelectElement;
    expect(unitSelect.value).toBe('2');

    // Verify options show formatted factor without trailing zeros: "BX12 (×12)"
    expect(screen.getByText('BX12 (×12)')).toBeInTheDocument();

    // Verify Extra Pieces input is present
    const extraInput = screen.getByTestId('purchase-line-extra-0');
    expect(extraInput).toBeInTheDocument();

    // Set quantity to 5 boxes @ 1200 DZD
    const qtyInput = screen.getByTestId('purchase-line-qty-0');
    fireEvent.change(qtyInput, { target: { value: '5' } });

    const costInput = screen.getByTestId('purchase-line-cost-0');
    fireEvent.change(costInput, { target: { value: '1200.00' } });

    // Enter 4 extra pieces
    fireEvent.change(extraInput, { target: { value: '4' } });

    // 5 boxes * 1200 = 6000 DZD. 4 pieces @ (1200/12 = 100 DZD) = 400 DZD. Total = 6400 DZD
    // Total base units = 5 * 12 + 4 = 64 PCS
    await waitFor(() => {
      expect(screen.getAllByText(/6400(?:\.00)? DZD/).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/=\s*64\s*PCS/)).toBeInTheDocument();
      expect(screen.getByText(/4\s*@\s*100\.00\s*DZD/)).toBeInTheDocument();
    });

    // Test validation: enter 12 extra pieces (equals factor 12) -> should show error
    fireEvent.change(extraInput, { target: { value: '12' } });
    fireEvent.click(screen.getByTestId('confirm-direct-purchase-btn'));
    await waitFor(() => {
      expect(screen.getByText(/Extra pieces must be less than pack size/)).toBeInTheDocument();
    });

    // Fix extra pieces back to 4 and confirm purchase
    fireEvent.change(extraInput, { target: { value: '4' } });
    fireEvent.click(screen.getByTestId('confirm-direct-purchase-btn'));

    await waitFor(() => {
      expect(capturedPayload).toBeTruthy();
    });

    const payload = capturedPayload as {
      lines: Array<{
        variant_id: number;
        unit_id: number;
        quantity_received: string;
        extra_base_quantity?: string;
        unit_cost: string;
      }>;
    };
    expect(payload.lines).toHaveLength(1);
    expect(payload.lines[0]).toEqual({
      variant_id: 7,
      unit_id: 2,
      quantity_received: '5',
      extra_base_quantity: '4',
      unit_cost: '1200.00',
    });
  }, 15000);

  it('scans pack barcode and auto-selects the pack unit', async () => {
    wireInvoke(baseHandlers());

    render(<App />);
    await login();

    fireEvent.click(await screen.findByRole('button', { name: 'Purchases' }));
    await screen.findByTestId('empty-receipts-state');
    fireEvent.click(screen.getByTestId('create-po-btn'));

    const barcodeInput = screen.getByTestId('purchase-barcode-input');
    // Scan pack barcode
    fireEvent.change(barcodeInput, { target: { value: 'PACK-9999' } });
    fireEvent.keyDown(barcodeInput, { key: 'Enter', code: 'Enter' });

    // Line should be added with pack unit selected
    const unitSelect = (await screen.findByTestId('purchase-line-unit-0')) as HTMLSelectElement;
    expect(unitSelect.value).toBe('2');

    // Scan again -> increments quantity to 2
    fireEvent.change(barcodeInput, { target: { value: 'PACK-9999' } });
    fireEvent.keyDown(barcodeInput, { key: 'Enter', code: 'Enter' });

    const qtyInput = screen.getByTestId('purchase-line-qty-0') as HTMLInputElement;
    expect(qtyInput.value).toBe('2');
  }, 15000);
});
