# WS-O — Buy and Sell by the Box: Executable Specification

| | |
|---|---|
| Workstream | **WS-O — Units & Packaging ("boxes and pieces")** |
| Implementing agent | **Claude Code** for O-1 to O-5 (money, stock, SQL, posting). O-6 (translations) may go to Gemini. |
| Sub-plans | O-1 Pack catalogue (database) · O-2 Pack setup screens · O-3 Buy by the box · O-4 Sell by the box · O-5 Boxes shown everywhere · O-6 Translations |
| Replaces | `WS-O-0-units-packaging-discovery-brief.md` (its questions are now the Gate 0 steps below) |
| Build marker format | `[ version = WS-O-<n>.<bump> ]` in `src/features/dashboard/DashboardScreen.tsx` |

---

## 0. How to use this document

1. **One run = one sub-plan.** The owner starts each run with exactly this prompt (replace `<n>`):
   > Read `WS-O-boxes-and-pieces-spec.md` completely. Execute sub-plan **O-<n>** only, exactly as written, starting with its Gate 0. Do not start any other sub-plan. Stop at the end of O-<n> and write the report described in section 17.
2. Read sections 1 to 7 before any sub-plan. They are rules for every sub-plan.
3. **Evidence tags used in this document:**
   - **[S]** = seen in the repository snapshot dated **2026-08-21**. The code has changed since then (WS-D, WS-E, WS-F, WS-H, WS-I, WS-M, WS-K). Every [S] fact that a step relies on is re-checked in that sub-plan's Gate 0. If the live code differs, follow the Gate 0 instructions: either adapt the name and record it, or STOP.
   - **[R]** = owner ruling. Never change it.
   - **[D]** = design decision made in this document. Never change it; if it cannot be implemented, STOP.
4. Everything this document names (file, function, column, message, number) is to be used **exactly**. When the live code uses a different name for the same thing (found in Gate 0), use the live name and list the substitution in the report.
5. If something is not answered here, it is a stop condition. Never invent a rule.

---

## 1. Owner rulings [R]

| # | Ruling |
|---|---|
| R1 | A product can be bought and sold by its **base unit** (the piece) and by one or more **packs** (box, carton, bale). |
| R2 | The number of base units in a pack is set **per product** (a carton of pillows holds 12, a carton of blankets holds 6). Unit **names** (Carton, Bale, Piece) are defined in Catalogue Setup → Units. |
| R3 | Each pack has **its own sale price**, not pieces × piece price. |
| R4 | A pack may have **its own barcode(s)**. Scanning a pack barcode adds **one whole pack**. |
| R5 | The pack price (and the piece price) is a **default the seller can change by hand** on a sale line. Stockiha **warns** when the new price is below cost but **never blocks**. |
| R6 | **The box is the default.** On the till and in purchases, a product that has a main pack starts in that pack. The piece is one tap away. |
| R7 | **Mixed quantity.** "3 boxes + 4 pieces" of one product: the 4 extra pieces are charged at the **box rate** (box price ÷ pieces per box). **Pieces bought alone** (no full box on that line) are charged the **normal piece price**. |
| R8 | Purchases follow the same rule in reverse: extra pieces bought together with boxes are **costed at the box cost rate**. |
| R9 | Stock is counted in base units and **shown** as "3 Carton + 4 Piece". |
| R10 | Only the admin uses the app for now (MVP ruling): **no new roles, permissions or approval flows.** |
| R11 | The box rate for **selling** is rounded to the **nearest whole dinar** (half up), per piece. |
| R12 | Translations come last (O-6). |
| R13 | Nothing already recorded may change meaning: every existing sale, purchase, movement, report and printed document stays exactly as it was. |

---

## 2. Vocabulary (used exactly like this everywhere)

