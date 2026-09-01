/**
 * Slice 2 — catalog workflow integration tests.
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

const loginOk = () => ({ session_token: 'tok', expires_at: '2026-12-31T23:59:59Z' });

function makeHandlers(extra: Handlers = {}): Handlers {
  return {
    get_setup_status: initialized,
    login: loginOk,
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
    list_catalog_products: () => [],
    list_products_v2: () => [],
    list_categories: () => [],
    list_brands: () => [],
    list_attributes: () => [],
    list_units: () => [{ id: 1, code: 'PCS', name: 'Pieces' }],
    ...extra,
  };
}

/** WS-D-4: a single catalog.list_products_v2 row, ProductListItemV2 shape. */
function productListRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    product_id: 1,
    variant_id: 10,
    sku: 'TSH-S',
    product_name: 'T-Shirt',
    variant_name: 'T-Shirt',
    primary_barcode: null,
    display_identifier: 'TSH-S',
    identifier_type: 'SKU',
    sale_price: '10.00',
    minimum_stock: '0',
    is_active: true,
    product_is_active: true,
    category_id: null,
    category_name: null,
    brand_id: null,
    brand_name: null,
    quantity_on_hand: '0',
    last_known_wac: '0',
    attributes: [],
    total_count: 1,
    ...overrides,
  };
}

async function loginAndNavigate() {
  await screen.findByRole('heading', { name: 'Sign in' });
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  // navigate to products (catalog)
  const productsNav = await screen.findByRole('button', { name: 'Products' });
  fireEvent.click(productsNav);
}

beforeEach(() => {
  invokeMock.mockReset();
  cleanup();
  document.documentElement.setAttribute('dir', 'ltr');
});

describe('catalog product list (WS-D-4, variant-level on list_products_v2)', () => {
  it('shows empty state when no variants match', async () => {
    wireInvoke(makeHandlers());
    render(<App />);
    await loginAndNavigate();
    expect(await screen.findByText('No variants match these filters.')).toBeInTheDocument();
  });

  it('lists one row per variant, not one row per product', async () => {
    wireInvoke(makeHandlers({
      list_products_v2: () => [
        productListRow({
          variant_id: 10, sku: 'TSH-S', variant_name: 'T-Shirt / S', display_identifier: 'TSH-S',
          identifier_type: 'SKU', total_count: 2,
        }),
        productListRow({
          variant_id: 11, sku: 'TSH-M', variant_name: 'T-Shirt / M', display_identifier: '6130000000017',
          identifier_type: 'BARCODE', primary_barcode: '6130000000017', total_count: 2,
        }),
      ],
    }));
    render(<App />);
    await loginAndNavigate();

    expect(await screen.findByTestId('product-row-10')).toBeInTheDocument();
    expect(screen.getByTestId('product-row-11')).toBeInTheDocument();
    expect(screen.getByText('T-Shirt / S')).toBeInTheDocument();
    expect(screen.getByText('T-Shirt / M')).toBeInTheDocument();
    expect(screen.getByText('TSH-S')).toBeInTheDocument();
    expect(screen.getByText('6130000000017')).toBeInTheDocument();
    expect(screen.getByText('Showing 1–2 of 2')).toBeInTheDocument();
  });
});

