---
name: ws-d-skill
description: The mandatory implementation protocol for WS-D (Product & Inventory Core) in the Stockiha desktop ERP — the product catalogue, product variants, SKUs, barcodes, categories, brands, attributes, units, reference-data lifecycle, catalogue search and pagination, stock receipts, stock adjustments, stock levels, and inventory analytics. Use this skill whenever a task touches the catalog.* or inventory.* PostgreSQL schemas, src-tauri/src/application/catalog.rs, inventory.rs, stock_receipt.rs, stock_adjustment.rs, src/features/products/, src/features/inventory/, ItemSearchModal.tsx, or the product/variant DTOs in src/shared/ipc/ — even if the user never says "WS-D", and even if the request sounds trivial, like "fix the products page", "add a barcode field", "make the search faster", or "the stock number looks wrong". This catalogue has already needed six emergency repair migrations caused by contract drift across the SQL, Rust, and TypeScript layers; do not skip this skill because a change looks small.
---

# WS-D — Product & Inventory Core Implementation Protocol

You are the **heavy engineering agent** working on the catalogue and stock core of Stockiha.

This skill layers on top of `stockiha-task-execution`, which governs *how* you work — source-of-truth order, scope discipline, git safety, result reports. **This skill governs what "correct" means for the catalogue and for stock quantity.** Where the two overlap, follow both; where this one is stricter, this one wins.

It also sits beside `ws-b-skill`, which owns money. The boundary is in §6 and it is not negotiable: WS-D decides *what an item is* and *how many there are*; WS-B decides *what it is worth*.

WS-D is the workstream with the worst repair record in this repository. Between `20260814170000` and `20260815121000` the catalogue needed six consecutive emergency migrations — `repair_purchase_transaction_contract`, `fix_catalog_variant_attribute_mapping`, `harden_catalog_runtime_contract`, `remove_ambiguous_catalog_barcode_helper`, `repair_legacy_catalog_create_contract`, `remove_legacy_catalog_batch_create`. Not one was exotic. Every one was a contract failure: the SQL function, the Rust caller, and the TypeScript type stopped agreeing, the build stayed green, and the failure surfaced only when a human clicked a button. Assume your change will fail the same way unless you prove otherwise.

---

## 0. Gate 0 — establish reality before writing anything

The catalogue is the most re-edited surface in the project. Functions here are not defined once; several are defined three or four times across migrations, and **as of D-1 some now exist as deliberate overloads, live simultaneously**. Reading one `.sql` file and believing it is a reliable way to write broken code.

Before implementing anything:

1. **Read `references/ws-d-surface-map.md`.** It lists every file, migration, table, and function in WS-D. Use it to build a reading list, not as a substitute for reading.
2. **Establish the live signature of every function you will call or change.** Not from the first migration that mentions it — from the database:
   ```sql
   SELECT p.oid::regprocedure AS live_signature, p.provolatile, p.prosecdef
   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('catalog','inventory') AND p.proname = 'update_product'
   ORDER BY 1;
   ```
   More than one row means overloads exist. Read §2 before writing a single call.
3. **Run `references/verification-queries.sql`.** It takes seconds and answers questions you would otherwise guess.
4. **Identify the authoritative layer.** For anything deciding an identifier, a quantity, a permission, or a search result, the answer is PostgreSQL. If you are about to put that logic in Rust or React, stop.
5. **Check for an existing implementation before adding one.** Duplicate lookup paths are how a scanner ends up resolving to the wrong item.

State findings at the top of your report as *verified* (you ran it and saw output), *read but not executed*, or *assumed*. Anything in the third category cannot support an acceptance criterion.

---

## 1. What WS-D owns — and what it must not touch

| ID | Sub-plan |
|---|---|
| D-0 | Baseline merge, branch setup, design ruling |
| D-1 | Catalogue database layer |
| D-2 | Rust/Tauri command layer and TypeScript DTOs |
| D-3 | Catalogue Setup screen — categories, brands, attributes, units |
| D-4 | Products list rebuild |
| D-5 | Product create/edit rebuild — quick add and advanced |
| D-6 | FR/AR translation strings |
| D-7 | Global barcode-first search |
| D-8 | Inventory analytics — low stock, valuation display, turnover |
| D-9 | Windows/Tauri integration and acceptance |

This table carries **no statuses on purpose**. Current position lives in `CURRENT_STEP.md`. A status written here goes stale within days and then actively misleads you.

**WS-D must NOT contain:**

