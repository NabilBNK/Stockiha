/**
 * WS-J-1 — programmatic WCAG AA contrast guard for the warm palette tokens
 * in src/styles/global.css. Reads the real `:root` and `[data-theme="dark"]`
 * blocks (not a hardcoded copy of the values) so a future colour tweak that
 * breaks AA fails this suite instead of shipping. See the WS-J-1 report's
 * "Contrast — measured ratios" section for the full table this mirrors.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// Tests run with the repo root as cwd (matching every other file here that
// reads a relative path, e.g. tests/historical-exports.test.ts).
const css = readFileSync('src/styles/global.css', 'utf8');

function extractBlock(selectorRegex: RegExp): string {
  const m = selectorRegex.exec(css);
  if (!m) throw new Error(`block not found for ${selectorRegex}`);
  const start = css.indexOf('{', m.index);
  let depth = 0;
  let i = start;
  for (; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') { depth--; if (depth === 0) break; }
  }
  return css.slice(start, i + 1);
}

function tokens(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /--sk-([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})/g;
  let m;
  while ((m = re.exec(block))) out[m[1]] = m[2];
  return out;
}

const lightBlock = extractBlock(/:root\s*\{/);
const darkBlock = extractBlock(/\[data-theme="dark"\]\s*\{/);
const light = tokens(lightBlock);
const dark = tokens(darkBlock);

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const num = parseInt(h.slice(0, 6), 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function relLum([r, g, b]: [number, number, number]): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const cs = c / 255;
    return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrast(hexA: string, hexB: string): number {
  const l1 = relLum(hexToRgb(hexA));
  const l2 = relLum(hexToRgb(hexB));
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

const AA_BODY = 4.5;
const AA_LARGE = 3.0;
const AA_UI = 3.0;

describe('WS-J-1 — light theme contrast (WCAG AA)', () => {
  it.each([
    ['text on bg', light.text, light.bg, AA_BODY],
    ['text on surface', light.text, light.surface, AA_BODY],
    ['text on surface-soft', light.text, light['surface-soft'], AA_BODY],
    ['text-soft on bg', light['text-soft'], light.bg, AA_BODY],
    ['text-soft on surface', light['text-soft'], light.surface, AA_BODY],
    ['muted on bg', light.muted, light.bg, AA_BODY],
    ['muted on surface', light.muted, light.surface, AA_BODY],
    ['muted on surface-soft (table headers)', light.muted, light['surface-soft'], AA_BODY],
    ['primary on bg (button fill role)', light.primary, light.bg, AA_BODY],
    ['primary on surface (used as text)', light.primary, light.surface, AA_BODY],
    ['primary-contrast on primary (button text)', light['primary-contrast'], light.primary, AA_BODY],
    // WS-J-1.2 — this pair was previously omitted from this list while its
    // dark-theme counterpart was included and its two siblings (danger,
    // warn) were both included: exactly the asymmetry that let #16815d's
    // 4.43:1 failure ship unguarded. Never narrow this list to avoid a
    // known failure again — fix the value, or leave the test red and stop.
    ['ok on ok-soft', light.ok, light['ok-soft'], AA_BODY],
    ['ok-contrast on ok (button text)', light['ok-contrast'], light.ok, AA_BODY],
    ['danger-contrast on danger (button text)', light['danger-contrast'], light.danger, AA_BODY],
    ['nav-text on nav', light['nav-text'], light.nav, AA_BODY],
    ['nav-text-muted on nav', light['nav-text-muted'], light.nav, AA_BODY],
    ['text on primary-soft (active nav item)', light.text, light['primary-soft'], AA_BODY],
    ['danger on danger-soft', light.danger, light['danger-soft'], AA_BODY],
    ['warn on warn-soft', light.warn, light['warn-soft'], AA_BODY],
    ['chart-sales on surface', light['chart-sales'], light.surface, AA_LARGE],
    ['chart-purchases on surface', light['chart-purchases'], light.surface, AA_LARGE],
    ['chart-expenses on surface', light['chart-expenses'], light.surface, AA_LARGE],
    ['chart-benefit on surface', light['chart-benefit'], light.surface, AA_LARGE],
  ])('%s >= %s:1 (measured %s)', (_label, fg, bg, min) => {
    const ratio = contrast(fg, bg);
    expect(ratio).toBeGreaterThanOrEqual(min);
  });

  it('sidebar is a visibly distinct surface step from the page background', () => {
    // Not a text/bg pair — a background-vs-background separation check
    // (DESIGN.md §3.2: "must not be near-identical"). The page's own
    // surface-vs-bg step is the floor: the nav must be at least that
    // distinct, ideally more since it also needs to read as "the darkest
    // tier" at a glance.
    const navVsBg = contrast(light.nav, light.bg);
    const surfaceVsBg = contrast(light.surface, light.bg);
    expect(navVsBg).toBeGreaterThan(surfaceVsBg);
  });
});

describe('WS-J-1 — dark theme contrast (WCAG AA)', () => {
  it.each([
    ['text on bg', dark.text, dark.bg, AA_BODY],
    ['text on surface', dark.text, dark.surface, AA_BODY],
    ['text on surface-soft', dark.text, dark['surface-soft'], AA_BODY],
    ['text-soft on bg', dark['text-soft'], dark.bg, AA_BODY],
    ['text-soft on surface', dark['text-soft'], dark.surface, AA_BODY],
    ['muted on bg', dark.muted, dark.bg, AA_BODY],
    ['muted on surface', dark.muted, dark.surface, AA_BODY],
    ['muted on surface-soft (table headers)', dark.muted, dark['surface-soft'], AA_BODY],
    ['primary on bg (used as text)', dark.primary, dark.bg, AA_BODY],
    ['primary on surface (used as text)', dark.primary, dark.surface, AA_BODY],
    ['primary-contrast on primary (button text)', dark['primary-contrast'], dark.primary, AA_BODY],
    ['ok-contrast on ok (button text)', dark['ok-contrast'], dark.ok, AA_BODY],
    ['danger-contrast on danger (button text)', dark['danger-contrast'], dark.danger, AA_BODY],
    ['nav-text on nav', dark['nav-text'], dark.nav, AA_BODY],
    ['nav-text-muted on nav', dark['nav-text-muted'], dark.nav, AA_BODY],
    ['text on primary-soft (active nav item)', dark.text, dark['primary-soft'], AA_BODY],
    ['ok on ok-soft', dark.ok, dark['ok-soft'], AA_BODY],
    ['danger on danger-soft', dark.danger, dark['danger-soft'], AA_BODY],
    ['warn on warn-soft', dark.warn, dark['warn-soft'], AA_BODY],
    ['chart-sales on surface', dark['chart-sales'], dark.surface, AA_LARGE],
    ['chart-purchases on surface', dark['chart-purchases'], dark.surface, AA_LARGE],
    ['chart-expenses on surface', dark['chart-expenses'], dark.surface, AA_LARGE],
    ['chart-benefit on surface', dark['chart-benefit'], dark.surface, AA_LARGE],
  ])('%s >= %s:1 (measured %s)', (_label, fg, bg, min) => {
    const ratio = contrast(fg, bg);
    expect(ratio).toBeGreaterThanOrEqual(min);
  });

  it('the accent is lightened enough to fail as the light-theme value', () => {
    // Regression guard for the exact defect the brief called out: shipping
    // the light-mode blue unchanged on a dark surface.
    expect(contrast(light.primary, dark.bg)).toBeLessThan(AA_BODY);
    expect(contrast(dark.primary, dark.bg)).toBeGreaterThanOrEqual(AA_BODY);
  });

  it('sidebar is a visibly distinct surface step from the page background', () => {
    // Same structure as the light-theme version of this check, for parity.
    const navVsBg = contrast(dark.nav, dark.bg);
    const surfaceVsBg = contrast(dark.surface, dark.bg);
    expect(navVsBg).toBeGreaterThan(surfaceVsBg);
  });
});

describe('WS-J-1 — interactive boundary contrast', () => {
  it.each([
    ['light: accent focus ring vs nav bg', light.primary, light.nav, AA_UI],
    ['dark: accent focus ring vs nav bg', dark.primary, dark.nav, AA_UI],
  ])('%s >= %s:1 (measured %s)', (_label, fg, bg, min) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(min);
  });
});
