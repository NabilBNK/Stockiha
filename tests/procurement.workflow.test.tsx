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
        sale_price: '150.00',
        is_active: true,
        quantity_on_hand: '10.000',
        last_known_wac: '100.000000',
      },
    ],
    list_catalog_products: () => [
      {
        product_id: 1,
        variant_id: 7,
        sku: 'SKU-7',
        name: 'Procurement Item A',
        sale_price: '150.00',
        is_active: true,
        quantity_on_hand: '10.000',
        last_known_wac: '100.000000',
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
    list_purchase_orders: () => [
      {
        document_id: 10,
        document_number: 'PO-2026-000001',
        supplier_id: 1,
        supplier_code: 'SUP-001',
        supplier_name: 'Global Supplier SARL',
        warehouse_id: 1,
        warehouse_code: 'WH1',
        warehouse_name: 'Main Warehouse',
        status: 'CONFIRMED',
        subtotal: '1000.00',
        total_amount: '1000.00',
        created_at: '2026-01-15T00:00:00Z',
        confirmed_at: '2026-01-15T00:00:00Z',
      },
    ],
    list_purchase_receipts: () => [],
    list_purchase_receipt_lines: () => [],
    list_supplier_invoices: () => [],
    list_supplier_liabilities: () => [],
    list_supplier_returns: () => [],
    list_supplier_payments: () => [],
    get_purchase_order_detail: () => ({
      document_id: 10,
      document_number: 'PO-2026-000001',
      supplier_id: 1,
      supplier_code: 'SUP-001',
      supplier_name: 'Global Supplier SARL',
      warehouse_id: 1,
      warehouse_code: 'WH1',
      warehouse_name: 'Main Warehouse',
      status: 'CONFIRMED',
      subtotal: '1000.00',
      total_amount: '1000.00',
      note: 'Urgent order',
      created_at: '2026-01-15T00:00:00Z',
      confirmed_at: '2026-01-15T00:00:00Z',
      lines: [
        {
          id: 101,
          line_number: 1,
          variant_id: 7,
          variant_sku: 'SKU-7',
          variant_name: 'Procurement Item A',
          unit_id: 1,
          unit_code: 'UNIT',
          unit_name: 'Unit',
          quantity_ordered: '10.000',
          quantity_received: '0.000',
          remaining_quantity: '10.000',
          unit_cost: '100.00',
          line_total: '1000.00',
        },
      ],
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

beforeEach(() => {
  invokeMock.mockReset();
  cleanup();
  document.documentElement.setAttribute('dir', 'ltr');
  document.documentElement.setAttribute('lang', 'en');
});

describe('S3-001 Procurement Workflow', () => {
  it('navigates to Suppliers screen and lists suppliers', async () => {
    wireInvoke(baseHandlers());
    render(<App />);
    await login();

    fireEvent.click(await screen.findByRole('button', { name: 'Suppliers' }));
    expect(await screen.findByRole('heading', { name: 'Suppliers' })).toBeInTheDocument();
    expect(screen.getByText('SUP-001')).toBeInTheDocument();
    expect(screen.getByText('Global Supplier SARL')).toBeInTheDocument();
  });

  it('creates a new supplier via form submit', async () => {
    let payloadSent: Record<string, unknown> | null = null;
    wireInvoke(
      baseHandlers({
        create_supplier: (args) => {
          payloadSent = args;
          return { id: 2, code: 'SUP-NEW', name: 'New Supplier', is_active: true };
        },
      }),
    );
    render(<App />);
    await login();

    fireEvent.click(await screen.findByRole('button', { name: 'Suppliers' }));
    await screen.findByRole('heading', { name: 'Suppliers' });

    fireEvent.click(screen.getByTestId('add-supplier-btn'));
    fireEvent.change(screen.getByTestId('supplier-code-input'), { target: { value: 'SUP-NEW' } });
    fireEvent.change(screen.getByTestId('supplier-name-input'), { target: { value: 'New Supplier' } });
    fireEvent.click(screen.getByTestId('save-supplier-btn'));

    await waitFor(() => expect(payloadSent).not.toBeNull());
    const payload = (payloadSent as unknown as Record<string, unknown>).payload as Record<string, unknown>;
    expect(payload.code).toBe('SUP-NEW');
    expect(payload.name).toBe('New Supplier');
  });

});

describe('R8-E Procurement Acceptance Workflow', () => {
  it('safe-denies procurement navigation when backend capabilities are absent', async () => {
    wireInvoke(baseHandlers({
      get_procurement_capabilities: () => ({
        can_manage_procurement: false,
        can_post_purchase_receipt: false,
        can_post_supplier_invoice: false,
        can_post_supplier_return: false,
        can_post_supplier_payment: false,
      }),
    }));
    render(<App />);
    await login();
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('get_procurement_capabilities', { sessionToken: 'tok' }));
    expect(screen.queryByRole('button', { name: 'Suppliers' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Purchases' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Supplier Invoices' })).not.toBeInTheDocument();
  });

  it('renders Suppliers and Purchases in sidebar and excludes obsolete procurement views', async () => {
    wireInvoke(baseHandlers());
    render(<App />);
    await login();

    expect(await screen.findByRole('button', { name: 'Suppliers' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Purchases' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Supplier Invoices' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Supplier Payables' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Supplier Returns' })).not.toBeInTheDocument();
  });
});
