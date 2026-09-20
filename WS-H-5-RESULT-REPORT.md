# WS-H-5 Result Report

## Branch and commit
Branch: task/ws-h-5-live-restore
Base: 7141c62 (head of task/ws-h-4-backup-list-and-test at kickoff)
Head: 85ce300e30c4d80164c6c832628331b023e2d991
Pushed: yes

```
$ git ls-remote origin task/ws-h-5-live-restore
85ce300e30c4d80164c6c832628331b023e2d991	refs/heads/task/ws-h-5-live-restore
```

## Steps completed

- **H5-01 (restore primitives, engine)** — done. `infrastructure/safe_upgrade.rs::reset_all_schemas` widened to `pub(crate)` (body unchanged). New `infrastructure/recovery_engine/live.rs`: `migrator_connection`, `count_users`, `wait_for_no_other_sessions`, `replace_database`, `bring_schema_forward`, `verify_restored`, `swap_in_assets`/`restore_previous_assets`/`discard_previous_assets` (+ `AssetSwap`), `record_restore_event` (+ `RestoreEventRow`).
- **H5-02 (fault injection)** — done. `RestoreFaults { fail_after_replace, fail_verify, fail_rollback }`, `#[derive(Default, Clone, Copy)]`, defaulted in every production caller. `RestoreFaults::default()` is passed by both production commands and 6 of the 9 tests; only 3 test call sites construct a non-default value (`failure_after_replace_rolls_back_exactly`, `verify_mismatch_rolls_back`, `failed_rollback_keeps_safety_bundle_in_place`) — no production code path can ever set one (no IPC field exposes it).
- **H5-03 (restore worker)** — done. New `infrastructure/recovery_engine/restore_flow.rs`: `RestoreStep`, `RestoreStepStatus`, `RestoreProgress`, `RestoreKind`, `RestoreOutcome`, `run_restore` — the 11-step algorithm in the exact mandated order, with automatic rollback (asset restore → live: replace from safety dump + schema check; fresh-install: reset + re-migrate) on any failure from REPLACE_DATA onward, and a rollback-fault short-circuit that leaves the safety bundle provably untouched.
- **H5-04 (commands)** — done, with one necessary deviation (see Deviations). `commands/recovery.rs`: `restore_backup_live`, `inspect_backup_for_fresh_install`, `restore_backup_fresh_install`, `restart_after_recovery`, all registered in `lib.rs`. `application/recovery_embedded.rs`: `begin_live_restore` (audit envelope + actor/workstation lookup + destination resolution, all via a migrator connection) and `complete_live_restore_attempt`. `RecoveryOperationLease` widened to `pub(crate)`.
- **H5-05 (takeover screen)** — done. New `src/features/settings/recovery/{RecoveryTakeoverContext,LiveRestoreScreen,RestoreConfirmDialog}.tsx`; `App.tsx` wraps `AppRouter` in `RecoveryTakeoverProvider`; `AppRouter.tsx` checks `takeover.request` immediately after every hook, before every other route; `BackupList.tsx` gained a "Restore…" action (danger variant) gated on `canRestoreLive && item.restorable`; DTOs/gateway/commands additions per plan (`RESTORE_STEPS`, both event names, all four new IPC functions).
- **H5-06 (new-PC restore)** — done. New `FreshInstallRestoreScreen.tsx`; `SetupScreen.tsx` checks `getRecoveryMode()` on mount and renders "Restore from a backup instead" only in EMBEDDED mode.
- **H5-07 (tests)** — done. All 9 mandated ignored real-PostgreSQL tests written and passing (see Gates). Vitest: `tests/recovery-live-restore.test.tsx` (new) covers confirm-dialog gating (checkbox + exact word, lowercase rejected, cash-session block), the exact `begin()`/IPC payload, listen-before-invoke call order, all four outcome renders, "Copy details", and "Restart Stockiha"; `tests/recovery-settings.workflow.test.tsx` and `tests/recovery-backup-list.test.tsx` updated only to wrap renders in the new `RecoveryTakeoverProvider` ancestor. `APP_VERSION_MARKER = 'WS-H-5.0'`; §M5 appended to `WS-H-MANUAL-VERIFICATION.md`.

