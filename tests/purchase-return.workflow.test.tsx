import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

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
    list_products: () => [],
    list_purchase_product_options: () => [],
    list_catalog_products: () => [],
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
    list_purchase_receipts: () => [
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
    ],
    list_purchase_receipt_lines: () => [],
    list_supplier_invoices: () => [],
    list_supplier_liabilities: () => [],
    list_supplier_returns: () => [],
    list_supplier_payments: () => [],
    list_purchase_payment_status: () => [],
    list_supplier_balances: () => [],
    list_purchase_returnable_lines: () => [],
    confirm_purchase_return: () => ({
      document_id: 500,
      document_number: 'PRT-2026-000001',
      receipt_document_id: 100,
      receipt_document_number: 'PR-2026-000001',
      supplier_id: 1,
      supplier_name: 'Global Supplier SARL',
      warehouse_id: 1,
      warehouse_name: 'Main Warehouse',
      reason_code: 'DEFECTIVE_GOODS',
      note: null,
      refund_amount: '400.00',
      inventory_value: '440.00',
      variance_amount: '-40.00',
      journal_document_id: 501,
      journal_document_number: 'JE-2026-000002',
      posted_at: '2026-08-16T12:10:00Z',
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

describe('Supplier Return Workflow (WS-E-3)', () => {
  it('1. Button visibility: with can_post_supplier_return true return-goods-100 is present, with false absent', async () => {
    wireInvoke(baseHandlers());
    const { unmount } = render(<App />);
    await login();

    fireEvent.click(await screen.findByRole('button', { name: 'Purchases' }));
    expect(await screen.findByTestId('return-goods-100')).toBeInTheDocument();

    unmount();
    cleanup();

    wireInvoke(
      baseHandlers({
        get_procurement_capabilities: () => ({
          can_manage_procurement: true,
          can_post_purchase_receipt: true,
          can_post_supplier_invoice: true,
          can_post_supplier_return: false,
          can_post_supplier_payment: true,
        }),
      }),
    );
    render(<App />);
    await login();
    fireEvent.click(await screen.findByRole('button', { name: 'Purchases' }));
    await screen.findByTestId('receipt-row-100');
    expect(screen.queryByTestId('return-goods-100')).not.toBeInTheDocument();
  });

  it('2. Modal loads returnable lines when return-goods-100 clicked', async () => {
    wireInvoke(
      baseHandlers({
        list_purchase_returnable_lines: () => [
          {
            receipt_line_id: 55,
            line_number: 1,
            variant_id: 10,
            sku: 'SKU-55',
            product_name: 'Test Product',
            variant_name: null,
            unit_id: 1,
            unit_code: 'UNIT',
            unit_cost: '100.00',
            quantity_received: '10.000',
            quantity_returned: '0.000',
            quantity_returnable: '10.000',
          },
        ],
      }),
    );

    render(<App />);
    await login();
    fireEvent.click(await screen.findByRole('button', { name: 'Purchases' }));

    const returnBtn = await screen.findByTestId('return-goods-100');
    fireEvent.click(returnBtn);

    expect(await screen.findByTestId('purchase-return-modal')).toBeInTheDocument();
    expect(await screen.findByTestId('return-quantity-55')).toBeInTheDocument();
  });

  it('3. Submit sends the right payload', async () => {
    let returnCallArgs: Record<string, unknown> | null = null;

    wireInvoke(
      baseHandlers({
        list_purchase_returnable_lines: () => [
          {
            receipt_line_id: 55,
            line_number: 1,
            variant_id: 10,
            sku: 'SKU-55',
            product_name: 'Test Product',
            variant_name: null,
            unit_id: 1,
            unit_code: 'UNIT',
            unit_cost: '100.00',
            quantity_received: '10.000',
            quantity_returned: '0.000',
            quantity_returnable: '10.000',
          },
        ],
        confirm_purchase_return: (args) => {
          returnCallArgs = args;
          return {
            document_id: 500,
            document_number: 'PRT-2026-000001',
            receipt_document_id: 100,
            receipt_document_number: 'PR-2026-000001',
            supplier_id: 1,
            supplier_name: 'Global Supplier SARL',
            warehouse_id: 1,
            warehouse_name: 'Main Warehouse',
            reason_code: 'DEFECTIVE_GOODS',
            note: null,
            refund_amount: '400.00',
            inventory_value: '440.00',
            variance_amount: '-40.00',
            journal_document_id: 501,
            journal_document_number: 'JE-2026-000002',
            posted_at: '2026-08-16T12:10:00Z',
          };
        },
      }),
    );

    render(<App />);
    await login();
    fireEvent.click(await screen.findByRole('button', { name: 'Purchases' }));

    const returnBtn = await screen.findByTestId('return-goods-100');
    fireEvent.click(returnBtn);

    const qtyInput = await screen.findByTestId('return-quantity-55');
    fireEvent.change(qtyInput, { target: { value: '4' } });

    fireEvent.click(screen.getByTestId('purchase-return-submit'));

    expect(returnCallArgs).not.toBeNull();
    const payload = (returnCallArgs as unknown as { payload: { receipt_document_id: number; reason_code: string; lines: unknown[] } }).payload;
    expect(payload.receipt_document_id).toBe(100);
    expect(payload.reason_code).toBe('DEFECTIVE_GOODS');
    expect(payload.lines).toEqual([{ receipt_line_id: 55, quantity: '4' }]);
  });

  it('4. Reason Other requires supplier reference / note before submitting', async () => {
    let returnCallArgs: Record<string, unknown> | null = null;

    wireInvoke(
      baseHandlers({
        list_purchase_returnable_lines: () => [
          {
            receipt_line_id: 55,
            line_number: 1,
            variant_id: 10,
            sku: 'SKU-55',
            product_name: 'Test Product',
            variant_name: null,
            unit_id: 1,
            unit_code: 'UNIT',
            unit_cost: '100.00',
            quantity_received: '10.000',
            quantity_returned: '0.000',
            quantity_returnable: '10.000',
          },
        ],
        confirm_purchase_return: (args) => {
          returnCallArgs = args;
          return {
            document_id: 500,
            document_number: 'PRT-2026-000001',
            receipt_document_id: 100,
            receipt_document_number: 'PR-2026-000001',
            supplier_id: 1,
            supplier_name: 'Global Supplier SARL',
            warehouse_id: 1,
            warehouse_name: 'Main Warehouse',
            reason_code: 'OTHER',
            note: 'Recall notice #44',
            refund_amount: '400.00',
            inventory_value: '440.00',
            variance_amount: '-40.00',
            journal_document_id: 501,
            journal_document_number: 'JE-2026-000002',
            posted_at: '2026-08-16T12:10:00Z',
          };
        },
      }),
    );

    render(<App />);
    await login();
    fireEvent.click(await screen.findByRole('button', { name: 'Purchases' }));

    const returnBtn = await screen.findByTestId('return-goods-100');
    fireEvent.click(returnBtn);

    const qtyInput = await screen.findByTestId('return-quantity-55');
    fireEvent.change(qtyInput, { target: { value: '4' } });

    // Switch reason to OTHER
    const reasonSelect = screen.getByTestId('purchase-return-reason');
    fireEvent.change(reasonSelect, { target: { value: 'OTHER' } });

    // Submit with empty note -> should show validation error
    fireEvent.click(screen.getByTestId('purchase-return-submit'));
    expect(returnCallArgs).toBeNull();
    expect(await screen.findByTestId('purchase-return-error')).toHaveTextContent(
      'Supplier reference / note is required when reason is Other.',
    );

    // Provide note
    const noteInput = screen.getByTestId('purchase-return-note');
    fireEvent.change(noteInput, { target: { value: 'Recall notice #44' } });

    // Submit again -> should succeed
    fireEvent.click(screen.getByTestId('purchase-return-submit'));

    expect(returnCallArgs).not.toBeNull();
    const payload = (returnCallArgs as unknown as { payload: { receipt_document_id: number; reason_code: string; note: string; lines: unknown[] } }).payload;
    expect(payload.reason_code).toBe('OTHER');
    expect(payload.note).toBe('Recall notice #44');
    expect(payload.lines).toEqual([{ receipt_line_id: 55, quantity: '4' }]);
  });
});