- **Product images or media storage** — deferred scope, repository-wide.
- **TVA / tax** — MVP is zero-tax. Never introduce tax into a price, a valuation, or an analytics figure.
- **WAC or COGS arithmetic** — WS-B, component B-7. See §6.
- **Printable, exportable, or financial-statement reporting** — WS-I. D-8 builds on-screen operational widgets only.
- **Multi-location in-transit transfers, automated replenishment** — post-MVP.
- **Audit and change logging** — WS-L, deliberately late.
- **Settings screen redesign** (WS-C), **procurement workflow** (WS-E), **POS checkout flow** (WS-F). You may read these. You may not reshape them.

**Protected work — extend only, never rebuild:** Inventory Corrections (`20260817090000_inventory_corrections_policy.sql`, `InventoryCorrectionsSettingsScreen.tsx`, `inventoryCorrectionsGateway.ts`) and Direct Purchase (`20260816150000_direct_purchase_foundation.sql` and its repair chain). If you believe protected work is wrong, report it and continue with your assigned task.

**D-7 blast radius exception.** Global barcode search legitimately requires touching the application shell, which WS-J otherwise owns. Permitted files, and only these: `src/app/AppShell.tsx`, `src/shared/components/ItemSearchModal.tsx`, and the search entry points in `src/features/pos/PosScreen.tsx`. Search behaviour only — no layout changes, no navigation restructuring, no styling beyond what the search control itself requires. Anything wider is a stop condition.

---

## 2. The catalogue contract traps

These four are the specific mechanisms by which this codebase has broken before. Walk all four explicitly for every function you touch, and say so in your report.

### 2.1 Overloads are live — the newest definition does not replace the old one

D-1 deliberately added widened overloads and left the originals in place:

| Function | Live signatures |
|---|---|
| `catalog.update_product` | 5-arg (original) **and** 7-arg (adds `p_category_id`, `p_brand_id`) |
| `catalog.update_variant` | 5-arg (original) **and** 6-arg (adds `p_minimum_stock`) |

Rules:

- **Call the widest overload.** New Rust code targets the 7-arg and 6-arg versions. The narrow ones exist only until their existing callers migrate.
- **Never add a third overload.** If a signature needs to widen again, widen the existing wide one and update every caller in the same change. This repository has already deleted an ambiguous helper once (`remove_ambiguous_catalog_barcode_helper`); do not recreate the condition.
- **When the last caller of a narrow overload is gone, propose dropping it** in your report. Do not drop it silently in the same task.

### 2.2 Cast every argument explicitly

With overloads live, an untyped `NULL` is genuinely dangerous. PostgreSQL sees `unknown`, and either binds the wrong overload or fails with `function ... is not unique` — at runtime, in front of the user, not at compile time.

```rust
// WRONG — untyped NULL, ambiguous against two live overloads
sqlx::query("SELECT catalog.update_product($1, $2, $3, $4, $5, $6, $7)")

// RIGHT — every parameter carries its type
sqlx::query("SELECT catalog.update_product($1::text, $2::bigint, $3::text, \
             $4::bigint, $5::boolean, $6::bigint, $7::bigint)")
```

### 2.3 Never rely on SQL `DEFAULT` from Rust

`catalog.quick_create_product` and `catalog.list_products_v2` declare parameter defaults. Those defaults exist for psql convenience and for future callers. **Pass every parameter explicitly from Rust anyway.** A positional call that omits trailing arguments silently changes meaning the moment anyone reorders or inserts a parameter, and the compiler cannot see it.

### 2.4 The contract triangle

Every WS-D data path crosses three boundaries and all three must agree exactly:

```
PostgreSQL                      Rust                          TypeScript
catalog.list_products_v2   ->   application/catalog.rs   ->   shared/ipc/dto.ts
(arg order, arg types,          commands/catalog.rs           shared/ipc/gateway.ts
 every RETURNS TABLE column,    (sqlx query, FromRow struct)  shared/ipc/commands.ts
 nullability)
```

`list_products_v2` returns **20 columns**. A struct that omits one, misnames one, or types one as non-nullable when the SQL can return NULL compiles cleanly and fails at runtime. Open all three before changing any one. Re-read all three after. Report the triangle explicitly: *"SQL signature X, Rust struct Y, TS type Z — verified matching."*

---

## 3. Hard invariants

