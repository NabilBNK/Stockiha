/**
 * WS-D-9 / WS-D-9B — the new Catalog page, built fresh alongside the existing
 * Products page. These tests cover the bindings that are easy to get quietly
 * wrong: commit-on-blur (never on keystroke), revert-on-failure, the
 * update_variant overwrite trap, the CR2 retired-attribute-value wiring, the
 * minimum stock that add_variant cannot carry, and the one place on this page
 * where autosave would be wrong — creating a product.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));

import App from '../src/App';

type Handlers = Record<string, (args: Record<string, unknown>) => unknown>;

function wireInvoke(handlers: Handlers) {
  invokeMock.mockImplementation((command: string, args: Record<string, unknown> = {}) => {
    const handler = handlers[command];
    if (!handler) return Promise.reject({ code: 'INTERNAL_ERROR' });
    try { return Promise.resolve(handler(args)); }
    catch (e) { return Promise.reject(e); }
  });
}

const initialized = () => ({
  initialized: true, administrator_exists: true, warehouse_exists: true,
  open_fiscal_period_exists: true, workstation_configured: true,
});

function makeHandlers(extra: Handlers = {}): Handlers {
  return {
    get_setup_status: initialized,
    login: () => ({ session_token: 'tok', expires_at: '2026-12-31T23:59:59Z' }),
    inspect_active_cash_session: () => null,
    list_warehouses: () => [{ id: 1, code: 'WH1', name: 'Main', is_active: true }],
    get_open_fiscal_period: () => ({ id: 1, period_code: '2026', starts_on: '2026-01-01', ends_on: '2026-12-31' }),
    get_dashboard_summary: () => ({
      product_count: 0, variant_count: 0, active_cash_session_id: null,
      latest_document_id: null, latest_document_number: null,
      pending_generation_jobs: 0, pending_print_jobs: 0,
    }),
    get_inventory_capabilities: () => ({
      can_manage_catalog: true,
      can_post_stock_receipt: true,
      can_view_inventory: true,
      can_manage_inventory: true,
    }),
    list_products_v2: () => [],
    list_categories: () => [],
    list_attributes: () => [],
    list_units: () => [{ id: 1, code: 'PCS', name: 'Pieces' }],
    list_units_v2: () => [{ id: 1, code: 'PCS', name: 'Pieces', is_active: true, usage_count: 1 }],
    ...extra,
  };
}

/** A catalog.list_products_v2 row — ProductListItemV2, all 18 columns. */
function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    product_id: 1,
    variant_id: 10,
    sku: 'PIL-1',
    product_name: 'Pillow',
    variant_name: 'Pillow',
    primary_barcode: null,
    display_identifier: 'PIL-1',
    identifier_type: 'SKU',
    sale_price: '1250.50',
    minimum_stock: '5.500',
    is_active: true,
    product_is_active: true,
    category_id: 7,
    category_name: 'Bedding',
    quantity_on_hand: '12',
    last_known_wac: '900',
    attributes: [],
    total_count: 1,
    ...overrides,
  };
}

/**
 * catalog.get_product_detail — carries name_override and minimum_stock.
 * The variant members are annotated rather than inferred so tests can push a
 * newly added variant onto `variants` without fighting a literal type.
 */
type VariantFixture = {
  variant_id: number;
  sku: string;
  name_override: string | null;
  effective_variant_name: string;
  primary_barcode: string | null;
  operational_identifier: string;
  identifier_type: 'BARCODE' | 'SKU';
  sale_price: string;
  minimum_stock: string;
  is_active: boolean;
  attribute_signature: string;
  attributes: Record<string, unknown>[];
  barcodes: Record<string, unknown>[];
};

function detailFixture(overrides: Record<string, unknown> = {}) {
  return {
    product_id: 1,
    name: 'Pillow',
    unit_id: 1,
    unit_code: 'PCS',
    unit_name: 'Pieces',
    is_active: true,
    category_id: 7 as number | null,
    variants: [{
      variant_id: 10,
      sku: 'PIL-1',
      name_override: null,
      effective_variant_name: 'Pillow',
      primary_barcode: null,
      operational_identifier: 'PIL-1',
      identifier_type: 'SKU',
      sale_price: '1250.50',
      minimum_stock: '5.500',
      is_active: true,
      attribute_signature: '',
      attributes: [],
      barcodes: [],
    }] as VariantFixture[],
    ...overrides,
  };
}

async function loginAndOpenCatalog() {
  await screen.findByRole('heading', { name: 'Sign in' });
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Catalog (new)' }));
  await screen.findByTestId('catalog2-screen');
}

/** Expands the product group and puts the price cell into edit mode. */
async function openPriceEditor(productId = 1, variantId = 10) {
  fireEvent.click(await screen.findByTestId(`catalog2-expand-${productId}`));
  fireEvent.click(await screen.findByTestId(`catalog2-price-${variantId}-trigger`));
  return screen.findByTestId(`catalog2-price-${variantId}`);
}

beforeEach(() => {
  invokeMock.mockReset();
  cleanup();
  document.documentElement.setAttribute('dir', 'ltr');
});

describe('grouped rows (WS-D-9 RULING 2)', () => {
  it('renders one collapsed row per product and reveals its variants on expand', async () => {
    const variants = Array.from({ length: 6 }, (_, i) => row({
      variant_id: 100 + i,
      sku: `PIL-${i}`,
      display_identifier: `PIL-${i}`,
      variant_name: `Pillow ${i}`,
      total_count: 6,
    }));
    wireInvoke(makeHandlers({ list_products_v2: () => variants }));
    render(<App />);
    await loginAndOpenCatalog();

    // Collapsed: one product row, no variant lines.
    expect(await screen.findByTestId('catalog2-product-1')).toBeInTheDocument();
    expect(screen.getByTestId('catalog2-variant-count-1').textContent).toBe('6 variants');
    for (const v of variants) {
      expect(screen.queryByTestId(`catalog2-variant-${v.variant_id}`)).not.toBeInTheDocument();
    }

    fireEvent.click(screen.getByTestId('catalog2-expand-1'));

    // Expanded: the same single product row, plus six variant lines.
    expect(screen.getAllByTestId(/^catalog2-product-\d+$/)).toHaveLength(1);
    for (const v of variants) {
      expect(screen.getByTestId(`catalog2-variant-${v.variant_id}`)).toBeInTheDocument();
    }
  });

  it('shows the category on the product row only, and the identifier type it was given', async () => {
    wireInvoke(makeHandlers({
      list_products_v2: () => [row({
        identifier_type: 'BARCODE',
        primary_barcode: '6130000000017',
        display_identifier: '6130000000017',
      })],
    }));
    render(<App />);
    await loginAndOpenCatalog();

    const productRow = await screen.findByTestId('catalog2-product-1');
    expect(within(productRow).getByText('Bedding')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('catalog2-expand-1'));
    const variantRow = screen.getByTestId('catalog2-variant-10');
    // display_identifier and identifier_type are computed in SQL and only
    // displayed here — never inferred from the presence of a barcode.
    expect(within(variantRow).getByText('6130000000017')).toBeInTheDocument();
    expect(within(variantRow).getByText('Barcode')).toBeInTheDocument();
    // Category belongs to the product; the variant line must not repeat it.
    expect(within(variantRow).queryByText('Bedding')).not.toBeInTheDocument();
  });
});

