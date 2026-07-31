import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

import App from '../src/App';

type Handlers = Record<string, (args: Record<string, unknown>) => unknown>;

function captured(value: Record<string, unknown> | null): Record<string, unknown> {
  if (value === null) throw new Error('expected captured IPC arguments');
  return value;
}

function wireInvoke(handlers: Handlers) {
  invokeMock.mockImplementation((command: string, args: Record<string, unknown> = {}) => {
    const handler = handlers[command];
    if (!handler) return Promise.reject({ code: 'INTERNAL_ERROR' });
    try { return Promise.resolve(handler(args)); } catch (error) { return Promise.reject(error); }
  });
}

function customer() {
  return {
    id: 41,
    code: 'CUS-041',
    name: 'Atlas Distribution',
    contact_name: 'Samir',
    phone: '0550000041',
    email: 'atlas@example.dz',
    address: 'Blida',
    tax_id: 'NIF-041',
    is_active: true,
    credit_enabled: true,
    credit_limit: '500000.00',
    payment_terms_days: 30,
    max_overdue_days: 60,
    exposure_amount: '170000.00',
    available_credit: '330000.00',
    oldest_open_due_date: '2026-07-10',
    created_at: '2026-07-01T00:00:00Z',
  };
}

function activeSession() {
  return { id: 77, warehouse_id: 1, opened_by_user_id: 1, opening_float: '10000.00', opened_at: '2026-07-30T08:00:00Z' };
}

function creditProduct() {
  return { product_id: 1, variant_id: 7, sku: 'SKU-7', name: 'Credit Item', sale_price: '1500.00', is_active: true, quantity_on_hand: '10.000', last_known_wac: '900.000000' };
}

function creditResult() {
  return { document_id: 700, document_number: 'CR-2026-000001', customer_id: 41, total_amount: '1500.00', due_date: '2026-08-29', exposure_amount: '171500.00', available_credit: '328500.00', journal_document_id: 701 };
}

function fullCustomerCapabilities() {
  return { can_view_customers: true, can_manage_customers: true, can_post_credit_sale: true, can_post_customer_payment: true, can_override_credit_limit: true };
}