- **Product → variant is the identity model.** Stock, barcodes, prices, `minimum_stock`, and movements attach to the **variant**. A single-variant product is still a product with one variant — never add a shortcut that treats it as a bare product.
- **Identifier derivation is centralised.** `catalog._generate_sku` and `catalog._effective_variant_name` are the only places SKU and effective name are derived. Do not reimplement either in SQL, Rust, or React.
- **`display_identifier` prefers barcode, falls back to SKU.** Computed in SQL by `list_products_v2`. React displays it; React never recomputes it. `identifier_type` tells the UI which one it got — use it rather than inferring.
- **Barcodes are globally unique and resolve to exactly one variant.** `catalog.resolve_barcode` is the only authorised resolution path. A barcode miss returns no match. It must never fall back to fuzzy name matching — a silent fallback in a scanner field means selling the wrong item.
- **Confirmed negative stock is forbidden at the database constraint level.** Never relax, defer, or mark a stock constraint `NOT VALID` to make a migration or test pass. A blocking constraint means the operation is wrong, not the constraint.
- **Movements and posted documents are immutable.** `inventory.forbid_movement_mutation`, `forbid_stock_adjustment_mutation`, and `forbid_residual_clearance_mutation` enforce this. Corrections go through linked reversals or explicit adjustment documents. Never `UPDATE` or `DELETE` a movement row.
- **Rounding residuals are already solved.** `inventory._handle_residual_at_zero_quantity` and `src-tauri/src/domain/residual.rs` define the policy. Do not add a second one.
- **Reference-data deletion is blocked while in use.** All five types — categories, brands, attributes, attribute values, units — return a `usage_count` and refuse deletion when non-zero. Deactivation is the soft path. Never add a delete route that bypasses the check.
- **`minimum_stock = 0` means "no low-stock warning for this item."** This is documented in the column comment in the D-1 migration and D-8 depends on it. It is a meaning, not a default.
- **Low-stock predicate:** an item is low when `quantity_on_hand <= minimum_stock AND minimum_stock > 0`. Out-of-stock is a separate signal and must be reported separately. *(Owner default, at-or-below chosen deliberately: hitting the floor is the moment to reorder. If the Project Owner rules otherwise, this line is the only place to change.)*
- **Analytics are read-only.** D-8 functions must be `STABLE`, must not write, and must not take locks a POS transaction needs.

---

## 4. Function authoring contract

Every new `catalog.*` or `inventory.*` function follows the shape D-1 established. Deviating breaks the security model silently.

1. `SECURITY DEFINER` and `SET search_path = pg_catalog`.
2. Session validation as the first statement in the body:
   - read paths → `PERFORM 1 FROM iam.resolve_session(p_session_token);`
   - write paths → `PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');`
3. Read functions marked `STABLE`. Write functions left `VOLATILE`.
4. `REVOKE ALL ON FUNCTION <name>(<exact arg types>) FROM PUBLIC;` at the end of the migration, matching the pattern in D-1 §1021 onward. **A replaced function loses its grants** — re-issue them or it fails at runtime, not at migration time.
5. Validation errors raised with `ERRCODE = '22023'` and a message naming the offending value, matching existing functions so `tauriError.ts` and `useErrorText.ts` can translate them. A new error code with no translation shows the operator a raw string.
6. Server-side limits are clamped, never trusted from the client. `list_products_v2` does `LEAST(GREATEST(coalesce(p_limit,100),1),100)`. Copy that shape.

Hiding a button in React is not authorisation. Settings decides whether a capability is enabled; RBAC decides who may use it; both must be enforced on both sides.

---

## 5. Search and identifier discipline

**Escape user input before it reaches `LIKE`/`ILIKE`.** This is not theoretical — it was caught in D-1 review. A product named `50% cotton` returned wrong matches because `%` is a wildcard. The fix is in `list_products_v2`:

```sql
v_pattern := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
-- and every comparison must carry the escape clause:
... ILIKE v_pattern ESCAPE '\'
```

Both halves are required. The escaping without `ESCAPE '\'` on the comparison does nothing. Any new search path repeats both, and any new search path gets a regression test with a metacharacter in the search term.

**Search must remain server-side.** 5,000 products and 17,500 variants is the design target. Never fetch a full list and filter in React — it works fine on your seed data and dies on the customer's.

**Barcode-first means:** the field holds focus by default, scanner input terminated by Enter resolves and acts without a mouse, and an exact barcode match short-circuits ahead of fuzzy results. Extend `ItemSearchModal.tsx`; do not fork a parallel search component.

---

## 6. The WS-B boundary — money is not yours

`ws-b-skill` owns component B-7, inventory valuation (WAC) and COGS derivation.

