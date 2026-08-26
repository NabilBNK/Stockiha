import { describe, expect, it } from 'vitest';

import fixture from './fixtures/wsg-normalized-descriptions.json';
import {
  SUGGESTION_MAX_DISTANCE,
  boundedLevenshtein,
  formatExactDzd,
  numericSkeleton,
  suggestGroupings,
} from '../src/features/onboarding/productMapping';
import type { HistoricalProductMappingRow } from '../src/shared/ipc/onboardingDto';

/**
 * The fixture is the real thing: every distinct NORMALIZED description in
 * `docs/test-data/Stockiha_Historical_TEST_DATASET.xlsx` after it has been
 * staged through the production import path, with the normalization performed
 * by `onboarding.normalize_historical_text` in PostgreSQL — the only place
 * normalization exists.
 */
interface FixtureRow {
  normalizedKey: string;
  occurrenceCount: number;
  appearsInBuy: boolean;
  appearsInSell: boolean;
  rawVariantCount: number;
}

const rows: HistoricalProductMappingRow[] = (fixture as FixtureRow[]).map((row) => ({
  normalizedKey: row.normalizedKey,
  canonicalKey: row.normalizedKey,
  decision: null,
  isResolved: false,
  displayProductName: row.normalizedKey.split('|')[0] || null,
  displayBrand: row.normalizedKey.split('|')[1] || null,
  displayCustomDetails: row.normalizedKey.split('|')[2] || null,
  rawVariants: Array.from({ length: row.rawVariantCount }, () => ({
    productName: row.normalizedKey.split('|')[0] || null,
    brand: row.normalizedKey.split('|')[1] || null,
    customDetails: row.normalizedKey.split('|')[2] || null,
  })),
  occurrenceCount: row.occurrenceCount,
  buyLineCount: row.appearsInBuy ? 1 : 0,
  sellLineCount: row.appearsInSell ? 1 : 0,
  appearsInBuy: row.appearsInBuy,
  appearsInSell: row.appearsInSell,
  totalQuantity: '0',
  sellQuantity: '0',
  totalValueDzd: '0',
  buyValueDzd: '0',
  sellValueDzd: '0',
  hasCostSource: row.appearsInBuy,
  firstSourceRow: 2,
}));

function fuzzyPairs(): Array<[string, string]> {
  return suggestGroupings(rows)
    .filter((item) => item.kind === 'FUZZY')
    .map((item) => [item.normalizedKey, item.suggestedCanonicalKey]);
}