No automatic-backup (WS-H-6) or translation/documentation (WS-H-7) work was implemented.

## Files changed
```
 WS-H-MANUAL-VERIFICATION.md                        |   17 +
 src-tauri/src/application/recovery_embedded.rs     |  143 ++
 src-tauri/src/commands/recovery.rs                 |  417 +++++-
 src-tauri/src/domain/recovery.rs                   |  113 ++
 .../src/infrastructure/recovery_engine/live.rs     |  369 +++++
 .../src/infrastructure/recovery_engine/mod.rs      |    4 +
 .../infrastructure/recovery_engine/restore_flow.rs | 1584 ++++++++++++++++++++
 src-tauri/src/infrastructure/safe_upgrade.rs       |    2 +-
 src-tauri/src/lib.rs                               |    4 +
 src/App.tsx                                        |    5 +-
 src/app/AppRouter.tsx                              |   11 +
 src/features/settings/RecoverySettingsScreen.tsx   |   31 +
 src/features/settings/recovery/BackupList.tsx      |   18 +-
 .../recovery/FreshInstallRestoreScreen.tsx         |  125 ++
 .../settings/recovery/LiveRestoreScreen.tsx        |  309 ++++
 .../settings/recovery/RecoveryTakeoverContext.tsx  |   48 +
 .../settings/recovery/RestoreConfirmDialog.tsx     |   92 ++
 src/features/settings/recovery/recoveryCopy.ts     |    4 +-
 src/features/setup/SetupScreen.tsx                 |   29 +-
 src/shared/i18n/locales.ts                         |  144 ++
 src/shared/ipc/commands.ts                         |    5 +
 src/shared/ipc/recoveryDto.ts                      |   77 +
 src/shared/ipc/recoveryGateway.ts                  |   63 +
 src/shared/version.ts                              |    2 +-
 tests/recovery-backup-list.test.tsx                |    5 +-
 tests/recovery-live-restore.test.tsx               |  244 +++
 tests/recovery-settings.workflow.test.tsx          |   13 +-
 27 files changed, 3860 insertions(+), 18 deletions(-)
```

## Gates (real output, last lines each)

**cargo fmt --check** — clean, no output, exit 0.
**cargo check** — clean, no errors/warnings.
**cargo clippy --all-targets --all-features -- -D warnings** — clean:
```
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 36.84s
```
(One real finding fixed along the way — see Deviations/bug fix below.)

**cargo test --lib** (non-ignored):
```
test result: ok. 428 passed; 0 failed; 55 ignored; 0 measured; 0 filtered out; finished in 20.40s
```

**Ignored real-PostgreSQL tests (Windows), run explicitly with `-- --ignored`:**

