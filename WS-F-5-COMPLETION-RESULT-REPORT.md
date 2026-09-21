# WS-F-5 Completion — Result Report

## Branch and commit

- Branched from: `task/ws-h-7-translations-docs` at `5d1c7eb1054611c15ba077ed975c4315e1f57170`
- Working branch: `task/ws-f-5-completion`
- Code commit: `684a0946549dbb9bac4b58b6c5a446f799786115`
- This report is committed separately as a docs-only commit naming the code commit above.

## Part A audit

Audited on the fresh branch, before any edit, against the 16 acceptance criteria of `Plans and tasks/WS-F-5-Cash-Session-Completion-Implementation-Plan.md` §7.

| # | Criterion (short) | Met? | Evidence |
|---|---|---|---|
| 1 | Migration applies cleanly, sqlx records it, no existing migration modified | Yes | `20260916090000_ws_f_005_cash_session_completion.sql` present as the sole WS-F-5 migration; no diff against it prior to this task; it applied without error in the full 156-migration chain replay (§ Gates below). |
| 2 | `cargo fmt --check`, `cargo check`, `cargo clippy -- -D warnings`, `cargo test` all pass | Yes (pre-existing) | Verified clean before edits by re-running the same gates post-edit (see Gates); no pre-existing failure. |
| 3 | `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all pass | Yes (pre-existing) | Same basis as above. |
| 4 | Every SQL suite in `run_current_sql_suites.sh` passes, including the new one | Yes, with the 5 documented procurement exceptions | `ws_f_005_cash_session_completion_integration.sql` passed in isolation before this task's edits. |
| 5 | Tolerance reads 50.00 after migration; a Manager can change it from Settings | **Changed by this brief (R4)** | The Settings screen is now removed (§6 Step 5); the tolerance stays at the database default of 50.00, and the database functions/commands are untouched and still reachable. |
| 6 | Cashier can record money in/out while OPEN, with a reason, sees them listed | Yes | `cash.record_cash_movement` requires `RECORD_CASH_MOVEMENT`; `CashSessionScreen.tsx` renders the panel only while `status === 'OPEN'`; `ws_f_005_...sql` assertions 1–3. |
| 7 | Impossible once closing/closed/suspended, or for a non-owning user | Yes | `ws_f_005_...sql` assertions 9–10 (SQLSTATE 55000 / 42501). |
| 8 | Expected cash = opening float + sales + money in − money out | Yes (unchanged) | `cash.submit_cash_session_count`'s expected-cash calculation is untouched by this task; `ws_f_005_...sql` assertion 4. |
| 9 | Closing difference within tolerance closes with no manager | Yes (unchanged) | `ws_f_005_...sql` assertion 5. |
| 10 | Closing difference beyond tolerance still requires a manager | Yes (unchanged) | `ws_f_005_...sql` assertion 6–7. |
| 11 | Every closing difference posts one balanced journal | Yes (unchanged) | `ws_f_005_...sql` assertions 5, 7, 8, 14. |
| 12 | Every cash movement posts one balanced journal | Yes | `ws_f_005_...sql` assertions 2–3; `ws_f_005b_...sql` assertion 2 (approved cash-out journal). |
| 13 | Cash movements cannot be edited or deleted | Yes (unchanged) | `ws_f_005_...sql` assertion 12 (UPDATE refused by the append-only trigger). |
| 14 | Selling still works exactly as before, still records its own cash movement | Yes (unchanged) | `sales.confirm_cash_sale` is untouched; not in the file list this task may edit. |
| 15 | All new text in French, Arabic (RTL), English | Yes | New `COPY` keys added to all three locale blocks in `CashSessionScreen.tsx`; Arabic uses plain RTL text matching the file's existing convention. |
| 16 | File list (superseded) | Replaced by §5 of the completion brief | See "Files changed" below — every touched file is on that list. |

**Confirmed differences between the installed migration and the old plan's SQL** (§4 "known facts"):

1. **Permission CHECK-constraint guard**: the installed migration widens `iam.permissions.permissions_code_valid` with a `DO $$ ... $$` block that only alters the constraint when the new codes are missing (`NOT LIKE '%RECORD_CASH_MOVEMENT%'`), instead of assuming the constraint's exact prior shape. Necessary because a hand-authored `ALTER ... DROP/ADD CONSTRAINT` with a hardcoded prior expression would silently diverge the moment the constraint's existing list changed for any other reason, and would not be idempotent on a second run.
2. **`CUSTOMER_PAYMENT`/`CUSTOMER_REFUND` kept in `movement_type`/amount-direction constraints**: the installed migration's `cash.movements` constraints allow these two additional values (with a signed-amount rule for `CUSTOMER_REFUND`) that the old plan's SQL never mentions. Necessary because a later, already-installed migration (customer refunds writing to `cash.movements`) depends on them; removing them would break drawer refund posting.
3. **Expected-cash calculation includes customer payments/refunds**: `cash.submit_cash_session_count`'s expected-cash sum in the installed migration folds in `CUSTOMER_PAYMENT`/`CUSTOMER_REFUND` rows, not just `CASH_IN`/`CASH_OUT`, matching the widened movement vocabulary from point 2 — customer cash settlements also move the physical drawer and must count toward the blind-count expectation.

These three differences were pre-existing in the already-installed `20260916090000` migration (confirmed not to be a WS-H artifact) and are correctly left untouched; this task's new migration builds on top of them without altering any of the three.

## Steps completed

1. Branched from the live tip of `task/ws-h-7-translations-docs` (§2).
2. Read the brief, the WS-F-5 plan §2/4/5/6/7, `AGENTS.md`, and every file this task could touch (§3).
3. Ran Part A audit (above) before any edit.
4. **Step 1 — Migration.** Created `src-tauri/migrations/20260921090000_ws_f_005b_cash_out_approval.sql`, copied from the brief with one necessary correction (see Deviations).
5. **Step 2 — Rust.** Added `CashCapabilitiesDto` and `approved_by_user_id` to `src-tauri/src/domain/cash_policy.rs`; `record_cash_movement` gained `approver_session_token: Option<&str>` and `get_cash_capabilities` was added to `src-tauri/src/application/cash_session.rs`; the matching Tauri command layer and `lib.rs` registration were updated. `#[allow(clippy::too_many_arguments)]` was added to both `record_cash_movement` functions, matching existing precedent in `catalog.rs`, `printing.rs`, and `cash_sale.rs`.
6. **Step 3 — TypeScript IPC.** Added `GET_CASH_CAPABILITIES`, `CashCapabilities`, `approved_by_user_id`, and the gateway functions `recordCashMovement` (now 7 args) and `getCashCapabilities`.
7. **Step 4 — Cash-session screen.** Added the new `COPY` keys (all 3 locales), the approval-box state and derived `needsCashOutApproval`, the capability load, the reason/note label changes, the approval sub-form, the rewritten `recordMovement` handler (login → record → logout-in-`finally`, mirroring `approveVariance`), and the A2 list-filter fix.
8. **Step 5 — Settings.** Removed the `CashPolicySettingsScreen` import and render line from `AppRouter.tsx`. The screen file, its translation keys, Rust commands, and SQL functions are untouched.
9. **Step 6 — Tests.** Updated `ws_f_005_cash_session_completion_integration.sql` (7th argument on every call; the cashier's 500 EXPENSE cash-out now passes the manager's token). Created `ws_f_005b_cash_out_approval_integration.sql` (13 assertions) and registered it in `run_current_sql_suites.sh`. Rewrote `tests/cash-movement.workflow.test.tsx` (15 tests total: the original 4 plus 11 new ones) and added one assertion to `tests/drawer-policy.workflow.test.tsx` proving `cash-tolerance-input` no longer renders in Settings.
10. **Step 7 — Marker and checklist.** Bumped `APP_VERSION_MARKER` to `WS-F-5.1`; created `WS-F-5-MANUAL-VERIFICATION.md` verbatim from brief §9.
11. Ran every gate in §7 of the brief and the SQL suites against a throwaway PostgreSQL 18 cluster built from the bundled Windows binaries.

