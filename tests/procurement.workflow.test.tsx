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

    fireEvent.click(screen.getByRole('button', { name: 'Suppliers' }));
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

    fireEvent.click(screen.getByRole('button', { name: 'Suppliers' }));
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

  it('navigates to Purchase Orders screen and confirms a goods receipt', async () => {
    let receiptCall: Record<string, unknown> | null = null;
    wireInvoke(
      baseHandlers({
        confirm_purchase_receipt: (args) => {
          receiptCall = args;
          return {
            document_id: 200,
            document_number: 'PR-2026-000001',
            purchase_order_id: 10,
            purchase_order_number: 'PO-2026-000001',
            supplier_id: 1,
            warehouse_id: 1,
            total_amount: '1000.00',
            journal_document_id: 300,
            journal_document_number: 'JE-2026-000001',
            order_status: 'RECEIVED',
            posted_at: '2026-01-15T00:00:00Z',
          };
        },
      }),
    );
    render(<App />);
    await login();

    fireEvent.click(screen.getByRole('button', { name: 'Purchase Orders' }));
    expect(await screen.findByRole('heading', { name: 'Purchase Orders' })).toBeInTheDocument();
    expect(screen.getByText('PO-2026-000001')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('receive-po-10'));
    await screen.findByTestId('purchase-receipt-modal');

    fireEvent.click(screen.getByTestId('confirm-receipt-submit-btn'));

    await waitFor(() => expect(receiptCall).not.toBeNull());
    expect(await screen.findByTestId('po-success-banner')).toHaveTextContent('PR-2026-000001');
  });
});
