# WS-F-6 — Result Report (Cancel a Whole Sale / Sale Void)

## Branch and commit

- Precondition confirmed: the Owner stated the WS-F-5 manual verification (17 checks) passed on a real installed build before this task started.
- Branched from: `task/ws-f-5-completion` at `dd7baec821720bed49b40daafeead1963f5c47b0` (tip after the WS-F-5.1 tauri.conf.json version bump)
- Working branch: `task/ws-f-6-sale-void`
- Code commit: `84a3d19d1b11a4cf79aa5da5a47de8ddae3165cb`
- This report is committed separately, docs-only, naming the code commit above.

## Steps completed

1. Confirmed the newest migration was `20260921090000_ws_f_005b_cash_out_approval.sql` before creating a new one.
2. Read the brief, `AGENTS.md`, `sales.confirm_cash_sale` (WS-F-003), `sales.confirm_credit_sale` (WS-F-004), `receivables.net_invoice_allocated_amount` / the customer-refund constraint-guard pattern (drawer_policy_customer_refunds), the WS-F-005/005b cash-session functions, and the existing `CashSessionScreen.tsx` / `printReceipt.ts` / `receiptBuilder.ts`.
3. **Step 1 — Migration.** Created `src-tauri/migrations/20260922090000_ws_f_006_sale_void.sql`, copied verbatim from the brief: `VOID_SALE` permission, `SALE_VOID` document type/sequence, `cash.movements` accepting a negative `SALE_VOID` row, the immutable `sales.sale_voids` table, the widened `receivables.net_invoice_allocated_amount` (adds the `CREDIT_NOTE` term), `sales.void_sale`, and `sales.list_session_sales`.
4. **Step 2 — Rust.** `src-tauri/src/domain/sale_void.rs` (new, `pub mod`), `src-tauri/src/application/sale_void.rs` (new), `src-tauri/src/commands/sale_void.rs` (new), all copied/adapted exactly per the brief's shapes; registered in `domain/mod.rs`, `application/mod.rs`, `commands/mod.rs` (alphabetical position) and `lib.rs` (directly below `commands::cash_session::get_cash_capabilities`). `cargo fmt` reformatted the three new files after initial authoring (multi-line signatures/arrays) — no logic changed.
5. **Step 3 — TypeScript IPC.** `COMMANDS.VOID_SALE` / `COMMANDS.LIST_SESSION_SALES`; new `src/shared/ipc/saleVoidDto.ts` and `src/shared/ipc/saleVoidGateway.ts`, copied from the brief.
6. **Step 4 — The cancellation slip.** Exported `padEnd`, `padStart`, `toPrinterBytes` from `receiptBuilder.ts` (no body change). New `src/features/pos/voidSlipBuilder.ts` with `buildThermalVoidSlip` (the 14-step ESC/POS layout from the brief) and `buildA4VoidSlip` (via `buildOfficialDocumentHtml`). Added `printVoidSlip` to `printReceipt.ts`, mirroring `printSaleReceipt` exactly.
7. **Step 5 — The panel and labels.** New `src/features/cash-session/SessionSalesPanel.tsx` with its own `COPY` (en/fr/ar per §6 STEP 5a), the sales table, the cancellation dialog (reason select starting on `CUSTOMER_CHANGED_MIND`, conditional note label, validation, print-again), wired into `CashSessionScreen.tsx` directly after the cash-movement-panel section under the same `OPEN`-only condition. `formatters.ts`: added `SALE_VOID` to `humanDocumentType`, changed the Arabic `REVERSED` label to `ملغى`. Customers screens: confirmed by `grep -rn "CREDIT_INVOICE" src/features/customers/` that no label map exists there (ledger entry types are not rendered through a translation map in that feature) — no file was touched, per the brief's fallback instruction.
8. **Step 6 — Tests.** New `src-tauri/tests/sales/ws_f_006_sale_void_integration.sql` (16 assertions), registered in `run_current_sql_suites.sh` directly after the WS-F-5b line. New `tests/void-slip-builder.test.ts` (5 tests) and `tests/session-sales-void.workflow.test.tsx` (12 tests).
9. **Step 7 — Marker and checklist.** `APP_VERSION_MARKER = 'WS-F-6.0'`; created `WS-F-6-MANUAL-VERIFICATION.md` verbatim from brief §9.
10. Ran every gate in §7, and the SQL suites against a throwaway PostgreSQL 18 cluster.

## Files changed

