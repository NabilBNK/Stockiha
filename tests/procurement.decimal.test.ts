import { describe, expect, it } from 'vitest';

import {
  addExactDecimals,
  isDecimalLessThanOrEqual,
  isPositiveDecimal,
} from '../src/features/procurement/procurementDecimal';

describe('procurement exact decimal controls', () => {
  it('compares differently scaled values without binary floating point', () => {
    expect(isDecimalLessThanOrEqual('840.000', '840.00')).toBe(true);
    expect(isDecimalLessThanOrEqual('840.001', '840.00')).toBe(false);
    expect(isDecimalLessThanOrEqual('0.0000001', '0.0000002')).toBe(true);
  });

  it('rejects malformed or signed comparison inputs', () => {
    expect(isDecimalLessThanOrEqual('-1', '10')).toBe(false);
    expect(isDecimalLessThanOrEqual('1e2', '100')).toBe(false);
  });

  it('sums supplier liabilities exactly across scales', () => {
    expect(addExactDecimals(['0.10', '0.20', '840.000'])).toBe('840.3');
  });

  it('accepts only strictly positive decimal posting amounts', () => {
    expect(isPositiveDecimal('0.001')).toBe(true);
    expect(isPositiveDecimal('0')).toBe(false);
    expect(isPositiveDecimal('-0.01')).toBe(false);
  });
});
