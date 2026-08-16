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
      product_count: 2,
      variant_count: 2,
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
        sku: 'SKU-7',
        name: 'Procurement Item A',
        sale_price: '100.00',
        is_active: true,
        quantity_on_hand: '20.000',
        last_known_wac: '80.000000',
      },
    ],
    list_purchase_product_options: () => [
      {
        product_id: 1,
        variant_id: 7,
        sku: 'SKU-7',
        product_name: 'Procurement Item A',
        variant_name: null,
        default_unit_id: 1,
        default_unit_code: 'UNIT',
        default_unit_name: 'Unit',
        alternate_units: [],
        attributes: [],
        is_active: true,
      },
    ],
    list_catalog_products: () => [
      {
        product_id: 1,
        variant_id: 7,
        sku: 'SKU-7',
        name: 'Procurement Item A',
        sale_price: '100.00',
        is_active: true,
        quantity_on_hand: '20.000',
        last_known_wac: '80.000000',
      },
    ],
    list_units: () => [{ id: 1, code: 'UNIT', name: 'Unit', is_base: true }],
    list_suppliers: () => [
      {
        id: 1,
        code: 'SUP-001',
        name: 'Global Supplier SARL',
        contact_name: 'Ahmed',
        phone: '0550000000',
        email: 'contact@supplier.dz',
        address: 'Algiers',
        tax_id: '123456',
        is_active: true,
        created_at: '2026-01-01T00:00:00Z',
      },
    ],
    list_purchase_orders: () => [],
    list_purchase_receipts: () => [],
    list_purchase_receipt_lines: () => [],
    list_supplier_invoices: () => [],
    list_supplier_liabilities: () => [],
    list_supplier_returns: () => [],
    list_supplier_payments: () => [],
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
  document.documentElement.setAttribute('dir', 'ltr');
  document.documentElement.setAttribute('lang', 'en');
});

