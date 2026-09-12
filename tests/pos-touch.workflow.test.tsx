/**
 * WS-F-1 Touchscreen Till Workflow Tests
 * Covers paged catalogue loading, category filtering, tapping tiles to add to cart,
 * and exact cart total decimal arithmetic.
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
    sku: 'WAT-1L',
    product_name: 'Water',
    variant_name: '1L',
    primary_barcode: '6130000000042',
    display_identifier: 'WAT-1L',
    identifier_type: 'SKU',
    sale_price: '150.00',
    minimum_stock: '0',
    is_active: true,
    product_is_active: true,
    category_id: null,
    category_name: null,
    quantity_on_hand: '10',
    last_known_wac: '100.00',
    attributes: [],
    total_count: 1,
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
      product_count: 0,
      variant_count: 0,
      active_cash_session_id: null,
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
  document.documentElement.setAttribute('lang', 'en');
  document.documentElement.setAttribute('dir', 'ltr');
});

describe('WS-F-1 Touchscreen Till Workflow', () => {
  it('1. Products come from the paged command (list_products_v2 with limit: 60, offset: 0) and legacy list_products is not called', async () => {
    const listProductsV2 = vi.fn(() => [mockProduct()]);
    const listProductsLegacy = vi.fn(() => []);
    wireInvoke(
      baseHandlers({
        list_products_v2: listProductsV2,
        list_products: listProductsLegacy,
      }),
    );

    render(<App />);
    await login();

    fireEvent.click(screen.getByRole('button', { name: 'Point of sale' }));
    await screen.findByTestId('pos-search');

    await waitFor(() => {
      expect(listProductsV2).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 60,
          offset: 0,
        }),
      );
    });

    expect(listProductsLegacy).not.toHaveBeenCalled();
  });

  it('2. Category buttons filter: clicking pos-category-7 reloads products with categoryId: 7', async () => {
    const listProductsV2 = vi.fn(() => [mockProduct({ category_id: 7 })]);
    wireInvoke(
      baseHandlers({
        list_categories: () => [{ id: 7, name: 'Drinks', is_active: true, usage_count: 3 }],
        list_products_v2: listProductsV2,
      }),
    );

    render(<App />);
    await login();

    fireEvent.click(screen.getByRole('button', { name: 'Point of sale' }));
    await screen.findByTestId('pos-search');

    const catBtn = await screen.findByTestId('pos-category-7');
    fireEvent.click(catBtn);

    await waitFor(
      () => {
        expect(listProductsV2).toHaveBeenCalledWith(
          expect.objectContaining({
            categoryId: 7,
          }),
        );
      },
      { timeout: 2000 },
    );
  });

  it('3. Tapping a tile adds to the cart: clicking pos-product-42 sets qty-42 to 1 and pos-total to 150.00', async () => {
    wireInvoke(
      baseHandlers({
        list_products_v2: () => [
          mockProduct({
            variant_id: 42,
            sale_price: '150.00',
            product_name: 'Water',
            variant_name: '1L',
          }),
        ],
      }),
    );

    render(<App />);
    await login();

    fireEvent.click(screen.getByRole('button', { name: 'Point of sale' }));
    await screen.findByTestId('pos-search');

    const tile = await screen.findByTestId('pos-product-42');
    fireEvent.click(tile);

    await screen.findByTestId('pos-cart');
    expect(screen.getByTestId('qty-42').textContent).toBe('1');
    expect(screen.getByTestId('pos-total').textContent).toBe('150.00');
  });

  it('4. The total is exact: three 150.00 items show 450.00, and three 0.10 items show 0.30 not 0.30000000000000004', async () => {
    const candyProduct = mockProduct({
      product_id: 2,
      variant_id: 99,
      sku: 'CND-1',
      display_identifier: 'CND-1',
      product_name: 'Candy',
      variant_name: '',
      sale_price: '0.10',
    });

    wireInvoke(
      baseHandlers({
        list_products_v2: () => [
          mockProduct({
            variant_id: 42,
            sale_price: '150.00',
            product_name: 'Water',
            variant_name: '1L',
          }),
          candyProduct,
        ],
      }),
    );

    render(<App />);
    await login();

    fireEvent.click(screen.getByRole('button', { name: 'Point of sale' }));
    await screen.findByTestId('pos-search');

    const waterTile = await screen.findByTestId('pos-product-42');
    fireEvent.click(waterTile);
    fireEvent.click(waterTile);
    fireEvent.click(waterTile);

    expect(screen.getByTestId('qty-42').textContent).toBe('3');
    expect(screen.getByTestId('pos-total').textContent).toBe('450.00');

    // Clear cart
    fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    const confirmClearBtn = await screen.findByRole('button', { name: 'Confirm' });
    fireEvent.click(confirmClearBtn);

    await waitFor(() => {
      expect(screen.getByTestId('pos-total').textContent).toBe('0.00');
    });

    // Add 0.10 item three times
    const candyTile = await screen.findByTestId('pos-product-99');
    fireEvent.click(candyTile);
    fireEvent.click(candyTile);
    fireEvent.click(candyTile);

    expect(screen.getByTestId('qty-99').textContent).toBe('3');
    expect(screen.getByTestId('pos-total').textContent).toBe('0.30');
    expect(screen.getByTestId('pos-total').textContent).not.toBe('0.30000000000000004');
  });

  it('5. Advanced search modal (ItemSearchModal) opens, allows multiple item selections without closing, and closes on Done', async () => {
    const waterProduct = mockProduct({
      variant_id: 42,
      sku: 'WAT-1L',
      primary_barcode: '6130000000042',
      sale_price: '150.00',
      product_name: 'Water',
      variant_name: '1L',
    });

    wireInvoke(
      baseHandlers({
        list_products_v2: () => [waterProduct],
      }),
    );

    render(<App />);
    await login();

    fireEvent.click(screen.getByRole('button', { name: 'Point of sale' }));
    await screen.findByTestId('pos-search');

    // Click advanced search button next to regular search
    const advBtn = screen.getByTestId('pos-advanced-search-btn');
    fireEvent.click(advBtn);

    // Identical ItemSearchModal should be open
    await screen.findByTestId('item-search-modal');
    const modalInput = screen.getByTestId('item-search-input');

    // Search by product query
    fireEvent.change(modalInput, { target: { value: 'Water' } });

    // Click item option
    const option = await screen.findByTestId('item-search-result-42');
    fireEvent.click(option);

    // Modal must NOT close on single selection; stays open for multiple selection
    expect(screen.getByTestId('item-search-modal')).toBeInTheDocument();
    expect(screen.getByTestId('qty-42').textContent).toBe('1');
    expect(screen.getByTestId('pos-total').textContent).toBe('150.00');

    // Click item option again to select second unit
    fireEvent.click(option);
    expect(screen.getByTestId('item-search-modal')).toBeInTheDocument();
    expect(screen.getByTestId('qty-42').textContent).toBe('2');
    expect(screen.getByTestId('pos-total').textContent).toBe('300.00');

    // Close via Done button in footer
    const doneBtn = screen.getByTestId('item-search-modal-cancel');
    fireEvent.click(doneBtn);

    await waitFor(() => {
      expect(screen.queryByTestId('item-search-modal')).toBeNull();
    });

    expect(screen.getByTestId('qty-42').textContent).toBe('2');
  });

  it('6. Advanced search modal can be closed via the Cancel button', async () => {
    const waterProduct = mockProduct({
      variant_id: 42,
      sku: 'WAT-1L',
      primary_barcode: '6130000000042',
      sale_price: '150.00',
      product_name: 'Water',
      variant_name: '1L',
    });

    wireInvoke(
      baseHandlers({
        list_products_v2: () => [waterProduct],
      }),
    );

    render(<App />);
    await login();

    fireEvent.click(screen.getByRole('button', { name: 'Point of sale' }));
    await screen.findByTestId('pos-search');

    // Open advanced search
    fireEvent.click(screen.getByTestId('pos-advanced-search-btn'));
    await screen.findByTestId('item-search-modal');

    // Click Cancel button
    const cancelBtn = screen.getByTestId('item-search-modal-cancel');
    fireEvent.click(cancelBtn);

    await waitFor(() => {
      expect(screen.queryByTestId('item-search-modal')).toBeNull();
    });
  });

  it('7. Payment switcher toggles between cash and credit modes', async () => {
    wireInvoke(baseHandlers());

    render(<App />);
    await login();

    fireEvent.click(screen.getByRole('button', { name: 'Point of sale' }));
    await screen.findByTestId('pos-payment-panel');

    const cashBtn = screen.getByTestId('payment-cash');
    const creditBtn = screen.getByTestId('payment-credit');

    expect(cashBtn).toHaveAttribute('aria-pressed', 'true');
    expect(creditBtn).toHaveAttribute('aria-pressed', 'false');

    // Switch to credit
    fireEvent.click(creditBtn);
    expect(creditBtn).toHaveAttribute('aria-pressed', 'true');
    expect(cashBtn).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('credit-customer-select')).toBeInTheDocument();

    // Switch back to cash
    fireEvent.click(cashBtn);
    expect(cashBtn).toHaveAttribute('aria-pressed', 'true');
    expect(creditBtn).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId('credit-customer-select')).toBeNull();
  });

  it('8. Displays error banner when stock is insufficient and retains visible cart items and checkout', async () => {
    const errorHandlers = baseHandlers({
      confirm_cash_sale: () => {
        const err = new Error('Insufficient stock');
        (err as unknown as { code: string }).code = 'PRECONDITION_FAILED';
        throw err;
      },
    });
    wireInvoke(errorHandlers);

    render(<App />);
    await login();

    fireEvent.click(screen.getByRole('button', { name: 'Point of sale' }));
    await screen.findByTestId('pos-search');

    // Verify stock indicator on catalog card
    const stockBadge = await screen.findByTestId('pos-product-stock-42');
    expect(stockBadge).toBeInTheDocument();
    expect(stockBadge.textContent).toBe('Stock: 10');

    // Add product to cart
    fireEvent.click(screen.getByTestId('pos-product-42'));
    expect(screen.getByTestId('qty-42').textContent).toBe('1');

    // Attempt to confirm sale
    fireEvent.click(screen.getByRole('button', { name: 'Confirm sale' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));

    // Error banner should appear
    const banner = await screen.findByTestId('pos-banner');
    expect(banner).toBeInTheDocument();

    // Cart items and checkout bar remain cleanly present and accessible
    expect(screen.getByTestId('pos-cart')).toBeInTheDocument();
    expect(screen.getByTestId('qty-42')).toBeInTheDocument();
    expect(screen.getByTestId('pos-checkout-bar')).toBeInTheDocument();
    expect(screen.getByTestId('pos-total')).toBeInTheDocument();
  });

  it('9. Completing a cash sale renders the professional document receipt modal and clicking Start new sale resets the till', async () => {
    const saleHandlers = baseHandlers({
      confirm_cash_sale: () => 127,
      get_sale_document: () => ({
        document_id: 127,
        document_type: 'CASH_SALE',
        status: 'POSTED',
        document_number: 'VC-2026-000001',
        document_date: '2026-09-12',
        posted_at: '2026-09-12T11:30:54.992788Z',
        subtotal: '150.00',
        total_amount: '150.00',
      }),
      list_sale_lines: () => [
        {
          line_number: 1,
          variant_sku_snapshot: 'WAT-1L',
          variant_name_snapshot: 'Water 1L',
          quantity: '1',
          unit_price: '150.00',
          line_total: '150.00',
        },
      ],
      list_document_jobs: () => [
        { job_kind: 'DRAWER', id: 1, status: 'PULSE_SUBMITTED', attempt_count: 1 },
        { job_kind: 'GENERATION', id: 2, status: 'COMPLETED', attempt_count: 1 },
        { job_kind: 'PRINT', id: 3, status: 'COMPLETED', attempt_count: 1 },
      ],
    });
    wireInvoke(saleHandlers);

    render(<App />);
    await login();

    fireEvent.click(screen.getByRole('button', { name: 'Point of sale' }));
    await screen.findByTestId('pos-search');

    // Add water to cart
    const waterTile = await screen.findByTestId('pos-product-42');
    fireEvent.click(waterTile);
    expect(screen.getByTestId('qty-42').textContent).toBe('1');
    expect(screen.getByTestId('pos-total').textContent).toBe('150.00');

    // Confirm cash checkout
    fireEvent.click(screen.getByRole('button', { name: 'Confirm sale' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));

    // Receipt modal appears with professional document
    await screen.findByTestId('pos-receipt-modal');
    expect(screen.getByTestId('pos-sold')).toHaveTextContent('127');
    expect(await screen.findByTestId('receipt')).toBeInTheDocument();
    expect(screen.getAllByTestId('receipt-number')[0]).toHaveTextContent('VC-2026-000001');
    expect(screen.getByTestId('receipt-total-amount')).toHaveTextContent('150.00 DZD');
    expect(screen.getByTestId('receipt-jobs')).toBeInTheDocument();

    // Click "Start new sale" to return to fresh till
    const newSaleBtn = screen.getByRole('button', { name: /start new sale/i });
    fireEvent.click(newSaleBtn);

    // Receipt modal is dismissed and cart is empty
    await waitFor(() => {
      expect(screen.queryByTestId('pos-receipt-modal')).toBeNull();
    });
    expect(screen.getByTestId('pos-total').textContent).toBe('0.00');
  });
});

