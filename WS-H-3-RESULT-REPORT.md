# WS-H-3 Result Report

## Branch and commit
Branch: `task/ws-h-3-embedded-backup`
Base: `6bbbee35d3804a40db8fc109d4f3c587f80517a0` — a merge of `main` (`e656429`, WS-K-5 + WS-K-6) into the WS-F-5 line (`f8df321`, WS-F-4 + WS-F-5 WIP). Owner-approved deviation from the plan's "from `main`" base: the WS-F-4/WS-F-5 branch had forked *before* WS-K-5/6 landed on `main` and therefore lacked `safe_upgrade.rs`, `update_policy.rs` and the update engine the plan builds on; merging `main` in (only `src/shared/version.ts` conflicted) restored them. Because WS-F-4/5 migrations (`20260915090000`, `20260916090000`) are newer than the plan's `20260915120000`, the migration number follows the plan's own "newest + 10000" rule: **`20260916100000`**.
Head: `f960fe0cdb48ed4a90cef19dbb52b15e85623fb5`
Pushed: yes (`git ls-remote origin refs/heads/task/ws-h-3-embedded-backup` → `f960fe0cdb48ed4a90cef19dbb52b15e85623fb5`). This report is committed separately, as a docs-only follow-up commit on the same branch, because it must name the code commit's hash.

## Steps completed
- H3-01 Recovery mode resolver — done (`recovery_engine/{mod,mode,log,errors}.rs`, 6 resolver tests + exhaustive detail-code mapping test).
- H3-02 Database migration + fixture repair — done (`20260916100000_ws_h_003_recovery_embedded_foundation.sql`; `safe_upgrade` fixture now deletes only the bookkeeping row; `newest_migration_keeps_schema_state_current` guard test; SQL suite `ws_h_003_recovery_foundation_integration.sql` registered and passing, with a second `\i` of the migration proving idempotency). **Partial:** bootstrap grants script not regenerated — see Pending.
- H3-03 Schema helpers — done (`schema.rs`; `embedded_versions` / `embedded_checksums`).
- H3-04 Destination rules — done (`destination.rs`; `canonicalize_best_effort` / `drive_letter` moved verbatim; 10 unit tests incl. the `#[cfg(windows)]` case-insensitivity one).
- H3-05 Bundle format 2 + tools — done (`backup_proof` accepts formats 1 and 2, format 1 never reports privileges; `bundle.rs`, `tools.rs`; tamper test).
- H3-06 Application layer + command dispatch — done (`application/recovery_embedded.rs`; `commands/recovery.rs` dispatches by mode, EXTERNAL bodies moved verbatim into `*_external` functions; three new commands registered; 7 new `ErrorCode`s wired through `AppError`/`IpcError`/`stable_error_code`/`creation_audit_error_code`).
- H3-07 Embedded manual backup and validation — done (`backup.rs`; ignored real-PostgreSQL proof `creates_format_2_bundle_with_privileges` passes on Windows: format 2, kind MANUAL, real schema version, `pg_restore --list` shows `ACL` entries, no staging folder left, `recovery.log` written).
- H3-08 Startup behaviour by mode — done (`lib.rs` gates both WS-H-2 startup calls on a non-blank `STOCKIHA_DEV_DATABASE_URL`).
- H3-09 Frontend — done (commands/gateway/DTOs, 7 error codes in `errors.ts` + `tauriError.ts` + `locales.ts` fr/ar/en, `RecoverySettingsScreen` capabilities/mode/status/destination behaviour, `RESTORE_DRILL_AVAILABLE` and deferred copy deleted).
- H3-10 Tests and marker — done (17 vitest cases in `tests/recovery-settings.workflow.test.tsx`, 11 of them new; `APP_VERSION_MARKER = 'WS-H-3.0'`; `WS-H-MANUAL-VERIFICATION.md` with §M3).