- WS-D **posts** receipts and adjustments, which cause WAC to be recalculated by WS-B's logic.
- WS-D **displays** cost and value — `list_products_v2` returns `last_known_wac` for exactly this purpose.
- WS-D **never computes, adjusts, rounds, or re-derives** WAC, COGS, inventory value, or any monetary figure.

If a task appears to require changing WAC arithmetic, that is a WS-B task under `ws-b-skill`. Stop and escalate. Two workstreams computing the same number is how ledgers diverge.

Numeric discipline still binds you: no `f32`, `f64`, `double precision`, `real`, or JavaScript `number` for quantity, cost, price, minimum stock, or unit conversion factor — including intermediate steps, display rounding, and test fixtures. `numeric` in SQL, `rust_decimal::Decimal` in Rust, string transport across IPC, `exactDecimal.ts` in React.

---

## 7. Frontend rules

The product frontend is at 4.0/10 and rebuilding it is in scope, so you have latitude here you do not have in the backend. Within these limits:

- `DESIGN.md` is authoritative for colour, type scale, spacing, elevation, components, accessibility. Use existing CSS custom properties; introduce no new hard-coded colours or one-off spacing.
- **The D-0 colour ruling stands:** WS-D adopts the new layout system but keeps the current blue `#2457d6`. The palette change is WS-J. Do not repaint anything.
- Numeric columns use tabular numerals, right aligned (`DESIGN.md` §5.3, §7.6). Misaligned quantities are a real defect for an eight-hour operator.
- All user-facing strings go through `src/shared/i18n/`. French default, Arabic RTL, English. A hard-coded string is an incomplete change.
- Reuse `exactDecimal.ts` and `formatters.ts`. Do not add a second decimal or formatting helper.
- New screens must be registered in `src/app/AppRouter.tsx`. New Tauri commands must be registered in `src-tauri/src/lib.rs` — an unregistered command fails silently at runtime.

### 7.1 Build version marker — every task, no exceptions

`stockiha-task-execution` §3.5 requires bumping the dashboard version string on every code change. WS-D pins the format, because the string is currently free text (`[ version = final WS-h-not-verified ]`) and a stale marker is worse than none — the tester believes they are on the new build when they are not.

In `src/features/dashboard/DashboardScreen.tsx`, the marker reads:

```
[ version = WS-D-<sub-plan>.<bump> ]
```

`<sub-plan>` is the sub-plan you are executing (`2`, `4`, `8`). `<bump>` starts at `1` and increments once per delivered task within that sub-plan, including corrective re-runs. Executing D-2 for the first time gives `[ version = WS-D-2.1 ]`; a fix after review gives `[ version = WS-D-2.2 ]`.

Rules:

- Bump it in the **same commit** as the change, not a follow-up commit. A separate commit can be checked out independently and the marker then lies.
- The marker is the **first line of your manual test checklist**: "Open the dashboard, confirm it reads `[ version = WS-D-2.1 ]`. If it does not, stop — you are testing the wrong build."
- State the exact string you set in your report so the owner can compare it against the running app.
- Bump on Rust-only and SQL-only changes too. The tester still needs to know which build they are on, and the backend is precisely where they cannot see the difference.
- If the marker is missing or unparseable, report it as a blocker rather than inventing a value.

---

## 8. Known failure patterns in this codebase

Each of these has actually happened here. Check yourself against all six before reporting.

1. **Contract drift** — SQL renamed, Rust or TS not. Six repair migrations, August 14–15.
2. **Ambiguous function resolution** — a helper existed in two shapes; `remove_ambiguous_catalog_barcode_helper` deleted it. Overloads are now live again by design, so §2.1 and §2.2 are load-bearing.
3. **Unescaped `LIKE` metacharacters** — caught in D-1 review before merge. See §5.
4. **Verification that never ran** — a report claimed passing tests from a command executed in the wrong directory against a package name that does not exist. See §10.
5. **Non-ASCII bytes in PowerShell scripts** — em-dashes and smart quotes become parser errors under Windows-1252 that look like unrelated syntax failures.
6. **Client-side filtering that scales fine on seed data** and fails at 5,000 products.

---

## 9. Definition of Done

1. Behaviour implemented at the authoritative layer (PostgreSQL for identity, quantity, permission, search).
2. Contract triangle verified and stated for every function touched.
3. All four traps in §2 walked explicitly.
4. Migration applies cleanly to an **empty** database, verified, not assumed.
5. Regression test added for any bug fixed, including a metacharacter case for any search change.
6. Applicable checks run with literal output pasted (§10).
7. Worked example below executed with real numbers.
8. Dashboard version marker bumped in the same commit (§7.1), and its exact value stated.
9. Final diff contains nothing outside scope.
10. Windows/manual checks identified and listed, never claimed.

