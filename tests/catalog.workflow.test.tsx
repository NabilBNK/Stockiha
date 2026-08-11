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
    list_attributes: () => [],
    list_units: () => [],
    ...extra,
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

describe('catalog product list', () => {
  it('shows empty state when no products', async () => {
    wireInvoke(makeHandlers());
    render(<App />);
    await loginAndNavigate();
    expect(await screen.findByText('No products yet. Create one to get started.')).toBeInTheDocument();
  });

  it('displays catalog products with variant counts', async () => {
    wireInvoke(makeHandlers({
      list_catalog_products: () => [
        { product_id: 1, name: 'T-Shirt', is_active: true, variant_count: 3, active_variant_count: 2 },
      ],
    }));
    render(<App />);
    await loginAndNavigate();
    expect(await screen.findByText('T-Shirt')).toBeInTheDocument();
    expect(screen.getByText('2/3 active')).toBeInTheDocument();
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

    // Fill first variant
    const skuFields = screen.getAllByLabelText('SKU');
    const priceFields = screen.getAllByLabelText('Sale price');
    fireEvent.change(skuFields[0], { target: { value: 'TSH-S' } });
    fireEvent.change(priceFields[0], { target: { value: '10.00' } });

    // Add a second variant
    fireEvent.click(screen.getByRole('button', { name: 'Add variant' }));

    // Fill second variant (new fields appear)
    const skuFields2 = screen.getAllByLabelText('SKU');
    const priceFields2 = screen.getAllByLabelText('Sale price');
    expect(skuFields2.length).toBe(2);
    fireEvent.change(skuFields2[1], { target: { value: 'TSH-M' } });
    fireEvent.change(priceFields2[1], { target: { value: '12.00' } });

    // Submit
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(createCall).not.toBeNull();
    });

    // Verify argument shapes
    expect(createCall!.name).toBe('T-Shirt');
    const variants = createCall!.variants as Array<Record<string, unknown>>;
    expect(variants).toHaveLength(2);
    expect(variants[0].sku).toBe('TSH-S');
    expect(variants[0].sale_price).toBe('10.00');
    expect(typeof variants[0].sale_price).toBe('string');
    expect(variants[1].sku).toBe('TSH-M');
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
    const skuFields = screen.getAllByLabelText('SKU');
    const priceFields = screen.getAllByLabelText('Sale price');
    fireEvent.change(skuFields[0], { target: { value: 'TEST-CLIENT-01' } });
    fireEvent.change(priceFields[0], { target: { value: '150.00' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(createdProductData).not.toBeNull();
    });

    expect(createdProductData!.name).toBe('Client Test Product');
    const vars = createdProductData!.variants as Array<Record<string, unknown>>;
    expect(vars[0].sku).toBe('TEST-CLIENT-01');
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
    const skuField = screen.getByLabelText('SKU');
    const priceField = screen.getByLabelText('Sale price');
    fireEvent.change(skuField, { target: { value: 'X' } });
    fireEvent.change(priceField, { target: { value: '1.00' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

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
      product_id: 1, name: 'T-Shirt', is_active: true,
      variants: [{
        variant_id: 10, sku: 'TSH-S', sale_price: '10.00', is_active: true,
        base_unit_id: 1, base_unit_code: 'PC', attribute_signature: '',
        attributes: [], alternate_units: [], barcodes: [],
      }],
    };
    wireInvoke(makeHandlers({
      list_catalog_products: () => [
        { product_id: 1, name: 'T-Shirt', is_active: true, variant_count: 1, active_variant_count: 1 },
      ],
      get_product_detail: () => detail,
      list_attributes: () => [
        { attribute_id: 1, name: 'Size', attribute_values: [{ id: 3, value: 'S' }, { id: 4, value: 'M' }] },
      ],
      list_units: () => [],
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
      product_id: 1, name: 'Widget', is_active: true,
      variants: [{
        variant_id: 10, sku: 'WID-1', sale_price: '5.00', is_active: true,
        base_unit_id: 1, base_unit_code: 'PC', attribute_signature: '',
        attributes: [], alternate_units: [], barcodes: [],
      }],
    };
    wireInvoke(makeHandlers({
      list_catalog_products: () => [
        { product_id: 1, name: 'Widget', is_active: true, variant_count: 1, active_variant_count: 1 },
      ],
      get_product_detail: () => detail,
      list_attributes: () => [],
      list_units: () => [],
      add_variant: (args) => {
        addCall = args;
        detail.variants.push({
          variant_id: 11, sku: 'WID-2', sale_price: '7.00', is_active: true,
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

    const addForm = screen.getByRole('form', { name: 'Add variant' });
    const editForm = await screen.findByRole('form', { name: 'Variants WID-1' });
    fireEvent.change(within(addForm).getByLabelText('SKU'), { target: { value: 'WID-2' } });
    fireEvent.change(within(addForm).getByLabelText('Sale price'), { target: { value: '7.00' } });

    expect(within(editForm).getByLabelText('SKU')).toHaveValue('WID-1');
    expect(within(editForm).getByLabelText('Sale price')).toHaveValue('5.00');

    fireEvent.click(within(addForm).getByRole('button', { name: 'Add variant' }));
    await waitFor(() => expect(addCall).not.toBeNull());
    expect(addCall!.productId).toBe(1);
    expect(addCall!.variant).toMatchObject({ sku: 'WID-2', sale_price: '7.00' });
  });

  it('calls addVariantBarcode with the barcode string', async () => {
    let barcodeCall: Record<string, unknown> | null = null;
    const detail = {
      product_id: 1, name: 'Widget', is_active: true,
      variants: [{
        variant_id: 10, sku: 'WID-1', sale_price: '5.00', is_active: true,
        base_unit_id: 1, base_unit_code: 'PC', attribute_signature: '',
        attributes: [], alternate_units: [], barcodes: [],
      }],
    };
    wireInvoke(makeHandlers({
      list_catalog_products: () => [
        { product_id: 1, name: 'Widget', is_active: true, variant_count: 1, active_variant_count: 1 },
      ],
      get_product_detail: () => detail,
      list_attributes: () => [],
      list_units: () => [],
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
    fireEvent.click(screen.getByTestId('variant-row-10'));

    // Find barcode input and add
    const barcodeInput = await screen.findByLabelText('Barcode');
    fireEvent.change(barcodeInput, { target: { value: '6001234567890' } });
    fireEvent.click(screen.getByTestId('add-barcode-btn'));

    await waitFor(() => expect(barcodeCall).not.toBeNull());
    expect(barcodeCall!.variantId).toBe(10);
    expect(barcodeCall!.barcode).toBe('6001234567890');
  });
});

describe('alternate unit management', () => {
  it('calls addVariantAltUnit with string conversionFactor', async () => {
    let altUnitCall: Record<string, unknown> | null = null;
    const detail = {
      product_id: 1, name: 'Widget', is_active: true,
      variants: [{
        variant_id: 10, sku: 'WID-1', sale_price: '5.00', is_active: true,
        base_unit_id: 1, base_unit_code: 'PC', attribute_signature: '',
        attributes: [], alternate_units: [], barcodes: [],
      }],
    };
    wireInvoke(makeHandlers({
      list_catalog_products: () => [
        { product_id: 1, name: 'Widget', is_active: true, variant_count: 1, active_variant_count: 1 },
      ],
      get_product_detail: () => detail,
      list_attributes: () => [],
      list_units: () => [{ id: 2, code: 'BOX', name: 'Box' }],
      add_variant_alt_unit: (args) => {
        altUnitCall = args;
        return 55;
      },
    }));
    render(<App />);
    await loginAndNavigate();

    const editBtn = await screen.findByTestId('edit-product-1');
    fireEvent.click(editBtn);
    await screen.findByTestId('variant-row-10');
    fireEvent.click(screen.getByTestId('variant-row-10'));

    // Select alternate unit
    const altSelect = await screen.findByLabelText('Units');
    fireEvent.change(altSelect, { target: { value: '2' } });

    const factorInput = screen.getByLabelText('Conversion factor');
    fireEvent.change(factorInput, { target: { value: '12' } });

    fireEvent.click(screen.getByTestId('add-alt-unit-btn'));

    await waitFor(() => expect(altUnitCall).not.toBeNull());
    expect(altUnitCall!.variantId).toBe(10);
    expect(altUnitCall!.unitId).toBe(2);
    expect(typeof altUnitCall!.conversionFactor).toBe('string');
    expect(altUnitCall!.conversionFactor).toBe('12');
  });
});

describe('deactivate a variant', () => {
  it('calls setVariantActive with false when deactivate is clicked', async () => {
    let toggleCall: Record<string, unknown> | null = null;
    const detail = {
      product_id: 1, name: 'Widget', is_active: true,
      variants: [{
        variant_id: 10, sku: 'WID-1', sale_price: '5.00', is_active: true,
        base_unit_id: 1, base_unit_code: 'PC', attribute_signature: '',
        attributes: [], alternate_units: [], barcodes: [],
      }],
    };
    wireInvoke(makeHandlers({
      list_catalog_products: () => [
        { product_id: 1, name: 'Widget', is_active: true, variant_count: 1, active_variant_count: 1 },
      ],
      get_product_detail: () => detail,
      list_attributes: () => [],
      list_units: () => [],
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

    // Arabic empty state for catalog
    expect(await screen.findByText('لا توجد منتجات. أنشئ منتجًا للبدء.')).toBeInTheDocument();
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
  });
});
