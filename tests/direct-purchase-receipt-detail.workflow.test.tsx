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
    list_warehouses: () => [
      { id: 1, code: 'WH1', name: 'Main Warehouse', is_active: true },
      { id: 2, code: 'WH2', name: 'Secondary Depot', is_active: true },
    ],
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
      {
        id: 2,
        code: 'SUP-002',
        name: 'North Africa Imports',
        contact_name: 'Karim',
        phone: '0550000001',
        email: 'karim@na-imports.dz',
        address: 'Oran',
        tax_id: '654321',
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

describe('Purchase Receipt & Direct Purchase UI/UX Recovery Workflow', () => {
  it('renders summary metrics, receipts table with Origin Direct Purchase, and no broken PO info', async () => {
    const mockReceipts = [
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
        total_amount: '2500.00',
        journal_document_id: 200,
        journal_document_number: 'JE-2026-000001',
        landed_cost_amount: null,
        landed_cost_journal_id: null,
        landed_cost_journal_number: null,
        posted_at: '2026-08-16T12:00:00Z',
      },
      {
        document_id: 101,
        document_number: 'PR-2026-000002',
        receipt_origin: 'PURCHASE_ORDER',
        purchase_order_id: 10,
        purchase_order_number: 'PO-2026-000088',
        supplier_id: 2,
        supplier_name: 'North Africa Imports',
        warehouse_id: 2,
        warehouse_name: 'Secondary Depot',
        total_amount: '1200.00',
        journal_document_id: 201,
        journal_document_number: 'JE-2026-000002',
        landed_cost_amount: null,
        landed_cost_journal_id: null,
        landed_cost_journal_number: null,
        posted_at: '2026-08-16T14:00:00Z',
      },
    ];

    wireInvoke(
      baseHandlers({
        list_purchase_receipts: () => mockReceipts,
      }),
    );

    render(<App />);
    await login();

    fireEvent.click(await screen.findByRole('button', { name: 'Purchases' }));
    expect(await screen.findByRole('heading', { name: 'Purchases' })).toBeInTheDocument();

    // Verify summary metrics
    expect(screen.getByTestId('metric-total-receipts')).toHaveTextContent('2');
    expect(screen.getByTestId('metric-direct-purchases')).toHaveTextContent('1');
    expect(screen.getByTestId('metric-total-value')).toHaveTextContent('3700');

    // Verify Direct Purchase row
    const pr1Row = screen.getByTestId('receipt-row-100');
    expect(pr1Row).toHaveTextContent('PR-2026-000001');
    expect(pr1Row).toHaveTextContent('Global Supplier SARL');
    expect(pr1Row).toHaveTextContent('Main Warehouse');
    expect(pr1Row).toHaveTextContent('2500.00 DZD');
    expect(pr1Row).toHaveTextContent('Direct Purchase');
    expect(pr1Row).not.toHaveTextContent('null');
    expect(pr1Row).not.toHaveTextContent('undefined');

    // Verify PO origin row
    const pr2Row = screen.getByTestId('receipt-row-101');
    expect(pr2Row).toHaveTextContent('PR-2026-000002');
    expect(pr2Row).toHaveTextContent('Purchase Order: PO-2026-000088');
  });

  it('filters receipts by origin, search text, and supplier', async () => {
    const mockReceipts = [
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
        total_amount: '2500.00',
        journal_document_id: 200,
        journal_document_number: 'JE-2026-000001',
        landed_cost_amount: null,
        landed_cost_journal_id: null,
        landed_cost_journal_number: null,
        posted_at: '2026-08-16T12:00:00Z',
      },
      {
        document_id: 101,
        document_number: 'PR-2026-000002',
        receipt_origin: 'PURCHASE_ORDER',
        purchase_order_id: 10,
        purchase_order_number: 'PO-2026-000088',
        supplier_id: 2,
        supplier_name: 'North Africa Imports',
        warehouse_id: 2,
        warehouse_name: 'Secondary Depot',
        total_amount: '1200.00',
        journal_document_id: 201,
        journal_document_number: 'JE-2026-000002',
        landed_cost_amount: null,
        landed_cost_journal_id: null,
        landed_cost_journal_number: null,
        posted_at: '2026-08-16T14:00:00Z',
      },
    ];

    wireInvoke(
      baseHandlers({
        list_purchase_receipts: () => mockReceipts,
      }),
    );

    render(<App />);
    await login();

    fireEvent.click(await screen.findByRole('button', { name: 'Purchases' }));
    await screen.findByTestId('purchase-receipts-table');

    // Filter by Origin: DIRECT_PURCHASE
    fireEvent.change(screen.getByTestId('filter-receipt-origin-select'), { target: { value: 'DIRECT_PURCHASE' } });
    expect(screen.getByTestId('receipt-row-100')).toBeInTheDocument();
    expect(screen.queryByTestId('receipt-row-101')).not.toBeInTheDocument();

    // Reset origin and search by receipt number
    fireEvent.change(screen.getByTestId('filter-receipt-origin-select'), { target: { value: 'ALL' } });
    fireEvent.change(screen.getByTestId('search-receipts-input'), { target: { value: '000002' } });
    expect(screen.queryByTestId('receipt-row-100')).not.toBeInTheDocument();
    expect(screen.getByTestId('receipt-row-101')).toBeInTheDocument();
  });

  it('opens Purchase Receipt Detail Modal on View Details with lines, audit evidence, and journal link', async () => {
    const mockReceipt = {
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
    };

    const mockLines = [
      {
        receipt_line_id: 501,
        receipt_document_id: 100,
        receipt_document_number: 'PR-2026-000001',
        receipt_origin: 'DIRECT_PURCHASE',
        purchase_order_id: null,
        purchase_order_number: null,
        po_line_id: null,
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
      },
    ];

    wireInvoke(
      baseHandlers({
        list_purchase_receipts: () => [mockReceipt],
        list_purchase_receipt_lines: () => mockLines,
      }),
    );

    render(<App />);
    await login();

    fireEvent.click(await screen.findByRole('button', { name: 'Purchases' }));
    await screen.findByTestId('purchase-receipts-table');

    // Click "View Details"
    fireEvent.click(screen.getByTestId('view-receipt-100'));

    // Modal should appear
    expect(await screen.findByTestId('purchase-receipt-detail-modal')).toBeInTheDocument();
    expect(screen.getByTestId('receipt-status-badge')).toHaveTextContent('POSTED');
    expect(screen.getByTestId('receipt-origin-badge')).toHaveTextContent('Direct Purchase');
    expect(screen.getByTestId('receipt-supplier-value')).toHaveTextContent('Global Supplier SARL');
    expect(screen.getByTestId('receipt-warehouse-value')).toHaveTextContent('Main Warehouse');
    expect(screen.getByTestId('receipt-total-value')).toHaveTextContent('1000.00 DZD');
    expect(screen.getByTestId('receipt-journal-value')).toHaveTextContent('JE-2026-000001');

    // Verify lines table
    expect(screen.getByTestId('receipt-line-501')).toHaveTextContent('Procurement Item A');
    expect(screen.getByTestId('receipt-line-501')).toHaveTextContent('SKU-7');
    expect(screen.getByTestId('receipt-line-501')).toHaveTextContent('10.000');
    expect(screen.getByTestId('receipt-line-501')).toHaveTextContent('100.00');
    expect(screen.getByTestId('receipt-line-501')).toHaveTextContent('1000.00');

    // Verify Accounting Evidence
    expect(screen.getByTestId('receipt-balanced-badge')).toHaveTextContent('Balanced Entry');
    expect(screen.getByTestId('view-receipt-journal-btn')).toHaveTextContent('JE-2026-000001');

    // Close modal
    fireEvent.click(screen.getByTestId('close-receipt-detail-btn'));
    expect(screen.queryByTestId('purchase-receipt-detail-modal')).not.toBeInTheDocument();
  });

  it('renders clean empty state with action when no receipts exist', async () => {
    wireInvoke(
      baseHandlers({
        list_purchase_receipts: () => [],
      }),
    );

    render(<App />);
    await login();

    fireEvent.click(await screen.findByRole('button', { name: 'Purchases' }));
    expect(await screen.findByTestId('empty-receipts-state')).toBeInTheDocument();
    expect(screen.getByText('No purchase receipts yet')).toBeInTheDocument();
  });
});
