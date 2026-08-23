import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

import App from '../src/App';
import { formatExactDecimal } from '../src/features/inventory/exactDecimal';

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
      starts_on: '2026-08-01',
      ends_on: '2026-08-31',
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
    get_inventory_capabilities: () => ({
      can_manage_catalog: true,
      can_post_stock_receipt: true,
      can_view_inventory: true,
      can_manage_inventory: true,
    }),
    list_products: () => [{
      product_id: 1,
      variant_id: 7,
      sku: 'R8D-NB-S',
      name: 'Notebook',
      sale_price: '150.00',
      is_active: true,
      quantity_on_hand: '20.000',
      last_known_wac: '110.000000',
    }],
    list_inventory_snapshot: () => [{
      product_id: 1,
      variant_id: 7,
      product_name: 'Notebook',
      sku: 'R8D-NB-S',
      base_unit_code: 'PC',
      product_is_active: true,
      variant_is_active: true,
      quantity_on_hand: '20.000',
      last_known_wac: '110.000000',
      total_value: '2200.0000',
    }],
    ...extra,
  };
}

async function login() {
  await screen.findByRole('heading', { name: 'Sign in' });
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

beforeEach(() => {
  invokeMock.mockReset();
  cleanup();
  document.documentElement.setAttribute('dir', 'ltr');
  document.documentElement.setAttribute('lang', 'en');
});

describe('exact inventory presentation', () => {
  it('formats exact decimal strings without numeric conversion', () => {
    expect(formatExactDecimal('20.000')).toBe('20');
    expect(formatExactDecimal('110.250000')).toBe('110.25');
    expect(formatExactDecimal('-110.0000')).toBe('-110');
  });

  it('loads the warehouse snapshot and applies backend search/filter inputs', async () => {
    const calls: Record<string, unknown>[] = [];
    wireInvoke(handlers({
      list_inventory_snapshot: (args) => {
        calls.push(args);
        return [{
          product_id: 1,
          variant_id: 7,
          product_name: 'Notebook',
          sku: 'R8D-NB-S',
          base_unit_code: 'PC',
          product_is_active: true,
          variant_is_active: true,
          quantity_on_hand: '20.000',
          last_known_wac: '110.000000',
          total_value: '2200.0000',
        }];
      },
    }));
    render(<App />);
    await login();
    fireEvent.click(await screen.findByRole('button', { name: 'Inventory' }));

    const table = await screen.findByTestId('inventory-table');
    expect(table).toHaveTextContent('20 PC');
    expect(table).toHaveTextContent('110 DZD');
    expect(table).toHaveTextContent('2200 DZD');

    // Search is applied by a debounce on the input, not by a submit button:
    // there is deliberately no "Search" control to click any more.
    expect(screen.queryByRole('button', { name: 'Search' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search by product, SKU or barcode'), {
      target: { value: '613000000001' },
    });
    await waitFor(() => expect(calls[calls.length - 1]?.search).toBe('613000000001'));

    fireEvent.click(screen.getByLabelText('Include inactive products and variants'));
    await waitFor(() => expect(calls[calls.length - 1]?.includeInactive).toBe(true));
  });
});

describe('inventory permissions and posting results', () => {
  it('hides catalog and inventory actions when the capability projection denies them', async () => {
    wireInvoke(handlers({
      get_inventory_capabilities: () => ({
        can_manage_catalog: false,
        can_post_stock_receipt: false,
        can_view_inventory: false,
        can_manage_inventory: false,
      }),
    }));
    render(<App />);
    await login();
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('get_inventory_capabilities', {
      sessionToken: 'tok',
    }));

    expect(screen.queryByRole('button', { name: 'Products' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Inventory' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stock receipt' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Inventory Corrections' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Point of sale' })).toBeInTheDocument();
  });

  it('shows the official receipt number and resulting inventory controls', async () => {
    let receiptCall: Record<string, unknown> | null = null;
    wireInvoke(handlers({
      post_stock_receipt: (args) => {
        receiptCall = args;
        return {
          document_id: 42,
          document_number: 'SR-2026-000042',
          warehouse_id: 1,
          variant_id: 7,
          received_quantity: '10.000',
          received_value: '1200.0000',
          resulting_quantity_on_hand: '20.000',
          resulting_total_value: '2200.0000',
          resulting_wac: '110.000000',
        };
      },
    }));
    render(<App />);
    await login();
    fireEvent.click(await screen.findByRole('button', { name: 'Stock receipt' }));
    await screen.findByRole('heading', { name: 'Stock receipt' });

    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Unit cost'), { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: 'Receive stock' }));

    await waitFor(() => expect(receiptCall).not.toBeNull());
    expect(typeof receiptCall!.quantity).toBe('string');
    expect(typeof receiptCall!.unitCost).toBe('string');
    const result = await screen.findByTestId('stock-result');
    expect(result).toHaveTextContent('SR-2026-000042');
    expect(result).toHaveTextContent('1200 DZD');
    expect(result).toHaveTextContent('20');
    expect(result).toHaveTextContent('2200 DZD');
    expect(result).toHaveTextContent('110 DZD');
  });

  it('keeps a confirmed receipt result when the follow-up product refresh fails', async () => {
    let receiptCalls = 0;
    let productCalls = 0;
    wireInvoke(handlers({
      post_stock_receipt: () => {
        receiptCalls += 1;
        return {
          document_id: 44,
          document_number: 'SR-2026-000044',
          warehouse_id: 1,
          variant_id: 7,
          received_quantity: '1.000',
          received_value: '100.0000',
          resulting_quantity_on_hand: '21.000',
          resulting_total_value: '2300.0000',
          resulting_wac: '109.523810',
        };
      },
      list_products: () => {
        productCalls += 1;
        if (productCalls === 1) {
          return [{
            product_id: 1,
            variant_id: 7,
            sku: 'R8D-NB-S',
            name: 'Notebook',
            sale_price: '150.00',
            is_active: true,
            quantity_on_hand: '20.000',
            last_known_wac: '110.000000',
          }];
        }
        throw { code: 'UNKNOWN_ERROR' };
      },
    }));
    render(<App />);
    await login();
    fireEvent.click(await screen.findByRole('button', { name: 'Stock receipt' }));
    fireEvent.change(await screen.findByLabelText('Quantity'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Unit cost'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Receive stock' }));

    expect(await screen.findByTestId('stock-result')).toHaveTextContent('SR-2026-000044');
    expect(screen.getByTestId('stock-banner')).toHaveTextContent('Stock receipt posted');
    expect(receiptCalls).toBe(1);
  });

  it('reuses the same receipt request id after an uncertain response', async () => {
    const requestIds: unknown[] = [];
    let attempts = 0;
    wireInvoke(handlers({
      post_stock_receipt: (args) => {
        requestIds.push(args.requestId);
        attempts += 1;
        if (attempts === 1) throw { code: 'UNKNOWN_ERROR' };
        return {
          document_id: 43,
          document_number: 'SR-2026-000043',
          warehouse_id: 1,
          variant_id: 7,
          received_quantity: '10.000',
          received_value: '1000.0000',
          resulting_quantity_on_hand: '10.000',
          resulting_total_value: '1000.0000',
          resulting_wac: '100.000000',
        };
      },
    }));
    render(<App />);
    await login();
    fireEvent.click(await screen.findByRole('button', { name: 'Stock receipt' }));
    fireEvent.change(await screen.findByLabelText('Quantity'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Unit cost'), { target: { value: '100' } });

    const submit = screen.getByRole('button', { name: 'Receive stock' });
    fireEvent.click(submit);
    expect(await screen.findByTestId('stock-banner')).toHaveTextContent('Uncertain result');
    fireEvent.click(submit);
    expect(await screen.findByTestId('stock-result')).toHaveTextContent('SR-2026-000043');

    expect(requestIds).toHaveLength(2);
    expect(requestIds[1]).toBe(requestIds[0]);
  });
});
