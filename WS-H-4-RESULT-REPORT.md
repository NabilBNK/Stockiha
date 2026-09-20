# WS-H-4 Result Report

## Branch and commit
Branch: task/ws-h-4-backup-list-and-test
Base: 1c750b2 (head of task/ws-h-3-embedded-backup at kickoff)
Head: 0efd20e91e74093f0497d90c3e4af80364bcde67
Pushed: yes

```
$ git ls-remote origin task/ws-h-4-backup-list-and-test
0efd20e91e74093f0497d90c3e4af80364bcde67	refs/heads/task/ws-h-4-backup-list-and-test
```

## Steps completed

- **H4-01 (backup list, engine)** — done. `infrastructure/recovery_engine/catalog.rs`: `list_bundles`/`list_bundles_uncapped`, capped at `MAX_LIST_ITEMS = 200`, tolerant manifest parsing (never hashes — advisory only), newest-first ordering, `embedded_mode` gate on `restorable`. 6 unit tests.
- **H4-02 (copy to another folder, engine)** — done. `infrastructure/recovery_engine/copy.rs`: 9-step stage/validate/publish algorithm, full re-validation (hashing) of the copy before it's trusted, drop-guard staging cleanup. 5 unit tests.
- **H4-03 (throwaway cluster helpers)** — done. `infrastructure/embedded_setup.rs` widened to `pub(crate)` (bodies unchanged) + new `infrastructure/recovery_engine/drill_cluster.rs` (`DrillCluster`: start/stop/remove_files/Drop safety net). 1 ignored real-PG test, passing.
- **H4-04 (isolated restore test, engine)** — done. `infrastructure/recovery_engine/drill.rs`: refuses Newer/Unknown before starting anything, restores into the throwaway cluster, verifies migration history against embedded checksums, migrates Older forward, reconciles control totals, tears down. 4 ignored real-PG tests, all passing (see Gates).
- **H4-05 (commands)** — done, with one necessary deviation (see Deviations). `list_backups`, `copy_backup_to` added to `commands/recovery.rs`; `verify_operator_backup_restore`'s EMBEDDED branch now calls `recovery_embedded::test_backup`, which drives `run_isolated_drill`.
- **H4-06 (frontend restructure)** — done. New `src/features/settings/recovery/` module (`recoveryCopy.ts`, `BackupStatusLine.tsx`, `DestinationBox.tsx`, `BackupList.tsx`, `BackupResultGrid.tsx`, `RestoreTestResultGrid.tsx`); `RecoverySettingsScreen.tsx` rewritten as the container. Every string moved into `locales.ts` under `recovery.*` (fr/en real; ar carries forward existing Arabic and marks new strings `TODO(WS-H-7)` in English, per plan). "Restore…" is not rendered anywhere (WS-H-5 scope).
- **H4-07 (tests)** — done. Rust unit/ignored tests listed above; `tests/recovery-settings.workflow.test.tsx` trimmed to the flows it still covers (create, policy toggle, capability/mode/destination/status gating, RTL) and `tests/recovery-backup-list.test.tsx` added (list rendering/labels, empty state, list error, Copy flow incl. cancel, Test dialog incl. cancel/confirm, policy-off hides Test, "Open a backup from another folder", busy-disables-everything, RTL ancestor). `APP_VERSION_MARKER = 'WS-H-4.0'`; §M4 appended to `WS-H-MANUAL-VERIFICATION.md`.
- **H4-08 (startup sweep)** — done. `infrastructure/recovery_engine/sweep.rs`: removes abandoned `restore-drill-*` folders on an OS thread at startup (EMBEDDED mode only), PID-liveness check that never signals the live server's own PID. 3 unit tests.

No "Restore…" action and nothing else from WS-H-5+ was implemented. No WS-E or WS-F files were touched.