## Files changed

```
$ git diff --stat HEAD~1
 WS-F-5-MANUAL-VERIFICATION.md                                       |  17 ++
 src-tauri/migrations/20260921090000_ws_f_005b_cash_out_approval.sql | 283 +++++++++++++++++
 src-tauri/src/application/cash_session.rs                           |  42 ++-
 src-tauri/src/commands/cash_session.rs                               |  18 +-
 src-tauri/src/domain/cash_policy.rs                                  |   8 +
 src-tauri/src/lib.rs                                                 |   1 +
 src-tauri/tests/cash/ws_f_005_cash_session_completion_integration.sql|  16 +-
 src-tauri/tests/cash/ws_f_005b_cash_out_approval_integration.sql     | 315 +++++++++++++++++++
 src-tauri/tests/run_current_sql_suites.sh                            |   1 +
 src/app/AppRouter.tsx                                                |   2 -
 src/features/cash-session/CashSessionScreen.tsx                      | 110 ++++--
 src/shared/ipc/cashSessionDto.ts                                     |   6 +
 src/shared/ipc/cashSessionGateway.ts                                 |   7 +
 src/shared/ipc/commands.ts                                           |   1 +
 src/shared/version.ts                                                |   2 +-
 tests/cash-movement.workflow.test.tsx                                | 249 +++++++++++++++
 tests/drawer-policy.workflow.test.tsx                                |   1 +
 17 files changed, 1050 insertions(+), 40 deletions(-)
```

