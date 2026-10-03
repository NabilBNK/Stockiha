import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

// Mock ipc gateway directly or @tauri-apps/api/core
const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

import { I18nProvider } from '../../shared/i18n';
import type { UnitLifecycleItem, VariantDetail, VariantPack } from '../../shared/ipc/dto';
import { PackManager } from './PackManager';

const mockUnits: UnitLifecycleItem[] = [
  { id: 1, code: 'UNIT', name: 'Unit', is_active: true, allows_fractions: false, usage_count: 5, is_pack: false },
  { id: 2, code: 'CTN', name: 'Carton', is_active: true, allows_fractions: false, usage_count: 2, is_pack: true },
  { id: 3, code: 'BAL', name: 'Bale', is_active: true, allows_fractions: false, usage_count: 0, is_pack: true },
];

function samplePack(overrides: Partial<VariantPack> = {}): VariantPack {
  return {
    variant_unit_id: 101,
    unit_id: 2,
    unit_code: 'CTN',
    unit_name: 'Carton',
    conversion_factor: '12',
    sale_price: '15000.00',
    is_pack: true,
    is_primary: true,
    is_active: true,
    is_used: false,
    barcode_ids: [201],
    barcodes: ['6131000000021'],
    ...overrides,
  };
}

function wireGateway(handlers: Record<string, (args: Record<string, unknown>) => unknown>) {
  invokeMock.mockImplementation((command: string, args: Record<string, unknown> = {}) => {
    const handler = handlers[command];
    if (handler) {
      try {
        return Promise.resolve(handler(args));
      } catch (err) {
        return Promise.reject(err);
      }
    }
    // Default safe mocks
    if (command === 'list_variant_packs') return Promise.resolve([]);
    if (command === 'resolve_barcode') return Promise.reject({ code: 'BARCODE_NOT_FOUND' });
    return Promise.resolve(null);
  });
}

function renderManager(props: Partial<Parameters<typeof PackManager>[0]> = {}) {
  return render(
    <I18nProvider initialLocale="en">
      <PackManager
        variantId={10}
        baseUnit={{ id: 1, code: 'UNIT', name: 'Unit', isWhole: true }}
        pieceSalePrice="1400.00"
        units={mockUnits}
        sessionToken="test-token"
        {...props}
      />
    </I18nProvider>
  );
}

beforeEach(() => {
  invokeMock.mockReset();
  cleanup();
});

