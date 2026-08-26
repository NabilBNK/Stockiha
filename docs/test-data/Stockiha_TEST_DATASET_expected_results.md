# Stockiha — Historical Import TEST DATASET: expected results (oracle)

Generated deterministically (seed 20260903) in the **unmodified** template.
Every figure below is computed with exact decimal arithmetic. A correct import + report must reproduce them.

## Shape

| Item | Value |
|---|---|
| Data rows in range A2:M472 | 471 cells rows, of which **row 2 is blank** → **470 real data rows** |
| Buy transactions | 83 |
| Sell transactions | 118 |
| Expense transactions | 34 |
| Total transactions | 235 |
| Sell product lines | 210 |
| Distinct variants sold (after normalization + confirmed typo merges) | **72** |
| Sells with recorded Benefit | 88 of 118 |

## Headline figures (whole period)

### Tier 1 — exact, reproducible by pure addition. Hard acceptance gate, no tolerance.

| Figure | Expected (DZD) |
|---|---:|
| Total purchases (Buy) | 19,880,510.00 |
| Total sales revenue (Sell) | 4,258,950.00 |
| Total expenses | 565,100.00 |
| Customer debt (unpaid Sell) | 920,900.00 |
| Supplier debt (unpaid Buy) | 0.00 — all sample buys are Paid |
| Unpaid expenses | 57,000.00 |
| Recorded benefit from paper (sum) | 696,700.00 |

### Tier 2 — derived from weighted-average cost. Correct ONLY under the Convention section below.

| Figure | Expected (DZD) |
|---|---:|
| Cost of goods sold | 2,839,167.30 |
| **Gross profit** | **1,419,782.70** |
| **Net profit (computed)** | **854,682.70** |
| **Gap: recorded − computed gross** | **-723,082.70** |
| Closing stock value | 17,041,342.70 |
| Closing stock units | 5,513 |
| Sell lines with no cost source | **0** — the deciding check for the mapping screen |
| Sell lines with no cost *at their date* | **17**, worth 403,400.00 — see below |

**Balance statement.** Cost of goods sold + closing stock value
= 2,839,167.30 + 17,041,342.70 = **19,880,510.00** = total ever purchased.
No fraction of a dinar is lost between what was bought, what was sold and what
is still on the shelf. This identity is computed from the UNROUNDED walk and is
an internal-consistency proof, not a displayed figure.

**Sales with no purchase cost.** Under date-level ordering, 17 sell lines worth
403,400.00 fall before any purchase of the same variant — the shop held stock
before the paper records begin. Their revenue is part of Tier 1 total sales
(3,855,550.00 with a cost + 403,400.00 without = 4,258,950.00) but they carry
no cost and no margin. They must never be priced at zero.

**Displayed profit-and-loss headline.** The application rounds each monthly row
to 2 decimals and sums those rounded rows for the headline, so that a printed
monthly table adds up to its own printed total. That makes the DISPLAYED
headline COGS 2,839,167.31 / gross 1,419,782.69 / net 854,682.69 — one centime
away from the exact figures above, which are rounded once from the unrounded
total. Both are correct; they are two different computations (a displayed total
that must equal the sum of displayed rows, and the exact arithmetic truth used
for the balance statement). Check a report against the figure that matches what
it claims to be.

## Monthly breakdown (Tier 2 — same convention applies)

| Month | Purchases | Sales | COGS | Gross | Expenses | Net |
|---|---:|---:|---:|---:|---:|---:|
| 2025-05 | 3,063,800.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| 2025-06 | 3,548,600.00 | 625,600.00 | 380,969.70 | 244,630.30 | 64,000.00 | 180,630.30 |
| 2025-07 | 873,700.00 | 368,300.00 | 263,930.81 | 104,369.19 | 42,500.00 | 61,869.19 |
| 2025-08 | 1,187,800.00 | 636,250.00 | 405,700.00 | 230,550.00 | 55,500.00 | 175,050.00 |
| 2025-09 | 2,003,550.00 | 404,400.00 | 265,766.33 | 138,633.67 | 67,500.00 | 71,133.67 |
| 2025-10 | 1,885,700.00 | 671,200.00 | 496,479.65 | 174,720.35 | 73,000.00 | 101,720.35 |
| 2025-11 | 3,097,960.00 | 316,950.00 | 175,926.26 | 141,023.74 | 95,300.00 | 45,723.74 |
| 2025-12 | 1,746,400.00 | 221,450.00 | 148,202.56 | 73,247.44 | 106,000.00 | -32,752.56 |
| 2026-01 | 1,405,100.00 | 530,900.00 | 339,532.12 | 191,367.88 | 25,300.00 | 166,067.88 |
| 2026-02 | 1,067,900.00 | 483,900.00 | 362,659.88 | 121,240.12 | 36,000.00 | 85,240.12 |

## Deliberate defects the import MUST surface

