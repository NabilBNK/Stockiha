import { describe, expect, it } from 'vitest';
import { normalizeDecimalInput, validatePackForm } from './packValidation';

describe('normalizeDecimalInput (WS-O-2.1)', () => {
  it('handles the six specified examples and edge cases', () => {
    expect(normalizeDecimalInput('12,5')).toBe('12.5');
    expect(normalizeDecimalInput(' 15000 ')).toBe('15000');
    expect(normalizeDecimalInput('1 500')).toBeNull();
    expect(normalizeDecimalInput('-3')).toBeNull();
    expect(normalizeDecimalInput('1.2.3')).toBeNull();
    expect(normalizeDecimalInput('')).toBeNull();
  });

  it('rejects multiple commas or invalid decimal formatting', () => {
    expect(normalizeDecimalInput('12,5,3')).toBeNull();
    expect(normalizeDecimalInput('abc')).toBeNull();
    expect(normalizeDecimalInput('12.')).toBeNull();
    expect(normalizeDecimalInput('.5')).toBeNull();
    expect(normalizeDecimalInput('   ')).toBeNull();
  });

  it('accepts zero and valid integer and decimal values', () => {
    expect(normalizeDecimalInput('0')).toBe('0');
    expect(normalizeDecimalInput('0.5')).toBe('0.5');
    expect(normalizeDecimalInput('0,75')).toBe('0.75');
    expect(normalizeDecimalInput('100.000000')).toBe('100.000000');
  });
});