describe('PackManager (WS-O-2.2)', () => {
  it('renders empty state when there are no packs', async () => {
    wireGateway({
      list_variant_packs: () => [],
    });

    renderManager();

    expect(await screen.findByTestId('pack-empty-state')).toBeInTheDocument();
    expect(screen.getByTestId('pack-empty-text')).toHaveTextContent(
      'No packs. This product is bought and sold by the Unit only.'
    );
    expect(screen.getByTestId('pack-add-empty-btn')).toBeInTheDocument();
  });

  it('add flow calls createPack then addPackBarcode with exact arguments', async () => {
    const createPackSpy = vi.fn().mockReturnValue(999);
    const addBarcodeSpy = vi.fn().mockReturnValue(1234);

    wireGateway({
      list_variant_packs: vi
        .fn()
        .mockReturnValueOnce([])
        .mockReturnValue([samplePack({ variant_unit_id: 999 })]),
      resolve_barcode: () => Promise.reject({ code: 'BARCODE_NOT_FOUND' }),
      create_pack: (args) => {
        createPackSpy(args);
        return 999;
      },
      add_pack_barcode: (args) => {
        addBarcodeSpy(args);
        return 1234;
      },
    });

    renderManager();
    const addBtn = await screen.findByTestId('pack-add-empty-btn');
    fireEvent.click(addBtn);

    // Dialog opens
    expect(await screen.findByTestId('pack-dialog')).toBeInTheDocument();

    // Select Carton (unitId 2)
    fireEvent.change(screen.getByTestId('pack-dialog-unit-select'), {
      target: { value: '2' },
    });
    // Enter Holds = 12
    fireEvent.change(screen.getByTestId('pack-dialog-holds-input'), {
      target: { value: '12' },
    });
    // Enter Price = 15000
    fireEvent.change(screen.getByTestId('pack-dialog-price-input'), {
      target: { value: '15000' },
    });
    // Enter Barcode = 6131000000021
    fireEvent.change(screen.getByTestId('pack-dialog-barcode-input'), {
      target: { value: '6131000000021' },
    });

    // Submit dialog
    fireEvent.click(screen.getByTestId('pack-dialog-save-btn'));

    await waitFor(() => {
      expect(createPackSpy).toHaveBeenCalledTimes(1);
    });

    expect(createPackSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionToken: 'test-token',
        variantId: 10,
        unitId: 2,
        conversionFactor: '12',
        salePrice: '15000',
        makePrimary: true, // First pack is automatically primary
      })
    );

    await waitFor(() => {
      expect(addBarcodeSpy).toHaveBeenCalledTimes(1);
    });

    expect(addBarcodeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionToken: 'test-token',
        variantUnitId: 999,
        barcode: '6131000000021',
      })
    );
  });

  it('barcode already used blocks save and does not call createPack', async () => {
    const createPackSpy = vi.fn();

    wireGateway({
      list_variant_packs: () => [],
      resolve_barcode: () => ({
        product_name: 'Existing Pillow',
        variant_id: 5,
      }),
      create_pack: createPackSpy,
    });

    renderManager();
    const addBtn = await screen.findByTestId('pack-add-empty-btn');
    fireEvent.click(addBtn);

    await screen.findByTestId('pack-dialog');

    fireEvent.change(screen.getByTestId('pack-dialog-unit-select'), {
      target: { value: '2' },
    });
    fireEvent.change(screen.getByTestId('pack-dialog-holds-input'), {
      target: { value: '12' },
    });
    fireEvent.change(screen.getByTestId('pack-dialog-barcode-input'), {
      target: { value: '6131000000014' },
    });

    fireEvent.click(screen.getByTestId('pack-dialog-save-btn'));

    expect(
      await screen.findByText('This barcode is already used by Existing Pillow.')
    ).toBeInTheDocument();
    expect(createPackSpy).not.toHaveBeenCalled();
  });

  it('is_used disables Holds in edit dialog and Delete is hidden when is_used', async () => {
    const usedPack = samplePack({
      variant_unit_id: 102,
      is_used: true,
    });

    wireGateway({
      list_variant_packs: () => [usedPack],
    });

    renderManager();

    expect(await screen.findByTestId('pack-table')).toBeInTheDocument();

    // Delete button must be hidden when is_used = true
    expect(screen.queryByTestId('pack-delete-btn-102')).not.toBeInTheDocument();

    // Open Edit dialog
    fireEvent.click(screen.getByTestId('pack-edit-btn-102'));
    expect(await screen.findByTestId('pack-dialog')).toBeInTheDocument();

    // Holds input must be disabled and explanation note shown
    const holdsInput = screen.getByTestId('pack-dialog-holds-input');
    expect(holdsInput).toBeDisabled();
    expect(
      screen.getByText(
        'Used in purchases or stock records — the quantity cannot change. Deactivate this pack and create a new one instead.'
      )
    ).toBeInTheDocument();
  });

  it('Delete button is visible when is_used is false and triggers removePack upon confirmation', async () => {
    const unusedPack = samplePack({
      variant_unit_id: 103,
      is_used: false,
    });
    const removePackSpy = vi.fn();

    wireGateway({
      list_variant_packs: () => [unusedPack],
      remove_pack: (args) => {
        removePackSpy(args);
        return null;
      },
    });

    renderManager();

    const deleteBtn = await screen.findByTestId('pack-delete-btn-103');
    expect(deleteBtn).toBeInTheDocument();
    fireEvent.click(deleteBtn);

    // Confirm dialog opens
    expect(
      await screen.findByText('Delete this pack? This cannot be undone.')
    ).toBeInTheDocument();
    // Confirm delete
    const dialog = screen.getByRole('dialog');
    const confirmBtn = within(dialog).getByRole('button', { name: 'Delete' });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(removePackSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionToken: 'test-token',
          variantUnitId: 103,
        })
      );
    });
  });

  it('opens Apply to other variants dialog and bulk-applies pack to sibling variants', async () => {
    const existingPack = samplePack({ variant_unit_id: 101, unit_id: 2, conversion_factor: '12', sale_price: '15000.00' });
    const createPackSpy = vi.fn().mockResolvedValue(999);

    const mockSiblings: VariantDetail[] = [
      {
        variant_id: 11,
        sku: 'SKU-11',
        name_override: null,
        effective_variant_name: 'Blue / L',
        primary_barcode: null,
        operational_identifier: 'SKU-11',
        identifier_type: 'SKU',
        sale_price: '1400.00',
        minimum_stock: '0',
        is_active: true,
        attribute_signature: 'Blue · L',
        attributes: [],
        barcodes: [],
      },
      {
        variant_id: 12,
        sku: 'SKU-12',
        name_override: null,
        effective_variant_name: 'Blue / M',
        primary_barcode: null,
        operational_identifier: 'SKU-12',
        identifier_type: 'SKU',
        sale_price: '1400.00',
        minimum_stock: '0',
        is_active: true,
        attribute_signature: 'Blue · M',
        attributes: [],
        barcodes: [],
      },
    ];

    wireGateway({
      list_variant_packs: (args) => {
        if (args.variantId === 10) return [existingPack];
        // Variant 11 has no packs, Variant 12 already has Carton (unit_id 2)
        if (args.variantId === 12) return [samplePack({ variant_unit_id: 102, unit_id: 2 })];
        return [];
      },
      create_pack: (args) => {
        createPackSpy(args);
        return 999;
      },
    });

    renderManager({ siblingVariants: mockSiblings });

    const applyBtn = await screen.findByTestId('pack-apply-btn-101');
    expect(applyBtn).toBeInTheDocument();
    fireEvent.click(applyBtn);

    // Dialog opens
    expect(await screen.findByTestId('pack-apply-dialog')).toBeInTheDocument();
    expect(screen.getByText(/Blue \/ L/)).toBeInTheDocument();
    expect(screen.getByText(/Blue \/ M/)).toBeInTheDocument();

    // Submit
    const submitBtn = screen.getByTestId('pack-apply-submit-btn');
    fireEvent.click(submitBtn);

    // Creates on variant 11, skips variant 12 (already has unit 2)
    await waitFor(() => {
      expect(createPackSpy).toHaveBeenCalledTimes(1);
      expect(createPackSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          variantId: 11,
          unitId: 2,
          conversionFactor: '12',
          salePrice: '15000.00',
        })
      );
    });

    // Feedback shows 1 applied, 1 skipped
    expect(await screen.findByTestId('pack-feedback-banner')).toHaveTextContent(/1 variant\(s\) skipped/);
  });

  it('renders Copy packs from another variant button on empty state and copies packs', async () => {
    const createPackSpy = vi.fn().mockResolvedValue(888);
    const mockSiblings: VariantDetail[] = [
      {
        variant_id: 11,
        sku: 'SKU-11',
        name_override: null,
        effective_variant_name: 'Blue / L',
        primary_barcode: null,
        operational_identifier: 'SKU-11',
        identifier_type: 'SKU',
        sale_price: '1400.00',
        minimum_stock: '0',
        is_active: true,
        attribute_signature: 'Blue · L',
        attributes: [],
        barcodes: [],
      },
    ];

    wireGateway({
      list_variant_packs: (args) => {
        if (args.variantId === 11) {
          return [samplePack({ variant_unit_id: 105, unit_id: 2, conversion_factor: '12', sale_price: '15000.00' })];
        }
        return [];
      },
      create_pack: (args) => {
        createPackSpy(args);
        return 888;
      },
    });

    renderManager({ siblingVariants: mockSiblings });

    // Empty state should have copy button
    const copyBtn = await screen.findByTestId('pack-copy-empty-btn');
    expect(copyBtn).toBeInTheDocument();
    fireEvent.click(copyBtn);

    // Dialog opens and lists packs from source variant
    expect(await screen.findByTestId('pack-copy-dialog')).toBeInTheDocument();
    expect(await screen.findByText(/Carton/)).toBeInTheDocument();

    // Click Copy 1 pack(s)
    const copySubmit = screen.getByTestId('pack-copy-submit-btn');
    fireEvent.click(copySubmit);

    await waitFor(() => {
      expect(createPackSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          variantId: 10,
          unitId: 2,
          conversionFactor: '12',
          salePrice: '15000.00',
        })
      );
    });
  });

  it('filters variants in Apply dialog and Copy dialog using search input', async () => {
    const existingPack = samplePack({ variant_unit_id: 101, unit_id: 2 });
    const mockSiblings: VariantDetail[] = [
      {
        variant_id: 11,
        sku: 'SKU-RED-L',
        name_override: null,
        effective_variant_name: 'Zawra Red L',
        primary_barcode: null,
        operational_identifier: 'SKU-RED-L',
        identifier_type: 'SKU',
        sale_price: '1400.00',
        minimum_stock: '0',
        is_active: true,
        attribute_signature: 'Red · L',
        attributes: [{ attribute_id: 1, attribute_name: 'Color', attribute_value_id: 10, value: 'Red' }],
        barcodes: [],
      },
      {
        variant_id: 12,
        sku: 'SKU-BLUE-M',
        name_override: null,
        effective_variant_name: 'Zawra Blue M',
        primary_barcode: null,
        operational_identifier: 'SKU-BLUE-M',
        identifier_type: 'SKU',
        sale_price: '1400.00',
        minimum_stock: '0',
        is_active: true,
        attribute_signature: 'Blue · M',
        attributes: [{ attribute_id: 1, attribute_name: 'Color', attribute_value_id: 20, value: 'Blue' }],
        barcodes: [],
      },
    ];

    wireGateway({
      list_variant_packs: () => [existingPack],
    });

    renderManager({ siblingVariants: mockSiblings });

    // 1. Test search in Apply dialog
    fireEvent.click(await screen.findByTestId('pack-apply-btn-101'));
    expect(await screen.findByTestId('pack-apply-dialog')).toBeInTheDocument();

    const applySearch = screen.getByTestId('pack-apply-search-input');
    fireEvent.change(applySearch, { target: { value: 'Blue' } });

    // Zawra Blue M is shown, Zawra Red L is hidden
    expect(screen.getByTestId('pack-apply-row-12')).toBeInTheDocument();
    expect(screen.queryByTestId('pack-apply-row-11')).not.toBeInTheDocument();

    // Select matching
    fireEvent.click(screen.getByTestId('pack-apply-select-matching'));
    // Close apply dialog
    fireEvent.click(screen.getByTestId('pack-apply-cancel-btn'));

    // 2. Test search in Copy dialog
    fireEvent.click(await screen.findByTestId('pack-copy-header-btn'));
    expect(await screen.findByTestId('pack-copy-dialog')).toBeInTheDocument();

    const copySearch = screen.getByTestId('pack-copy-search-input');
    fireEvent.change(copySearch, { target: { value: 'Red' } });

    expect(screen.getByTestId('pack-copy-candidate-11')).toBeInTheDocument();
    expect(screen.queryByTestId('pack-copy-candidate-12')).not.toBeInTheDocument();
  });

  it('displays suggested max price prompt and allows 1-click application', async () => {
    wireGateway({
      list_variant_packs: () => [],
    });

    renderManager({ pieceSalePrice: '1000' });
    fireEvent.click(await screen.findByTestId('pack-add-empty-btn'));

    expect(await screen.findByTestId('pack-dialog')).toBeInTheDocument();

    // Select Carton (unitId 2) with holds 12
    fireEvent.change(screen.getByTestId('pack-dialog-unit-select'), {
      target: { value: '2' },
    });
    fireEvent.change(screen.getByTestId('pack-dialog-holds-input'), {
      target: { value: '36' },
    });

    // 1000 * 36 = 36000
    const prompt = await screen.findByTestId('pack-dialog-price-suggestion-prompt');
    expect(prompt).toBeInTheDocument();
    expect(prompt).toHaveTextContent('36,000');
    expect(prompt).toHaveTextContent('36 Unit × 1,000');

    // Click use suggested price button
    const useBtn = screen.getByTestId('pack-dialog-use-suggested-price');
    fireEvent.click(useBtn);

    const priceInput = screen.getByTestId('pack-dialog-price-input') as HTMLInputElement;
    expect(priceInput.value).toBe('36000');
  });

  it('pack unit dropdown excludes atomic base units and incompatible packs', async () => {
    const mixedUnits: UnitLifecycleItem[] = [
      { id: 1, code: 'UNIT', name: 'Unit', is_active: true, allows_fractions: false, usage_count: 5, is_pack: false },
      { id: 2, code: 'KG', name: 'Kilogram', is_active: true, allows_fractions: true, usage_count: 3, is_pack: false },
      { id: 3, code: 'CTN50', name: 'Carton 50', is_active: true, allows_fractions: false, usage_count: 2, is_pack: true, base_unit_id: 1, conversion_factor: '50' },
      { id: 4, code: 'CTN_KG', name: 'Carton Kg', is_active: true, allows_fractions: false, usage_count: 1, is_pack: true, base_unit_id: 2, conversion_factor: '10' },
      { id: 5, code: 'BOX_FLEX', name: 'Flexible Box', is_active: true, allows_fractions: false, usage_count: 0, is_pack: true, base_unit_id: null, conversion_factor: null },
    ];

    wireGateway({
      list_variant_packs: () => [],
    });

    renderManager({ units: mixedUnits, baseUnit: { id: 1, code: 'UNIT', name: 'Unit', isWhole: true } });
    fireEvent.click(await screen.findByTestId('pack-add-empty-btn'));
    expect(await screen.findByTestId('pack-dialog')).toBeInTheDocument();

    const select = screen.getByTestId('pack-dialog-unit-select') as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((opt) => opt.value);

    // "" (None), "3" (CTN50 - pre-configured for UNIT), "5" (BOX_FLEX - flexible pack)
    expect(optionValues).toEqual(['', '3', '5']);
    // Base units UNIT (1) and KG (2), and pack pre-configured for KG (4) must NOT be present
    expect(optionValues).not.toContain('1');
    expect(optionValues).not.toContain('2');
    expect(optionValues).not.toContain('4');
  });
});


