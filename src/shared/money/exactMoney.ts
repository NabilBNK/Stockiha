/**
 * Exact decimal arithmetic for money shown in the till.
 *
 * The database remains the authority for every posted amount. These helpers
 * exist so the on-screen cart total matches that authority to the centime
 * instead of drifting through binary floating point.
 *
 * Every value in and out is a decimal STRING. Never convert money to a number.
 */

function splitDecimal(value: string): { negative: boolean; digits: string; scale: number } {
  const trimmed = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`exactMoney: not a decimal string: ${value}`);
  }
  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole, fraction = ''] = unsigned.split('.');
  return { negative, digits: `${whole}${fraction}`, scale: fraction.length };
}

function toScaledBigInt(value: string, scale: number): bigint {
  const parts = splitDecimal(value);
  const padded = parts.digits + '0'.repeat(scale - parts.scale);
  const magnitude = BigInt(padded === '' ? '0' : padded);
  return parts.negative ? -magnitude : magnitude;
}

function fromScaledBigInt(value: bigint, scale: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale);
  const fraction = scale === 0 ? '' : `.${digits.slice(digits.length - scale)}`;
  return `${negative ? '-' : ''}${whole}${fraction}`;
}

/** Adds decimal strings exactly. Returns a string with 2 decimal places. */
export function addExactMoney(values: string[]): string {
  const total = values.reduce((sum, value) => sum + toScaledBigInt(value, 2), 0n);
  return fromScaledBigInt(total, 2);
}

/** Multiplies a decimal money string by a whole-number quantity, exactly. */
export function multiplyMoneyByQuantity(amount: string, quantity: number): string {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new Error(`exactMoney: quantity must be a non-negative whole number: ${quantity}`);
  }
  const scaled = toScaledBigInt(amount, 2) * BigInt(quantity);
  return fromScaledBigInt(scaled, 2);
}