describe('validatePackForm (WS-O-2.1)', () => {
  const baseCtx = {
    baseUnitId: 1,
    baseIsWhole: true,
    usedUnitIds: [2],
    factorLocked: false,
  };

  it('validates unit: required, base, and duplicate', () => {
    // Unit required
    const err1 = validatePackForm(
      { unitId: null, factorText: '12', priceText: '', barcodeText: '' },
      baseCtx
    );
    expect(err1.unitId).toBe('pack.error.unitRequired');

    // Unit is base
    const err2 = validatePackForm(
      { unitId: 1, factorText: '12', priceText: '', barcodeText: '' },
      baseCtx
    );
    expect(err2.unitId).toBe('pack.error.unitIsBase');

    // Unit already used
    const err3 = validatePackForm(
      { unitId: 2, factorText: '12', priceText: '', barcodeText: '' },
      baseCtx
    );
    expect(err3.unitId).toBe('pack.error.unitAlreadyUsed');

    // Valid unused unit
    const err4 = validatePackForm(
      { unitId: 3, factorText: '12', priceText: '', barcodeText: '' },
      baseCtx
    );
    expect(err4.unitId).toBeUndefined();
  });

  it('validates factor: required, invalid, range, decimals, and whole rules', () => {
    // Factor required
    expect(
      validatePackForm({ unitId: 3, factorText: '', priceText: '', barcodeText: '' }, baseCtx).factor
    ).toBe('pack.error.factorRequired');
    expect(
      validatePackForm({ unitId: 3, factorText: '   ', priceText: '', barcodeText: '' }, baseCtx).factor
    ).toBe('pack.error.factorRequired');

    // Factor invalid
    expect(
      validatePackForm({ unitId: 3, factorText: 'abc', priceText: '', barcodeText: '' }, baseCtx).factor
    ).toBe('pack.error.factorInvalid');
    expect(
      validatePackForm({ unitId: 3, factorText: '1.2.3', priceText: '', barcodeText: '' }, baseCtx).factor
    ).toBe('pack.error.factorInvalid');

    // Factor too small (<= 1)
    expect(
      validatePackForm({ unitId: 3, factorText: '1', priceText: '', barcodeText: '' }, baseCtx).factor
    ).toBe('pack.error.factorTooSmall');
    expect(
      validatePackForm({ unitId: 3, factorText: '1.000000', priceText: '', barcodeText: '' }, baseCtx).factor
    ).toBe('pack.error.factorTooSmall');
    expect(
      validatePackForm({ unitId: 3, factorText: '0.5', priceText: '', barcodeText: '' }, baseCtx).factor
    ).toBe('pack.error.factorTooSmall');

    // Factor too large (> 100000)
    expect(
      validatePackForm({ unitId: 3, factorText: '100001', priceText: '', barcodeText: '' }, baseCtx).factor
    ).toBe('pack.error.factorTooLarge');
    expect(
      validatePackForm({ unitId: 3, factorText: '100000.1', priceText: '', barcodeText: '' }, baseCtx).factor
    ).toBe('pack.error.factorTooLarge');

    // More than 6 decimals
    expect(
      validatePackForm({ unitId: 3, factorText: '12.1234567', priceText: '', barcodeText: '' }, baseCtx).factor
    ).toBe('pack.error.factorDecimals');

    // Not whole while baseIsWhole
    expect(
      validatePackForm({ unitId: 3, factorText: '12.5', priceText: '', barcodeText: '' }, baseCtx).factor
    ).toBe('pack.error.factorWhole');
    expect(
      validatePackForm({ unitId: 3, factorText: '12,5', priceText: '', barcodeText: '' }, baseCtx).factor
    ).toBe('pack.error.factorWhole');

    // Whole when baseIsWhole
    expect(
      validatePackForm({ unitId: 3, factorText: '12', priceText: '', barcodeText: '' }, baseCtx).factor
    ).toBeUndefined();
    expect(
      validatePackForm({ unitId: 3, factorText: '12.000000', priceText: '', barcodeText: '' }, baseCtx).factor
    ).toBeUndefined();

    // Fractional allowed when baseIsWhole is false
    expect(
      validatePackForm(
        { unitId: 3, factorText: '12.5', priceText: '', barcodeText: '' },
        { ...baseCtx, baseIsWhole: false }
      ).factor
    ).toBeUndefined();
  });

  it('skips factor validation when factorLocked is true', () => {
    const err = validatePackForm(
      { unitId: 3, factorText: 'invalid_factor', priceText: '15000', barcodeText: '' },
      { ...baseCtx, factorLocked: true }
    );
    expect(err.factor).toBeUndefined();
  });

  it('validates price: optional, max 2 decimals, max amount', () => {
    // Empty price is valid
    expect(
      validatePackForm({ unitId: 3, factorText: '12', priceText: '', barcodeText: '' }, baseCtx).price
    ).toBeUndefined();
    expect(
      validatePackForm({ unitId: 3, factorText: '12', priceText: '   ', barcodeText: '' }, baseCtx).price
    ).toBeUndefined();

    // Valid price
    expect(
      validatePackForm({ unitId: 3, factorText: '12', priceText: '15000', barcodeText: '' }, baseCtx).price
    ).toBeUndefined();
    expect(
      validatePackForm({ unitId: 3, factorText: '12', priceText: '15000.50', barcodeText: '' }, baseCtx).price
    ).toBeUndefined();
    expect(
      validatePackForm({ unitId: 3, factorText: '12', priceText: '15000,50', barcodeText: '' }, baseCtx).price
    ).toBeUndefined();
    expect(
      validatePackForm({ unitId: 3, factorText: '12', priceText: '0', barcodeText: '' }, baseCtx).price
    ).toBeUndefined();

    // Invalid price
    expect(
      validatePackForm({ unitId: 3, factorText: '12', priceText: 'abc', barcodeText: '' }, baseCtx).price
    ).toBe('pack.error.priceInvalid');
    expect(
      validatePackForm({ unitId: 3, factorText: '12', priceText: '15000.555', barcodeText: '' }, baseCtx).price
    ).toBe('pack.error.priceInvalid');
    expect(
      validatePackForm({ unitId: 3, factorText: '12', priceText: '-10', barcodeText: '' }, baseCtx).price
    ).toBe('pack.error.priceInvalid');
  });

  it('validates barcode: optional, rejects whitespace-only string', () => {
    // Empty barcode is valid
    expect(
      validatePackForm({ unitId: 3, factorText: '12', priceText: '15000', barcodeText: '' }, baseCtx).barcode
    ).toBeUndefined();

    // Whitespace-only barcode is invalid
    expect(
      validatePackForm({ unitId: 3, factorText: '12', priceText: '15000', barcodeText: '   ' }, baseCtx).barcode
    ).toBe('pack.error.barcodeBlank');

    // Non-empty barcode is valid
    expect(
      validatePackForm(
        { unitId: 3, factorText: '12', priceText: '15000', barcodeText: ' 6131000000021 ' },
        baseCtx
      ).barcode
    ).toBeUndefined();
  });

  it('returns empty errors object when all inputs are valid', () => {
    const err = validatePackForm(
      { unitId: 3, factorText: '12', priceText: '15000', barcodeText: '6131000000021' },
      baseCtx
    );
    expect(Object.keys(err)).toHaveLength(0);
  });
});