describe('WS-G product mapping — suggestion engine', () => {
  it('describes the fixture the suggestions are measured against', () => {
    expect(rows).toHaveLength(89);
    // 76 sold spellings BEFORE any merge is confirmed. The oracle's 72 is the
    // count AFTER the confirmed merges collapse the four sold misspellings.
    expect(rows.filter((row) => row.appearsInSell)).toHaveLength(76);
    expect(rows.filter((row) => row.appearsInSell && !row.hasCostSource)).toHaveLength(4);
  });

  it('finds every near-miss spelling the oracle injected, at distance 1', () => {
    const pairs = fuzzyPairs();
    // Five of the seven injected near-misses survive normalization as a
    // distinct key and must therefore be PROPOSED. The other two (`1 P` for
    // `1p` on bouti|dolz and bouti|rozana) are pure formatting and were
    // already unified by normalization — see the test below.
    for (const [source, target] of [
      ['bouti|ak home|istambul 2p', 'bouti|ak home|istanbul 2p'],
      ['couete|ak home|istanbul', 'couette|ak home|istanbul'],
      ['couete|ak home|uni 1p', 'couette|ak home|uni 1p'],
      ['couete||blanc 2.4', 'couette||blanc 2.4'],
    ] as const) {
      expect(pairs, `${source} must be proposed as ${target}`).toContainEqual([source, target]);
    }

    // `pillow couver|rozana|` and `pillow cover|rozana|` are proposed as one
    // group. Both appear on Buy lines, so the direction is decided on how
    // often each spelling was written — the administrator can reverse it.
    const pillow = pairs.find(
      ([source, target]) =>
        [source, target].includes('pillow couver|rozana|') &&
        [source, target].includes('pillow cover|rozana|'),
    );
    expect(pillow).toBeDefined();
  });

  it('also proposes the real transcription typo the customer made himself', () => {
    // `iatanbul` is NOT one of the seven injected near-misses: it is a genuine
    // typo in the customer's own purchase data (`couette|AK home|iatanbul 1p`).
    // It appears on Buy lines only, so leaving it apart splits one article's
    // cost pool in two. The oracle counts it as the eighth confirmed merge.
    expect(fuzzyPairs()).toContainEqual([
      'couette|ak home|iatanbul 1p',
      'couette|ak home|istanbul 1p',
    ]);
  });

  it('proposes exactly the eight merges the oracle confirms', () => {
    const pairs = fuzzyPairs();
    // Six FUZZY proposals cover six of the eight; the remaining two (`1 P` for
    // `1p`) needed no proposal because normalization already unified them.
    expect(pairs).toHaveLength(6);
    const unified = suggestGroupings(rows)
      .filter((item) => item.kind === 'NORMALIZED_IDENTICAL')
      .map((item) => item.normalizedKey);
    expect(unified).toContain('bouti|dolz|1p');
    expect(unified).toContain('bouti|rozana|1p');
  });

  it('leaves exactly four sold descriptions without a cost source before merging', () => {
    // These four are the whole reason the mapping screen exists: each is a
    // misspelling that never appears on a Buy line, so its cost is unknown and
    // the entire sale price would be reported as profit. Confirming the merges
    // must take this count to zero — oracle criterion 11.
    const orphans = rows
      .filter((row) => row.appearsInSell && !row.hasCostSource)
      .map((row) => row.normalizedKey)
      .sort();
    expect(orphans).toEqual(
      [
        'bouti|ak home|istambul 2p',
        'couete|ak home|istanbul',
        'couete|ak home|uni 1p',
        'couete||blanc 2.4',
      ].sort(),
    );

    // Every one of them is covered by a proposal, so the screen can actually
    // resolve all four.
    const proposed = new Set(fuzzyPairs().map(([source]) => source));
    for (const orphan of orphans) expect(proposed.has(orphan)).toBe(true);
  });

  it('reports the two pure-formatting near-misses as already unified', () => {
    const unified = suggestGroupings(rows)
      .filter((item) => item.kind === 'NORMALIZED_IDENTICAL')
      .map((item) => item.normalizedKey);
    expect(unified).toContain('bouti|dolz|1p');
    expect(unified).toContain('bouti|rozana|1p');
  });

  it('never proposes two different sizes as the same article', () => {
    const pairs = fuzzyPairs();
    for (const [left, right] of [
      ['couette|ak home|1p', 'couette|ak home|2p'],
      ['drap housse|ak home|1.6', 'drap housse|ak home|1.8'],
      ['couette||blanc 2.4', 'couette||blanc 2.6'],
      ['couvre lit|ak home|bossoft 3p', 'couvre lit|ak home|bossoft 4p'],
    ] as const) {
      expect(pairs).not.toContainEqual([left, right]);
      expect(pairs).not.toContainEqual([right, left]);
      expect(numericSkeleton(left)).not.toEqual(numericSkeleton(right));
    }
  });

  it('never proposes two genuinely different products as the same article', () => {
    const pairs = fuzzyPairs();
    for (const [left, right] of [
      ['couvre lit|ak home|bossoft', 'couette|ak home|bossoft'],
      ['drap|ak home|1p', 'drap housse|ak home|1p'],
      ['pillow|ak home|colored', 'pillow|rozana|rolored'],
      ['pillow cover|dolz|', 'pillow cover|rozana|'],
    ] as const) {
      expect(pairs).not.toContainEqual([left, right]);
      expect(pairs).not.toContainEqual([right, left]);
    }
  });

  it('keeps the proposal list small enough for a human to read', () => {
    // Suggestions only earn their place if the administrator can actually
    // review each one. A noisy list would be rubber-stamped.
    expect(fuzzyPairs().length).toBeLessThanOrEqual(10);
  });

  it('is deterministic: the same input always yields the same proposals', () => {
    const first = JSON.stringify(suggestGroupings(rows));
    const reversed = JSON.stringify(suggestGroupings([...rows].reverse()));
    expect(reversed).toBe(first);
  });

  it('extracts the numeric skeleton that guards the matcher', () => {
    expect(numericSkeleton('drap|ak home|1p 0.9')).toEqual(['1p', '0.9']);
    expect(numericSkeleton('couette|ak home|istanbul 2p')).toEqual(['2p']);
    expect(numericSkeleton('pillow cover|rozana|')).toEqual([]);
  });

  it('measures edit distance exactly, with an early cutoff', () => {
    expect(boundedLevenshtein('couette', 'couete', 2)).toBe(1);
    expect(boundedLevenshtein('istanbul', 'istambul', 2)).toBe(1);
    expect(boundedLevenshtein('pillow cover', 'pillow couver', 2)).toBe(1);
    expect(boundedLevenshtein('couette', 'couvre lit', 2)).toBeGreaterThan(
      SUGGESTION_MAX_DISTANCE,
    );
    expect(boundedLevenshtein('abc', 'abc', 2)).toBe(0);
  });

  it('formats exact decimal money without turning it into a number', () => {
    // French typography: thousands are grouped with U+202F, not a plain space.
    expect(formatExactDzd('19880510')).toBe('19\u202f880\u202f510');
    expect(formatExactDzd('0')).toBe('0');
    expect(formatExactDzd('-500')).toBe('-500');
    // 21 digits: further than a JavaScript number can count exactly.
    expect(formatExactDzd('123456789012345678901')).toBe(
      '123\u202f456\u202f789\u202f012\u202f345\u202f678\u202f901',
    );
  });
});