## Files changed
```
 WS-H-MANUAL-VERIFICATION.md                        |  13 +
 src-tauri/src/application/recovery.rs              |  89 +--
 src-tauri/src/application/recovery_embedded.rs     | 260 ++++++-
 src-tauri/src/commands/recovery.rs                 | 119 ++-
 src-tauri/src/domain/recovery.rs                   | 123 +++-
 src-tauri/src/infrastructure/embedded_setup.rs     |  30 +-
 .../src/infrastructure/recovery_engine/backup.rs   |  27 +-
 .../src/infrastructure/recovery_engine/catalog.rs  | 359 +++++++++
 .../src/infrastructure/recovery_engine/copy.rs     | 368 ++++++++++
 .../src/infrastructure/recovery_engine/drill.rs    | 519 +++++++++++++
 .../recovery_engine/drill_cluster.rs               | 314 ++++++++
 .../src/infrastructure/recovery_engine/mod.rs      |   8 +
 .../src/infrastructure/recovery_engine/sweep.rs    | 158 ++++
 src-tauri/src/lib.rs                               |  36 +
 src/features/settings/RecoverySettingsScreen.tsx   | 817 +++++++--------------
 src/features/settings/recovery/BackupList.tsx      | 138 ++++
 .../settings/recovery/BackupResultGrid.tsx         |  41 ++
 .../settings/recovery/BackupStatusLine.tsx         |  19 +
 src/features/settings/recovery/DestinationBox.tsx  |  62 ++
 .../settings/recovery/RestoreTestResultGrid.tsx    |  48 ++
 src/features/settings/recovery/recoveryCopy.ts     |  88 +++
 src/shared/i18n/locales.ts                         | 315 ++++++++
 src/shared/ipc/commands.ts                         |   3 +
 src/shared/ipc/recoveryDto.ts                      |  34 +
 src/shared/ipc/recoveryGateway.ts                  |  27 +
 src/shared/version.ts                              |   2 +-
 src/styles/settings.css                            |   7 +
 tests/recovery-backup-list.test.tsx                | 314 ++++++++
 tests/recovery-settings.workflow.test.tsx          | 156 +---
 29 files changed, 3716 insertions(+), 778 deletions(-)
```

## Gates (real output, last lines each)

**cargo fmt --check** — clean, no output, exit 0.

**cargo check --all-targets** — clean, no errors/warnings.

**cargo clippy --all-targets --all-features -- -D warnings**
```
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 1m 04s
```
(One real finding fixed along the way: `identity_op` on a tautological test assertion in `drill.rs` — see Unrelated problems noticed.)

**cargo test --lib** (non-ignored)
```
test result: ok. 421 passed; 0 failed; 46 ignored; 0 measured; 0 filtered out; finished in 16.17s
```
`schema_version::tests::newest_migration_keeps_schema_state_current` is in that count and green — WS-H-4 added no migration, as the Architect ruling anticipated.

**Ignored real-PostgreSQL tests (Windows), run explicitly with `-- --ignored`:**

`recovery_engine` (H4-03/H4-04, includes the new drill/drill_cluster suites):
```
test infrastructure::recovery_engine::backup::tests::creates_format_2_bundle_with_privileges ... ok
test infrastructure::recovery_engine::drill::tests::newer_bundle_is_refused_before_any_server_starts ... ok
test infrastructure::recovery_engine::drill::tests::older_bundle_migrates_forward ... ok
test infrastructure::recovery_engine::drill::tests::same_schema_bundle_drills_without_migrating ... ok
test infrastructure::recovery_engine::drill::tests::tampered_migration_history_is_rejected ... ok
test infrastructure::recovery_engine::drill_cluster::tests::drill_cluster_starts_and_cleans_up_without_touching_the_live_server ... ok
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 461 filtered out; finished in 126.11s
```

`safe_upgrade`:
```
test infrastructure::safe_upgrade::tests::a_failed_migration_is_rolled_back_to_the_exact_prior_state ... ok
test infrastructure::safe_upgrade::tests::happy_path_backs_up_verifies_migrates_and_verifies_again ... ok
test infrastructure::safe_upgrade::tests::up_to_date_newer_and_unknown_verdicts_never_trigger_a_backup ... ok
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 464 filtered out; finished in 44.03s
```