describe('inline cell editing (WS-D-9 RULING 3)', () => {
  const editHandlers = (extra: Handlers = {}) => makeHandlers({
    list_products_v2: () => [row()],
    get_product_detail: () => detailFixture(),
    ...extra,
  });

  // THE OVERWRITE TRAP. update_variant assigns name_override, sale_price,
  // is_active and minimum_stock unconditionally. A list row carries the
  // EFFECTIVE variant name, not the override, so the commit re-reads
  // get_product_detail and sends a full payload from that snapshot.
  it('commits once on blur, with the exact string typed, carrying the untouched columns', async () => {
    const variantCalls: Record<string, unknown>[] = [];
    wireInvoke(editHandlers({
      update_variant_v2: (args) => { variantCalls.push(args); return null; },
    }));
    render(<App />);
    await loginAndOpenCatalog();

    const price = await openPriceEditor();
    expect((price as HTMLInputElement).value).toBe('1250.50');

    fireEvent.change(price, { target: { value: '2500.00' } });
    fireEvent.blur(price);

    await waitFor(() => expect(variantCalls).toHaveLength(1));
    const call = variantCalls[0];
    expect(call.variantId).toBe(10);
    // Byte-for-byte as typed — never parsed, never rounded.
    expect(call.salePrice).toBe('2500.00');
    expect(typeof call.salePrice).toBe('string');
    // Untouched columns, at their current server values.
    expect(call.minimumStock).toBe('5.500');
    expect(call.nameOverride).toBeNull();
    expect(call.isActive).toBe(true);
  });

  // Typing 2000 -> 2500 passes through "2". A keystroke save would write
  // 2 DZD to a live product, so there is no keystroke path and no debounce.
  it('commits nothing at all while the user is still typing', async () => {
    wireInvoke(editHandlers({ update_variant_v2: () => null }));
    render(<App />);
    await loginAndOpenCatalog();

    const price = await openPriceEditor();
    invokeMock.mockClear();

    fireEvent.change(price, { target: { value: '2' } });
    fireEvent.change(price, { target: { value: '25' } });
    fireEvent.change(price, { target: { value: '2500.00' } });

    await waitFor(() => expect((price as HTMLInputElement).value).toBe('2500.00'));
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('cancels on Escape, restoring the previous value and sending nothing', async () => {
    wireInvoke(editHandlers({ update_variant_v2: () => null }));
    render(<App />);
    await loginAndOpenCatalog();

    const price = await openPriceEditor();
    invokeMock.mockClear();

    fireEvent.change(price, { target: { value: '999.00' } });
    fireEvent.keyDown(price, { key: 'Escape' });
    // Blur follows Escape in a real browser when the input is removed; it must
    // not resurrect the cancelled commit.
    fireEvent.blur(price);

    // The displayed value is formatted; the stored value is untouched.
    const trigger = await screen.findByTestId('catalog2-price-10-trigger');
    expect(trigger.textContent).toBe('1,250.50');
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('reverts the cell to the last server value when the commit fails, and says why', async () => {
    wireInvoke(editHandlers({
      update_variant_v2: () => { throw { code: 'VALIDATION_ERROR' }; },
    }));
    render(<App />);
    await loginAndOpenCatalog();

    const price = await openPriceEditor();
    fireEvent.change(price, { target: { value: '9999.00' } });
    fireEvent.blur(price);

    const error = await screen.findByTestId('catalog2-price-10-error');
    expect(error.textContent).toBe('Some of the entered values are invalid.');
    // Never leave the UI showing a value the database does not hold.
    const trigger = await screen.findByTestId('catalog2-price-10-trigger');
    expect(trigger.textContent).toBe('1,250.50');
  });

  it('never sends an invalid value and keeps the cell editable', async () => {
    const variantCalls: Record<string, unknown>[] = [];
    wireInvoke(editHandlers({
      update_variant_v2: (args) => { variantCalls.push(args); return null; },
    }));
    render(<App />);
    await loginAndOpenCatalog();

    const price = await openPriceEditor();
    fireEvent.change(price, { target: { value: 'abc' } });
    fireEvent.blur(price);

    expect(await screen.findByTestId('catalog2-price-10-error')).toBeInTheDocument();
    expect(variantCalls).toHaveLength(0);
    expect((screen.getByTestId('catalog2-price-10') as HTMLInputElement).value).toBe('abc');
  });

  it('round-trips a minimum stock of "0" as "0"', async () => {
    const variantCalls: Record<string, unknown>[] = [];
    wireInvoke(editHandlers({
      update_variant_v2: (args) => { variantCalls.push(args); return null; },
    }));
    render(<App />);
    await loginAndOpenCatalog();

    fireEvent.click(await screen.findByTestId('catalog2-expand-1'));
    fireEvent.click(await screen.findByTestId('catalog2-min-10-trigger'));
    const min = await screen.findByTestId('catalog2-min-10');
    expect((min as HTMLInputElement).value).toBe('5.500');

    fireEvent.change(min, { target: { value: '0' } });
    fireEvent.blur(min);

    await waitFor(() => expect(variantCalls).toHaveLength(1));
    // "0" means "never warn me about this item" — a meaning, not a default.
    expect(variantCalls[0].minimumStock).toBe('0');
    // ...and the price it did not touch survives.
    expect(variantCalls[0].salePrice).toBe('1250.50');

    // Stock is derived from stock movements and owned by Stock Receipt and
    // Inventory Corrections. It is displayed here, never edited.
    expect(screen.queryByTestId('catalog2-stock-10-trigger')).not.toBeInTheDocument();
  });
});

describe('server-side filtering and paging (WS-D-9)', () => {
  it('resets the offset to 0 when a filter changes', async () => {
    const listCalls: Record<string, unknown>[] = [];
    wireInvoke(makeHandlers({
      list_categories: () => [{ id: 7, name: 'Bedding', is_active: true, usage_count: 1 }],
      list_products_v2: (args) => {
        listCalls.push(args);
        return [row({ total_count: 120 })];
      },
    }));
    render(<App />);
    await loginAndOpenCatalog();

    await screen.findByTestId('catalog2-product-1');
    await waitFor(() => expect(listCalls.length).toBeGreaterThan(0));
    expect(listCalls[listCalls.length - 1].offset).toBe(0);

    fireEvent.click(screen.getByTestId('catalog2-next'));
    await waitFor(() => expect(listCalls[listCalls.length - 1].offset).toBe(50));

    // A filter change must return to the first page, or the user is shown
    // page 2 of a result set whose page 1 they never saw.
    fireEvent.change(screen.getByTestId('catalog2-category'), { target: { value: '7' } });
    await waitFor(() => {
      const last = listCalls[listCalls.length - 1];
      expect(last.categoryId).toBe(7);
      expect(last.offset).toBe(0);
    });
  });

  it('submits the search immediately on Enter, without waiting for the debounce', async () => {
    const listCalls: Record<string, unknown>[] = [];
    wireInvoke(makeHandlers({
      list_products_v2: (args) => { listCalls.push(args); return [row()]; },
    }));
    render(<App />);
    await loginAndOpenCatalog();
    await screen.findByTestId('catalog2-product-1');

    // A scanner types fast and terminates with Enter (a form submit).
    const searchField = screen.getByTestId('catalog2-search');
    fireEvent.change(searchField, { target: { value: '6130000000017' } });
    fireEvent.submit(searchField.closest('form')!);

    await waitFor(() =>
      expect(listCalls[listCalls.length - 1].search).toBe('6130000000017'));
  });
});

describe('the detail panel (WS-D-9 RULING 4)', () => {
  // CR2. list_attributes offers ACTIVE values only, while get_product_detail
  // stays unfiltered so history survives. mergeAssignedValues reconciles the
  // two; a panel that rendered its own picker without it would silently drop
  // a retired value on the next save. This proves the wiring is real.
  it('keeps a retired attribute value visible and selected in the panel', async () => {
    wireInvoke(makeHandlers({
      list_products_v2: () => [row()],
      get_product_detail: () => detailFixture({
        variants: [{
          variant_id: 10,
          sku: 'PIL-1',
          name_override: null,
          effective_variant_name: 'Pillow',
          primary_barcode: null,
          operational_identifier: 'PIL-1',
          identifier_type: 'SKU',
          sale_price: '1250.50',
          minimum_stock: '5.500',
          is_active: true,
          attribute_signature: '1:3|2:9',
          attributes: [
            // value retired, attribute still active
            { attribute_id: 1, attribute_name: 'Color', attribute_value_id: 3, value: 'Burgendy' },
            // whole attribute retired -> absent from list_attributes entirely
            { attribute_id: 2, attribute_name: 'Retired Attr', attribute_value_id: 9, value: 'OldValue' },
          ],
          barcodes: [],
        }],
      }),
      list_attributes: () => [
        { attribute_id: 1, name: 'Color', attribute_values: [{ id: 4, value: 'Blue', is_active: true }] },
      ],
    }));
    render(<App />);
    await loginAndOpenCatalog();

    fireEvent.click(await screen.findByTestId('catalog2-expand-1'));
    // Opening from a variant's menu focuses that variant in the panel.
    fireEvent.click(await screen.findByTestId('catalog2-variant-menu-10'));
    await screen.findByTestId('catalog2-panel');

    const retired = await screen.findByRole('radio', { name: /Burgendy/ });
    expect(retired).toBeChecked();
    expect(screen.getByTestId('attr-value-inactive-3')).toBeInTheDocument();

    expect(screen.getByText('Retired Attr')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /OldValue/ })).toBeChecked();
    expect(screen.getByTestId('attr-value-inactive-9')).toBeInTheDocument();

    // Still-active values remain offered and unflagged.
    expect(screen.getByRole('radio', { name: 'Blue' })).toBeInTheDocument();
    expect(screen.queryByTestId('attr-value-inactive-4')).not.toBeInTheDocument();
  });

  // THE OVERWRITE TRAP — product half. update_product assigns name, unit_id,
  // is_active and category_id unconditionally, so every commit carries the
  // current server value of the columns the user did not touch.
  it('opens over the table and preserves the untouched product columns on every commit', async () => {
    const productCalls: Record<string, unknown>[] = [];
    const detail = detailFixture();
    wireInvoke(makeHandlers({
      list_products_v2: () => [row()],
      get_product_detail: () => detail,
      list_categories: () => [
        { id: 7, name: 'Bedding', is_active: true, usage_count: 1 },
        { id: 9, name: 'Cushions', is_active: true, usage_count: 0 },
      ],
      update_product_v2: (args) => {
        productCalls.push(args);
        detail.name = (args.name as string) ?? detail.name;
        detail.category_id = args.categoryId as number | null;
        return null;
      },
    }));
    render(<App />);
    await loginAndOpenCatalog();

    fireEvent.click(await screen.findByTestId('catalog2-product-menu-1'));
    await screen.findByTestId('catalog2-panel');
    // RULING 4: the panel overlays the table; it never replaces it or splits
    // the screen permanently.
    expect(screen.getByTestId('catalog2-table')).toBeInTheDocument();

    // WS-D-11 R5: product fields live behind their own tab now, so variant
    // editing gets the full height. One click, clearly labelled.
    fireEvent.click(screen.getByTestId('catalog2-tab-product'));

    // Editing only the name must still send the category, unit and active flag.
    const name = await screen.findByTestId('catalog2-panel-name');
    fireEvent.change(name, { target: { value: 'Pillow XL' } });
    fireEvent.blur(name);

    await waitFor(() => expect(productCalls).toHaveLength(1));
    expect(productCalls[0].name).toBe('Pillow XL');
    expect(productCalls[0].categoryId).toBe(7);
    expect(productCalls[0].unitId).toBe(1);
    expect(productCalls[0].isActive).toBe(true);

    // A select finishes on change, so change IS the commit.
    const category = await screen.findByTestId('catalog2-panel-category');
    await waitFor(() => expect((category as HTMLSelectElement).value).toBe('7'));
    fireEvent.change(category, { target: { value: '9' } });
    await waitFor(() => expect(productCalls).toHaveLength(2));
    expect(productCalls[1].categoryId).toBe(9);
    expect(productCalls[1].name).toBe('Pillow XL');

    // Clearing it sends an explicit null, not a dropped field — `??` instead
    // of `!== undefined` would make clearing a category impossible.
    fireEvent.change(category, { target: { value: '' } });
    await waitFor(() => expect(productCalls).toHaveLength(3));
    expect(productCalls[2].categoryId).toBeNull();
  });

  // RULING 6: destructive and structural actions never autosave.
  it('requires confirmation before deactivating a variant', async () => {
    let toggleCall: Record<string, unknown> | null = null;
    wireInvoke(makeHandlers({
      list_products_v2: () => [row()],
      get_product_detail: () => detailFixture(),
      set_variant_active: (args) => { toggleCall = args; return null; },
    }));
    render(<App />);
    await loginAndOpenCatalog();

    fireEvent.click(await screen.findByTestId('catalog2-product-menu-1'));
    fireEvent.click(await screen.findByTestId('catalog2-panel-variant-active-10'));
    expect(toggleCall).toBeNull();

    const dialog = await screen.findByRole('dialog', { name: 'Deactivate this variant?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }));

    await waitFor(() => expect(toggleCall).not.toBeNull());
    expect(toggleCall!.variantId).toBe(10);
    expect(toggleCall!.isActive).toBe(false);
  });
});

describe('add variant (WS-D-9B)', () => {
  /**
   * `VariantInput` has no minimum_stock field, so a typed minimum stock has to
   * be applied through updateVariantV2 straight after the variant exists.
   * Dropping it silently is data loss, so this asserts the second call.
   */
  it('creates the variant and applies the typed minimum stock', async () => {
    let addCall: Record<string, unknown> | null = null;
    const variantCalls: Record<string, unknown>[] = [];
    const detail = detailFixture();
    wireInvoke(makeHandlers({
      list_products_v2: () => [row()],
      get_product_detail: () => detail,
      add_variant: (args) => {
        addCall = args;
        detail.variants.push({
          variant_id: 11,
          sku: 'PIL-2',
          name_override: 'Large',
          effective_variant_name: 'Pillow Large',
          primary_barcode: '6130000000024',
          operational_identifier: '6130000000024',
          identifier_type: 'BARCODE',
          sale_price: '1800.00',
          minimum_stock: '3',
          is_active: true,
          attribute_signature: '',
          attributes: [],
          barcodes: [{ id: 5, barcode: '6130000000024', is_primary: true }],
        });
        return 11;
      },
      update_variant_v2: (args) => { variantCalls.push(args); return null; },
    }));
    render(<App />);
    await loginAndOpenCatalog();

    fireEvent.click(await screen.findByTestId('catalog2-product-menu-1'));
    fireEvent.click(await screen.findByTestId('catalog2-add-variant-toggle'));

    fireEvent.change(await screen.findByTestId('catalog2-add-variant-name'), { target: { value: 'Large' } });
    fireEvent.change(screen.getByTestId('catalog2-add-variant-barcode'), { target: { value: '6130000000024' } });
    fireEvent.change(screen.getByTestId('catalog2-add-variant-price'), { target: { value: '1800.00' } });
    fireEvent.change(screen.getByTestId('catalog2-add-variant-minimum-stock'), { target: { value: '3' } });
    fireEvent.click(screen.getByTestId('catalog2-add-variant-submit'));

    await waitFor(() => expect(addCall).not.toBeNull());
    expect(addCall!.productId).toBe(1);
    expect(addCall!.variant).toMatchObject({
      name_override: 'Large',
      sale_price: '1800.00',
      is_active: true,
      barcodes: ['6130000000024'],
    });

    // The minimum stock add_variant could not carry, applied to the new
    // variant — and nothing else invented along the way.
    await waitFor(() => expect(variantCalls).toHaveLength(1));
    expect(variantCalls[0].variantId).toBe(11);
    expect(variantCalls[0].minimumStock).toBe('3');
    expect(typeof variantCalls[0].minimumStock).toBe('string');
    expect(variantCalls[0].salePrice).toBe('1800.00');
    expect(variantCalls[0].nameOverride).toBe('Large');

    // The new variant lands expanded, so attributes and barcodes are one click
    // away rather than requiring a hunt.
    expect(await screen.findByTestId('catalog2-panel-variant-name-11')).toBeInTheDocument();
  });

  it('writes nothing until the add form is submitted', async () => {
    wireInvoke(makeHandlers({
      list_products_v2: () => [row()],
      get_product_detail: () => detailFixture(),
      add_variant: () => 11,
    }));
    render(<App />);
    await loginAndOpenCatalog();

    fireEvent.click(await screen.findByTestId('catalog2-product-menu-1'));
    fireEvent.click(await screen.findByTestId('catalog2-add-variant-toggle'));
    await screen.findByTestId('catalog2-add-variant-price');
    invokeMock.mockClear();

    fireEvent.change(screen.getByTestId('catalog2-add-variant-price'), { target: { value: '1' } });
    fireEvent.change(screen.getByTestId('catalog2-add-variant-price'), { target: { value: '18' } });
    fireEvent.change(screen.getByTestId('catalog2-add-variant-minimum-stock'), { target: { value: '3' } });

    await waitFor(() =>
      expect((screen.getByTestId('catalog2-add-variant-price') as HTMLInputElement).value).toBe('18'));
    expect(invokeMock).not.toHaveBeenCalled();
  });

  /**
   * CR2, applied to the newly created variant. The picker offered for a new
   * variant is the SAME AttributeManagerForVariant, so it runs
   * mergeAssignedValues too. A second picker written for the add path would
   * reintroduce the retired-value defect in a new place; this fails if that
   * ever happens.
   *
   * The fixture returns the new variant already holding a retired value —
   * artificial for a brand-new row, but it is what exercises the merge on the
   * component the add path actually renders.
   */
  it('gives the new variant the shared attribute picker, retired values and all', async () => {
    const detail = detailFixture();
    wireInvoke(makeHandlers({
      list_products_v2: () => [row()],
      get_product_detail: () => detail,
      add_variant: () => {
        detail.variants.push({
          variant_id: 11,
          sku: 'PIL-2',
          name_override: null,
          effective_variant_name: 'Pillow Burgendy',
          primary_barcode: null,
          operational_identifier: 'PIL-2',
          identifier_type: 'SKU',
          sale_price: '1800.00',
          minimum_stock: '0',
          is_active: true,
          attribute_signature: '1:3',
          attributes: [
            { attribute_id: 1, attribute_name: 'Color', attribute_value_id: 3, value: 'Burgendy' },
          ],
          barcodes: [],
        });
        return 11;
      },
      update_variant_v2: () => null,
      // Only active values are offered; 'Burgendy' has been retired.
      list_attributes: () => [
        { attribute_id: 1, name: 'Color', attribute_values: [{ id: 4, value: 'Blue', is_active: true }] },
      ],
    }));
    render(<App />);
    await loginAndOpenCatalog();

    fireEvent.click(await screen.findByTestId('catalog2-product-menu-1'));
    fireEvent.click(await screen.findByTestId('catalog2-add-variant-toggle'));
    fireEvent.change(await screen.findByTestId('catalog2-add-variant-price'), { target: { value: '1800.00' } });
    fireEvent.click(screen.getByTestId('catalog2-add-variant-submit'));

    const retired = await screen.findByRole('radio', { name: /Burgendy/ });
    expect(retired).toBeChecked();
    expect(screen.getByTestId('attr-value-inactive-3')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Blue' })).toBeInTheDocument();
  });
});

describe('create product (WS-D-9B)', () => {
  const createHandlers = (extra: Handlers = {}) => makeHandlers({
    list_products_v2: () => [row()],
    get_product_detail: () => detailFixture({ product_id: 42, name: 'Cushion' }),
    list_categories: () => [{ id: 7, name: 'Bedding', is_active: true, usage_count: 0 }],
    ...extra,
  });

  it('sends the exact strings typed, with a minimum stock of "0" as "0"', async () => {
    let createCall: Record<string, unknown> | null = null;
    wireInvoke(createHandlers({
      quick_create_product: (args) => {
        createCall = args;
        return { product_id: 42, variant_id: 420 };
      },
    }));
    render(<App />);
    await loginAndOpenCatalog();

    fireEvent.click(await screen.findByTestId('catalog2-new-product'));
    fireEvent.change(await screen.findByTestId('catalog2-create-name'), { target: { value: 'Cushion' } });

    const category = await screen.findByTestId('catalog2-create-category');
    await waitFor(() => expect(within(category).getByText('Bedding')).toBeInTheDocument());
    fireEvent.change(category, { target: { value: '7' } });

    fireEvent.change(screen.getByTestId('catalog2-create-variant-price'), { target: { value: '1250.50' } });
    fireEvent.change(screen.getByTestId('catalog2-create-variant-barcode'), { target: { value: '6130000000017' } });

    // "0" is the seeded default and a real value: "never warn me about this
    // item". It must transmit as "0", not be dropped as an empty field.
    expect((screen.getByTestId('catalog2-create-variant-minimum-stock') as HTMLInputElement).value).toBe('0');

    const submit = screen.getByTestId('catalog2-create-submit');
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);

    await waitFor(() => expect(createCall).not.toBeNull());
    expect(createCall!.name).toBe('Cushion');
    expect(createCall!.categoryId).toBe(7);
    expect(createCall!.unitId).toBe(1);
    expect(createCall!.barcode).toBe('6130000000017');
    expect(createCall!.isActive).toBe(true);
    // Exact decimal strings, byte-for-byte as typed.
    expect(createCall!.salePrice).toBe('1250.50');
    expect(createCall!.minimumStock).toBe('0');
    expect(typeof createCall!.minimumStock).toBe('string');
  });

  // The one place on this page where commit-on-blur would be actively wrong:
  // there is no row yet, so autosaving a half-typed name would put a nameless,
  // priceless product into a live catalogue.
  it('writes nothing at all until the submit button is pressed', async () => {
    wireInvoke(createHandlers({
      quick_create_product: () => ({ product_id: 42, variant_id: 420 }),
    }));
    render(<App />);
    await loginAndOpenCatalog();

    fireEvent.click(await screen.findByTestId('catalog2-new-product'));
    const name = await screen.findByTestId('catalog2-create-name');
    // Let the pickers finish loading before measuring.
    await waitFor(() =>
      expect(invokeMock.mock.calls.some((c) => c[0] === 'list_units_v2')).toBe(true));
    invokeMock.mockClear();

    fireEvent.change(name, { target: { value: 'C' } });
    fireEvent.change(name, { target: { value: 'Cushion' } });
    fireEvent.blur(name);
    const price = screen.getByTestId('catalog2-create-variant-price');
    fireEvent.change(price, { target: { value: '1' } });
    fireEvent.change(price, { target: { value: '1250.50' } });
    fireEvent.blur(price);

    await waitFor(() => expect((price as HTMLInputElement).value).toBe('1250.50'));
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('opens the new product in the panel so variants can be added immediately', async () => {
    wireInvoke(createHandlers({
      quick_create_product: () => ({ product_id: 42, variant_id: 420 }),
    }));
    render(<App />);
    await loginAndOpenCatalog();

    fireEvent.click(await screen.findByTestId('catalog2-new-product'));
    fireEvent.change(await screen.findByTestId('catalog2-create-name'), { target: { value: 'Cushion' } });
    fireEvent.change(screen.getByTestId('catalog2-create-variant-price'), { target: { value: '900' } });

    const submit = screen.getByTestId('catalog2-create-submit');
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);

    // Create mode gives way to the edit panel for the product just created.
    await waitFor(() => expect(screen.queryByTestId('catalog2-create-form')).not.toBeInTheDocument());
    expect(await screen.findByTestId('catalog2-add-variant-toggle')).toBeInTheDocument();
  });

  it('refuses to submit until the required values are valid', async () => {
    wireInvoke(createHandlers());
    render(<App />);
    await loginAndOpenCatalog();

    fireEvent.click(await screen.findByTestId('catalog2-new-product'));
    const submit = await screen.findByTestId('catalog2-create-submit');
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByTestId('catalog2-create-name'), { target: { value: 'Cushion' } });
    expect(submit).toBeDisabled();

    // An unparseable price must not unlock the button either.
    fireEvent.change(screen.getByTestId('catalog2-create-variant-price'), { target: { value: 'abc' } });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByTestId('catalog2-create-variant-price'), { target: { value: '900' } });
    await waitFor(() => expect(submit).not.toBeDisabled());
  });
});

describe('discoverability (WS-D-9B)', () => {
  const handlers = (extra: Handlers = {}) => makeHandlers({
    list_products_v2: () => [row()],
    get_product_detail: () => detailFixture(),
    ...extra,
  });

  it('labels the edit affordance rather than hiding it behind a glyph', async () => {
    wireInvoke(handlers());
    render(<App />);
    await loginAndOpenCatalog();

    const productEdit = await screen.findByTestId('catalog2-product-menu-1');
    expect(productEdit.textContent).toBe('Edit');

    fireEvent.click(screen.getByTestId('catalog2-expand-1'));
    expect(screen.getByTestId('catalog2-variant-menu-10').textContent).toBe('Edit');
  });

  it('opens the panel when the row itself is clicked', async () => {
    wireInvoke(handlers());
    render(<App />);
    await loginAndOpenCatalog();

    // The product name cell is not an editable cell, so the row handler runs.
    fireEvent.click((await screen.findByTestId('catalog2-product-1')).querySelectorAll('td')[2]);
    expect(await screen.findByTestId('catalog2-panel')).toBeInTheDocument();
  });

  // Cell edit takes precedence: if the row handler also ran, the panel would
  // slide over the input the user just opened.
  it('edits the cell, and does NOT open the panel, when an editable cell is clicked', async () => {
    wireInvoke(handlers());
    render(<App />);
    await loginAndOpenCatalog();

    fireEvent.click(await screen.findByTestId('catalog2-expand-1'));
    fireEvent.click(await screen.findByTestId('catalog2-price-10-trigger'));

    expect(await screen.findByTestId('catalog2-price-10')).toBeInTheDocument();
    expect(screen.queryByTestId('catalog2-panel')).not.toBeInTheDocument();

    // The same applies to the minimum-stock cell.
    fireEvent.keyDown(screen.getByTestId('catalog2-price-10'), { key: 'Escape' });
    fireEvent.click(screen.getByTestId('catalog2-min-10-trigger'));
    expect(await screen.findByTestId('catalog2-min-10')).toBeInTheDocument();
    expect(screen.queryByTestId('catalog2-panel')).not.toBeInTheDocument();
  });

  it('opens the panel expanded on the variant whose edit control was used', async () => {
    wireInvoke(handlers({
      get_product_detail: () => detailFixture({
        variants: [
          {
            variant_id: 10, sku: 'PIL-1', name_override: null,
            effective_variant_name: 'Pillow Small', primary_barcode: null,
            operational_identifier: 'PIL-1', identifier_type: 'SKU',
            sale_price: '1250.50', minimum_stock: '5.500', is_active: true,
            attribute_signature: '', attributes: [], barcodes: [],
          },
          {
            variant_id: 20, sku: 'PIL-2', name_override: null,
            effective_variant_name: 'Pillow Large', primary_barcode: null,
            operational_identifier: 'PIL-2', identifier_type: 'SKU',
            sale_price: '1800.00', minimum_stock: '2', is_active: true,
            attribute_signature: '', attributes: [], barcodes: [],
          },
        ],
      }),
      list_products_v2: () => [
        row({ variant_id: 10, total_count: 2 }),
        row({ variant_id: 20, sku: 'PIL-2', display_identifier: 'PIL-2', variant_name: 'Pillow Large', total_count: 2 }),
      ],
    }));
    render(<App />);
    await loginAndOpenCatalog();

    fireEvent.click(await screen.findByTestId('catalog2-expand-1'));
    fireEvent.click(await screen.findByTestId('catalog2-variant-menu-20'));

    // The SECOND variant is expanded, not the product's first.
    expect(await screen.findByTestId('catalog2-panel-variant-name-20')).toBeInTheDocument();
    expect(screen.queryByTestId('catalog2-panel-variant-name-10')).not.toBeInTheDocument();
  });
});

describe('number formatting (WS-D-10)', () => {
  const fmtHandlers = (extra: Handlers = {}) => makeHandlers({
    get_product_detail: () => detailFixture(),
    ...extra,
  });

  // The defect: the same Price column rendered 12000, 14000.00 and 2000.00
  // because values were printed as stored.
  it('formats every number in the row, consistently', async () => {
    wireInvoke(fmtHandlers({
      list_products_v2: () => [row({
        sale_price: '14000.00',
        minimum_stock: '5.500',
        quantity_on_hand: '12000',
      })],
    }));
    render(<App />);
    await loginAndOpenCatalog();

    fireEvent.click(await screen.findByTestId('catalog2-expand-1'));

    // "no decimals unless there are some"
    expect((await screen.findByTestId('catalog2-price-10-trigger')).textContent).toBe('14,000');
    expect(screen.getByTestId('catalog2-min-10-trigger').textContent).toBe('5.500');
    const variantRow = screen.getByTestId('catalog2-variant-10');
    expect(within(variantRow).getByText('12,000')).toBeInTheDocument();
  });

  // The stored string is what the operator edits, so they edit exactly what is
  // stored — not a formatted rendering of it that would have to be parsed back.
  it('puts the RAW stored string in the input when the cell is opened', async () => {
    wireInvoke(fmtHandlers({
      list_products_v2: () => [row({ sale_price: '14000.00', minimum_stock: '5.500' })],
    }));
    render(<App />);
    await loginAndOpenCatalog();

    fireEvent.click(await screen.findByTestId('catalog2-expand-1'));

    // Displayed formatted...
    expect((await screen.findByTestId('catalog2-price-10-trigger')).textContent).toBe('14,000');
    fireEvent.click(screen.getByTestId('catalog2-price-10-trigger'));
    // ...edited raw.
    expect((await screen.findByTestId('catalog2-price-10') as HTMLInputElement).value).toBe('14000.00');

    fireEvent.keyDown(screen.getByTestId('catalog2-price-10'), { key: 'Escape' });
    fireEvent.click(screen.getByTestId('catalog2-min-10-trigger'));
    expect((await screen.findByTestId('catalog2-min-10') as HTMLInputElement).value).toBe('5.500');
  });

  // Formatting is display-only. A grouped or trimmed string must never reach
  // the gateway.
  it('sends the raw typed string on commit, never a formatted one', async () => {
    const variantCalls: Record<string, unknown>[] = [];
    wireInvoke(fmtHandlers({
      list_products_v2: () => [row()],
      update_variant_v2: (args) => { variantCalls.push(args); return null; },
    }));
    render(<App />);
    await loginAndOpenCatalog();

    const price = await openPriceEditor();
    fireEvent.change(price, { target: { value: '14000.00' } });
    fireEvent.blur(price);

    await waitFor(() => expect(variantCalls).toHaveLength(1));
    expect(variantCalls[0].salePrice).toBe('14000.00');
    expect(variantCalls[0].salePrice).not.toContain(',');
    // And the cell goes back to showing the formatted form of what was sent.
    expect((await screen.findByTestId('catalog2-price-10-trigger')).textContent).toBe('14,000');
  });

  it('shows a single price, not a range, when the variants agree', async () => {
    wireInvoke(fmtHandlers({
      list_products_v2: () => [
        row({ variant_id: 10, sale_price: '12000', total_count: 2 }),
        // Same price, stored with a redundant fraction: still one price, so
        // still not a range.
        row({ variant_id: 11, sku: 'PIL-2', display_identifier: 'PIL-2', sale_price: '12000.00', total_count: 2 }),
      ],
    }));
    render(<App />);
    await loginAndOpenCatalog();

    const productRow = await screen.findByTestId('catalog2-product-1');
    expect(within(productRow).getByText('12,000')).toBeInTheDocument();
    expect(within(productRow).queryByText(/12,000 – /)).not.toBeInTheDocument();
  });

  it('formats both ends of a real price range', async () => {
    wireInvoke(fmtHandlers({
      list_products_v2: () => [
        row({ variant_id: 10, sale_price: '12000', total_count: 2 }),
        row({ variant_id: 11, sku: 'PIL-2', display_identifier: 'PIL-2', sale_price: '14000.00', total_count: 2 }),
      ],
    }));
    render(<App />);
    await loginAndOpenCatalog();

    const productRow = await screen.findByTestId('catalog2-product-1');
    expect(within(productRow).getByText('12,000 – 14,000')).toBeInTheDocument();
  });

  // Minimum stock of 0 means "never warn". Printing 0 on a product row would
  // assert that setting for a product, which is not a product-level field.
  it('keeps a muted dash in the product row Min column, never a 0', async () => {
    wireInvoke(fmtHandlers({
      list_products_v2: () => [row({ minimum_stock: '0' })],
    }));
    render(<App />);
    await loginAndOpenCatalog();

    const productRow = await screen.findByTestId('catalog2-product-1');
    const cells = productRow.querySelectorAll('td');
    // Columns: name, variants, category, stock, min, price, actions.
    expect(cells[4].textContent).toBe('—');
  });

  it('formats the panel figures the same way as the table', async () => {
    wireInvoke(fmtHandlers({
      list_products_v2: () => [row()],
      get_product_detail: () => detailFixture({
        variants: [{
          variant_id: 10, sku: 'PIL-1', name_override: null,
          effective_variant_name: 'Pillow', primary_barcode: null,
          operational_identifier: 'PIL-1', identifier_type: 'SKU',
          sale_price: '14000.00', minimum_stock: '5.500', is_active: true,
          attribute_signature: '', attributes: [], barcodes: [],
        }],
      }),
    }));
    render(<App />);
    await loginAndOpenCatalog();

    fireEvent.click(await screen.findByTestId('catalog2-product-menu-1'));
    // The panel shows the figures in the list row AND in the editor column, so
    // scope to the editor rather than matching either.
    const editor = await screen.findByTestId('catalog2-variant-editor-10');
    expect(within(editor).getByText('14,000')).toBeInTheDocument();
    expect(within(editor).getByText('5.500')).toBeInTheDocument();
  });
});

describe('layout stability (WS-D-10)', () => {
  it('keeps the action group out of the name flow on a long variant name', async () => {
    const longName = 'Bed - M - Blue - AK Home - Extra Long Marketing Suffix';
    wireInvoke(makeHandlers({
      list_products_v2: () => [row()],
      get_product_detail: () => detailFixture({
        variants: [{
          variant_id: 10, sku: 'PIL-1', name_override: null,
          effective_variant_name: longName, primary_barcode: null,
          operational_identifier: 'PIL-1', identifier_type: 'SKU',
          sale_price: '1250.50', minimum_stock: '5.500', is_active: true,
          attribute_signature: '', attributes: [], barcodes: [],
        }],
      }),
    }));
    render(<App />);
    await loginAndOpenCatalog();

    fireEvent.click(await screen.findByTestId('catalog2-product-menu-1'));
    const toggle = await screen.findByTestId('catalog2-panel-variant-toggle-10');

    // The actions live in their own fixed slot, a sibling of the name area —
    // not inside it, where a long name could push them onto another line.
    const actions = toggle.closest('.sk-catalog2__actions');
    expect(actions).not.toBeNull();
    expect(actions!.parentElement).toHaveClass('sk-catalog2__vrow');
    expect(actions!.querySelector('.sk-catalog2__vrow-name')).toBeNull();

    // The full name stays reachable even though the label truncates. It is
    // rendered in the list row and again in the editor head, so scope to the
    // list.
    const list = screen.getByTestId('catalog2-variant-list');
    const name = within(list).getByTitle(longName);
    expect(name).toHaveClass('sk-catalog2__truncate');
  });
});

describe('two-column variant editing (WS-D-11)', () => {
  function twoVariantDetail() {
    return detailFixture({
      variants: [
        {
          variant_id: 10, sku: 'PIL-1', name_override: null,
          effective_variant_name: 'Pillow Small', primary_barcode: null,
          operational_identifier: 'PIL-1', identifier_type: 'SKU',
          sale_price: '1250.50', minimum_stock: '5.500', is_active: true,
          attribute_signature: '', attributes: [], barcodes: [],
        },
        {
          variant_id: 20, sku: 'PIL-2', name_override: null,
          effective_variant_name: 'Pillow Large', primary_barcode: null,
          operational_identifier: 'PIL-2', identifier_type: 'SKU',
          sale_price: '1800.00', minimum_stock: '2', is_active: true,
          attribute_signature: '', attributes: [], barcodes: [
            { id: 5, barcode: '6130000000024', is_primary: true },
            { id: 6, barcode: '6130000000031', is_primary: false },
          ],
        },
      ],
    });
  }

  const handlers = (extra: Handlers = {}) => makeHandlers({
    list_products_v2: () => [row()],
    get_product_detail: () => twoVariantDetail(),
    ...extra,
  });

  // R4 / R6: one detail column, exactly one variant open. The accordion that
  // stacked several expanded variants inside 560px is gone.
  it('shows the selected variant in the detail column, and only that one', async () => {
    wireInvoke(handlers());
    render(<App />);
    await loginAndOpenCatalog();

    fireEvent.click(await screen.findByTestId('catalog2-product-menu-1'));

    // Opening lands on a variant rather than an empty column.
    expect(await screen.findByTestId('catalog2-variant-editor-10')).toBeInTheDocument();
    expect(screen.queryByTestId('catalog2-variant-editor-20')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('catalog2-panel-variant-toggle-20'));

    // Selecting another REPLACES it. Never two at once.
    expect(await screen.findByTestId('catalog2-variant-editor-20')).toBeInTheDocument();
    expect(screen.queryByTestId('catalog2-variant-editor-10')).not.toBeInTheDocument();

    // Both remain listed the whole time.
    const list = screen.getByTestId('catalog2-variant-list');
    expect(within(list).getByTestId('catalog2-panel-variant-toggle-10')).toBeInTheDocument();
    expect(within(list).getByTestId('catalog2-panel-variant-toggle-20')).toBeInTheDocument();
  });

  // R12
  it('keeps barcodes collapsed behind a count until asked', async () => {
    wireInvoke(handlers());
    render(<App />);
    await loginAndOpenCatalog();

    fireEvent.click(await screen.findByTestId('catalog2-product-menu-1'));
    fireEvent.click(await screen.findByTestId('catalog2-panel-variant-toggle-20'));

    const editor = await screen.findByTestId('catalog2-variant-editor-20');
    expect(within(editor).getByText('Barcodes (2)')).toBeInTheDocument();
    // Closed by default.
    expect(screen.queryByTestId('catalog2-barcode-input-20')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('catalog2-barcodes-toggle-20'));
    expect(await screen.findByTestId('catalog2-barcode-input-20')).toBeInTheDocument();
  });

  // R13 — identity, not an input.
  it('shows the SKU as read-only text, never as a field', async () => {
    wireInvoke(handlers());
    render(<App />);
    await loginAndOpenCatalog();

    fireEvent.click(await screen.findByTestId('catalog2-product-menu-1'));
    const sku = await screen.findByTestId('catalog2-sku-10');
    expect(sku.tagName).toBe('BUTTON');
    expect(sku.textContent).toContain('PIL-1');
    expect(sku.querySelector('input')).toBeNull();
  });
});

describe('attribute selection (WS-D-11)', () => {
  function detailWithAttributes() {
    return detailFixture({
      variants: [{
        variant_id: 10, sku: 'PIL-1', name_override: null,
        effective_variant_name: 'Pillow Red', primary_barcode: null,
        operational_identifier: 'PIL-1', identifier_type: 'SKU',
        sale_price: '1250.50', minimum_stock: '5.500', is_active: true,
        attribute_signature: '1:4',
        attributes: [
          { attribute_id: 1, attribute_name: 'Color', attribute_value_id: 4, value: 'Red' },
        ],
        barcodes: [],
      }],
    });
  }

  const handlers = (extra: Handlers = {}) => makeHandlers({
    list_products_v2: () => [row()],
    get_product_detail: () => detailWithAttributes(),
    list_attributes: () => [
      {
        attribute_id: 1,
        name: 'Color',
        attribute_values: [
          { id: 4, value: 'Red', is_active: true },
          { id: 5, value: 'Blue', is_active: true },
        ],
      },
      { attribute_id: 2, name: 'Size', attribute_values: [{ id: 7, value: 'M', is_active: true }] },
    ],
    ...extra,
  });

  // R7 — creating attribute TYPES belongs to Catalogue Setup, not the variant
  // editor. Adding a VALUE stays, because that is part of entering a product.
  it('offers no create-attribute form, but does offer an inline add-value', async () => {
    wireInvoke(handlers());
    render(<App />);
    await loginAndOpenCatalog();

    fireEvent.click(await screen.findByTestId('catalog2-product-menu-1'));
    await screen.findByTestId('catalog2-variant-editor-10');

    expect(screen.queryByLabelText('Attribute name')).not.toBeInTheDocument();
    expect(screen.getByText('Attribute types are created and managed in Catalogue setup.'))
      .toBeInTheDocument();
    expect(screen.getByTestId('attr-add-value-1')).toBeInTheDocument();
  });

  // R8 / R9
  it('lists every attribute and summarises the chosen combination', async () => {
    wireInvoke(handlers());
    render(<App />);
    await loginAndOpenCatalog();

    fireEvent.click(await screen.findByTestId('catalog2-product-menu-1'));
    await screen.findByTestId('catalog2-variant-editor-10');

    // "Size" has nothing selected and must still be visible.
    expect(screen.getByText('Size')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'M' })).toBeInTheDocument();

    // Built from the selection in attribute order, never from
    // attribute_signature.
    expect(screen.getByTestId('attr-summary').textContent).toContain('Red');

    fireEvent.click(screen.getByRole('radio', { name: 'M' }));
    await waitFor(() =>
      expect(screen.getByTestId('attr-summary').textContent).toContain('Red · M'));
  });

  // R10 — a variant may legitimately hold no value for an attribute.
  it('clears an attribute to None and saves without that value', async () => {
    let setAttrsCall: Record<string, unknown> | null = null;
    wireInvoke(handlers({
      set_variant_attributes: (args) => { setAttrsCall = args; return null; },
    }));
    render(<App />);
    await loginAndOpenCatalog();

    fireEvent.click(await screen.findByTestId('catalog2-product-menu-1'));
    await screen.findByTestId('catalog2-variant-editor-10');

    expect(screen.getByRole('radio', { name: 'Red' })).toBeChecked();
    fireEvent.click(screen.getByTestId('attr-none-1'));
    expect(screen.getByTestId('attr-none-1')).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Assign attributes' }));
    await waitFor(() => expect(setAttrsCall).not.toBeNull());
    expect(setAttrsCall!.variantId).toBe(10);
    expect(setAttrsCall!.attributeValueIds).not.toContain(4);
    expect(setAttrsCall!.attributeValueIds).toEqual([]);
  });

  /**
   * R14 — a variant's identity IS its attribute combination, and the database
   * rejects a duplicate. The UI must not be left showing a selection the
   * database refused.
   */
  it('reverts the chip and surfaces the message when the combination is a duplicate', async () => {
    wireInvoke(handlers({
      set_variant_attributes: () => { throw { code: 'VALIDATION_ERROR' }; },
    }));
    render(<App />);
    await loginAndOpenCatalog();

    fireEvent.click(await screen.findByTestId('catalog2-product-menu-1'));
    await screen.findByTestId('catalog2-variant-editor-10');

    fireEvent.click(screen.getByRole('radio', { name: 'Blue' }));
    expect(screen.getByRole('radio', { name: 'Blue' })).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Assign attributes' }));

    // The message is shown...
    expect(await screen.findByText('Some of the entered values are invalid.')).toBeInTheDocument();
    // ...and the chip goes back to what the database actually holds.
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Red' })).toBeChecked());
    expect(screen.getByRole('radio', { name: 'Blue' })).not.toBeChecked();
  });
});

describe('panel size persistence (WS-D-11)', () => {
  const handlers = () => makeHandlers({
    list_products_v2: () => [row()],
    get_product_detail: () => detailFixture(),
  });

  it('remembers a resized width across a remount, and clamps a corrupt one', async () => {
    window.localStorage.clear();
    wireInvoke(handlers());

    const first = render(<App />);
    await loginAndOpenCatalog();
    fireEvent.click(await screen.findByTestId('catalog2-product-menu-1'));

    // Keyboard resize: the handle is a real focusable separator, not a
    // mouse-only affordance. ArrowLeft moves the inline-start edge outward in
    // LTR, which widens the panel.
    const handle = await screen.findByTestId('catalog2-panel-resize');
    fireEvent.keyDown(handle, { key: 'Home' });
    await waitFor(() =>
      expect(screen.getByTestId('catalog2-panel')).toHaveAttribute('data-panel-width', '1100'));
    expect(window.localStorage.getItem('stockiha.catalog2.panelWidth')).toBe('1100');

    first.unmount();
    cleanup();

    // Remount: the width comes back.
    render(<App />);
    await loginAndOpenCatalog();
    fireEvent.click(await screen.findByTestId('catalog2-product-menu-1'));
    expect(await screen.findByTestId('catalog2-panel')).toHaveAttribute('data-panel-width', '1100');
  });

  it('clamps a stored width that is out of range, and ignores a corrupt one', async () => {
    wireInvoke(handlers());

    // Far wider than any supported panel — e.g. carried over from another
    // monitor. It must clamp, not produce a panel that cannot be resized back.
    window.localStorage.setItem('stockiha.catalog2.panelWidth', '99999');
    const wide = render(<App />);
    await loginAndOpenCatalog();
    fireEvent.click(await screen.findByTestId('catalog2-product-menu-1'));
    expect(await screen.findByTestId('catalog2-panel')).toHaveAttribute('data-panel-width', '1100');
    wide.unmount();
    cleanup();

    window.localStorage.setItem('stockiha.catalog2.panelWidth', '10');
    const narrow = render(<App />);
    await loginAndOpenCatalog();
    fireEvent.click(await screen.findByTestId('catalog2-product-menu-1'));
    expect(await screen.findByTestId('catalog2-panel')).toHaveAttribute('data-panel-width', '560');
    narrow.unmount();
    cleanup();

    // Not a number at all: fall back to the proportional default from CSS.
    window.localStorage.setItem('stockiha.catalog2.panelWidth', 'not-a-width');
    render(<App />);
    await loginAndOpenCatalog();
    fireEvent.click(await screen.findByTestId('catalog2-product-menu-1'));
    expect(await screen.findByTestId('catalog2-panel')).toHaveAttribute('data-panel-width', '');
    window.localStorage.clear();
  });

  it('toggles full screen and remembers the mode', async () => {
    window.localStorage.clear();
    wireInvoke(handlers());
    render(<App />);
    await loginAndOpenCatalog();
    fireEvent.click(await screen.findByTestId('catalog2-product-menu-1'));

    fireEvent.click(await screen.findByTestId('catalog2-panel-fullscreen'));
    await waitFor(() =>
      expect(screen.getByTestId('catalog2-panel')).toHaveAttribute('data-panel-fullscreen', 'true'));
    expect(window.localStorage.getItem('stockiha.catalog2.panelFullScreen')).toBe('true');
    // The drag handle is meaningless at full screen and is withdrawn.
    expect(screen.queryByTestId('catalog2-panel-resize')).not.toBeInTheDocument();
    window.localStorage.clear();
  });
});

describe('create panel discard guard (WS-D-11 R15)', () => {
  it('confirms before throwing away a half-typed new product', async () => {
    wireInvoke(makeHandlers({
      list_products_v2: () => [row()],
      get_product_detail: () => detailFixture(),
    }));
    render(<App />);
    await loginAndOpenCatalog();

    fireEvent.click(await screen.findByTestId('catalog2-new-product'));
    fireEvent.change(await screen.findByTestId('catalog2-create-name'), { target: { value: 'Cushion' } });

    fireEvent.click(screen.getByTestId('catalog2-panel-close'));

    const dialog = await screen.findByRole('dialog', { name: 'Discard this new product?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));

    // Still there, still typed.
    expect((screen.getByTestId('catalog2-create-name') as HTMLInputElement).value).toBe('Cushion');

    fireEvent.click(screen.getByTestId('catalog2-panel-close'));
    const again = await screen.findByRole('dialog', { name: 'Discard this new product?' });
    fireEvent.click(within(again).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(screen.queryByTestId('catalog2-create-form')).not.toBeInTheDocument());
  });

  it('closes without a prompt when nothing has been typed', async () => {
    wireInvoke(makeHandlers({ list_products_v2: () => [row()] }));
    render(<App />);
    await loginAndOpenCatalog();

    fireEvent.click(await screen.findByTestId('catalog2-new-product'));
    await screen.findByTestId('catalog2-create-form');
    fireEvent.click(screen.getByTestId('catalog2-panel-close'));

    await waitFor(() => expect(screen.queryByTestId('catalog2-create-form')).not.toBeInTheDocument());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('the existing Products page is untouched', () => {
  it('still appears in the navigation alongside the new Catalog page', async () => {
    wireInvoke(makeHandlers());
    render(<App />);
    await screen.findByRole('heading', { name: 'Sign in' });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('button', { name: 'Products' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Catalog (new)' })).toBeInTheDocument();
  });
});
