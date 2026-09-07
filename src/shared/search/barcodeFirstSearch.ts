/**
 * WS-D-15 (D-7) — the ONE shared barcode-first resolution rule, used by the
 * app shell's global search (AppShell.tsx) and by PosScreen's product
 * search. Two copies of a scan-resolution rule is exactly the drift this
 * repository has already been bitten by (WS-D-11B, duplicated commit logic
 * merged into one function for the same reason); this file exists so that
 * never happens here.
 *
 * The rule is deliberately narrow: try an EXACT barcode match first, and
 * treat everything else — no match, or a lookup failure — as "not resolved
 * as a barcode; the caller should fall back to its own text search."
 * `catalog.resolve_barcode` already returns null rather than guessing at a
 * similar-sounding product, and this function preserves that exactly — it
 * NEVER falls back to a fuzzy match itself.
 *
 * What "fall back to text search" actually means is left to the caller on
 * purpose: the global shell modal searches server-side via `listProductsV2`
 * (the catalog can hold thousands of products), while PosScreen filters the
 * warehouse's already-loaded product list client-side (the existing,
 * unchanged POS pattern for a session-sized catalog). That difference is
 * legitimate and stays out of this function; only the barcode-first
 * resolution step itself is shared.
 */
import * as ipc from '../ipc/gateway';
import type { ResolvedBarcode } from '../ipc/dto';

export type BarcodeFirstResult =
  | { type: 'match'; resolved: ResolvedBarcode }
  | { type: 'no-match' };

export async function resolveBarcodeFirst(
  sessionToken: string,
  rawQuery: string,
): Promise<BarcodeFirstResult> {
  const query = rawQuery.trim();
  if (!query || !sessionToken) return { type: 'no-match' };
  try {
    const resolved = await ipc.resolveBarcode(sessionToken, query);
    if (resolved) return { type: 'match', resolved };
  } catch {
    // A lookup failure (session, transport, etc.) means "we could not tell",
    // not "this is definitely an invalid barcode" — treated the same as no
    // match so the caller falls back to text search rather than surfacing a
    // raw resolution error for what might simply be a product name.
  }
  return { type: 'no-match' };
}