| Word | Meaning |
|---|---|
| **Base unit** | The unit stock is counted in. It is the product's unit, `catalog.products.unit_id` [S]. Usually "Piece" or the seeded `UNIT`. |
| **Whole base unit** | A base unit whose decimal/whole-number flag says "whole numbers only" (pieces). A **decimal base unit** allows decimals (kg). The flag column name is found in Gate 0 of O-1. |
| **Alternate unit** | Any row of `catalog.variant_units` [S]: one unit for one variant with `conversion_factor` = number of base units inside it. |
| **Pack** | An alternate unit whose `conversion_factor > 1`. Box, carton, bale. |
| **Factor / "holds"** | `conversion_factor`: how many base units one pack holds (12). |
| **Main pack** | The one pack per variant marked `is_primary = true`. Used as the default on the till and in purchases, and to display stock. |
| **Sellable pack** | An active pack with a non-NULL `sale_price`. |
| **Buy-only pack** | An active pack with `sale_price` NULL (e.g. a supplier's bale). |
| **Used pack** | A pack that appears in any posted purchase line, stock adjustment, supplier return line or sale line. |
| **Base line** | A stored sale line for base units at the piece price. `price_basis = 'BASE'`. |
| **Pack line** | A stored sale line for whole packs at the pack price. `price_basis = 'PACK'`. |
| **Pack-rate line** | A stored sale line for the extra base units of a mixed quantity, priced at the pack rate. `price_basis = 'PACK_RATE'`. |
| **Pack rate (sale)** | `round(pack_price / factor, 0)` — whole dinars, half up [R11]. |
| **Pack rate (cost)** | `round(pack_cost / factor, 2)` — centimes, half up [D7]. |

Rounding rule used everywhere: PostgreSQL `round(numeric, n)` = half away from zero; for the positive amounts here that is **half up** (750.5 → 751).

---

## 3. What already exists [S] (repository snapshot 2026-08-21)

| # | Fact | Evidence |
|---|---|---|
| S1 | `catalog.variant_units(id, variant_id, unit_id, conversion_factor numeric(20,6) > 0, created_at, updated_at)`, `UNIQUE(variant_id, unit_id)`. Comment: "one carton = 12 base units -> 12.000000". | `20260724120000_catalog_variants_attributes_units_barcodes.sql` |
| S2 | `catalog.variant_barcodes(id, variant_id, barcode, normalized_barcode UNIQUE, created_at, is_primary)`; partial unique index `variant_barcodes_primary_unique (variant_id) WHERE is_primary`. Normalisation = `upper(btrim(barcode))`. | same + `20260813180000_catalog_identity_and_sku_redesign.sql` |
| S3 | `catalog._insert_barcode(p_variant_id, p_barcode, p_is_primary DEFAULT false)`: when `p_is_primary` is NULL/omitted, **the new barcode becomes primary if the variant has none** (`coalesce(p_is_primary, NOT v_has_primary)`). | `20260813180000_…` |
| S4 | `catalog.remove_variant_barcode(p_session_token, p_barcode_id)`: when the removed barcode was primary, **promotes the lowest remaining barcode id of the variant** to primary. | `20260813180000_…` |
| S5 | `catalog.resolve_barcode(p_session_token, p_identifier)` returns one row (variant, product, sku, names, primary barcode, display identifier, sale_price, unit id/code/name, active flags); barcode match first, exact SKU match second. | `20260813180000_…` |
| S6 | `catalog.add_variant_alt_unit(p_session_token, p_variant_id, p_unit_id, p_conversion_factor)` and `catalog.remove_variant_alt_unit(p_session_token, p_variant_unit_id)` exist, permission `MANAGE_CATALOG`; UI component `src/features/products/UnitManager.tsx` lists alternate units; Tauri commands `add_variant_alt_unit`, `remove_variant_alt_unit`. Existing test `src-tauri/tests/catalog/s2_001_catalog_integration.sql` adds a **gram with factor 0.001** (a smaller unit, not a pack). | several |
| S7 | **Purchases already accept a unit per line.** `inventory.confirm_direct_purchase(... p_lines jsonb)` reads `variant_id, unit_id, quantity_received, unit_cost` per line; converts with `variant_units.conversion_factor`; base qty = `round(qty × factor, 3)`; line total = `round(qty × unit_cost, 2)`; stores `procurement.purchase_receipt_lines(variant_id, unit_id, quantity_received, unit_cost, line_total, movement_id)`; recalculates WAC. Base unit read from `catalog.products.unit_id`. | `20260816150000_direct_purchase_foundation.sql`, `20260816195000_…unit_conversion_repair.sql` |
| S8 | A trigger forbids two direct-purchase lines with the **same variant and same unit** (`procurement.forbid_duplicate_direct_purchase_line`). A pack line and a base line of the same variant are allowed. | `20260816160000_…duplicate_line_guard.sql` |
| S9 | **Stock adjustments already accept a unit** (`inventory.list_stock_adjustment_units` returns base + alternate units; posting converts). Base unit read from `catalog.product_variants.base_unit_id` (**a different column than S7**). | `20260724130000_…`, `20260817090000_inventory_corrections_policy.sql` |
| S10 | Sale lines: `sales.cash_sale_lines` and `sales.credit_sale_lines` store `variant_id, sku/name snapshots, quantity numeric(18,3), unit_price numeric(14,2), unit_cost_snapshot numeric(18,4), line_total numeric(14,2)`, with a CHECK `line_total = round(quantity * unit_price, 2)` (constraint names `cash_sale_lines_line_total_matches_quantity_and_price`, `credit_sale_lines_total_matches`). Posted lines are immutable (triggers). | `20260722125406_…`, `20260730193000_…` |
| S11 | `sales.confirm_cash_sale` takes the **unit price from the payload** (not from the catalog), checks stock per line, COGS = quantity × WAC, one movement per line. Rust computes the idempotency hash over the serialized `CashSaleLineInput { variant_id, quantity, unit_price }` (`src-tauri/src/application/cash_sale.rs`). | `20260724140200_…`, `cash_sale.rs` |
| S12 | **Trap:** the credit sale hash is computed **in SQL** by `receivables.credit_sale_payload_hash(...)`, which keeps **only** `variant_id, quantity, unit_price` of each line. Any new line field is invisible to it unless the function is changed. | `20260730194500_credit_sale_payload_binding.sql` |
| S13 | Backend errors reach the UI only as fixed codes: SQLSTATE `22023` → `VALIDATION_ERROR`, `55000` with "insufficient stock" → `INSUFFICIENT_STOCK`, `42501` → `PERMISSION_DENIED`. Raw database messages never reach the screen. | `src-tauri/src/error.rs`, `src/shared/types/errors.ts`, `src/shared/hooks/useErrorText.ts` |
| S14 | The frontend has **no decimal arithmetic library** (`package.json`); `src/features/inventory/exactDecimal.ts` only formats and compares. Money formatting: `formatDisplayAmount` in `src/shared/utils/formatters.ts`. | `package.json`, those files |
| S15 | SQL test suites are listed one by one in `src-tauri/tests/run_current_sql_suites.sh` (array `suites=(...)`); each runs inside `BEGIN … ROLLBACK`. Test helper pattern: `pg_temp.expect_error(p_sql, p_sqlstate)`; test sessions are created by inserting into `iam.application_sessions` with `sha256('<token>'::bytea)`. | `run_current_sql_suites.sh`, `tests/catalog/s2_001_catalog_integration.sql` |
| S16 | Command pattern: React `gateway.ts` function → `invoke('<snake_case_command>', { sessionToken, camelCaseArgs })` → `#[tauri::command]` in `src-tauri/src/commands/<area>.rs` → service in `src-tauri/src/application/<area>.rs` using `sqlx` with `.map_err(AppError::from_posting_error)` → registration in `src-tauri/src/lib.rs`. Decimals cross IPC as strings. | `commands/catalog.rs`, `application/catalog.rs`, `gateway.ts` |

---

## 4. Design decisions [D] (alternatives compared, one chosen)

| # | Decision | Alternatives rejected and why |
|---|---|---|
| D1 | **Packs are rows of the existing `catalog.variant_units`**, extended with `sale_price`, `is_primary`, `is_active`. | A new `catalog.packs` table would duplicate the conversion factor already used by purchases and adjustments (S7, S9) — two sources of truth. |
| D2 | **Stock, movements, WAC and COGS stay in base units.** Nothing in inventory changes. | Storing stock in packs would touch every ledger and report. |
| D3 | **Pack barcodes live in `catalog.variant_barcodes`** with a new nullable column `variant_unit_id`. NULL = piece barcode. Pack barcodes are **never primary**. | A separate table would need cross-table uniqueness (triggers + locks). One table keeps one unique index and one resolver. |
| D4 | **On sale lines, `quantity` keeps meaning base units.** Pack details go into new columns. | Storing the pack count in `quantity` would silently break stock, COGS, void, reports and backup reconciliation, which all read `quantity` as base units. |
| D5 | **A mixed quantity "3 boxes + 4 pieces" is stored as two sale lines**: a pack line (3 boxes) and a pack-rate line (4 pieces). The till shows them as one row. | One stored line with extra columns would need a new total formula everywhere; two lines keep each line's total simple and printable. |
| D6 | **The expansion from "pack request" to stored lines happens in PostgreSQL**, in `sales._expand_sale_lines`, reading the factor and list price from the catalog at posting time. | React/Rust would own quantity and price decisions — forbidden (database-authoritative rule). |
| D7 | Sale pack rate rounds to **whole dinars** [R11]; **purchase** pack rate rounds to **2 decimals** (cost precision). | Same rounding for both would either lose cost precision or break R11. |
| D8 | **Backward-compatible payloads.** New line keys are optional. A line without them is processed exactly as today, and its fingerprint (hash) is byte-for-byte identical to today's. | Changing the old line shape would break idempotent retries of old requests and existing tests. |
| D9 | `sale_price NULL` = **buy-only pack**. The till never offers it; posting rejects it. | Forcing a price would block supplier bales that are never sold. |
| D10 | **Exactly one main pack per variant** when it has at least one active pack; assigned automatically (largest factor, then smallest id) when none is chosen. | Leaving it optional would make "box is the default" [R6] unpredictable. |
| D11 | **A pack's factor is locked once the pack is used.** To change it, deactivate the pack and create a new one with another unit. Price can always change. | Editing a used factor would make past purchases and supplier returns wrong. |
| D12 | **A product's base unit is locked once any of its variants has an alternate unit** (trigger on `catalog.products` and `catalog.product_variants`). | Changing the base unit would change the meaning of every factor. |
| D13 | **Display and live previews are computed in React** by a new exact-arithmetic module `src/shared/utils/packMath.ts` using `BigInt` on scaled integers. They are presentation only; saved values always come from SQL. | Adding a decimal library adds a dependency for four small functions. |
| D14 | **No new permission** for editing prices [R10]. Pack setup uses the existing `MANAGE_CATALOG`; posting keeps the existing permissions. | A PRICE_OVERRIDE permission is future work. |
| D15 | **Purchases:** `inventory.confirm_direct_purchase` gains one optional line key, `extra_base_quantity`; SQL adds the pack-rate line itself. | React sending two lines would put the cost-rate division in the UI. |
| D16 | **The error contract (S13) is not changed.** Specific, friendly messages come from **front-end checks that mirror the SQL rules** before calling the backend. SQL keeps raising `22023` (shown as the generic validation message) as a safety net, with message text starting `PACK_…` for logs. | Adding new IPC error codes touches the security-sensitive redaction layer for every feature. |
| D17 | **Legacy functions keep working.** `add_variant_alt_unit` keeps its current rules (it still accepts factor 0.001 for smaller units); only its side effect on the main pack is added. `remove_variant_alt_unit` additionally deletes the pack's barcodes and re-assigns the main pack. New screens use only the new functions. | Changing the legacy rules would break the existing test S6. |
| D18 | **Base unit column:** new code reads `catalog.products.unit_id` (as S7 does). Gate 0 of O-1 proves it equals `catalog.product_variants.base_unit_id` for every variant; if not, STOP. | Reading two different columns in different places is a latent bug (S7 vs S9). |

---

## 5. What must NOT change (all sub-plans)

1. No change to the arithmetic of WAC, COGS, inventory value, journals, receivables or payables. Pack lines feed the **existing** arithmetic with base-unit quantities.
2. No change to `inventory.movements`, `inventory.positions`, the negative-stock constraint, residual handling, or any immutability trigger.
3. No existing column is renamed, dropped or re-typed. Only new nullable/defaulted columns and replaced CHECK constraints listed in this document.
4. A sale or purchase payload **without** the new keys must post exactly as before, with the same stored values and the same idempotency hash.
5. `catalog.list_products_v2`, `catalog.quick_create_product`, `catalog.update_product`, `catalog.update_variant` and `catalog.get_product_detail` are **not modified** (their contracts are fragile — ws-d-skill §2). The only catalog functions modified are the ones this document names.
6. Inventory Corrections and Direct Purchase are protected work (ws-d-skill §1): **extend only**, exactly as specified in O-3.
7. The redacted error contract (S13) — no new error codes.
8. No new role, permission, approval flow or setting screen.
9. The whole-sale fixed discount (WS-F-3), credit-limit warning (WS-F-4), cash sessions (WS-F-5) and sale void (WS-F-6) keep their behaviour; they only receive pack data for display where stated.
10. App version in `tauri.conf.json` / `package.json`: unchanged.

---

## 6. Execution order and dependencies

```
O-1 Pack catalogue (DB + Rust + DTOs, no screens)
  └─> O-2 Pack setup screens (needs O-1 functions)
        ├─> O-3 Buy by the box   (needs O-1; uses O-2 to create test packs by hand)
        └─> O-4 Sell by the box  (needs O-1; uses O-2)
              └─> O-5 Boxes shown everywhere (needs O-1 get_primary_packs; after O-3 and O-4 so every screen is final)
                    └─> O-6 Translations (always last)
```
- O-3 and O-4 do not depend on each other. **Run O-3 first, then O-4** (O-3 is smaller and proves the pack-rate helper in a money path first).
- Branches (each created from the previous sub-plan's **accepted** branch; everything is merged to `main` together at the end):
  - O-1 `task/ws-o-1-pack-catalogue` from `main`
  - O-2 `task/ws-o-2-pack-setup-ui` from O-1
  - O-3 `task/ws-o-3-buy-by-pack` from O-2
  - O-4 `task/ws-o-4-sell-by-pack` from O-3
  - O-5 `task/ws-o-5-pack-display` from O-4
  - O-6 `task/ws-o-6-translations` from O-5
- Work that is not pushed does not exist. Commit and push before the report; the report ends with the full commit hash and `Pushed: yes/no`.

---

## 7. Global conventions

**7.1 Skills.** Follow `stockiha-task-execution`, `ws-d-skill` (§2 overload/cast traps, §3 invariants, §4 function contract, §5 LIKE escaping, §6 WS-B boundary, §7 frontend, §10 verification), and read `ws-b-skill` before O-3 and O-4.

**7.2 SQL function contract** (every new or replaced public function): `LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog`; fully schema-qualified names in bodies; first statement `PERFORM 1 FROM iam.resolve_session(p_session_token);` for reads or `PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');` for catalog writes; reads `STABLE`; `REVOKE ALL ON FUNCTION <exact signature> FROM PUBLIC;` then `GRANT EXECUTE … TO stockiha_runtime;`. **Private helpers** (name starts with `_`): owner-only, `REVOKE ALL … FROM PUBLIC`, **no** grant. A function whose return type changes must be `DROP`ped and re-created, and its grants re-issued. Migrations run as `SET ROLE stockiha_owner; … RESET ROLE;` like existing ones [S].

**7.3 Migration files.** `src-tauri/migrations/<YYYYMMDDHHMMSS>_ws_o_<n>_<topic>.sql`, timestamp = current UTC time, later than the newest existing file. One migration per sub-plan unless a step says otherwise. It must apply cleanly to an **empty** database and on top of the acceptance database.

**7.4 Numbers.** SQL `numeric`; Rust `rust_decimal::Decimal`; IPC strings; React `packMath.ts` (O-1) / `exactDecimal.ts` / `formatDisplayAmount`. **No** `f32`, `f64`, `double precision`, `real` or JS `number` for any quantity, factor, price, cost or total — including tests.

**7.5 Validation limits** (same in SQL and in the front-end mirrors):
| Value | Rule |
|---|---|
| Pack factor | `> 1`; `<= 100000`; at most 6 decimals (`= round(x, 6)`); **whole number** when the base unit is whole |
| Pack sale price / pack cost / unit price | `>= 0`; at most 2 decimals (`= round(x, 2)`); `<= 999999999999.99` |
| Pack quantity (sale/purchase) | whole number `>= 1` |
| Extra base quantity | `>= 0` and **strictly less than the factor**; whole when the base unit is whole, else at most 3 decimals |
| Barcode | not blank after trim; normalised `upper(btrim(x))`; globally unique among all barcodes |

**7.6 SQL error messages.** `RAISE EXCEPTION '<CODE>: <english detail with the offending value>' USING ERRCODE = '22023';` with the codes in Appendix A. They reach the UI as the generic validation message (S13, D16), so every rule is **also** checked in the UI before calling.

**7.7 Strings.** Every user-facing text through `src/shared/i18n/`, keys listed per sub-plan, **English text copied into fr and ar** until O-6.

**7.8 Build marker.** In `src/features/dashboard/DashboardScreen.tsx` set `[ version = WS-O-<n>.1 ]` in the same commit as the change; `+1` on every corrective re-run.

**7.9 Verification commands** (paste literal output with working directory; `NOT RUN — reason` is acceptable, an assumed pass is not):
```
npm run typecheck && npm run lint && npm test -- --run && npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --lib
bash src-tauri/tests/run_current_sql_suites.sh
```
A real Rust test run ends with `test result: ok. N passed; 0 failed`. Then build the signed installer: `npm run tauri build` (needs `TAURI_SIGNING_PRIVATE_KEY` and its password in the environment) and give the `.exe` path.

**7.10 New SQL test files** are added to the `suites=(...)` array in `src-tauri/tests/run_current_sql_suites.sh` (S15), and follow the existing pattern (sessions inserted into `iam.application_sessions`, `pg_temp.expect_error`).

**7.11 Shared worked-example data** (used by every sub-plan's tests; create it inside each test file):
| Name | Setup |
|---|---|
| Base unit | the seeded `UNIT` ("Unit"), **whole** |
| Units | `CTN` "Carton", `BAL` "Bale", `KG` "Kilogram" (**decimal**), `SAC` "Sac" |
| V1 "Oreiller blanc" | base `UNIT`, piece price **1,400.00**, piece barcode `6131000000014` |
| V1 pack Carton | factor **12**, sale price **15,000.00**, main pack, barcode `6131000000021` |
| V1 pack Bale | factor **50**, no sale price (buy-only) |
| V2 "Plaid 1p" | base `UNIT`, piece price **1,500.00**; pack Carton factor **7**, sale price **9,000.00** (does not divide evenly) |
| V3 "Coton vrac" | base `KG` (decimal), price **900.00**/kg; pack Sac factor **25**, sale price **20,000.00** |

---

## 8. Sub-plan O-1 — Pack catalogue (database, Rust, DTOs; no screens)

**Goal:** the database can store packs with their own price, main-pack flag, active flag and barcodes; scanning a pack barcode identifies the pack; React has an exact helper to show "3 Carton + 4 Unit". No screen changes (O-2 does screens).

**Branch:** `task/ws-o-1-pack-catalogue` from `main`. **Marker:** `[ version = WS-O-1.1 ]`.

### O-1.0 Gate 0 — establish reality (run before writing anything; put results at the top of the report)

Run each query against `stockiha_acceptance` (port 5433), read-only. Label every finding *verified / read but not executed / assumed*.

| # | What to check | How | Stop if |
|---|---|---|---|
| G1 | Live table definitions | `\d catalog.variant_units`, `\d catalog.variant_barcodes`, `\d catalog.units`, `\d catalog.products`, `\d catalog.product_variants` | `catalog.variant_units` or `catalog.variant_barcodes` missing; or any column this plan adds already exists with a different type |
| G2 | Name of the units' **decimal/whole flag** column and of the units' **active** column | from G1 on `catalog.units` | no decimal/whole flag column exists |
| G3 | Base unit consistency (D18) | `SELECT count(*) FROM catalog.product_variants pv JOIN catalog.products p ON p.id = pv.product_id WHERE pv.base_unit_id IS DISTINCT FROM p.unit_id;` | result > 0 (paste the rows) |
| G4 | Existing alternate units | `SELECT count(*) total, count(*) FILTER (WHERE conversion_factor > 1) packs, count(*) FILTER (WHERE conversion_factor <= 1) smaller FROM catalog.variant_units;` and for whole base units: `SELECT vu.* FROM catalog.variant_units vu JOIN catalog.product_variants pv ON pv.id = vu.variant_id JOIN catalog.products p ON p.id = pv.product_id JOIN catalog.units u ON u.id = p.unit_id WHERE <whole-unit condition using the flag column found in G2> AND vu.conversion_factor > 1 AND vu.conversion_factor <> trunc(vu.conversion_factor);` | the second query returns rows (a whole-unit product already has a fractional pack) |
| G5 | Live signatures and bodies | `SELECT p.oid::regprocedure, pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'catalog' AND p.proname IN ('resolve_barcode','remove_variant_barcode','_insert_barcode','add_variant_alt_unit','remove_variant_alt_unit','set_variant_base_unit','update_product','update_variant','list_products_v2');` | `resolve_barcode` has more than one overload |
| G6 | How `list_products_v2` picks the displayed barcode | read its body from G5: the barcode sub-query must filter `is_primary` | it does **not** filter `is_primary` (then STOP and report; do not edit it) |
| G7 | Unit usage counting (units cannot be deleted while used) | find the function(s) in schema `catalog` whose body contains both `units` and `usage_count` or that delete units: `SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='catalog' AND p.prokind = 'f' AND pg_get_functiondef(p.oid) ILIKE '%usage%' ;` then read them | none found (then record "no unit usage function" and skip step O-1.10) |
| G8 | Every caller of `resolve_barcode` | `rg -n "resolve_barcode" src-tauri/src src` — list file:line and whether rows are decoded **by name** (`#[derive(FromRow)]` struct) or **by position** (tuple) | — |
| G9 | Tables that reference `(variant_id, unit_id)` in posted documents | `rg -n "unit_id" src-tauri/migrations` and `\d` of every table found (expected at least `procurement.purchase_receipt_lines`, `inventory.stock_adjustments`; also any supplier-return line table) | — |
| G10 | Permission and roles | `SELECT code FROM iam.permissions WHERE code = 'MANAGE_CATALOG';` and which roles hold it | `MANAGE_CATALOG` missing |
| G11 | Tauri command access control | read `src-tauri/build.rs` and `src-tauri/capabilities/default.json`: are app commands listed individually (app manifest / ACL)? | — (if yes, every new command must be added there too) |
| G12 | Newest migration file name | `ls src-tauri/migrations | tail -3` | — |

### O-1 steps

---

**O-1.1 — Create the migration file**
- **Objective:** one migration holds every database change of O-1.
- **Location:** `src-tauri/migrations/<timestamp>_ws_o_1_pack_catalogue.sql` (timestamp later than G12).
- **Change:** new file starting with `SET ROLE stockiha_owner;` and ending with `RESET ROLE;`. Steps O-1.2 to O-1.10 add their SQL to it, **in step order**.
- **Logic:** statements run top to bottom in one transaction (sqlx migration).
- **Depends on:** Gate 0 passed.
- **Expected result:** `sqlx migrate` applies it on an empty database and on the acceptance database.
- **Pitfalls:** forgetting `RESET ROLE`; putting a function before the column it uses.
- **Edge cases:** re-running on a database where it is already applied — sqlx skips it; do **not** add `IF NOT EXISTS` tricks that hide errors, except where a step says so.
- **Verify:** apply to an empty database (report the command and output).

---

**O-1.2 — Extend `catalog.variant_units` into packs**
- **Objective:** a pack can have a sale price, be the main pack, be switched off.
- **Location:** the O-1 migration.
- **Change (exact SQL):**
```sql
ALTER TABLE catalog.variant_units
    ADD COLUMN sale_price numeric(14,2) NULL,
    ADD COLUMN is_primary boolean NOT NULL DEFAULT false,
    ADD COLUMN is_active  boolean NOT NULL DEFAULT true;

ALTER TABLE catalog.variant_units
    ADD CONSTRAINT variant_units_sale_price_valid
        CHECK (sale_price IS NULL OR (sale_price >= 0 AND sale_price = round(sale_price, 2))),
    ADD CONSTRAINT variant_units_primary_requires_active_pack
        CHECK (NOT is_primary OR (is_active AND conversion_factor > 1));

-- Backfill: one main pack per variant = active pack with the largest factor, then the smallest id.
UPDATE catalog.variant_units vu
   SET is_primary = true
 WHERE vu.id IN (
     SELECT DISTINCT ON (x.variant_id) x.id
       FROM catalog.variant_units x
      WHERE x.is_active AND x.conversion_factor > 1
      ORDER BY x.variant_id, x.conversion_factor DESC, x.id ASC);

CREATE UNIQUE INDEX variant_units_one_primary
    ON catalog.variant_units (variant_id) WHERE is_primary;
```
- **Logic:** existing rows get `sale_price NULL` (buy-only until the owner sets a price), `is_active true`, and at most one main pack.
- **Depends on:** O-1.1.
- **Expected result:** `SELECT variant_id, count(*) FROM catalog.variant_units WHERE is_primary GROUP BY 1 HAVING count(*) > 1` returns nothing.
- **Pitfalls:** creating the unique index **before** the backfill (fine) or after (fine) — but never set two rows primary in one statement.
- **Edge cases:** variants with only smaller units (factor ≤ 1) get no main pack; that is correct.
- **Verify:** SQL test T1–T3 (O-1.14).

---

**O-1.3 — Link barcodes to packs**
- **Objective:** a barcode can belong to a pack; pack barcodes are never primary.
- **Location:** the O-1 migration.
- **Change (exact SQL):**
```sql
ALTER TABLE catalog.variant_barcodes
    ADD COLUMN variant_unit_id bigint NULL REFERENCES catalog.variant_units (id);

ALTER TABLE catalog.variant_barcodes
    ADD CONSTRAINT variant_barcodes_pack_never_primary
        CHECK (variant_unit_id IS NULL OR NOT is_primary);

CREATE INDEX variant_barcodes_variant_unit_idx ON catalog.variant_barcodes (variant_unit_id);

CREATE FUNCTION catalog._check_barcode_pack_variant() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
    IF NEW.variant_unit_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM catalog.variant_units vu
         WHERE vu.id = NEW.variant_unit_id AND vu.variant_id = NEW.variant_id) THEN
        RAISE EXCEPTION 'PACK_BARCODE_VARIANT_MISMATCH: pack % does not belong to variant %',
            NEW.variant_unit_id, NEW.variant_id USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION catalog._check_barcode_pack_variant() FROM PUBLIC;

CREATE TRIGGER variant_barcodes_check_pack_variant
    BEFORE INSERT OR UPDATE OF variant_unit_id, variant_id ON catalog.variant_barcodes
    FOR EACH ROW EXECUTE FUNCTION catalog._check_barcode_pack_variant();
```
- **Logic:** global barcode uniqueness stays on the existing `normalized_barcode` unique constraint (S2), so a pack barcode can never equal a piece barcode.
- **Depends on:** O-1.2.
- **Expected result:** existing barcodes all have `variant_unit_id NULL`.
- **Pitfalls:** S3 and S4 can make a barcode primary automatically — handled in O-1.6 (new insert path) and O-1.8 (patched promotion). The CHECK above turns any missed path into a loud error instead of a silent wrong primary.
- **Edge cases:** deleting a pack that has barcodes — the FK blocks it; `remove_pack` and the patched `remove_variant_alt_unit` delete the pack's barcodes first.
- **Verify:** T4–T6.

---

**O-1.4 — Lock the base unit once alternate units exist (D12)**
- **Objective:** factors can never silently change meaning.
- **Location:** the O-1 migration.
- **Change:**
```sql
CREATE FUNCTION catalog._forbid_base_unit_change_with_packs() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
    IF TG_TABLE_NAME = 'products' AND NEW.unit_id IS DISTINCT FROM OLD.unit_id AND EXISTS (
        SELECT 1 FROM catalog.variant_units vu JOIN catalog.product_variants pv ON pv.id = vu.variant_id
         WHERE pv.product_id = NEW.id) THEN
        RAISE EXCEPTION 'PRODUCT_UNIT_LOCKED_BY_PACKS: product % has packs or alternate units', NEW.id
            USING ERRCODE = '22023';
    END IF;
    IF TG_TABLE_NAME = 'product_variants' AND NEW.base_unit_id IS DISTINCT FROM OLD.base_unit_id AND EXISTS (
        SELECT 1 FROM catalog.variant_units vu WHERE vu.variant_id = NEW.id) THEN
        RAISE EXCEPTION 'PRODUCT_UNIT_LOCKED_BY_PACKS: variant % has packs or alternate units', NEW.id
            USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION catalog._forbid_base_unit_change_with_packs() FROM PUBLIC;

CREATE TRIGGER products_lock_unit_with_packs BEFORE UPDATE OF unit_id ON catalog.products
    FOR EACH ROW EXECUTE FUNCTION catalog._forbid_base_unit_change_with_packs();
CREATE TRIGGER product_variants_lock_base_unit_with_packs BEFORE UPDATE OF base_unit_id ON catalog.product_variants
    FOR EACH ROW EXECUTE FUNCTION catalog._forbid_base_unit_change_with_packs();
```
- **Logic:** a trigger instead of editing `update_product` (which must not change — section 5.5).
- **Depends on:** O-1.1.
- **Expected result:** updating the unit of a product with packs raises `22023`; products without packs are unaffected.
- **Pitfalls:** existing tests that change a product's unit **after** adding an alternate unit would now fail — search the test files for `update_product` / `set_variant_base_unit` calls that happen after `add_variant_alt_unit`; if any exist, STOP and report (do not weaken the trigger).
- **Edge cases:** updating other columns of the product fires nothing (`UPDATE OF unit_id` only fires when the column is in the SET list, and the `IS DISTINCT FROM` check ignores same-value updates).
- **Verify:** T7, T8.

---

**O-1.5 — Private helpers (owner-only, no grant)**
- **Objective:** one place for each rule, reused by every pack function and later by O-3/O-4.
- **Location:** the O-1 migration. Each: `LANGUAGE plpgsql` (or `sql`), `SECURITY DEFINER SET search_path = pg_catalog`, then `REVOKE ALL ON FUNCTION … FROM PUBLIC;`.
- **Change:**

| Function | Returns | Exact behaviour |
|---|---|---|
| `catalog._variant_base_unit(p_variant_id bigint)` | `TABLE (unit_id bigint, unit_code text, unit_name text, is_whole boolean)` | `SELECT u.id, u.code, u.name, <whole expression from G2> FROM catalog.product_variants pv JOIN catalog.products p ON p.id = pv.product_id JOIN catalog.units u ON u.id = p.unit_id WHERE pv.id = p_variant_id`. No row → caller raises `PACK_VARIANT_NOT_FOUND`. `STABLE`. |
| `catalog._validate_pack_factor(p_factor numeric, p_is_whole boolean)` | `void` | NULL, `<= 1`, `> 100000` or `<> round(p_factor, 6)` → `PACK_FACTOR_INVALID`; `p_is_whole AND p_factor <> trunc(p_factor)` → `PACK_FACTOR_NOT_WHOLE`. `IMMUTABLE`. |
| `catalog._validate_amount(p_amount numeric, p_code text)` | `void` | `p_amount < 0` or `p_amount <> round(p_amount, 2)` or `p_amount > 999999999999.99` → raise `<p_code>: amount % is not valid`. NULL passes (caller decides). `IMMUTABLE`. |
| `catalog._pack_rate(p_amount numeric, p_factor numeric, p_scale integer)` | `numeric` | `RETURN round(p_amount / p_factor, p_scale);` (`p_scale` must be 0 or 2, else `PACK_RATE_SCALE_INVALID`). `IMMUTABLE`. Used by O-3 (scale 2) and O-4 (scale 0). |
| `catalog._pack_is_used(p_variant_unit_id bigint)` | `boolean` | Look up `(variant_id, unit_id)` of the pack; return true when that pair exists in **every posted table found in G9** (at least `procurement.purchase_receipt_lines(variant_id, unit_id)` and `inventory.stock_adjustments(variant_id, unit_id)`; add every other table G9 found, joined the same way). O-4 replaces this function to also check sale lines. `STABLE`. |
| `catalog._reassign_primary_pack(p_variant_id bigint)` | `void` | If no row of the variant has `is_primary`, set `is_primary = true` on the active pack (`conversion_factor > 1`) with the largest factor, then smallest id. If none, do nothing. |
| `catalog._set_primary_pack(p_variant_unit_id bigint)` | `void` | Read `variant_id`; `UPDATE … SET is_primary = false WHERE variant_id = v AND is_primary AND id <> p_variant_unit_id;` **then** `UPDATE … SET is_primary = true WHERE id = p_variant_unit_id;` (order matters for the unique index). |

- **Depends on:** O-1.2.
- **Expected result:** all helpers exist; `stockiha_runtime` cannot execute them.
- **Pitfalls:** `trunc()` on a numeric with scale 6 works exactly; do not cast to float.
- **Edge cases:** factor `12.000000` is whole; `12.5` is not; `1.000000` is invalid (not a pack).
- **Verify:** T9–T14.

---

**O-1.6 — Public pack functions (writes)**
- **Objective:** everything O-2 needs to manage packs.
- **Location:** the O-1 migration; each function follows 7.2 with permission `MANAGE_CATALOG`; `GRANT EXECUTE … TO stockiha_runtime`.
- **Change — exact behaviour, in this order inside each function:**

**`catalog.create_pack(p_session_token text, p_variant_id bigint, p_unit_id bigint, p_conversion_factor numeric, p_sale_price numeric, p_make_primary boolean) RETURNS bigint`**
1. Permission check.
2. `SELECT 1 FROM catalog.product_variants WHERE id = p_variant_id FOR UPDATE;` not found → `PACK_VARIANT_NOT_FOUND`. (The row lock serialises concurrent pack edits of one variant.)
3. Base unit via `_variant_base_unit`.
4. Unit exists (and is active, if G2 found an active column) → else `PACK_UNIT_NOT_FOUND`.
5. `p_unit_id = base.unit_id` → `PACK_UNIT_IS_BASE`.
6. `_validate_pack_factor(p_conversion_factor, base.is_whole)`.
7. `_validate_amount(p_sale_price, 'PACK_PRICE_INVALID')`.
8. `INSERT INTO catalog.variant_units (variant_id, unit_id, conversion_factor, sale_price) … RETURNING id;` — catch `unique_violation` → `PACK_DUPLICATE_UNIT`.
9. If `coalesce(p_make_primary, false)` → `_set_primary_pack(new id)`; else `_reassign_primary_pack(p_variant_id)`.
10. Return the new id.

**`catalog.update_pack(p_session_token text, p_variant_unit_id bigint, p_conversion_factor numeric, p_sale_price numeric) RETURNS void`**
1. Permission. 2. Lock the pack row `FOR UPDATE`; not found → `PACK_NOT_FOUND`. 3. If `p_conversion_factor <> current factor`: `_pack_is_used` → `PACK_IN_USE`; `_validate_pack_factor`; update the factor. 4. `_validate_amount(p_sale_price, 'PACK_PRICE_INVALID')`; set `sale_price = p_sale_price` (NULL makes it buy-only). 5. `_reassign_primary_pack(variant)` (a factor change never makes a factor ≤ 1, so the main pack stays valid).

**`catalog.set_pack_primary(p_session_token text, p_variant_unit_id bigint) RETURNS void`**
Permission; pack exists (`PACK_NOT_FOUND`); must be active and factor > 1 (`PACK_NOT_ACTIVE`); `_set_primary_pack`.

**`catalog.set_pack_active(p_session_token text, p_variant_unit_id bigint, p_is_active boolean) RETURNS void`**
Permission; pack exists; if `p_is_active = false`: `UPDATE … SET is_primary = false, is_active = false`; then `_reassign_primary_pack`. If true: `UPDATE … SET is_active = true`; then `_reassign_primary_pack`.

**`catalog.remove_pack(p_session_token text, p_variant_unit_id bigint) RETURNS void`**
Permission; pack exists; `_pack_is_used` → `PACK_IN_USE` (the owner deactivates instead); `DELETE FROM catalog.variant_barcodes WHERE variant_unit_id = p_variant_unit_id;` `DELETE FROM catalog.variant_units WHERE id = …;` `_reassign_primary_pack(variant)`.

**`catalog.add_pack_barcode(p_session_token text, p_variant_unit_id bigint, p_barcode text) RETURNS bigint`**
Permission; pack exists and is active (`PACK_NOT_FOUND` / `PACK_NOT_ACTIVE`); `v_norm := upper(btrim(coalesce(p_barcode,'')))`; empty → `PACK_BARCODE_BLANK`; `INSERT INTO catalog.variant_barcodes (variant_id, barcode, normalized_barcode, is_primary, variant_unit_id) VALUES (<pack's variant>, btrim(p_barcode), v_norm, false, p_variant_unit_id) RETURNING id;` — catch `unique_violation` → `PACK_BARCODE_DUPLICATE`. **Do not call `catalog._insert_barcode`** (S3 would make it primary).

Removing a pack barcode uses the existing `catalog.remove_variant_barcode` (patched in O-1.8).

- **Depends on:** O-1.5.
- **Expected result:** tests T15–T30 pass.
- **Pitfalls:** catching `unique_violation` around the wrong statement; forgetting `_reassign_primary_pack` after deactivate/remove.
- **Edge cases:** two admins adding the same unit to the same variant at once → the row lock + unique constraint produce one success and one `PACK_DUPLICATE_UNIT`. Removing the only pack → variant has no main pack (correct).
- **Verify:** T15–T30.

---

**O-1.7 — Public pack functions (reads)**
- **Objective:** screens can list packs and show main-pack stock.
- **Location:** the O-1 migration; `STABLE`, `iam.resolve_session`, grant to runtime.
- **Change:**

**`catalog.list_variant_packs(p_session_token text, p_variant_id bigint)`** `RETURNS TABLE (variant_unit_id bigint, unit_id bigint, unit_code text, unit_name text, conversion_factor numeric, sale_price numeric, is_pack boolean, is_primary boolean, is_active boolean, is_used boolean, barcode_ids bigint[], barcodes text[])` — one row per `catalog.variant_units` row of the variant (packs **and** smaller alternate units), `is_pack = conversion_factor > 1`, `is_used = catalog._pack_is_used(id)`, barcode arrays from `variant_barcodes WHERE variant_unit_id = vu.id ORDER BY id` with `coalesce(array_agg(...), '{}')`. Order: `is_primary DESC, is_pack DESC, conversion_factor DESC, variant_unit_id ASC`. Unknown variant → empty result (no error).

**`catalog.get_primary_packs(p_session_token text, p_variant_ids bigint[])`** `RETURNS TABLE (variant_id bigint, variant_unit_id bigint, unit_code text, unit_name text, conversion_factor numeric, sale_price numeric, base_unit_code text, base_unit_name text)` — `cardinality(p_variant_ids) > 500` → `PACK_REQUEST_TOO_LARGE`; NULL or empty array → empty result; returns one row per variant in the array that has a main pack; base unit via `catalog.products.unit_id`.

- **Depends on:** O-1.5.
- **Expected result:** T31–T34.
- **Pitfalls:** `array_agg` of zero rows is NULL — always `coalesce(…, '{}')`.
- **Edge cases:** duplicate ids in the array → one row per variant (use `DISTINCT` / `= ANY`).
- **Verify:** T31–T34.

---

**O-1.8 — Patch existing barcode and alternate-unit functions (same signatures)**
- **Objective:** existing paths cannot corrupt pack barcodes or the main pack.
- **Location:** the O-1 migration, `CREATE OR REPLACE` with the **live** body from G5, edited only as stated.
- **Change:**
  1. `catalog.remove_variant_barcode`: in the promotion query (S4), change `WHERE variant_id = v_variant_id` to `WHERE variant_id = v_variant_id AND variant_unit_id IS NULL`. Nothing else.
  2. `catalog.remove_variant_alt_unit`: before its `DELETE FROM catalog.variant_units`, add `DELETE FROM catalog.variant_barcodes WHERE variant_unit_id = p_variant_unit_id;`; capture the variant id first; after the delete add `PERFORM catalog._reassign_primary_pack(<variant id>);`. Keep its current error messages and rules (no usage check — D17).
  3. `catalog.add_variant_alt_unit`: after its `INSERT`, add `PERFORM catalog._reassign_primary_pack(p_variant_id);`. Keep its current validation (it still accepts factor 0.001 — D17).
- **Depends on:** O-1.5.
- **Expected result:** the existing suite `tests/catalog/s2_001_catalog_integration.sql` still passes unchanged.
- **Pitfalls:** copying an old body from a migration file instead of the live body (G5) — re-introduces fixed bugs.
- **Edge cases:** removing the primary **piece** barcode when only pack barcodes remain → no piece barcode becomes primary; display identifier falls back to SKU (correct).
- **Verify:** T35–T37 plus the unchanged existing suites.

---

**O-1.9 — Extend `catalog.resolve_barcode` with pack columns**
- **Objective:** a scanned pack barcode tells the caller which pack it is.
- **Location:** the O-1 migration.
- **Change:** `DROP FUNCTION catalog.resolve_barcode(<live parameter types>);` then `CREATE FUNCTION` with the **same name, same parameters, same existing output columns in the same order and with the same names and types**, plus these columns **appended at the end**:
  `pack_variant_unit_id bigint, pack_unit_id bigint, pack_unit_code text, pack_unit_name text, pack_factor numeric, pack_sale_price numeric, pack_is_active boolean`.
  Body = live body with: in the **barcode branch**, `LEFT JOIN catalog.variant_units pk ON pk.id = b.variant_unit_id LEFT JOIN catalog.units pku ON pku.id = pk.unit_id` and select `pk.id, pk.unit_id, pku.code, pku.name, pk.conversion_factor, pk.sale_price, pk.is_active`; in the **SKU branch**, select seven `NULL`s with explicit casts (`NULL::bigint`, `NULL::text`, `NULL::numeric`, `NULL::boolean`). Keep every existing filter. Re-issue `REVOKE ALL … FROM PUBLIC` and `GRANT EXECUTE … TO stockiha_runtime` with the exact signature.
- **Logic:** name-based row decoding ignores new columns, so existing callers keep working; positional (tuple) callers found in G8 must be updated in O-1.11.
- **Depends on:** O-1.3.
- **Expected result:** scanning `6131000000021` returns V1 plus `pack_unit_code 'CTN'`, `pack_factor 12`, `pack_sale_price 15000.00`; scanning `6131000000014` returns V1 with the seven pack columns NULL.
- **Pitfalls:** `CREATE OR REPLACE` cannot change a return type — it must be `DROP` + `CREATE`; forgetting the grant makes every scan fail at runtime.
- **Edge cases:** a barcode of an **inactive** pack still resolves, with `pack_is_active = false` (the till refuses it in O-4 with a clear message).
- **Verify:** T38–T40.

---

**O-1.10 — Units used as packs count as "in use"**
- **Objective:** a unit used by any pack cannot be deleted (ws-d-skill §3).
- **Location:** the function(s) found in G7, `CREATE OR REPLACE` with the live body.
- **Change:** wherever the unit usage count is computed, add `+ (SELECT count(*) FROM catalog.variant_units vu WHERE vu.unit_id = <unit id expression>)` if it is not already counted. If G7 found nothing, skip and say so.
- **Depends on:** O-1.2.
- **Expected result:** deleting unit `CTN` while V1 has a Carton pack is refused (usage_count > 0).
- **Pitfalls:** double counting if the function already counts `variant_units` — read it first.
- **Verify:** T41.

---

**O-1.11 — Rust services and commands**
- **Objective:** React can call the new functions.
- **Location:** `src-tauri/src/application/catalog.rs` (services), `src-tauri/src/commands/catalog.rs` (commands), `src-tauri/src/lib.rs` (registration), plus `build.rs`/capabilities if G11 says commands are listed there.
- **Change:** follow the S16 pattern exactly. Services (each binds **every** parameter with an explicit SQL cast, e.g. `SELECT catalog.create_pack($1::text, $2::bigint, $3::bigint, $4::numeric, $5::numeric, $6::boolean)`):

| Command (Tauri name = Rust fn) | Parameters (after `state`, `session_token: String`) | Returns |
|---|---|---|
| `create_pack` | `variant_id: i64, unit_id: i64, conversion_factor: Decimal, sale_price: Option<Decimal>, make_primary: bool` | `i64` |
| `update_pack` | `variant_unit_id: i64, conversion_factor: Decimal, sale_price: Option<Decimal>` | `()` |
| `set_pack_primary` | `variant_unit_id: i64` | `()` |
| `set_pack_active` | `variant_unit_id: i64, is_active: bool` | `()` |
| `remove_pack` | `variant_unit_id: i64` | `()` |
| `add_pack_barcode` | `variant_unit_id: i64, barcode: String` | `i64` |
| `list_variant_packs` | `variant_id: i64` | `Vec<VariantPackDto>` |
| `get_primary_packs` | `variant_ids: Vec<i64>` (Rust rejects > 500 with `AppError::ValidationError` before calling SQL) | `Vec<PrimaryPackDto>` |

  Row structs `#[derive(sqlx::FromRow)]` with fields named exactly like the SQL columns; `numeric` → `Decimal`, nullable → `Option<Decimal>`, `bigint[]` → `Vec<i64>`, `text[]` → `Vec<String>`. Response DTOs `#[derive(Serialize)]` convert every `Decimal` to `String` with `.to_string()` (same as the existing `StockAdjustmentUnit.conversion_factor`), `Option<Decimal>` to `Option<String>`.
  Update the `resolve_barcode` row struct(s) found in G8: add the seven `Option<…>` fields; update the response DTO with the same seven fields (`Option<i64>`/`Option<String>`/`Option<bool>`); update every positional decoder found in G8 to the struct.
  Register all eight commands in `src-tauri/src/lib.rs` next to `add_variant_alt_unit`.
- **Depends on:** O-1.6, O-1.7, O-1.9.
- **Expected result:** `cargo check`, `clippy`, `cargo test --lib` pass.
- **Pitfalls:** an unregistered command fails silently at runtime; binding an `Option<Decimal>` without a cast on an overloaded name.
- **Edge cases:** `sale_price: None` must reach SQL as NULL (clears the price).
- **Verify:** 7.9 commands; contract triangle in the report.

---

**O-1.12 — TypeScript contracts**
- **Location:** `src/shared/ipc/commands.ts`, `src/shared/ipc/dto.ts`, `src/shared/ipc/gateway.ts`.
- **Change:**
  - `commands.ts`: `CREATE_PACK: 'create_pack'`, `UPDATE_PACK: 'update_pack'`, `SET_PACK_PRIMARY: 'set_pack_primary'`, `SET_PACK_ACTIVE: 'set_pack_active'`, `REMOVE_PACK: 'remove_pack'`, `ADD_PACK_BARCODE: 'add_pack_barcode'`, `LIST_VARIANT_PACKS: 'list_variant_packs'`, `GET_PRIMARY_PACKS: 'get_primary_packs'`.
  - `dto.ts`:
```ts
export interface VariantPack {
  variant_unit_id: number; unit_id: number; unit_code: string; unit_name: string;
  conversion_factor: string; sale_price: string | null;
  is_pack: boolean; is_primary: boolean; is_active: boolean; is_used: boolean;
  barcode_ids: number[]; barcodes: string[];
}
export interface PrimaryPack {
  variant_id: number; variant_unit_id: number; unit_code: string; unit_name: string;
  conversion_factor: string; sale_price: string | null; base_unit_code: string; base_unit_name: string;
}
```
    and add to `ResolvedBarcode`: `pack_variant_unit_id: number | null; pack_unit_id: number | null; pack_unit_code: string | null; pack_unit_name: string | null; pack_factor: string | null; pack_sale_price: string | null; pack_is_active: boolean | null;`
  - `gateway.ts`: `createPack(sessionToken, variantId, unitId, conversionFactor: string, salePrice: string | null, makePrimary: boolean): Promise<number>`, `updatePack(sessionToken, variantUnitId, conversionFactor: string, salePrice: string | null): Promise<void>`, `setPackPrimary(sessionToken, variantUnitId): Promise<void>`, `setPackActive(sessionToken, variantUnitId, isActive: boolean): Promise<void>`, `removePack(sessionToken, variantUnitId): Promise<void>`, `addPackBarcode(sessionToken, variantUnitId, barcode: string): Promise<number>`, `listVariantPacks(sessionToken, variantId): Promise<VariantPack[]>`, `getPrimaryPacks(sessionToken, variantIds: number[]): Promise<PrimaryPack[]>` — each `call<…>(COMMANDS.X, { sessionToken, …camelCaseArgs })`.
- **Verify:** `npm run typecheck`.

---

**O-1.13 — Exact pack arithmetic for the screens: `src/shared/utils/packMath.ts`**
- **Objective:** screens can split stock into packs and preview line totals exactly (D13).
- **Location:** new files `src/shared/utils/packMath.ts` and `src/shared/utils/packMath.test.ts`.
- **Change:** implement exactly the functions of **Appendix B**, using `BigInt` only (no `Number` arithmetic on amounts).
- **Depends on:** nothing.
- **Expected result:** every example of Appendix B passes in Vitest.
- **Pitfalls:** `BigInt('12.5')` throws — always parse through `parseScaled`; JavaScript `/` on BigInt truncates toward zero (inputs are non-negative, so this is floor).
- **Verify:** `npm test`.

---

**O-1.14 — SQL test suite**
- **Location:** new `src-tauri/tests/catalog/ws_o_1_pack_catalogue_integration.sql`, added to `run_current_sql_suites.sh` (7.10).
- **Setup:** admin session `'wsoadmin'` (role holding `MANAGE_CATALOG`), no-permission session `'wsonoperm'` (a user with **no** role); units CTN, BAL, KG (decimal), SAC, and one more unit `DZN`; products/variants V1, V2, V3 of 7.11 plus **V4** "Test legacy" (base `UNIT`, price 100.00), created with the live catalogue creation function found in G5 (pass every parameter explicitly). For T25, copy the supplier / warehouse / fiscal-period setup pattern of `src-tauri/tests/procurement/direct_purchase_acceptance_integration.sql`. Run the tests **in the table order**; later rows depend on earlier ones.
- **Tests (each must assert the exact result):**

| # | Action | Expected |
|---|---|---|
| T1 | After the migration, over the whole database: `SELECT variant_id FROM catalog.variant_units WHERE is_active AND conversion_factor > 1 GROUP BY variant_id HAVING count(*) FILTER (WHERE is_primary) <> 1` | no rows |
| T2 | Legacy `add_variant_alt_unit(V4, KG, 0.001)` on V4 (no other unit) | row created, **not** primary; V4 has no primary |
| T3 | Two primaries on one variant via direct UPDATE | unique violation `23505` |
| T4 | `create_pack(V1, CTN, 12, 15000.00, true)` | id returned; `is_primary` true; `sale_price` 15000.00 |
| T5 | `add_pack_barcode(CTN pack, '6131000000021')` | row with `variant_unit_id` set, `is_primary` false |
| T6 | `add_pack_barcode(…, ' 6131000000014 ')` (V1 piece barcode) | `22023` (`PACK_BARCODE_DUPLICATE`) |
| T7 | change V1's product unit while it has packs | `22023` |
| T8 | change unit of a product with no packs | succeeds |
| T9 | `_validate_pack_factor(1, true)` / `(0.5,true)` / `(100001,true)` / `(12.1234567,false)` | `22023` each |
| T10 | `_validate_pack_factor(12.5, true)` | `22023` (`PACK_FACTOR_NOT_WHOLE`) |
| T11 | `_validate_pack_factor(12.5, false)` | passes |
| T12 | `_pack_rate(15000.00, 12, 0)` / `(9000.00, 7, 0)` / `(9006.00, 12, 0)` / `(7500.00, 7, 2)` / `(12600.00, 12, 2)` | `1250` / `1286` / `751` / `1071.43` / `1050.00` |
| T13 | `_pack_rate(x, y, 1)` | `22023` |
| T14 | `_validate_amount(-1,…)` / `(10.123,…)` | `22023` |
| T15 | `create_pack(V1, BAL, 50, NULL, false)` | created; not primary (CTN stays primary) |
| T16 | `create_pack(V1, CTN, 24, …)` again | `22023` (`PACK_DUPLICATE_UNIT`) |
| T17 | `create_pack(V1, UNIT, 12, …)` | `22023` (`PACK_UNIT_IS_BASE`) |
| T18 | `create_pack(V2, CTN, 7, 9000.00, false)` on V2 with no pack | created **and primary** (first pack) |
| T19 | `create_pack(V3, SAC, 25, 20000.00, true)` (decimal base) | created |
| T20 | `create_pack(V3, DZN, 2.5, NULL, false)` | created (decimal base allows 2.5) |
| T21 | `create_pack(V1, DZN, 2.5, …)` | `22023` (whole base) |
| T22 | `create_pack` with session `'wsonoperm'` | `42501` |
| T23 | `update_pack(V1 CTN, 12, 14800.00)` | price 14800.00 |
| T24 | `update_pack(V1 BAL, 40, NULL)` (BAL not used) | BAL factor 40.000000 |
| T25 | post a direct purchase of 1 CTN of V1 (live purchase function, all params explicit), then `update_pack(V1 CTN, 12, …)` | `22023` (`PACK_IN_USE`) |
| T26 | `remove_pack(V1 CTN)` after T25 | `22023` (`PACK_IN_USE`) |
| T27 | `set_pack_active(V1 CTN, false)` | inactive, not primary; BAL becomes primary |
| T28 | `set_pack_primary(V1 CTN)` while inactive | `22023` (`PACK_NOT_ACTIVE`) |
| T29 | `set_pack_active(V1 CTN, true)` then `set_pack_primary(V1 CTN)` | CTN primary, BAL not |
| T30 | `remove_pack(V1 BAL)` (unused) | deleted |
| T31 | `list_variant_packs(V1)` | 1 row CTN: factor `12.000000`, is_pack true, is_primary true, is_used true, barcodes `{6131000000021}` |
| T32 | `list_variant_packs(V3)` | 2 rows, SAC first (primary) |
| T33 | `get_primary_packs(ARRAY[V1,V2,V3,V1])` | 3 rows (V1 CTN, V2 CTN, V3 SAC), base unit names filled |
| T34 | `get_primary_packs` with 501 ids | `22023` |
| T35 | remove V1's **piece** barcode (primary) with `remove_variant_barcode` while the pack barcode exists | no barcode of V1 is primary; pack barcode untouched |
| T36 | legacy `add_variant_alt_unit(V4, CTN, 12)` (V4 has no pack yet) then `add_pack_barcode(<that pack>, '6131000000038')` | pack created **and primary**; barcode linked |
| T37 | legacy `remove_variant_alt_unit(<V4 CTN pack>)` | pack and barcode `6131000000038` deleted; V4 has no primary (only the 0.001 unit remains) |
| T38 | `resolve_barcode('6131000000021')` | V1 + `pack_unit_code 'CTN'`, `pack_factor 12.000000`, `pack_sale_price 14800.00`, `pack_is_active true` |
| T39 | `resolve_barcode('6131000000014')` (re-add the piece barcode first) | V1, seven pack columns NULL |
| T40 | `resolve_barcode(<V1 SKU>)` | V1 by SKU, pack columns NULL |
| T41 | delete unit CTN through the live unit delete function | refused (in use) |

- **Verify:** `bash src-tauri/tests/run_current_sql_suites.sh` output.

---

**O-1.15 — Marker, verification, build, report**
- Set `[ version = WS-O-1.1 ]`; run 7.9; build the installer; write the report (section 17).

### O-1 data flow (for reference in O-2 and O-4)
- **Create a pack:** Pack form (O-2) → `gateway.createPack` → `invoke('create_pack')` → `commands::catalog::create_pack` → `application::catalog::create_pack` → `SELECT catalog.create_pack(...)` → validations → `INSERT catalog.variant_units` → primary logic → id → React reloads `listVariantPacks`.
- **Scan a pack barcode:** scanner → existing search/till code → `resolve_barcode` (unchanged command name) → SQL barcode branch joins the pack → row with pack columns → O-4 adds one pack line.

### O-1 acceptance criteria
1. The migration applies on an empty database and on `stockiha_acceptance`.
2. All tests T1–T41 pass; every pre-existing SQL suite still passes **unchanged**.
3. No new barcode can become primary through a pack; the CHECK `variant_barcodes_pack_never_primary` exists.
4. `resolve_barcode` returns the same values as before for piece barcodes and SKUs, plus NULL pack columns.
5. `packMath.test.ts` passes every Appendix B example.
6. Contract triangle reported for the 8 new functions and the changed `resolve_barcode`.
7. No change to files listed in section 5.

### O-1 stop conditions
Gate 0 stop rules; an existing test needs changing to pass; a function in section 5.5 would need editing; two fix attempts fail on the same problem.

---

## 9. Sub-plan O-2 — Pack setup screens

**Goal:** the owner can give each product its boxes (unit, how many pieces, box price, box barcode, main box) from the product screens, including quick add.

**Branch:** `task/ws-o-2-pack-setup-ui` from the accepted O-1 branch. **Marker:** `[ version = WS-O-2.1 ]`.

### O-2.0 Gate 0
| # | Find | Stop if |
|---|---|---|
| G1 | The product **advanced editor** screen and where it shows a variant's alternate units today (snapshot: `src/features/products/ProductEditor.tsx`, `VariantForm.tsx`, `UnitManager.tsx` with props `units, baseUnitId, altUnits`). Record the live file paths and components. | no place in the editor shows per-variant data |
| G2 | The variant **barcode list** component (snapshot: `src/features/products/BarcodeManager.tsx`) and the function that loads it (snapshot: `catalog.get_product_detail`, which returns **all** barcodes of the variant, including future pack barcodes). | — |
| G3 | The **quick add** form and the function it calls (ws-d-skill: `catalog.quick_create_product`); how it returns the new variant id. | the new variant id is not returned to React |
| G4 | How the units list reaches React (`list_units` or its live replacement) and whether the Unit DTO carries the decimal/whole flag and the active flag. | the flag is not available to React (then STOP: O-2 needs it for the whole-number rule) |
| G5 | i18n: file(s) under `src/shared/i18n/` and the key naming style (e.g. `products.editor.title`). | — |
| G6 | Existing UI building blocks listed in `DESIGN.md` (table, dialog, text input, money input, radio, switch, toast, inline error, skeleton). | — |
| G7 | Whether any other screen imports `UnitManager.tsx`. | — |

### O-2 steps

---

**O-2.1 — Decimal input normaliser and pack validation (front-end mirror of 7.5)**
- **Objective:** friendly, specific messages before any backend call (D16).
- **Location:** new `src/features/products/packValidation.ts` and `packValidation.test.ts`.
- **Change:** export
  - `normalizeDecimalInput(text: string): string | null` — trim; replace a single `,` with `.`; must then match `^\d+(\.\d+)?$`; else `null`. (`"12,5"` → `"12.5"`, `" 15000 "` → `"15000"`, `"1 500"` → `null`, `"-3"` → `null`, `"1.2.3"` → `null`.)
  - `validatePackForm(input: { unitId: number | null; factorText: string; priceText: string; barcodeText: string }, ctx: { baseUnitId: number; baseIsWhole: boolean; usedUnitIds: number[]; factorLocked: boolean }): { unitId?: I18nKey; factor?: I18nKey; price?: I18nKey; barcode?: I18nKey }` implementing, in this order: unit required → `pack.error.unitRequired`; unit = base → `pack.error.unitIsBase`; unit already used by another pack of this variant → `pack.error.unitAlreadyUsed`; factor (skipped when `factorLocked`): empty → `pack.error.factorRequired`, not a decimal → `pack.error.factorInvalid`, ≤ 1 → `pack.error.factorTooSmall`, > 100000 → `pack.error.factorTooLarge`, more than 6 decimals → `pack.error.factorDecimals`, not whole while `baseIsWhole` → `pack.error.factorWhole`; price (optional): not empty and (not a decimal or more than 2 decimals) → `pack.error.priceInvalid`; barcode (optional): only spaces → `pack.error.barcodeBlank`.
- **Depends on:** O-1.13 (uses `parseScaled` for decimal counting).
- **Expected result / verify:** unit tests for every branch above plus the six `normalizeDecimalInput` examples.
- **Pitfalls:** do not use `parseFloat`/`Number()` for comparisons — use `packMath` (compare scaled BigInts).

---

**O-2.2 — `PackManager` component**
- **Objective:** one panel per variant to see and manage its packs.
- **Location:** new `src/features/products/PackManager.tsx` (+ `PackManager.test.tsx`).
- **Props:** `variantId: number`, `baseUnit: { id: number; code: string; name: string; isWhole: boolean }`, `pieceSalePrice: string` (the variant's price), `units: Unit[]` (all units with active flag), `sessionToken: string`.
- **Behaviour (exact):**
  1. On mount and after every successful change: `listVariantPacks(sessionToken, variantId)`.
  2. **Loading:** two skeleton rows. **Error:** inline error banner with the text from `useErrorText` and a **Retry** button. **Empty (no row with `is_pack`):** text `pack.empty` = "No packs. This product is bought and sold by the {base} only." and the **Add pack** button.
  3. **Title** `pack.title` = "Packs (boxes, cartons, bales)". **Help** `pack.help` = "A pack holds a fixed number of {base}. Stock is always counted in {base}."
  4. **Table** of rows with `is_pack = true`, columns: **Main** (radio; enabled only for active rows; choosing calls `setPackPrimary`) · **Unit** (`unit_name`) · **Holds** ("12 {base}", factor via `formatExactDecimal`) · **Sale price** (`formatDisplayAmount(sale_price)`, or `pack.notSold` = "Not sold (buy only)" when NULL) · **Per {base}** (`packRate(sale_price, factor, 0)` formatted; "—" when no price) · **Barcodes** (chips; each chip has × → confirm `pack.confirmRemoveBarcode` = "Remove this barcode?" → existing `removeVariantBarcode(barcodeId)`; a "+ Barcode" link opens a small input) · **Status** ("Active"/"Inactive") · **Actions**: **Edit**, **Deactivate**/**Activate** (`setPackActive`), **Delete** (visible only when `is_used = false`; confirm `pack.confirmDelete` = "Delete this pack? This cannot be undone."; calls `removePack`).
  5. Inactive rows are shown greyed below active rows.
  6. **Add pack** opens a dialog with fields: Unit (select of **active** units except the base unit and units already used by this variant) · Holds (text input, label "How many {base} in one pack") · Sale price (optional, label "Sale price for one pack") · Barcode (optional) · "Main pack" checkbox (checked and disabled when the variant has no active pack yet). Live helper under the price: `pack.perPiece` = "= {rate} per {base} (single {base}: {piecePrice})"; when `rate > pieceSalePrice` show the amber warning `pack.warn.ratehigher` = "This pack costs more per {base} than a single {base}." (warning only, saving allowed).
  7. **Save** runs `validatePackForm`; on errors, show them under the fields and stop. Then, if a barcode was typed: call `resolveBarcode(barcode)`; if it returns a row → show under the barcode field `pack.error.barcodeUsed` = "This barcode is already used by {product}." and stop. Then `createPack(...)`; then, if a barcode was typed, `addPackBarcode(newId, barcode)`. If `createPack` fails → error text in the dialog, dialog stays open. If only `addPackBarcode` fails → close the dialog, reload, and show a toast `pack.savedBarcodeFailed` = "Pack saved, but the barcode was not saved. Add it again from the pack row." On full success toast `pack.saved` = "Pack saved."
  8. **Edit** opens the same dialog pre-filled; Unit is read-only; when `is_used` the Holds field is disabled with the note `pack.inUse` = "Used in purchases or stock records — the quantity cannot change. Deactivate this pack and create a new one instead."; Save calls `updatePack(variantUnitId, factor, price or null)`.
  9. While any call is running, all buttons of the panel are disabled and the clicked button shows a spinner.
  10. **Smaller units** (rows with `is_pack = false`, e.g. gram 0.001): a small read-only list under the table titled `pack.smallerUnits` = "Other units", each with its factor and a **Remove** button calling the existing `removeVariantAltUnit` (legacy path, D17). Hidden when there are none.
- **Depends on:** O-1, O-2.1.
- **Expected result:** the owner can create "Carton, holds 12, 15,000.00, barcode 6131000000021, main".
- **Pitfalls:** reloading only the changed row (always reload the whole list — `is_used`/`is_primary` of other rows may change); showing buy-only packs in the "Main" radio (they may be main — allowed; the till then starts with pieces if the main pack has no price, see O-4.4).
- **Edge cases:** deactivating the main pack → another pack becomes main automatically (backend) — the reload shows it; removing the last barcode chip of a pack is allowed.
- **Verify:** `PackManager.test.tsx` with a mocked gateway: renders empty state; add flow calls `createPack` then `addPackBarcode` with exact arguments; barcode already used blocks the save and does not call `createPack`; `is_used` disables Holds; Delete hidden when `is_used`.

---

**O-2.3 — Put `PackManager` in the advanced editor**
- **Location:** the live component found in G1 that renders the alternate units (snapshot `UnitManager.tsx`).
- **Change:** render `PackManager` for the selected variant in place of the old alternate-units table. If G7 shows no other importer of `UnitManager.tsx`, delete that file; otherwise leave it and remove only this usage.
- **Must not change:** the rest of the editor (fields, save flow, variants, attributes).
- **Verify:** typecheck; the editor still saves a product exactly as before (existing tests pass).

---

**O-2.4 — Hide pack barcodes from the variant's piece barcode list**
- **Location:** the barcode list component found in G2.
- **Change:** the component receives the pack barcode ids (from `listVariantPacks`, all `barcode_ids` of all rows) and filters them out of the list it displays; under the list show the note `pack.barcodesElsewhere` = "Pack barcodes are managed in the Packs section." when at least one was filtered. **Do not modify** `catalog.get_product_detail` (section 5.5).
- **Edge cases:** a variant with only pack barcodes shows an empty piece-barcode list plus the note.
- **Verify:** component test with one piece barcode and one pack barcode → only the piece barcode is listed.

---

**O-2.5 — Quick add: "Sold by the box"**
- **Location:** the quick add form found in G3.
- **Change:** add a collapsed section `pack.quick.title` = "Sold by the box (optional)" with: Box unit (select, same filter as O-2.2 step 6) · Holds · Box price · Box barcode. Validate with `validatePackForm` (base unit = the unit chosen in the quick add form; `usedUnitIds = []`; `factorLocked = false`) **before** creating the product, and pre-check the barcode with `resolveBarcode`. After `quick_create_product` succeeds (unchanged call), call `createPack(newVariantId, unitId, factor, price or null, true)` then `addPackBarcode` if a barcode was typed.
- **Failure handling:** product created but `createPack` fails → keep the product, show the toast `pack.quick.productSavedPackFailed` = "Product saved, but the box was not saved. Open the product and add the box in Packs." Same rule for the barcode.
- **Must not change:** the quick add call itself, its fields and its validation.
- **Verify:** component test: with the section filled, `createPack` is called once with `makePrimary = true` after the product call resolves; with the section empty, no pack call happens.

---

**O-2.6 — Strings**
Add every key named in O-2.1 to O-2.5 (plus the field labels you add) to fr/ar/en with the English text in all three (7.7). List them in the report.

**O-2.7 — Marker, verification, build, report** (7.8, 7.9, section 17).

### O-2 data flow
Owner clicks **Add pack** → dialog → `validatePackForm` → `resolveBarcode` (uniqueness pre-check) → `createPack` → `addPackBarcode` → `listVariantPacks` reload → table updates; toast.

### O-2 acceptance criteria
1. From the advanced editor, the owner can add, edit (price always; holds only when unused), deactivate, re-activate, delete (unused only), choose the main pack and add/remove pack barcodes.
2. Every rule of 7.5 shows a specific message **before** any backend call.
3. Quick add can create a product with its box in one go; partial failure keeps the product and says what to do.
4. Pack barcodes never appear in the piece barcode list.
5. Nothing else in the product editor or quick add changed (existing tests pass).

### O-2 manual checks for the owner (include in the report)
1. Marker reads `[ version = WS-O-2.1 ]`.
2. Catalogue Setup → Units: create "Carton" (code CTN, whole numbers).
3. Open a pillow product → Packs → Add pack: Carton, holds 12, price 15000, barcode of a real box, Main. Expected: row shows "Holds 12 Unit", "15,000.00", "Per Unit 1,250.00".
4. Type holds `12,5` → error "… enter a whole number". Type price `15000.505` → price error.
5. Type the product's own piece barcode as the box barcode → "already used by …".
6. Quick add a new product with the box section filled → the product opens with its Carton pack as main.
7. **Do not scan box barcodes at the till yet** — the till learns boxes in O-4.

---

## 10. Sub-plan O-3 — Buy by the box

**Goal:** a purchase line can be "3 Carton + 4 Unit at 12,600.00 per Carton"; the extra units are costed at the carton rate; stock, WAC and totals are exact; purchase documents show it clearly.

**Branch:** `task/ws-o-3-buy-by-pack` from the accepted O-2 branch. **Marker:** `[ version = WS-O-3.1 ]`. Read `ws-b-skill` first.

### O-3.0 Gate 0
| # | Find | Stop if |
|---|---|---|
| G1 | Live signature and full body of `inventory.confirm_direct_purchase` (after WS-E); the exact line JSON keys it reads; where the payload hash is computed (Rust or SQL) and from which fields. | more than one live posting path for direct purchases |
| G2 | `\d procurement.purchase_receipt_lines` and its triggers (duplicate guard S8, immutability). | — |
| G3 | The Rust line struct and request builder for direct purchases (snapshot: `src-tauri/src/domain/procurement.rs`, `application/procurement_service.rs`) and how the hash payload is built. | — |
| G4 | The purchase entry screen (WS-E-1) file and how a line's unit is chosen today (snapshot showed alternate units "(x12)" in `PurchaseTransactionScreen.tsx`). | — |
| G5 | Supplier return (WS-E-3): live function and how the returned quantity becomes a stock movement (does it use the receipt line's `unit_id` factor?). **Run test R1 below on the unchanged code.** | **R1 fails** on the unchanged code (pre-existing WS-E bug with pack receipts — report it; do not fix it here) |
| G6 | Every place purchase lines are shown or printed: purchase detail modal, purchase history, A4 purchase document (WS-M), supplier return screen. The read function(s) they use (snapshot: `procurement.list_purchase_receipt_lines`) and whether they return `jsonb` or `TABLE`. | — |

**Test R1 (run in Gate 0 on the unchanged code, in a rolled-back transaction):** V1 has pack Carton 12. Direct purchase 2 Carton at 12,600.00 (unit = CTN). Stock V1 = 24. Supplier return of **1** from that receipt line through the live return function, with the unit the function expects. **Expected:** stock V1 = 12 and return value 12,600.00. Record the actual result.

### O-3 steps

---

**O-3.1 — Remember which lines were priced at a pack rate**
- **Location:** new migration `<timestamp>_ws_o_3_buy_by_pack.sql`.
- **Change:**
```sql
ALTER TABLE procurement.purchase_receipt_lines
    ADD COLUMN pack_rate_of_unit_id bigint NULL REFERENCES catalog.units (id);
```
- **Logic:** NULL for every existing and every normal line; set only on the extra-units line created in O-3.2. Adding a column does not fire the immutability triggers.
- **Verify:** `\d` shows the column; existing suites pass.

---

**O-3.2 — Expand "pack + extra units" into two purchase lines, in SQL**
- **Objective:** R8 with the cost rate computed in the database (D15).
- **Location:** same migration.
- **Change A — new private function** `procurement._expand_direct_purchase_lines(p_lines jsonb) RETURNS jsonb` (owner-only, `STABLE`):
  1. If `p_lines` is not a non-empty array → return it unchanged (the caller's existing validation reports it).
  2. For each element in order (keep order), read `variant_id`, `unit_id`, `quantity_received`, `unit_cost`, and `extra_base_quantity` (`nullif(elem->>'extra_base_quantity','')::numeric`, NULL or 0 = none).
  3. When there is no extra (NULL or 0): output the element unchanged, **minus** the key `extra_base_quantity`.
  4. When there is an extra:
     - base unit + whole flag via `catalog._variant_base_unit(variant_id)`; variant not found → leave the element unchanged (the caller reports "variant not found" as today);
     - `unit_id = base unit` → raise `PURCHASE_EXTRA_ON_BASE_LINE: line % …`;
     - factor from `catalog.variant_units (variant_id, unit_id)`; not found → leave unchanged (caller reports "no unit conversion" as today);
     - `quantity_received` not whole or `< 1` → `PURCHASE_PACK_QTY_NOT_WHOLE`;
     - extra `< 0`, `>= factor`, not whole for a whole base unit, or more than 3 decimals → `PURCHASE_EXTRA_QTY_INVALID`;
     - another element of `p_lines` with the same `variant_id` and `unit_id = base unit` → `PURCHASE_EXTRA_DUPLICATE_BASE_LINE`;
     - output two elements: the original minus `extra_base_quantity`, then `{"variant_id": v, "unit_id": <base unit id>, "quantity_received": "<extra>", "unit_cost": "<catalog._pack_rate(unit_cost, factor, 2)>", "pack_rate_of_unit_id": <pack unit id>}`.
  5. Line numbers in messages are 1-based positions in `p_lines`.
- **Change B — `CREATE OR REPLACE` of `inventory.confirm_direct_purchase`** with the **live body** (G1) and only these edits:
  1. The line loop reads `jsonb_array_elements(procurement._expand_direct_purchase_lines(p_lines))` instead of `jsonb_array_elements(p_lines)`.
  2. The `INSERT INTO procurement.purchase_receipt_lines (...)` adds column `pack_rate_of_unit_id` with value `nullif(v_input_line->>'pack_rate_of_unit_id','')::bigint`.
  3. Nothing else: the idempotency check, row locking (it already locks by the variant ids of `p_lines` — unchanged set), WAC arithmetic, journal and document numbering stay byte-for-byte as live.
- **If G1 shows the hash is computed in SQL** from a fixed list of keys: extend that list with `extra_base_quantity` **only for elements that contain the key** (old elements hash exactly as before — D8), following the pattern of O-4.5.
- **Depends on:** O-1 helpers, O-3.1.
- **Expected result:** worked example W3 below.
- **Pitfalls:** editing an old copy of the function instead of the live body; forgetting that the duplicate-line trigger (S8) is the final authority — the pre-check only gives a clearer message.
- **Edge cases:** extra with a buy-only pack (no sale price) — allowed (purchases do not need a sale price); inactive pack — existing conversion lookup rules apply (report what the live function does with inactive packs; do not change it).
- **Verify:** W3, E3-1…E3-6, R1 again after the change.

---

**O-3.3 — Rust and TypeScript line contract**
- **Location:** the Rust line struct and command DTO from G3; `src/shared/ipc/dto.ts` direct purchase line type.
- **Change:** add `extra_base_quantity: Option<Decimal>` with `#[serde(skip_serializing_if = "Option::is_none")]` to the Rust line struct used for **both** the SQL payload and the hash payload (so old lines serialize exactly as before — D8). TypeScript: `extra_base_quantity?: string`. The UI sends the key **only when the extra is greater than 0**.
- **Verify:** a Rust unit test: serializing a line without extra gives the same JSON string as before the change (hard-code the expected string); with extra `"4"` the JSON contains `"extra_base_quantity":"4"`.

---

**O-3.4 — Purchase entry screen**
- **Location:** the screen found in G4.
- **Change, per line (exact):**
  1. **Unit selector** options: the base unit (label `{base unit name}`) and every **active pack** (sellable or buy-only) from `listVariantPacks` (label `"{unit name} (×{factor})"`). Default when the product is added: the **main pack** if the variant has one, otherwise the base unit (R6).
  2. **Quantity** field label: `"{unit name}"` of the selected unit (e.g. "Carton").
  3. **Extra {base}** field (label `purchase.pack.extra` = "Extra {base}"), visible only when a pack is selected; default empty; must be `>= 0` and `< factor`, whole for whole base units.
  4. **Cost** field label `purchase.pack.costPer` = "Cost per {unit}".
  5. **Helper line** under the row (packMath): `purchase.pack.helper` = "= {baseQty} {base}" and, when extra > 0, "· extra at {rate} per {base} ({unit} rate)", with `rate = packRate(cost, factor, 2)`.
  6. **Line total preview:** `multiplyMoney(qty, cost) + multiplyMoney(extra, rate)`.
  7. Changing the unit clears Extra and keeps Quantity and Cost (the user re-types the cost for the new unit; show the cost field highlighted).
  8. Validation before submit (messages in UI, D16): pack quantity must be whole ≥ 1 when extra > 0 → `purchase.pack.error.packQtyWhole`; extra rule → `purchase.pack.error.extraInvalid` = "Extra {base} must be less than one {unit} ({factor})."; a base-unit line for the same product while another line of that product has extra > 0 → `purchase.pack.error.duplicateBase` = "Put these {base} in the Extra field of the {unit} line."
  9. Payload: `{ variant_id, unit_id, quantity_received, unit_cost }` plus `extra_base_quantity` only when > 0.
- **Must not change:** supplier selection, dates, payment fields (WS-E-2), totals section behaviour except that it now includes the extra part.
- **Verify:** component tests for defaults, helper text, validation messages and exact payload.

---

**O-3.5 — Show pack information on purchase lines everywhere they are displayed or printed**
- **Location:** read function(s) and screens from G6.
- **Change (backend):** the lines read function returns, per line, additionally: `unit_code`, `unit_name`, `conversion_factor` (1 for the base unit) and `pack_rate_unit_name` (name of `pack_rate_of_unit_id`, NULL otherwise). If it returns `jsonb`: add these keys with `CREATE OR REPLACE` (same signature). If it returns `TABLE`: `DROP` + `CREATE` with the columns **appended** and grants re-issued; update the Rust struct and TS type.
- **Change (display), one rule for every place in G6:**
  - normal line in a pack unit: `"{qty} {unit_name} (×{factor}) × {unit_cost} = {line_total}"`
  - normal line in the base unit: `"{qty} {unit_name} × {unit_cost} = {line_total}"` (unchanged look)
  - pack-rate line: `"{qty} {unit_name} × {unit_cost} ({pack_rate_unit_name} rate) = {line_total}"`
- **Verify:** screenshots are not possible from Linux — add these displays to the owner's manual checks; component tests for the three formats.

---

**O-3.6 — Tests**
- **SQL:** new `src-tauri/tests/procurement/ws_o_3_buy_by_pack_integration.sql` (setup copied from `direct_purchase_acceptance_integration.sql`; packs created with O-1 functions), added to the runner.

**Worked example W3** (one direct purchase, supplier "Alpha", two lines):
| Line sent | Stored receipt lines | Stock / value / WAC after |
|---|---|---|
| V1, unit CTN (12), qty 3, cost 12,600.00, extra 4 | CTN × 3 @ 12,600.00 = 37,800.00 · UNIT × 4 @ 1,050.00 = 4,200.00 (pack_rate_of_unit_id = CTN) | V1: 40 units, 42,000.00, WAC 1,050.000000 |
| V2, unit CTN (7), qty 2, cost 7,500.00, extra 3 | CTN × 2 @ 7,500.00 = 15,000.00 · UNIT × 3 @ 1,071.43 = 3,214.29 (pack_rate_of_unit_id = CTN) | V2: 17 units, 18,214.29, WAC 1,071.428824 |
| **Receipt total** | **60,214.29** (journal Dr inventory / Cr GRNI 60,214.29, as today) | |

**Errors:**
| # | Payload change | Expected |
|---|---|---|
| E3-1 | V1 extra 12 (= factor) | `22023`, nothing posted |
| E3-2 | V1 extra 2.5 | `22023` |
| E3-3 | V1 qty 2.5 with extra 4 | `22023` |
| E3-4 | extra on a line whose unit is the base unit | `22023` |
| E3-5 | V1 CTN line with extra 4 **and** a V1 UNIT line | `22023` |
| E3-6 | Same request id posted twice, second time without the extra | idempotency conflict (existing SQLSTATE) |
| E3-7 | Old-style payload (no `extra_base_quantity` anywhere) | posts exactly as before the change (same stored rows) |
| R1 | Supplier return test of Gate 0, repeated after the change | same result as in Gate 0 |

- **Vitest:** purchase line helper/preview/validation/payload (O-3.4).

**O-3.7 — Strings, marker, verification, build, report.**

### O-3 data flow
User picks product → unit defaults to main pack → types 3 / extra 4 / cost 12,600 → preview "= 40 Unit · extra at 1,050.00 per Unit (Carton rate)" → Confirm → Rust builds line JSON (+ hash) → `inventory.confirm_direct_purchase` → `_expand_direct_purchase_lines` → two lines → movements + WAC + receipt lines + journal → response → purchase detail shows both lines.

### O-3 acceptance criteria
1. W3 exact to the centime; journal balanced; stock and WAC as in the table.
2. E3-1…E3-7 and R1 as specified.
3. Old payloads post exactly as before (E3-7) and old lines hash exactly as before (O-3.3 unit test).
4. Every purchase display/print shows the pack and the pack-rate marker.
5. No change to WAC arithmetic, journals, supplier balances or payments.

### O-3 manual checks for the owner
1. Marker `[ version = WS-O-3.1 ]`.
2. New purchase → pillow → unit is Carton by default → 3 Carton, extra 4, cost 12,600 → preview shows 42,000.00 → confirm → product stock shows 40 (still in units until O-5).
3. Purchase detail and printed A4 purchase document show "3 Carton (×12) × 12,600.00 = 37,800.00" and "4 Unit × 1,050.00 (Carton rate) = 4,200.00".
4. Supplier return of 1 Carton from that purchase → stock drops by 12.

---

## 11. Sub-plan O-4 — Sell by the box

**Goal:** on the till (cash and credit), a product with a box starts in boxes; the seller can sell "2 Carton + 5 Unit", edit the price, sell pieces alone at the piece price; stock, COGS, totals, fingerprints, receipts, void slips and documents are exact.

**Branch:** `task/ws-o-4-sell-by-pack` from the accepted O-3 branch. **Marker:** `[ version = WS-O-4.1 ]`. Read `ws-b-skill` first.

### O-4.0 Gate 0
| # | Find | Stop if |
|---|---|---|
| G1 | Live signatures and full bodies of every function that **posts** a sale: `sales.confirm_cash_sale`, `sales.confirm_credit_sale` (public wrapper and private core), and any other posting path added by WS-F (search `INSERT INTO sales.cash_sale_lines` and `INSERT INTO sales.credit_sale_lines` in live function bodies: `SELECT oid::regprocedure FROM pg_proc WHERE prokind = 'f' AND pg_get_functiondef(oid) ILIKE '%INSERT INTO sales.%sale_lines%';`). | a posting path exists that this plan does not name and cannot be edited the same way |
| G2 | Every **SQL** fingerprint function for sales (snapshot: `receivables.credit_sale_payload_hash`, S12) and every Rust hash builder for sales (snapshot: `application/cash_sale.rs` via `payload_hash`). Record whether `payload_hash` sorts keys. | — |
| G3 | `\d sales.cash_sale_lines`, `\d sales.credit_sale_lines`; constraint names (`SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'sales.cash_sale_lines'::regclass;` and same for credit); triggers; any test that expects a constraint **name**. | a test depends on the old constraint name (report; do not edit tests) |
| G4 | **Reader inventory:** every live SQL function, Rust file and React file that reads `cash_sale_lines` / `credit_sale_lines` (receipt F-2, void F-6, void slip, A4 sale document WS-M, Documents/Journals detail WS-L-1, WS-I reports, backup reconciliation script). For each: does it read `line_total`, or **recompute** `quantity * unit_price`? | the **void** or any other **posting** function recomputes an amount from `quantity * unit_price` (it would be wrong for pack lines) |
| G5 | The till: screen files (WS-F-1), cart state type, how a product is added (tile, search, scan), whether line prices are editable today, where the product's `last_known_wac` and stock are available to the till. | — |
| G6 | Baseline fingerprint: run the **unchanged** `receivables.credit_sale_payload_hash` on this exact legacy payload and record the hex: customer 1, warehouse 1, fiscal period 1, date `2026-09-15`, lines `[{"variant_id": 1, "quantity": "3", "unit_price": "1400.00"}]`. Also serialize (Rust) the unchanged `CashSaleLineInput { variant_id: 1, quantity: 3.000, unit_price: 1400.00 }` payload and record the exact string and hash. | — |

### O-4 steps

---

**O-4.1 — New sale line columns and the line-total rule by price basis**
- **Location:** new migration `<timestamp>_ws_o_4_sell_by_pack.sql`.
- **Change (exact; repeat for `sales.credit_sale_lines` with the prefix `credit_sale_lines_` and its own old constraint name from G3):**
```sql
ALTER TABLE sales.cash_sale_lines
    ADD COLUMN price_basis             text          NOT NULL DEFAULT 'BASE',
    ADD COLUMN pack_unit_id            bigint        NULL REFERENCES catalog.units (id),
    ADD COLUMN pack_unit_name_snapshot text          NULL,
    ADD COLUMN pack_factor_snapshot    numeric(20,6) NULL,
    ADD COLUMN pack_quantity           numeric(18,3) NULL,
    ADD COLUMN pack_price              numeric(14,2) NULL,
    ADD COLUMN list_price_snapshot     numeric(14,2) NULL,
    ADD COLUMN price_overridden        boolean       NOT NULL DEFAULT false;

ALTER TABLE sales.cash_sale_lines
    DROP CONSTRAINT cash_sale_lines_line_total_matches_quantity_and_price;

ALTER TABLE sales.cash_sale_lines
    ADD CONSTRAINT cash_sale_lines_price_basis_valid
        CHECK (price_basis IN ('BASE','PACK','PACK_RATE')),
    ADD CONSTRAINT cash_sale_lines_pack_columns_consistent CHECK (
        (price_basis = 'BASE'
            AND pack_unit_id IS NULL AND pack_unit_name_snapshot IS NULL
            AND pack_factor_snapshot IS NULL AND pack_quantity IS NULL AND pack_price IS NULL)
     OR (price_basis = 'PACK'
            AND pack_unit_id IS NOT NULL AND pack_unit_name_snapshot IS NOT NULL
            AND pack_factor_snapshot > 1 AND pack_price >= 0
            AND pack_quantity >= 1 AND pack_quantity = trunc(pack_quantity)
            AND quantity = pack_quantity * pack_factor_snapshot)
     OR (price_basis = 'PACK_RATE'
            AND pack_unit_id IS NOT NULL AND pack_unit_name_snapshot IS NOT NULL
            AND pack_factor_snapshot > 1 AND pack_price >= 0
            AND pack_quantity IS NULL AND quantity < pack_factor_snapshot)),
    ADD CONSTRAINT cash_sale_lines_line_total_matches_by_basis CHECK (
        (price_basis = 'PACK' AND line_total = round(pack_quantity * pack_price, 2))
     OR (price_basis <> 'PACK' AND line_total = round(quantity * unit_price, 2)));
```
- **Logic:** existing rows become `BASE` with NULL pack columns, and still satisfy the line-total rule (it is the old rule for non-pack lines). Adding columns and constraints does not fire the immutability triggers. `quantity` keeps meaning base units (D4).
- **Pitfalls:** the old constraint name comes from G3 — use the live name. Drop it only after the new columns exist, then add the new constraints in the **same** migration.
- **Edge cases:** a pack line priced 0 is allowed (gift), like base lines today.
- **Verify:** the migration applies on the acceptance database (all existing rows validate); T-O4-1.

---

**O-4.2 — `sales._expand_sale_lines(p_lines jsonb) RETURNS jsonb` (private, owner-only, `STABLE`)**
- **Objective:** turn the till's request into the exact lines to store (D5, D6).
- **Input line shapes:**
  - **Legacy / base** (no `sale_unit` key): `{"variant_id": 12, "quantity": "3", "unit_price": "1400.00"}`
  - **Pack**: `{"variant_id": 12, "sale_unit": "PACK", "pack_unit_id": 7, "pack_quantity": "2", "extra_quantity": "5", "pack_price": "15000.00"}` (`extra_quantity` optional, default 0)
- **Algorithm (exact):**
  1. If `p_lines` is NULL or not an array or empty → return `p_lines` unchanged (the caller's existing checks report it as today).
  2. For each element at position `i` (1-based), in order:
     - **No `sale_unit` key** → output the element unchanged **plus** `"price_basis": "BASE"`, `"list_price": <catalog.product_variants.sale_price of variant_id, or null if not found>`, `"price_overridden": <true when both unit_price and list_price parse and differ, else false>`. Do **no** other validation here (the caller keeps validating base lines exactly as today).
     - **`sale_unit` = `"PACK"`:**
       a. Read `variant_id` (bigint), `pack_unit_id` (bigint), `pack_quantity`, `extra_quantity` (default `0`), `pack_price` (numerics). Missing or not parseable → `SALE_LINE_INVALID: line % …`.
       b. `catalog._variant_base_unit(variant_id)`; no row → `SALE_LINE_INVALID: line %: variant % not found`.
       c. Pack = `catalog.variant_units WHERE variant_id = … AND unit_id = pack_unit_id`; not found, `is_active` false, `conversion_factor <= 1`, or `sale_price IS NULL` → `SALE_PACK_UNAVAILABLE: line % …`. Read the unit name from `catalog.units`.
       d. `pack_quantity < 1` or `<> trunc(pack_quantity)` → `SALE_PACK_QTY_INVALID`.
       e. `extra_quantity < 0`, `>= factor`, `<> round(extra, 3)`, or (whole base unit and `<> trunc(extra)`) → `SALE_EXTRA_QTY_INVALID`.
       f. `catalog._validate_amount(pack_price, 'SALE_PACK_PRICE_INVALID')`.
       g. `base_qty := pack_quantity * factor`; `base_qty <> round(base_qty, 3)` → `SALE_PACK_QTY_INVALID`.
       h. `rate := catalog._pack_rate(pack_price, factor, 0)`; `list_rate := catalog._pack_rate(pack.sale_price, factor, 0)`; `overridden := pack_price <> pack.sale_price`.
       i. Output the **pack line**: `{"variant_id", "quantity": base_qty, "unit_price": round(pack_price / factor, 2), "line_total": round(pack_quantity * pack_price, 2), "price_basis": "PACK", "pack_unit_id", "pack_unit_name": <unit name>, "pack_factor": factor, "pack_quantity", "pack_price", "list_price": pack.sale_price, "price_overridden": overridden}`.
       j. If `extra_quantity > 0`, output the **pack-rate line**: `{"variant_id", "quantity": extra_quantity, "unit_price": rate, "line_total": round(extra_quantity * rate, 2), "price_basis": "PACK_RATE", "pack_unit_id", "pack_unit_name", "pack_factor": factor, "pack_quantity": null, "pack_price", "list_price": list_rate, "price_overridden": overridden}`.
     - **Any other `sale_unit` value** (including `"BASE"`) → `SALE_LINE_INVALID: line %: unknown sale_unit %`. (Base lines are always sent **without** `sale_unit` — D8.)
  3. Return the output array.
- **Pitfalls:** do not look up the price for legacy lines to *replace* the sent price — the till's price is authoritative (S11, R5); `list_price` is only a snapshot.
- **Edge cases:** a sale with the same variant in two pack lines and one base line is allowed (each line checks stock in sequence, as today).
- **Verify:** T-O4-2…T-O4-12.

---

**O-4.3 — Use the expansion in every sale posting function**
- **Location:** same migration; `CREATE OR REPLACE` of each function from G1 using its **live** body. Edits only:
  1. Declare `v_lines_expanded jsonb;` and, at the point where the function starts processing lines, set `v_lines_expanded := sales._expand_sale_lines(p_lines);`. Every loop or query over `p_lines` **in the line-processing part** reads `v_lines_expanded` instead. Header checks on `p_lines` (non-empty array etc.) and the idempotency/fingerprint code keep using `p_lines` unchanged.
  2. Where the function computes the line total (snapshot: `v_line_total := round(v_quantity * v_unit_price, 2);`), use: `IF coalesce(v_line->>'price_basis','BASE') = 'BASE' THEN <the existing expression unchanged> ELSE v_line_total := (v_line->>'line_total')::numeric; END IF;`
  3. In the `INSERT INTO sales.<cash|credit>_sale_lines (...)`, add the columns `price_basis, pack_unit_id, pack_unit_name_snapshot, pack_factor_snapshot, pack_quantity, pack_price, list_price_snapshot, price_overridden` with values `coalesce(v_line->>'price_basis','BASE')`, `nullif(v_line->>'pack_unit_id','')::bigint`, `v_line->>'pack_unit_name'`, `nullif(v_line->>'pack_factor','')::numeric`, `nullif(v_line->>'pack_quantity','')::numeric`, `nullif(v_line->>'pack_price','')::numeric`, `nullif(v_line->>'list_price','')::numeric`, `coalesce((v_line->>'price_overridden')::boolean, false)`.
  4. Nothing else changes: stock check, COGS, movements, residuals, journals, discount (WS-F-3), credit-limit warning (WS-F-4), numbering, document jobs.
- **Why the existing line code keeps working:** every expanded line — base, pack or pack-rate — still has the keys `variant_id`, `quantity` (base units) and `unit_price`, so the existing reads (`v_line ->> 'quantity'`, `v_line ->> 'unit_price'`), the stock check and the COGS computation operate on base units exactly as today.
- **Pitfalls:** replacing `p_lines` inside the fingerprint call (would change hashes); missing a second loop that re-reads `p_lines` (e.g. for locking — locking by the same variant ids is fine either way, but use `v_lines_expanded` consistently in the processing part).
- **Verify:** W4, and the full existing sales/receivables/cash suites unchanged.

---

**O-4.4 — Sale lines make a pack "used"**
- **Location:** same migration. `CREATE OR REPLACE catalog._pack_is_used` (same signature) = the O-1 body **plus** `OR EXISTS (SELECT 1 FROM sales.cash_sale_lines l WHERE l.variant_id = v_variant AND l.pack_unit_id = v_unit) OR EXISTS (… sales.credit_sale_lines …)`.
- **Verify:** T-O4-13.

---

**O-4.5 — Fingerprints see the pack fields (trap S12)**
- **Location:** same migration: `CREATE OR REPLACE receivables.credit_sale_payload_hash` (same signature, live body) and any other SQL sales fingerprint found in G2.
- **Change:** replace the per-line `jsonb_build_object(...)` with:
```sql
CASE WHEN line ? 'sale_unit' THEN jsonb_build_object(
        'sale_unit',      line ->> 'sale_unit',
        'variant_id',     (line ->> 'variant_id')::bigint,
        'pack_unit_id',   nullif(line ->> 'pack_unit_id','')::bigint,
        'pack_quantity',  trim_scale(nullif(line ->> 'pack_quantity','')::numeric),
        'extra_quantity', trim_scale(coalesce(nullif(line ->> 'extra_quantity',''),'0')::numeric),
        'pack_price',     trim_scale(nullif(line ->> 'pack_price','')::numeric))
     ELSE <the existing jsonb_build_object('variant_id', …, 'quantity', …, 'unit_price', …) exactly as live>
END
```
- **Logic:** legacy lines hash byte-for-byte as before (D8); pack lines include every field that changes the sale.
- **Rust side (cash):** O-4.6.
- **Verify:** H1–H4 (below).

---

**O-4.6 — Rust sale line structs**
- **Location:** `src-tauri/src/application/cash_sale.rs`, `credit_sale.rs`, their command DTOs (G1/G5), and every place that constructs these structs (including tests).
- **Change:** the line struct becomes:
```rust
#[derive(Serialize)]
pub(crate) struct CashSaleLineInput {
    pub variant_id: i64,
    #[serde(skip_serializing_if = "Option::is_none")] pub quantity: Option<Decimal>,
    #[serde(skip_serializing_if = "Option::is_none")] pub unit_price: Option<Decimal>,
    #[serde(skip_serializing_if = "Option::is_none")] pub sale_unit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub pack_unit_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub pack_quantity: Option<Decimal>,
    #[serde(skip_serializing_if = "Option::is_none")] pub extra_quantity: Option<Decimal>,
    #[serde(skip_serializing_if = "Option::is_none")] pub pack_price: Option<Decimal>,
}
```
  (same for the credit line struct). Before calling SQL, validate each line is **exactly one** shape — base: `quantity` and `unit_price` Some, all pack fields None, `sale_unit` None; pack: `sale_unit == Some("PACK")`, `pack_unit_id`, `pack_quantity`, `pack_price` Some, `quantity` and `unit_price` None, `extra_quantity` optional — otherwise return `AppError::ValidationError`. Update every existing constructor to `quantity: Some(..), unit_price: Some(..)` and the new fields `None`.
- **Verify:** Rust unit test: the base line of G6 serializes to **exactly** the recorded string and hash; a pack line serializes with the pack keys and without `quantity`/`unit_price`; an invalid mix returns `ValidationError`.

---

**O-4.7 — TypeScript sale line types**
- **Location:** `src/shared/ipc/dto.ts` (snapshot `CashSaleLineInput`; credit equivalent in `creditSaleDto.ts`).
- **Change:**
```ts
export type SaleLineInput =
  | { variant_id: number; quantity: string; unit_price: string }
  | { variant_id: number; sale_unit: 'PACK'; pack_unit_id: number; pack_quantity: string;
      extra_quantity?: string; pack_price: string };
```
  Use it for cash and credit. `extra_quantity` is sent only when > 0. Base lines never contain `sale_unit`.

---

**O-4.8 — The till**
- **Location:** the till screen and cart state from G5.
- **Cart line model (exact):**
```ts
type SellablePack = { unitId: number; unitName: string; factor: string; salePrice: string };
type CartLine =
  | { key: string; kind: 'BASE'; variantId: number; name: string; baseUnitName: string; baseIsWhole: boolean;
      quantity: string; price: string; listPrice: string; wac: string | null; packs: SellablePack[] }
  | { key: string; kind: 'PACK'; variantId: number; name: string; baseUnitName: string; baseIsWhole: boolean;
      pack: SellablePack; packQuantity: string; extraQuantity: string; price: string; listPrice: string;
      wac: string | null; packs: SellablePack[] };
```
- **Adding a product (tile tap or search result):**
  1. Call `listVariantPacks(variantId)` (once per variant per cart; cache it). Sellable packs = rows with `is_pack && is_active && sale_price !== null`. On failure: add a BASE line and show the toast `sale.pack.loadFailed` = "Boxes could not be loaded; added by the {base}."
  2. Default: if the variant's **main pack** is sellable → PACK line (`packQuantity "1"`, `extraQuantity "0"`, `price = listPrice = pack sale price`); otherwise BASE line (`quantity "1"`, `price = listPrice = variant sale price`) (R6).
  3. If the cart already has a line for this variant with the same kind and the same pack, increase it (`packQuantity + 1` or `quantity + 1`) instead of adding a line.
- **Scanning:** `resolveBarcode(code)`:
  - pack columns NULL → behave as "add in BASE mode" (increase the BASE line of that variant, or add one).
  - pack columns set: `pack_is_active === false` or `pack_sale_price === null` → toast `sale.pack.error.notSold` = "This box barcode belongs to a pack that is not sold." and add nothing; otherwise increase/add the PACK line for that pack.
- **Row controls (touch-friendly, ≥ 44 px targets):**
  - **Unit chips:** "{base}" + one chip per sellable pack "{unit} ×{factor}". Switching kind or pack **resets** the row: to BASE → `quantity "1"`, price = variant price; to a pack → `packQuantity "1"`, `extraQuantity "0"`, price = that pack's price.
  - **PACK:** stepper "{unit}" (min 1; the − button is disabled at 1; the row's delete button removes it) and stepper "Extra {base}" (min 0). **Carry rule:** when Extra reaches the factor (by + or typing), `packQuantity += floor(extra / factor)` and `extraQuantity = extra mod factor` (use `splitBaseQuantity`); typed values must pass the whole/decimal rule of the base unit.
  - **BASE:** one stepper (min 1 for whole units; typed decimals with ≤ 3 decimals for decimal units).
  - **Price** (per selected unit, label "per {unit}"): tap to edit; `normalizeDecimalInput`, ≥ 0, ≤ 2 decimals, else inline error `sale.pack.error.price`. When `price !== listPrice` show the tag `sale.pack.edited` = "edited" and a **Reset** link.
  - **Subtitle:** PACK → "= {baseQty} {base}" plus, when extra > 0, " · {extra} {base} at {rate} ({unit} rate)" with `rate = packRate(price, factor, 0)`.
  - **Below-cost warning** (only when `wac` is known, G5): BASE `price < wac`; PACK `price < wac × factor` or (extra > 0 and `rate < wac`) → amber `sale.pack.warn.belowCost` = "Below cost ({cost} per {base})". Never blocks (R5).
  - **Stock hint:** available stock with `formatPackQuantity` (main pack).
  - **Line total preview:** BASE `multiplyMoney(quantity, price)`; PACK `multiplyMoney(packQuantity, price) + multiplyMoney(extraQuantity, rate)`.
- **Payload built on Confirm:** BASE → `{ variant_id, quantity, unit_price: price }`; PACK → `{ variant_id, sale_unit: 'PACK', pack_unit_id, pack_quantity, pack_price: price }` plus `extra_quantity` only when > 0. Order of lines = cart order.
- **Errors after Confirm:** `INSUFFICIENT_STOCK` → the existing message; `VALIDATION_ERROR` → the generic message; the cart is kept in both cases. Success → existing behaviour (cart cleared, receipt).
- **After a `VALIDATION_ERROR` (edge case E3):** re-load `listVariantPacks` for every variant that has a PACK line; any PACK line whose pack is no longer sellable (inactive, removed, or no sale price) shows the red text `sale.pack.error.noLongerSold` = "This box is no longer sold — change the unit." and blocks Confirm until the seller changes that line's unit.
- **Must not change:** payment, discount (WS-F-3), credit-limit warning (WS-F-4), cash session rules, receipt ON/OFF toggle, void entry point.
- **Verify:** Vitest for the cart reducer: default mode, merge, scan pack/piece/not-sold, carry rule (11 + 1 → 1 pack + 0 for factor 12), reset on switch, price edit tag, previews for S1–S4 of W4, exact payloads.

---

**O-4.9 — Show pack lines on receipts, void slips, sale documents and sale details**
- **Location:** every reader from G4 that **displays or prints** sale lines, and the read function(s) feeding them.
- **Change (backend):** each read function returns, per line, additionally `price_basis`, `pack_unit_name_snapshot`, `pack_factor_snapshot`, `pack_quantity`, `pack_price`, and the base unit name (`catalog.products.unit_id` → `catalog.units.name`) if not already returned. `jsonb` output → add keys (same signature); `TABLE` output → `DROP` + `CREATE` with appended columns and re-granted.
- **Change (display) — one rule everywhere (thermal receipt uses the same text on two lines: name, then detail):**
  - BASE: `"{quantity} {base} × {unit_price} = {line_total}"` (unchanged look)
  - PACK: `"{pack_quantity} {pack_unit_name} (×{factor}) × {pack_price} = {line_total}"`
  - PACK_RATE: `"{quantity} {base} × {unit_price} ({pack_unit_name} rate) = {line_total}"`
- Any **display** reader that recomputes `quantity × unit_price` (G4) must display `line_total` instead.
- **Verify:** tests for the three formats in each component; W4 receipt data check in SQL (the read function returns the pack fields for S1).

---

**O-4.10 — Tests**
- **SQL:** new `src-tauri/tests/sales/ws_o_4_sell_by_pack_integration.sql` (create the folder if needed; add it to the runner). Setup: packs from 7.11 via O-1 functions; V1 stock 60 at 1,050.00 and V2 stock 20 at 1,000.00 via direct purchases in the base unit; an open cash session and customer **Karim** (reuse the setup pattern of the existing cash and credit suites).

**Worked example W4** (run in this order):
| # | Request line(s) | Stored lines | Totals / stock after |
|---|---|---|---|
| S1 cash | V1 PACK CTN, pack_quantity 2, extra 5, pack_price 15,000.00 | 1) PACK: qty 24, unit_price 1,250.00, total 30,000.00, pack_qty 2, pack_price 15,000.00, factor 12, list 15,000.00, overridden false · 2) PACK_RATE: qty 5, unit_price 1,250.00, total 6,250.00, pack_price 15,000.00, list 1,250.00 | sale 36,250.00; COGS 30,450.00 (29 × 1,050); V1 stock 31 |
| S2 cash | V1 legacy `{quantity 3, unit_price 1400.00}` | BASE: qty 3, unit_price 1,400.00, total 4,200.00, list 1,400.00, overridden false | V1 stock 28 |
| S3 cash | V1 PACK CTN, pack_quantity 1, pack_price 14,400.00 | PACK: qty 12, unit_price 1,200.00, total 14,400.00, list 15,000.00, **overridden true** | V1 stock 16 |
| S4 credit Karim | V2 PACK CTN(7), pack_quantity 1, extra 4, pack_price 9,000.00 | 1) PACK: qty 7, unit_price 1,285.71, total 9,000.00 · 2) PACK_RATE: qty 4, unit_price 1,286.00, total 5,144.00 | sale 14,144.00; COGS 11,000.00; V2 stock 9; Karim owes 14,144.00 more |
| S6 cash | V1 PACK CTN, pack_quantity 2 (24 > 16) | none | `55000` insufficient stock; V1 stock 16 |
| Void | void S1 with the live WS-F-6 function | S1 lines unchanged | V1 stock 45; COGS reversed as WS-F-6 does today |

**Errors (each: nothing stored, stock unchanged):**
| # | Line | Expected |
|---|---|---|
| T-O4-2 | extra 12 on CTN(12) | `22023` |
| T-O4-3 | extra 2.5 on V1 | `22023` |
| T-O4-4 | pack_quantity 0 | `22023` |
| T-O4-5 | pack_quantity 1.5 | `22023` |
| T-O4-6 | V1 BAL (no sale price) | `22023` |
| T-O4-7 | V1 CTN after `set_pack_active(false)` | `22023` (re-activate afterwards) |
| T-O4-8 | pack_unit_id = SAC on V1 (no such pack) | `22023` |
| T-O4-9 | pack_price 10.005 | `22023` |
| T-O4-10 | `sale_unit` "BOX" / "BASE" | `22023` |
| T-O4-11 | PACK line without `pack_price` | `22023` |
| T-O4-12 | V3 (decimal) SAC pack_quantity 1, extra 12.5, price 20,000.00 | accepted: PACK qty 25 total 20,000.00 + PACK_RATE qty 12.5 × 800 = 10,000.00 (give V3 stock 50 kg first) |
| T-O4-13 | `catalog._pack_is_used(V1 CTN)` after S1 | true |
| T-O4-1 | after the migration, every pre-existing sale line | `price_basis = 'BASE'`, pack columns NULL |

**Fingerprints:**
| # | Check | Expected |
|---|---|---|
| H1 | `credit_sale_payload_hash` of the G6 legacy payload | **equal** to the hex recorded in G6 |
| H2 | two pack payloads differing only in `pack_quantity` (1 vs 2) | different |
| H3 | two pack payloads differing only in `extra_quantity` (0 vs 4) | different |
| H4 | a pack payload whose `extra_quantity` key is absent vs `"0"` | equal (absent = 0) |

- **Rust:** hash-stability unit test (O-4.6).
- **Vitest:** cart reducer and displays (O-4.8, O-4.9).

**O-4.11 — Strings, marker, verification, build, report.**

### O-4 data flow
Seller taps pillow → `listVariantPacks` → PACK line "1 Carton" at 15,000 → + Extra ×5, Carton +1 → preview 36,250.00 → Confirm → payload `[{variant_id, sale_unit:'PACK', pack_unit_id, pack_quantity:'2', extra_quantity:'5', pack_price:'15000.00'}]` → Rust validates shape, hashes (cash) → `sales.confirm_cash_sale` → fingerprint/idempotency on `p_lines` → `_expand_sale_lines` → 2 lines → stock check + COGS + movements per line → lines stored with pack snapshots → journal → receipt job → receipt shows "2 Carton (×12) × 15,000.00 = 30,000.00" and "5 Unit × 1,250.00 (Carton rate) = 6,250.00".

### O-4 acceptance criteria
1. W4 exact to the centime; journals balanced; stock and COGS as in the table; void restores stock.
2. All error rows and H1–H4 as specified; legacy payloads post exactly as before; legacy fingerprints unchanged (H1 and the Rust test).
3. The till defaults to the main sellable pack, sells mixed quantities, pieces alone at the piece price, edited prices with a tag, below-cost warning without blocking.
4. Receipts, void slips, A4 sale documents and sale details show the three line formats.
5. Every existing sales, cash, receivables and void test passes unchanged.

### O-4 manual checks for the owner
1. Marker `[ version = WS-O-4.1 ]`.
2. Tap a pillow: the line shows "1 Carton" at 15,000.00.
3. Add 5 extra: "= 17 Unit · 5 Unit at 1,250 (Carton rate)"; total 21,250.00. Press Extra + until it passes 11: it becomes 2 Carton + 0.
4. Switch the chip to "Unit": the line resets to 1 Unit at the piece price.
5. Scan the box barcode: 1 Carton is added. Scan the piece barcode: 1 Unit is added.
6. Edit the carton price to 14,400: tag "edited"; confirm; the receipt shows 14,400.00.
7. Type a carton price below cost: amber warning, sale still allowed.
8. Credit sale to a customer with 1 Carton of a 7-piece product + 4 extra at 9,000: total 14,144.00.
9. Print the A4 sale document and a void slip: both show the Carton lines and the "(Carton rate)" line.

---

## 12. Sub-plan O-5 — Boxes shown everywhere

**Goal:** every on-screen stock quantity of a product that has a main pack reads "2 Carton + 5 Unit"; stock adjustment and minimum-stock inputs show the pack equivalent. Display only — no posting or data change.

**Branch:** `task/ws-o-5-pack-display` from the accepted O-4 branch. **Marker:** `[ version = WS-O-5.1 ]`.

### O-5.0 Gate 0
| # | Find | Stop if |
|---|---|---|
| G1 | **Display inventory:** every React screen that shows a variant's stock quantity: products list, product detail/editor, inventory screen, `ItemSearchModal`, stock adjustment screen, WS-I stock report (on screen), low-stock / notifications centre, dashboard (if WS-N is merged). For each: file, component, the field holding the quantity, the field holding the variant id, and the base unit name source. | a screen has no variant id available (report it and skip only that screen) |
| G2 | The session token source for hooks (`src/shared/session/SessionContext.tsx` [S]). | — |
| G3 | How the stock adjustment screen chooses a unit today (`list_stock_adjustment_units` [S9]). | — |

### O-5 steps

**O-5.1 — Hook `usePrimaryPacks`**
- **Location:** new `src/shared/hooks/usePrimaryPacks.ts` (+ test).
- **Behaviour:** `usePrimaryPacks(variantIds: number[]): { packs: Map<number, PrimaryPack>; loading: boolean }`. De-duplicates ids; requests only ids not already cached; splits into batches of at most 500 (`getPrimaryPacks`); caches results in a module-level `Map` for the app session, and clears that cache whenever `createPack`, `updatePack`, `setPackPrimary`, `setPackActive` or `removePack` succeed (export `invalidatePrimaryPacks()` and call it from `PackManager` after each success). On error: returns the packs it has, `loading = false`, never throws (the screen falls back to plain quantities).
- **Verify:** test with 1,200 ids → 3 calls (500/500/200); second render with the same ids → no call; invalidate → next render calls again.

**O-5.2 — Component `PackQuantity`**
- **Location:** new `src/shared/components/PackQuantity.tsx` (+ test).
- **Props:** `baseQuantity: string`, `baseUnitName: string`, `pack?: PrimaryPack`.
- **Renders:** `formatPackQuantity(baseQuantity, pack ? { unitName: pack.unit_name, factor: pack.conversion_factor } : null, baseUnitName)`; when a pack is used, a tooltip `pack.display.tooltip` = "= {baseQuantity} {base}". Tabular numerals; right-aligned in tables (left in RTL).

**O-5.3 — Apply to every screen of G1**
- Replace the quantity **text** with `<PackQuantity …/>`; sorting, filtering and exports keep using the base quantity. Call `usePrimaryPacks` once per screen with the visible variant ids (the current page only — never the whole catalogue).
- **Must not change:** column order, sort keys, pagination, filters, printed/exported reports.

**O-5.4 — Stock adjustment helpers**
- Default unit = main pack when the variant has one (else base, as today). Under the quantity input show `pack.display.equals` = "= {baseQty} {base}" using `packsToBase`. No change to the posting call.

**O-5.5 — Minimum stock helper**
- In the product editor, under the minimum-stock input (base units), show "= {formatPackQuantity(value)}" when the variant has a main pack. The stored value stays in base units.

**O-5.6 — Tests, strings, marker, verification, build, report.**

### O-5 acceptance criteria
1. Every screen of G1 shows packs for products with a main pack and plain quantities for the others.
2. No screen loads packs for more than its visible rows; no posting or stored value changes.
3. Existing tests pass.

### O-5 manual checks
1. Marker `[ version = WS-O-5.1 ]`. 2. Products list: pillow with 29 in stock shows "2 Carton + 5 Unit"; hovering shows "= 29 Unit". 3. Same in the inventory screen, the item search window and the stock report. 4. Stock adjustment for the pillow starts in Carton; typing 2 shows "= 24 Unit". 5. Arabic: the quantity text reads correctly right-to-left.

---

## 13. Sub-plan O-6 — Translations (last)

**Goal:** every key added in O-1…O-5 has real French and Arabic text.

**Branch:** `task/ws-o-6-translations` from the accepted O-5 branch. **Agent:** Gemini is allowed (text only). **Marker:** `[ version = WS-O-6.1 ]`.

**Steps:** 1. Collect the key lists from the O-1…O-5 reports. 2. Fill `fr` and `ar` using this glossary exactly; keep `{placeholders}` unchanged. 3. Do not change any English text, key name, component or logic. 4. Run `npm run typecheck && npm run lint && npm test -- --run && npm run build`.

| English | French | Arabic |
|---|---|---|
| Pack / packs | Conditionnement / conditionnements | تعبئة / تعبئات |
| Main pack | Conditionnement principal | التعبئة الرئيسية |
| Carton (unit name) | Carton | كرتون |
| Unit / Piece | Pièce | قطعة |
| Holds {n} {base} | Contient {n} {base} | يحتوي على {n} {base} |
| Extra {base} | {base} en plus | {base} إضافية |
| ({unit} rate) | (au prix du {unit}) | (بسعر {unit}) |
| Not sold (buy only) | Non vendu (achat uniquement) | غير مباع (للشراء فقط) |
| edited | modifié | معدّل |
| Below cost | Sous le coût | أقل من التكلفة |

**Manual check:** switch the app to French and to Arabic; open the Packs panel, the till with a carton line, and a receipt; every new text is translated and Arabic is right-to-left.

---

## 14. Edge cases and failure scenarios (all sub-plans)

| # | Situation | Required behaviour | Where |
|---|---|---|---|
| E1 | Product without packs | Everything behaves exactly as today | all |
| E2 | Main pack is buy-only (no sale price) | Till starts in the base unit; purchases start in the main pack | O-3.4, O-4.8 |
| E3 | Pack deactivated or its price removed while it is in a cart | Posting fails with `VALIDATION_ERROR`; cart kept; the till then re-loads packs for every PACK line and marks lines whose pack is no longer sellable with red text `sale.pack.error.noLongerSold` = "This box is no longer sold — change the unit." | O-4.8 (add this to the till) |
| E4 | Pack price changed in setup while the product is in a cart | The cart keeps the seller's price (authoritative, R5); the stored `list_price_snapshot` is the new catalogue price, so `price_overridden` may be true | O-4.2 |
| E5 | Factor of an **unused** pack changed while in a cart | Posting uses the factor at posting time; the receipt shows the real result | O-4.2 (accepted, admin-only) |
| E6 | Two tills sell the last units at the same time | Existing stock lock and check → one sale succeeds, the other gets `INSUFFICIENT_STOCK` | unchanged |
| E7 | Same request sent twice (retry) | Same document returned (idempotency) | unchanged |
| E8 | Same request id, different lines (e.g. extra changed) | Idempotency conflict | O-3.6 E3-6, O-4 H2–H3 |
| E9 | Extra reaches the pack size on the till | Carried into one more pack | O-4.8 |
| E10 | Extra ≥ pack size sent anyway | `22023`, nothing stored | O-3.2, O-4.2 |
| E11 | Decimal base unit (kg) with a sack | Decimal extra allowed (≤ 3 decimals); factor may be decimal | O-1.5, O-4.2 |
| E12 | Rounding exactly at .5 (9,006 ÷ 12 = 750.5) | 751 (half up) | O-1.5 T12 |
| E13 | Pack price 0 | Allowed; rate 0 | 7.5 |
| E14 | Change the product's base unit when it has packs | Refused | O-1.4 |
| E15 | Delete a unit used as a pack | Refused (usage count) | O-1.10 |
| E16 | Box barcode equal to an existing barcode | Refused before saving (UI) and by the unique index | O-1.6, O-2.2 |
| E17 | Remove the main **piece** barcode while a box barcode exists | No barcode becomes primary; display falls back to SKU | O-1.8 |
| E18 | Scan a box barcode of an inactive pack | "not sold" toast; nothing added | O-4.8 |
| E19 | Quick add succeeds, pack creation fails | Product kept; toast tells the owner to add the box | O-2.5 |
| E20 | Purchase with extra on a base-unit line | `22023` | O-3.2 |
| E21 | Purchase with a pack line with extra and a base line of the same product | `22023` (UI blocks first) | O-3.2, O-3.4 |
| E22 | Supplier return of a carton purchase | Stock decreases by the carton's base units (Gate test R1) | O-3.0 |
| E23 | Void of a sale with pack lines | Stock and COGS restored as for any sale; void slip shows pack text | O-4 W4 |
| E24 | Backup then restore | New columns restored (whole-database dump); run `src-tauri/tests/backup_restore_reconciliation.sh` in O-4 and paste the result | O-4 |
| E25 | Licence read-only mode (WS-K-7, other branch) | Applies to pack sales like any sale once merged; nothing to do here | — |
| E26 | Migration on a database with existing packs and sales | Main pack backfilled; every existing sale line becomes `BASE` and satisfies the new constraints | O-1.2, O-4.1 |

---

## 15. Testing strategy (summary)

| Kind | What | Where |
|---|---|---|
| Unit (TS) | `packMath` (Appendix B), `packValidation`, cart reducer, `PackQuantity`, `usePrimaryPacks` | Vitest files named in each sub-plan |
| Unit (Rust) | line JSON/hash stability for base lines; shape validation for pack lines | `cash_sale.rs`, `credit_sale.rs`, purchase line tests |
| Integration (SQL) | T1–T41 (O-1), W3/E3/R1 (O-3), W4/T-O4/H1–H4 (O-4) | new suites added to `run_current_sql_suites.sh` |
| End-to-end | No automated E2E framework exists in the repo [S]; the **owner's numbered manual checks** per sub-plan are the E2E tests on Windows | reports |
| Validation | every 7.5 rule, both UI mirror and SQL | O-1, O-2, O-3, O-4 |
| Error handling | SQL `22023`/`55000`; UI keeps state and shows the mapped message | O-3, O-4 |
| Permission | pack writes without `MANAGE_CATALOG` → `42501` (T22); posting permissions unchanged (existing suites) | O-1 |
| Regression | every existing SQL suite unchanged; legacy payload posts and hashes unchanged (E3-7, H1, Rust tests); backup reconciliation script (E24) | all |
| Boundary | factor 1 / 100000 / 100001 / 6 vs 7 decimals; extra = factor − 1 / factor; rate .5; decimal 12.5 kg; 500 vs 501 ids | O-1, O-4, O-5 |

---

## 16. Junior-developer test and missing-details audit (answers to the questions an implementer would ask)

| Question | Answer |
|---|---|
| The live file or function has a different name than the snapshot. | Use the live one found in Gate 0 and list the substitution in the report. |
| The live function body differs from the snapshot. | Always edit the **live** body (from `pg_get_functiondef`), never a copy from an old migration. |
| Can I add a new error code to show a nicer message? | No (D16). Mirror the rule in the UI. |
| Can I use `parseFloat` for a quick comparison? | No. Use `packMath`. |
| Should base lines carry `sale_unit: 'BASE'`? | No. Only pack lines carry `sale_unit`. |
| What if the extra is `"0"`? | The UI omits the key; SQL treats absent and 0 the same. |
| Which base unit column? | `catalog.products.unit_id` (D18, proven equal in O-1 Gate 0). |
| Pack price NULL — can the till sell it with a typed price? | No. Buy-only packs are not offered and are rejected by SQL. |
| Can a pack's factor change? | Only while unused (D11). |
| Where do I put new SQL tests? | `src-tauri/tests/<area>/ws_o_<n>_….sql`, added to the runner array. |
| The till has two screens (touch and legacy). | Apply O-4.8 to the screen reachable from the navigation; list the other in "Unrelated problems found". |
| An existing test fails after my change. | STOP and report; never edit an existing test to make it pass. |
| Where are money amounts formatted? | `formatDisplayAmount`; quantities with `formatExactDecimal` / `formatPackQuantity`. |
| Session token in new hooks/components? | From the existing session context (`SessionContext.tsx` [S]). |
| Do I bump the app version? | No (section 5.10). |

---

## 17. Report (Markdown file committed to the branch: `docs/ws-o/WS-O-<n>-report.md`)

```
## Gate 0 findings (each item: verified / read but not executed / assumed; substitutions of names)
## What changed (files, grouped SQL / Rust / React)
## Contract triangle (every new or changed function: SQL signature · Rust struct + call site · TS type — matching)
## Worked example and test results (the tables of this sub-plan with actual output)
## Regression proof (existing suites, legacy payload/hash checks)
## Verification output (literal, with working directory)
## New i18n keys (list)
## Build version marker (exact string)
## Installer (.exe path, or NOT RUN — reason)
## Pending manual checks for the owner (the sub-plan's list, step 1 = marker)
## Unrelated problems found (named, not fixed)
## Not finished / could not verify
Branch: <branch>
Commit: <full hash>
Pushed: yes/no
```

---

## Appendix A — Error codes (SQL message prefix; all `ERRCODE 22023` unless stated)

| Code | Raised when | UI mirror (message key) |
|---|---|---|
| PACK_VARIANT_NOT_FOUND | variant id unknown | — (not reachable from UI) |
| PACK_UNIT_NOT_FOUND | unit unknown or inactive | pack.error.unitRequired |
| PACK_UNIT_IS_BASE | pack unit = base unit | pack.error.unitIsBase |
| PACK_DUPLICATE_UNIT | variant already has this unit | pack.error.unitAlreadyUsed |
| PACK_FACTOR_INVALID | factor ≤ 1, > 100000, > 6 decimals | pack.error.factorTooSmall / factorTooLarge / factorDecimals |
| PACK_FACTOR_NOT_WHOLE | fractional factor on a whole base unit | pack.error.factorWhole |
| PACK_PRICE_INVALID | price < 0 or > 2 decimals | pack.error.priceInvalid |
| PACK_NOT_FOUND | pack id unknown | — |
| PACK_NOT_ACTIVE | making an inactive pack main; barcode on inactive pack | Main radio disabled for inactive rows |
| PACK_IN_USE | factor change or delete of a used pack | Holds disabled; Delete hidden |
| PACK_BARCODE_BLANK | empty barcode | pack.error.barcodeBlank |
| PACK_BARCODE_DUPLICATE | barcode already exists | pack.error.barcodeUsed (pre-check) |
| PACK_BARCODE_VARIANT_MISMATCH | trigger: pack of another variant | — |
| PACK_RATE_SCALE_INVALID | helper called with scale other than 0/2 | — |
| PACK_REQUEST_TOO_LARGE | > 500 ids | Rust rejects first |
| PRODUCT_UNIT_LOCKED_BY_PACKS | base unit change with packs | — (editor shows the generic validation message) |
| PURCHASE_EXTRA_ON_BASE_LINE | extra on a base-unit purchase line | Extra field hidden for the base unit |
| PURCHASE_PACK_QTY_NOT_WHOLE | pack qty not whole with extra | purchase.pack.error.packQtyWhole |
| PURCHASE_EXTRA_QTY_INVALID | extra < 0, ≥ factor, bad decimals | purchase.pack.error.extraInvalid |
| PURCHASE_EXTRA_DUPLICATE_BASE_LINE | pack line with extra + base line of same product | purchase.pack.error.duplicateBase |
| SALE_LINE_INVALID | missing/invalid fields, unknown `sale_unit` | cart model makes it impossible |
| SALE_PACK_UNAVAILABLE | pack missing, inactive, factor ≤ 1 or no sale price | E3 handling |
| SALE_PACK_QTY_INVALID | pack qty < 1 or not whole | stepper min 1 |
| SALE_EXTRA_QTY_INVALID | extra < 0, ≥ factor, bad decimals | carry rule |
| SALE_PACK_PRICE_INVALID | price < 0 or > 2 decimals | sale.pack.error.price |
| (existing) insufficient stock | `55000` | existing INSUFFICIENT_STOCK message |

---

## Appendix B — `src/shared/utils/packMath.ts` (exact specification)

All inputs are non-negative decimal strings; all arithmetic uses `BigInt`. Export `class PackMathError extends Error { code: 'INVALID_NUMBER' | 'TOO_MANY_DECIMALS' | 'ZERO_FACTOR' }`.

| Function | Algorithm |
|---|---|
| `parseScaled(value: string, scale: number): bigint` | trim; must match `^\d+(\.\d+)?$` else `INVALID_NUMBER`; fraction longer than `scale` → `TOO_MANY_DECIMALS`; return `BigInt(integerPart + fraction.padEnd(scale, '0'))` |
| `formatScaled(v: bigint, scale: number): string` | plain decimal, trailing fractional zeros removed, no thousands separator (`12`, `12.5`, `0`) |
| `formatFixed(v: bigint, scale: number): string` | plain decimal with exactly `scale` decimals (`1050.00`) |
| `splitBaseQuantity(baseQty, factor): { packs: string; rest: string }` | `q = parseScaled(baseQty, 6)`, `f = parseScaled(factor, 6)` (`f = 0` → `ZERO_FACTOR`); `packs = q / f`; `rest = q − packs × f`; return `{ packs: formatScaled(packs, 0), rest: formatScaled(rest, 6) }` |
| `packsToBase(packQty, factor, extra): string` | `formatScaled(parseScaled(packQty, 0) × parseScaled(factor, 6) + parseScaled(extra, 6), 6)` |
| `packRate(amount, factor, scale: 0 \| 2): string` | `a = parseScaled(amount, 2)`, `f = parseScaled(factor, 6)`; `num = a × 10^(6 + scale)`; `den = f × 100`; `r = (2 × num + den) / (2 × den)` (half up); return `formatFixed(r, scale)` |
| `multiplyMoney(qty, price): string` | `p = parseScaled(qty, 3) × parseScaled(price, 2)` (scale 5); `r = (p + 500n) / 1000n`; `formatFixed(r, 2)` |
| `addMoney(a, b): string` | `formatFixed(parseScaled(a, 2) + parseScaled(b, 2), 2)` |
| `compareDecimal(a, b): -1 \| 0 \| 1` | compare `parseScaled(x, 6)` |
| `formatPackQuantity(baseQty, pack: { unitName; factor } \| null, baseUnitName): string` | no pack or factor ≤ 1 → `"{qty} {base}"`; else split: packs `0` → `"{rest} {base}"`; rest `0` → `"{packs} {pack}"`; else `"{packs} {pack} + {rest} {base}"` |

**Required test examples (exact):**
| Call | Result |
|---|---|
| `splitBaseQuantity('29','12')` | `{packs:'2', rest:'5'}` |
| `splitBaseQuantity('12.000','12.000000')` | `{packs:'1', rest:'0'}` |
| `splitBaseQuantity('11','12')` | `{packs:'0', rest:'11'}` |
| `splitBaseQuantity('60.5','25')` | `{packs:'2', rest:'10.5'}` |
| `packsToBase('3','12','4')` | `'40'` |
| `packRate('15000.00','12',0)` | `'1250'` |
| `packRate('9000.00','7',0)` | `'1286'` |
| `packRate('9006.00','12',0)` | `'751'` |
| `packRate('7500.00','7',2)` | `'1071.43'` |
| `packRate('12600.00','12',2)` | `'1050.00'` |
| `multiplyMoney('5','1250')` | `'6250.00'` |
| `multiplyMoney('12.5','800')` | `'10000.00'` |
| `multiplyMoney('3','1071.43')` | `'3214.29'` |
| `multiplyMoney('0.333','10.00')` | `'3.33'` |
| `formatPackQuantity('29', {unitName:'Carton', factor:'12'}, 'Unit')` | `'2 Carton + 5 Unit'` |
| `formatPackQuantity('24', …Carton 12…, 'Unit')` | `'2 Carton'` |
| `formatPackQuantity('11', …Carton 12…, 'Unit')` | `'11 Unit'` |
| `formatPackQuantity('0', …Carton 12…, 'Unit')` | `'0 Unit'` |
| `formatPackQuantity('60.5', {unitName:'Sac', factor:'25'}, 'Kilogram')` | `'2 Sac + 10.5 Kilogram'` |
| `formatPackQuantity('7', null, 'Unit')` | `'7 Unit'` |
| `parseScaled('1.2345', 3)` | throws `TOO_MANY_DECIMALS` |
| `parseScaled('-1', 2)` | throws `INVALID_NUMBER` |

These results match the SQL helper `catalog._pack_rate` examples (T12), so screen previews equal what PostgreSQL stores.

---

## Appendix C — Example requests and responses

**Create a pack** — `invoke('create_pack', { sessionToken, variantId: 12, unitId: 7, conversionFactor: "12", salePrice: "15000.00", makePrimary: true })` → `41`

**List packs** — `invoke('list_variant_packs', { sessionToken, variantId: 12 })` →
```json
[{"variant_unit_id":41,"unit_id":7,"unit_code":"CTN","unit_name":"Carton","conversion_factor":"12.000000",
  "sale_price":"15000.00","is_pack":true,"is_primary":true,"is_active":true,"is_used":false,
  "barcode_ids":[88],"barcodes":["6131000000021"]}]
```

**Scan a box barcode** — `resolve_barcode("6131000000021")` → existing fields for the variant, plus
`"pack_variant_unit_id":41,"pack_unit_id":7,"pack_unit_code":"CTN","pack_unit_name":"Carton","pack_factor":"12.000000","pack_sale_price":"15000.00","pack_is_active":true`

**Cash sale lines (payload)**
```json
[{"variant_id":12,"sale_unit":"PACK","pack_unit_id":7,"pack_quantity":"2","extra_quantity":"5","pack_price":"15000.00"},
 {"variant_id":12,"quantity":"3","unit_price":"1400.00"}]
```
**Expanded by `sales._expand_sale_lines`**
```json
[{"variant_id":12,"quantity":24,"unit_price":1250.00,"line_total":30000.00,"price_basis":"PACK","pack_unit_id":7,
  "pack_unit_name":"Carton","pack_factor":12.000000,"pack_quantity":2,"pack_price":15000.00,"list_price":15000.00,"price_overridden":false},
 {"variant_id":12,"quantity":5,"unit_price":1250,"line_total":6250,"price_basis":"PACK_RATE","pack_unit_id":7,
  "pack_unit_name":"Carton","pack_factor":12.000000,"pack_quantity":null,"pack_price":15000.00,"list_price":1250,"price_overridden":false},
 {"variant_id":12,"quantity":"3","unit_price":"1400.00","price_basis":"BASE","list_price":1400.00,"price_overridden":false}]
```

**Direct purchase line (payload)** — `{"variant_id":12,"unit_id":7,"quantity_received":"3","unit_cost":"12600.00","extra_base_quantity":"4"}` → expanded to the same line without `extra_base_quantity`, plus `{"variant_id":12,"unit_id":<base>,"quantity_received":"4","unit_cost":"1050.00","pack_rate_of_unit_id":7}`.