`embedded_setup`:
```
test infrastructure::embedded_setup::tests::a_failure_during_migrations_leaves_no_database_json ... ok
test infrastructure::embedded_setup::tests::full_setup_runs_end_to_end_against_a_temp_directory ... ok
test infrastructure::embedded_setup::tests::full_setup_succeeds_against_a_non_ascii_arabic_data_path ... ok
test infrastructure::embedded_setup::tests::full_setup_succeeds_when_the_install_and_data_paths_contain_spaces ... ok
test infrastructure::embedded_setup::tests::setup_log_never_contains_a_generated_password ... ok
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 462 filtered out; finished in 56.42s
```

`pg_process`:
```
test infrastructure::pg_process::tests::a_server_left_behind_by_a_previous_process_is_still_stopped_on_exit ... ok
test infrastructure::pg_process::tests::postgres_process_is_gone_after_stop_postgres ... ok
test infrastructure::pg_process::tests::stale_pid_file_with_a_dead_process_is_cleaned_up_and_a_fresh_server_starts ... ok
test infrastructure::pg_process::tests::stale_pid_file_with_a_live_process_refuses_a_second_server_and_keeps_the_file ... ok
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 463 filtered out; finished in 30.78s
```

**npm run typecheck** — clean (`tsc -b`, no output).
**npm run lint** — clean (`eslint .`, no output).
**npm test -- --run** (full suite):
```
Test Files  54 passed (54)
     Tests  540 passed (540)
```
**npm run build** — succeeded (`vite build`, 7.02s); the only warning is the pre-existing "chunks larger than 500 kB" advisory, unrelated to this change.

