import { describe, expect, it } from 'vitest';
import {
  PackMathError,
  addMoney,
  compareDecimal,
  formatFixed,
  formatPackQuantity,
  formatScaled,
  multiplyExactDecimal,
  multiplyMoney,
  packRate,
  packsToBase,
  parseScaled,
  splitBaseQuantity,
} from './packMath';

describe('packMath (Appendix B exact specification)', () => {
  describe('parseScaled and formatScaled', () => {
    it('parses valid decimals into scaled BigInt', () => {
      expect(parseScaled('12', 2)).toBe(1200n);
      expect(parseScaled('12.5', 2)).toBe(1250n);
      expect(parseScaled('0', 6)).toBe(0n);
    });

    it('throws TOO_MANY_DECIMALS on extra fractional digits', () => {
      expect(() => parseScaled('1.2345', 3)).toThrowError(PackMathError);
      try {
        parseScaled('1.2345', 3);
      } catch (err) {
        expect((err as PackMathError).code).toBe('TOO_MANY_DECIMALS');
      }
    });

    it('throws INVALID_NUMBER on negative or non-digits', () => {
      expect(() => parseScaled('-1', 2)).toThrowError(PackMathError);
      try {
        parseScaled('-1', 2);
      } catch (err) {
        expect((err as PackMathError).code).toBe('INVALID_NUMBER');
      }

      expect(() => parseScaled('abc', 2)).toThrowError(PackMathError);
    });

    it('formats scaled BigInt with trailing zeros removed', () => {
      expect(formatScaled(12000000n, 6)).toBe('12');
      expect(formatScaled(12500000n, 6)).toBe('12.5');
      expect(formatScaled(0n, 6)).toBe('0');
      expect(formatScaled(2n, 0)).toBe('2');
    });

    it('formats fixed BigInt with exact scale places', () => {
      expect(formatFixed(105000n, 2)).toBe('1050.00');
      expect(formatFixed(1250n, 0)).toBe('1250');
      expect(formatFixed(0n, 2)).toBe('0.00');
    });
  });

  describe('splitBaseQuantity', () => {
    it('splits base quantities correctly across test vectors', () => {
      expect(splitBaseQuantity('29', '12')).toEqual({ packs: '2', rest: '5' });
      expect(splitBaseQuantity('12.000', '12.000000')).toEqual({ packs: '1', rest: '0' });
      expect(splitBaseQuantity('11', '12')).toEqual({ packs: '0', rest: '11' });
      expect(splitBaseQuantity('60.5', '25')).toEqual({ packs: '2', rest: '10.5' });
    });

    it('throws ZERO_FACTOR on factor 0', () => {
      expect(() => splitBaseQuantity('10', '0')).toThrowError(PackMathError);
      try {
        splitBaseQuantity('10', '0');
      } catch (err) {
        expect((err as PackMathError).code).toBe('ZERO_FACTOR');
      }
    });
  });

  describe('packsToBase', () => {
    it('converts pack and extra quantity to base', () => {
      expect(packsToBase('3', '12', '4')).toBe('40');
      expect(packsToBase('2', '25', '10.5')).toBe('60.5');
      expect(packsToBase('0', '12', '5')).toBe('5');
    });
  });

  describe('packRate', () => {
    it('computes unit pack rates matching SQL _pack_rate exactly', () => {
      expect(packRate('15000.00', '12', 0)).toBe('1250');
      expect(packRate('9000.00', '7', 0)).toBe('1286');
      expect(packRate('9006.00', '12', 0)).toBe('751');
      expect(packRate('7500.00', '7', 2)).toBe('1071.43');
      expect(packRate('12600.00', '12', 2)).toBe('1050.00');
    });
  });

  describe('multiplyMoney', () => {
    it('multiplies quantity by price with half-up rounding', () => {
      expect(multiplyMoney('5', '1250')).toBe('6250.00');
      expect(multiplyMoney('12.5', '800')).toBe('10000.00');
      expect(multiplyMoney('3', '1071.43')).toBe('3214.29');
      expect(multiplyMoney('0.333', '10.00')).toBe('3.33');
    });
  });

  describe('addMoney and compareDecimal', () => {
    it('adds money amounts exactly', () => {
      expect(addMoney('1050.00', '250.50')).toBe('1300.50');
      expect(addMoney('0.00', '12.34')).toBe('12.34');
    });

    it('compares decimals', () => {
      expect(compareDecimal('12', '12.000')).toBe(0);
      expect(compareDecimal('12.001', '12')).toBe(1);
      expect(compareDecimal('11.999', '12')).toBe(-1);
    });
  });

  describe('formatPackQuantity', () => {
    it('formats stock into X Pack + Y Base representations', () => {
      expect(
        formatPackQuantity('29', { unitName: 'Carton', factor: '12' }, 'Unit')
      ).toBe('2 Carton + 5 Unit');

      expect(
        formatPackQuantity('24', { unitName: 'Carton', factor: '12' }, 'Unit')
      ).toBe('2 Carton');

      expect(
        formatPackQuantity('11', { unitName: 'Carton', factor: '12' }, 'Unit')
      ).toBe('11 Unit');

      expect(
        formatPackQuantity('0', { unitName: 'Carton', factor: '12' }, 'Unit')
      ).toBe('0 Unit');

      expect(
        formatPackQuantity('60.5', { unitName: 'Sac', factor: '25' }, 'Kilogram')
      ).toBe('2 Sac + 10.5 Kilogram');

      expect(formatPackQuantity('7', null, 'Unit')).toBe('7 Unit');

      expect(
        formatPackQuantity('7', { unitName: 'Piece', factor: '1' }, 'Unit')
      ).toBe('7 Unit');
    });
  });

  describe('multiplyExactDecimal', () => {
    it('multiplies integer strings accurately without floating point', () => {
      expect(multiplyExactDecimal('1000', '36')).toBe('36000');
      expect(multiplyExactDecimal('0', '36')).toBe('0');
      expect(multiplyExactDecimal('1500', '12')).toBe('18000');
    });

    it('multiplies decimal strings accurately and trims trailing zeros', () => {
      expect(multiplyExactDecimal('1000.00', '36')).toBe('36000');
      expect(multiplyExactDecimal('1000.50', '36')).toBe('36018');
      expect(multiplyExactDecimal('12.5', '3')).toBe('37.5');
      expect(multiplyExactDecimal('0.5', '0.2')).toBe('0.1');
      expect(multiplyExactDecimal('15.25', '4')).toBe('61');
    });

    it('returns empty string for invalid inputs', () => {
      expect(multiplyExactDecimal('', '36')).toBe('');
      expect(multiplyExactDecimal('abc', '36')).toBe('');
      expect(multiplyExactDecimal('-10', '36')).toBe('');
    });
  });
});