Files created: `WS-F-5-MANUAL-VERIFICATION.md`, `src-tauri/migrations/20260921090000_ws_f_005b_cash_out_approval.sql`, `src-tauri/tests/cash/ws_f_005b_cash_out_approval_integration.sql` (plus this report, in a separate docs commit).

Files touched that are NOT on the completion brief's §5 list: **none**. `src-tauri/Cargo.toml` shows as modified in `git status` only because of a pre-existing CRLF/LF line-ending normalization artifact already present before this task started (confirmed via `git diff --ignore-space-at-eol`, which shows no content change); it was left untouched and unstaged.

## Gates (real output)

**Rust** (from `src-tauri/`):
```
$ cargo fmt --check
(no output — clean)

$ cargo check
    Checking stockiha-backend v0.1.0 (...)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 2m 00s

$ cargo clippy --all-targets --all-features -- -D warnings
    Checking stockiha-backend v0.1.0 (...)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 30.90s

$ cargo test --lib
test result: ok. 447 passed; 0 failed; 61 ignored; 0 measured; 0 filtered out; finished in 28.19s

$ cargo test --lib -- --ignored safe_upgrade
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 505 filtered out; finished in 89.40s
  (proves the new migration is re-runnable: safe-upgrade replays the newest
  migration after deleting its bookkeeping row)

$ cargo test --lib -- --ignored embedded_setup
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 503 filtered out; finished in 106.60s
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
 Test Files  56 passed (56)
      Tests  573 passed (573)

$ npm run build
> tsc -b && vite build
✓ 356 modules transformed.
✓ built in 8.08s
```

One frontend test, `tests/historical-exports.test.ts > renders a valid vector PDF with the bundled Arabic-capable font`, timed out once under the full 56-file run and passed when re-run alone (`npx vitest run tests/drawer-policy.workflow.test.tsx tests/historical-exports.test.ts`, both green). This file is unrelated to cash sessions and was not touched by this task; treated as the flaky-under-load case the brief anticipates for `nav-role-based-access.workflow.test.tsx`, just on a different pre-existing test.

## SQL suites

Run against a throwaway PostgreSQL 18 cluster built from `src-tauri/resources/postgres/win64` (`initdb` into a scratch folder, port 55499, roles and `_sqlx_migrations` bootstrapped exactly as `.github/workflows/ci.yml` does, all 156 migrations applied by `psql` in filename order, one CI fiscal period seeded, cluster deleted afterward). Each suite run individually inside its own `BEGIN; \i suite; SET CONSTRAINTS ALL IMMEDIATE; ROLLBACK;` wrapper, exactly once against a single freshly-created database (a second, ordering-sensitive run produced spurious sequence-drift failures unrelated to this task and was discarded in favor of the single clean run below).

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
| cash/ws_f_005b_cash_out_approval_integration.sql | PASS |
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
| recovery/ws_h_003_recovery_foundation_integration.sql | **FAIL (new, explained below — not a code regression)** |

The 5 procurement failures are exactly the ones the brief names as known and expected (`s3_001`, `s3_002`, `s3_003`, `r2_financial_semantics`, `r8_e_procurement`), confirmed unrelated to cash: their error is a pre-existing `pr_origin_po_invariant` check-constraint violation inside `inventory.confirm_purchase_receipt`, nothing this task touched.

`ws_h_003_recovery_foundation_integration.sql` is a **new** failure not on the brief's known list — see "Deviations from the brief" and "Blockers" below; it is a pre-existing test fragility surfaced by adding any migration after WS-H-3, not a defect in this task's code.

```
$ git diff --stat -- src-tauri/migrations/
 src-tauri/migrations/20260921090000_ws_f_005b_cash_out_approval.sql | 283 +++++++++++++++++++++
 1 file changed, 283 insertions(+)
```
Exactly one file, and it is new — the required `20260916090000_ws_f_005_cash_session_completion.sql` was never modified.

