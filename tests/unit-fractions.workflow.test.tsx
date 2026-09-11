/**
 * WS-D-13 Phase A -- decimal-vs-whole enforcement on units.
 *
 * Three layers are covered here, because the flag is only worth having if all
 * three hold:
 *   1. the validator itself, as pure string logic;
 *   2. the write path -- creating a unit persists the flag, and renaming one
 *      carries the CURRENT value rather than a default (the overwrite trap);
 *   3. the wiring -- every quantity-entry screen uses the ONE shared
 *      validator, with no per-screen copy of the rule.
 */
/// <reference types="vite/client" />
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

import App from '../src/App';
import { isQuantityValidForUnit } from '../src/features/inventory/exactDecimal';

// Sources are imported as text (Vite's `?raw`) rather than read with node:fs:
// this project has no @types/node, and `tsc -b` covers tests/ too.
import stockReceiptSource from '../src/features/inventory/StockReceiptScreen.tsx?raw';
import stockAdjustmentSource from '../src/features/inventory/StockAdjustmentScreen.tsx?raw';
import inventoryScreenSource from '../src/features/inventory/InventoryScreen.tsx?raw';

type Handlers = Record<string, (args: Record<string, unknown>) => unknown>;

function wireInvoke(handlers: Handlers) {
  invokeMock.mockImplementation((command: string, args: Record<string, unknown> = {}) => {
    const handler = handlers[command];
    if (!handler) return Promise.reject({ code: 'INTERNAL_ERROR' });
    try { return Promise.resolve(handler(args)); }
    catch (error) { return Promise.reject(error); }
  });
}

/** PC is a counted unit (whole only); KG is measured (decimals allowed). */
const UNITS = [
  { id: 1, code: 'PC', name: 'Piece', is_active: true, allows_fractions: false, usage_count: 1 },
  { id: 2, code: 'KG', name: 'Kilogram', is_active: true, allows_fractions: true, usage_count: 0 },
];

function baseHandlers(extra: Handlers = {}): Handlers {
  return {
    get_setup_status: () => ({
      initialized: true, administrator_exists: true, warehouse_exists: true,
      open_fiscal_period_exists: true, workstation_configured: true,
    }),
    login: () => ({ session_token: 'tok', expires_at: '2026-12-31T23:59:59Z' }),
    inspect_active_cash_session: () => null,
    list_warehouses: () => [{ id: 1, code: 'WH1', name: 'Main', is_active: true }],
    get_open_fiscal_period: () => ({
      id: 9, period_code: '2026', starts_on: '2026-08-01', ends_on: '2026-08-31',
    }),
    get_dashboard_summary: () => ({
      product_count: 1, variant_count: 1, active_cash_session_id: null,
      latest_document_id: null, latest_document_number: null,
      pending_generation_jobs: 0, pending_print_jobs: 0,
    }),
    get_inventory_capabilities: () => ({
      can_manage_catalog: true, can_post_stock_receipt: true,
      can_view_inventory: true, can_manage_inventory: true,
    }),
    list_units_v2: () => UNITS,
    list_categories: () => [],
    list_attributes: () => [],
    list_brands: () => [],
    list_attribute_values: () => [],
    list_products: () => [{
      product_id: 1, variant_id: 7, sku: 'NB-S', name: 'Notebook',
      sale_price: '150.00', is_active: true,
      quantity_on_hand: '20.000', last_known_wac: '110.000000',
    }],
    // The variant's base unit is PC -- whole numbers only.
    list_stock_adjustment_units: () => [
      { unit_id: 1, unit_code: 'PC', unit_name: 'Piece', conversion_factor: '1', is_base: true },
    ],
    ...extra,
  };
}

