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
