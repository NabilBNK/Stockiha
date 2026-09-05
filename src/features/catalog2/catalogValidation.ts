/**
 * WS-D-9B — the two value shapes this page validates, in one place.
 *
 * Both are EXACT DECIMAL STRINGS and are checked as strings. Nothing here
 * parses, rounds, or does arithmetic on them (ws-d-skill.md section 6). The
 * same shapes VariantForm uses on the existing products page, so a value
 * accepted on one screen is accepted on the other.
 *
 * "0" is a valid minimum stock and a meaningful one — it means "never warn me
 * about this item" — so it must pass, not be treated as blank.
 */
export const PRICE_RE = /^\d+(\.\d{1,2})?$/;
export const MIN_STOCK_RE = /^\d+(?:\.\d+)?$/;

export function isValidPrice(value: string): boolean {
  return PRICE_RE.test(value);
}

export function isValidMinimumStock(value: string): boolean {
  return MIN_STOCK_RE.test(value);
}
