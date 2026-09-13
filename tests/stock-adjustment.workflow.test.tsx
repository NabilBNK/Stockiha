import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

import App from '../src/App';
import {
  isValidCorrectionDate,
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
    get_inventory_capabilities: () => ({
      can_manage_catalog: true,
      can_post_stock_receipt: true,
      can_view_inventory: true,
      can_manage_inventory: true,
    }),
    get_inventory_corrections_setting: () => ({ enabled: true, canUpdate: true }),
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
  fireEvent.click(await screen.findByRole('button', { name: 'Inventory Corrections' }));
  await screen.findByRole('heading', { name: 'Inventory Corrections' });
  fireEvent.change(screen.getByLabelText('Item'), { target: { value: '7' } });
  await screen.findByRole('option', { name: 'PACK — Pack' });
  fireEvent.change(screen.getByLabelText('Correction date'), { target: { value: '2026-07-24' } });
}

beforeEach(() => {
  invokeMock.mockReset();
  cleanup();
  document.documentElement.setAttribute('dir', 'ltr');
  document.documentElement.setAttribute('lang', 'en');
});

describe('exact signed quantity helpers', () => {
  // WS-D-14 Part 1 — this is now a FORMAT check only: a positive exact
  // decimal, any number of fractional digits. Whether a fraction is actually
  // ALLOWED depends on the selected unit's allows_fractions flag, checked
  // separately via isQuantityValidForUnit in the screen itself (see the
  // 'stock adjustment workflow' describe block below) — never here. Before
  // WS-D-14 this function hardcoded whole-numbers-only for every unit, which
  // rejected "2.5" even for a decimal-capable unit like Kg.
  it('accepts any positive exact decimal, not just whole numbers', () => {
    expect(isPositiveExactQuantity('1')).toBe(true);
    expect(isPositiveExactQuantity('2')).toBe(true);
    expect(isPositiveExactQuantity('34')).toBe(true);
    expect(isPositiveExactQuantity('100')).toBe(true);
    expect(isPositiveExactQuantity('500')).toBe(true);

    // Decimals are a FORMAT match now; unit fitness is checked separately.
    expect(isPositiveExactQuantity('0.5')).toBe(true);
    expect(isPositiveExactQuantity('1.5')).toBe(true);
    expect(isPositiveExactQuantity('53.1')).toBe(true);
    expect(isPositiveExactQuantity('0.999')).toBe(true);
    expect(isPositiveExactQuantity('0.25')).toBe(true);
    expect(isPositiveExactQuantity('12.125')).toBe(true);
    expect(isPositiveExactQuantity('2.500')).toBe(true);
    expect(isPositiveExactQuantity('1.0')).toBe(true);

    // Reject letters, symbols, and malformed inputs
    expect(isPositiveExactQuantity('abc')).toBe(false);
    expect(isPositiveExactQuantity('1abc')).toBe(false);
    expect(isPositiveExactQuantity('abc1')).toBe(false);
    expect(isPositiveExactQuantity('1..5')).toBe(false);
    expect(isPositiveExactQuantity('--')).toBe(false);
    expect(isPositiveExactQuantity('++')).toBe(false);

    // Reject empty, zero, and negative -- a correction of zero is meaningless
    // regardless of unit, and this stays true after WS-D-14.
    expect(isPositiveExactQuantity('')).toBe(false);
    expect(isPositiveExactQuantity('0')).toBe(false);
    expect(isPositiveExactQuantity('0.000')).toBe(false);
    expect(isPositiveExactQuantity('-1')).toBe(false);
    expect(isPositiveExactQuantity('-2')).toBe(false);
  });

  it('converts direction to a signed string without numeric arithmetic, decimals included', () => {
    expect(signedQuantityDelta('increase', '25')).toBe('25');
    expect(signedQuantityDelta('decrease', '25')).toBe('-25');
    // WS-D-14: a decimal decrease must produce the correct negative STRING --
    // no Number()/parseFloat() anywhere near it.
    expect(signedQuantityDelta('decrease', '2.5')).toBe('-2.5');
    expect(signedQuantityDelta('increase', '2.5')).toBe('2.5');
  });

  it('keeps dates inside the fiscal-period bounds without UTC conversion', () => {
    expect(isValidCorrectionDate('2026-07-01', '2026-07-01', '2026-07-31')).toBe(true);
    expect(isValidCorrectionDate('2026-06-30', '2026-07-01', '2026-07-31')).toBe(false);
    expect(isValidCorrectionDate('2026-08-01', '2026-07-01', '2026-07-31')).toBe(false);
  });
});