async function login() {
  await screen.findByRole('heading', { name: 'Sign in' });
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

/** The surfaces that actually accept a typed quantity, by path label. */
const QUANTITY_ENTRY_SOURCES: [string, string][] = [
  ['src/features/inventory/StockReceiptScreen.tsx', stockReceiptSource],
  ['src/features/inventory/StockAdjustmentScreen.tsx', stockAdjustmentSource],
];

/**
 * Comments explain the rule; only CODE may apply it. Stripping comments keeps
 * the wiring assertions below from being satisfied — or broken — by prose.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

beforeEach(() => {
  invokeMock.mockReset();
  cleanup();
  document.documentElement.setAttribute('dir', 'ltr');
  document.documentElement.setAttribute('lang', 'en');
});

// ---------------------------------------------------------------- 1. logic
describe('isQuantityValidForUnit (WS-D-13 A5)', () => {
  it('rejects "2.5" for a whole-number-only unit and accepts it for a decimal unit', () => {
    expect(isQuantityValidForUnit('2.5', false)).toBe(false);
    expect(isQuantityValidForUnit('2.5', true)).toBe(true);
  });

  it('accepts "2" for both', () => {
    expect(isQuantityValidForUnit('2', false)).toBe(true);
    expect(isQuantityValidForUnit('2', true)).toBe(true);
  });

  it('treats an all-zero fraction as whole, because "2.000" IS two', () => {
    expect(isQuantityValidForUnit('2.000', false)).toBe(true);
    expect(isQuantityValidForUnit('2.0001', false)).toBe(false);
  });

  it('never routes through a float, so precision beyond a double still decides', () => {
    // Number("10000000000000000.5") === 10000000000000000, i.e. a float would
    // report this as whole and let it through.
    expect(isQuantityValidForUnit('10000000000000000.5', false)).toBe(false);
  });

  it('rejects a malformed quantity under either flag', () => {
    for (const bad of ['', ' ', 'abc', '-1', '1.2.3', '1e3']) {
      expect(isQuantityValidForUnit(bad, true)).toBe(false);
      expect(isQuantityValidForUnit(bad, false)).toBe(false);
    }
  });
});

// ----------------------------------------------------------- 2. write path
describe('unit create/rename carry allows_fractions (WS-D-13 A1-A4)', () => {
  async function openUnitsTab() {
    render(<App />);
    await login();
    // The nav entry only appears once get_inventory_capabilities resolves.
    fireEvent.click(await screen.findByRole('button', { name: 'Catalogue setup' }));
    // The tabs are role="tab", not role="button".
    fireEvent.click(await screen.findByTestId('catalogue-setup-tab-units'));
  }

  it('persists allows_fractions when a unit is created, with no code input at all (WS-D-14 Part 3)', async () => {
    const createCalls: Record<string, unknown>[] = [];
    wireInvoke(baseHandlers({
      create_unit: (args) => { createCalls.push(args); return 3; },
    }));
    await openUnitsTab();

    // The code is generated server-side now: there is no field to type one
    // into, and no predicted code is shown before submitting.
    expect(screen.queryByLabelText('Unit code')).not.toBeInTheDocument();

    const flag = await screen.findByTestId('coded-ref-create-flag');
    // The create form defaults to permissive, matching the column default.
    expect(flag).toBeChecked();
    fireEvent.click(flag);
    expect(flag).not.toBeChecked();

    fireEvent.change(screen.getByLabelText('Unit name'), { target: { value: 'Box' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create unit' }));

    await waitFor(() => expect(createCalls).toHaveLength(1));
    expect(createCalls[0].name).toBe('Box');
    expect(createCalls[0].allowsFractions).toBe(false);
    expect(createCalls[0]).not.toHaveProperty('code');
  });

  // THE OVERWRITE TRAP. rename_unit assigns allows_fractions unconditionally,
  // so a rename that does not touch the toggle must still send the unit's
  // CURRENT value -- otherwise renaming "Piece" would silently re-open it to
  // fractions.
  it('preserves allows_fractions through a rename that does not touch it', async () => {
    const renameCalls: Record<string, unknown>[] = [];
    wireInvoke(baseHandlers({
      rename_unit: (args) => { renameCalls.push(args); return null; },
    }));
    await openUnitsTab();

    // PC is listed as whole-number-only.
    expect(await screen.findByTestId('coded-ref-flag-1')).toHaveTextContent('No');

    const rows = screen.getAllByRole('row');
    const pcRow = rows.find((r) => r.textContent?.includes('Piece'))!;
    // WS-D-14 Part 3: the code column shows plain text, never an input, even
    // while the row is being edited.
    expect(within(pcRow).getByTestId('coded-ref-code-1')).toHaveTextContent('PC');
    fireEvent.click(within(pcRow).getByRole('button', { name: 'Rename' }));
    expect(within(pcRow).getByTestId('coded-ref-code-1')).toHaveTextContent('PC');
    expect(within(pcRow).queryByLabelText('Unit code')).not.toBeInTheDocument();

    const editFlag = await screen.findByTestId('coded-ref-edit-flag-1');
    // Seeded from the row, not from the create form's default.
    expect(editFlag).not.toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(renameCalls).toHaveLength(1));
    expect(renameCalls[0].unitId).toBe(1);
    expect(renameCalls[0].allowsFractions).toBe(false);
    // The code is non-editable: rename_unit's signature has nowhere to put
    // one, and this call must not invent one either.
    expect(renameCalls[0]).not.toHaveProperty('code');
  });

  it('applies a deliberate change of the flag through rename', async () => {
    const renameCalls: Record<string, unknown>[] = [];
    wireInvoke(baseHandlers({
      rename_unit: (args) => { renameCalls.push(args); return null; },
    }));
    await openUnitsTab();
    await screen.findByTestId('coded-ref-flag-1');

    const rows = screen.getAllByRole('row');
    const pcRow = rows.find((r) => r.textContent?.includes('Piece'))!;
    fireEvent.click(within(pcRow).getByRole('button', { name: 'Rename' }));

    fireEvent.click(await screen.findByTestId('coded-ref-edit-flag-1'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(renameCalls).toHaveLength(1));
    expect(renameCalls[0].allowsFractions).toBe(true);
  });
});

// ------------------------------------------------------ 3. enforcement UX
describe('quantity entry rejects a fraction in a whole-number-only unit', () => {
  it('blocks "2.5" on Stock Receipt and names the unit, then accepts "2"', async () => {
    wireInvoke(baseHandlers());
    render(<App />);
    await login();
    fireEvent.click(await screen.findByRole('button', { name: 'Stock receipt' }));

    const barcodeInput = await screen.findByTestId('stock-barcode-input');
    fireEvent.change(barcodeInput, { target: { value: 'NB-S' } });
    fireEvent.keyDown(barcodeInput, { key: 'Enter' });

    const quantity = await screen.findByTestId('stock-quantity');
    // Wait for the variant's base unit (PC) and the unit catalogue to load.
    await waitFor(() => expect(invokeMock.mock.calls.some(
      (c) => c[0] === 'list_stock_adjustment_units',
    )).toBe(true));

    fireEvent.change(quantity, { target: { value: '2.5' } });
    fireEvent.change(screen.getByLabelText('Unit cost'), { target: { value: '10.00' } });

    expect(await screen.findByText('PC does not accept decimal quantities.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Receive stock' })).toBeDisabled();

    // A whole quantity in the same unit is fine.
    fireEvent.change(quantity, { target: { value: '2' } });
    await waitFor(() =>
      expect(screen.queryByText('PC does not accept decimal quantities.')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Receive stock' })).not.toBeDisabled();
  });
});

// --------------------------------------------------------------- 4. wiring
describe('one validator, every quantity-entry screen (WS-D-13 A5)', () => {
  it.each(QUANTITY_ENTRY_SOURCES)('%s uses the shared validator', (_path, source) => {
    expect(source).toContain('isQuantityValidForUnit');
    expect(source).toContain('useUnitFractionRules');
  });

  it.each(QUANTITY_ENTRY_SOURCES)('%s surfaces the unit-specific message', (_path, source) => {
    expect(source).toContain('units.wholeOnlyQuantity');
  });

  /**
   * A per-screen reimplementation is the failure this task exists to avoid:
   * six copies of "is this whole" drift apart, and five of them are then
   * wrong. No screen may read `allows_fractions` and decide for itself; the
   * flag reaches them only through `useUnitFractionRules`, and the decision
   * is only ever made by `isQuantityValidForUnit`.
   *
   * A legacy procurement screen contained a whole-number check that has
   * since been removed. This assertion targets the flag specifically rather
   * than banning Number.isInteger outright.
   */
  it.each(QUANTITY_ENTRY_SOURCES)('%s does not re-derive the rule from the flag', (_path, source) => {
    expect(stripComments(source)).not.toMatch(/allows_fractions/);
  });

  /**
   * InventoryScreen appears on the brief's list of quantity-entry surfaces,
   * but it has none: its only inputs are the search box and the
   * include-inactive checkbox, and quantity_on_hand is rendered read-only.
   * Asserting that keeps the correction honest -- if a quantity input is ever
   * added there, this fails and the validator has to be wired in too.
   */
  it('InventoryScreen has no quantity input, so there is nothing to validate', () => {
    expect(inventoryScreenSource).toContain('quantity_on_hand');
    expect(inventoryScreenSource).not.toMatch(/setQuantity|value=\{quantity\}/);
    expect(inventoryScreenSource).not.toContain('isQuantityValidForUnit');
  });
});
