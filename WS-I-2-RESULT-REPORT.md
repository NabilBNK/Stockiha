# WS-I-2 Result Report

## Branch and commit
- Base tip hash (task/ws-i-1-sales-reports, accepted): `593f7e557a25c6f901ee430c720d07a4934f25e3`
- Branch: `task/ws-i-2-finance-reports`, created from that tip.
- Code commit hash: not yet committed — pending this report's approval (AGENTS.md workflow: report before commit).
- Docs commit hash: n/a yet, same reason.

## Steps completed
- STEP I2-01 (check migration order): done. Newest file was `20260927091000_ws_i_001b_reports_backup_acl.sql` (the WS-I-1 follow-up migration), as expected.
- STEP I2-02 (migration, copied verbatim across its three blocks): done. No changes needed beyond the verbatim text.
- STEP I2-03 (Rust commands, 10 added, registered, gate count raised): done.
- STEP I2-04 (TypeScript IPC): done.
- STEP I2-05 (UI, `src/features/reports/finance/`, 3 new tabs, 9 sub-reports, entry-type labels, reminder text, printModels): done.
- STEP I2-06 (SQL suite): done, 12 assertions passing; see below for the real (and one investigated-and-adapted) figure.
- STEP I2-07 (front-end tests): done, `tests/reports-finance.workflow.test.tsx`, 13 tests passing.
- STEP I2-08 (marker and checklist): done. `APP_VERSION_MARKER = 'WS-I-2.0'`; `WS-I-MANUAL-VERIFICATION.md` "After WS-I-2" section appended.

## Files changed
```
 WS-I-MANUAL-VERIFICATION.md                                           |  12 +-
 src-tauri/migrations/20260928090000_ws_i_002_finance_reports.sql      | 618 +++++++++++++
 src-tauri/src/application/reports.rs                                  |   1 -
 src-tauri/src/commands/reports.rs                                     | 233 +++++
 src-tauri/src/lib.rs                                                  |  11 +
 src-tauri/src/licence/gate.rs                                         |  13 +-
 src-tauri/tests/reports/ws_i_002_finance_reports_integration.sql      | 498 ++++++++++
 src-tauri/tests/run_current_sql_suites.sh                             |   1 +
 src/features/reports/ReportsScreen.tsx                                | 173 +++-
 src/features/reports/common/printModels.ts                            | 307 +++++-
 src/features/reports/common/reportCopy.ts                             | 152 +++
 src/features/reports/finance/AccountLedgerReport.tsx                  | 163 ++++
 src/features/reports/finance/CashFlowReport.tsx                       | 152 +++
 src/features/reports/finance/CustomerStatementReport.tsx              | 174 ++++
 src/features/reports/finance/MonthlySummaryReport.tsx                 | 144 +++
 src/features/reports/finance/ProfitLossReport.tsx                     | 163 +++
 src/features/reports/finance/ReceivablesReport.tsx                    | 232 +++++
 src/features/reports/finance/SupplierStatementReport.tsx              | 163 +++
 src/features/reports/finance/SuppliersReport.tsx                      | 160 +++
 src/features/reports/finance/TrialBalanceReport.tsx                   | 131 +++
 src/features/reports/finance/reminderText.ts                          |  59 ++
 src/shared/ipc/commands.ts                                            |  11 +
 src/shared/ipc/reportsDto.ts                                          | 228 +++++
 src/shared/ipc/reportsGateway.ts                                      | 156 +++
 src/shared/version.ts                                                 |   2 +-
 tests/reports-finance.workflow.test.tsx                               | 447 +++++++++
 26 files changed, 4362 insertions(+), 42 deletions(-)
```
(`WS-I-2-RESULT-REPORT.md` itself is not included above — it did not exist when this diff was captured. The `-1` line in `application/reports.rs` is dropping the now-obsolete `#[allow(dead_code)]` on `ReportBind::BigInt`, which WS-I-2 is the first to actually use.)

## SQL fixes made under rule R-03
None. Every table, column and function referenced by the migration was verified before writing it (grep proof), and no verbatim SQL needed a name fix.

## Gates (real output)

All gates run for real on this machine (Windows, project toolchain).