describe('stock adjustment workflow', () => {
  it('validates quantity format independently of any unit, and updates the error dynamically', async () => {
    // No list_units_v2 handler here: the flag is unknown for every unit, so
    // this test isolates the pure FORMAT check (isPositiveExactQuantity),
    // never the unit-specific one -- that is covered in the next test.
    wireInvoke(handlers());
    render(<App />);
    await loginAndNavigate();

    const qtyInput = screen.getByLabelText('Positive quantity');
    const submitBtn = screen.getByRole('button', { name: 'Confirm adjustment' });

    // Empty quantity: submit disabled, no error yet
    expect(submitBtn).toBeDisabled();

    // Invalid quantity (alphabetic): the FORMAT message, not a unit message.
    fireEvent.change(qtyInput, { target: { value: 'abc' } });
    expect(await screen.findByText('Enter a valid positive quantity.')).toBeInTheDocument();
    expect(submitBtn).toBeDisabled();

    // Invalid quantity (zero): a correction of zero is meaningless regardless
    // of unit, so this is still rejected after WS-D-14.
    fireEvent.change(qtyInput, { target: { value: '0' } });
    expect(screen.getByText('Enter a valid positive quantity.')).toBeInTheDocument();
    expect(submitBtn).toBeDisabled();

    fireEvent.change(qtyInput, { target: { value: '-1' } });
    expect(screen.getByText('Enter a valid positive quantity.')).toBeInTheDocument();
    expect(submitBtn).toBeDisabled();

    // Valid whole quantity: error cleared, submit enabled.
    fireEvent.change(qtyInput, { target: { value: '34' } });
    expect(screen.queryByText('Enter a valid positive quantity.')).not.toBeInTheDocument();
    expect(submitBtn).toBeEnabled();

    // WS-D-14: a decimal is a VALID FORMAT on its own -- whether it is
    // actually accepted depends on the selected unit, which is unknown here
    // (no list_units_v2 wired), so nothing blocks it: fail-open, never
    // fail-closed, when the flag cannot be resolved.
    fireEvent.change(qtyInput, { target: { value: '1.5' } });
    expect(screen.queryByText('Enter a valid positive quantity.')).not.toBeInTheDocument();
    expect(submitBtn).toBeEnabled();
  });

  // WS-D-14 Part 1 -- THE DEFECT. Before this fix, isPositiveExactQuantity
  // rejected every decimal unconditionally, so isQuantityValidForUnit never
  // ran for one: the old whole-number rule always won first, even for a
  // unit whose allows_fractions is true.
  it('lets the SELECTED UNIT decide decimal fitness, not the quantity field', async () => {
    wireInvoke(handlers({
      // UNIT is whole-number-only; PACK is decimal-capable -- the reverse of
      // which one is the default-selected base unit, so switching between
      // them is what actually exercises the unit-driven branch.
      list_units_v2: () => [
        { id: 1, code: 'UNIT', name: 'Unit', is_active: true, allows_fractions: false, usage_count: 1 },
        { id: 2, code: 'PACK', name: 'Pack', is_active: true, allows_fractions: true, usage_count: 1 },
      ],
    }));
    render(<App />);
    await loginAndNavigate();

    const qtyInput = screen.getByLabelText('Positive quantity');
    const submitBtn = screen.getByRole('button', { name: 'Confirm adjustment' });

    // Default-selected unit is UNIT (is_base), which rejects fractions.
    await waitFor(() => expect((screen.getByLabelText('Unit') as HTMLSelectElement).value).toBe('1'));
    fireEvent.change(qtyInput, { target: { value: '2.5' } });
    expect(await screen.findByText('UNIT does not accept decimal quantities.')).toBeInTheDocument();
    expect(submitBtn).toBeDisabled();
    // Never the generic format message for a well-formed decimal.
    expect(screen.queryByText('Enter a valid positive quantity.')).not.toBeInTheDocument();

    // A whole quantity in the same unit is fine.
    fireEvent.change(qtyInput, { target: { value: '2' } });
    expect(screen.queryByText('UNIT does not accept decimal quantities.')).not.toBeInTheDocument();
    expect(submitBtn).toBeEnabled();

    // Switching to PACK (decimal-capable) accepts the same "2.5" outright.
    fireEvent.change(screen.getByLabelText('Unit'), { target: { value: '2' } });
    fireEvent.change(qtyInput, { target: { value: '2.5' } });
    await waitFor(() =>
      expect(screen.queryByText('UNIT does not accept decimal quantities.')).not.toBeInTheDocument());
    expect(submitBtn).toBeEnabled();
  });

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
            quantity_delta: '-12.000',
            inventory_value_delta: '-60.0000',
            resulting_quantity_on_hand: '8.000',
            resulting_total_value: '40.0000',
            reason_code: 'DAMAGE',
          };
        },
      }),
    );
    render(<App />);
    await loginAndNavigate();

    fireEvent.click(screen.getByLabelText('Decrease stock'));
    fireEvent.change(screen.getByLabelText('Positive quantity'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Unit'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'DAMAGE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm adjustment' }));

    await waitFor(() => expect(call).not.toBeNull());
    expect(call!.quantityDelta).toBe('-2');
    expect(call!.unitId).toBe(2);
    expect(call!.reasonCode).toBe('DAMAGE');
    expect(call!.note).toBeNull();
    expect(await screen.findByTestId('adjustment-banner')).toHaveTextContent('SA-2026-000001');
    const result = await screen.findByTestId('adjustment-result');
    expect(result).toHaveTextContent('JE-2026-000001');
    expect(result).toHaveTextContent('-12');
    expect(result).toHaveTextContent('-60 DZD');
    expect(result).toHaveTextContent('8');
    expect(result).toHaveTextContent('40 DZD');
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

  it('shows clear error when decrease exceeds available stock', async () => {
    wireInvoke(
      handlers({
        confirm_stock_adjustment: () => {
          // The Rust boundary classifies SQLSTATE 55000 whose message contains
          // "insufficient stock" into its own `INSUFFICIENT_STOCK` code, and
          // `IpcError` then drops the diagnostic entirely — only the code
          // crosses IPC. So this is the shape the frontend can actually
          // receive; a bare PRECONDITION_FAILED carrying a readable database
          // message is not reachable, and the frontend must never have to
          // substring-match one.
          throw { code: 'INSUFFICIENT_STOCK', message: 'DO_NOT_LEAK' };
        },
      }),
    );
    render(<App />);
    await loginAndNavigate();
    fireEvent.click(screen.getByLabelText('Decrease stock'));
    fireEvent.change(screen.getByLabelText('Positive quantity'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm adjustment' }));
    const banner = await screen.findByTestId('adjustment-banner');
    expect(banner).toHaveTextContent(
      'This adjustment cannot be completed because the decrease exceeds the available stock.',
    );
    expect(banner).not.toHaveTextContent('DO_NOT_LEAK');
  });

  it('shows clear error when inventory corrections are disabled', async () => {
    let callCount = 0;
    wireInvoke(
      handlers({
        get_inventory_corrections_setting: () => {
          callCount += 1;
          return { enabled: callCount <= 1, canUpdate: true };
        },
      }),
    );
    render(<App />);
    await loginAndNavigate();
    expect(await screen.findByTestId('corrections-disabled-banner')).toHaveTextContent(
      'Inventory corrections are currently disabled. Ask an administrator to enable inventory corrections before posting a new adjustment.',
    );
    expect(screen.getByRole('button', { name: 'Confirm adjustment' })).toBeDisabled();
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
    fireEvent.click(await screen.findByRole('button', { name: 'تصحيحات المخزون' }));
    expect(await screen.findByRole('heading', { name: 'تصحيحات المخزون' })).toBeInTheDocument();
    expect(screen.getByLabelText('زيادة المخزون')).toBeInTheDocument();
    expect(screen.getByLabelText('إنقاص المخزون')).toBeInTheDocument();
  });

  it('displays zero-quantity warning when selecting an item with 0 stock and no WAC for an increase adjustment', async () => {
    wireInvoke(
      handlers({
        list_products: () => [
          {
            product_id: 1,
            variant_id: 7,
            sku: 'SKU-ZERO',
            name: 'Zero Stock Item',
            sale_price: '10.00',
            is_active: true,
            quantity_on_hand: '0.000',
            last_known_wac: '0.000000',
          },
        ],
      }),
    );
    render(<App />);
    await loginAndNavigate();
    const warning = await screen.findByTestId('zero-qty-warning');
    expect(warning).toHaveTextContent('Warning: Zero Quantity');
    expect(warning).toHaveTextContent('Zero Stock Item');
  });
});

describe('Search Item Modal and Multi-Identifier Item Search', () => {
  const multiProductCatalog = [
    {
      product_id: 10,
      variant_id: 101,
      sku: 'SKU-00000123',
      name: 'Bed 90x200 Black',
      product_name: 'Bed',
      variant_name: 'Bed 90x200 Black',
      sale_price: '12000.00',
      is_active: true,
      quantity_on_hand: '15.000',
      last_known_wac: '9000.000000',
      primary_barcode: '1234567890123',
      attributes: [
        { name: 'Color', value: 'Black' },
        { name: 'Size', value: '90x200' },
      ],
    },
    {
      product_id: 10,
      variant_id: 102,
      sku: 'SKU-00000124',
      name: 'Bed 90x200 White',
      product_name: 'Bed',
      variant_name: 'Bed 90x200 White',
      sale_price: '12000.00',
      is_active: true,
      quantity_on_hand: '8.000',
      last_known_wac: '9200.000000',
      primary_barcode: '1234567890124',
      attributes: [
        { name: 'Color', value: 'White' },
        { name: 'Size', value: '90x200' },
      ],
    },
    {
      product_id: 20,
      variant_id: 201,
      sku: 'SKU-CHAIR-01',
      name: 'Desk Chair',
      product_name: 'Desk Chair',
      variant_name: 'Desk Chair',
      sale_price: '4500.00',
      is_active: true,
      quantity_on_hand: '25.000',
      last_known_wac: '3000.000000',
      primary_barcode: '9876543210123',
      attributes: [],
    },
    {
      product_id: 30,
      variant_id: 301,
      sku: 'SKU-TSHIRT-RED-L',
      name: 'T-Shirt - Red - L',
      product_name: 'T-Shirt',
      variant_name: 'T-Shirt - Red - L',
      sale_price: '1500.00',
      is_active: true,
      quantity_on_hand: '50.000',
      last_known_wac: '800.000000',
      primary_barcode: '613000000001',
      attributes: [
        { name: 'Color', value: 'Red' },
        { name: 'Size', value: 'L' },
      ],
    },
  ];

  async function openInventoryCorrectionsWithCatalog() {
    wireInvoke(
      handlers({
        list_products: () => multiProductCatalog,
        list_stock_adjustment_units: () => [
          { unit_id: 1, unit_code: 'UNIT', unit_name: 'Unit', conversion_factor: '1', is_base: true },
        ],
      }),
    );
    render(<App />);
    await screen.findByRole('heading', { name: 'Sign in' });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Inventory Corrections' }));
    await screen.findByRole('heading', { name: 'Inventory Corrections' });
  }

  it('TEST 1 & 8 — opens modal, displays items, and selecting an item populates the form', async () => {
    await openInventoryCorrectionsWithCatalog();

    // Open modal via dedicated trigger button
    const openBtn = screen.getByTestId('adjustment-open-picker-btn');
    fireEvent.click(openBtn);

    const modal = await screen.findByTestId('purchase-item-picker');
    expect(modal).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Choose item/i })).toBeInTheDocument();

    // Select Bed 90x200 Black
    const resultItem = screen.getByTestId('purchase-item-option-101');
    expect(resultItem).toHaveTextContent('Bed 90x200 Black');
    expect(resultItem).toHaveTextContent('SKU-00000123');
    fireEvent.click(resultItem);

    // Modal closes
    await waitFor(() => expect(screen.queryByTestId('purchase-item-picker')).not.toBeInTheDocument());

    // Selected item is populated into the form context
    const context = screen.getByText(/Current inventory context/i).closest('.sk-card');
    expect(context).toHaveTextContent('Bed 90x200 Black');
    expect(context).toHaveTextContent('SKU-00000123');
    expect(context).toHaveTextContent('15');
    expect(context).toHaveTextContent('9000 DZD');
  });

  it('TEST 2 — searches by Product name (e.g. Bed)', async () => {
    await openInventoryCorrectionsWithCatalog();
    fireEvent.click(screen.getByTestId('adjustment-open-picker-btn'));

    const searchInput = await screen.findByTestId('purchase-item-picker-input');
    fireEvent.change(searchInput, { target: { value: 'Bed' } });

    expect(screen.getByTestId('purchase-item-option-101')).toBeInTheDocument();
    expect(screen.getByTestId('purchase-item-option-102')).toBeInTheDocument();
    expect(screen.queryByTestId('purchase-item-option-201')).not.toBeInTheDocument();
  });

  it('TEST 3 — searches by Variant name (e.g. Bed 90x200 Black)', async () => {
    await openInventoryCorrectionsWithCatalog();
    fireEvent.click(screen.getByTestId('adjustment-open-picker-btn'));

    const searchInput = await screen.findByTestId('purchase-item-picker-input');
    fireEvent.change(searchInput, { target: { value: 'Bed 90x200 Black' } });

    expect(screen.getByTestId('purchase-item-option-101')).toBeInTheDocument();
    expect(screen.queryByTestId('purchase-item-option-102')).not.toBeInTheDocument();
    expect(screen.queryByTestId('purchase-item-option-201')).not.toBeInTheDocument();
  });

  it('TEST 4 — searches by Barcode (e.g. 1234567890123 and 613000000001)', async () => {
    await openInventoryCorrectionsWithCatalog();
    fireEvent.click(screen.getByTestId('adjustment-open-picker-btn'));

    const searchInput = await screen.findByTestId('purchase-item-picker-input');
    fireEvent.change(searchInput, { target: { value: '1234567890123' } });

    expect(screen.getByTestId('purchase-item-option-101')).toBeInTheDocument();
    expect(screen.queryByTestId('purchase-item-option-102')).not.toBeInTheDocument();
    expect(screen.queryByTestId('purchase-item-option-201')).not.toBeInTheDocument();
    expect(screen.queryByTestId('purchase-item-option-301')).not.toBeInTheDocument();

    // Search by 613000000001
    fireEvent.change(searchInput, { target: { value: '613000000001' } });
    expect(screen.getByTestId('purchase-item-option-301')).toBeInTheDocument();
    expect(screen.queryByTestId('purchase-item-option-101')).not.toBeInTheDocument();
  });

  it('TEST 5 — searches by SKU (e.g. SKU-00000123)', async () => {
    await openInventoryCorrectionsWithCatalog();
    fireEvent.click(screen.getByTestId('adjustment-open-picker-btn'));

    const searchInput = await screen.findByTestId('purchase-item-picker-input');
    fireEvent.change(searchInput, { target: { value: 'SKU-00000123' } });

    expect(screen.getByTestId('purchase-item-option-101')).toBeInTheDocument();
    expect(screen.queryByTestId('purchase-item-option-102')).not.toBeInTheDocument();
    expect(screen.queryByTestId('purchase-item-option-201')).not.toBeInTheDocument();
    expect(screen.queryByTestId('purchase-item-option-301')).not.toBeInTheDocument();
  });

  it('TEST 6 — searches by Variant attribute value (e.g. Color = Black or Color = Red)', async () => {
    await openInventoryCorrectionsWithCatalog();
    fireEvent.click(screen.getByTestId('adjustment-open-picker-btn'));

    const searchInput = await screen.findByTestId('purchase-item-picker-input');
    fireEvent.change(searchInput, { target: { value: 'Black' } });

    expect(screen.getByTestId('purchase-item-option-101')).toBeInTheDocument();
    expect(screen.queryByTestId('purchase-item-option-102')).not.toBeInTheDocument();
    expect(screen.queryByTestId('purchase-item-option-201')).not.toBeInTheDocument();
    expect(screen.queryByTestId('purchase-item-option-301')).not.toBeInTheDocument();

    // Search by "red"
    fireEvent.change(searchInput, { target: { value: 'red' } });
    expect(screen.getByTestId('purchase-item-option-301')).toBeInTheDocument();
    expect(screen.queryByTestId('purchase-item-option-101')).not.toBeInTheDocument();
    expect(screen.queryByTestId('purchase-item-option-102')).not.toBeInTheDocument();
    expect(screen.queryByTestId('purchase-item-option-201')).not.toBeInTheDocument();
  });

  it('TEST 7 & 10 — distinguishes variants and displays Barcode/SKU identifiers', async () => {
    await openInventoryCorrectionsWithCatalog();
    fireEvent.click(screen.getByTestId('adjustment-open-picker-btn'));

    const searchInput = await screen.findByTestId('purchase-item-picker-input');
    fireEvent.change(searchInput, { target: { value: 'Bed' } });

    const item1 = screen.getByTestId('purchase-item-option-101');
    const item2 = screen.getByTestId('purchase-item-option-102');

    expect(item1).toHaveTextContent('Bed 90x200 Black');
    expect(item1).toHaveTextContent('1234567890123');
    expect(item1).toHaveTextContent('SKU-00000123');
    expect(item1).toHaveTextContent('Stock: 15.000');
    expect(item1).toHaveTextContent('WAC: 9000.000000 DZD');

    expect(item2).toHaveTextContent('Bed 90x200 White');
    expect(item2).toHaveTextContent('1234567890124');
    expect(item2).toHaveTextContent('SKU-00000124');
    expect(item2).toHaveTextContent('Stock: 8.000');
    expect(item2).toHaveTextContent('WAC: 9200.000000 DZD');
  });

  it('TEST 9 — displays "No matching products" when query matches nothing', async () => {
    await openInventoryCorrectionsWithCatalog();
    fireEvent.click(screen.getByTestId('adjustment-open-picker-btn'));

    const searchInput = await screen.findByTestId('purchase-item-picker-input');
    fireEvent.change(searchInput, { target: { value: 'nonexistent-item-query-xyz' } });

    expect(await screen.findByTestId('purchase-item-picker-empty')).toHaveTextContent('No matching products');
    expect(screen.queryByTestId('purchase-item-option-101')).not.toBeInTheDocument();
  });

  it('closes modal when pressing Escape or clicking Cancel', async () => {
    await openInventoryCorrectionsWithCatalog();
    fireEvent.click(screen.getByTestId('adjustment-open-picker-btn'));

    expect(await screen.findByTestId('purchase-item-picker')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('purchase-item-picker')).not.toBeInTheDocument());

    // Reopen and test Cancel/Close button
    fireEvent.click(screen.getByTestId('adjustment-open-picker-btn'));
    expect(await screen.findByTestId('purchase-item-picker')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('purchase-item-picker-close'));
    await waitFor(() => expect(screen.queryByTestId('purchase-item-picker')).not.toBeInTheDocument());
  });

  it('TEST 11 — scans barcode directly via input to select item', async () => {
    await openInventoryCorrectionsWithCatalog();

    const barcodeInput = screen.getByTestId('adjustment-barcode-input');
    fireEvent.change(barcodeInput, { target: { value: '1234567890123' } });
    fireEvent.keyDown(barcodeInput, { key: 'Enter' });

    // Selected item is populated into the form context
    const context = screen.getByText(/Current inventory context/i).closest('.sk-card');
    expect(context).toHaveTextContent('Bed 90x200 Black');
    expect(context).toHaveTextContent('SKU-00000123');
    expect(context).toHaveTextContent('15');
  });
});

