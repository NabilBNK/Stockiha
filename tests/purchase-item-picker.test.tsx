import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { matchesPurchaseOption, PurchaseItemPicker } from '../src/features/procurement/PurchaseItemPicker';
import type { PurchaseProductOption } from '../src/shared/ipc/dto';

describe('PurchaseItemPicker - matchesPurchaseOption', () => {
  it('matches by primary_barcode exactly and rejects non-matching queries', () => {
    const option: PurchaseProductOption = {
      product_id: 1,
      variant_id: 10,
      sku: 'SKU-BAR-01',
      primary_barcode: '6191234567890',
      product_name: 'Barcode Product',
      variant_name: null,
      brand: null,
      default_unit_id: 1,
      default_unit_code: 'U',
      default_unit_name: 'Unit',
      alternate_units: [],
      attributes: [],
      is_active: true,
    };

    expect(matchesPurchaseOption(option, '6191234567890')).toBe(true);
    expect(matchesPurchaseOption(option, '999')).toBe(false);
  });

  it('matches by accented name and tokens', () => {
    const option: PurchaseProductOption = {
      product_id: 2,
      variant_id: 20,
      sku: 'CAF-001',
      primary_barcode: null,
      product_name: 'Café moulu',
      variant_name: '250g',
      brand: null,
      default_unit_id: 1,
      default_unit_code: 'U',
      default_unit_name: 'Unit',
      alternate_units: [],
      attributes: [],
      is_active: true,
    };

    expect(matchesPurchaseOption(option, 'café mou')).toBe(true);
    expect(matchesPurchaseOption(option, 'thé')).toBe(false);
  });
});

describe('PurchaseItemPicker - side filters', () => {
  const sampleItems: PurchaseProductOption[] = [
    {
      product_id: 1,
      variant_id: 101,
      sku: 'SHIRT-RED-M',
      primary_barcode: '111111',
      product_name: 'T-Shirt',
      variant_name: 'Red M',
      brand: { id: 1, name: 'BrandA' },
      default_unit_id: 1,
      default_unit_code: 'PCS',
      default_unit_name: 'Piece',
      alternate_units: [],
      attributes: [
        { name: 'Color', value: 'Red' },
        { name: 'Size', value: 'M' },
      ],
      is_active: true,
      default_unit_cost: '500',
      last_purchase_cost: '500',
    },
    {
      product_id: 1,
      variant_id: 102,
      sku: 'SHIRT-BLUE-L',
      primary_barcode: '222222',
      product_name: 'T-Shirt',
      variant_name: 'Blue L',
      brand: { id: 2, name: 'BrandB' },
      default_unit_id: 2,
      default_unit_code: 'BOX',
      default_unit_name: 'Box',
      alternate_units: [],
      attributes: [
        { name: 'Color', value: 'Blue' },
        { name: 'Size', value: 'L' },
      ],
      is_active: true,
      default_unit_cost: '1500',
      last_purchase_cost: '1500',
    },
  ];

  it('renders side filter sections and filters by attribute chip', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();

    render(
      <PurchaseItemPicker
        isOpen={true}
        items={sampleItems}
        disabledVariantIds={[]}
        onSelect={onSelect}
        onClose={onClose}
      />,
    );

    expect(screen.getByTestId('purchase-item-picker-sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('filter-attr-Color-Red')).toBeInTheDocument();
    expect(screen.getByTestId('filter-attr-Color-Blue')).toBeInTheDocument();

    // Initially both items are shown
    expect(screen.getByTestId('purchase-item-option-101')).toBeInTheDocument();
    expect(screen.getByTestId('purchase-item-option-102')).toBeInTheDocument();

    // Click Red attribute chip
    fireEvent.click(screen.getByTestId('filter-attr-Color-Red'));

    // Now only Red variant is displayed
    expect(screen.getByTestId('purchase-item-option-101')).toBeInTheDocument();
    expect(screen.queryByTestId('purchase-item-option-102')).not.toBeInTheDocument();

    // Click Clear all
    fireEvent.click(screen.getByTestId('purchase-picker-clear-filters'));

    // Both items return
    expect(screen.getByTestId('purchase-item-option-101')).toBeInTheDocument();
    expect(screen.getByTestId('purchase-item-option-102')).toBeInTheDocument();
  });

  it('filters by cost range', () => {
    render(
      <PurchaseItemPicker
        isOpen={true}
        items={sampleItems}
        disabledVariantIds={[]}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    // Filter min cost to 1000
    fireEvent.change(screen.getByTestId('filter-min-cost'), { target: { value: '1000' } });

    // Item 101 (500 DZD) filtered out, Item 102 (1500 DZD) remains
    expect(screen.queryByTestId('purchase-item-option-101')).not.toBeInTheDocument();
    expect(screen.getByTestId('purchase-item-option-102')).toBeInTheDocument();
  });
});
