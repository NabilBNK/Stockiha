import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PackQuantity } from '../src/shared/components/PackQuantity';
import type { PrimaryPack } from '../src/shared/ipc/dto';

describe('PackQuantity component (O-5.2)', () => {
  const cartonPack: PrimaryPack = {
    variant_id: 1,
    variant_unit_id: 10,
    unit_code: 'CTN',
    unit_name: 'Carton',
    conversion_factor: '12',
    sale_price: '15000.00',
    base_unit_code: 'PCS',
    base_unit_name: 'Unit',
  };

  it('renders plain base quantity and unit when no pack is present', () => {
    render(
      <PackQuantity
        baseQuantity="29"
        baseUnitName="Unit"
        testId="plain-stock"
      />
    );

    const el = screen.getByTestId('plain-stock');
    expect(el).toHaveTextContent('29 Unit');
    expect(el).not.toHaveAttribute('title');
  });

  it('renders "2 Carton + 5 Unit" with tooltip "= 29 Unit" when pack is present', () => {
    render(
      <PackQuantity
        baseQuantity="29"
        baseUnitName="Unit"
        pack={cartonPack}
        testId="pack-stock"
      />
    );

    const el = screen.getByTestId('pack-stock');
    expect(el).toHaveTextContent('2 Carton + 5 Unit');
    expect(el).toHaveAttribute('title', '= 29 Unit');
  });

  it('renders "2 Carton" when rest is zero', () => {
    render(
      <PackQuantity
        baseQuantity="24"
        baseUnitName="Unit"
        pack={cartonPack}
        testId="exact-pack-stock"
      />
    );

    const el = screen.getByTestId('exact-pack-stock');
    expect(el).toHaveTextContent('2 Carton');
    expect(el).toHaveAttribute('title', '= 24 Unit');
  });

  it('renders "11 Unit" when quantity is less than one pack', () => {
    render(
      <PackQuantity
        baseQuantity="11"
        baseUnitName="Unit"
        pack={cartonPack}
        testId="under-pack-stock"
      />
    );

    const el = screen.getByTestId('under-pack-stock');
    expect(el).toHaveTextContent('11 Unit');
    expect(el).toHaveAttribute('title', '= 11 Unit');
  });
});
