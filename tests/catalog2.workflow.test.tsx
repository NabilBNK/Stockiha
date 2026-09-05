/**
 * WS-D-9 — the new Catalog page, built fresh alongside the existing Products
 * page. These tests cover the four bindings that are easy to get quietly
 * wrong: commit-on-blur (never on keystroke), revert-on-failure, the
 * update_variant overwrite trap, and the CR2 retired-attribute-value wiring.
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

/** catalog.get_product_detail — carries name_override and minimum_stock. */
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
    }],
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

    const trigger = await screen.findByTestId('catalog2-price-10-trigger');
    expect(trigger.textContent).toBe('1250.50');
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
    expect(trigger.textContent).toBe('1250.50');
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
