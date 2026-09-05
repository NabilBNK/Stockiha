export function formatExactDecimal(value: string): string {
  const [integer, fraction = ''] = value.split('.');
  const compactFraction = fraction.replace(/0+$/, '');
  return compactFraction ? `${integer}.${compactFraction}` : integer;
}

const EXACT_DECIMAL = /^\d+(?:\.\d+)?$/;
export function isExactDecimalZero(value: string): boolean { return EXACT_DECIMAL.test(value) && /^0*(?:\.0*)?$/.test(value); }
export function isExactDecimalPositive(value: string): boolean { return EXACT_DECIMAL.test(value) && !isExactDecimalZero(value); }
export function localIsoDate(date = new Date()): string { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }

/**
 * Unsigned exact-decimal comparator (BigInt-scaled, no parseFloat). Both
 * inputs must match EXACT_DECIMAL; a malformed value compares false either
 * way, matching the fail-closed shape of the procurement equivalent in
 * src/features/procurement/procurementDecimal.ts.
 */
export function isDecimalLessThanOrEqual(value: string, limit: string): boolean {
  if (!EXACT_DECIMAL.test(value) || !EXACT_DECIMAL.test(limit)) return false;
  const [va, vf = ''] = value.split('.');
  const [la, lf = ''] = limit.split('.');
  const scale = Math.max(vf.length, lf.length);
  const left = BigInt(`${va}${vf}`) * 10n ** BigInt(scale - vf.length);
  const right = BigInt(`${la}${lf}`) * 10n ** BigInt(scale - lf.length);
  return left <= right;
}

/**
 * Low-stock predicate (ws-d-skill.md section 3, owner-ruled, not to be
 * reinterpreted): low when minimum_stock > 0 AND quantity_on_hand <=
 * minimum_stock. minimum_stock = 0 disables the warning entirely, at any
 * quantity — that is a deliberate meaning, not a default.
 */
export function isLowStock(quantityOnHand: string, minimumStock: string): boolean {
  return isExactDecimalPositive(minimumStock) && isDecimalLessThanOrEqual(quantityOnHand, minimumStock);
}

/**
 * WS-D-9 — exact-decimal summation for display aggregates (a product row's
 * total stock across its variants).
 *
 * BigInt-scaled, never parseFloat, never rounded: the widest scale among the
 * inputs is preserved, trailing zeroes are trimmed the way formatExactDecimal
 * does, and a malformed input contributes nothing rather than NaN. Quantities
 * from `list_products_v2` are unsigned, so this is unsigned by design — the
 * signed equivalent lives in procurementDecimal.ts and belongs to WS-E.
 */
export function sumExactDecimals(values: string[]): string {
  const parsed = values
    .filter((value) => EXACT_DECIMAL.test(value))
    .map((value) => {
      const [integer, fraction = ''] = value.split('.');
      return { units: BigInt(`${integer}${fraction}`), scale: fraction.length };
    });
  if (parsed.length === 0) return '0';
  const scale = Math.max(...parsed.map((item) => item.scale));
  const total = parsed.reduce(
    (sum, item) => sum + item.units * 10n ** BigInt(scale - item.scale),
    0n,
  );
  if (scale === 0) return total.toString();
  const padded = total.toString().padStart(scale + 1, '0');
  const fraction = padded.slice(-scale).replace(/0+$/, '');
  const integer = padded.slice(0, -scale);
  return fraction ? `${integer}.${fraction}` : integer;
}