describe('create product with multiple variants', () => {
  it('creates product with two variants and reports success', async () => {
    let createCall: Record<string, unknown> | null = null;
    wireInvoke(makeHandlers({
      create_product_with_variants: (args) => {
        createCall = args;
        return { product_id: 10, variant_ids: [101, 102] };
      },
    }));
    render(<App />);
    await loginAndNavigate();

    // Click new product button
    const newBtn = await screen.findByTestId('new-product-btn');
    fireEvent.click(newBtn);

    // Fill product name
    fireEvent.change(screen.getByLabelText('Product name'), { target: { value: 'T-Shirt' } });

    // Fill first variant sale price (SKU is generated automatically)
    const priceFields = screen.getAllByLabelText(/Sale price/i);
    fireEvent.change(priceFields[0], { target: { value: '10.00' } });

    // Add a second variant
    fireEvent.click(screen.getByRole('button', { name: '+ Add variant' }));

    // Fill second variant
    const priceFields2 = screen.getAllByLabelText(/Sale price/i);
    expect(priceFields2.length).toBe(2);
    fireEvent.change(priceFields2[1], { target: { value: '12.00' } });

    // Wait for unit auto-selection effect to enable submit button
    const submitBtn = screen.getByTestId('submit-create-product');
    await waitFor(() => expect(submitBtn).not.toBeDisabled());

    // Submit
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(createCall).not.toBeNull();
    });

    // Verify argument shapes
    expect(createCall!.name).toBe('T-Shirt');
    expect(createCall!.unitId).toBe(1);
    const variants = createCall!.variants as Array<Record<string, unknown>>;
    expect(variants).toHaveLength(2);
    expect(variants[0].sale_price).toBe('10.00');
    expect(typeof variants[0].sale_price).toBe('string');
    expect(variants[1].sale_price).toBe('12.00');
  });

  it('successfully adds a new test product from client perspective', async () => {
    let createdProductData: Record<string, unknown> | null = null;
    wireInvoke(makeHandlers({
      create_product_with_variants: (args) => {
        createdProductData = args;
        return { product_id: 99, variant_ids: [991] };
      },
    }));
    render(<App />);
    await loginAndNavigate();

    const newBtn = await screen.findByTestId('new-product-btn');
    fireEvent.click(newBtn);

    fireEvent.change(screen.getByLabelText('Product name'), { target: { value: 'Client Test Product' } });
    const priceFields = screen.getAllByLabelText(/Sale price/i);
    fireEvent.change(priceFields[0], { target: { value: '150.00' } });

    const submitBtn = screen.getByTestId('submit-create-product');
    await waitFor(() => expect(submitBtn).not.toBeDisabled());

    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(createdProductData).not.toBeNull();
    });

    expect(createdProductData!.name).toBe('Client Test Product');
    const vars = createdProductData!.variants as Array<Record<string, unknown>>;
    expect(vars[0].sale_price).toBe('150.00');
  });
});

describe('backend validation error display', () => {
  it('shows localized validation error message from backend on product creation', async () => {
    wireInvoke(makeHandlers({
      create_product_with_variants: () => { throw { code: 'VALIDATION_ERROR' }; },
    }));
    render(<App />);
    await loginAndNavigate();

    const newBtn = await screen.findByTestId('new-product-btn');
    fireEvent.click(newBtn);

    fireEvent.change(screen.getByLabelText('Product name'), { target: { value: 'Bad' } });
    const priceField = screen.getByLabelText(/Sale price/i);
    fireEvent.change(priceField, { target: { value: '1.00' } });

    const submitBtn = screen.getByTestId('submit-create-product');
    await waitFor(() => expect(submitBtn).not.toBeDisabled());

    fireEvent.click(submitBtn);

    const errorBanner = await screen.findByTestId('create-error');
    expect(errorBanner.textContent).toBe('Some of the entered values are invalid.');
    // backend message must not leak
    expect(errorBanner.textContent).not.toContain('VALIDATION_ERROR_RAW');
  });
});

describe('variant attribute configuration', () => {
  it('calls setVariantAttributes with the selected attribute value ids', async () => {
    let setAttrsCall: Record<string, unknown> | null = null;
    const detail = {
      product_id: 1, name: 'T-Shirt', is_active: true, unit_id: 1,
      variants: [{
        variant_id: 10, operational_identifier: 'TSH-S', identifier_type: 'SKU', sale_price: '10.00', is_active: true,
        effective_variant_name: 'T-Shirt', name_override: null, primary_barcode: null,
        base_unit_id: 1, base_unit_code: 'PC', attribute_signature: '',
        attributes: [], alternate_units: [], barcodes: [],
      }],
    };
    wireInvoke(makeHandlers({
      list_products_v2: () => [productListRow()],
      get_product_detail: () => detail,
      list_attributes: () => [
        { attribute_id: 1, name: 'Size', attribute_values: [{ id: 3, value: 'S' }, { id: 4, value: 'M' }] },
      ],
      list_units: () => [{ id: 1, code: 'PCS', name: 'Pieces' }],
      set_variant_attributes: (args) => {
        setAttrsCall = args;
        return null;
      },
    }));
    render(<App />);
    await loginAndNavigate();

    // Open edit view
    const editBtn = await screen.findByTestId('edit-product-1');
    fireEvent.click(editBtn);

    // Wait for detail to load and variant to appear
    await screen.findByTestId('variant-row-10');

    // Click edit variant to open modal
    fireEvent.click(screen.getByTestId('edit-variant-10'));

    // Select attribute value
    const sRadio = await screen.findByRole('radio', { name: 'S' });
    fireEvent.click(sRadio);

    // Click Assign attributes button
    fireEvent.click(screen.getByRole('button', { name: 'Assign attributes' }));

    await waitFor(() => expect(setAttrsCall).not.toBeNull());
    expect(setAttrsCall!.variantId).toBe(10);
    expect(setAttrsCall!.attributeValueIds).toContain(3);
  });
});

