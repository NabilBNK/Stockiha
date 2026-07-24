import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

import App from '../src/App';
import {
  isPositiveExactQuantity,
  signedQuantityDelta,
} from '../src/features/inventory/StockAdjustmentScreen';

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

function handlers(extra: Handlers = {}): Handlers {
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
    list_warehouses: () => [{ id: 1, code: 'WH1', name: 'Main', is_active: true }],
    get_open_fiscal_period: () => ({
      id: 9,
      period_code: '2026',
      starts_on: '2026-07-01',
      ends_on: '2026-07-31',
    }),
    get_dashboard_summary: () => ({
      product_count: 1,
      variant_count: 1,
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
        name: 'Widget',
        sale_price: '10.00',
        is_active: true,
        quantity_on_hand: '20.000',
        last_known_wac: '5.000000',
      },
    ],
    list_stock_adjustment_units: () => [
      { unit_id: 1, unit_code: 'UNIT', unit_name: 'Unit', conversion_factor: '1', is_base: true },
      { unit_id: 2, unit_code: 'PACK', unit_name: 'Pack', conversion_factor: '6.000000', is_base: false },
    ],
    ...extra,
  };
}

async function loginAndNavigate() {
  await screen.findByRole('heading', { name: 'Sign in' });
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Stock adjustment' }));
  await screen.findByRole('heading', { name: 'Stock adjustment' });
  await screen.findByRole('option', { name: 'PACK — Pack' });
}

beforeEach(() => {
  invokeMock.mockReset();
  cleanup();
  document.documentElement.setAttribute('dir', 'ltr');
  document.documentElement.setAttribute('lang', 'en');
});

describe('exact signed quantity helpers', () => {
  it('accepts only non-zero positive quantities with at most three decimals', () => {
    expect(isPositiveExactQuantity('2')).toBe(true);
    expect(isPositiveExactQuantity('2.500')).toBe(true);
    expect(isPositiveExactQuantity('0')).toBe(false);
    expect(isPositiveExactQuantity('-2')).toBe(false);
    expect(isPositiveExactQuantity('1.0000')).toBe(false);
  });

  it('converts direction to a signed decimal string without numeric arithmetic', () => {
    expect(signedQuantityDelta('increase', '2.500')).toBe('2.500');
    expect(signedQuantityDelta('decrease', '2.500')).toBe('-2.500');
  });
});

describe('stock adjustment workflow', () => {
  it('submits a negative alternate-unit adjustment with a stable reason code', async () => {
    let call: Record<string, unknown> | null = null;
    wireInvoke(
      handlers({
        confirm_stock_adjustment: (args) => {
          call = args;
          return {
            document_id: 10,
            document_number: 'SA-2026-000001',
            movement_id: 11,
            journal_document_id: 12,
            journal_document_number: 'JE-2026-000001',
            warehouse_id: 1,
            variant_id: 7,
            quantity_delta: '-15.000',
            inventory_value_delta: '-75.0000',
            resulting_quantity_on_hand: '5.000',
            resulting_total_value: '25.0000',
            reason_code: 'DAMAGE',
          };
        },
      }),
    );
    render(<App />);
    await loginAndNavigate();

    fireEvent.click(screen.getByLabelText('Decrease stock'));
    fireEvent.change(screen.getByLabelText('Positive quantity'), { target: { value: '2.500' } });
    fireEvent.change(screen.getByLabelText('Unit'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'DAMAGE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm adjustment' }));

    await waitFor(() => expect(call).not.toBeNull());
    expect(call!.quantityDelta).toBe('-2.500');
    expect(call!.unitId).toBe(2);
    expect(call!.reasonCode).toBe('DAMAGE');
    expect(call!.note).toBeNull();
    expect(await screen.findByTestId('adjustment-banner')).toHaveTextContent('SA-2026-000001');
  });

  it('requires a note for OTHER and suppresses duplicate submits', async () => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise((done) => {
      resolve = done;
    });
    let calls = 0;
    wireInvoke(
      handlers({
        confirm_stock_adjustment: () => {
          calls += 1;
          return pending;
        },
      }),
    );
    render(<App />);
    await loginAndNavigate();

    fireEvent.change(screen.getByLabelText('Positive quantity'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'OTHER' } });
    expect(screen.getByRole('button', { name: 'Confirm adjustment' })).toBeDisabled();
    expect(screen.getByText('A note is required when the reason is Other.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Cycle count correction' } });
    const submit = screen.getByRole('button', { name: 'Confirm adjustment' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => expect(calls).toBe(1));

    resolve({
      document_id: 20,
      document_number: 'SA-2026-000002',
      movement_id: 21,
      journal_document_id: 22,
      journal_document_number: 'JE-2026-000002',
      warehouse_id: 1,
      variant_id: 7,
      quantity_delta: '1.000',
      inventory_value_delta: '5.0000',
      resulting_quantity_on_hand: '21.000',
      resulting_total_value: '105.0000',
      reason_code: 'OTHER',
    });
    await screen.findByTestId('adjustment-banner');
  });

  it('shows the dedicated zero-stock valuation error without leaking diagnostics', async () => {
    wireInvoke(
      handlers({
        confirm_stock_adjustment: () => {
          throw { code: 'UNSAFE_ZERO_STOCK_VALUATION', message: 'DO_NOT_LEAK' };
        },
      }),
    );
    render(<App />);
    await loginAndNavigate();
    fireEvent.change(screen.getByLabelText('Positive quantity'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm adjustment' }));
    const banner = await screen.findByTestId('adjustment-banner');
    expect(banner).toHaveTextContent('This increase cannot be valued because the item has no usable WAC.');
    expect(banner).not.toHaveTextContent('DO_NOT_LEAK');
  });

  it('renders Arabic labels in RTL', async () => {
    wireInvoke(handlers());
    render(<App />);
    await screen.findByRole('heading', { name: 'Sign in' });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    fireEvent.click(await screen.findByRole('button', { name: 'ع' }));
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(document.documentElement).toHaveAttribute('lang', 'ar');
    fireEvent.click(await screen.findByRole('button', { name: 'تسوية المخزون' }));
    expect(await screen.findByRole('heading', { name: 'تسوية المخزون' })).toBeInTheDocument();
    expect(screen.getByLabelText('زيادة المخزون')).toBeInTheDocument();
    expect(screen.getByLabelText('إنقاص المخزون')).toBeInTheDocument();
  });
});
