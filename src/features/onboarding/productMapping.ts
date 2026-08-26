import type {
  HistoricalProductMappingRow,
  HistoricalProductMappingSuggestion,
} from '../../shared/ipc/onboardingDto';

/**
 * WS-G product mapping — suggestion engine.
 *
 * PostgreSQL is the authority. It normalizes every transcribed description and
 * it stores every confirmed alias. This module never normalizes anything and
 * never writes anything: it only measures how close two ALREADY normalized
 * keys are, so the review screen can propose groupings the administrator then
 * confirms one by one.
 *
 * A silent auto-merge of two genuinely different products would corrupt cost
 * and is worse than no matching at all, so nothing here decides anything.
 */

/**
 * Maximum Levenshtein distance between two normalized keys for the pair to be
 * offered as a possible grouping. One typed letter wrong is distance 1; the
 * seven near-misses in the customer fixture are all distance 1. Two is the
 * ceiling: beyond that the two descriptions are far more likely to be two real
 * products than one product typed twice.
 */
export const SUGGESTION_MAX_DISTANCE = 2;

/**
 * Below this length a distance of 2 would rewrite most of the text, so short
 * keys are never fuzzily matched.
 */
export const SUGGESTION_MIN_KEY_LENGTH = 6;

/**
 * The ordered list of size/quantity tokens inside a normalized key: a bare
 * number (`1.6`, `2.4`) or a number carrying a place suffix (`1p`, `2p`, `3d`).
 *
 * Two descriptions whose numbers differ are two different SIZES, never a
 * spelling mistake — `couette|ak home|1p` and `couette|ak home|2p` are one
 * character apart and are genuinely different products. Requiring an identical
 * numeric skeleton is what keeps the suggestion list trustworthy.
 */
export function numericSkeleton(normalizedKey: string): string[] {
  const tokens = normalizedKey.split(/[|\s]+/).filter((token) => token !== '');
  return tokens.filter((token) => /^\d+(\.\d+)?$/.test(token) || /^\d+[a-z]$/.test(token));
}

function sameSkeleton(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

/**
 * Levenshtein distance, abandoned as soon as every cell of a row exceeds
 * `limit`. Pure and deterministic.
 */
export function boundedLevenshtein(left: string, right: string, limit: number): number {
  if (left === right) return 0;
  if (Math.abs(left.length - right.length) > limit) return limit + 1;

  const previous = new Array<number>(right.length + 1);
  const current = new Array<number>(right.length + 1);
  for (let column = 0; column <= right.length; column += 1) previous[column] = column;

  for (let row = 1; row <= left.length; row += 1) {
    current[0] = row;
    let best = current[0];
    for (let column = 1; column <= right.length; column += 1) {
      const substitution = previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1);
      const deletion = previous[column] + 1;
      const insertion = current[column - 1] + 1;
      current[column] = Math.min(substitution, deletion, insertion);
      if (current[column] < best) best = current[column];
    }
    if (best > limit) return limit + 1;
    for (let column = 0; column <= right.length; column += 1) previous[column] = current[column];
  }

  return previous[right.length];
}

/**
 * Which of two descriptions is the more credible spelling of the pair.
 *
 * A description that appears on Buy lines carries a cost and is therefore the
 * useful target; otherwise the one written more often wins; a tie is broken on
 * the key itself so the result never depends on row order. This only chooses
 * which way round to PROPOSE the grouping — the administrator can reverse it.
 */
function preferAsCanonical(
  left: HistoricalProductMappingRow,
  right: HistoricalProductMappingRow,
): boolean {
  if (left.appearsInBuy !== right.appearsInBuy) return left.appearsInBuy;
  if (left.occurrenceCount !== right.occurrenceCount) {
    return left.occurrenceCount > right.occurrenceCount;
  }
  return left.normalizedKey < right.normalizedKey;
}

/**
 * Proposes groupings over the normalized keys PostgreSQL returned.
 *
 * Two kinds come back:
 *   - `NORMALIZED_IDENTICAL` — several raw spellings that normalization alone
 *     already resolved to one key. Informational: nothing to confirm, the
 *     spellings are already counted together.
 *   - `FUZZY` — two distinct normalized keys close enough to be the same
 *     product typed twice. Requires an explicit confirmation before it has any
 *     effect on anything.
 */
export function suggestGroupings(
  rows: readonly HistoricalProductMappingRow[],
): HistoricalProductMappingSuggestion[] {
  const suggestions: HistoricalProductMappingSuggestion[] = [];

  for (const row of rows) {
    if (row.rawVariants.length > 1) {
      suggestions.push({
        kind: 'NORMALIZED_IDENTICAL',
        normalizedKey: row.normalizedKey,
        suggestedCanonicalKey: row.normalizedKey,
        distance: 0,
        rawVariants: row.rawVariants,
      });
    }
  }

  const skeletons = new Map<string, string[]>();
  for (const row of rows) skeletons.set(row.normalizedKey, numericSkeleton(row.normalizedKey));

  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const left = rows[i];
      const right = rows[j];
      if (
        left.normalizedKey.length < SUGGESTION_MIN_KEY_LENGTH ||
        right.normalizedKey.length < SUGGESTION_MIN_KEY_LENGTH
      ) {
        continue;
      }
      if (
        !sameSkeleton(
          skeletons.get(left.normalizedKey) ?? [],
          skeletons.get(right.normalizedKey) ?? [],
        )
      ) {
        continue;
      }

      const distance = boundedLevenshtein(
        left.normalizedKey,
        right.normalizedKey,
        SUGGESTION_MAX_DISTANCE,
      );
      if (distance === 0 || distance > SUGGESTION_MAX_DISTANCE) continue;

      const leftIsCanonical = preferAsCanonical(left, right);
      const source = leftIsCanonical ? right : left;
      const target = leftIsCanonical ? left : right;

      suggestions.push({
        kind: 'FUZZY',
        normalizedKey: source.normalizedKey,
        suggestedCanonicalKey: target.normalizedKey,
        distance,
        rawVariants: source.rawVariants,
      });
    }
  }

  // Deterministic order: the closest, then alphabetically. Never row order.
  return suggestions.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'FUZZY' ? -1 : 1;
    if (left.distance !== right.distance) return left.distance - right.distance;
    if (left.normalizedKey !== right.normalizedKey) {
      return left.normalizedKey < right.normalizedKey ? -1 : 1;
    }
    return left.suggestedCanonicalKey < right.suggestedCanonicalKey ? -1 : 1;
  });
}

/**
 * Formats an exact decimal string for display without ever turning it into a
 * JavaScript number. Money and quantity stay exact text from PostgreSQL to the
 * screen.
 */
export function formatExactDzd(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') return '0';
  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [integerPart, fractionPart] = unsigned.split('.');
  // French typography groups thousands with a narrow no-break space (U+202F).
  const grouped = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f');
  const body = fractionPart ? `${grouped},${fractionPart}` : grouped;
  return negative ? `-${body}` : body;
}

/** The three transcribed fields as the administrator wrote them, for display. */
export function describeRawVariant(variant: {
  productName: string | null;
  brand: string | null;
  customDetails: string | null;
}): string {
  return [variant.productName, variant.brand, variant.customDetails]
    .map((part) => (part === null || part.trim() === '' ? '—' : part))
    .join(' · ');
}
