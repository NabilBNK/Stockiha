import { describe, expect, it } from 'vitest';

import {
  decimalSeparatorsFor,
  formatDecimalDisplay,
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

// WS-D-10 — Owner ruling: "no decimals unless there are some." Display only;
// the stored string is never altered, and never routed through a double.
describe('formatDecimalDisplay (WS-D-10)', () => {
  it('adds group separators and drops an all-zero fraction', () => {
    expect(formatDecimalDisplay('2000')).toBe('2,000');
    expect(formatDecimalDisplay('2000.00')).toBe('2,000');
    expect(formatDecimalDisplay('14000.000')).toBe('14,000');
    expect(formatDecimalDisplay('12000')).toBe('12,000');
  });

  // The ruling lists both "1999.50 -> 1,999.50" and "1999.5 -> 1,999.5", so a
  // fraction that is not all zeroes is kept exactly as stored — "1,999.50" and
  // "1,999.5" are written differently on purpose.
  it('keeps a real fraction exactly as stored', () => {
    expect(formatDecimalDisplay('1999.50')).toBe('1,999.50');
    expect(formatDecimalDisplay('1999.5')).toBe('1,999.5');
    expect(formatDecimalDisplay('0.05')).toBe('0.05');
    expect(formatDecimalDisplay('5.500')).toBe('5.500');
  });

  it('formats zero as zero', () => {
    expect(formatDecimalDisplay('0')).toBe('0');
    expect(formatDecimalDisplay('0.00')).toBe('0');
  });

  it('groups only from the fourth digit', () => {
    expect(formatDecimalDisplay('1')).toBe('1');
    expect(formatDecimalDisplay('999')).toBe('999');
    expect(formatDecimalDisplay('1000')).toBe('1,000');
  });

  // The whole reason this is string work: a double cannot hold these.
  it('preserves values beyond 15 significant digits exactly', () => {
    expect(formatDecimalDisplay('9007199254740993')).toBe('9,007,199,254,740,993');
    expect(formatDecimalDisplay('123456789012345678901234567890.123456789'))
      .toBe('123,456,789,012,345,678,901,234,567,890.123456789');
    // Round-trip: stripping the separators must give the digits back unchanged.
    const raw = '9007199254740993.000000000000001';
    expect(formatDecimalDisplay(raw).replace(/,/g, '')).toBe(raw);
  });

  it('normalises redundant leading zeroes without losing a real one', () => {
    expect(formatDecimalDisplay('007')).toBe('7');
    expect(formatDecimalDisplay('0.5')).toBe('0.5');
  });

  it('returns anything that is not an unsigned exact decimal untouched', () => {
    expect(formatDecimalDisplay('-1')).toBe('-1');
    expect(formatDecimalDisplay('1e3')).toBe('1e3');
    expect(formatDecimalDisplay('')).toBe('');
    expect(formatDecimalDisplay('abc')).toBe('abc');
  });

  it('uses the separators of the active locale rather than hardcoded ones', () => {
    const fr = decimalSeparatorsFor('fr');
    expect(formatDecimalDisplay('1999.50', 'fr'))
      .toBe(`1${fr.group}999${fr.decimal}50`);
    // French does not group with a comma or point with a period.
    expect(formatDecimalDisplay('1999.50', 'fr')).not.toBe('1,999.50');
    expect(formatDecimalDisplay('1999.50', 'en')).toBe('1,999.50');
  });
});
