/**
 * WS-F-004 Credit Limit Warning POS Workflow Tests
 * Verifies that exceeding a customer's credit limit warns instead of blocking,
 * displays the over-limit amount, changes the button label to "Confirm anyway",
 * and allows the sale to proceed without requiring a manager override token.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));

import App from '../src/App';
import type { ProductListItemV2 } from '../src/shared/ipc/dto';
import type { Customer } from '../src/shared/ipc/customerDto';

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

function activeCashSession() {
  return {
    id: 77,
    warehouse_id: 1,
    opened_by_user_id: 10,
    opening_float: '1000.00',
    opened_at: '2026-07-31T08:00:00Z',
  };
}

function mockProduct(overrides: Partial<ProductListItemV2> = {}): ProductListItemV2 {
  return {
    product_id: 1,
    variant_id: 42,
    sku: 'PROD-50',
    product_name: 'Product 50',
    variant_name: '',
    primary_barcode: '6130000000042',
    display_identifier: 'PROD-50',
    identifier_type: 'SKU',
    sale_price: '50.00',
    minimum_stock: '0',
    is_active: true,
    product_is_active: true,
    category_id: null,
    category_name: null,
    quantity_on_hand: '100',
    last_known_wac: '30.00',
    attributes: [],
    total_count: 1,
    ...overrides,
  };
}

function mockCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 10,
    code: 'CUS-100',
    name: 'Credit Customer Ahmed',
    contact_name: null,
    phone: null,
    email: null,
    address: null,
    tax_id: null,
    is_active: true,
    credit_enabled: true,
    credit_limit: '1000.00',
    payment_terms_days: 30,
    max_overdue_days: 60,
    exposure_amount: '900.00',
    available_credit: '100.00',
    oldest_open_due_date: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

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
      product_count: 1,
      variant_count: 1,
      active_cash_session_id: 77,
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
    get_customer_capabilities: () => ({
      can_view_customers: true,
      can_manage_customers: true,
      can_post_credit_sale: true,
      can_post_customer_payment: true,
      can_post_customer_refund: true,
      can_manage_drawer_policy: true,
      can_override_credit_limit: true,
      can_apply_sale_discount: true,
    }),
    get_printing_settings: () => ({
      receipt_printing_enabled: false,
      receipt_target: 'THERMAL',
      thermal_printer_name: null,
      thermal_columns: 48,
      shop_name: 'Test Shop',
      shop_address: null,
      shop_phone: null,
      receipt_footer: null,
      updated_at: '2026-09-13T09:00:00Z',
    }),
    list_products_v2: () => [mockProduct()],
    list_categories: () => [],
    list_customers: () => [mockCustomer()],
    list_attributes: () => [],
    list_units: () => [{ id: 1, code: 'PCS', name: 'Pieces' }],
    list_units_v2: () => [{ id: 1, code: 'PCS', name: 'Pieces', is_active: true, usage_count: 1 }],
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

describe('POS Credit Limit Warning Workflow (WS-F-004)', () => {
  it('does not display warning when customer has limit 1000.00, exposure 900.00, and cart is 50.00', async () => {
    wireInvoke(baseHandlers());
    render(<App />);
    await login();

    fireEvent.click(screen.getByRole('button', { name: 'Point of sale' }));
    await screen.findByRole('heading', { name: 'Point of sale' });

    // Switch to Credit payment mode
    fireEvent.click(screen.getByTestId('payment-credit'));

    // Select customer with limit 1000 and exposure 900
    fireEvent.change(screen.getByTestId('credit-customer-select'), { target: { value: '10' } });

    // Add 1 item of 50.00 to cart (total 50.00, exposure + total = 950.00 <= 1000.00)
    fireEvent.click(await screen.findByText('Product 50'));
    expect(screen.getByTestId('pos-total')).toHaveTextContent('50.00');

    // Warning banner must NOT be in the document
    expect(screen.queryByTestId('pos-credit-over-limit')).toBeNull();

    // Confirm button must have standard label "Confirm sale"
    expect(screen.getByRole('button', { name: 'Confirm sale' })).toBeInTheDocument();
  });

  it('displays warning naming 100.00 when cart is 200.00 (projected 1100.00 vs 1000.00 limit)', async () => {
    wireInvoke(baseHandlers());
    render(<App />);
    await login();

    fireEvent.click(screen.getByRole('button', { name: 'Point of sale' }));
    await screen.findByRole('heading', { name: 'Point of sale' });

    // Switch to Credit payment mode and select customer
    fireEvent.click(screen.getByTestId('payment-credit'));
    fireEvent.change(screen.getByTestId('credit-customer-select'), { target: { value: '10' } });

    // Add 4 items of 50.00 to cart (total 200.00, exposure 900 + 200 = 1100.00 > 1000.00, over by 100.00)
    const productTile = await screen.findByText('Product 50');
    fireEvent.click(productTile);
    fireEvent.click(productTile);
    fireEvent.click(productTile);
    fireEvent.click(productTile);

    expect(screen.getByTestId('pos-total')).toHaveTextContent('200.00');

    // pos-credit-over-limit appears and names 100.00
    const banner = screen.getByTestId('pos-credit-over-limit');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent('100.00');
  });

  it('in that state the Confirm button is enabled and reads "Confirm anyway"', async () => {
    wireInvoke(baseHandlers());
    render(<App />);
    await login();

    fireEvent.click(screen.getByRole('button', { name: 'Point of sale' }));
    await screen.findByRole('heading', { name: 'Point of sale' });

    // Switch to Credit payment mode and select customer
    fireEvent.click(screen.getByTestId('payment-credit'));
    fireEvent.change(screen.getByTestId('credit-customer-select'), { target: { value: '10' } });

    // Add 4 items to cart (total 200.00)
    const productTile = await screen.findByText('Product 50');
    fireEvent.click(productTile);
    fireEvent.click(productTile);
    fireEvent.click(productTile);
    fireEvent.click(productTile);

    // Confirm button must be enabled and read "Confirm anyway"
    const confirmBtn = screen.getByRole('button', { name: 'Confirm anyway' });
    expect(confirmBtn).toBeInTheDocument();
    expect(confirmBtn).toBeEnabled();
  });

  it('clicking Confirm anyway calls confirm_credit_sale once with no override token', async () => {
    let capturedCreditArgs: Record<string, unknown> | null = null;
    wireInvoke(
      baseHandlers({
        confirm_credit_sale: (args) => {
          capturedCreditArgs = args;
          return {
            document_id: 101,
            document_number: 'CR-2026-000101',
            customer_id: 10,
            total_amount: '200.00',
            due_date: '2026-10-15',
            exposure_amount: '1100.00',
            available_credit: '-100.00',
            credit_limit: '1000.00',
            over_limit: true,
            journal_document_id: 202,
          };
        },
      }),
    );
    render(<App />);
    await login();

    fireEvent.click(screen.getByRole('button', { name: 'Point of sale' }));
    await screen.findByRole('heading', { name: 'Point of sale' });

    // Switch to Credit payment mode and select customer
    fireEvent.click(screen.getByTestId('payment-credit'));
    fireEvent.change(screen.getByTestId('credit-customer-select'), { target: { value: '10' } });

    // Add 4 items to cart
    const productTile = await screen.findByText('Product 50');
    fireEvent.click(productTile);
    fireEvent.click(productTile);
    fireEvent.click(productTile);
    fireEvent.click(productTile);

    // Click "Confirm anyway"
    fireEvent.click(screen.getByRole('button', { name: 'Confirm anyway' }));

    // Dialog confirmation prompt appears
    await screen.findByText('Confirm this customer credit sale?');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    // confirm_credit_sale must have been called once with no override token
    await waitFor(() => {
      expect(capturedCreditArgs).not.toBeNull();
    });

    expect(capturedCreditArgs).toMatchObject({
      customerId: 10,
      warehouseId: 1,
      overrideToken: null,
    });

    // Success banner appears and includes the over-limit notification
    const successCard = await screen.findByTestId('credit-sale-success');
    expect(successCard).toBeInTheDocument();
    expect(successCard).toHaveTextContent('CR-2026-000101');
    expect(successCard).toHaveTextContent('Customer is over their credit limit.');
  });
});