```
$ git diff --stat HEAD~1
 WS-F-6-MANUAL-VERIFICATION.md                                       |  17 +
 src-tauri/migrations/20260922090000_ws_f_006_sale_void.sql          | 646 +++++++++++++++++
 src-tauri/src/application/mod.rs                                    |   1 +
 src-tauri/src/application/sale_void.rs                              |  49 ++
 src-tauri/src/commands/mod.rs                                       |   1 +
 src-tauri/src/commands/sale_void.rs                                 |  40 ++
 src-tauri/src/domain/mod.rs                                         |   1 +
 src-tauri/src/domain/sale_void.rs                                   | 111 +++
 src-tauri/src/lib.rs                                                |   2 +
 src-tauri/tests/run_current_sql_suites.sh                           |   1 +
 src-tauri/tests/sales/ws_f_006_sale_void_integration.sql            | 648 +++++++++++++++++
 src/features/cash-session/CashSessionScreen.tsx                     |   5 +
 src/features/cash-session/SessionSalesPanel.tsx                     | 375 ++++++++++
 src/features/pos/printReceipt.ts                                    |  27 +
 src/features/pos/receiptBuilder.ts                                  |   6 +-
 src/features/pos/voidSlipBuilder.ts                                 | 157 ++++
 src/shared/ipc/commands.ts                                          |   2 +
 src/shared/ipc/saleVoidDto.ts                                       |  50 ++
 src/shared/ipc/saleVoidGateway.ts                                   |  37 ++
 src/shared/utils/formatters.ts                                      |   3 +-
 src/shared/version.ts                                               |   2 +-
 tests/session-sales-void.workflow.test.tsx                          | 428 +++++++++++
 tests/void-slip-builder.test.ts                                     |  81 +++
 23 files changed, 2685 insertions(+), 5 deletions(-)
```

Files created: `WS-F-6-MANUAL-VERIFICATION.md`, `src-tauri/migrations/20260922090000_ws_f_006_sale_void.sql`, `src-tauri/src/{domain,application,commands}/sale_void.rs`, `src-tauri/tests/sales/ws_f_006_sale_void_integration.sql`, `src/features/cash-session/SessionSalesPanel.tsx`, `src/features/pos/voidSlipBuilder.ts`, `src/shared/ipc/saleVoidDto.ts`, `src/shared/ipc/saleVoidGateway.ts`, `tests/session-sales-void.workflow.test.tsx`, `tests/void-slip-builder.test.ts` (plus this report and `WS-F-6-COMPLETION`-..., in a separate docs commit).

Files touched that are NOT on the brief's §5 list: **none**. `src-tauri/Cargo.toml` shows as modified in `git status` only because of the pre-existing CRLF/LF line-ending artifact already present before WS-F-5 and WS-F-6 both started (confirmed via `git diff --ignore-space-at-eol`, no content change); left untouched and unstaged, as before.

## Gates (real output)

**Rust** (from `src-tauri/`):
```
$ cargo fmt --check
(initially reformatted 3 new files — multi-line signatures/const array; no logic change; re-ran cargo fmt, then cargo fmt --check was clean)

$ cargo check
    Checking stockiha-backend v0.1.0 (...)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 1m 39s

$ cargo clippy --all-targets --all-features -- -D warnings
    Checking stockiha-backend v0.1.0 (...)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 40.65s

$ cargo test --lib
test result: ok. 453 passed; 0 failed; 61 ignored; 0 measured; 0 filtered out; finished in 22.54s
  (447 pre-existing + 6 new sale_void::tests unit tests)

$ cargo test --lib -- --ignored safe_upgrade
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 511 filtered out; finished in 75.75s
  (proves the new migration is re-runnable)

$ cargo test --lib -- --ignored embedded_setup
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 509 filtered out; finished in 92.38s
```

**Frontend** (from repo root):
```
$ npm run typecheck
> tsc -b
(clean)

$ npm run lint
> eslint .
(clean)

$ npm test -- --run
 Test Files  58 passed (58)
      Tests  590 passed (590)
  (one earlier run showed tests/historical-exports.test.ts timing out under
  full-suite load, and my own tests/session-sales-void.workflow.test.tsx
  test 1 failing on a race between the PERMISSION_DENIED rejection and the
  synchronous assertion — see "Deviations"; both fixed, then a clean full
  run produced 58/58 files and 590/590 tests green including
  historical-exports)

$ npm run build
> tsc -b && vite build
✓ 360 modules transformed.
✓ built in 7.49s
```

## SQL suites

Run against a throwaway PostgreSQL 18 cluster built from `src-tauri/resources/postgres/win64` (`initdb` into a scratch folder, port 55499, roles and `_sqlx_migrations` bootstrapped exactly as `.github/workflows/ci.yml` does, all 157 migrations applied by `psql` in filename order, one CI fiscal period seeded, cluster deleted afterward). Each suite run individually inside its own `BEGIN; \i suite; SET CONSTRAINTS ALL IMMEDIATE; ROLLBACK;` wrapper, exactly once against a single freshly-created database.

