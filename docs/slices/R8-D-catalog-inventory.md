# R8-D — Catalog and Inventory Acceptance Candidate

## Status

Implementation candidate on `task/r8-d-catalog-inventory`, based on
`02469cb928af48d9bd07754bf159952a45a32ed0`. R8-D is not accepted until the
Rust, PostgreSQL 18, and Windows/Tauri checks below pass on the exact candidate.

The first published candidate, `c2573d0`, passed the complete deterministic
R8-D business journey on Windows. Acceptance remained blocked by a Rust format
failure, an R0-003 transaction-benefit analytics regression exposed after
R0-004, and GitHub database workflows that did not bootstrap the required
`stockiha_admin` role. The remediation keeps R8-D business behavior unchanged.

## Implemented boundary

- Permission-aware Catalog & Stock navigation. The UI capability projection
  is safe-deny; database operation functions remain authoritative.
- Warehouse inventory view with backend product/SKU/barcode search, optional
  inactive rows, exact quantity, warehouse WAC, and total inventory value.
- Official immutable receipt results returned after an idempotent posting:
  document number, received quantity/value, and resulting quantity/value/WAC.
- Official adjustment result presentation, including journal identity and
  exact movement/resulting totals.
- Independent add-variant and edit-variant state, with unique input IDs.
- EN/FR/AR labels and existing RTL/layout primitives for the new workflow.

## Database and security design

Migration `20260811120000_r8_d_inventory_read_side.sql` adds only
owner-controlled `SECURITY DEFINER` projections:

- `inventory.get_capabilities(text)`
- `inventory.list_inventory_snapshot(text,bigint,text,boolean)`
- `inventory.get_stock_receipt_result(text,bigint)`

`PUBLIC` execution is revoked and `stockiha_runtime` receives only function
execution. Snapshot reads require `MANAGE_INVENTORY`; receipt-result reads
require `POST_STOCK_RECEIPT`. Existing catalog, receipt, and adjustment
functions continue to perform their own session and permission checks.

The read side does not recalculate authoritative stock. Quantity, WAC, value,
negative-stock rejection, official numbering, movement immutability, atomicity,
and idempotency remain owned by the existing PostgreSQL posting path. Exact
numeric values cross Rust/IPC as decimal strings.

Forward migration `20260811130000_r0_004_historical_benefit_compat.sql`
preserves the R0-004 line-level analytics breakdowns and restores the public
transaction-level benefit contract for R0-003 data. It does not mutate
historical rows or any operational ledger. The primary and historical-upgrade
CI workflows now bootstrap the same grant-target role required by the
historical migrations, and the primary Rust job enforces format, check,
Clippy-with-warnings-denied, and tests.

## Deterministic acceptance journey

1. As a manager, create product `R8-D Notebook` with variants `R8D-NB-S` and
   `R8D-NB-L`, base unit `PC`, Size attribute values Small/Large, distinct
   barcodes, and an exact alternate carton factor of `12.000000`.
2. Receive `10.000 PC` at `100.00 DZD`, then `10.000 PC` at `120.00 DZD`.
3. Verify `20.000 PC`, total value `2200.0000 DZD`, and WAC `110.000000 DZD`.
4. Retry the second receipt with the same request ID and payload. Verify the
   same document ID and exactly one stock movement.
5. Post a `DAMAGE` adjustment of `-1.000 PC`. Verify `19.000 PC`, value
   `2090.0000 DZD`, and a balanced `110.00 DZD` journal.
6. Attempt `-20.000 PC`. Verify rejection with no document, movement,
   position, journal, or idempotency mutation.
7. Deactivate `R8D-NB-L`. Verify it is hidden by default and visible only when
   inactive rows are requested.
8. Verify a cashier cannot see or invoke the manager-only catalog/inventory
   actions, and an invalid session is rejected.

The PostgreSQL assertions for this journey live in
`src-tauri/tests/inventory/r8_d_catalog_inventory_integration.sql` and are wired
into `src-tauri/tests/run_current_sql_suites.sh`.

## Evidence recorded in this environment

- `npm run typecheck` — passed.
- `npm run lint` — passed.
- Focused catalog/inventory/i18n workflow suite — passed; the final inventory
  retry/result regression file passed all 6 tests.
- `npm test` — 22 files and 131 tests passed.
- `npm run build` — passed; Vite emitted only the existing large-chunk warning.
- `bash -n src-tauri/tests/run_current_sql_suites.sh` — passed.
- `git diff --check` — passed.

## First Windows verification (`c2573d0`)

- Exact branch/SHA and clean-worktree protection passed.
- Frontend typecheck, lint, 131 tests, and production build passed.
- Rust check, Clippy, and 253 tests passed; `cargo fmt --check` found one
  formatting-only diff in `stock_receipt.rs`.
- The complete PostgreSQL 18 migration chain reached `20260811120000`; the
  dedicated R8-D catalog/inventory SQL suite and all operational suites passed.
- The R0-003 historical expenses/benefit suite exposed the transaction-benefit
  compatibility regression repaired by migration `20260811130000`.
- The real Tauri journey passed exact WAC, idempotency, damage adjustment,
  negative-stock rollback, permission denial, EN/FR/AR, RTL, light/dark,
  narrow-window, and restart/persistence checks.
- Control totals after the accepted damage adjustment were `19.000 PC`,
  `2090.0000 DZD` total value, and `110.000000 DZD` WAC.

## Required Windows/Antigravity checks

- Run `cargo fmt --check`, `cargo check`, Clippy with warnings denied, and
  `cargo test`.
- Apply the complete migration chain through `20260811130000` to a disposable
  PostgreSQL 18 test database and run the current SQL suite runner.
- Run the deterministic journey above through the real Tauri application,
  including safe receipt retry and rejected negative-stock verification.
- Restart the application and confirm inventory, official document results,
  language/RTL rendering, and permission-aware navigation remain correct.
- Record the exact commit SHA, database identity, commands, control totals, and
  any defect. Any unexplained stock/value/journal variance blocks acceptance.

Linux verification cannot prove Windows WebView2/Tauri runtime behavior or the
local PostgreSQL service configuration.