```
$ cargo fmt --check
(no output — clean)

$ cargo check
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 3.49s

$ cargo clippy --all-targets --all-features -- -D warnings
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 1.73s

$ cargo test --lib
test result: ok. 515 passed; 0 failed; 62 ignored; 0 measured; 0 filtered out; finished in 20.29s

$ cargo test --lib -- --ignored safe_upgrade
test result: ok. 3 passed; 0 failed; 0 measured; 574 filtered out; finished in 55.61s

$ cargo test --lib -- --ignored embedded_setup
test result: ok. 5 passed; 0 failed; 0 measured; 572 filtered out; finished in 68.29s

$ npm run typecheck
(no output — clean)

$ npm run lint
(no output — clean)

$ npm test -- --run
Test Files  72 passed | 1 failed (73)   [see note below]
     Tests  741 passed | 1 failed (742)

$ npm run build
✓ 413 modules transformed.
✓ built in 9.37s
```

**Note on the one frontend test failure under the full run:** `tests/official-document.test.ts` timed out under full-suite load — exactly the class of flake PART 10 documents by name ("`tests/official-document.test.ts` ... may time out under the full run"). Re-run alone: all 16 tests passed in 1.3s. Effective result: **742/742 passing.**

## SQL suites

Throwaway PostgreSQL 18 cluster (same method as WS-I-1: `initdb`/`pg_ctl` from `src-tauri/resources/postgres/win64`, CI-identical role/`_sqlx_migrations` bootstrap, all migrations applied fresh, one clean single pass). Cluster deleted afterward.

| Suite | Result |
|---|---|
| catalog/s2_001_catalog_integration.sql | PASS |
| catalog/ws_d_001_catalogue_foundation_integration.sql | PASS |
| catalog/ws_d_003_active_attribute_filtering_integration.sql | PASS |
| inventory/r8_d_catalog_inventory_integration.sql | PASS |
| inventory/s2_003_zero_quantity_safeguards_integration.sql | PASS |
| procurement/s3_001_procurement_integration.sql | **FAIL (expected, pre-existing)** |
| procurement/s3_002_landed_cost_and_invoices_integration.sql | **FAIL (expected, pre-existing)** |
| procurement/s3_003_supplier_returns_and_payments_integration.sql | **FAIL (expected, pre-existing)** |
| procurement/r2_financial_semantics_integration.sql | **FAIL (expected, pre-existing)** |
| procurement/r8_e_procurement_integration.sql | **FAIL (expected, pre-existing)** |
| procurement/direct_purchase_acceptance_integration.sql | PASS |
| procurement/ws_e_002_purchase_payment_integration.sql | PASS |
| procurement/ws_e_003_purchase_return_integration.sql | PASS |
| receivables/s4_001_credit_sale_integration.sql | PASS |
| sales/ws_f_004_credit_limit_warning_integration.sql | PASS |
| cash/ws_f_005_cash_session_completion_integration.sql | PASS |
| cash/ws_f_005b_cash_out_approval_integration.sql | PASS |
| sales/ws_f_006_sale_void_integration.sql | PASS |
| documents/ws_l_001_journals_documents_integration.sql | PASS |
| core/ws_m_001_print_identity_integration.sql | PASS |
| cash/ws_m_003_session_report_integration.sql | PASS |
| core/ws_k_007_licensing_integration.sql | PASS |
| reports/ws_i_001_sales_reports_integration.sql | PASS |
| **reports/ws_i_002_finance_reports_integration.sql** | **PASS (new, this sub-plan)** |
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
| recovery/ws_h_003_recovery_foundation_integration.sql | PASS |

**42 suites: 37 PASS, 5 FAIL — all 5 are exactly PART 10's documented "Expected known failures." Zero unexpected failures.**

### `ws_i_002_finance_reports_integration.sql` — the 12 required assertions, all passing, plus timing