### The worked example — run this, with these numbers

Seed three products via `catalog.quick_create_product`, then verify:

| # | Setup | Expected |
|---|---|---|
| 1 | `50% cotton shirt`, barcode `6130000000017`, min stock 5 | `display_identifier` = `6130000000017`, `identifier_type` = barcode |
| 2 | `Plain tee`, **no barcode**, min stock 0 | `display_identifier` = generated SKU, `identifier_type` = sku |
| 3 | `Cotton socks`, barcode `6130000000024`, min stock 0 | — |

Then:

- `list_products_v2(search => '50%')` returns **exactly one row**, product 1. Not three, not zero. This is the escaping test.
- `list_products_v2(search => '6130000000017')` returns exactly product 1.
- `resolve_barcode('6130000000099')` (unknown) returns **no match** — not a fuzzy name result.
- With product 1 at quantity 5: it **is** low stock (`5 <= 5`, min > 0). Products 2 and 3 are **never** low stock at any quantity, because min = 0.
- `total_count` on a paginated call reflects the full result set, not the page size.
- Attempt to delete the category used by product 1 → refused, `usage_count` non-zero.

Paste the actual output. A described expectation is not a result.

---

## 10. Verification

Run from the repository root. Read `references/ws-d-surface-map.md` §7 for the full command set and the acceptance-database configuration.

```bash
# Frontend — only if src/ changed
npm run typecheck && npm run lint && npm test -- --run && npm run build

# Rust — only if src-tauri/src/ changed
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --lib

# SQL suites — if migrations changed
bash src-tauri/tests/run_current_sql_suites.sh
```

Facts that stop a command silently doing nothing: the Cargo **package** is `stockiha-backend`, the **lib target** is `stockiha_lib` — they are different, and `--package stockiha_lib` matches nothing and exits cleanly having run zero tests. A real run ends in `test result: ok. N passed; 0 failed`. No such line means the tests did not run, whatever else the terminal said.

**A verification you did not run does not exist.** Paste literal output including the command and the working directory. `NOT RUN — reason` is an acceptable answer. An inferred pass is a task failure.

Windows-only surfaces — WebView2 rendering, physical scanners, Arabic RTL output, printers, cash drawers, installers — cannot be established from a Linux run. List them for the owner as numbered steps with exact expected results. Never claim them.

---

## 11. Stop conditions

Continue autonomously through ordinary problems — failing tests, missing grants, compile errors, naming mismatches. That is the job.

Stop and escalate when:

- The task requires changing WAC, COGS, or any monetary arithmetic (§6).
- The task requires relaxing a negative-stock constraint, a movement-immutability trigger, or a `SECURITY DEFINER` authorisation boundary.
- The task requires a third overload of an existing function, or removal of a narrow overload that still has callers.
- The task requires touching WS-C Settings, WS-E Procurement, or WS-F POS beyond the D-7 file allowlist in §1.
- The task requires touching protected work (Inventory Corrections, Direct Purchase).
- Correct behaviour depends on a business rule the documents do not answer.
- Two attempts at the same failure have not moved it. Do not send a third variation — report what each attempt ruled out and hand back a diagnosis.

When you stop, give the blocker, what you tried, and two or three options with their cost. Never wait idle without a proposal.

---

## 12. Result report

```
## What changed
Files touched, one line each, grouped SQL / Rust / React.

## Evidence classification
Verified (ran it) / Read but not executed / Assumed.

## Contract triangle
Per function: SQL signature, Rust struct and call site, TS type. Matching or not.

## Catalogue traps walked
Overloads (§2.1) / explicit casts (§2.2) / no reliance on DEFAULT (§2.3) / triangle (§2.4).

## Worked example result
The §9 table, with actual output.

## Verification output
Literal terminal output per command, with working directory. NOT RUN where applicable.

## Invariants
Which §3 invariants this change touches and how each is preserved.

## Build version marker
The exact string set in DashboardScreen.tsx, e.g. [ version = WS-D-2.1 ].

## Pending Windows/manual checks
Step 1 is always: confirm the dashboard reads the version above.
Then numbered steps, exact expected result each.

## Unrelated problems found
Named, not fixed.

## Not finished / could not verify
```