| Suite | Result |
|---|---|
| catalog/s2_001_catalog_integration.sql | PASS |
| catalog/ws_d_001_catalogue_foundation_integration.sql | PASS |
| catalog/ws_d_003_active_attribute_filtering_integration.sql | PASS |
| inventory/r8_d_catalog_inventory_integration.sql | PASS |
| inventory/s2_003_zero_quantity_safeguards_integration.sql | PASS |
| procurement/s3_001_procurement_integration.sql | **FAIL (known, pre-existing)** |
| procurement/s3_002_landed_cost_and_invoices_integration.sql | **FAIL (known, pre-existing)** |
| procurement/s3_003_supplier_returns_and_payments_integration.sql | **FAIL (known, pre-existing)** |
| procurement/r2_financial_semantics_integration.sql | **FAIL (known, pre-existing)** |
| procurement/r8_e_procurement_integration.sql | **FAIL (known, pre-existing)** |
| procurement/direct_purchase_acceptance_integration.sql | PASS |
| procurement/ws_e_002_purchase_payment_integration.sql | PASS |
| procurement/ws_e_003_purchase_return_integration.sql | PASS |
| receivables/s4_001_credit_sale_integration.sql | PASS |
| sales/ws_f_004_credit_limit_warning_integration.sql | PASS |
| cash/ws_f_005_cash_session_completion_integration.sql | PASS |
| cash/ws_f_005b_cash_out_approval_integration.sql | **FAIL (new, explained below — not a code regression)** |
| **sales/ws_f_006_sale_void_integration.sql** | **PASS (all 16 assertions)** |
| receivables/s4_001_customer_payment_integration.sql | PASS |
| cash/s4_002_cash_session_lifecycle.sql | PASS |
| cash/s4_002_cash_session_ownership_integration.sql | PASS |
| receivables/s4_003_drawer_refund_integration.sql | PASS |
| onboarding/r0_001_historical_finance_staging_integration.sql | PASS |
| onboarding/r0_001_excel_correction_reuse_integration.sql | PASS |
| onboarding/r0_001_setting_audit_integration.sql | PASS |
| onboarding/r0_001_onboarding_backup_acl_integration.sql | PASS |
| onboarding/r0_002_historical_trade_staging_integration.sql | PASS |
| onboarding/r0_003_historical_expenses_benefit_integration.sql | PASS |
| onboarding/r0_004_historical_line_party_benefit_integration.sql | PASS |
| onboarding/r0_005_historical_product_alias_integration.sql | PASS |
| onboarding/r5_002_opening_state_reconciliation_integration.sql | PASS |
| onboarding/r5_003_opening_state_setup_lifecycle_integration.sql | PASS |
| onboarding/r5_003_opening_state_application_integration.sql | PASS |
| recovery/r6_001_recovery_authorization_audit_integration.sql | PASS |
| recovery/r6_001_backup_role_read_privileges_integration.sql | PASS |
| recovery/r6_001_sqlx_metadata_backup_acl_integration.sql | PASS |
| recovery/r6_002_restore_verification_authorization_integration.sql | PASS |
| recovery/ws_h_003_recovery_foundation_integration.sql | **FAIL (known from WS-F-5's report — not a code regression)** |

The 5 procurement failures are exactly the ones the brief names as known and expected.

`ws_f_005b_cash_out_approval_integration.sql` **newly** fails its own assertion 12 (`schema_state.migration_version is 20260922090000 instead of 20260921090000`) and `ws_h_003_recovery_foundation_integration.sql` still fails for the same reason already reported in `WS-F-5-COMPLETION-RESULT-REPORT.md`: **both suites hardcode "the newest migration's version" as a literal constant**, so adding *any* subsequent migration — this one or any future one — breaks them by design. Neither file is on this brief's §5 list, so neither was touched. See "Blockers" below.

```
$ git diff --stat -- src-tauri/migrations/
 src-tauri/migrations/20260922090000_ws_f_006_sale_void.sql | 646 ++++++++++++++++++++
 1 file changed, 646 insertions(+)
```
Exactly one file, and it is new — no existing migration was modified.

## Deviations from the brief

1. **`cargo fmt` reformatted the three new Rust files** after initial authoring (the brief's inline code snippets used a denser style than this project's rustfmt config produces for multi-line function signatures and array literals). No logic was changed — purely whitespace/line-wrapping.
2. **`buildA4VoidSlip`'s "no signature section" is not actually achievable.** The brief calls for `signatures: []` to suppress the signature block. `buildOfficialDocumentHtml` (shared, out of scope — explicitly forbidden to modify) contains `const sigsToRender = signatures.length > 0 ? signatures : defaultSignatures;`, which falls back to its own default signature labels whenever the array is empty, not just when the option is omitted. I implemented `buildA4VoidSlip` exactly as instructed (`signatures: []`), verified the real rendered output (it does contain default labels like "Service Émetteur"), and adjusted `tests/void-slip-builder.test.ts`'s corresponding assertion to check only for the escaped void number rather than asserting an impossible "no signature section." This is a pre-existing limitation of the shared function, not something WS-F-6 introduced or can fix within its file list.
3. **Two of my own test-writing bugs, found and fixed during development** (not brief defects): (a) `ws_f_006_sale_void_integration.sql` assertion 10 initially captured the customer's exposure *before* posting the test payment instead of right before the refused void attempt, making a correct refusal look like a false failure — fixed by moving the capture. (b) The same suite's assertion 11 setup initially relied on `now()` alone to distinguish "session4 was open when the sale posted" from "session5 opened afterward"; since the whole suite runs inside one transaction, `now()` is frozen to the transaction's start and every row shares one timestamp. Backdated session4's `opened_at` and forward-dated session5's `opened_at` (both plain, non-immutable columns) to bracket the sale's frozen timestamp realistically; `sales.credit_sales.created_at` itself could not be adjusted the same way because that table is immutable once posted (confirmed by hitting `posted or reversed credit sales are immutable`). (c) `tests/session-sales-void.workflow.test.tsx` test 1 checked `queryByTestId(...).not.toBeInTheDocument()` synchronously right after an unrelated `findByTestId`, racing the `PERMISSION_DENIED` rejection under full-suite load; wrapped in `waitFor`.
4. **`tauri.conf.json`'s numeric `"version"` was intentionally left untouched at `"0.6.0"`,** per the brief's explicit instruction not to modify that file. Note for the Owner: `0.6.0` is the same numeric version already published for the WS-F-5.1 release — this build must **not** be pushed to `Stockiha-releases` as an update without first bumping that numeric version (to e.g. `0.7.0`) and rebuilding, or the updater will treat it as "not newer" for every shop already on `0.6.0`, per the project's own `WS-K-6-RELEASE-PROCESS.md`.

## Blockers / questions for the Architect

- **Two out-of-scope test files hardcode "the newest migration's version"** (`ws_f_005b_cash_out_approval_integration.sql` assertion 12, and `ws_h_003_recovery_foundation_integration.sql`, both flagged already in `WS-F-5-COMPLETION-RESULT-REPORT.md`). Every migration added from here on will break one more such file unless this pattern is generalized (compare against `(SELECT max(...) ...)` the way `WS-K-5`'s safe-upgrade fixture already does, instead of a literal constant). Neither file is on this brief's §5 list, so I did not touch either.
- **A4 signature suppression is not implemented anywhere in the shared HTML builder.** `buildOfficialDocumentHtml`'s `signatures: []` behaves identically to omitting the option (falls back to locale defaults). If a genuinely signature-free A4 document is ever required, that shared function needs a real "no signatures" path (e.g. `signatures: null` or a boolean flag), which is out of this task's scope.
- **Numeric version reuse risk** (see Deviations #4) — flagging explicitly so this build is not accidentally published as a live update under the already-shipped `0.6.0`.

## Pending manual checks

See `WS-F-6-MANUAL-VERIFICATION.md` (copied verbatim from the brief) for the full 15-item Windows/manual acceptance checklist — cancel/print flow, double-cancel prevention, discounted-sale cancellation, credit-sale cancellation and balance restoration, the partly-paid refusal, Documents/Journals visibility, printing-disabled behavior, closed-session lockout, and French/Arabic RTL. None of these were run in this session; they require the real Windows/Tauri/WebView2/printer runtime.

## Unrelated problems noticed (not fixed)

- Same two hardcoded-migration-version test files as in "Blockers" — noted once more here since they are exactly the category of "unrelated problem noticed but not fixed" this heading exists for.
- `tests/historical-exports.test.ts`'s PDF-rendering test is timing-sensitive under the full parallel Vitest run (5000ms default timeout); it and my own new workflow test both surfaced a timing-related failure on one run and passed cleanly on a subsequent one. Nothing in `historical-exports.test.ts` was touched — this is the same category of pre-existing flakiness the brief already anticipates for `nav-role-based-access.workflow.test.tsx`.

---

## Signed installer

Built with `npm run tauri:build`, `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` set in the same shell (the Owner's key, provided directly in this conversation for the WS-F-5.1 release and reused here — same application, same key). `tauri.conf.json` was not modified and the updater was not disabled.

- **Installer path:** `src-tauri\target\release\bundle\nsis\Stockiha_WS-F-6.0-setup.exe`
- **Size:** 50,955,377 bytes ≈ 48.59 MB
- **Signature:** `Stockiha_0.6.0_x64-setup.exe.sig` alongside it (unrenamed, matching existing convention)

## Push

**Pushed: no.** Per the brief, the branch is committed locally (code commit `84a3d19d1b11a4cf79aa5da5a47de8ddae3165cb`, docs commit to follow) but not pushed to `origin`, pending the Owner's explicit "yes" in chat.