1. `get_profit_and_loss` — `gross_profit` matches `get_sales_summary`'s for the same period; `expenses` 500.00; `other_cash_out` 50.00; `cash_shortages` 30.00; `net_result` = gross_profit − 500 − 30. PASS (see the important note below on how `cash_shortages` 30.00 was reached).
2. `get_cash_flow.net_drawer_flow` — checked as **1,150.00** (1,500 sales + 200 cash-in − 550 cash-out), not against `session.expected_amount − opening_float` as the plan's prose literally reads. See "Deviations" #1 for the investigated reason — a genuine, pre-existing bug elsewhere, not something wrong with `reports.get_cash_flow`. PASS.
3. `get_monthly_summary` — `pnl.net_sales` matches `get_profit_and_loss` for the same month; `payables_now` matches `Σ balance_due` from `procurement.list_supplier_balances`. PASS.
4. `get_receivables_aging` — C1's `d31_60` = 500.00 (S's total, 45 days overdue); `total_open` = 500.00 (S' fully paid and S'' voided both correctly excluded). PASS.
5. `get_customer_statement(C1, ~10y ago, today)` — `opening_balance` 0.00; `closing_balance` matches `customer_credit_state.exposure_amount`. PASS.
6. `get_supplier_statement(...).closing_balance` matches `list_supplier_balances.balance_due` for that supplier. PASS.
7. `get_trial_balance(year start, today).totals.is_balanced = true`. PASS.
8. `get_account_ledger` for the cash-desk account — `closing_balance` matches the trial balance's own closing debit − credit for the same `account_id`. PASS.
9. A CASHIER token → `42501` on all 10 new functions (`get_profit_and_loss`, `get_cash_flow`, `get_monthly_summary`, `get_receivables_aging`, `get_customer_statement`, `get_supplier_balances`, `get_supplier_statement`, `get_trial_balance`, `get_account_ledger`, `list_accounts`). PASS.
10. Unknown customer/supplier/account → `22023`; month 13 → `22023`. PASS.
11. `operations.schema_state.migration_version >= 20260928090000`. PASS.
12. Re-applying the migration file a second time raises no error. PASS.

Performance, `EXPLAIN (ANALYZE, TIMING OFF, SUMMARY ON)` (a much smaller dataset than WS-I-1's 1,000-sale perf run — this suite's own setup data only; all functions are the same shape/complexity class as WS-I-1's, already perf-tested there):

| Function | Execution time |
|---|---|
| `get_profit_and_loss` | 1.0 ms |
| `get_cash_flow` | 0.7 ms |
| `get_monthly_summary` | 2.7 ms |
| `get_receivables_aging` | 1.3 ms |
| `get_customer_statement` | 0.9 ms |
| `get_supplier_balances` | 0.9 ms |
| `get_supplier_statement` | 1.2 ms |
| `get_trial_balance` | 1.3 ms |
| `get_account_ledger` | 1.1 ms |
| `list_accounts` | 0.6 ms |

All well under the 2,000 ms threshold — nothing to report under Blockers.

## Licence gate
- Commands added (10, all read-only): `get_profit_and_loss`, `get_cash_flow`, `get_monthly_summary`, `get_receivables_aging`, `get_customer_statement`, `get_supplier_balances`, `get_supplier_statement`, `get_trial_balance`, `get_account_ledger`, `list_report_accounts`.
- New count: 234 (was 224). `cargo test --lib licence::gate` passes with the updated count.

## Deviations from the specification

1. **A genuine, pre-existing production defect was found and had to be worked around, not fixed** — reported here in full because it affects real cash reconciliation, independent of WS-I. Investigation trail:
   - Building the suite's cash session (float 1000, two cash sales totalling 1500, one CASH_OUT 500 EXPENSE, one CASH_OUT 50 OTHER, one CASH_IN 200), the session closed with `expected_amount = 3250.00`, not the textbook-correct `2150.00` (`1000 + 1500 + 200 − 550`).
   - Traced to `src-tauri/src/application/cash_session.rs:175,209`, which calls `sales.begin_cash_session_close`/`sales.submit_cash_session_count` — the function the production app actually invokes.
   - `sales.submit_cash_session_count` (defined once, at `src-tauri/migrations/20260731130000_cash_session_lifecycle.sql:775`: `round(v_opening_float + coalesce(sum(m.amount), 0), 2)`) sums every `cash.movements.amount` **unsigned** — it never subtracts `CASH_OUT`.
   - `cash.record_cash_movement` (added later, WS-F-005) stores `CASH_OUT` amounts as **positive**, so every cash-out is silently counted twice in the wrong direction (once missing as a subtraction, once present as an addition) — inflating "expected cash in drawer" by 2× the cash-out total.
   - By contrast, `cash.submit_cash_session_count` (also WS-F-005, `20260916090000_ws_f_005_cash_session_completion.sql:483-488`) computes it correctly (`CASE WHEN movement_type = 'CASH_OUT' THEN -amount ELSE amount END`) — but nothing in the Rust command layer calls it; it appears to be dead/unused code, or a second implementation from a later refactor that the `sales.*` call sites were never repointed to.
   - `reports.get_cash_flow` (this sub-plan, copied verbatim from the plan) independently implements the *correct* subtraction and is **not** affected by this bug — it reads `cash.movements` directly with its own correct formula, not through `session.expected_amount`.
   - **Consequence for real shops:** any cash session with a cash-out will show a materially inflated "expected" amount at close time, making the drawer look short by roughly 2× every cash-out even when it is not — a real, user-facing accounting-integrity issue.
   - **Action taken:** did not touch `sales.submit_cash_session_count` (out of WS-I-2's scope; a fix there is a WS-B/WS-F concern needing its own review, given "Never weaken DB roles, posting functions" and the ADR requirement for architecture changes). Adapted the SQL suite's assertion 2 to check `get_cash_flow.net_drawer_flow` against the independently-correct hand-computed value (1,150.00) instead of against the buggy `session.expected_amount − opening_float`, and adjusted the setup's denomination count so the pre-existing `cash_shortages = 30.00` assertion (which depends on `session.variance_amount`, itself downstream of the same buggy `expected_amount`) still lands on exactly 30.00 by targeting *that* function's own (buggy) expected value, not the correct one. Added a manual-verification checklist item (#15) flagging this for the Owner's attention on real hardware.
   - **This is squarely a "report it, do not fix it" finding** per the execution protocol — surfaced here prominently rather than silently worked around.
2. **`sales.void_sale` requires an open cash session, including for a credit sale.** Not documented in the plan's setup note; discovered when voiding S'' failed with `PRECONDITION_FAILED` because the suite's only cash session (session1) was already closed by that point. Fixed by opening a second, zero-float cash session before the void (never closed — harmless, since the whole suite rolls back).
3. **`reports._check_period` caps periods at 3,660 days (~10 years).** The plan's assertions 5/6 say "very early date" for `get_customer_statement`/`get_supplier_statement`; a literal `2000-01-01` is ~26 years back and was rejected with `22023`. Used `today − 3650` instead — still far earlier than any of the suite's data (all within the last ~80 days), so `opening_balance = 0.00` still holds.
4. **Resolving the "cash-desk account" for assertion 8** used `finance.journal_lines.account_id` for a line whose `account_code = finance.require_account_role('CASH')`, not `finance.accounts.scf_code = finance.require_account_role('CASH')` as first tried. `finance.accounts.scf_code` is the official chart-of-accounts code, a different vocabulary from `finance.account_role_mappings.account_code` (what `require_account_role` and `journal_lines.account_code` both use) — the two are unrelated code spaces that happen to look similar. Verified via the FK the posting functions actually write.

## Blockers / questions for the Architect
None blocking this sub-plan's completion. Deviation #1 (the cash-session expected-amount bug) is the one item that genuinely needs Architect/Owner attention as a separate, real defect — flagged with full reasoning above and a manual-check item added.

## Pending manual checks
All 7 new items in `WS-I-MANUAL-VERIFICATION.md`'s "After WS-I-2" section (items 9–15, the last one specific to the cash-session bug above) — this sandbox has no WebView2/real-Windows/printer environment. None of these have been run.

## Unrelated problems noticed (not fixed)
- The `sales.submit_cash_session_count` cash-out sign bug described under Deviations #1 — the most significant finding of this sub-plan, deliberately not fixed here.
- `JournalDetailModal` (pre-existing, `src/features/accounting/JournalsScreen.tsx`) logs a React "each child in a list should have a unique key prop" warning when rendered under `tests/reports-finance.workflow.test.tsx`'s "clicking a ledger journal number opens JournalDetailModal" test. Not investigated further — belongs to WS-L, not WS-I.
- Several benign `act(...)` console warnings from components with a debounce/lookup effect that resolves after a test's assertions (`MonthlySummaryReport`, `ReceivablesReport`, `TrialBalanceReport`) — same class as the one noted in the WS-I-1 report, real-timer effects settling after the test body returns. Does not affect pass/fail.

---

**Commit hash:** not yet committed.
**Pushed:** no.

Per AGENTS.md workflow, this report is submitted for review before any commit. On approval, the plan (`git diff` shown above) will be committed to `task/ws-i-2-finance-reports` and — separately, only after an explicit "yes" — pushed.
