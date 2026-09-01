import { describe, expect, it } from 'vitest';

import { isDecimalLessThanOrEqual, isLowStock } from '../src/features/inventory/exactDecimal';

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
