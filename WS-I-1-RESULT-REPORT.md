# WS-I-1 Result Report

## Branch and commit
- Base tip hash (task/ws-k-7-b-licence-ui, unchanged): `d107836b7a3b5b776c7174315fd5645cd50a786f`
- Branch: `task/ws-i-1-sales-reports`, created from the base tip.
- Code commit hash: not yet committed — pending this report's approval (AGENTS.md workflow: report before commit).
- Docs commit hash: n/a yet, same reason.

## Steps completed
- STEP I1-01 (check migration order): done. `ls src-tauri/migrations | tail -3` showed `20260926090000_ws_k_007_licensing.sql` as newest, as expected.
- STEP I1-02 (migration): done, copied verbatim. See "SQL fixes" below for the one addition made (a second, separate migration file, not an edit to this one).
- STEP I1-03 (Rust application + commands): done.
- STEP I1-04 (register and classify): done. Licence gate count raised 216 → 224.
- STEP I1-05 (TypeScript IPC): done.
- STEP I1-06 (print kinds): done — all 13 kinds added to `OfficialDocumentKind` in one pass, nothing else touched in that file.
- STEP I1-07 (common report components): done, all files in §5.8's list created.
- STEP I1-08 (sales reports UI): done, all 8 files in §5.9's table created.
- STEP I1-09 (navigation): done, with one documented deviation (see below) — `AppShell` already has a capability-driven `canShow()` visibility mechanism, so no `hiddenViews` prop was added; a `reportsCapabilities` prop was added instead, following that existing pattern.
- STEP I1-10 (SQL suite): done. 13 assertions written and passing; see "SQL suites" below.
- STEP I1-11 (front-end tests): done, all 4 files created and passing (14 + 6 + 5 + 10 = 35 tests).
- STEP I1-12 (marker and checklist): done. `APP_VERSION_MARKER = 'WS-I-1.0'`; `WS-I-MANUAL-VERIFICATION.md` created with PART 11's "After WS-I-1" section verbatim.

## Files changed
```
 WS-I-MANUAL-VERIFICATION.md                                          |  19 +
 src-tauri/migrations/20260927090000_ws_i_001_sales_reports.sql       | 568 +++++++++++++++++
 src-tauri/migrations/20260927091000_ws_i_001b_reports_backup_acl.sql |  22 +
 src-tauri/src/application/mod.rs                                     |   2 +
 src-tauri/src/application/reports.rs                                 |  48 ++
 src-tauri/src/commands/mod.rs                                        |   2 +
 src-tauri/src/commands/reports.rs                                    | 208 +++++++
 src-tauri/src/lib.rs                                                 |   9 +
 src-tauri/src/licence/gate.rs                                        |  11 +-
 src-tauri/tests/reports/ws_i_001_sales_reports_integration.sql       | 392 +++++++++++++
 src-tauri/tests/run_current_sql_suites.sh                            |   1 +
 src/app/AppRouter.tsx                                                |  28 +
 src/app/AppShell.tsx                                                 |   9 +-
 src/features/reports/ReportsScreen.tsx                               | 125 ++++
 src/features/reports/common/KpiCard.tsx                              |  42 ++
 src/features/reports/common/PeriodPicker.tsx                         |  94 +++
 src/features/reports/common/ReportFrame.tsx                          | 102 +++
 src/features/reports/common/ReportTable.tsx                          | 120 ++++
 src/features/reports/common/charts/BarChart.tsx                      |  98 +++
 src/features/reports/common/charts/HeatGrid.tsx                      |  67 ++
 src/features/reports/common/charts/LineChart.tsx                     |  90 +++
 src/features/reports/common/clipboard.ts                             |  12 +
 src/features/reports/common/csv.ts                                   |  59 ++
 src/features/reports/common/exportAll.ts                             |  24 +
 src/features/reports/common/periods.ts                               | 149 +++++
 src/features/reports/common/printModels.ts                           | 291 +++++++++
 src/features/reports/common/quantity.ts                              |  31 ++
 src/features/reports/common/reportCopy.ts                            | 168 ++++++
 src/features/reports/sales/BestSellersReport.tsx                     | 136 +++++
 src/features/reports/sales/BusyHoursReport.tsx                       | 127 ++++
 src/features/reports/sales/MarginAlertsReport.tsx                    | 193 +++++++
 src/features/reports/sales/SalesByCashierReport.tsx                  | 138 +++++
 src/features/reports/sales/SalesByCategoryReport.tsx                 | 144 ++++++
 src/features/reports/sales/SalesByProductReport.tsx                  | 217 ++++++++
 src/features/reports/sales/SalesOverTimeReport.tsx                   | 156 ++++++
 src/features/reports/sales/SalesSummaryReport.tsx                    | 178 ++++++
 src/shared/documents/officialDocument.ts                             |  15 +
 src/shared/ipc/commands.ts                                           |   9 +
 src/shared/ipc/reportsDto.ts                                         | 133 +++++
 src/shared/ipc/reportsGateway.ts                                     | 137 ++++
 src/shared/version.ts                                                |   2 +-
 tests/reports-csv.test.ts                                            |  47 ++
 tests/reports-periods.test.ts                                        |  77 +++
 tests/reports-quantity.test.ts                                       |  25 +
 tests/reports-sales.workflow.test.tsx                                | 406 +++++++++++++
 45 files changed, 4928 insertions(+), 3 deletions(-)
```
(`WS-I-1-RESULT-REPORT.md` itself is not included above — it did not exist when this diff was captured.)