`recovery_engine` (includes the 9 new H5-07 tests plus WS-H-4's own drill/drill_cluster/backup suites, all in one run):
```
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
test infrastructure::recovery_engine::restore_flow::tests::verify_mismatch_rolls_back ... ok
test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 468 filtered out; finished in 631.15s
```

`safe_upgrade`:
```
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 480 filtered out; finished in 64.49s
```

`embedded_setup`:
```
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 478 filtered out; finished in 80.60s
```

`pg_process`:
```
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 479 filtered out; finished in 42.35s
```

**npm run typecheck** — clean. **npm run lint** — clean. **npm test -- --run**:
```
Test Files  55 passed (55)
     Tests  550 passed (550)
```
**npm run build** — succeeded (`vite build`, 6.24s); only the pre-existing "chunks larger than 500 kB" advisory, unrelated to this change.

**SQL suites — run against a throwaway PostgreSQL 18 cluster built from the bundled binaries (Architect ruling #1), not the drifted `stockiha_acceptance` database:**

`initdb` into a scratch folder (`%TEMP%\ws_h5_sql_cluster`) using the bundled `initdb.exe`/`postgres.exe`, port 55499; bootstrapped exactly as `.github/workflows/ci.yml` does (`stockiha_owner`/`migrator`/`admin`/`runtime`/`backup` roles, a representative `_sqlx_migrations` row); all 155 migrations applied by `psql -f` in filename order (zero failures); CI fiscal period seeded. The runner (`run_current_sql_suites.sh`) stops at its first failure, so every suite was run individually with its own `BEGIN; \i; SET CONSTRAINTS ALL IMMEDIATE; ROLLBACK;` wrapper — the same discipline as WS-H-3/WS-H-4:

| Suite | Result |
|---|---|
| s2_001_catalog_integration | PASS |
| ws_d_001_catalogue_foundation_integration | PASS |
| ws_d_003_active_attribute_filtering_integration | PASS |
| r8_d_catalog_inventory_integration | PASS |
| s2_003_zero_quantity_safeguards_integration | PASS |
| **s3_001_procurement_integration** | **FAIL — known, pre-existing, out of scope (ruling #2)** |
| **s3_002_landed_cost_and_invoices_integration** | **FAIL — known, pre-existing, out of scope (ruling #2)** |
| **s3_003_supplier_returns_and_payments_integration** | **FAIL — known, pre-existing, out of scope (ruling #2)** |
| **r2_financial_semantics_integration** | **FAIL — known, pre-existing, out of scope (ruling #2)** |
| **r8_e_procurement_integration** | **FAIL — known, pre-existing, out of scope (ruling #2)** |
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
| s2_002_stock_adjustment_integration (own transaction) | PASS (`ALL S2-002 DB ASSERTIONS PASSED`) |

36 of 36 suites behave exactly as the ruling predicted: the 5 known procurement failures reproduce (proving the throwaway cluster is a faithful, unmodified schema, not one that happens to dodge them), and **every other suite passes cleanly on a fresh cluster** — including `ws_h_003_recovery_foundation_integration` and the three `r0_00x` historical-staging suites, which had failed against the drifted `stockiha_acceptance` database in the WS-H-4 report purely from accumulated data, exactly as diagnosed there. Cluster stopped and deleted afterward.

## Deviations from the plan

1. **`commands/recovery.rs`'s three new commands (`restore_backup_live`, `inspect_backup_for_fresh_install`, `restore_backup_fresh_install`) are plain `fn`, not `async fn`.** The plan's pseudocode writes them as ordinary async command handlers. Registering them as `async fn` in `generate_handler!` reproduced the exact HRTB compiler limitation the Architect ruling anticipated ("implementation of `Send`/`Executor` is not general enough"), but on the *command* itself this time, not on `run_isolated_drill`/`test_backup` as in WS-H-4 — because these commands do real `.await` work (the audit-envelope call, the actor/destination lookups) *before* spawning the worker thread, and it is exactly that surrounding `async fn`'s generated future that fails to generalize. `commands/safe_upgrade.rs::run_safe_database_upgrade` — the file the ruling explicitly points to — is itself a plain `fn`, with every bit of async work, including its setup phase, driven through `tauri::async_runtime::block_on` inside the function body or the spawned thread; that is exactly the shape applied here. The worker thread itself still runs via `std::thread::spawn` + `tauri::async_runtime::block_on(restore_flow::run_restore(...))`, unchanged from the plan. No protected file (`embedded_setup.rs`, `safe_upgrade.rs` production bodies, `update_shutdown.rs`) was touched to make this work.
2. Per Architect ruling, `scripts/recovery/stockiha_bootstrap_roles_and_grants.sql` was not touched.
3. A genuine bug was found and fixed while writing the mandatory `busy_database_aborts_before_change` test: `live::wait_for_no_other_sessions`'s query filtered on `backend_type = 'client backend'`, but that column is redacted (`NULL`) for another backend's row under a role without `pg_read_all_stats` — confirmed empirically (a second `stockiha_migrator` connection's own row showed `backend_type: NULL` when queried from a different migrator connection). The filter now relies on `datname = current_database() AND pid <> pg_backend_pid()` alone, which is not redacted and already excludes every background worker (checkpointer, walwriter, autovacuum, …, which report `datname: NULL`). This is a correctness fix to code written in this same sub-plan, not a deviation from a previously-verified behavior.

## Blockers / questions for the Architect

**The installer could not be built and signed in this environment — this is the one incomplete deliverable.** `npm run tauri:build` compiles, links, and produces the NSIS bundle successfully:
```
Running makensis to produce ...\target\release\bundle\nsis\Stockiha_0.5.0_x64-setup.exe
Finished 1 bundle at: ...\target\release\bundle\nsis\Stockiha_0.5.0_x64-setup.exe
A public key has been found, but no private key. Make sure to set `TAURI_SIGNING_PRIVATE_KEY` environment variable.
Error A public key has been found, but no private key. Make sure to set `TAURI_SIGNING_PRIVATE_KEY` environment variable.
```
`tauri.conf.json`'s `plugins.updater.pubkey` is set (from WS-K-6), so `tauri build` always attempts to sign the update artifact. Per instruction, `tauri.conf.json` was not modified, the updater was not disabled, and no unsigned installer was renamed/delivered as a substitute.

**What the Owner must set, exactly:**
- `TAURI_SIGNING_PRIVATE_KEY` — the private key content (or a path to the key file, per Tauri's updater-signing docs), retrieved from the Bitwarden item `Stockiha — update signing PRIVATE KEY` (per `WS-K-6-SIGNING-KEYS.md`).
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the key's password, from the separate Bitwarden item `Stockiha — update signing key PASSWORD` (kept apart from the key itself, per the same document). Tauri needs this whenever the key was generated with a password, which `WS-K-6-SIGNING-KEYS.md`'s own instructions imply it was.

Set both in the same shell that runs `npm run tauri:build`, then re-run it; no other change is needed. The unsigned bundle produced by this attempt (`target\release\bundle\nsis\Stockiha_0.5.0_x64-setup.exe`) was left in place, unrenamed, exactly as this run produced it — not represented as a deliverable.

## Pending manual checks (PART 14 §M5)

All 12 items of §M5 (appended to `WS-H-MANUAL-VERIFICATION.md`) are pending real Windows/installer acceptance — none were run in this session (no installer was built and signed):
1. "Restore…" appears on backup rows.
2. Confirm dialog: date/type shown, warning banner, restart notice.
3. Confirm button gating: disabled until checkbox + exact `RESTORE`; lowercase rejected.
4. Cash session open blocks confirmation.
5. Cancel changes nothing.
6. A real restore takes over the whole window and the checklist advances in order.
7. The app restarts and the post-backup change is gone.
8. The auto-created "Before restore" safety backup itself restores the change back.
9. Exactly one live `postgres.exe` group survives, no leftovers.
10. New-PC restore reaches the login screen with the old admin credentials and matching data.
11. The restore link is EMBEDDED-only.
12. Interrupted-restore behavior (unplugged USB / killed process) shows one of the three defined outcome screens, never silent corruption.

## Unrelated problems noticed (not fixed)

- **Several ignored-test debug/re-run attempts during this session's own troubleshooting of the busy-database bug left orphaned `postgres.exe` clusters and their temp directories** (a Rust panic mid-test skips the test's own `test_support::stop_server` cleanup call at the end of the function — the same limitation WS-H-4's tests have, just never triggered there because no WS-H-4 test run actually panicked). Found via process/port inspection after the fact, stopped cleanly with `pg_ctl stop -m fast`, and the temp directories removed; the final, passing 9-test run left zero leftovers (confirmed by inspection immediately afterward). Not fixed: adding panic-safe (`Drop`-based) cleanup to every ignored test in this file and in `drill.rs` would be a real, but out-of-scope, robustness improvement worth a future small task.
- The `stockiha_acceptance` database on port 5433 was left running from the WS-H-4 session; it was not touched by this session (per ruling #1) and remains available for manual acceptance testing separately from the throwaway cluster used for gates here.
