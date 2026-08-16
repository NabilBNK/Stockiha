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

    fireEvent.click(await screen.findByRole('button', { name: 'Purchases' }));
    expect(await screen.findByRole('heading', { name: 'Purchases' })).toBeInTheDocument();
    expect(screen.getByText('PO-2026-000001')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('receive-po-10'));
    await screen.findByTestId('purchase-receipt-modal');

    fireEvent.click(screen.getByTestId('confirm-receipt-submit-btn'));

    await waitFor(() => expect(receiptCall).not.toBeNull());
    expect(await screen.findByTestId('po-success-banner')).toHaveTextContent('PR-2026-000001');
  });
});

describe('R8-E Procurement Acceptance Workflow', () => {
  const receiptLine = {
    receipt_line_id: 501,
    receipt_document_id: 200,
    receipt_document_number: 'PR-2026-000001',
    purchase_order_id: 10,
    purchase_order_number: 'PO-2026-000001',
    po_line_id: 101,
    supplier_id: 1,
    supplier_name: 'Global Supplier SARL',
    warehouse_id: 1,
    warehouse_name: 'Main Warehouse',
    variant_id: 7,
    variant_sku: 'SKU-7',
    variant_name: 'Procurement Item A',
    unit_id: 1,
    unit_code: 'UNIT',
    quantity_received: '10.000',
    quantity_invoiced: '0.000',
    quantity_available_to_invoice: '10.000',
    quantity_returned_for_variant: '0.000',
    quantity_returnable_for_variant: '10.000',
    unit_cost: '100.00',
    line_total: '1000.00',
  };

  const receivedOrder = {
    document_id: 10,
    document_number: 'PO-2026-000001',
    supplier_id: 1,
    supplier_code: 'SUP-001',
    supplier_name: 'Global Supplier SARL',
    warehouse_id: 1,
    warehouse_code: 'WH1',
    warehouse_name: 'Main Warehouse',
    status: 'RECEIVED',
    subtotal: '1000.00',
    total_amount: '1000.00',
    created_at: '2026-01-15T00:00:00Z',
    confirmed_at: '2026-01-15T00:00:00Z',
  };

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

  it('creates a DZD supplier invoice from an exact posted receipt line', async () => {
    let invoicePayload: Record<string, unknown> | null = null;
    wireInvoke(baseHandlers({
      list_purchase_orders: () => [receivedOrder],
      list_purchase_receipt_lines: () => [receiptLine],
      create_supplier_invoice_draft: (args) => {
        invoicePayload = args;
        return { document_id: 301, supplier_id: 1, purchase_order_id: 10, status: 'DRAFT', subtotal: '1000.00', total_amount: '1000.00' };
      },
    }));
    render(<App />);
    await login();
    fireEvent.click(await screen.findByRole('button', { name: 'Supplier Invoices' }));
    await screen.findByRole('heading', { name: 'Supplier invoices' });
    fireEvent.click(screen.getByTestId('create-supplier-invoice'));
    await screen.findByTestId('supplier-invoice-modal');
    fireEvent.click(screen.getByTestId('save-invoice-draft'));
    await waitFor(() => expect(invoicePayload).not.toBeNull());
    const payload = (invoicePayload as unknown as { payload: Record<string, unknown> }).payload;
    expect(payload.currency_code).toBe('DZD');
    expect(payload.exchange_rate_to_dzd).toBe('1.000000');
    expect(payload.purchase_order_id).toBe(10);
    expect(payload.lines).toEqual([{
      line_number: 1,
      po_line_id: 101,
      receipt_line_id: 501,
      variant_id: 7,
      quantity: '10.000',
      unit_cost: '100.00',
    }]);
  });

  it('posts landed cost from receipt history and shows the confirmed result', async () => {
    let postingPayload: Record<string, unknown> | null = null;
    wireInvoke(baseHandlers({
      list_purchase_receipts: () => [{
        document_id: 200,
        document_number: 'PR-2026-000001',
        purchase_order_id: 10,
        purchase_order_number: 'PO-2026-000001',
        supplier_id: 1,
        supplier_name: 'Global Supplier SARL',
        warehouse_id: 1,
        warehouse_name: 'Main Warehouse',
        total_amount: '1000.00',
        journal_document_id: 210,
        journal_document_number: 'JE-2026-000001',
        landed_cost_amount: null,
        landed_cost_journal_id: null,
        landed_cost_journal_number: null,
        posted_at: '2026-01-15T00:00:00Z',
      }],
      allocate_landed_cost: (args) => {
        postingPayload = args;
        return { receipt_id: 200, landed_cost_amount: '100.00', inventory_debit: '100.00', variance_debit: '0.00', journal_document_id: 211, status: 'POSTED' };
      },
    }));
    render(<App />);
    await login();
    fireEvent.click(await screen.findByRole('button', { name: 'Purchases' }));
    await screen.findByTestId('purchase-receipts-table');
    fireEvent.click(screen.getByTestId('allocate-landed-cost-200'));
    fireEvent.change(screen.getByTestId('landed-cost-amount'), { target: { value: '100.00' } });
    fireEvent.click(screen.getByTestId('post-landed-cost'));
    await waitFor(() => expect(postingPayload).not.toBeNull());
    const payload = (postingPayload as unknown as { payload: Record<string, unknown> }).payload;
    expect(payload.fiscal_period_id).toBe(9);
    expect(payload.receipt_id).toBe(200);
    expect(await screen.findByTestId('landed-cost-result')).toHaveTextContent('100.00 DZD');
  });

  it('confirms supplier return with the real open fiscal period and exact result', async () => {
    let confirmPayload: Record<string, unknown> | null = null;
    wireInvoke(baseHandlers({
      list_purchase_orders: () => [receivedOrder],
      list_purchase_receipt_lines: () => [receiptLine],
      list_supplier_returns: () => [{
        document_id: 401,
        document_number: null,
        supplier_id: 1,
        supplier_name: 'Global Supplier SARL',
        warehouse_id: 1,
        warehouse_name: 'Main Warehouse',
        purchase_order_id: 10,
        purchase_order_number: 'PO-2026-000001',
        status: 'DRAFT',
        reason_code: 'DEFECTIVE_GOODS',
        journal_document_id: null,
        journal_document_number: null,
        created_at: '2026-01-16T00:00:00Z',
      }],
      confirm_supplier_return: (args) => {
        confirmPayload = args;
        return { document_id: 401, document_number: 'DN-2026-000001', status: 'POSTED', clearing_role: 'ACCOUNTS_PAYABLE', clearing_amount: '210.00', inventory_value: '220.00', variance_amount: '10.00', journal_document_id: 402 };
      },
    }));
    render(<App />);
    await login();
    fireEvent.click(await screen.findByRole('button', { name: 'Supplier Returns' }));
    await screen.findByTestId('supplier-returns-table');
    fireEvent.click(screen.getByTestId('confirm-return-401'));
    await waitFor(() => expect(confirmPayload).not.toBeNull());
    const payload = (confirmPayload as unknown as { payload: Record<string, unknown> }).payload;
    expect(payload.fiscal_period_id).toBe(9);
    expect(payload.return_document_id).toBe(401);
    expect(await screen.findByTestId('supplier-return-result')).toHaveTextContent('DN-2026-000001');
  });

  it('posts an allocated supplier payment and keeps official result evidence', async () => {
    let paymentPayload: Record<string, unknown> | null = null;
    wireInvoke(baseHandlers({
      list_supplier_liabilities: () => [{
        id: 601,
        supplier_id: 1,
        supplier_code: 'SUP-001',
        supplier_name: 'Global Supplier SARL',
        document_id: 301,
        document_number: 'PI-2026-000001',
        source_type: 'SUPPLIER_INVOICE',
        journal_document_id: 302,
        journal_document_number: 'JE-2026-000002',
        original_amount: '1050.00',
        remaining_amount: '840.00',
        status: 'PARTIALLY_PAID',
        due_date: '2026-02-15',
        created_at: '2026-01-16T00:00:00Z',
      }],
      post_supplier_payment: (args) => {
        paymentPayload = args;
        return { document_id: 701, document_number: 'SP-2026-000001', status: 'POSTED', journal_document_id: 702, amount: '400.00', funding_role: 'BANK' };
      },
    }));
    render(<App />);
    await login();
    fireEvent.click(await screen.findByRole('button', { name: 'Supplier Payables' }));
    await screen.findByTestId('supplier-liabilities-table');
    fireEvent.click(screen.getByTestId('pay-liability-601'));
    fireEvent.change(screen.getByTestId('supplier-payment-amount'), { target: { value: '400.00' } });
    fireEvent.click(screen.getByTestId('confirm-supplier-payment'));
    await waitFor(() => expect(paymentPayload).not.toBeNull());
    const payload = (paymentPayload as unknown as { payload: Record<string, unknown> }).payload;
    expect(payload.fiscal_period_id).toBe(9);
    expect(payload.liability_id).toBe(601);
    expect(await screen.findByTestId('supplier-payment-result')).toHaveTextContent('SP-2026-000001');
  });
});