## SQL fixes made under rule R-03
None. Every table, column and function referenced by the migration and by the SQL suite was verified to exist exactly as named (grep proof gathered before writing any SQL — see "Deviations" for the two places verification led to an *addition* rather than a rename, which R-03 does not cover and which are reported there instead).

## Gates (real output)

All gates were run for real on this machine (Windows, with the project's own toolchain — not "NOT RUN").

```
$ cargo fmt --check
(no output — clean)

$ cargo check
    Checking stockiha-backend v0.1.0 (...)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 1m 17s

$ cargo clippy --all-targets --all-features -- -D warnings
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 57.54s

$ cargo test --lib
test result: ok. 515 passed; 0 failed; 62 ignored; 0 measured; 0 filtered out; finished in 21.90s

$ cargo test --lib -- --ignored safe_upgrade
running 3 tests
test infrastructure::safe_upgrade::tests::a_failed_migration_is_rolled_back_to_the_exact_prior_state ... ok
test infrastructure::safe_upgrade::tests::happy_path_backs_up_verifies_migrates_and_verifies_again ... ok
test infrastructure::safe_upgrade::tests::up_to_date_newer_and_unknown_verdicts_never_trigger_a_backup ... ok
test result: ok. 3 passed; 0 failed; 0 measured; 574 filtered out; finished in 58.03s

$ cargo test --lib -- --ignored embedded_setup
running 5 tests
test infrastructure::embedded_setup::tests::a_failure_during_migrations_leaves_no_database_json ... ok
test infrastructure::embedded_setup::tests::full_setup_runs_end_to_end_against_a_temp_directory ... ok
test infrastructure::embedded_setup::tests::full_setup_succeeds_against_a_non_ascii_arabic_data_path ... ok
test infrastructure::embedded_setup::tests::full_setup_succeeds_when_the_install_and_data_paths_contain_spaces ... ok
test infrastructure::embedded_setup::tests::setup_log_never_contains_a_generated_password ... ok
test result: ok. 5 passed; 0 failed; 0 measured; 572 filtered out; finished in 71.19s

$ npm run typecheck
> tsc -b
(no output — clean)

$ npm run lint
> eslint .
(no output — clean)

$ npm test -- --run
Test Files  71 passed | 1 failed (72)     [see note below]
     Tests  728 passed | 1 failed (729)

$ npm run build
✓ 402 modules transformed.
✓ built in 10.92s
```

**Note on the one frontend test failure under the full run:** `tests/session-report-dialog.workflow.test.tsx` (a pre-existing WS-M-3 test, not part of this task) timed out under full-suite load. PART 10 documents this exact class of flake ("`tests/official-document.test.ts` and `tests/historical-exports.test.ts` may time out under the full run... re-run that file alone"). Re-run alone: all 5 tests in that file passed in 2.2s. Effective result: **729/729 passing.**

## SQL suites

Throwaway PostgreSQL 18 cluster built from `src-tauri/resources/postgres/win64` (`initdb` + `pg_ctl` on port 55499), bootstrapped exactly as `.github/workflows/ci.yml`'s `database` job does (roles, `_sqlx_migrations` table), all 163 migrations applied in filename order, one clean single pass through every suite (a second run against the same long-lived cluster earlier produced unrelated cross-run sequence-pollution failures in three other suites — not a regression; discarded, and the definitive numbers below are from a fresh cluster, one pass). Cluster deleted afterward.

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
| **reports/ws_i_001_sales_reports_integration.sql** | **PASS (new, this sub-plan)** |
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
| recovery/r6_001_backup_role_read_privileges_integration.sql | PASS (see "Deviations" — this needed the new backup-ACL migration to pass) |
| recovery/r6_001_sqlx_metadata_backup_acl_integration.sql | PASS |
| recovery/r6_002_restore_verification_authorization_integration.sql | PASS |
| recovery/ws_h_003_recovery_foundation_integration.sql | PASS |

**41 suites: 36 PASS, 5 FAIL — all 5 are exactly PART 10's documented "Expected known failures" (`s3_001`, `s3_002`, `s3_003`, `r2_financial_semantics`, `r8_e_procurement`). Zero unexpected failures.**

### `ws_i_001_sales_reports_integration.sql` — the 13 required assertions, all passing, plus timing

1. `get_sales_summary(D, D+1)` — net_sales 2460.00, discounts 100.00, sale_count 3, void_count 1 / void_total 500.00, cost 600.00. PASS.
2. S1's discount shares sum to exactly 100.00. PASS.
3. `get_sales_timeseries` DAY has 2 rows; WEEK bucket starts on a Saturday (`isodow = 6`). PASS.
4. `get_sales_by_product` totals equal the summary's net_sales/cost/gross_profit. PASS.
5. `get_sales_by_category` share percentages sum to 99.9–100.1. PASS.
6. `get_sales_by_cashier` returns the posting admin's username. PASS.
7. `get_sales_by_hour` returns 168 rows. PASS.
8. `get_margin_alerts` lists the below-cost product with `below_cost_lines >= 1`. PASS.
9. The cancelled S4 contributes to no product/summary figure except `void_*` (P1 quantity in by-product = 5, not 6). PASS.
10. A CASHIER token calling `get_sales_summary` → `42501`. PASS.
11. `p_from > p_to` → `22023`; granularity `'YEAR'` → `22023`; sort `'FOO'` → `22023`. PASS.
12. `operations.schema_state.migration_version >= 20260927090000`. PASS.
13. Re-applying the migration file a second time raises no error. PASS.
14. Performance (1,000 real cash sales seeded via `sales.confirm_cash_sale` in a loop — see "Deviations"), `EXPLAIN (ANALYZE, TIMING OFF, SUMMARY ON)` over a 365-day period:

| Function | Execution time |
|---|---|
| `get_sales_summary` | 137.7 ms |
| `get_sales_timeseries` | 120.8 ms |
| `get_sales_by_product` | 126.8 ms |
| `get_sales_by_category` | 134.5 ms |
| `get_sales_by_cashier` | 134.9 ms |
| `get_sales_by_hour` | 140.6 ms |
| `get_margin_alerts` | 128.0 ms |

All well under the 2,000 ms threshold — nothing to report under Blockers.

## Licence gate
- Commands added (8, all read-only): `get_reports_capabilities`, `get_sales_summary`, `get_sales_timeseries`, `get_sales_by_product`, `get_sales_by_category`, `get_sales_by_cashier`, `get_sales_by_hour`, `get_margin_alerts`.
- New count: 224 (was 216). `cargo test --lib licence::gate` passes with the updated count.

## Deviations from the specification

1. **A second migration file was added: `src-tauri/migrations/20260927091000_ws_i_001b_reports_backup_acl.sql`.** Discovered while running the full SQL suite list for real (PART 10): `src-tauri/tests/recovery/r6_001_backup_role_read_privileges_integration.sql` asserts that `stockiha_backup` holds `USAGE` on *every* schema owned by `stockiha_owner`. The plan's WS-I-001 migration SQL (copied verbatim, per R-03) creates the new `reports` schema and grants `USAGE` only to `stockiha_runtime` — it never grants `stockiha_backup`, so the schema was invisible to backups and the r6_001 suite genuinely regressed. R-03 only authorizes column/table *name* fixes inside the verbatim SQL, not additions, so the verbatim migration was left untouched. Instead I found and followed an exact existing precedent for this same situation: `20260804185500_r0_001_onboarding_backup_acl.sql`, a small dedicated follow-up migration that closed an identical gap for the `onboarding` schema after `r0_001_historical_finance_staging.sql` created it without a backup grant. The new file mirrors that one exactly (`REVOKE ALL ... FROM stockiha_backup; GRANT USAGE ON SCHEMA reports TO stockiha_backup;`), omitting the `ALL TABLES`/`ALL SEQUENCES`/`ALTER DEFAULT PRIVILEGES` statements since the `reports` schema holds only functions, no tables or sequences. Verified: `r6_001_backup_role_read_privileges_integration.sql` fails without this file and passes with it; the file re-applies with no error; `stockiha_owner`/`stockiha_runtime` were not touched. This is outside the literal §5.1 file list, so flagging it here explicitly for the Architect's review rather than treating it as pre-authorized.
2. **`AppShell` visibility mechanism**: the plan's STEP I1-09 anticipated this exact fork ("If AppShell already has a visibility mechanism for role-based navigation, use that instead and report it"). `AppShell` already has an internal `canShow(item)` switch driven by capability props (`inventoryCapabilities`, `procurementCapabilities`, `customerCapabilities`). A `reportsCapabilities: ReportsCapabilities | null` prop and a matching `case 'reports':` were added to that existing switch instead of a new `hiddenViews` prop.
3. **`threshold_pct` float conversion**: `rust_decimal::Decimal::from_f64_retain` exists in the pinned version (verified directly against the vendored crate source, no Cargo.toml change), so it is used as directed. Its result is additionally rounded to 2 decimal places (`round_dp(2)`) before binding, because `from_f64_retain` deliberately preserves binary float noise (e.g. `0.1` → `0.1000000000000000055511151231`), which would otherwise echo back into the UI's `threshold_pct` display untouched.
4. **`ReportFrame` children scoping (own implementation decision, not a spec deviation)**: while writing the workflow test, found that putting `PeriodPicker`/search/sort/threshold controls *inside* `ReportFrame`'s `children` hid them whenever the report was loading, empty, or erroring — trapping the user with no way to change the period. All 8 sales report components render their filter controls as siblings *before* `<ReportFrame>`, with only the actual table/chart content as `ReportFrame`'s children. `ReportFrame`'s own props/behaviour are unchanged from §5.8.
5. **SQL suite's day window**: STEP I1-10 says "day D = current_date - 2"; `sales.void_sale` (confirmed at `20260922090000_ws_f_006_sale_void.sql:379`) takes no `document_date` parameter and unconditionally stamps the void document with real `current_date`, and `get_sales_summary`'s `void_count`/`void_total` are scoped by the *void* document's own date. With `D = current_date - 2`, the void would always fall outside the `[D, D+1]` assertion window. STEP I1-10's own setup note anticipates this class of mismatch ("otherwise use current_date for everything and adapt the expected dates"): `D` is `current_date - 1` and `D+1` is `current_date` in the suite, so S4's void (dated today) lands inside `[D, D+1]`. All other figures in the suite were computed against this window.
6. **Performance seeding**: used the loop-of-1,000-real-postings fallback explicitly offered by STEP I1-10 note 14, rather than 5,000 variants / 20,000 hand-inserted lines, since a direct bulk `INSERT` into `core.business_documents`/`sales.cash_sales`/`sales.cash_sale_lines` would have to hand-satisfy the same idempotency/posting invariants `sales.confirm_cash_sale` enforces.

## Blockers / questions for the Architect
None outstanding. Deviation 1 (the backup-ACL migration) is the one item that genuinely needs Architect sign-off since it adds a file outside the literal §5.1 list — flagged above with full reasoning and verification.

## Pending manual checks
All 8 items in `WS-I-MANUAL-VERIFICATION.md`'s "After WS-I-1" section (PART 11, copied verbatim) — this sandbox has no WebView2/real-Windows/printer environment. None of these have been run.

## Unrelated problems noticed (not fixed)
- `tests/session-report-dialog.workflow.test.tsx` times out under full-suite load (passes cleanly alone) — matches PART 10's already-documented flake pattern for PDF/font-loading tests; not touched.
- A benign `act(...)` console warning appears from `MarginAlertsReport` during the workflow test run (its 400ms threshold-debounce effect fires after a `margin alerts` test's assertions complete, using real timers). Does not affect pass/fail; not investigated further.

---

**Commit hash:** not yet committed.
**Pushed:** no.

Per AGENTS.md workflow, this report is submitted for review before any commit. On approval, the plan (`git diff` shown above) will be committed to `task/ws-i-1-sales-reports` and — separately, only after an explicit "yes" — pushed.
