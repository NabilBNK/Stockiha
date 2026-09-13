/**
 * WS-F-003 Sale Discount POS Workflow Tests
 * Covers discount permission check, toggle UI, exact net total calculation,
 * discount validation, and confirm_cash_sale payload submission.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));

import App from '../src/App';
import type { ProductListItemV2 } from '../src/shared/ipc/dto';

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
    sku: 'PROD-100',
    product_name: 'Product 100',
    variant_name: '',
    primary_barcode: '6130000000042',
    display_identifier: 'PROD-100',
    identifier_type: 'SKU',
    sale_price: '500.00',
    minimum_stock: '0',
    is_active: true,
    product_is_active: true,
    category_id: null,
    category_name: null,
    quantity_on_hand: '10',
    last_known_wac: '300.00',
    attributes: [],
    total_count: 1,
    ...overrides,
  };
}

function baseHandlers(canApplyDiscount = true, extra: Handlers = {}): Handlers {
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
      can_apply_sale_discount: canApplyDiscount,
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
    list_customers: () => [],
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

describe('POS Sale Discount Workflow (WS-F-003)', () => {
  it('hides the discount button when the user does not have can_apply_sale_discount', async () => {
    wireInvoke(baseHandlers(false));
    render(<App />);
    await login();

    fireEvent.click(screen.getByRole('button', { name: 'Point of sale' }));
    await screen.findByRole('heading', { name: 'Point of sale' });

    // Add item to cart
    fireEvent.click(await screen.findByText('Product 100'));
    expect(screen.getByTestId('pos-total')).toHaveTextContent('500.00');

    // Discount button must NOT be present
    expect(screen.queryByTestId('add-discount-btn')).toBeNull();
    expect(screen.queryByTestId('pos-discount-section')).toBeNull();
  });

  it('allows applying a discount, computes exact net total, and submits discount_amount in confirm_cash_sale', async () => {
    let capturedConfirmPayload: Record<string, unknown> | null = null;
    wireInvoke(
      baseHandlers(true, {
        confirm_cash_sale: (args) => {
          capturedConfirmPayload = args;
          return 999;
        },
      }),
    );
    render(<App />);
    await login();

    fireEvent.click(screen.getByRole('button', { name: 'Point of sale' }));
    await screen.findByRole('heading', { name: 'Point of sale' });

    // Add product (500.00)
    fireEvent.click(await screen.findByText('Product 100'));
    expect(screen.getByTestId('pos-total')).toHaveTextContent('500.00');

    // Discount button is visible
    const addDiscountBtn = screen.getByTestId('add-discount-btn');
    expect(addDiscountBtn).toHaveTextContent('+ Add discount');
    fireEvent.click(addDiscountBtn);

    // Discount input is displayed
    const discountInput = screen.getByTestId('pos-discount-input');
    expect(discountInput).toBeInTheDocument();

    // Enter a valid discount: 50.00
    fireEvent.change(discountInput, { target: { value: '50.00' } });

    // Breakdown is displayed: Subtotal 500.00, Discount -50.00, Total 450.00
    expect(screen.getByTestId('pos-subtotal')).toHaveTextContent('500.00');
    expect(screen.getByTestId('pos-discount-amount')).toHaveTextContent('-50.00');
    expect(screen.getByTestId('pos-total')).toHaveTextContent('450.00');

    // Click confirm sale button
    const confirmBtn = screen.getByRole('button', { name: 'Confirm sale' });
    expect(confirmBtn).not.toBeDisabled();
    fireEvent.click(confirmBtn);

    // In confirm modal
    const dialogConfirmBtn = await screen.findByRole('button', { name: 'Confirm' });
    fireEvent.click(dialogConfirmBtn);

    await waitFor(() => {
      expect(capturedConfirmPayload).not.toBeNull();
    });

    expect(capturedConfirmPayload).toMatchObject({
      discountAmount: '50.00',
      cashSessionId: 77,
      warehouseId: 1,
    });
  });

  it('validates discount amount and disables confirm button when invalid', async () => {
    wireInvoke(baseHandlers(true));
    render(<App />);
    await login();

    fireEvent.click(screen.getByRole('button', { name: 'Point of sale' }));
    await screen.findByRole('heading', { name: 'Point of sale' });

    // Add product (500.00)
    fireEvent.click(await screen.findByText('Product 100'));

    // Open discount input
    fireEvent.click(screen.getByTestId('add-discount-btn'));
    const discountInput = screen.getByTestId('pos-discount-input');

    // Case 1: discount exceeds cart total (600.00 > 500.00)
    fireEvent.change(discountInput, { target: { value: '600.00' } });
    expect(screen.getByTestId('pos-discount-error')).toHaveTextContent(
      'Invalid discount amount or exceeds total',
    );
    const confirmBtn = screen.getByRole('button', { name: 'Confirm sale' });
    expect(confirmBtn).toBeDisabled();

    // Case 2: invalid string format
    fireEvent.change(discountInput, { target: { value: 'abc' } });
    expect(screen.getByTestId('pos-discount-error')).toBeInTheDocument();
    expect(confirmBtn).toBeDisabled();

    // Case 3: clear with remove button "×"
    const removeBtn = screen.getByTestId('remove-discount-btn');
    fireEvent.click(removeBtn);

    // Input collapses and "+ Add discount" reappears
    expect(screen.queryByTestId('pos-discount-input')).toBeNull();
    expect(screen.getByTestId('add-discount-btn')).toBeInTheDocument();
    expect(screen.getByTestId('pos-total')).toHaveTextContent('500.00');
    expect(confirmBtn).not.toBeDisabled();
  });
});