## Files changed
```
.../WS-H-Backup-Recovery-Implementation-Plan.md    | 1518 ++++++++++++++++++++
 WS-H-MANUAL-VERIFICATION.md                        |   14 +
 ...00000_ws_h_003_recovery_embedded_foundation.sql |  549 +++++++
 src-tauri/src/application/mod.rs                   |    2 +
 src-tauri/src/application/recovery.rs              |  147 +-
 src-tauri/src/application/recovery_creation.rs     |   24 +-
 src-tauri/src/application/recovery_embedded.rs     |  470 ++++++
 src-tauri/src/commands/recovery.rs                 |  228 ++-
 src-tauri/src/domain/recovery.rs                   |  190 +++
 src-tauri/src/error.rs                             |  155 ++
 src-tauri/src/infrastructure/backup_proof/mod.rs   |  130 +-
 src-tauri/src/infrastructure/mod.rs                |    4 +
 .../src/infrastructure/recovery_engine/backup.rs   |  417 ++++++
 .../src/infrastructure/recovery_engine/bundle.rs   |  578 ++++++++
 .../infrastructure/recovery_engine/destination.rs  |  417 ++++++
 .../src/infrastructure/recovery_engine/errors.rs   |  257 ++++
 .../src/infrastructure/recovery_engine/log.rs      |   82 ++
 .../src/infrastructure/recovery_engine/mod.rs      |   47 +
 .../src/infrastructure/recovery_engine/mode.rs     |  187 +++
 .../src/infrastructure/recovery_engine/schema.rs   |  143 ++
 .../src/infrastructure/recovery_engine/tools.rs    |  255 ++++
 src-tauri/src/infrastructure/safe_upgrade.rs       |  316 ++--
 src-tauri/src/infrastructure/schema_version.rs     |   70 +
 src-tauri/src/lib.rs                               |   33 +-
 .../ws_h_003_recovery_foundation_integration.sql   |  213 +++
 src-tauri/tests/run_current_sql_suites.sh          |    1 +
 src/features/settings/RecoverySettingsScreen.tsx   |  398 +++--
 src/shared/i18n/locales.ts                         |   31 +
 src/shared/ipc/commands.ts                         |    4 +
 src/shared/ipc/recoveryDto.ts                      |   60 +
 src/shared/ipc/recoveryGateway.ts                  |   33 +
 src/shared/types/errors.ts                         |   15 +
 src/shared/utils/tauriError.ts                     |    8 +
 src/shared/version.ts                              |    2 +-
 tests/recovery-settings.workflow.test.tsx          |  270 +++-
 35 files changed, 6919 insertions(+), 349 deletions(-)
```

