import { describe, it, expect } from 'vitest';
import { addExactMoney, multiplyMoneyByQuantity } from '../src/shared/money/exactMoney';

describe('exactMoney', () => {
  it('adds decimal money strings without binary floating-point drift', () => {
    expect(addExactMoney(['0.10', '0.20'])).toBe('0.30');
  });

  it('multiplies money by an integer quantity exactly', () => {
    expect(multiplyMoneyByQuantity('19.99', 3)).toBe('59.97');
  });

  it('returns 0.00 for an empty array of values', () => {
    expect(addExactMoney([])).toBe('0.00');
  });
});