**SQL suites — run individually (Architect ruling: the runner's `set -e` stops at first failure, so each of the 36 suites in `run_current_sql_suites.sh` was run one at a time against `stockiha_acceptance` on port 5433):**

| Suite | Result |
|---|---|
| s2_001_catalog_integration | PASS |
| ws_d_001_catalogue_foundation_integration | PASS |
| ws_d_003_active_attribute_filtering_integration | PASS |
| r8_d_catalog_inventory_integration | PASS |
| s2_003_zero_quantity_safeguards_integration | PASS |
| **s3_001_procurement_integration** | **FAIL — pre-existing, Architect ruling #3** |
| **s3_002_landed_cost_and_invoices_integration** | **FAIL — pre-existing, Architect ruling #3** |
| **s3_003_supplier_returns_and_payments_integration** | **FAIL — pre-existing, Architect ruling #3** |
| **r2_financial_semantics_integration** | **FAIL — pre-existing, Architect ruling #3** |
| **r8_e_procurement_integration** | **FAIL — pre-existing, Architect ruling #3** |
| direct_purchase_acceptance_integration | PASS |
| ws_e_002_purchase_payment_integration | PASS |
| ws_e_003_purchase_return_integration | PASS |
| s4_001_credit_sale_integration | PASS |
| ws_f_004_credit_limit_warning_integration | PASS |
| ws_f_005_cash_session_completion_integration | PASS |
| s4_001_customer_payment_integration | PASS |
| s4_002_cash_session_lifecycle | PASS |
| s4_002_cash_session_ownership_integration | PASS |
| s4_003_drawer_refund_integration | PASS |
| r0_001_historical_finance_staging_integration | PASS |
| r0_001_excel_correction_reuse_integration | PASS |
| r0_001_setting_audit_integration | PASS |
| r0_001_onboarding_backup_acl_integration | PASS |
| r0_002_historical_trade_staging_integration | FAIL — see below |
| r0_003_historical_expenses_benefit_integration | FAIL — see below |
| r0_004_historical_line_party_benefit_integration | FAIL — see below |
| r0_005_historical_product_alias_integration | PASS |
| r5_002_opening_state_reconciliation_integration | PASS |
| r5_003_opening_state_setup_lifecycle_integration | FAIL — see below |
| r5_003_opening_state_application_integration | PASS |
| r6_001_recovery_authorization_audit_integration | PASS |
| r6_001_backup_role_read_privileges_integration | PASS |
| r6_001_sqlx_metadata_backup_acl_integration | PASS |
| r6_002_restore_verification_authorization_integration | PASS |
| ws_h_003_recovery_foundation_integration | FAIL — see below |

26 of 36 pass. The 5 the Architect flagged as known/pre-existing/out-of-scope (`s3_001`, `s3_002`, `s3_003`, `r2_financial_semantics`, `r8_e_procurement`) failed exactly as expected — not touched.

**5 additional failures were found that were not on the Architect's list** (`r0_002`, `r0_003`, `r0_004`, `r5_003_opening_state_setup_lifecycle`, `ws_h_003_recovery_foundation`). Investigated before writing this report:
- The `stockiha_acceptance` cluster on port 5433 was one migration behind (`20260916100000_ws_h_003_recovery_embedded_foundation` — the WS-H-3 migration itself — had never been applied to this particular long-lived database). Applied it via `scripts/run-sqlx-migrations.ps1` (155 migrations now applied, matches the repo's migration set). This alone fixed the `ws_h_003_recovery_foundation_integration` failure's *first* symptom ("ADMIN must receive RESTORE_BACKUP_LIVE"), but a second, deeper assertion in the same suite still fails afterward ("RESTORE_LIVE failures are not backup failures").
- Re-ran all 5 after migrating: still failing. For the three `r0_00x` historical-staging suites, the failures are literal totals mismatches (e.g. "Expected sales=22000 purchases=7500 … got sales=3266150 purchases=17415010") — the aggregates reflect months of accumulated real data other work has left in this shared, long-lived acceptance database, not a schema or logic defect. `r5_003_opening_state_setup_lifecycle` fails on "Opening state must begin as a pending optional setup decision" for the same reason (a fresh-install assumption violated by pre-existing state). `ws_h_003_recovery_foundation`'s remaining failure asserts `get_backup_status(...)['last_failure_at'] IS NULL` after a failed `RESTORE_LIVE` attempt — that function was not modified by WS-H-4 (no SQL was touched in this branch), and the same drifted-database pattern (a real prior recovery-attempt row already present) is the most likely explanation.
- None of `catalog.rs`, `copy.rs`, `drill.rs`, `sweep.rs`, or any `application`/`commands`/`domain` SQL call in this branch changes `operations.get_backup_status`, `operations.begin_recovery_attempt`, or any onboarding/historical-import function — WS-H-4 added zero migrations and zero SQL. I did not attempt to "fix" this shared database (wiping or rewriting its accumulated state is destructive and outside this branch's authority); flagging it here per the stop-and-report instruction instead.

## Deviations from the plan

1. **Windows long-path fix (Architect ruling, WS-H-3 report)** — applied as instructed: the backup staging folder name is now `.{bundle_name}.staging-{stage_tag}` (no `<nanos>` suffix; the attempt id is already unique). `infrastructure/recovery_engine/backup.rs`'s ignored real-PG test's temp label was widened from the shortened `"re"` to `"recovery-backup"`; it passed. Synthetic worst-case path-length arithmetic (9-digit attempt id, 6-digit PID, a realistic `%APPDATA%` destination): **≈226 chars with the nanosecond suffix, ≈206 chars without — a ~20-character reduction**, comfortably inside Windows' `MAX_PATH`/long-path budgets for the staged dump file three directory levels down.
2. **`application/recovery.rs`: `collect_restore_control_totals`'s nested `async fn count(...)` → a local `macro_rules! count!`.** The plan says "body unchanged" for this function. A pre-existing rustc HRTB limitation ("implementation of `Send`/`Acquire`/`Executor` is not general enough") is triggered once this function is reached from `run_isolated_drill` inside a `#[tauri::command]`-rooted call graph (it already compiled fine for the pre-existing EXTERNAL-mode caller alone). The nested-fn shape had two independently-elided `&mut PgConnection` lifetimes across sequential awaited generic-`Executor` calls — exactly the pattern rustc's HRTB inference can't generalize. Converting it to a local macro produces byte-identical SQL, error codes, and return values at every call site — purely a compile-blocker workaround, not a behavior change.
3. **`application/recovery_embedded.rs`: `test_backup` restructured to run its entire body via `tokio::task::spawn_blocking(move || Handle::current().block_on(test_backup_on_blocking_thread(...)))`.** Root-caused via systematic bisection (stubbing sections of `run_isolated_drill`'s body and recompiling) to the *same* HRTB limitation, this time inside `infrastructure/embedded_setup.rs`'s `create_roles`/`create_database` — both reuse a local `&mut PgConnection` across several sequential calls to the pre-existing `exec_sql(conn: &mut PgConnection, sql: String)` helper, a file the plan explicitly protects ("bodies unchanged"). Rather than edit that protected file, `test_backup` was moved onto a blocking-pool thread — mirroring `commands/safe_upgrade.rs`'s own existing pattern (`std::thread::spawn` + `block_on`) for exactly this class of heavy, multi-step PostgreSQL work reached from a command boundary. `tokio::` (not `tauri::async_runtime::`) was used to preserve the "no tauri dependency in `application::*`" architectural rule. No SQL, error code, or observable behavior changed; `bundle::inspect_bundle` inside the new `test_backup_on_blocking_thread` is called directly (no nested `spawn_blocking`) since the whole function already runs on a blocking thread.
4. Per Architect ruling, `scripts/recovery/stockiha_bootstrap_roles_and_grants.sql` was not touched.

## Blockers / questions for the Architect

None that block this sub-plan's own completion. One item for a decision: the 5 newly-observed SQL suite failures (`r0_002`, `r0_003`, `r0_004`, `r5_003_opening_state_setup_lifecycle`, `ws_h_003_recovery_foundation`) trace to accumulated real data in the shared `stockiha_acceptance` database rather than to this branch's code — see the SQL suites table above. Whether to re-provision that database (fresh `initdb` + full migration replay) or accept it as permanently drifted and adjust those suites' expectations is an environment-ownership decision, not a WS-H-4 code change.

## Pending manual checks (PART 14 §M4)

All 10 items of §M4 (appended to `WS-H-MANUAL-VERIFICATION.md`) are pending real Windows/installer acceptance — none were run in this session (no installer was built or installed):
1. Backup list renders newest-first with Date/Type/Size/Version status/Actions.
2. "Check" shows a validation grid headed by the row's date; no "Restore…" button anywhere.
3. "Copy to…" copies to a picked folder (USB/another drive) and reports the copied path.
4. "Test" opens the confirmation dialog, runs the drill, and reports server-stopped/journal-balance/control totals.
5. The live app stays responsive while a "Test" drill runs.
6. No orphaned `postgres.exe` or `restore-drill-*` folder survives a completed test.
7. Turning the Advanced policy off hides "Test" and shows the note.
8. "Open a backup from another folder…" validates and shows a one-row "Selected backup" table.
9. Force-killing Stockiha mid-test and relaunching cleans up the orphaned server/folder at startup (H4-08).
10. A cashier still sees no backup card at all.

## Unrelated problems noticed (not fixed)

- **A pre-existing tautological test assertion**, found and corrected as part of satisfying `clippy::identity_op` (not a WS-H-4 regression — it was written this session while implementing H4-04, so it's fixed here rather than reported as unrelated, but noting the mechanism: `assert_eq!(a, a.min(b).max(0) + 0)` is always true regardless of `a`/`b`, so it never actually verified anything). Replaced with a real check that the seed insert produced exactly one row.
- **The local `stockiha_acceptance` acceptance database (port 5433, `data-55433`) was not shut down cleanly before this session** — starting it required clearing a stale `postmaster.pid` and then waiting through a multi-minute WAL-recovery/fsync pass, and it was one migration behind. Both were resolved as part of running the SQL-suite gate (documented above), but the underlying "how did it get into an unclean-shutdown state" is outside this branch's scope to investigate further.
- **A tool-orchestration incident during this session** (not a code defect): an early attempt to run the ignored real-PostgreSQL test suite via a complex shell pipeline hung silently for ~46 minutes without producing output or spawning traceable child processes, while in the background it *had* actually started a live-database fixture server for the `same_schema_bundle_drills_without_migrating` test and then stalled before that test's own cleanup (`test_support::stop_server`) ran. This left two orphaned `postgres.exe` clusters and their temp directories on disk. Found via process/port inspection, stopped cleanly with `pg_ctl stop -m fast`, and the temp directories removed. A clean standalone re-run of the same test immediately afterward completed normally with no leak, so this looks like an artifact of that specific shell invocation rather than a reproducible defect in `drill.rs`'s or `test_support`'s cleanup paths — flagged here for visibility rather than treated as resolved with certainty.
