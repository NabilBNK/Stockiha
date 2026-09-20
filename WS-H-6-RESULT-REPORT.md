# WS-H-6 Result Report — Automatic Backups

## Branch and commit

- Branch: `task/ws-h-6-automatic-backups`
- Branched from `task/ws-h-5-live-restore` at commit `f8e8eab15eba02fb4c865682b4c6f42567073519` (the branch's actual current tip at the time this task started).
- Code commit: `229c6475fd23ce423437052c6a09f13ac67483de`

**Deviation from the brief's stated starting point, flagged up front:** the brief's §3 prose names `85ce300` (code) / `e69abfe` (report) as the commit to branch from. Those are the *original* WS-H-5 commits, three commits behind the branch's actual tip. Between them and `f8e8eab`, three more commits landed on `task/ws-h-5-live-restore`: `979c906` (fix: restore `stockiha_runtime`'s access to `public` schema after a reset — the schema-grant bug that caused the restart loop the Owner saw on the first manual test round), `d4cdfc1` and `2b1cd78` (docs recording that fix and the rebuilt installer). The brief's own git commands (`git checkout task/ws-h-5-live-restore && git pull --ff-only && git checkout -b ...`) resolve to the branch's actual tip regardless of the hashes named in the prose, and the Owner's own message immediately before this brief was "the WS-H-5 manual test pass, the restore is working well" — which was tested against `f8e8eab`, not `85ce300`. Branching from `85ce300` would have silently dropped the schema-grant fix the Owner's own passing test depended on. Branched from `f8e8eab` and proceeded; flagging this rather than silently guessing which the Architect meant.

## Steps completed

All ten steps from the brief, in order:

- **H6-01** — `infrastructure/recovery_engine/retention.rs` (new): `keep_count`, `select_for_deletion`, `apply`, with the 8 unit tests the brief specifies (all non-ignored, pure logic + real filesystem fixtures). Registered in `recovery_engine/mod.rs`.
- **H6-02** — `domain/recovery.rs`: `RunAutomaticBackupRequest` (+ `validate()`) and `AutomaticBackupResponse`, with unit tests for both. `application/recovery_embedded.rs`: `run_automatic_backup(pool, session_token, ctx, request)` implementing the due-check, the collision-retry audit begin, the migrator-connection destination read, bundle creation, completion, and retention — exactly the algorithm in the brief.
- **H6-03** — `restore_flow.rs`'s `RECORD` step: after `discard_previous_assets` and before the step is marked `Done`, for `RestoreKind::Live` only, calls `retention::apply(safety_destination, BackupKind::PreRestore, &safety_bundle_path, app_data_dir)`. No other statement in the function was moved, reordered, or added to the `RestoreStep` enum.
- **H6-04** — `commands/recovery.rs::run_automatic_backup` Tauri command, registered in `lib.rs`. Converted to a plain sync `fn` + `tauri::async_runtime::block_on` after `cargo check` reproduced the same rustc HRTB "Send/Executor is not general enough" limitation WS-H-5 hit, this time on this command itself (see Deviations).
- **H6-05** — `shared/ipc/commands.ts` (`RUN_AUTOMATIC_BACKUP`), `recoveryDto.ts` (`AutomaticBackupReason`, `RunAutomaticBackupRequest`, `AutomaticBackupResponse`), `recoveryGateway.ts` (`runAutomaticBackup`).
- **H6-06** — `useAppUpdate.ts`: `sessionToken` option, `phase`/`errorKind` state, `performUpdate` rewritten to the exact sequence (download → backup → prepare/install, with the login-required guard and the three backup-outcome branches). `UpdateBanner.tsx`: reads `useSession()` for the token, renders by phase and by `errorKind`. Rewrote `tests/update-engine.test.tsx` (mocks `useSession`, wires `RUN_AUTOMATIC_BACKUP`) and added a `WS-H-6 pre-update backup` describe block (5 new tests).
- **H6-07** — `AppRouter.tsx`: module-level `dailyBackupTimer`/`dailyBackupDone`, the 60-second daily-trigger effect, and the overdue-warning state/effect/banner, placed directly under `db-config-permission-warning` inside `AppShell`'s children, before the takeover check (unchanged) and without touching hook order.
- **H6-08** — Translations: `update.downloading`, `update.backingUp`, `update.backupFailed`, `update.loginRequired`, `recovery.overdueWarning`, `recovery.overdueAction` added to `fr`/`ar`/`en`. `recovery.kindDaily` already existed (WS-H-4) — not duplicated. Arabic entries carry the English text with a `// TODO(WS-H-7)` comment, matching the existing convention already used elsewhere in the same file (e.g. `recovery.restoreFromBackupInstead`).
- **H6-09** — Tests: the 8 retention unit tests (H6-01) and 7 domain validation tests (H6-02) are non-ignored and run in `cargo test --lib`. 5 new ignored real-PostgreSQL tests in `application/recovery_embedded.rs`'s test module, reusing `safe_upgrade::test_support` (provisioning) and `application::test_fixtures` (bootstrap/login/create_user) exactly as named in the brief. New Vitest file `tests/automatic-backup-daily-and-overdue.workflow.test.tsx` (7 tests: the daily-trigger timing/remount/unmount behavior and the 5 overdue-banner scenarios).
- **H6-10** — `src/shared/version.ts` → `WS-H-6.0`. `WS-H-MANUAL-VERIFICATION.md` → `§M6` appended verbatim (7 items).

