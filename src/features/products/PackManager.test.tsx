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
import type { UnitLifecycleItem, VariantPack } from '../../shared/ipc/dto';
import { PackManager } from './PackManager';

const mockUnits: UnitLifecycleItem[] = [
  { id: 1, code: 'UNIT', name: 'Unit', is_active: true, allows_fractions: false, usage_count: 5 },
  { id: 2, code: 'CTN', name: 'Carton', is_active: true, allows_fractions: false, usage_count: 2 },
  { id: 3, code: 'BAL', name: 'Bale', is_active: true, allows_fractions: false, usage_count: 0 },
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
});
