import { describe, expect, it } from 'vitest';

import {
  isDecimalLessThanOrEqual,
  isLowStock,
  sumExactDecimals,
} from '../src/features/inventory/exactDecimal';

describe('products list low-stock predicate (ws-d-skill.md section 3)', () => {
  it('flags low stock at-or-below the minimum, deliberately', () => {
    expect(isLowStock('5', '5')).toBe(true);
  });

  it('does not flag stock above the minimum', () => {
    expect(isLowStock('6', '5')).toBe(false);
  });

  it('never flags low stock when minimum_stock is zero, at any quantity', () => {
    expect(isLowStock('0', '0')).toBe(false);
  });

  it('flags zero stock as low when a positive minimum is set', () => {
    expect(isLowStock('0', '5')).toBe(true);
  });

  it('compares differently-scaled exact decimals without floating point', () => {
    expect(isDecimalLessThanOrEqual('5.00', '5')).toBe(true);
    expect(isDecimalLessThanOrEqual('5.001', '5.00')).toBe(false);
    expect(isDecimalLessThanOrEqual('0.0000001', '0.0000002')).toBe(true);
  });

  it('rejects malformed comparison inputs', () => {
    expect(isDecimalLessThanOrEqual('-1', '10')).toBe(false);
    expect(isDecimalLessThanOrEqual('1e2', '100')).toBe(false);
  });
});

// WS-D-9 — the Catalog page aggregates a product row's stock by summing its
// variant quantities. Exact decimals only: no parseFloat, no rounding.
describe('sumExactDecimals (WS-D-9 product-row stock aggregate)', () => {
  it('sums differently-scaled decimals without floating point drift', () => {
    expect(sumExactDecimals(['0.1', '0.2'])).toBe('0.3');
    expect(sumExactDecimals(['1.005', '2.5', '3'])).toBe('6.505');
  });

  it('preserves the widest scale and trims only trailing zeroes', () => {
    expect(sumExactDecimals(['1.500', '0.500'])).toBe('2');
    expect(sumExactDecimals(['1.250', '0.250'])).toBe('1.5');
  });

  it('sums magnitudes no JS number can hold exactly', () => {
    expect(sumExactDecimals(['9007199254740993', '1'])).toBe('9007199254740994');
  });

  it('returns "0" for an empty list and ignores malformed entries', () => {
    expect(sumExactDecimals([])).toBe('0');
    expect(sumExactDecimals(['5', '-1', '1e3', 'abc'])).toBe('5');
  });
});