function baseHandlers(extra: Handlers = {}): Handlers {
  return {
    get_setup_status: () => ({ initialized: true, administrator_exists: true, warehouse_exists: true, open_fiscal_period_exists: true, workstation_configured: true }),
    login: () => ({ session_token: 'tok', expires_at: '2026-12-31T23:59:59Z' }),
    logout: () => null,
    inspect_active_cash_session: () => null,
    list_warehouses: () => [{ id: 1, code: 'WH1', name: 'Main Warehouse', is_active: true }],
    get_open_fiscal_period: () => ({ id: 9, period_code: '2026', starts_on: '2026-01-01', ends_on: '2026-12-31' }),
    get_dashboard_summary: () => ({ product_count: 0, variant_count: 0, active_cash_session_id: null, latest_document_id: null, latest_document_number: null, pending_generation_jobs: 0, pending_print_jobs: 0 }),
    list_products: () => [],
    list_catalog_products: () => [],
    list_units: () => [],
    list_customers: () => [customer()],
    get_customer_capabilities: () => fullCustomerCapabilities(),
    get_customer_credit_summary: () => ({
      customer_id: 41, customer_code: 'CUS-041', customer_name: 'Atlas Distribution', is_active: true, credit_enabled: true,
      credit_limit: '500000.00', exposure_amount: '170000.00', available_credit: '330000.00', payment_terms_days: 30,
      max_overdue_days: 60, oldest_open_due_date: '2026-07-10', overdue_blocked: false, last_rebuilt_at: '2026-07-30T10:00:00Z',
    }),
    list_customer_ledger: () => [
      { id: 1, customer_id: 41, entry_type: 'CREDIT_INVOICE', amount_delta: '200000.00', document_id: 501, related_entry_id: null, due_date: '2026-08-10', posted_by_user_id: 1, workstation_id: 'POS-01', created_at: '2026-07-10T10:00:00Z' },
      { id: 2, customer_id: 41, entry_type: 'PAYMENT', amount_delta: '-30000.00', document_id: 502, related_entry_id: 1, due_date: null, posted_by_user_id: 1, workstation_id: 'POS-01', created_at: '2026-07-20T10:00:00Z' },
    ],
    list_open_customer_invoices: () => [],
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

async function openCreditPos() {
  fireEvent.click(screen.getByRole('button', { name: 'Point of sale' }));
  await screen.findByRole('heading', { name: 'Point of sale' });
  fireEvent.click(await screen.findByRole('button', { name: 'Add Credit Item' }));
  fireEvent.click(screen.getByTestId('payment-credit'));
  fireEvent.change(screen.getByTestId('credit-customer-select'), { target: { value: '41' } });
}

async function confirmCheckout() {
  fireEvent.click(screen.getByRole('button', { name: 'Confirm sale' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
}

beforeEach(() => {
  invokeMock.mockReset();
  cleanup();
  document.documentElement.setAttribute('dir', 'ltr');
  document.documentElement.setAttribute('lang', 'en');
  window.localStorage.setItem('stockiha.locale', 'en');
});

describe('S4-001 Customer Workflow', () => {
  it('opens customer directory and shows authoritative exposure', async () => {
    wireInvoke(baseHandlers()); render(<App />); await login();
    fireEvent.click(screen.getByRole('button', { name: 'Customers' }));
    expect(await screen.findByRole('heading', { name: 'Customers' })).toBeInTheDocument();
    expect(screen.getByText('CUS-041')).toBeInTheDocument();
    expect(screen.getByText('170000.00')).toBeInTheDocument();
    expect(screen.getByText('330000.00')).toBeInTheDocument();
  });

  it('shows cashier customer access as read-only instead of dead management controls', async () => {
    wireInvoke(baseHandlers({ get_customer_capabilities: () => ({ can_view_customers: true, can_manage_customers: false, can_post_credit_sale: true, can_post_customer_payment: true, can_override_credit_limit: false }) }));
    render(<App />); await login(); fireEvent.click(screen.getByRole('button', { name: 'Customers' }));
    expect(await screen.findByTestId('customers-read-only')).toHaveTextContent('Read-only customer access');
    expect(screen.queryByTestId('add-customer-btn')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
  });

  it('creates a credit customer without a caller-owned code and uses one contact field', async () => {
    let createArgs: Record<string, unknown> | null = null;
    wireInvoke(baseHandlers({
      create_customer: (args) => { createArgs = args; return { ...customer(), id: 42, code: 'CUS-000042', name: 'New Credit Client', contact_name: '0550123456', phone: null }; },
    }));
    render(<App />); await login(); fireEvent.click(screen.getByRole('button', { name: 'Customers' }));
    await screen.findByRole('heading', { name: 'Customers' });
    fireEvent.click(screen.getByTestId('add-customer-btn'));
    expect(screen.getByText('Generated automatically when the customer is saved.')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('customer-name-input'), { target: { value: 'New Credit Client' } });
    fireEvent.change(screen.getByTestId('customer-contact-input'), { target: { value: '0550123456' } });
    fireEvent.click(screen.getByTestId('customer-credit-enabled'));
    fireEvent.change(screen.getByTestId('customer-credit-limit'), { target: { value: '250000.00' } });
    fireEvent.click(screen.getByTestId('save-customer-btn'));
    await waitFor(() => expect(createArgs).not.toBeNull());
    const payload = captured(createArgs).payload as Record<string, unknown>;
    expect(payload.code).toBeUndefined();
    expect(payload.contact_name).toBe('0550123456');
    expect(payload.phone).toBeNull();
    expect(payload.credit_enabled).toBe(true);
    expect(payload.credit_limit).toBe('250000.00');
  });

  it('loads credit summary and immutable ledger detail', async () => {
    wireInvoke(baseHandlers()); render(<App />); await login(); fireEvent.click(screen.getByRole('button', { name: 'Customers' }));
    await screen.findByRole('heading', { name: 'Customers' }); fireEvent.click(screen.getByRole('button', { name: 'View' }));
    expect(await screen.findByTestId('customer-financial-detail')).toBeInTheDocument();
    expect(screen.getByText('Customer ledger')).toBeInTheDocument();
    expect(screen.getByText('CREDIT_INVOICE')).toBeInTheDocument();
    expect(screen.getByText('PAYMENT')).toBeInTheDocument();
    expect(screen.getByText('500000.00')).toBeInTheDocument();
  });

  it('posts a POS credit sale for the selected customer without using cash sale command', async () => {
    let creditArgs: Record<string, unknown> | null = null; let cashCalls = 0;
    wireInvoke(baseHandlers({ inspect_active_cash_session: activeSession, list_products: () => [creditProduct()], confirm_cash_sale: () => { cashCalls += 1; return 999; }, confirm_credit_sale: (args) => { creditArgs = args; return creditResult(); } }));
    render(<App />); await login(); await openCreditPos(); await confirmCheckout();
    await waitFor(() => expect(creditArgs).not.toBeNull());
    const args = captured(creditArgs);
    expect(cashCalls).toBe(0); expect(args.customerId).toBe(41); expect(args.warehouseId).toBe(1); expect(args.overrideToken).toBeNull();
    expect(args.lines).toEqual([{ variant_id: 7, quantity: '1', unit_price: '1500.00' }]);
    const success = await screen.findByTestId('credit-sale-success');
    expect(success).toHaveTextContent('CR-2026-000001'); expect(success).toHaveTextContent('171500.00'); expect(success).toHaveTextContent('328500.00');
  });

  it('uses a temporary manager session to authorize the exact blocked sale, then logs manager out', async () => {
    let authorizeArgs: Record<string, unknown> | null = null; let secondCreditArgs: Record<string, unknown> | null = null; let creditAttempts = 0; const logoutTokens: string[] = [];
    wireInvoke(baseHandlers({
      login: (args) => args.username === 'manager' ? { session_token: 'manager-token', expires_at: '2026-12-31T23:59:59Z' } : { session_token: 'tok', expires_at: '2026-12-31T23:59:59Z' },
      logout: (args) => { logoutTokens.push(String(args.sessionToken)); return null; }, inspect_active_cash_session: activeSession, list_products: () => [creditProduct()],
      confirm_credit_sale: (args) => { creditAttempts += 1; if (args.overrideToken == null) throw { code: 'CREDIT_POLICY_BLOCKED' }; secondCreditArgs = args; return creditResult(); },
      authorize_credit_override: (args) => { authorizeArgs = args; return 'override-token-1'; },
    }));
    render(<App />); await login(); await openCreditPos(); await confirmCheckout();
    expect(await screen.findByText('Manager override')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('override-manager-username'), { target: { value: 'manager' } });
    fireEvent.change(screen.getByTestId('override-manager-password'), { target: { value: 'manager-password' } });
    fireEvent.change(screen.getByTestId('override-reason'), { target: { value: 'Approved customer exception' } });
    fireEvent.click(screen.getByRole('button', { name: 'Authorize' }));
    await waitFor(() => expect(authorizeArgs).not.toBeNull());
    const authorization = captured(authorizeArgs);
    expect(authorization.sessionToken).toBe('manager-token'); expect(authorization.customerId).toBe(41); expect(authorization.reason).toBe('Approved customer exception');
    await waitFor(() => expect(logoutTokens).toContain('manager-token'));
    expect(await screen.findByText('Manager override authorized. Confirm the unchanged sale again.')).toBeInTheDocument();
    await confirmCheckout(); await waitFor(() => expect(secondCreditArgs).not.toBeNull());
    expect(captured(secondCreditArgs).overrideToken).toBe('override-token-1'); expect(creditAttempts).toBe(2);
    expect(await screen.findByTestId('credit-sale-success')).toHaveTextContent('CR-2026-000001');
  });
});