| # | Row / location | Defect | Required behaviour |
|---|---|---|---|
| 1 | row 6, col B | Date is the text `15/052025` (missing slash) | Reject the row with a readable message; never silently skip |
| 2 | **row 83**, col B | Date `08/09/2026` — year typo, sits between two Sept-2025 dates; also **in the future**. Rows 84-85 are continuation lines of this same transaction. | Flag as future-dated; ask for confirmation |
| 3 | rows 16, 38, 41-43, 46, 63, 94, 95, 107, 136, 190 | `Custom Details` holds a NUMBER (1.6, 1.8, 160, 180) not text | Coerce to text without losing the value |
| 4 | Buy section | `Party` filled on only 36 of 83 purchases | Import must accept blank supplier |
| 5 | Sell section | 7 near-miss spellings injected (see below) | Product mapping screen must group them with their canonical variant |
| 6 | Expense rows | `Line Total` is a hard value, no Qty/Unit Price | Must accept amount-only lines |
| 7 | Sell section | Some transactions have blank `Benefit`, some 0, some negative | All four cases must be distinguishable (blank ≠ 0) |
| 8 | rows 255, 326, 420 | `Line Total` is a hand-typed amount that does NOT equal Quantity x Unit Price | The typed `Line Total` WINS. Revenue must use it, not I*J |
| 9 | row 228 | A row holding ONLY a Page No. (16) - no Date, Type, product, quantity or amount | Must not create a transaction or a line; warn or ignore, never crash |
| 10 | Sell section | Sell rows appear AFTER all Buy rows, so the sheet is not chronological | Import must not depend on row order |

### Near-miss spellings injected (canonical → as written on the sell line)

| Canonical (from Buy) | Written on Sell |
|---|---|
| `bouti|AK home|istanbul 2p` | `bouti|AK home|istambul 2p` |
| `bouti|dolz|1p` | `bouti|dolz|1 P` |
| `bouti|rozana|1p` | `bouti|rozana|1 P` |
| `couette|AK home|istanbul` | `couete|AK home|istanbul` |
| `couette|AK home|uni 1p` | `couete|AK home|uni 1p` |
| `couette||blanc 240` | `couete||blanc 240` |
| `pillow cover|rozana|` | `pillow couver|rozana|` |

Plus one REAL typo found in the customer's own purchase data (not injected): `iatanbul` should merge with `istanbul`.

## Convention — normative for reproducing Tier 2. Read before touching any cost calculation.

1. **Variant identity** = (Product, Brand, Custom Details), each independently:
   trimmed, lowercased, internal whitespace collapsed, decimal comma to dot,
   `1 P` / `1p` unified, and a bare number >= 50 divided by 100
   (`160` -> `1.6`, `90` -> `0.9`, `2,40` -> `2.4`). Then the confirmed typo merges
   applied: `istambul`/`iatanbul` -> `istanbul`, `couete` -> `couette`,
   `pillow couver` -> `pillow cover`, `rolored` -> `colored`, `bosoft` -> `bossoft`,
   `couvre-lit` -> `couvre lit`. This yields **83 purchased** and **72 sold**
   variants, with **zero** sell lines lacking a cost source.
2. **Date corrections applied first:** row 6 -> 15/05/2025, row 83 -> 08/09/2025.
3. **Ordering — strictly chronological, at DATE level.** Process by transaction
   date; on the same date, ALL purchases before ANY sale; then workbook-row
   order, then line order. A sale can never consume stock bought after it.
   Expenses never enter the cost walk at all. This is the sole normative
   ordering. The month-level grouping printed in revision 2 of this file was a
   mistake in the document, not a property of the data, and is obsolete.
4. **Arithmetic:** running WAC = pool value / pool quantity, rounded to 6 decimals.
   COGS per line = WAC x quantity, left UNROUNDED. When a sale empties a pool, COGS
   for that line = the entire remaining pool value, so no residue is orphaned.
   Round only final displayed totals, to 2 decimals.
5. **Revenue** = the `Line Total` cell as written. Never Quantity x Unit Price.

## Revision history

- **Revision 3 (this file).** Corrects a mixed-convention bug present in revision 2:
  the monthly breakdown table was already date-level, but the Tier 2 headline was
  still month-level, so the two contradicted each other. Date-level ordering is now
  the sole normative convention; Tier 2 has been restated accordingly
  (COGS 2,839,167.30, closing stock 17,041,342.70 / 5,513 units), the balance
  statement has been added, and the "Known limitation of this fixture" section has
  been removed — it no longer applies. The monthly breakdown table and Tier 1 are
  UNCHANGED from revision 2.
- **Revision 2.** Corrected the Tier 2 figures of revision 1 and restated the monthly
  breakdown table at date level. It carried no explicit revision marker; this
  section is introduced in revision 3 and numbers the earlier states retrospectively.
- **Revision 1.** First delivery, generated deterministically with seed 20260903.

## How to use this file

1. Import it through the WS-G wizard.
2. Confirm all 10 defects above are surfaced (per the primary-field warning-only
   policy for defects 1, 2, 9; per the fuzzy-suggestion mapping screen for defect 5).
3. Resolve the product mapping.
4. Compare every Tier 1 figure exactly. Compare Tier 2 figures under the stated
   convention. Any difference is a defect in the import or the report, not in this
   file.

File sha256 of the companion xlsx (unchanged since first delivery):
324d29e0c4ae111563b5d8a6120159b0e1bea4ac387fb82bd89519c1e81860b4
