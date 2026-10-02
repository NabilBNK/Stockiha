import { describe, it, expect } from 'vitest';
import {
  addExactMoney,
  compareExactMoney,
  isValidMoneyString,
  multiplyMoneyByQuantity,
} from './exactMoney';

describe('exactMoney', () => {
  it('compareExactMoney handles inputs with higher precision (e.g. WAC with 6 decimals) without RangeError', () => {
    // 1400.00 vs 1050.000000 -> 1400.00 > 1050.000000
    expect(compareExactMoney('1400.00', '1050.000000')).toBe(1);
    expect(compareExactMoney('1050.000000', '1400.00')).toBe(-1);
    expect(compareExactMoney('1050.00', '1050.000000')).toBe(0);
    expect(compareExactMoney('1000.00', '1050.000000')).toBe(-1);
  });

  it('compareExactMoney handles differing scales accurately', () => {
    expect(compareExactMoney('10.5', '10.5000')).toBe(0);
    expect(compareExactMoney('10.5001', '10.5')).toBe(1);
    expect(compareExactMoney('10.4999', '10.5')).toBe(-1);
  });

  it('addExactMoney handles inputs with higher scale by rounding half-up to 2 decimals', () => {
    expect(addExactMoney(['100.00', '50.000000'])).toBe('150.00');
    expect(addExactMoney(['10.004', '20.006'])).toBe('30.01'); // 10.00 + 20.01
  });

  it('multiplyMoneyByQuantity handles inputs with extra decimals without crashing', () => {
    expect(multiplyMoneyByQuantity('100.000000', 5)).toBe('500.00');
    expect(multiplyMoneyByQuantity('12.50', 3)).toBe('37.50');
  });

  it('isValidMoneyString accepts only non-negative 2-decimal money strings', () => {
    expect(isValidMoneyString('150.00')).toBe(true);
    expect(isValidMoneyString('0.5')).toBe(true);
    expect(isValidMoneyString('100')).toBe(true);
    expect(isValidMoneyString('-10.00')).toBe(false);
    expect(isValidMoneyString('10.123')).toBe(false);
  });
});