describe('Direct Purchasing Workflow (Part 1)', () => {
  it('confirms Direct Purchase atomically without fake POs and updates purchases list', async () => {
    let directPurchaseCall: Record<string, unknown> | null = null;
    const receiptsList = [
      {
        document_id: 100,
        document_number: 'PR-2026-000001',
        receipt_origin: 'DIRECT_PURCHASE',
        purchase_order_id: null,
        purchase_order_number: null,
        supplier_id: 1,
        supplier_name: 'Global Supplier SARL',
        warehouse_id: 1,
        warehouse_name: 'Main Warehouse',
        total_amount: '1000.00',
        journal_document_id: 200,
        journal_document_number: 'JE-2026-000001',
        landed_cost_amount: null,
        landed_cost_journal_id: null,
        landed_cost_journal_number: null,
        posted_at: '2026-08-16T12:00:00Z',
      },
    ];

    wireInvoke(
      baseHandlers({
        list_purchase_receipts: () => receiptsList,
        confirm_direct_purchase: (args) => {
          directPurchaseCall = args;
          return {
            document_id: 100,
            document_number: 'PR-2026-000001',
            receipt_origin: 'DIRECT_PURCHASE',
            purchase_order_id: null,
            purchase_order_number: null,
            supplier_id: 1,
            warehouse_id: 1,
            total_amount: '1000.00',
            journal_document_id: 200,
            journal_document_number: 'JE-2026-000001',
            order_status: 'RECEIVED',
            posted_at: '2026-08-16T12:00:00Z',
          };
        },
      }),
    );

    render(<App />);
    await login();

    // Navigate to Purchases
    fireEvent.click(await screen.findByRole('button', { name: 'Purchases' }));
    expect(await screen.findByRole('heading', { name: 'Purchases' })).toBeInTheDocument();

    // Click "+ New purchase"
    fireEvent.click(screen.getByTestId('create-po-btn'));
    expect(screen.getByTestId('create-po-form')).toBeInTheDocument();

    // Select Supplier, Warehouse, Date, and line item
    fireEvent.change(screen.getByTestId('po-supplier-select'), { target: { value: '1' } });
    fireEvent.change(screen.getByTestId('po-warehouse-select'), { target: { value: '1' } });
    fireEvent.change(screen.getByTestId('direct-purchase-date-input'), { target: { value: '2026-08-16' } });

    // Confirm Direct Purchase
    fireEvent.click(screen.getByTestId('confirm-direct-purchase-btn'));

    await waitFor(() => expect(directPurchaseCall).not.toBeNull());

    const payload = (directPurchaseCall as unknown as { payload: Record<string, unknown> }).payload;
    expect(payload.supplier_id).toBe(1);
    expect(payload.warehouse_id).toBe(1);
    expect(payload.fiscal_period_id).toBe(9);
    expect(payload.document_date).toBe('2026-08-16');
    expect(payload.lines).toEqual([
      {
        variant_id: 7,
        unit_id: 1,
        quantity_received: '10.000',
        unit_cost: '100.00',
      },
    ]);

    // Success banner contains PR-2026-000001 and total
    expect(await screen.findByTestId('po-success-banner')).toHaveTextContent('PR-2026-000001');
    expect(screen.getByTestId('po-success-banner')).toHaveTextContent('1000.00 DZD');

    // Table displays the purchase receipt with no PO link
    expect(screen.getByTestId('purchase-receipts-table')).toBeInTheDocument();
    expect(screen.getByText('PR-2026-000001')).toBeInTheDocument();
    expect(screen.getByText('Direct Purchase')).toBeInTheDocument();
    expect(screen.getByText('JE-2026-000001')).toBeInTheDocument();
  });

  it('rejects duplicate effective lines before submitting a Direct Purchase', async () => {
    wireInvoke(baseHandlers());

    render(<App />);
    await login();
    fireEvent.click(await screen.findByRole('button', { name: 'Purchases' }));
    fireEvent.click(screen.getByTestId('create-po-btn'));
    await screen.findByText('Global Supplier SARL (SUP-001)');
    fireEvent.click(screen.getByTestId('add-po-line-btn'));
    await waitFor(() => expect(screen.getAllByRole('textbox')).toHaveLength(3));
    fireEvent.click(screen.getByTestId('add-po-line-btn'));
    await waitFor(() => expect(screen.getAllByRole('textbox')).toHaveLength(5));
    fireEvent.click(screen.getByTestId('confirm-direct-purchase-btn'));

    expect(screen.getByTestId('po-error')).toHaveTextContent(
      'Correct the highlighted values, then confirm the purchase.',
    );
    expect(screen.getByText('This product and unit already appear on another line. Combine the quantities or remove one line.')).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalledWith(
      'confirm_direct_purchase',
      expect.anything(),
    );
  });

  it('marks invalid quantity and unit cost with a specific correction before submitting', async () => {
    wireInvoke(baseHandlers());

    render(<App />);
    await login();
    fireEvent.click(await screen.findByRole('button', { name: 'Purchases' }));
    fireEvent.click(screen.getByTestId('create-po-btn'));
    await screen.findByText('Global Supplier SARL (SUP-001)');
    fireEvent.click(screen.getByTestId('add-po-line-btn'));
    await waitFor(() => expect(screen.getAllByRole('textbox')).toHaveLength(3));

    const lineInputs = screen.getAllByRole('textbox');
    fireEvent.change(lineInputs[1], { target: { value: '0' } });
    fireEvent.change(lineInputs[2], { target: { value: 'not-a-cost' } });
    fireEvent.click(screen.getByTestId('confirm-direct-purchase-btn'));

    expect(screen.getByTestId('po-error')).toHaveTextContent(
      'Correct the highlighted values, then confirm the purchase.',
    );
    expect(lineInputs[1]).toHaveAttribute('aria-invalid', 'true');
    expect(lineInputs[2]).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Enter a quantity greater than 0, for example 1 or 1.500.')).toBeInTheDocument();
    expect(screen.getByText('Enter a unit cost of 0 or more, for example 1000 or 1000.00.')).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalledWith('confirm_direct_purchase', expect.anything());
  });
});