## Files changed

```
 WS-H-MANUAL-VERIFICATION.md                                          |  10 +
 src-tauri/src/application/recovery_creation.rs                       |  20 +-
 src-tauri/src/application/recovery_embedded.rs                       | 570 ++++++++++++++++++++-
 src-tauri/src/commands/recovery.rs                                   |  77 ++-
 src-tauri/src/domain/recovery.rs                                     | 181 +++++++
 src-tauri/src/infrastructure/recovery_engine/catalog.rs               |   1 -
 src-tauri/src/infrastructure/recovery_engine/mod.rs                   |   2 +
 src-tauri/src/infrastructure/recovery_engine/restore_flow.rs          |  28 +
 src-tauri/src/infrastructure/recovery_engine/retention.rs (new)       | (full new file)
 src-tauri/src/lib.rs                                                  |   1 +
 src/app/AppRouter.tsx                                                 |  82 +++
 src/features/update/UpdateBanner.tsx                                  |  38 +-
 src/features/update/useAppUpdate.ts                                   |  73 ++-
 src/shared/i18n/locales.ts                                            |  24 +
 src/shared/ipc/commands.ts                                            |   2 +
 src/shared/ipc/recoveryDto.ts                                         |  18 +
 src/shared/ipc/recoveryGateway.ts                                     |  18 +
 src/shared/version.ts                                                 |   2 +-
 tests/automatic-backup-daily-and-overdue.workflow.test.tsx (new)      | (full new file)
 tests/update-engine.test.tsx                                          | 166 +++++-

20 files changed, 2006 insertions(+), 41 deletions(-)
```

`src-tauri/Cargo.toml` shows as modified in `git status` but has an empty `git diff` — pre-existing CRLF/LF line-ending metadata noise from `core.autocrlf`, not a real content change, and not staged in this commit.

