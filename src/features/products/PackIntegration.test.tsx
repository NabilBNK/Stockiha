import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

import { I18nProvider } from '../../shared/i18n';
import { CatalogCreatePanel, CatalogPanel } from '../catalog2/CatalogPanel';

const mockUnits = [
  { id: 1, code: 'UNIT', name: 'Unit', is_active: true, allows_fractions: false, usage_count: 3 },
  { id: 2, code: 'CTN', name: 'Carton', is_active: true, allows_fractions: false, usage_count: 1 },
];

function wireInvoke(handlers: Record<string, (args: Record<string, unknown>) => unknown>) {
  invokeMock.mockImplementation((command: string, args: Record<string, unknown> = {}) => {
    const handler = handlers[command];
    if (handler) {
      try {
        return Promise.resolve(handler(args));
      } catch (err) {
        return Promise.reject(err);
      }
    }
    if (command === 'list_units_v2') return Promise.resolve(mockUnits);
    if (command === 'list_categories') return Promise.resolve([]);
    if (command === 'list_attributes') return Promise.resolve([]);
    if (command === 'list_variant_packs') return Promise.resolve([]);
    if (command === 'resolve_barcode') return Promise.reject({ code: 'BARCODE_NOT_FOUND' });
    return Promise.resolve(null);
  });
}

beforeEach(() => {
  invokeMock.mockReset();
  cleanup();
});

describe('O-2.4 — Hide pack barcodes from variant piece barcode list', () => {
  it('filters out pack barcodes and displays the note pack.barcodesElsewhere', async () => {
    wireInvoke({
      get_product_detail: () => ({
        product_id: 1,
        name: 'Oreiller blanc',
        unit_id: 1,
        unit_code: 'UNIT',
        unit_name: 'Unit',
        is_active: true,
        category_id: null,
        variants: [
          {
            variant_id: 10,
            sku: 'OR-1',
            name_override: null,
            effective_variant_name: 'Oreiller blanc',
            primary_barcode: '6131000000014',
            operational_identifier: '6131000000014',
            identifier_type: 'BARCODE',
            sale_price: '1400.00',
            minimum_stock: '0',
            is_active: true,
            attribute_signature: '',
            attributes: [],
            // 2 barcodes: one piece barcode (id: 101) and one pack barcode (id: 102)
            barcodes: [
              { id: 101, barcode: '6131000000014', is_primary: true },
              { id: 102, barcode: '6131000000021', is_primary: false },
            ],
            alt_units: [],
          },
        ],
      }),
      list_variant_packs: () => [
        {
          variant_unit_id: 50,
          unit_id: 2,
          unit_code: 'CTN',
          unit_name: 'Carton',
          conversion_factor: '12',
          sale_price: '15000.00',
          is_pack: true,
          is_primary: true,
          is_active: true,
          is_used: false,
          barcode_ids: [102],
          barcodes: ['6131000000021'],
        },
      ],
    });

    render(
      <I18nProvider initialLocale="en">
        <CatalogPanel token="test-token" productId={1} onClose={() => {}} />
      </I18nProvider>
    );

    // Expand barcodes section
    const barcodeToggle = await screen.findByTestId('catalog2-barcodes-toggle-10');
    fireEvent.click(barcodeToggle);

    // Piece barcode 6131000000014 must be shown
    expect(await screen.findByText('6131000000014')).toBeInTheDocument();

    // Pack barcode 6131000000021 must NOT be shown in piece barcode list
    await waitFor(() => {
      expect(screen.queryByTestId('catalog2-remove-barcode-102')).not.toBeInTheDocument();
    });

    // The note must be displayed
    expect(await screen.findByTestId('pack-barcodes-elsewhere')).toHaveTextContent(
      'Pack barcodes are managed in the Packs section.'
    );
  });
});

