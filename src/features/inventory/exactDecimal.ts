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

/**
 * WS-D-10 — display formatting for exact decimals.
 *
 * Owner ruling: "no decimals unless there are some."
 *   "2000"    -> "2,000"
 *   "2000.00" -> "2,000"
 *   "1999.50" -> "1,999.50"
 *   "1999.5"  -> "1,999.5"
 *   "0"       -> "0"
 *
 * The ruling's prose ("strip trailing zeros in the fractional part") and its
 * worked examples disagree: stripping trailing zeros would turn "1999.50" into
 * "1,999.5", but the ruling lists "1,999.50". The examples are the concrete
 * statement of intent and both are satisfiable together by reading the rule as
 * the headline sentence does — show a fractional part only when there IS one:
 * an ALL-ZERO fraction is dropped along with its separator, and any other
 * fraction is kept exactly as stored. That also keeps the display honest for
 * money, where "1,999.50" and "1,999.5" are written differently on purpose.
 *
 * PURELY STRING MANIPULATION. The value is split on '.', trailing zeroes are
 * trimmed from the fraction, and separators are spliced into the integer part
 * with a regex. It never touches Number(), parseFloat(), toLocaleString() or
 * Intl.NumberFormat — each of those routes through an IEEE-754 double and
 * silently loses digits past ~15 significant figures, which is exactly the
 * precision this codebase carries strings around to protect.
 *
 * A value that is not an unsigned exact decimal is returned untouched rather
 * than mangled: fail-visible, matching the other helpers in this file.
 */
export interface DecimalSeparators {
  group: string;
  decimal: string;
}

const FALLBACK_SEPARATORS: DecimalSeparators = { group: ',', decimal: '.' };
const separatorCache = new Map<string, DecimalSeparators>();

/**
 * Which characters this locale groups and points with.
 *
 * Intl is asked about a FIXED LITERAL (11111.1) purely to read the symbols
 * back out of `formatToParts`. No caller's value is ever passed to it, so no
 * stored decimal goes near a double — this only avoids hardcoding ','/'.'
 * for three locales. Cached per locale; falls back to en-style separators if
 * the runtime has no ICU data.
 */
export function decimalSeparatorsFor(locale: string): DecimalSeparators {
  const cached = separatorCache.get(locale);
  if (cached) return cached;

  let separators = FALLBACK_SEPARATORS;
  try {
    const parts = new Intl.NumberFormat(locale).formatToParts(11111.1);
    const group = parts.find((p) => p.type === 'group')?.value;
    const decimal = parts.find((p) => p.type === 'decimal')?.value;
    if (group && decimal) separators = { group, decimal };
  } catch {
    // No ICU data for this locale; the fallback is already correct enough.
  }
  separatorCache.set(locale, separators);
  return separators;
}

export function formatDecimalDisplay(value: string, locale = 'en'): string {
  const trimmed = value.trim();
  if (!EXACT_DECIMAL.test(trimmed)) return value;

  const { group, decimal } = decimalSeparatorsFor(locale);
  const [integerRaw, fractionRaw = ''] = trimmed.split('.');

  // "no decimals unless there are some": an all-zero fraction is no fraction,
  // so it goes and takes the separator with it. Anything else is kept verbatim.
  const fraction = /^0*$/.test(fractionRaw) ? '' : fractionRaw;
  // Keep a single leading zero ("0.5"), discard padding ("007" -> "7").
  const integer = integerRaw.replace(/^0+(?=\d)/, '');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, group);

  return fraction ? `${grouped}${decimal}${fraction}` : grouped;
}