Not in this diff, correctly: `infrastructure/embedded_setup.rs`, `infrastructure/safe_upgrade.rs` production bodies, `commands/update_shutdown.rs`, the plan file, `scripts/recovery/stockiha_bootstrap_roles_and_grants.sql`, any migration file, and the EXTERNAL-mode bodies in `application/recovery.rs`/`application/recovery_creation.rs` (only `CreationAttemptEnvelope`'s visibility was widened, its body unchanged — see Deviations).

## Gates

All run on this machine (Windows), real output below.

### `cargo fmt --check`
```
Finished `dev` profile [unoptimized + debuginfo] target(s) in 1.78s
```
Clean (after running `cargo fmt` once to apply formatting to new code — final `--check` is silent/clean).

### `cargo check`
```
Finished `dev` profile [unoptimized + debuginfo] target(s) in 51.96s
```
Clean.

### `cargo clippy --all-targets --all-features -- -D warnings`
```
Finished `dev` profile [unoptimized + debuginfo] target(s) in 15.07s
```
Clean, zero warnings.

### `cargo test --lib` (non-ignored)
```
test result: ok. 447 passed; 0 failed; 61 ignored; 0 measured; 0 filtered out; finished in 22.07s
```

### `cargo test --lib -- --ignored recovery_engine` (Windows-only, real PostgreSQL)
```
running 16 tests
test infrastructure::recovery_engine::backup::tests::creates_format_2_bundle_with_privileges ... ok
test infrastructure::recovery_engine::drill::tests::newer_bundle_is_refused_before_any_server_starts ... ok
test infrastructure::recovery_engine::drill::tests::older_bundle_migrates_forward ... ok
test infrastructure::recovery_engine::drill::tests::same_schema_bundle_drills_without_migrating ... ok
test infrastructure::recovery_engine::drill::tests::tampered_migration_history_is_rejected ... ok
test infrastructure::recovery_engine::drill_cluster::tests::drill_cluster_starts_and_cleans_up_without_touching_the_live_server ... ok
test infrastructure::recovery_engine::restore_flow::tests::busy_database_aborts_before_change ... ok
test infrastructure::recovery_engine::restore_flow::tests::failed_rollback_keeps_safety_bundle_in_place ... ok
test infrastructure::recovery_engine::restore_flow::tests::failure_after_replace_rolls_back_exactly ... ok
test infrastructure::recovery_engine::restore_flow::tests::fresh_install_refused_when_users_exist ... ok
test infrastructure::recovery_engine::restore_flow::tests::fresh_install_restore_brings_users ... ok
test infrastructure::recovery_engine::restore_flow::tests::live_restore_of_older_backup_migrates_forward ... ok
test infrastructure::recovery_engine::restore_flow::tests::live_restore_replaces_data_and_keeps_a_safety_copy ... ok
test infrastructure::recovery_engine::restore_flow::tests::newer_backup_is_refused_before_any_change ... ok
test infrastructure::recovery_engine::restore_flow::tests::runtime_role_can_read_schema_state_after_live_restore ... ok
test infrastructure::recovery_engine::restore_flow::tests::verify_mismatch_rolls_back ... ok

test result: ok. 16 passed; 0 failed; 0 ignored; 0 measured; 492 filtered out; finished in 641.46s
```

### `cargo test --lib -- --ignored safe_upgrade` (Windows-only, real PostgreSQL — proves hazard H1 fixed)
```
running 3 tests
test infrastructure::safe_upgrade::tests::a_failed_migration_is_rolled_back_to_the_exact_prior_state ... ok
test infrastructure::safe_upgrade::tests::happy_path_backs_up_verifies_migrates_and_verifies_again ... ok
test infrastructure::safe_upgrade::tests::up_to_date_newer_and_unknown_verdicts_never_trigger_a_backup ... ok

test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 505 filtered out; finished in 64.63s
```

### `cargo test --lib -- --ignored embedded_setup` (Windows-only, real PostgreSQL)
```
running 5 tests
test infrastructure::embedded_setup::tests::a_failure_during_migrations_leaves_no_database_json ... ok
test infrastructure::embedded_setup::tests::full_setup_runs_end_to_end_against_a_temp_directory ... ok
test infrastructure::embedded_setup::tests::full_setup_succeeds_against_a_non_ascii_arabic_data_path ... ok
test infrastructure::embedded_setup::tests::full_setup_succeeds_when_the_install_and_data_paths_contain_spaces ... ok
test infrastructure::embedded_setup::tests::setup_log_never_contains_a_generated_password ... ok

test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 503 filtered out; finished in 87.65s
```

### `cargo test --lib -- --ignored pg_process` (Windows-only, real PostgreSQL)
```
running 4 tests
test infrastructure::pg_process::tests::a_server_left_behind_by_a_previous_process_is_still_stopped_on_exit ... ok
test infrastructure::pg_process::tests::postgres_process_is_gone_after_stop_postgres ... ok
test infrastructure::pg_process::tests::stale_pid_file_with_a_dead_process_is_cleaned_up_and_a_fresh_server_starts ... ok
test infrastructure::pg_process::tests::stale_pid_file_with_a_live_process_refuses_a_second_server_and_keeps_the_file ... ok

test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 504 filtered out; finished in 50.67s
```

### WS-H-6's own new ignored tests (`application::recovery_embedded`, real PostgreSQL) — H6-09
```
running 5 tests
test application::recovery_embedded::tests::automatic_backup_falls_back_when_the_destination_is_missing ... ok
test application::recovery_embedded::tests::automatic_backup_works_for_a_cashier_session ... ok
test application::recovery_embedded::tests::automatic_daily_backup_runs_when_due ... ok
test application::recovery_embedded::tests::automatic_daily_backup_skips_when_recent ... ok
test application::recovery_embedded::tests::retention_keeps_fourteen_daily_backups ... ok

test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 503 filtered out; finished in 142.83s
```
This group is not one of the plan's four named ignore-filters (`recovery_engine`/`safe_upgrade`/`embedded_setup`/`pg_process`) since these tests live under `application::recovery_embedded`, not `infrastructure::recovery_engine`; run explicitly with `-- --ignored recovery_embedded` in addition to the four canonical gates.

**Post-run verification (all four canonical gates + the new group):**
- No stray `postgres.exe` survives: confirmed via `Get-CimInstance Win32_Process -Filter "Name='postgres.exe'"` immediately after each group — only the one long-lived `stockiha_acceptance` instance (port 5433, the Owner's real data, untouched) remained each time.
- No `restore-drill-*` folder remains: confirmed via a directory listing of `%TEMP%` after the full run.
- One real orphan *was* hit mid-session (see Deviations) from a genuine test failure (the `BackupStatusRow` bug, below) — the crashed test's temp folder and postgres process were found via process inspection, stopped with `pg_ctl stop -m fast`, and removed by hand before re-running; the final, passing run of that test left nothing behind.

**Wall-clock duration of one automatic backup:** the `automatic_daily_backup_runs_when_due` test alone takes 25.03s end-to-end, but that figure is dominated by one-time fixture provisioning (`initdb` + role creation + all 155 migrations applied fresh) — the same fixture cost every WS-H-3..5 ignored test pays. I did not have a realistically large (multi-GB) seeded database available in scope to time the backup step in isolation against one; the `BACKUP DUMP` step itself, against this fixture's near-empty freshly-migrated schema, completes in well under two seconds by inspection of `recovery.log` timestamps in the same family of tests (`BACKUP PREFLIGHT: DONE` to `BACKUP SUCCEEDED` was under 1 second in the WS-H-3/H4 bundle-creation test's own logged evidence). Reporting this honestly rather than presenting the fixture-dominated total as if it were the backup's own cost.

### Frontend gates
```
npm run typecheck   → tsc -b, no output, exit 0
npm run lint        → eslint ., no output, exit 0
npm test -- --run   → Test Files 56 passed (56); Tests 562 passed (562)
npm run build       → tsc -b && vite build; ✓ built in 7.30s
```
Ran the full Vitest suite twice in a row (and the new daily-trigger/overdue-warning file three times in isolation) specifically to rule out fake-timer flakiness before trusting it — stable every time.

### SQL suites (ruling 1: clean throwaway PostgreSQL 18 cluster, not `stockiha_acceptance`)

`initdb` into `%TEMP%\ws_h6_sql_cluster` using the bundled `initdb.exe`/`postgres.exe` (`src-tauri/resources/postgres/win64/bin`), port 55499; bootstrapped exactly as `.github/workflows/ci.yml` does (`stockiha_owner`/`migrator`/`admin`/`runtime`/`backup` roles, a representative `_sqlx_migrations` row); all **155 migrations** applied by `psql -f` in filename order (zero failures — confirms WS-H-6 needed no migration, as ruled); CI fiscal period seeded. `run_current_sql_suites.sh` stops at its first failure, so every suite ran individually with the same `BEGIN; \i; SET CONSTRAINTS ALL IMMEDIATE; ROLLBACK;` wrapper as WS-H-3/4/5, plus `s2_002` on its own (it owns its transaction):

| Suite | Result |
|---|---|
| s2_001_catalog_integration | PASS |
| ws_d_001_catalogue_foundation_integration | PASS |
| ws_d_003_active_attribute_filtering_integration | PASS |
| r8_d_catalog_inventory_integration | PASS |
| s2_003_zero_quantity_safeguards_integration | PASS |
| s3_001_procurement_integration | **FAIL (known, out of scope)** |
| s3_002_landed_cost_and_invoices_integration | **FAIL (known, out of scope)** |
| s3_003_supplier_returns_and_payments_integration | **FAIL (known, out of scope)** |
| r2_financial_semantics_integration | **FAIL (known, out of scope)** |
| r8_e_procurement_integration | **FAIL (known, out of scope)** |
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
| r0_002_historical_trade_staging_integration | PASS |
| r0_003_historical_expenses_benefit_integration | PASS |
| r0_004_historical_line_party_benefit_integration | PASS |
| r0_005_historical_product_alias_integration | PASS |
| r5_002_opening_state_reconciliation_integration | PASS |
| r5_003_opening_state_setup_lifecycle_integration | PASS |
| r5_003_opening_state_application_integration | PASS |
| r6_001_recovery_authorization_audit_integration | PASS |
| r6_001_backup_role_read_privileges_integration | PASS |
| r6_001_sqlx_metadata_backup_acl_integration | PASS |
| r6_002_restore_verification_authorization_integration | PASS |
| ws_h_003_recovery_foundation_integration | PASS |
| s2_002_stock_adjustment_integration (own transaction) | PASS |

**Result: 31/36 pass; exactly the 5 named-in-advance failures fail, all with the identical pre-existing root cause** (`purchase_receipts` check constraint `pr_origin_po_invariant` rejects a direct-purchase-origin receipt row when `confirm_purchase_receipt` is used — a procurement-suite defect unrelated to WS-H-6, confirmed byte-identical to the WS-H-4/H5 reports' own description of this same failure). Cluster torn down (`pg_ctl stop -m fast` + directory removed) after the run.

## Deviations from the plan

1. **Branched from `f8e8eab`, not `85ce300`/`e69abfe`** — see Branch and commit above. The repository (the branch's actual state) contradicted the brief's stated starting commit; followed the brief's own git commands and the Owner's most recent message rather than the stale hash, and am flagging it here rather than silently picking one.
2. **`run_automatic_backup`'s Tauri command required the HRTB workaround (ruling 5a), as anticipated.** `cargo check` reproduced the exact same rustc "implementation of `std::marker::Send`/`Executor` is not general enough" error the plan warned about, this time on the command itself (an `async fn` reaching `recovery_embedded::run_automatic_backup`'s migrator connection). Converted the command to a plain `fn` driving the call via `tauri::async_runtime::block_on`, mirroring `commands/safe_upgrade.rs::run_safe_database_upgrade`'s shape exactly — no background thread needed (unlike the WS-H-5 restore commands), since this call finishes well within a normal request and the caller needs the real `AutomaticBackupResponse`, not a fire-and-forget acknowledgement.
3. **Found and fixed a real, pre-existing WS-H-3 bug: `operations.get_backup_status`'s snake_case JSON vs. `BackupStatus`'s camelCase-only deserialization.** `BackupStatus` carries `#[serde(rename_all = "camelCase")]` (correct for its role as the *outgoing* IPC shape) but was also being used to deserialize the SQL function's raw result directly — and that SQL emits snake_case keys (`last_success_at`, not `lastSuccessAt`). Because every field has `#[serde(default)]`, this never raised a deserialize error; it silently produced `None` for every field, every time, for every caller of `get_backup_status` since WS-H-3. This means the Settings screen's "Last successful backup" line has likely always read "never," even right after a real backup, since WS-H-3/H4 shipped.
   - **Empirically reproduced**, not guessed: WS-H-6's own `automatic_daily_backup_skips_when_recent` test created a manual backup, then ran the `DAILY` path expecting `SKIPPED/NOT_DUE` — and got `CREATED` instead, every time, because the due-check's `if let Some(last_success_at) = ...` guard was never entering the `Some` branch.
   - **Fixed in Rust only**, exactly mirroring the already-correct `RecoveryCapabilitiesRow` pattern in the same file: added `BackupStatusRow` (no `rename_all`, so its fields match the SQL's real snake_case keys byte-for-byte) and a `From<BackupStatusRow> for BackupStatus` conversion; `fetch_backup_status` now deserializes into the row type first. The migration itself was **not** touched (editing an applied migration's SQL would change its checksum and break every already-migrated install's next `sqlx` checksum check — this is a client-side deserialization bug, not a schema bug).
   - Added `backup_status_row_parses_the_sql_functions_real_snake_case_keys` (a real non-null round-trip, unlike the pre-existing `backup_status_tolerates_nulls_and_missing_fields` test, which only ever exercised `null` values and could never have caught this).
   - This was necessary to fix, not merely reportable-and-skippable: WS-H-6's own DAILY due-check (acceptance criterion 5 — "logging in again the same day does not create another daily backup") cannot function at all without it.
4. **`ctx` (`EmbeddedRecoveryContext`) parameter names in the new test helpers** (`runtime_pool_for_tests`, `ctx_for_tests`) are new, test-only additions inside `#[cfg(test)] mod tests` — not exported, not part of the production surface.

## Blockers / questions for the Architect

None outstanding. The one repository/brief contradiction (deviation 1) and the one real defect found (deviation 3) are both documented above with the reasoning for resolving them rather than stopping.

## Pending manual checks (PART 14 §M6)

Appended verbatim to `WS-H-MANUAL-VERIFICATION.md`. All seven require the installed Windows build and cannot be verified from this environment:

1. Installing an update from the banner shows "Saving a safety backup before updating…" before it installs, and after the restart a "Before update" backup is in the list.
2. With the backup folder set to an unplugged USB drive, an update still installs and the new "Before update" backup is in the default folder.
3. If the backup cannot be made at all, the update is NOT installed and the banner explains why; the app keeps working.
4. About a minute after the first login of the day, a "Daily automatic" backup appears in the list.
5. Logging out and in again the same day does not create a second daily backup.
6. After more than 14 daily backups exist, only the newest 14 remain; manual backups are never removed.
7. An admin with no backup for 7 days sees the warning banner with a working button to the backup settings.

Also pending, inherited from WS-H-5 and unrelated to WS-H-6's own scope: nothing new — WS-H-5's §M5 checks were reported by the Owner as passing before this brief was issued.

## Unrelated problems noticed (not fixed)

- **`tests/nav-role-based-access.workflow.test.tsx`'s "WS-J-1 — theme toggle persists across a full remount" test is flaky under the full suite** (fails intermittently with `expected undefined to be 'dark'` when run alongside every other test file, passes reliably every time in isolation). Confirmed this is not caused by any WS-H-6 change: `git diff --stat` shows nothing touched in that test file or anything theme-related, and the failure reproduces on a clean run of the full suite even without my changes applied to that area. Likely a test-isolation issue (probably `localStorage`/`document.documentElement.dataset` bleeding between test files sharing a worker), pre-existing and out of scope for this task.
- **The `BackupStatus`/`BackupStatusRow` mismatch (deviation 3) likely affected the Settings screen's status line since WS-H-3.** Fixed here because WS-H-6 needed it to work; worth a note to the Owner that "Last successful backup" on the Settings page may have been silently showing "never" on real installs since WS-H-3/H4 shipped, independent of anything WS-H-6 changed.

---

**Commit:** `229c6475fd23ce423437052c6a09f13ac67483de`
**Pushed:** yes — confirmed via `git ls-remote origin task/ws-h-6-automatic-backups`:
```
229c6475fd23ce423437052c6a09f13ac67483de	refs/heads/task/ws-h-6-automatic-backups
```
