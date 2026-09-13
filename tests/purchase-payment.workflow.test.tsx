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
    list_purchase_receipts: () => [],
    list_purchase_receipt_lines: () => [],
    list_supplier_invoices: () => [],
    list_supplier_liabilities: () => [],
    list_supplier_returns: () => [],
    list_supplier_payments: () => [],
    list_purchase_payment_status: () => [],
    list_supplier_balances: () => [],
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

describe('Supplier Payment Workflow (WS-E-2)', () => {
  it('renders status column with unpaid badge for new receipt', async () => {
    wireInvoke(
      baseHandlers({
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
        list_purchase_payment_status: () => [
          {
            receipt_document_id: 100,
            total_amount: '1000.00',
            paid_amount: '0.00',
            outstanding_amount: '1000.00',
            payment_status: 'UNPAID',
          },
        ],
      }),
    );

    render(<App />);
    await login();

    fireEvent.click(await screen.findByRole('button', { name: 'Purchases' }));
    expect(await screen.findByRole('heading', { name: 'Purchases' })).toBeInTheDocument();

    const statusBadge = await screen.findByTestId('payment-status-100');
    expect(statusBadge).toBeInTheDocument();
    expect(statusBadge).toHaveTextContent('Unpaid');
  });

  it('opens record payment modal and posts the right payload', async () => {
    let paymentCallArgs: Record<string, unknown> | null = null;

    wireInvoke(
      baseHandlers({
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
        list_purchase_payment_status: () => [
          {
            receipt_document_id: 100,
            total_amount: '1000.00',
            paid_amount: '0.00',
            outstanding_amount: '1000.00',
            payment_status: 'UNPAID',
          },
        ],
        post_purchase_payment: (args) => {
          paymentCallArgs = args;
          return {
            document_id: 300,
            document_number: 'SP-2026-000001',
            receipt_document_id: 100,
            receipt_document_number: 'PR-2026-000001',
            supplier_id: 1,
            supplier_name: 'Global Supplier SARL',
            payment_method: 'CASH',
            amount: '1000.00',
            reference_number: null,
            journal_document_id: 301,
            journal_document_number: 'JE-2026-000002',
            posted_at: '2026-08-16T12:05:00Z',
          };
        },
      }),
    );

    render(<App />);
    await login();

    fireEvent.click(await screen.findByRole('button', { name: 'Purchases' }));
    const recordBtn = await screen.findByTestId('record-payment-100');
    fireEvent.click(recordBtn);

    expect(await screen.findByTestId('purchase-payment-modal')).toBeInTheDocument();
    const amountInput = screen.getByTestId('purchase-payment-amount') as HTMLInputElement;
    expect(amountInput.value).toBe('1000.00');

    fireEvent.click(screen.getByTestId('purchase-payment-submit'));

    expect(paymentCallArgs).not.toBeNull();
    const payload = (paymentCallArgs as unknown as { payload: Record<string, unknown> }).payload;
    expect(payload.receipt_document_id).toBe(100);
    expect(payload.amount).toBe('1000.00');
    expect(payload.payment_method).toBe('CASH');
  });

  it('hides the record payment button for paid purchases', async () => {
    wireInvoke(
      baseHandlers({
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
        list_purchase_payment_status: () => [
          {
            receipt_document_id: 100,
            total_amount: '1000.00',
            paid_amount: '1000.00',
            outstanding_amount: '0.00',
            payment_status: 'PAID',
          },
        ],
      }),
    );

    render(<App />);
    await login();

    fireEvent.click(await screen.findByRole('button', { name: 'Purchases' }));
    expect(await screen.findByTestId('payment-status-100')).toHaveTextContent('Paid');
    expect(screen.queryByTestId('record-payment-100')).not.toBeInTheDocument();
  });
});