describe('add SKU and barcode', () => {
  it('keeps the add-variant draft separate from the selected variant editor', async () => {
    let addCall: Record<string, unknown> | null = null;
    const detail = {
      product_id: 1, name: 'Widget', is_active: true, unit_id: 1,
      variants: [{
        variant_id: 10, operational_identifier: 'WID-1', identifier_type: 'SKU', sale_price: '5.00', is_active: true,
        effective_variant_name: 'Widget', name_override: null, primary_barcode: null,
        base_unit_id: 1, base_unit_code: 'PC', attribute_signature: '',
        attributes: [], alternate_units: [], barcodes: [],
      }],
    };
    wireInvoke(makeHandlers({
      list_products_v2: () => [productListRow({ product_name: 'Widget', variant_name: 'Widget', sku: 'WID-1', display_identifier: 'WID-1' })],
      get_product_detail: () => detail,
      list_attributes: () => [],
      list_units: () => [{ id: 1, code: 'PCS', name: 'Pieces' }],
      add_variant: (args) => {
        addCall = args;
        detail.variants.push({
          variant_id: 11, operational_identifier: 'WID-2', identifier_type: 'SKU', sale_price: '7.00', is_active: true,
          effective_variant_name: 'Widget V2', name_override: null, primary_barcode: null,
          base_unit_id: 1, base_unit_code: 'PC', attribute_signature: '',
          attributes: [], alternate_units: [], barcodes: [],
        });
        return 11;
      },
    }));
    render(<App />);
    await loginAndNavigate();
    fireEvent.click(await screen.findByTestId('edit-product-1'));
    await screen.findByTestId('variant-row-10');

    // Click + Add variant button to open Add Variant Modal
    fireEvent.click(screen.getByRole('button', { name: '+ Add variant' }));
    const addModal = await screen.findByRole('dialog', { name: 'Add variant' });

    const priceInput = within(addModal).getByLabelText(/Sale price/i);
    fireEvent.change(priceInput, { target: { value: '7.00' } });

    fireEvent.click(within(addModal).getByRole('button', { name: 'Add variant' }));
    await waitFor(() => expect(addCall).not.toBeNull());
    expect(addCall!.productId).toBe(1);
    expect(addCall!.variant).toMatchObject({ sale_price: '7.00' });
  });

  it('calls addVariantBarcode with the barcode string', async () => {
    let barcodeCall: Record<string, unknown> | null = null;
    const detail = {
      product_id: 1, name: 'Widget', is_active: true, unit_id: 1,
      variants: [{
        variant_id: 10, operational_identifier: 'WID-1', identifier_type: 'SKU', sale_price: '5.00', is_active: true,
        effective_variant_name: 'Widget', name_override: null, primary_barcode: null,
        base_unit_id: 1, base_unit_code: 'PC', attribute_signature: '',
        attributes: [], alternate_units: [], barcodes: [],
      }],
    };
    wireInvoke(makeHandlers({
      list_products_v2: () => [productListRow({ product_name: 'Widget', variant_name: 'Widget', sku: 'WID-1', display_identifier: 'WID-1' })],
      get_product_detail: () => detail,
      list_attributes: () => [],
      list_units: () => [{ id: 1, code: 'PCS', name: 'Pieces' }],
      add_variant_barcode: (args) => {
        barcodeCall = args;
        return 99;
      },
    }));
    render(<App />);
    await loginAndNavigate();

    const editBtn = await screen.findByTestId('edit-product-1');
    fireEvent.click(editBtn);
    await screen.findByTestId('variant-row-10');
    fireEvent.click(screen.getByTestId('edit-variant-10'));

    // Find barcode form inside modal and fill input
    const barcodeForm = await screen.findByTestId('barcode-form');
    const barcodeInput = within(barcodeForm).getByLabelText('Barcode');
    fireEvent.change(barcodeInput, { target: { value: '6001234567890' } });
    fireEvent.click(within(barcodeForm).getByTestId('add-barcode-btn'));

    await waitFor(() => expect(barcodeCall).not.toBeNull());
    expect(barcodeCall!.variantId).toBe(10);
    expect(barcodeCall!.barcode).toBe('6001234567890');
  });
});

