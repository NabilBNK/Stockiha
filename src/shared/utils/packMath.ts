/**
 * WS-O-1 — Exact pack arithmetic for UI screens and cart calculation (Appendix B).
 *
 * All inputs are non-negative decimal strings; all arithmetic uses BigInt.
 * No floating point arithmetic is used anywhere in this module.
 */

export class PackMathError extends Error {
  readonly code: 'INVALID_NUMBER' | 'TOO_MANY_DECIMALS' | 'ZERO_FACTOR';

  constructor(code: 'INVALID_NUMBER' | 'TOO_MANY_DECIMALS' | 'ZERO_FACTOR', message?: string) {
    super(message ?? code);
    this.name = 'PackMathError';
    this.code = code;
  }
}

/**
 * Parses a non-negative decimal string into a scaled BigInt.
 *
 * @param value String representing a non-negative decimal (e.g. "12", "12.5")
 * @param scale Maximum number of decimal fractional places (e.g. 2 for money, 6 for quantities)
 */
export function parseScaled(value: string, scale: number): bigint {
  const s = value.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw new PackMathError('INVALID_NUMBER');
  }

  const parts = s.split('.');
  const intPart = parts[0] ?? '0';
  const fracPart = parts[1] ?? '';

  if (fracPart.length > scale) {
    throw new PackMathError('TOO_MANY_DECIMALS');
  }

  return BigInt(intPart + fracPart.padEnd(scale, '0'));
}

/**
 * Formats a scaled non-negative BigInt into a plain decimal string with trailing zeros removed.
 */
export function formatScaled(v: bigint, scale: number): string {
  if (scale === 0) {
    return v.toString();
  }

  const s = v.toString();
  const padded = s.padStart(scale + 1, '0');
  const intPart = padded.slice(0, padded.length - scale);
  const fracPart = padded.slice(padded.length - scale);
  const trimmedFrac = fracPart.replace(/0+$/, '');

  return trimmedFrac.length > 0 ? `${intPart}.${trimmedFrac}` : intPart;
}

/**
 * Formats a scaled non-negative BigInt into a plain decimal string with exactly `scale` decimals.
 */
export function formatFixed(v: bigint, scale: number): string {
  if (scale === 0) {
    return v.toString();
  }

  const s = v.toString();
  const padded = s.padStart(scale + 1, '0');
  const intPart = padded.slice(0, padded.length - scale);
  const fracPart = padded.slice(padded.length - scale);

  return `${intPart}.${fracPart}`;
}

/**
 * Splits a base quantity into whole packs and remaining base units.
 */
export function splitBaseQuantity(
  baseQty: string,
  factor: string
): { packs: string; rest: string } {
  const q = parseScaled(baseQty, 6);
  const f = parseScaled(factor, 6);

  if (f === 0n) {
    throw new PackMathError('ZERO_FACTOR');
  }

  const packs = q / f;
  const rest = q - packs * f;

  return {
    packs: formatScaled(packs, 0),
    rest: formatScaled(rest, 6),
  };
}

/**
 * Converts pack quantity and extra base quantity to total base quantity.
 */
export function packsToBase(packQty: string, factor: string, extra: string): string {
  const p = parseScaled(packQty, 0);
  const f = parseScaled(factor, 6);
  const e = parseScaled(extra, 6);

  return formatScaled(p * f + e, 6);
}

/**
 * Computes unit pack rate from pack amount and conversion factor, rounded half-up.
 */
export function packRate(amount: string, factor: string, scale: 0 | 2): string {
  const a = parseScaled(amount, 2);
  const f = parseScaled(factor, 6);

  if (f === 0n) {
    throw new PackMathError('ZERO_FACTOR');
  }

  const num = a * 10n ** BigInt(6 + scale);
  const den = f * 100n;
  const r = (2n * num + den) / (2n * den);

  return formatFixed(r, scale);
}

/**
 * Multiplies quantity (scale 3) by price (scale 2), rounding half-up to scale 2.
 */
export function multiplyMoney(qty: string, price: string): string {
  const p = parseScaled(qty, 3) * parseScaled(price, 2);
  const r = (p + 500n) / 1000n;

  return formatFixed(r, 2);
}

/**
 * Adds two monetary amounts at scale 2.
 */
export function addMoney(a: string, b: string): string {
  return formatFixed(parseScaled(a, 2) + parseScaled(b, 2), 2);
}

/**
 * Multiplies two non-negative decimal strings exactly using BigInt (no floating point).
 * Trailing zeros in the fractional part are trimmed.
 */
export function multiplyExactDecimal(a: string, b: string): string {
  const sA = a.trim();
  const sB = b.trim();
  if (!/^\d+(\.\d+)?$/.test(sA) || !/^\d+(\.\d+)?$/.test(sB)) {
    return '';
  }
  const [intA, fracA = ''] = sA.split('.');
  const [intB, fracB = ''] = sB.split('.');
  const scale = fracA.length + fracB.length;
  const bigA = BigInt(`${intA}${fracA}`);
  const bigB = BigInt(`${intB}${fracB}`);
  const product = bigA * bigB;
  if (scale === 0) return product.toString();
  const str = product.toString().padStart(scale + 1, '0');
  const intPart = str.slice(0, str.length - scale);
  const fracPart = str.slice(str.length - scale).replace(/0+$/, '');
  return fracPart ? `${intPart}.${fracPart}` : intPart;
}

/**
 * Compares two decimal strings at scale 6.
 */
export function compareDecimal(a: string, b: string): -1 | 0 | 1 {
  const diff = parseScaled(a, 6) - parseScaled(b, 6);
  if (diff < 0n) return -1;
  if (diff > 0n) return 1;
  return 0;
}

/**
 * Formats stock or quantity into "X Pack + Y Base" display representation.
 */
export function formatPackQuantity(
  baseQty: string,
  pack: { unitName: string; factor: string } | null,
  baseUnitName: string
): string {
  if (!pack || compareDecimal(pack.factor, '1') <= 0) {
    const qty = formatScaled(parseScaled(baseQty, 6), 6);
    return baseUnitName ? `${qty} ${baseUnitName}` : qty;
  }

  const { packs, rest } = splitBaseQuantity(baseQty, pack.factor);

  if (packs === '0') {
    return baseUnitName ? `${rest} ${baseUnitName}` : rest;
  }
  if (rest === '0') {
    return `${packs} ${pack.unitName}`;
  }
  return `${packs} ${pack.unitName} + ${baseUnitName ? `${rest} ${baseUnitName}` : rest}`;
}

export { formatExactDecimal } from '../../features/inventory/exactDecimal';
