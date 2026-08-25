# Stockiha — Historical Import TEST DATASET: expected results (oracle)

Generated deterministically (seed 20260903) in the **unmodified** template.
Every figure below is computed with exact decimal arithmetic. A correct import + report must reproduce them.

## Shape

| Item | Value |
|---|---|
| Data rows (A2:M472) | 471 |
| Buy transactions | 83 |
| Sell transactions | 118 |
| Expense transactions | 34 |
| Total transactions | 235 |
| Sell product lines | 210 |
| Distinct variants sold | 76 |
| Sells with recorded Benefit | 88 of 118 |

## Headline figures (whole period)

| Figure | Expected (DZD) |
|---|---:|
| Total purchases (Buy) | 19,880,510.00 |
| Total sales revenue (Sell) | 4,258,950.00 |
| Cost of goods sold (WAC) | 3,133,836.16 |
| **Gross profit** | **1,125,113.84** |
| Total expenses | 565,100.00 |
| **Net profit (computed)** | **560,013.84** |
| Recorded benefit from paper (sum) | 696,700.00 |
| **Gap: recorded − computed gross** | **-428,413.84** |
| Customer debt (unpaid sells) | 920,900.00 |
| Supplier debt (unpaid buys) | 0.00 — all sample buys are Paid |
| Unpaid expenses | 57,000.00 |
| Closing stock value (WAC) | 16,746,673.84 |
| Closing stock units | 5442 |

## Monthly breakdown

| Month | Purchases | Sales | COGS | Gross | Expenses | Net |
|---|---:|---:|---:|---:|---:|---:|
| 2025-05 | 3,063,800.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| 2025-06 | 3,548,600.00 | 625,600.00 | 453,433.33 | 172,166.67 | 64,000.00 | 108,166.67 |
| 2025-07 | 873,700.00 | 368,300.00 | 264,094.44 | 104,205.56 | 42,500.00 | 61,705.56 |
| 2025-08 | 1,187,800.00 | 636,250.00 | 470,350.00 | 165,900.00 | 55,500.00 | 110,400.00 |
| 2025-09 | 2,003,550.00 | 404,400.00 | 291,658.64 | 112,741.36 | 67,500.00 | 45,241.36 |
| 2025-10 | 1,885,700.00 | 671,200.00 | 498,995.58 | 172,204.42 | 73,000.00 | 99,204.42 |
| 2025-11 | 3,097,960.00 | 316,950.00 | 237,726.26 | 79,223.74 | 95,300.00 | -16,076.26 |
| 2025-12 | 1,746,400.00 | 221,450.00 | 163,062.44 | 58,387.56 | 106,000.00 | -47,612.44 |
| 2026-01 | 1,405,100.00 | 530,900.00 | 391,753.89 | 139,146.11 | 25,300.00 | 113,846.11 |
| 2026-02 | 1,067,900.00 | 483,900.00 | 362,761.58 | 121,138.42 | 36,000.00 | 85,138.42 |

## Top 10 products by quantity sold

| Variant (canonical) | Qty | Revenue |
|---|---:|---:|
| couette | AK home | istanbul 2p | 32 | 459,800 |
| pillow | rozana | rolored | 26 | 21,400 |
| drap | AK home | 1p 0.90 | 21 | 78,800 |
| pillow cover | AK home | 20 | 17,350 |
| drap | AK home | 1.8 | 20 | 163,250 |
| drap | AK home | uni 2p | 20 | 161,200 |
| pillow | rozana | blanc | 18 | 11,550 |
| drap housse | AK home | 1.6 | 18 | 35,350 |
| pillow | AK home | colored | 18 | 26,650 |
| couette | AK home | 1p | 17 | 130,900 |

## Deliberate defects the import MUST surface

| # | Row / location | Defect | Required behaviour |
|---|---|---|---|
| 1 | row 6, col B | Date is the text `15/052025` (missing slash) | Reject the row with a readable message; never silently skip |
| 2 | row 85, col B | Date `08/09/2026` — year typo, sits between two Sept-2025 dates; also **in the future** | Flag as future-dated; ask for confirmation |
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

> **Note on these:** if the import treats a near-miss as a NEW product, its cost is unknown, so the whole sale price is reported as profit. That is exactly the failure the mapping screen exists to prevent. Reports built on unmapped data will overstate profit.

## How to use this file

1. Import it through the WS-G wizard.
2. Confirm all 8 defects above are surfaced, not swallowed.
3. Resolve the product mapping.
4. Compare every report figure against the Headline and Monthly tables. **Exact match required — no rounding tolerance.**
5. Any difference is a defect in the import or the report, not in this file.