describe('deactivate a variant', () => {
  it('calls setVariantActive with false when deactivate is clicked', async () => {
    let toggleCall: Record<string, unknown> | null = null;
    const detail = {
      product_id: 1, name: 'Widget', is_active: true, unit_id: 1,
      variants: [{
        variant_id: 10, operational_identifier: 'WID-1', identifier_type: 'SKU', sale_price: '5.00', is_active: true,
        effective_variant_name: 'Widget', name_override: null, primary_barcode: null,
        base_unit_id: 1, base_unit_code: 'PC', attribute_signature: '',
        attributes: [], alternate_units: [], barcodes: [],
      }],
    };
    wireInvoke(makeHandlers({
      list_products_v2: () => [productListRow({ product_name: 'Widget', variant_name: 'Widget', sku: 'WID-1', display_identifier: 'WID-1' })],
      get_product_detail: () => detail,
      list_attributes: () => [],
      list_units: () => [{ id: 1, code: 'PCS', name: 'Pieces' }],
      set_variant_active: (args) => {
        toggleCall = args;
        return null;
      },
    }));
    render(<App />);
    await loginAndNavigate();

    const editBtn = await screen.findByTestId('edit-product-1');
    fireEvent.click(editBtn);
    await screen.findByTestId('variant-row-10');

    fireEvent.click(screen.getByTestId('toggle-variant-10'));

    await waitFor(() => expect(toggleCall).not.toBeNull());
    expect(toggleCall!.variantId).toBe(10);
    expect(toggleCall!.isActive).toBe(false);
  });
});

describe('locale / RTL rendering', () => {
  it('sets dir=rtl and renders Arabic text when locale is switched in the app shell', async () => {
    wireInvoke(makeHandlers());
    render(<App />);

    // Login first to get to authenticated area where locale switcher lives
    await screen.findByRole('heading', { name: 'Sign in' });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    // Wait for authenticated area (AppShell has locale buttons)
    await screen.findByRole('button', { name: 'ع' });

    // Switch to Arabic
    fireEvent.click(screen.getByRole('button', { name: 'ع' }));

    // dir should be rtl
    await waitFor(() => {
      expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    });

    // Arabic nav items should appear
    expect(screen.getByRole('button', { name: 'المنتجات' })).toBeInTheDocument();
  });

  it('renders catalog empty state in Arabic after switching locale in the shell', async () => {
    wireInvoke(makeHandlers());
    render(<App />);

    // Login
    await screen.findByRole('heading', { name: 'Sign in' });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    // Wait for shell, then switch to Arabic
    const arBtn = await screen.findByRole('button', { name: 'ع' });
    fireEvent.click(arBtn);

    await waitFor(() => {
      expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    });

    // Navigate to products (in Arabic)
    const productsNav = screen.getByRole('button', { name: 'المنتجات' });
    fireEvent.click(productsNav);

    // Arabic empty state for catalog (WS-D-4: variant-level list_products_v2 empty state)
    expect(await screen.findByText('لا توجد أصناف مطابقة لهذه المرشحات.')).toBeInTheDocument();
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
  });
});