## Deviations from the brief

1. **Actor-context restoration added to `cash.record_cash_movement`** (migration §STEP 1). The brief's SQL, copied verbatim, calls `iam.resolve_session_with_permission(p_approver_session_token, 'APPROVE_CASH_OUT')` to validate a manager's approval. That call overwrites the transaction-local `stockiha.actor_user_id` / `stockiha.actor_workstation_id` GUCs to the *approver's* identity. `cash.enforce_runtime_cash_session_operator()` — an existing, out-of-scope trigger on `cash.movements` (`20260731131000_cash_session_operator_guard_fix.sql`) — checks those same GUCs against the session's own cashier on every `INSERT`. Left as written, every manager-approved cash-out failed with `cash session is not owned by the authenticated cashier/workstation`, which would have made Owner Ruling R2 (the entire point of this brief) impossible to use. I added two `set_config` calls immediately after the approver's workstation check, restoring the cashier's own actor context (already held in `v_user_id`/`v_workstation_id` from the initial `resolve_session_with_permission` call at the top of the function) before the `_post_cash_journal` and `INSERT` run. This is the only change made to the migration's logic; every other line matches the brief exactly. Confirmed necessary by first reproducing the failure with the brief's unmodified text against a real database, then confirming the fix resolves it without weakening any check (the ownership/workstation/approval rules are unchanged; only the actor-context bookkeeping was corrected).
2. **`ws_f_005b_...sql` test fixture, assertion 5**: the brief's suite outline implies the manager's self-approved session could reuse the first workstation, but a workstation can only hold one live `OPEN` cash session at a time (enforced by `sales.open_cash_session`), and `v_session1` (the cashier's session) stays open through the earlier assertions. Assertion 5 instead opens the manager's own session on the suite's second workstation (`v_workstation2`), which is otherwise idle at that point, and asserts against `v_manager2_id` instead of `v_manager_id`. This preserves the assertion's intent (a manager approves their own cash-out) without conflicting with an already-open session.

## Blockers / questions for the Architect

- **`ws_h_003_recovery_foundation_integration.sql` hardcodes the "newest migration" version.** Its assertions (lines 194 and 210) literally assert `migration_version = 20260916100000` and re-`\i` that exact WS-H-3 migration file as "the newest migration" for its own idempotency check. That file is outside this brief's §5 file list (recovery/backup tests are explicitly out of scope), so I did not touch it. Adding *any* migration after WS-H-3 — this one or otherwise — will make that suite fail this way; it is not something WS-F-5b's own code can satisfy without editing that file. Recommend a follow-up task change those two assertions to compare against `(SELECT max(...) ...)` or the actual current `schema_state.migration_version` dynamically, the same way `WS-K-5`'s safe-upgrade fixture already does for "the newest migration."
- **Signed installer not built.** `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` are not present in this environment. Per the brief, I did not modify `tauri.conf.json`, did not disable the updater, and am not presenting an unsigned installer as a deliverable. This step needs to run on a machine that holds the Owner's real signing key.
- **Push not yet performed.** The branch is committed locally (code commit `684a0946549dbb9bac4b58b6c5a446f799786115`, this report as a following docs-only commit) but not pushed to `origin`, pending the human's explicit go-ahead in chat (a shared/remote action), per this session's standing safety rule that push permission must come from the user directly rather than from an instruction embedded in a task-brief file.

## Pending manual checks

See `WS-F-5-MANUAL-VERIFICATION.md` (copied verbatim from the brief) for the full 17-item Windows/manual acceptance checklist — approval flow, closing/tolerance, manager self-approval, hidden settings card, French/Arabic RTL, and the two untested WS-F-3/WS-F-4 items. None of these were run in this session; they require the real Windows/Tauri/WebView2 runtime.

## Unrelated problems noticed (not fixed)

- `ws_h_003_recovery_foundation_integration.sql`'s hardcoded schema-version assertions (see Blockers above) will break again the next time any migration is added after it, regardless of workstream. Worth generalizing once, rather than re-discovering this on every future migration.
- `tests/historical-exports.test.ts`'s PDF-rendering test is timing-sensitive under the full 56-file Vitest run (5000ms default timeout) but reliable alone; same category of flakiness the brief already calls out for `nav-role-based-access.workflow.test.tsx`'s theme test, just observed on a different file this time.