## Gates (real output, last lines each)
### cargo fmt --check
```
(no output — clean)
```
### cargo check
```
    Checking stockiha-backend v0.1.0 (C:\Users\Perfetto\Desktop\Stockiha-Part02-Test\src-tauri)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 49.40s
```
### cargo clippy --all-targets --all-features -- -D warnings
```
    Checking stockiha-backend v0.1.0 (C:\Users\Perfetto\Desktop\Stockiha-Part02-Test\src-tauri)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 16.75s
```
### cargo test --lib
```
test result: ok. 400 passed; 0 failed; 41 ignored; 0 measured; 0 filtered out; finished in 17.17s
```
### cargo test --lib -- --ignored recovery_engine   (Windows, real PostgreSQL)
```
running 1 test
test infrastructure::recovery_engine::backup::tests::creates_format_2_bundle_with_privileges ... ok
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 440 filtered out; finished in 24.04s
```
### cargo test --lib -- --ignored safe_upgrade   (Windows, real PostgreSQL — proves hazard H1 fixed)
```
running 3 tests
test infrastructure::safe_upgrade::tests::a_failed_migration_is_rolled_back_to_the_exact_prior_state ... ok
test infrastructure::safe_upgrade::tests::happy_path_backs_up_verifies_migrates_and_verifies_again ... ok
test infrastructure::safe_upgrade::tests::up_to_date_newer_and_unknown_verdicts_never_trigger_a_backup ... ok
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 438 filtered out; finished in 75.89s
```
### cargo test --lib -- --ignored embedded_setup   (Windows, real PostgreSQL)
```
test infrastructure::embedded_setup::tests::a_failure_during_migrations_leaves_no_database_json ... ok
test infrastructure::embedded_setup::tests::full_setup_runs_end_to_end_against_a_temp_directory ... MIGRATIONS: embedded=155 embedded_latest=20260916100000 applied_rows=155 verdict=UpToDate
test infrastructure::embedded_setup::tests::full_setup_succeeds_against_a_non_ascii_arabic_data_path ... ok
test infrastructure::embedded_setup::tests::full_setup_succeeds_when_the_install_and_data_paths_contain_spaces ... ok
test infrastructure::embedded_setup::tests::setup_log_never_contains_a_generated_password ... ok
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 436 filtered out; finished in 94.91s
```
(155, not the plan's 153: this branch also carries the WS-F-4 and WS-F-5 migrations.)
### npm run typecheck
```
> tsc -b
(no errors)
```
### npm run lint
```
> eslint .
(no findings)
```
### npm test -- --run
```
 Test Files  53 passed (53)
      Tests  532 passed (532)
   Duration  45.81s
```
(An earlier full run had one 5 s timeout in `tests/historical-exports.test.ts`, a PDF-rendering test unrelated to WS-H; it passes in 1.5 s in isolation — see Unrelated problems.)
### npm run build
```
✓ built in 6.60s
```
### bash src-tauri/tests/run_current_sql_suites.sh
Run against a throwaway PostgreSQL 18 cluster built from the bundled binaries (`initdb` into the session scratchpad, port 55499, roles + `_sqlx_migrations` bootstrapped exactly as `.github/workflows/ci.yml` does, all 155 migrations applied by `psql` in filename order, fiscal period seeded; cluster stopped and deleted afterwards). The runner itself stops at its first failure (`s3_001_procurement_integration.sql`, pre-existing, see Unrelated problems), so every suite was then run individually with the runner's own `BEGIN; \i; SET CONSTRAINTS ALL IMMEDIATE; ROLLBACK;` wrapper:
```
PASS  31 suites (+ s2_002 in its own transaction)
FAIL   5 suites — all procurement PO-receipt suites: s3_001, s3_002, s3_003, r2_financial_semantics, r8_e_procurement
       (ERROR: new row for relation "purchase_receipts" violates check constraint "pr_origin_po_invariant")
PASS  src-tauri/tests/recovery/r6_001_recovery_authorization_audit_integration.sql
PASS  src-tauri/tests/recovery/r6_001_backup_role_read_privileges_integration.sql
PASS  src-tauri/tests/recovery/r6_001_sqlx_metadata_backup_acl_integration.sql
PASS  src-tauri/tests/recovery/r6_002_restore_verification_authorization_integration.sql
PASS  src-tauri/tests/recovery/ws_h_003_recovery_foundation_integration.sql   (includes the second `\i` of the migration: idempotent)
```
### git ls-remote
```
f960fe0cdb48ed4a90cef19dbb52b15e85623fb5	refs/heads/task/ws-h-3-embedded-backup
```

## Deviations from the plan
1. **Branch base** (Owner decision, see above): WS-F-5 line + merge of `main`, not `main` directly. Migration number `20260916100000` (plan rule "newest + 10000").
2. **`recovery_engine::is_symlink_or_reparse`** — one tiny helper added in `recovery_engine/mod.rs` (the plan lists no module for it) so the engine does not depend on the private copies in `application::recovery` / `recovery_creation`.
3. **`recovery_engine::backup::migrator_connect_options`** — the seven `connect_options` lines were copied here (as the plan allows) instead of widening `safe_upgrade::connect_options`, keeping `safe_upgrade.rs` production code untouched.
4. **Capabilities gating order in `RecoverySettingsScreen`**: the plan's rule 1 (all four booleans false → render nothing) would, read literally, always win over rule 2 (mode UNAVAILABLE → error banner), because an UNAVAILABLE machine reports all-false capabilities. The screen checks the mode first, so an UNAVAILABLE machine shows the banner (plan test case 2) and an all-false EMBEDDED/EXTERNAL user sees nothing (test case 1).
5. **`schema_version::embedded_versions`** filters `migration_type.is_up_migration()` (the method exists in SQLx 0.8.6) as the plan's pitfall note suggests.
6. **`OperatorBackupValidationResult` optional fields** are `skip_serializing_if = "Option::is_none"` so the wire shape of legacy (EXTERNAL) results is byte-identical to before.
7. **Ignored test temp label** shortened to `"re"`: the staged dump path (`<destination>\.<name>.staging-<tag>-<nanos>\.tmp-<name>-<pid>-<nanos>-<n>\database.dump`) is ~145 characters on its own; with the long default test label it reached 267 characters and `pg_dump` (a plain Win32 program, no long-path manifest) failed with "No such file or directory". Production default destination (`%APPDATA%\com.raqmenha.stockiha\operator-backups`) lands around 200 characters. The staging layout follows the plan exactly; the MAX_PATH margin is flagged below for the Architect.
8. **Bootstrap grants script** not regenerated (Pending) — no migrated *developer* database was available; a throwaway CI-shaped cluster was used for the SQL suites but its role attributes differ from the dev cluster, so regenerating from it would misrepresent the real cluster.

## Blockers / questions for the Architect
None blocking. Two points to rule on before WS-H-4:
- **Windows MAX_PATH margin (deviation 7).** A stored destination deeper than roughly 110 characters would make `pg_dump` fail with `BACKUP_PG_DUMP_FAILED` (logged with the path in `recovery.log`). Options: (a) accept and document; (b) shorten the staging folder names (drop `<nanos>` from `.<name>.staging-<attempt_id>-<nanos>` — the attempt id is already unique); (c) refuse over-long destinations in `check_candidate` with a new detail code. Recommendation: (b) in WS-H-4, it is a two-line change.
- **WS-F-4/WS-F-5 merge order.** The static guard `newest_migration_keeps_schema_state_current` requires the newest migration file to bump `operations.schema_state`. If WS-F work is later rebased or renumbered *after* `20260916100000`, that migration must also bump `schema_state`, or the test fails.

## Pending manual checks (PART 14 §M3)
All eight §M3 steps are pending Owner execution on an installed build (see `WS-H-MANUAL-VERIFICATION.md`). Not verifiable from this session: no console window flash (M3-6), installed-build default folder (M3-1), USB validate/tamper (M3-4/5), install-folder refusal (M3-7), cashier hiding (M3-8), `run.bat` regression (acceptance criterion 7).
Also pending: `scripts/recovery/stockiha_bootstrap_roles_and_grants.sql` regeneration — **bootstrap grants script not regenerated — needs dev DB**. The only new grants in WS-H-3 are `GRANT SELECT ON operations.restore_events TO stockiha_backup` and `GRANT EXECUTE` on the four new `operations.*` functions to `stockiha_runtime`; both were confirmed present by introspecting the migrated throwaway cluster.

## Unrelated problems noticed (not fixed)
1. **Five procurement SQL suites fail on this branch** (`s3_001`, `s3_002`, `s3_003`, `r2_financial_semantics`, `r8_e_procurement`): `inventory.confirm_purchase_receipt` inserts a `purchase_receipts` row that violates `pr_origin_po_invariant` (origin `DIRECT_PURCHASE` with a `purchase_order_id`). WS-E/WS-F territory; no file touched by WS-H-3 is involved. `run_current_sql_suites.sh` stops at the first of them, so the recovery suites only run when invoked individually (done here — all five recovery suites pass).
2. **`tests/historical-exports.test.ts`** ("renders a valid vector PDF…") timed out once at 5 s under the full parallel vitest run; passes in 1.5 s in isolation. Pre-existing timing sensitivity, unrelated to WS-H.
3. **`scripts/recovery/stockiha_bootstrap_roles_and_grants.sql` has been stale since WS-H-1 (2026-08-27)**: it predates every WS-D/WS-E/WS-F object (e.g. `catalog.categories`, `core.printing_settings`), not only WS-H-3's.
4. **WS-F-5 is committed as a WIP snapshot** (`f8df321`) on `task/ws-f-5-cash-session-completion` and is part of this branch's history; its migration `20260916090000` does not bump `operations.schema_state` (harmless while WS-H-3's is the newest).
5. The `vcvars64.bat` on this machine prints `'vswhere.exe' is not recognized` before every cargo invocation; harmless (the toolchain resolves anyway).