describe('O-2.5 — Quick add: Sold by the box (optional)', () => {
  it('calls createPack with makePrimary=true and addPackBarcode when box section is filled', async () => {
    const quickCreateSpy = vi.fn().mockReturnValue({ product_id: 42, variant_id: 84 });
    const createPackSpy = vi.fn().mockReturnValue(123);
    const addBarcodeSpy = vi.fn().mockReturnValue(456);

    wireInvoke({
      quick_create_product: (args) => {
        quickCreateSpy(args);
        return { product_id: 42, variant_id: 84 };
      },
      create_pack: (args) => {
        createPackSpy(args);
        return 123;
      },
      add_pack_barcode: (args) => {
        addBarcodeSpy(args);
        return 456;
      },
    });

    const onCreatedSpy = vi.fn();

    render(
      <I18nProvider initialLocale="en">
        <CatalogCreatePanel token="test-token" onClose={() => {}} onCreated={onCreatedSpy} />
      </I18nProvider>
    );

    // Fill required product fields
    const nameInput = await screen.findByTestId('catalog2-create-name');
    fireEvent.change(nameInput, { target: { value: 'Oreiller' } });

    const priceInput = screen.getByTestId('catalog2-create-variant-price');
    fireEvent.change(priceInput, { target: { value: '1400' } });

    // Open box section
    const boxToggle = screen.getByTestId('catalog2-create-box-toggle');
    fireEvent.click(boxToggle);

    // Fill box fields
    const boxUnitSelect = screen.getByTestId('catalog2-create-box-unit');
    fireEvent.change(boxUnitSelect, { target: { value: '2' } });

    const boxHoldsInput = screen.getByTestId('catalog2-create-box-holds');
    fireEvent.change(boxHoldsInput, { target: { value: '12' } });

    const boxPriceInput = screen.getByTestId('catalog2-create-box-price');
    fireEvent.change(boxPriceInput, { target: { value: '15000' } });

    const boxBarcodeInput = screen.getByTestId('catalog2-create-box-barcode');
    fireEvent.change(boxBarcodeInput, { target: { value: '6131000000021' } });

    // Submit form
    const submitBtn = screen.getByTestId('catalog2-create-submit');
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(quickCreateSpy).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(createPackSpy).toHaveBeenCalledTimes(1);
    });

    expect(createPackSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionToken: 'test-token',
        variantId: 84,
        unitId: 2,
        conversionFactor: '12',
        salePrice: '15000',
        makePrimary: true,
      })
    );

    await waitFor(() => {
      expect(addBarcodeSpy).toHaveBeenCalledTimes(1);
    });

    expect(addBarcodeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionToken: 'test-token',
        variantUnitId: 123,
        barcode: '6131000000021',
      })
    );

    expect(onCreatedSpy).toHaveBeenCalledWith(42, undefined);
  });

  it('does NOT call createPack when box section is empty', async () => {
    const quickCreateSpy = vi.fn().mockReturnValue({ product_id: 42, variant_id: 84 });
    const createPackSpy = vi.fn();

    wireInvoke({
      quick_create_product: (args) => {
        quickCreateSpy(args);
        return { product_id: 42, variant_id: 84 };
      },
      create_pack: createPackSpy,
    });

    const onCreatedSpy = vi.fn();

    render(
      <I18nProvider initialLocale="en">
        <CatalogCreatePanel token="test-token" onClose={() => {}} onCreated={onCreatedSpy} />
      </I18nProvider>
    );

    const nameInput = await screen.findByTestId('catalog2-create-name');
    fireEvent.change(nameInput, { target: { value: 'Oreiller' } });

    const priceInput = screen.getByTestId('catalog2-create-variant-price');
    fireEvent.change(priceInput, { target: { value: '1400' } });

    // Submit with box section untouched
    const submitBtn = screen.getByTestId('catalog2-create-submit');
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(quickCreateSpy).toHaveBeenCalledTimes(1);
    });

    expect(createPackSpy).not.toHaveBeenCalled();
    expect(onCreatedSpy).toHaveBeenCalledWith(42, undefined);
  });
});
