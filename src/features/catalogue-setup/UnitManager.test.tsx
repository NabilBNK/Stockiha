import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { I18nProvider } from '../../shared/i18n';
import type { UnitLifecycleItem } from '../../shared/ipc/dto';
import { UnitManager } from './UnitManager';

const mockUnits: UnitLifecycleItem[] = [
  {
    id: 1,
    code: 'PC',
    name: 'Piece',
    is_active: true,
    allows_fractions: false,
    usage_count: 5,
    base_unit_id: null,
    base_unit_code: null,
    base_unit_name: null,
    conversion_factor: null,
    is_pack: false,
  },
  {
    id: 2,
    code: 'KG',
    name: 'Kilogram',
    is_active: true,
    allows_fractions: true,
    usage_count: 2,
    base_unit_id: null,
    base_unit_code: null,
    base_unit_name: null,
    conversion_factor: null,
    is_pack: false,
  },
  {
    id: 3,
    code: 'B12',
    name: 'Box of 12',
    is_active: true,
    allows_fractions: false,
    usage_count: 1,
    base_unit_id: 1,
    base_unit_code: 'PC',
    base_unit_name: 'Piece',
    conversion_factor: '12.000000',
    is_pack: true,
  },
  {
    id: 4,
    code: 'B24',
    name: 'Box of 24 (unused)',
    is_active: true,
    allows_fractions: false,
    usage_count: 0,
    base_unit_id: 1,
    base_unit_code: 'PC',
    base_unit_name: 'Piece',
    conversion_factor: '24',
    is_pack: true,
  },
];

function renderManager(props: Partial<Parameters<typeof UnitManager>[0]> = {}) {
  const defaultProps = {
    items: mockUnits,
    loading: false,
    error: null,
    onCreate: vi.fn().mockResolvedValue(undefined),
    onRename: vi.fn().mockResolvedValue(undefined),
    onUpdate: vi.fn().mockResolvedValue(undefined),
    onToggleActive: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    ...props,
  };

  return {
    ...render(
      <I18nProvider initialLocale="en">
        <UnitManager {...defaultProps} />
      </I18nProvider>
    ),
    spies: {
      onCreate: defaultProps.onCreate,
      onRename: defaultProps.onRename,
      onUpdate: defaultProps.onUpdate,
      onToggleActive: defaultProps.onToggleActive,
      onDelete: defaultProps.onDelete,
    },
  };
}

beforeEach(() => {
  cleanup();
});

describe('UnitManager (Catalogue Setup Pack Units)', () => {
  it('renders standard units and pack units with clear multipliers', async () => {
    renderManager();

    // Table rows
    expect(screen.getByTestId('coded-ref-code-1')).toHaveTextContent('PC');
    expect(screen.getByTestId('coded-ref-flag-1')).toHaveTextContent('No'); // Piece does not allow fractions

    expect(screen.getByTestId('coded-ref-code-2')).toHaveTextContent('KG');
    expect(screen.getByTestId('coded-ref-flag-2')).toHaveTextContent('Yes'); // KG allows fractions

    // Pack units
    expect(screen.getByTestId('unit-pack-badge-3')).toHaveTextContent('📦 1 = 12 × Piece');
    expect(screen.getByTestId('unit-pack-badge-4')).toHaveTextContent('📦 1 = 24 × Piece');
  });

  it('creates a pack unit linked to a base unit with live sentence preview', async () => {
    const { spies } = renderManager();

    // Select pack unit type
    fireEvent.click(screen.getByTestId('unit-type-pack'));

    // Enter name
    fireEvent.change(screen.getByLabelText('Unit name'), {
      target: { value: 'Carton de 48' },
    });

    // Select base unit (Piece id 1)
    fireEvent.change(screen.getByTestId('unit-create-base-select'), {
      target: { value: '1' },
    });

    // Enter factor
    fireEvent.change(screen.getByLabelText('How many per box / pack?'), {
      target: { value: '48' },
    });

    // Live preview sentence must appear
    expect(screen.getByTestId('unit-create-preview')).toHaveTextContent('👉 1 Carton de 48 = 48 Piece');

    // Submit
    fireEvent.click(screen.getByTestId('unit-create-submit'));

    await waitFor(() => {
      expect(spies.onCreate).toHaveBeenCalledTimes(1);
    });

    expect(spies.onCreate).toHaveBeenCalledWith(
      'Carton de 48',
      false, // packs do not allow fractions
      null,
      1, // base unit id
      '48', // conversion factor
      true // is_pack
    );
  });

  it('locks conversion factor when editing a pack unit that is already used', async () => {
    renderManager();

    // Unit 3 is a pack with usage_count = 1
    const editBtn = screen.getByTestId('unit-edit-btn-3');
    fireEvent.click(editBtn);

    // Factor input should be disabled because factor is locked
    const factorInput = screen.getByDisplayValue('12');
    expect(factorInput).toBeDisabled();

    // Locked notice should be visible
    expect(screen.getByText('Factor locked (in use in catalogue)')).toBeInTheDocument();
  });

  it('allows editing conversion factor when editing an unused pack unit', async () => {
    const { spies } = renderManager();

    // Unit 4 is a pack with usage_count = 0
    const editBtn = screen.getByTestId('unit-edit-btn-4');
    fireEvent.click(editBtn);

    // Factor input should NOT be disabled
    const factorInput = screen.getByDisplayValue('24');
    expect(factorInput).not.toBeDisabled();

    // Change factor to 36
    fireEvent.change(factorInput, { target: { value: '36' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(spies.onUpdate).toHaveBeenCalledTimes(1);
    });

    expect(spies.onUpdate).toHaveBeenCalledWith(
      4,
      'Box of 24 (unused)',
      false,
      null,
      1,
      '36',
      true
    );
  });

  it('triggers delete confirmation dialog and disables delete for in-use units', async () => {
    const { spies } = renderManager();

    // Unit 1 has usage_count = 5 -> delete button must be disabled
    const deleteBtnUsed = screen.getByTestId('unit-delete-btn-1');
    expect(deleteBtnUsed).toBeDisabled();

    // Unit 4 has usage_count = 0 -> delete button is enabled
    const deleteBtnUnused = screen.getByTestId('unit-delete-btn-4');
    expect(deleteBtnUnused).not.toBeDisabled();

    fireEvent.click(deleteBtnUnused);

    // Confirmation dialog opens
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText(/Delete "Box of 24 \(unused\)"\?/i)).toBeInTheDocument();

    // Confirm delete
    const confirmBtn = within(dialog).getByRole('button', { name: 'Delete' });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(spies.onDelete).toHaveBeenCalledWith(4);
    });
  });
});
