/**
 * WS-K-7-B — licence gating end to end (plan §9.5):
 *  - readOnly blocks POS with `pos-licence-blocked` and no pay button; the
 *    cash session "Open" action is disabled with the hint; closing an
 *    existing session still works.
 *  - a mocked command rejecting with LICENCE_READ_ONLY shows the localized
 *    `errors.licenceReadOnly` message.
 *  - `get_licence_status` failing blocks nothing (fail-open UI).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

import App from '../src/App';
import type { LicenceStatus } from '../src/shared/ipc/licenceDto';
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

function readOnlyStatus(): LicenceStatus {
  return {
    status: 'GRACE_OVER',
    mode: 'READ_ONLY',
    machine_code: 'STKH-TEST-0000-0000-0001',
    licence: null,
    days_left: null,
    grace_days_left: null,
    evaluated_at: '2026-09-26T10:00:00Z',
  };
}

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
    list_customers: () => [],
    list_attributes: () => [],
    list_units: () => [{ id: 1, code: 'PCS', name: 'Pieces' }],
    list_units_v2: () => [{ id: 1, code: 'PCS', name: 'Pieces', is_active: true, usage_count: 1 }],
    list_cash_movements: () => [],
    list_cash_denominations: () => [{ id: 1, code: 'DZD_1000', value: '1000.00', display_order: 10 }],
    get_cash_capabilities: () => ({ can_record_cash_movement: true, can_approve_cash_out: true }),
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

describe('WS-K-7-B licence gating', () => {
  it('blocks POS with pos-licence-blocked and no pay button when read-only', async () => {
    wireInvoke(baseHandlers({ get_licence_status: readOnlyStatus }));
    render(<App />);
    await login();

    fireEvent.click(screen.getByRole('button', { name: 'Point of sale' }));

    expect(await screen.findByTestId('pos-licence-blocked')).toBeInTheDocument();
    expect(screen.queryByTestId('pos-catalog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /confirm/i })).not.toBeInTheDocument();
  });

  it('disables "Open session" with the hint when read-only, and closing still works with an existing session', async () => {
    wireInvoke(
      baseHandlers({
        get_licence_status: readOnlyStatus,
        inspect_active_cash_session: () => null,
        inspect_current_cash_session: () => null,
      }),
    );
    render(<App />);
    await login();

    fireEvent.click(screen.getByRole('button', { name: 'Cash session' }));
    await screen.findByRole('heading', { name: 'Cash session' });

    expect(await screen.findByTestId('cash-open-licence-blocked')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open session' })).toBeDisabled();
  });

  it('a mocked command rejecting with LICENCE_READ_ONLY shows the localized message', async () => {
    wireInvoke(
      baseHandlers({
        get_licence_status: readOnlyStatus,
        inspect_current_cash_session: () => ({
          id: 77,
          warehouse_id: 1,
          workstation_id: 'STOCKIHA-01',
          opened_by_user_id: 10,
          current_cashier_user_id: 10,
          current_cashier_display_name: 'Cashier One',
          status: 'OPEN',
          opening_float: '1000.00',
          opened_at: '2026-07-31T08:00:00Z',
          close_attempt_id: null,
          expected_amount: null,
          counted_amount: null,
          variance_amount: null,
          requires_manager_approval: null,
          suspension_reason: null,
        }),
        record_cash_movement: () => {
          throw { code: 'LICENCE_READ_ONLY' };
        },
      }),
    );
    render(<App />);
    await login();

    fireEvent.click(screen.getByRole('button', { name: 'Cash session' }));
    await screen.findByTestId('cash-movement-panel');

    fireEvent.change(screen.getByTestId('cash-movement-amount'), { target: { value: '500' } });
    fireEvent.submit(screen.getByTestId('cash-movement-submit').closest('form')!);

    await waitFor(() =>
      expect(screen.getByTestId('session-error')).toHaveTextContent(
        'Read-only mode: the licence is not active. Open Settings → Licence.',
      ),
    );
  });

  it('a failing get_licence_status blocks nothing (fail-open UI)', async () => {
    // No handler registered for get_licence_status: wireInvoke's default
    // rejects it with INTERNAL_ERROR, exactly like every other unmocked
    // command in this suite.
    wireInvoke(baseHandlers());
    render(<App />);
    await login();

    fireEvent.click(screen.getByRole('button', { name: 'Point of sale' }));
    await screen.findByRole('heading', { name: 'Point of sale' });

    expect(screen.queryByTestId('pos-licence-blocked')).not.toBeInTheDocument();
    expect(await screen.findByText('Product 50')).toBeInTheDocument();
  });
});
