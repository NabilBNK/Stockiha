# WS-H — Backup & Recovery Repair
## Executable Implementation Specification (WS-H-3 → WS-H-7)

Prepared by: Lead Project Architect (Claude)
Baseline: `main` @ `e65642962008b7c76ba663550dc68cd1615871e1` (WS-K-6 merged, `APP_VERSION_MARKER = 'WS-K-6.6'`)
Date: 2026-09-15

---

## PART 0 — HOW TO USE THIS DOCUMENT

This document is the single brief for repairing and completing WS-H. It is split into five sub-plans that must be executed **in order**, each on its own branch, each accepted by the Owner on a real Windows install before the next begins.

| Sub-plan | Title | Agent | Branch (create from) |
|---|---|---|---|
| WS-H-3 | Embedded backup foundation (make Create / Validate / Destination work on an installed build) | Claude Code | `task/ws-h-3-embedded-backup` (from `main`) |
| WS-H-4 | Backup list, copy-to-folder, isolated restore test | Claude Code | `task/ws-h-4-backup-list-and-test` (from WS-H-3 branch) |
| WS-H-5 | Real in-app restore + restore on a new PC | Claude Code | `task/ws-h-5-live-restore` (from WS-H-4 branch) |
| WS-H-6 | Automatic backups (before every update, daily) + retention | Claude Code | `task/ws-h-6-automatic-backups` (from WS-H-5 branch) |
| WS-H-7 | Arabic translation, French wording review, documentation | Gemini | `task/ws-h-7-translations-docs` (from WS-H-6 branch) |

Rules for the implementing agent:

1. Read PART 1 to PART 6 fully before starting any sub-plan. They are shared contracts; the sub-plan parts reference them by section number (e.g. "§5.6").
2. Execute only the sub-plan you were assigned. Do not implement steps of a later sub-plan early.
3. Follow each step's instructions literally. Where this document gives an exact name (file, function, command, error code, column, i18n key), use exactly that name.
4. If reality in the repository contradicts this document (a function has a different signature, a file moved), stop and report it under "Blockers" in the Result Report (PART 15). Do not improvise an architecture.
5. Commit and push before writing the Result Report. The report must end with the full commit hash and `Pushed: yes/no`.

Rules for the Owner (nbk): you do not need to read PARTS 5–13. You need PART 14 (the manual checks you run on Windows after each sub-plan) and the Appendix (paste-ready prompts).

---

## PART 1 — VERIFIED BASELINE (what the repository contains today)

Verified by downloading the live `main` tarball, not from agent reports.

### 1.1 Backend (Rust, `src-tauri/src/`)

| File | What it does today |
|---|---|
| `commands/recovery.rs` | 7 Tauri commands: `get_backup_destination_setting`, `update_backup_destination_setting`, `get_restore_verification_setting`, `update_restore_verification_setting`, `create_operator_backup`, `validate_operator_backup`, `verify_operator_backup_restore`. Holds `RecoveryOperationLease` (process-wide `AtomicBool`, one heavy operation at a time). |
| `application/recovery_creation.rs` | Backup creation. Reads the database address from env var `STOCKIHA_DEV_DATABASE_URL` (`resolve_pg_dump_target`), finds `pg_dump` via env var `STOCKIHA_PG_DUMP_PATH` or `PATH`, reads the `stockiha_backup` password from Windows Credential Manager, dumps with `--no-owner --no-privileges`. Backup root = DB setting, else env var `STOCKIHA_BACKUP_ROOT`. |
| `application/recovery.rs` | Validation, temporary restore verification (needs env var `STOCKIHA_RESTORE_ADMIN_DATABASE_URL` = PostgreSQL superuser URL), destination update (needs the same superuser URL to read `data_directory`), control totals (`collect_restore_control_totals`), startup diagnostic and orphan sweep (both env-var based). Bundles must sit directly inside the backup root (`BACKUP_BUNDLE_OUTSIDE_ROOT`). |
| `domain/recovery.rs` | Request/response DTOs. |
| `infrastructure/backup_proof/mod.rs` | Bundle assembly (`create_backup_bundle`), validation (`validate_bundle`, format version must equal `1`), `pg_dump` helpers. Bundle name `GestStock-Backup-YYYYMMDD-HHMMSS` (UTC). |
| `infrastructure/restore_proof/mod.rs` | Temporary-database helpers for the superuser-URL drill. |
| `infrastructure/safe_upgrade.rs` | WS-K-5 automatic pre-upgrade backup + rollback. Uses the **migrator** credential (`migrator.json`) and the **bundled** `pg_dump.exe`/`pg_restore.exe`. Rollback = `reset_all_schemas` + `pg_restore`. Proven on a real machine. Backs up **only when the schema is older than the binary**. |
| `infrastructure/embedded_setup.rs` | First-run embedded PostgreSQL setup. Creates roles `stockiha_backup`, `stockiha_migrator`, `stockiha_owner`, `stockiha_runtime` with random passwords, but persists only runtime (`database.json`) and migrator (`migrator.json`). The `stockiha_admin` superuser password and the `stockiha_backup` password are discarded. Database name is the constant `stockiha_shop`. |
| `infrastructure/pg_process.rs` | Bundled binaries (`bundled_bin_dir`, `bundled_resource_dir`), data directory (`resolve_pgdata_dir`), `spawn_postgres`, `wait_until_ready`, `stop_postgres`, `find_free_port`, `free_disk_space_bytes`, `preflight_backup_binaries`, `hide_console_window`, `EmbeddedPostgresHandle`, `stop_embedded_postgres_if_running`. |
| `infrastructure/local_config.rs` | `database.json` / `migrator.json`; `load_migrator_connection_info` returns `MigratorConnectionInfo { host, port, database, username, password: Zeroizing<String> }`. |
| `infrastructure/schema_version.rs` | `MIGRATOR` (embedded migrations), `embedded_latest_version()`, `check_schema_compatibility`, `run_all_migrations`. |
| `infrastructure/db.rs` | `DATABASE_URL_ENV = "STOCKIHA_DEV_DATABASE_URL"`; `DatabaseState::{Unconfigured, InvalidConfiguration, Configured { pool, .. }}`; `pool_or_unavailable`. |
| `lib.rs` | Startup: `ensure_embedded_postgres_running` (skipped when the env var is set) → `database_state_from_precedence` → `startup_diagnostic` → `recovery::startup_environment_diagnostic` → `recovery::sweep_orphaned_restore_databases`. Exit hook stops embedded PostgreSQL. |
| `commands/update_shutdown.rs` | `prepare_for_update_install` / `resume_after_failed_update_install`. |
| `commands/embedded_setup.rs` | Shows the correct "stop our server, then `tauri::process::restart`" pattern. |

### 1.2 Database (`src-tauri/migrations/`, 152 files, newest `20260914090000_ws_f_003_sale_discount.sql`)

- `20260803193000_r6_001_recovery_authorization_audit.sql`: permissions `CREATE_BACKUP_BUNDLE`, `VALIDATE_BACKUP_BUNDLE` (ADMIN); tables `operations.schema_state`, `operations.recovery_attempts`; functions `operations.begin_recovery_attempt`, `operations.complete_recovery_attempt` (these are the latest definitions — no later migration redefines them).
- `20260803201500_...collision_guard.sql`: unique index `recovery_attempts_create_bundle_unique` on `bundle_identifier` where `operation_code = 'CREATE_BACKUP'`.
- `20260805150500_r6_002_restore_verification.sql`: permission `VERIFY_BACKUP_RESTORE` (ADMIN, CEO); constraint `recovery_attempts_operation_valid` = `('CREATE_BACKUP','VALIDATE_BACKUP','VERIFY_RESTORE')`; functions `begin_restore_verification_attempt`, `complete_restore_verification_attempt`.
- `20260805151000_r6_002_restore_verification_toggle.sql`: `operations.recovery_settings` (singleton, `restore_verification_enabled` default true), `operations.recovery_setting_audit`, trigger `recovery_attempts_restore_setting_guard` (blocks new `VERIFY_RESTORE` rows when disabled).
- `20260829100000_r6_003_backup_destination_setting.sql`: column `recovery_settings.backup_destination_path`; functions `get_backup_destination_setting`, `update_backup_destination_setting` (permission `CREATE_BACKUP_BUNDLE`).
- `20260821210000_iam_user_and_role_administration.sql`: role `SUPER_ADMIN` (was granted all permissions that existed at that time only).
- Sessions table: `iam.application_sessions (user_id, workstation_id, token_hash, expires_at)`.
- SQL integration suites are listed in `src-tauri/tests/run_current_sql_suites.sh`.

### 1.3 Frontend (`src/`)

- `features/settings/RecoverySettingsScreen.tsx` (613 lines): destination card, Create, Browse + Validate, restore-verification toggle, confirmation checkbox, "Verify temporary restore", result grids. Own `COPY` dictionary (en/fr/ar). Rendered for every user in Settings (`app/AppRouter.tsx` line ~446), non-admins just get error banners.
- `shared/ipc/recoveryGateway.ts`, `shared/ipc/recoveryDto.ts`, `shared/ipc/commands.ts` (keys `CREATE_OPERATOR_BACKUP` etc.).
- `shared/types/errors.ts`: `BACKEND_ERROR_CODES` + `ERROR_MESSAGE_KEYS` (must stay in lockstep with Rust `ErrorCode`).
- `shared/i18n/locales.ts`: three dictionaries `fr` (defines `MessageKey`), `ar`, `en`.
- `shared/components/index.tsx`: `Button`, `TextField`, `Spinner`, `Banner`, `ConfirmDialog` (CSS classes `sk-modal__backdrop`, `sk-modal`, `sk-modal__title`, `sk-modal__body`, `sk-modal__actions`).
- `features/startup/DatabaseUpgradeScreen.tsx`: the template for a live-progress full-screen flow (listen first, then invoke).
- `features/update/useAppUpdate.ts` + `UpdateBanner.tsx`: `performUpdate` = `download()` → `prepare_for_update_install` → `install()`. No backup step.
- `features/setup/SetupScreen.tsx`: first-admin bootstrap (`SetupScreen({ onComplete })`).
- `shared/version.ts`: `APP_VERSION_MARKER`.
- Tests: `tests/recovery-settings.workflow.test.tsx`.

### 1.4 Documents

`docs/slices/R6-001-...md`, `docs/slices/R6-002-...md`, `docs/recovery/RESTORE_PROCEDURE.md` (developer command-line restore), `scripts/recovery/*` (role/grant bootstrap SQL + generator), `CURRENT_STEP.md` (WS-H row says "acceptance-passed — closed", which was true only for the `run.bat` developer environment).

---

## PART 2 — IMPLEMENTED vs PLANNED vs ACTUALLY WORKING

"Planned" = `STOCKIHA_GROUND_TRUTH.md` §4 WS-H + Owner rulings. "Works on installed build" = a client PC installed with the WS-K-6 installer (embedded PostgreSQL, no `run.bat`).

| # | Capability | Planned? | Code exists? | Works on installed build? | Root cause / note |
|---|---|---|---|---|---|
| G1 | Create backup bundle (`pg_dump` + checksums) | MVP | Yes | **No** | Needs `STOCKIHA_DEV_DATABASE_URL`, `pg_dump` on PATH, `stockiha_backup` password in Credential Manager — none exist on a client PC. |
| G2 | Choose backup destination | MVP (WS-H-1) | Yes | **No** | Saving needs `STOCKIHA_RESTORE_ADMIN_DATABASE_URL` (superuser), never available on a client PC. |
| G3 | Default destination when none chosen | Implied (UI text says "using the default backup location") | **No** | **No** | Falls back to env var `STOCKIHA_BACKUP_ROOT` only. UI text is false. |
| G4 | Validate bundle integrity | MVP | Yes | Partly | Hashing works, but bundle must be inside the destination (unusable for USB), and compatibility flags are wrong (G6, G7). |
| G5 | Temporary restore test | MVP | Yes | **No** | Needs the superuser URL; creates a temporary database inside the live server (the setup that crashed during WS-H-2 acceptance). |
| G6 | Schema version recorded in backups | MVP | Yes | **Wrong** | Read from `operations.schema_state`, which 14 migrations since `20260829100000` never updated. Every backup is stamped `20260829100000`. |
| G7 | Application version check | MVP | Yes | **Meaningless** | Compares with `CARGO_PKG_VERSION` = `0.1.0` (never bumped); the real version is `tauri.conf.json` `0.5.0`. Exact match would also make every backup "incompatible" after any update. |
| G8 | Backups restorable by the app | Required for any real restore | No | **No** | Dumps use `--no-privileges`: a restored copy has no GRANTs, so `stockiha_runtime` cannot read it. |
| G9 | Real restore inside the app | Required by the purpose of WS-H ("disaster recovery") | **No** | **No** | Only a developer command-line document exists. |
| G10 | Restore on a new PC | Disaster recovery | **No** | **No** | — |
| G11 | List of existing backups | UX necessity | **No** | **No** | — |
| G12 | Copy a backup to another drive (USB) | Off-machine copy | **No** | **No** | — |
| G13 | Full backup before every update | **Owner ruling (WS-K)** | Partial | Partial | WS-K-5 backs up only when the schema changes; a release without migrations gets no backup. |
| G14 | Automatic daily backup | Architect ruling in this plan (Owner may veto) | No | No | Ground truth lists "scheduled encrypted cloud backup" as future; a local daily copy is a subset. |
| G15 | Hide recovery screen from users without permission | UX | No | No | Non-admins see error banners. |
| G16 | Startup diagnostics | WS-H-2 | Yes | **Misleading** | Warns about missing `run.bat` variables on every installed build. |
| G17 | Audit of recovery operations | MVP | Yes | Yes (DB side) | Keep. |
| G18 | One-operation-at-a-time lock | WS-H-2 | Yes | Yes | Keep. |
| G19 | Restore-verification ON/OFF policy | R6-002 | Yes | Yes (DB side) | Keep unchanged. |
| G20 | Developer (`run.bat`) workflow | Existing | Yes | n/a | Must keep working exactly as today. |

Hidden hazard H1: `infrastructure/safe_upgrade.rs` test fixture `rewind_latest_migration` hard-codes the latest migration's content (drops the 9-argument `sales.confirm_cash_sale`). Adding any migration breaks that ignored test unless the fixture is updated (handled in step H3-02).

---

## PART 3 — ARCHITECTURE RULINGS (binding)

Each ruling states the decision, why, and what was rejected. The agent must not re-open these.

**R1. Two recovery modes, selected at runtime.**
- `EXTERNAL` mode = env var `STOCKIHA_DEV_DATABASE_URL` is set and non-empty (developer/`run.bat`). All existing WS-H-1/WS-H-2 code paths run **byte-for-byte unchanged**. New features (list is the only exception, see R10) answer `RECOVERY_UNAVAILABLE` in this mode.
- `EMBEDDED` mode = env var not set **and** `migrator.json` loads **and** the app data dir and resource dir resolve. All new behaviour runs here.
- `UNAVAILABLE` = neither. Every recovery command answers `RECOVERY_UNAVAILABLE`.
- Why: the Owner's developer machine and the client PC are genuinely different environments; mixing them is what broke WS-H. Precedence mirrors `db::database_state_from_precedence` so the backup always targets the same database the app is connected to.

**R2. Embedded mode authenticates `pg_dump`/`pg_restore` with the migrator credential and runs the bundled binaries only.**
- Why: `migrator.json` is the only privileged credential persisted on client PCs; WS-K-5 already uses exactly this and it is proven on real hardware. The `stockiha_backup` password was never persisted and cannot be reset without a superuser.
- Rejected: persisting the superuser password (breaks a deliberate WS-K-4 security decision); `trust` authentication in `pg_hba.conf` (any local process becomes superuser).

**R3. Bundle format version 2 = dump taken WITH privileges (`--no-owner`, without `--no-privileges`).** Only format 2 bundles are restorable in-app. Format 1 bundles can still be validated and tested (with `--no-privileges`), never restored in-app.
- Why: without GRANTs a restored database is unusable by `stockiha_runtime`. Format 1 bundles only ever existed on the developer machine (installed builds could never create one — G1).

**R4. The schema version of a backup is `max(version)` of successful rows in `public._sqlx_migrations`, read through the migrator connection at dump time.** Compatibility is judged against the binary's embedded migration list, not against `operations.schema_state`.
- `SAME` = equal to `embedded_latest_version()`.
- `OLDER` = lower and present in the embedded list → restorable; the restore brings it forward with the normal migrator.
- `NEWER` = higher → never restorable (would hit the WS-K-1 hard-stop screen).
- `UNKNOWN` = unparsable or lower but not in the embedded list → never restorable.
- `operations.schema_state` is still bumped by the new migration (keeps the legacy EXTERNAL path honest), and a static test forces future migrations to keep it current.

**R5. The application version is informational only.** Recorded from `app.package_info().version` (currently `0.5.0`). Never blocks validation, testing or restore. `applicationCompatible` is always `true` in EMBEDDED results.

**R6. "Test this backup" runs in an isolated, throwaway PostgreSQL cluster** (`initdb` into a temporary folder next to the live data folder, started on its own free port, destroyed afterwards). It never touches the live server.
- Why: no `CREATEDB`/superuser credential exists on client PCs; the WS-H-2 crash happened while drilling inside the live server; a throwaway cluster gives full proof (restore + forward migration + totals) with zero risk to live data. Bundled `initdb`/`postgres` already work on real machines (WS-K-4).
- Rejected: `pg_restore --list` only (proves the file is readable, not that it restores); temporary database inside the live server (needs `CREATEDB`).

**R7. Real restore is in-place, with every safety step first.** Order: validate → isolated test → safety backup of current data (format 2, kind `PRE_RESTORE`) → close app connections → reset all schemas → `pg_restore --single-transaction --exit-on-error` → forward migration if `OLDER` → verify (schema `UP_TO_DATE`, totals identical to the isolated test, journals balanced) → restore asset files → record event → stop server → restart app. Any failure after data was touched → automatic rollback from the safety backup.
- Why: reuses the proven WS-K-5 reset-and-restore mechanism; the live data is only touched after the backup has been proven restorable in isolation.
- Rejected: swapping whole data directories (Windows file locks — the exact failure class seen in WS-K-6; more new code on the riskiest path).

**R8. Restore on a new PC** is offered on the first-admin setup screen, only in EMBEDDED mode, and only while `iam.users` has zero rows. No session is required because no account exists yet. Rollback target is an empty, fully migrated schema.

**R9. Bundles can be validated, tested and restored from any folder** (USB stick, other disk). The "must be directly inside the backup destination" rule (`BACKUP_BUNDLE_OUTSIDE_ROOT`) applies only in EXTERNAL mode. The folder name must still be canonical and the full checksum validation still applies.
- Why: disaster recovery means the backup is on another drive.

**R10. The backup list works in both modes** (it is a read-only folder scan); in EXTERNAL mode every item has `restorable: false`.

**R11. Destination rules (EMBEDDED).** Stored setting → else default `<app_data_dir>\operator-backups` (created on demand). Saving a destination is refused when it resolves inside the live data folder (`resolve_pgdata_dir`) or inside the install/resource folder (replaced by updates). The folder must be creatable and writable (probe file). A same-drive warning is returned when it is on the same drive as the live data folder. If a stored destination is unavailable at backup time (USB unplugged): manual backup fails with `BACKUP_DESTINATION_UNAVAILABLE`; automatic backups (`DAILY`, `PRE_UPDATE`, `PRE_RESTORE`) fall back to the default folder and report `usedFallbackDestination: true`.

**R12. Automatic backups.** `PRE_UPDATE` before every update install (Owner ruling; failure aborts the update); `DAILY` once per day, 60 s after the first login of an app session, only if no successful backup in the last 20 hours. Retention after a successful backup of the same kind: `DAILY` newest 14, `PRE_UPDATE` newest 5, `PRE_RESTORE` newest 5, `MANUAL` never deleted. WS-K-5's own `backups\stockiha-preupgrade-*.dump` files are untouched and not listed.

**R13. Permissions.** New permission `RESTORE_BACKUP_LIVE` (ADMIN and SUPER_ADMIN). Automatic backups require only a valid session (any role) because they are system-initiated and write only to the configured destination. Listing requires `VALIDATE_BACKUP_BUNDLE`; copying requires `CREATE_BACKUP_BUNDLE`; testing requires `VERIFY_BACKUP_RESTORE` (unchanged, still governed by the ON/OFF policy); real restore requires `RESTORE_BACKUP_LIVE` (not governed by the ON/OFF policy — its internal test is mandatory).

**R14. All database changes for WS-H-3..6 go into ONE migration created in WS-H-3**, written to be fully re-runnable (idempotent). Why: one fixture update (hazard H1), one role/grant regeneration, and later sub-plans cannot drift the contract.

**R15. Confirmation for a real restore**: a checkbox AND typing the Latin word `RESTORE` (same word in every language — Arabic keyboards can still type it; the UI tells the user exactly what to type).

**R16. Records of a real restore** live in a new table `operations.restore_events` (no foreign keys, because users differ between the backup and the replaced data) and in `<app_data_dir>\recovery.log`. The `recovery_attempts` row of a successful live restore disappears with the replaced data; that is expected.

---

## PART 4 — GLOBAL RULES FOR EVERY SUB-PLAN

### 4.1 Must NOT change
- Anything under `infrastructure/embedded_setup.rs` behaviour, `infrastructure/safe_upgrade.rs` behaviour, `commands/update_shutdown.rs` behaviour. Allowed: changing specific private helpers to `pub(crate)` **without changing their bodies** (listed per step), and the test fixture in H3-02.
- The EXTERNAL-mode code paths in `application/recovery.rs` and `application/recovery_creation.rs` (they may be called from a new dispatcher, but their bodies stay as they are, except where a step says otherwise).
- Existing migrations (never edit an applied migration file).
- `database.json` / `migrator.json` formats.
- The bundle folder name format `GestStock-Backup-YYYYMMDD-HHMMSS` and the file names inside it.
- Existing IPC command names and their existing request fields (new fields may be added as optional).
- `STOCKIHA_GROUND_TRUTH.md` (only WS-H-7 edits it, one paragraph, see H7).
- The WS-K-1 startup precedence and the WS-K-5 upgrade screen routing.

### 4.2 Security invariants (from `AGENTS.md`)
- Passwords only ever go into a child process's `PGPASSWORD` environment variable. Never argv, never a URL string, never a log line, never IPC.
- IPC errors carry only a stable code (`IpcError`). Detail codes are uppercase ASCII `[A-Z0-9_]`, ≤128 chars.
- Every child process (`pg_dump`, `pg_restore`, `initdb`, `postgres`, `pg_ctl`) must be spawned through `pg_process::hide_console_window(&mut command)` — otherwise a black console window flashes on the client PC. (The legacy `backup_proof::discover_and_validate_pg_dump` does NOT do this; do not use it in EMBEDDED mode.)
- Database authorization stays in `SECURITY DEFINER` SQL functions. React hiding is convenience only.

### 4.3 Naming conventions
- Rust module for all new engine code: `src-tauri/src/infrastructure/recovery_engine/` (Tauri-free, like `safe_upgrade.rs`).
- Rust application orchestration: `src-tauri/src/application/recovery_embedded.rs`.
- New Tauri commands: `src-tauri/src/commands/recovery.rs` (same file), snake_case names listed in §5.8.
- Frontend new components: `src/features/settings/recovery/` (PascalCase `.tsx`), gateway additions in `src/shared/ipc/recoveryGateway.ts`, DTO additions in `src/shared/ipc/recoveryDto.ts`.
- i18n keys added to `src/shared/i18n/locales.ts` under the prefix `recovery.` (new screens) and `errors.` (error codes). The existing `COPY` dictionary inside `RecoverySettingsScreen.tsx` is migrated to `recovery.*` keys in WS-H-4.
- Detail/audit codes: `BACKUP_*`, `RESTORE_*`, `DRILL_*`.

### 4.4 Version marker
Every sub-plan sets `src/shared/version.ts` → `APP_VERSION_MARKER` to `'WS-H-3.0'`, `'WS-H-4.0'`, `'WS-H-5.0'`, `'WS-H-6.0'`, `'WS-H-7.0'` respectively. Each fix round on the same sub-plan bumps the minor digit (`'WS-H-3.1'`, …).

### 4.5 Gates (must all pass before push; paste real output in the report)
```
cargo fmt --check
cargo check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --lib
cargo test --lib -- --ignored recovery_engine     (Windows only; real PostgreSQL)
cargo test --lib -- --ignored safe_upgrade        (Windows only; proves hazard H1 fixed)
npm run typecheck
npm run lint
npm test -- --run
npm run build
bash src-tauri/tests/run_current_sql_suites.sh    (if a local PostgreSQL 18 test DB is available; otherwise report "not run" with reason)
```
Never claim a Windows-only result from Linux. Never build the installer (`npm run tauri:build` is the Owner's manual step).

### 4.6 Logging
- New file `<app_data_dir>\recovery.log`, append-only, one line per event: `[RFC3339 UTC] <OPERATION> <STEP>: <STATUS> [- detail]`. Same helper style as `append_upgrade_log` in `safe_upgrade.rs`. Detail text may contain paths and child-process stderr (trimmed to 500 chars) but never passwords. Never log `PGPASSWORD` or a connection string.
- `tracing::warn!/error!` for the same events (debug builds only print them).

---

## PART 5 — TARGET SYSTEM SPECIFICATION (shared contracts)

### 5.1 Recovery mode resolver

File: `src-tauri/src/infrastructure/recovery_engine/mode.rs`

```rust
pub(crate) enum RecoveryMode {
    Embedded(EmbeddedRecoveryContext),
    External,
    Unavailable(UnavailableReason),
}

pub(crate) struct EmbeddedRecoveryContext {
    pub app_data_dir: PathBuf,
    pub resource_dir: PathBuf,   // dunce-simplified, used for destination checks
    pub bin_dir: PathBuf,        // pg_process::bundled_bin_dir(&resource_dir)
    pub pgdata: PathBuf,         // pg_process::resolve_pgdata_dir(&app_data_dir)
    pub app_version: String,     // app.package_info().version.to_string()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum UnavailableReason { AppDataUnavailable, ResourceDirUnavailable, NoMigratorCredential }

/// Pure, unit-testable.
pub(crate) fn resolve_from(
    env_database_url: Option<&str>,
    app_data_dir: Option<PathBuf>,
    resource_dir: Option<PathBuf>,
    migrator_present: impl Fn(&Path) -> bool,
    app_version: String,
) -> RecoveryMode
```

Algorithm (exact order):
1. `env_database_url` is `Some(s)` with `!s.trim().is_empty()` → `External`.
2. `app_data_dir` is `None` → `Unavailable(AppDataUnavailable)`.
3. `resource_dir` is `None` → `Unavailable(ResourceDirUnavailable)`.
4. `!migrator_present(&app_data_dir)` → `Unavailable(NoMigratorCredential)`. Production passes `|dir| local_config::load_migrator_connection_info(dir).is_some()`.
5. Otherwise `Embedded(...)` with `resource_dir = dunce::simplified(&resource_dir).to_path_buf()`.

Tauri wrapper (in `commands/recovery.rs`, NOT in infrastructure):
```rust
fn resolve_recovery_mode(app: &AppHandle) -> RecoveryMode {
    let env = std::env::var(crate::infrastructure::db::DATABASE_URL_ENV).ok();
    let app_data = app.path().app_data_dir().ok();
    let resource = pg_process::bundled_resource_dir().or_else(|| app.path().resource_dir().ok());
    recovery_engine::mode::resolve_from(env.as_deref(), app_data, resource,
        |d| local_config::load_migrator_connection_info(d).is_some(),
        app.package_info().version.to_string())
}
```
The migrator password is never stored in the context; each operation calls `local_config::load_migrator_connection_info(&ctx.app_data_dir)` when it needs it and drops it at the end (it is `Zeroizing`).

### 5.2 Files and folders on disk (EMBEDDED)

```
<app_data_dir>  (= %APPDATA%\com.raqmenha.stockiha)
├── database.json, migrator.json            (WS-K, unchanged)
├── recovery.log                            (NEW, §4.6)
├── operator-backups\                       (NEW default destination)
│   └── GestStock-Backup-YYYYMMDD-HHMMSS\   (bundle, §5.3)
├── backups\                                (WS-K-5, untouched)
├── attachments\                            (asset source)
├── generated\customer-documents\           (asset source)
├── company-assets\                         (asset source)
└── recovery-asset-previous-<unix>\         (NEW, temporary during a live restore; deleted on success)
<pgdata parent>   (= <app_data_dir> when ASCII, else %ProgramData%\Stockiha)
├── pgdata\                                 (live cluster, never touched by the test)
└── restore-drill-<unix>-<pid>\             (NEW, isolated test cluster; deleted afterwards)
    ├── .stockiha-drill                     (marker file: "pid=<pid>\nstarted=<unix>\n")
    └── data\                               (initdb target)
```

Bundle staging inside the destination: `.<name>.staging-<attempt_id>-<nanos>` (hidden-by-convention leading dot). Copy staging inside a copy target: `.<name>.copying-<nanos>`.

### 5.3 Bundle format 2

Layout is identical to format 1 (`database.dump`, `manifest.json`, `checksums.sha256`, `schema-version.txt`, `application-version.txt`, `postgres-version.txt`, `attachments/`, `generated-documents/`, `company-assets/`).

`manifest.json` (compact JSON, existing fields preserved, new fields added):
```json
{
  "bundle_format_version": 2,
  "application_version": "0.5.0",
  "schema_version": "20260915120000",
  "created_at_unix": 1789480800,
  "database_dump_filename": "database.dump",
  "files": [ { "path": "...", "size_bytes": 123, "sha256": "..." } ],
  "backup_kind": "MANUAL",
  "dump_includes_privileges": true,
  "source": "EMBEDDED"
}
```
- `backup_kind` ∈ `MANUAL | DAILY | PRE_UPDATE | PRE_RESTORE`. Readers map anything else or missing to `UNKNOWN`.
- `schema-version.txt` = schema version + `\n`; `application-version.txt` = app version + `\n`.
- `checksums.sha256` = one line per manifest file entry plus `manifest.json`, format `<sha256>  <path>\n`, sorted by path (exactly what `rewrite_schema_metadata` already produces).
- Dump command (EMBEDDED):
  `pg_dump.exe --format=custom --no-owner --no-password --host <h> --port <p> --username <migrator user> --dbname <db> --file <stage>\database.dump` with env `PGPASSWORD=<migrator password>`, stdin/stdout null, stderr piped, console hidden.
- `postgres-version.txt` = trimmed stdout of `pg_dump.exe --version` (console hidden); major must be 18.

`backup_proof::validate_bundle` changes (step H3-05): accept `bundle_format_version` 1 or 2; `ManifestDe` gains `#[serde(default)] backup_kind: Option<String>`, `#[serde(default)] dump_includes_privileges: bool`, `#[serde(default)] created_at_unix: Option<u64>`; `ValidatedBundle` gains the same three fields. Format 1 is always treated as `dump_includes_privileges = false` even if the field says otherwise.

Restorable (in-app) ⇔ EMBEDDED mode ∧ format 2 ∧ `dump_includes_privileges` ∧ PG major 18 ∧ schema verdict ∈ {`SAME`, `OLDER`}.

### 5.4 Schema verdict

File: `src-tauri/src/infrastructure/recovery_engine/schema.rs`

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum SchemaVerdict { Same, Older, Newer, Unknown }

pub(crate) fn classify(bundle_version: &str, embedded_versions: &[i64]) -> SchemaVerdict
pub(crate) async fn applied_version(conn: &mut PgConnection) -> Result<i64, String>
   // SELECT max(version) FROM public._sqlx_migrations WHERE success
   // NULL → Err("no applied migrations")
pub(crate) async fn applied_history(conn: &mut PgConnection) -> Result<Vec<(i64, Vec<u8>)>, String>
   // SELECT version, checksum FROM public._sqlx_migrations WHERE success ORDER BY version
```
`classify`: parse `bundle_version.trim()` as i64 (fail → `Unknown`); `latest = *embedded_versions.last()`; equal → `Same`; greater → `Newer`; less and `embedded_versions.binary_search(&v).is_ok()` → `Older`; else `Unknown`.

Add to `infrastructure/schema_version.rs` (new, `pub(crate)`):
```rust
pub(crate) fn embedded_versions() -> Vec<i64>                     // MIGRATOR.migrations[..].version, ascending
pub(crate) fn embedded_checksums() -> Vec<(i64, Vec<u8>)>         // (version, checksum.to_vec())
```
History check (used by the isolated test): every restored `(version, checksum)` must appear in `embedded_checksums()` with byte-identical checksum; otherwise `DRILL_MIGRATION_HISTORY_MISMATCH`.

### 5.5 Destination resolution (EMBEDDED)

File: `src-tauri/src/infrastructure/recovery_engine/destination.rs`

```rust
pub(crate) const DEFAULT_DESTINATION_DIR: &str = "operator-backups";

pub(crate) struct ResolvedDestination { pub path: PathBuf, pub is_default: bool, pub used_fallback: bool }

pub(crate) enum DestinationPurpose { Manual, Automatic }

pub(crate) fn resolve(stored: Option<&str>, ctx: &EmbeddedRecoveryContext, purpose: DestinationPurpose)
    -> Result<ResolvedDestination, EngineError>

pub(crate) struct DestinationCheck { pub canonical: PathBuf, pub same_drive_warning: bool }
pub(crate) fn check_candidate(candidate: &str, ctx: &EmbeddedRecoveryContext) -> Result<DestinationCheck, EngineError>
```

`resolve` algorithm:
1. `stored` is `None` → default = `ctx.app_data_dir.join(DEFAULT_DESTINATION_DIR)`; `create_dir_all`; validate real directory (not symlink/reparse, is dir); return `{is_default: true, used_fallback: false}`. Failure → `BACKUP_DESTINATION_UNAVAILABLE`.
2. `stored` is `Some(p)`: try `create_dir_all(p)` + real-directory validation + writable probe (create and delete `p\.stockiha-write-probe`).
   - Success → `{is_default: false, used_fallback: false}`.
   - Failure and `purpose == Manual` → `Err(BACKUP_DESTINATION_UNAVAILABLE)`.
   - Failure and `purpose == Automatic` → resolve default as in step 1 and return `{is_default: true, used_fallback: true}`.

`check_candidate` algorithm (used when saving):
1. Trim; empty → `VALIDATION_ERROR`.
2. `canonical = canonicalize_best_effort(candidate)` (move the existing private helper from `application/recovery.rs` into this module as `pub(crate)`, keep the old call site compiling by calling the new one), then `dunce::simplified`.
3. For each forbidden root in `[ctx.pgdata, ctx.resource_dir, ctx.app_data_dir.join("pgdata")]`: canonicalize best-effort + dunce; if `canonical == root || canonical.starts_with(root)` → `BACKUP_DESTINATION_INSIDE_DATA_DIRECTORY` (reuse the existing error code for both data and install folders).
4. `create_dir_all(candidate)` then writable probe → failure → `BACKUP_DESTINATION_CREATE_FAILED`.
5. `same_drive_warning = drive_letter(canonical) == drive_letter(pgdata)` (move the existing `drive_letter` helper too; `None` on either side → `false`).

Path comparisons on Windows must be case-insensitive: compare `to_string_lossy().to_lowercase()` of both, component-wise via `Path::starts_with` on lowercase `PathBuf`s.

### 5.6 Database migration (created in WS-H-3, used through WS-H-6)

File: `src-tauri/migrations/20260915120000_ws_h_003_recovery_embedded_foundation.sql`
(If a migration newer than `20260915120000` exists on the branch when you start, use `<newest>+10000` instead and use that number everywhere this document says `20260915120000`.)

**Every statement must be safe to run twice.** Contents in this exact order:

```sql
-- WS-H-3: embedded backup & recovery foundation (used by WS-H-3..WS-H-6).
-- Fully idempotent by design: the WS-K-5 safe-upgrade integration fixture
-- re-applies the newest migration after deleting its bookkeeping row.
SET ROLE stockiha_owner;

-- 1. Permission vocabulary: add RESTORE_BACKUP_LIVE (guarded).
DO $$
DECLARE v_existing_check text;
BEGIN
    SELECT pg_get_expr(c.conbin, c.conrelid) INTO v_existing_check
    FROM pg_constraint c
    WHERE c.conrelid = 'iam.permissions'::regclass
      AND c.conname = 'permissions_code_valid' AND c.contype = 'c';
    IF v_existing_check IS NULL THEN
        RAISE EXCEPTION 'expected iam.permissions constraint permissions_code_valid is missing';
    END IF;
    IF position('RESTORE_BACKUP_LIVE' in v_existing_check) = 0 THEN
        ALTER TABLE iam.permissions DROP CONSTRAINT permissions_code_valid;
        EXECUTE format(
            'ALTER TABLE iam.permissions ADD CONSTRAINT permissions_code_valid CHECK ((%s) OR code = %L)',
            v_existing_check, 'RESTORE_BACKUP_LIVE');
    END IF;
END;
$$;

INSERT INTO iam.permissions (code, name)
VALUES ('RESTORE_BACKUP_LIVE', 'Replace live data with a backup')
ON CONFLICT (code) DO NOTHING;

INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM iam.roles r CROSS JOIN iam.permissions p
WHERE r.code IN ('ADMIN', 'SUPER_ADMIN') AND p.code = 'RESTORE_BACKUP_LIVE'
ON CONFLICT DO NOTHING;

-- 2. Operation vocabulary.
ALTER TABLE operations.recovery_attempts
    DROP CONSTRAINT IF EXISTS recovery_attempts_operation_valid;
ALTER TABLE operations.recovery_attempts
    ADD CONSTRAINT recovery_attempts_operation_valid CHECK (
        operation_code IN ('CREATE_BACKUP','VALIDATE_BACKUP','VERIFY_RESTORE','AUTO_BACKUP','RESTORE_LIVE'));

CREATE UNIQUE INDEX IF NOT EXISTS recovery_attempts_any_create_bundle_unique
    ON operations.recovery_attempts (bundle_identifier)
    WHERE operation_code IN ('CREATE_BACKUP', 'AUTO_BACKUP');

-- 3. Restore event log (no FKs: users differ between backup and replaced data).
CREATE TABLE IF NOT EXISTS operations.restore_events (
    id                        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    occurred_at               timestamptz NOT NULL DEFAULT now(),
    restore_mode              text NOT NULL CHECK (restore_mode IN ('LIVE','FRESH_INSTALL')),
    bundle_identifier         text NOT NULL CHECK (length(bundle_identifier) BETWEEN 1 AND 255),
    backup_kind               text NOT NULL,
    bundle_schema_version     text NOT NULL,
    restored_schema_version   text NOT NULL,
    migrated_forward          boolean NOT NULL,
    actor_username            text,
    workstation_id            text,
    safety_bundle_identifier  text
);
REVOKE ALL ON operations.restore_events FROM PUBLIC;
REVOKE ALL ON operations.restore_events FROM stockiha_runtime;
GRANT SELECT ON operations.restore_events TO stockiha_backup;
```

4. `CREATE OR REPLACE FUNCTION operations.begin_recovery_attempt(text, text, text, text)`: copy the body **verbatim** from `20260803193000_r6_001_recovery_authorization_audit.sql` and change only the CASE to:
```sql
    v_permission_code := CASE p_operation_code
        WHEN 'CREATE_BACKUP' THEN 'CREATE_BACKUP_BUNDLE'
        WHEN 'VALIDATE_BACKUP' THEN 'VALIDATE_BACKUP_BUNDLE'
        WHEN 'RESTORE_LIVE' THEN 'RESTORE_BACKUP_LIVE'
        ELSE NULL
    END;
```
and the replay-conflict condition to treat `RESTORE_LIVE` like `VALIDATE_BACKUP` (bundle identifier must match): the condition `v_existing.operation_code <> 'CREATE_BACKUP' AND v_existing.bundle_identifier <> btrim(p_bundle_identifier)` already does that — leave it as is.

5. `CREATE OR REPLACE FUNCTION operations.complete_recovery_attempt(text, bigint, boolean, text, jsonb)`: copy verbatim from the same file; extend its CASE identically (`RESTORE_LIVE` → `RESTORE_BACKUP_LIVE`).

6. New `operations.begin_automatic_backup_attempt(p_session_token text, p_request_id text, p_bundle_identifier text) RETURNS jsonb`, `SECURITY DEFINER`, `SET search_path = pg_catalog`. Identical to `begin_recovery_attempt` except: no operation parameter (always `'AUTO_BACKUP'`); caller resolved with `SELECT user_id, workstation_id INTO ... FROM iam.resolve_session(p_session_token)` (any valid session); replay conflict = `actor_id` differs OR `operation_code <> 'AUTO_BACKUP'`. Returns the same envelope keys (`attempt_id`, `is_replay`, `status`, `bundle_identifier`, `error_code`, `result`, `current_schema_version`). Check the exact column names `iam.resolve_session` returns in `20260731130000_cash_session_lifecycle.sql` (latest definition) before writing.

7. New `operations.complete_automatic_backup_attempt(p_session_token text, p_attempt_id bigint, p_succeeded boolean, p_error_code text, p_result_json jsonb) RETURNS jsonb`: identical to `complete_restore_verification_attempt` except operation code `'AUTO_BACKUP'` and `iam.resolve_session` instead of `resolve_session_with_permission`.

8. New `operations.get_backup_status(p_session_token text) RETURNS jsonb` (`STABLE SECURITY DEFINER`, any valid session via `iam.resolve_session`):
```sql
    RETURN jsonb_build_object(
      'last_success_at', (SELECT max(completed_at) FROM operations.recovery_attempts
                          WHERE status = 'SUCCEEDED' AND operation_code IN ('CREATE_BACKUP','AUTO_BACKUP')),
      'last_success_bundle', (SELECT bundle_identifier FROM operations.recovery_attempts
                          WHERE status = 'SUCCEEDED' AND operation_code IN ('CREATE_BACKUP','AUTO_BACKUP')
                          ORDER BY completed_at DESC, id DESC LIMIT 1),
      'last_failure_at', (SELECT max(completed_at) FROM operations.recovery_attempts
                          WHERE status = 'FAILED' AND operation_code IN ('CREATE_BACKUP','AUTO_BACKUP')),
      'last_failure_code', (SELECT error_code FROM operations.recovery_attempts
                          WHERE status = 'FAILED' AND operation_code IN ('CREATE_BACKUP','AUTO_BACKUP')
                          ORDER BY completed_at DESC, id DESC LIMIT 1),
      'last_restore_at', (SELECT max(occurred_at) FROM operations.restore_events),
      'last_restore_bundle', (SELECT bundle_identifier FROM operations.restore_events
                          ORDER BY occurred_at DESC, id DESC LIMIT 1)
    );
```
(Timestamps serialize as ISO-8601 strings; nulls stay JSON null.)

9. New `operations.get_recovery_capabilities(p_session_token text) RETURNS jsonb` (`STABLE SECURITY DEFINER`), same shape as `inventory.get_capabilities` in `20260811120000_r8_d_inventory_read_side.sql`: resolve with `iam.resolve_session`, return booleans `can_create_backup` (CREATE_BACKUP_BUNDLE), `can_validate_backup` (VALIDATE_BACKUP_BUNDLE), `can_verify_restore` (VERIFY_BACKUP_RESTORE), `can_restore_live` (RESTORE_BACKUP_LIVE), each via the `EXISTS (user_roles ⨝ role_permissions ⨝ permissions)` pattern.

10. Grants:
```sql
REVOKE ALL ON FUNCTION operations.begin_automatic_backup_attempt(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.complete_automatic_backup_attempt(text, bigint, boolean, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.get_backup_status(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.get_recovery_capabilities(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION operations.begin_automatic_backup_attempt(text, text, text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION operations.complete_automatic_backup_attempt(text, bigint, boolean, text, jsonb) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION operations.get_backup_status(text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION operations.get_recovery_capabilities(text) TO stockiha_runtime;
-- begin/complete_recovery_attempt keep their existing grants (CREATE OR REPLACE preserves them).
```

11. Schema state:
```sql
UPDATE operations.schema_state SET migration_version = 20260915120000, updated_at = now() WHERE singleton;
RESET ROLE;
```

What this migration must NOT do: change `recovery_settings`, the restore toggle trigger, existing grants, or any business schema.

### 5.7 Error codes

Add to Rust `ErrorCode` (`src-tauri/src/error.rs`), `AppError`, the `Debug`/`Display`/`From<AppError> for IpcError` match arms, `application::recovery::stable_error_code`, and to the TS `BACKEND_ERROR_CODES` + `ERROR_MESSAGE_KEYS` (all in the same commit):

| ErrorCode (IPC) | AppError variant | i18n key | English text (fr/ar in §H7) | When |
|---|---|---|---|---|
| `RECOVERY_UNAVAILABLE` | `RecoveryUnavailable { diagnostic }` | `errors.recoveryUnavailable` | "Backup and restore are not available on this computer's setup. Contact your supplier." | Mode is UNAVAILABLE, or a new-only command in EXTERNAL mode |
| `BACKUP_DESTINATION_UNAVAILABLE` | `BackupDestinationUnavailable { diagnostic }` | `errors.backupDestinationUnavailable` | "The backup folder is not available. Plug in the drive or choose another folder." | Manual backup and stored destination unusable |
| `BACKUP_NOT_RESTORABLE` | `BackupNotRestorable { diagnostic }` | `errors.backupNotRestorable` | "This backup cannot be restored by this version of Stockiha." | Format 1, no privileges, NEWER/UNKNOWN schema, history mismatch |
| `RESTORE_TEST_FAILED` | `RestoreTestFailed { diagnostic }` | `errors.restoreTestFailed` | "The backup could not be restored in the safe test. Your data was not changed." | Isolated test failed |
| `FRESH_RESTORE_NOT_ALLOWED` | `FreshRestoreNotAllowed { diagnostic }` | `errors.freshRestoreNotAllowed` | "Restoring here is only possible on a new installation with no user accounts." | `iam.users` not empty |
| `BACKUP_COPY_FAILED` | `BackupCopyFailed { diagnostic }` | `errors.backupCopyFailed` | "The backup could not be copied. Nothing was left behind in the target folder." | Copy failure |
| `INSUFFICIENT_DISK_SPACE` | `InsufficientDiskSpace { diagnostic }` | `errors.insufficientDiskSpace` | "There is not enough free disk space for this operation." | Any space preflight failure |

All `diagnostic` values are detail codes from §5.7.1, never free text. `creation_audit_error_code` in `recovery_creation.rs` must map the new variants to their codes (it already passes through `BACKUP_*` diagnostics).

#### 5.7.1 Detail codes (audit `error_code` and outcome-event `errorCode`)

`BACKUP_PREFLIGHT_BINARIES_MISSING`, `BACKUP_PG_DUMP_VERSION_FAILED`, `BACKUP_PG_DUMP_VERSION_MISMATCH`, `BACKUP_SCHEMA_VERSION_UNREADABLE`, `BACKUP_PG_DUMP_FAILED`, `BACKUP_STAGE_FAILED`, `BACKUP_METADATA_WRITE_FAILED`, `BACKUP_VALIDATION_AFTER_CREATE_FAILED`, `BACKUP_PUBLISH_FAILED`, `BACKUP_IDENTIFIER_COLLISION`, `BACKUP_DESTINATION_UNAVAILABLE`, `BACKUP_INSUFFICIENT_SPACE`, `BACKUP_ASSET_COPY_FAILED`,
`BACKUP_BUNDLE_NOT_A_DIRECTORY`, `BACKUP_BUNDLE_NAME_INVALID`, `BACKUP_INTEGRITY_INVALID` (prefix; the `backup_proof` code is appended after `:` only in `recovery.log`, never in IPC),
`BACKUP_FORMAT_NOT_RESTORABLE`, `BACKUP_SCHEMA_NEWER_THAN_APP`, `BACKUP_SCHEMA_UNKNOWN`,
`DRILL_PATH_NOT_ASCII`, `DRILL_INSUFFICIENT_SPACE`, `DRILL_INITDB_FAILED`, `DRILL_NO_FREE_PORT`, `DRILL_SERVER_START_FAILED`, `DRILL_ROLE_SETUP_FAILED`, `DRILL_RESTORE_FAILED`, `DRILL_MIGRATION_HISTORY_MISMATCH`, `DRILL_FORWARD_MIGRATION_FAILED`, `DRILL_RECONCILIATION_FAILED`, `DRILL_SERVER_STOP_FAILED`,
`RESTORE_CONFIRMATION_INVALID`, `FRESH_RESTORE_NOT_ALLOWED`, `RESTORE_JOURNALS_UNBALANCED`, `RESTORE_SAFETY_BACKUP_FAILED`, `RESTORE_DATABASE_BUSY`, `RESTORE_RESET_FAILED`, `RESTORE_PG_RESTORE_FAILED`, `RESTORE_FORWARD_MIGRATION_FAILED`, `RESTORE_VERIFY_SCHEMA_FAILED`, `RESTORE_VERIFY_TOTALS_MISMATCH`, `RESTORE_ASSET_COPY_FAILED`, `RESTORE_ROLLBACK_FAILED`,
`COPY_SOURCE_INVALID`, `COPY_TARGET_INVALID`, `COPY_TARGET_EXISTS`, `COPY_IO_FAILED`, `COPY_VALIDATION_FAILED`.

Mapping to IPC codes: `BACKUP_*` during creation → `BACKUP_CREATION_FAILED` except `BACKUP_DESTINATION_UNAVAILABLE`/`BACKUP_INSUFFICIENT_SPACE` (→ their own codes); `BACKUP_BUNDLE_*`/`BACKUP_INTEGRITY_INVALID` → `BACKUP_VALIDATION_FAILED`; `BACKUP_FORMAT_NOT_RESTORABLE`/`BACKUP_SCHEMA_*`/`DRILL_MIGRATION_HISTORY_MISMATCH` → `BACKUP_NOT_RESTORABLE`; other `DRILL_*` → `RESTORE_TEST_FAILED` (`DRILL_INSUFFICIENT_SPACE` → `INSUFFICIENT_DISK_SPACE`); `COPY_*` → `BACKUP_COPY_FAILED`; `FRESH_RESTORE_NOT_ALLOWED` → `FRESH_RESTORE_NOT_ALLOWED`; `RESTORE_*` (all others) → `PRECONDITION_FAILED` (they only ever travel inside outcome events, not IPC errors, except `RESTORE_CONFIRMATION_INVALID` → `VALIDATION_ERROR`).

Implement this as one function `recovery_engine::errors::EngineError` (a struct holding `code: &'static str`, `log_detail: String`) with `fn to_app_error(&self) -> AppError`. `log_detail` goes to `recovery.log` only.

### 5.8 IPC contract (all commands)

`sessionToken` is always a top-level argument (existing pattern). Requests are camelCase JSON. "Lease" = `RecoveryOperationLease` must be held.

| Command | Sub-plan | Args | Returns | Auth | Modes | Lease |
|---|---|---|---|---|---|---|
| `get_recovery_mode` | H3 | — | `{ mode: 'EMBEDDED'\|'EXTERNAL'\|'UNAVAILABLE', unavailableReason: string\|null }` | none | all | no |
| `get_recovery_capabilities` | H3 | `sessionToken` | `{ mode, canCreateBackup, canValidateBackup, canVerifyRestore, canRestoreLive }` | session | all (UNAVAILABLE → all false) | no |
| `get_backup_status` | H3 | `sessionToken` | `{ lastSuccessAt, lastSuccessBundle, lastFailureAt, lastFailureCode, lastRestoreAt, lastRestoreBundle }` (ISO strings or null) | session | EMBEDDED, EXTERNAL | no |
| `get_backup_destination_setting` (changed) | H3 | `sessionToken` | `{ path, effectivePath, isDefault, available, sameDriveWarning }` | CREATE_BACKUP_BUNDLE | EXTERNAL: `effectivePath = path ?? env STOCKIHA_BACKUP_ROOT ?? null`, `isDefault=false`, `available=true`, `sameDriveWarning=false` | no |
| `update_backup_destination_setting` (changed) | H3 | `sessionToken`, `request {path}` | `{ path, sameDriveWarning }` (unchanged shape) | CREATE_BACKUP_BUNDLE | EMBEDDED uses §5.5 `check_candidate`; EXTERNAL unchanged | no |
| `create_operator_backup` (changed) | H3 | `sessionToken`, `request {requestId}` | `OperatorBackupCreationResult` (§5.8.1) | CREATE_BACKUP_BUNDLE | EMBEDDED new engine; EXTERNAL unchanged | yes |
| `validate_operator_backup` (changed) | H3 | `sessionToken`, `request {requestId, bundlePath}` | `OperatorBackupValidationResult` | VALIDATE_BACKUP_BUNDLE | EMBEDDED new engine (any folder); EXTERNAL unchanged | yes |
| `list_backups` | H4 | `sessionToken` | `{ destination: string\|null, items: BackupListItem[] }` | VALIDATE_BACKUP_BUNDLE | EMBEDDED, EXTERNAL | no |
| `copy_backup_to` | H4 | `sessionToken`, `request {requestId, bundlePath, targetDirectory}` | `{ copiedPath, totalBytes }` | CREATE_BACKUP_BUNDLE | EMBEDDED, EXTERNAL | yes |
| `verify_operator_backup_restore` (changed) | H4 | `sessionToken`, `request {requestId, bundlePath, confirmed}` | `OperatorRestoreVerificationResult` | VERIFY_BACKUP_RESTORE (+policy ON) | EMBEDDED isolated test; EXTERNAL unchanged | yes |
| `restore_backup_live` | H5 | `sessionToken`, `request {requestId, bundlePath, confirmationText}` | `{ started: true }` then events | RESTORE_BACKUP_LIVE | EMBEDDED only | yes (moved into worker thread) |
| `inspect_backup_for_fresh_install` | H5 | `request {bundlePath}` | `BackupListItem` | none, but `iam.users` must be empty | EMBEDDED only | yes |
| `restore_backup_fresh_install` | H5 | `request {bundlePath}` | `{ started: true }` then events | none, but `iam.users` must be empty | EMBEDDED only | yes (worker thread) |
| `restart_after_recovery` | H5 | — | never returns (process restarts) | none | all | no |
| `run_automatic_backup` | H6 | `sessionToken`, `request {requestId, reason: 'DAILY'\|'PRE_UPDATE'}` | `{ status: 'CREATED'\|'SKIPPED', skipReason: 'MODE_UNSUPPORTED'\|'NOT_DUE'\|'BUSY'\|null, result: OperatorBackupCreationResult\|null, usedFallbackDestination: boolean }` | session | EMBEDDED (EXTERNAL → SKIPPED/MODE_UNSUPPORTED) | yes (DAILY: busy → SKIPPED/BUSY; PRE_UPDATE: busy → error `RECOVERY_OPERATION_IN_PROGRESS`) |

Unchanged: `get_restore_verification_setting`, `update_restore_verification_setting`.

#### 5.8.1 Result DTOs (Rust `domain/recovery.rs` + TS `recoveryDto.ts`)

Extend `OperatorBackupValidationResult` (also used for creation) with **optional** fields so replaying an old stored result still deserializes:
```rust
#[serde(default, skip_serializing_if = "Option::is_none")] pub(crate) format_version: Option<u32>,
#[serde(default, skip_serializing_if = "Option::is_none")] pub(crate) backup_kind: Option<String>,
#[serde(default, skip_serializing_if = "Option::is_none")] pub(crate) schema_verdict: Option<String>, // SAME|OLDER|NEWER|UNKNOWN
#[serde(default, skip_serializing_if = "Option::is_none")] pub(crate) restorable: Option<bool>,
#[serde(default, skip_serializing_if = "Option::is_none")] pub(crate) created_at_utc: Option<String>, // RFC3339
#[serde(default, skip_serializing_if = "Option::is_none")] pub(crate) used_fallback_destination: Option<bool>,
```
TS: same names in camelCase, all `?:`.

Extend `OperatorRestoreVerificationResult` with optional `schemaVerdict?: string`, `migratedForward?: boolean`, `cleanupPending?: boolean`. In EMBEDDED mode `temporaryDatabaseCleaned` means "the test server was stopped".

`BackupListItem` (new, Rust `#[serde(rename_all = "camelCase")]`):
```ts
interface BackupListItem {
  bundleIdentifier: string;       // folder name
  path: string;                   // absolute folder path
  createdAtUtc: string | null;    // from manifest created_at_unix, else parsed from the name
  backupKind: 'MANUAL' | 'DAILY' | 'PRE_UPDATE' | 'PRE_RESTORE' | 'UNKNOWN';
  formatVersion: number | null;
  schemaVersion: string | null;
  schemaVerdict: 'SAME' | 'OLDER' | 'NEWER' | 'UNKNOWN';
  restorable: boolean;
  totalBytes: number;             // sum of manifest size_bytes (no hashing)
  manifestReadable: boolean;
}
```

### 5.9 Progress events (WS-H-5)

- `recovery-restore-progress`, payload `{ step: RestoreStep, status: 'RUNNING'|'DONE'|'FAILED'|'SKIPPED', detailCode: string|null }`.
- `RestoreStep` (serialized SCREAMING_SNAKE_CASE, order fixed): `VALIDATE_BACKUP`, `PREFLIGHT`, `TEST_RESTORE`, `SAFETY_BACKUP`, `STOP_CONNECTIONS`, `REPLACE_DATA`, `UPDATE_SCHEMA`, `VERIFY`, `RESTORE_FILES`, `RECORD`, `ROLLBACK`, `RESTART`.
  Fresh-install mode emits `SAFETY_BACKUP` as `SKIPPED`.
- `recovery-restore-outcome`, emitted exactly once:
```ts
type RestoreOutcome =
  | { outcome: 'SUCCEEDED'; bundleIdentifier: string; migratedForward: boolean }
  | { outcome: 'ABORTED_BEFORE_CHANGE'; errorCode: string; restartRequired: boolean }
  | { outcome: 'ROLLED_BACK'; errorCode: string; safetyBundleIdentifier: string | null }
  | { outcome: 'ROLLBACK_FAILED'; errorCode: string; safetyBundlePath: string | null; logPath: string };
```
Event payload structs derive `Serialize` with `#[serde(tag = "outcome", rename_all = "SCREAMING_SNAKE_CASE")]` for the enum and `#[serde(rename_all = "camelCase")]` on inner fields (use `#[serde(rename_all_fields = "camelCase")]` if the serde version supports it; otherwise annotate each field with `#[serde(rename = "...")]`).

### 5.10 End-to-end flow traces

**F1 — Manual backup (EMBEDDED)**
User clicks "Create backup" → `RecoverySettingsScreen.create()` → `createOperatorBackup(token, {requestId})` → IPC `create_operator_backup` → acquire lease → `resolve_recovery_mode` = Embedded → `recovery_embedded::create_backup(pool, token, ctx, request, BackupKind::Manual)`:
1. `begin_recovery_attempt(token, requestId, 'CREATE_BACKUP', candidate_name)` (candidate = `bundle_directory_name(now_utc)`); status `SUCCEEDED` → replay result; `FAILED` → error; `STARTED` → continue. On `IdempotencyConflict` for a non-replay (unique index hit) → sleep 1 s, new candidate, retry at most 3 times, then `BACKUP_IDENTIFIER_COLLISION`.
2. Read stored destination (`operations.get_backup_destination_setting`) → `destination::resolve(.., Manual)`.
3. `spawn_blocking` → `engine::backup::create_bundle(ctx, migrator, destination, name, kind, attempt_id)`:
   preflight binaries → `pg_dump --version` (major 18) → connect as migrator, read `applied_version`, `pg_database_size` → free space ≥ 2×db size + 50 MB on destination volume → stage dir → `backup_proof::create_backup_bundle(stage, time_from_name, pg_version, inputs, |out| run_pg_dump_embedded(...))` → `finalize_bundle_metadata(...)` → `validate_bundle(staged)` → rename to final (refuse if exists) → `validate_bundle(final)` → build result.
4. `complete_recovery_attempt(token, attempt_id, true, NULL, result_json)` → return result. On any error: `complete_recovery_attempt(..., false, code, NULL)` → return mapped IpcError. Staging dir removed on every path (guard).
→ UI shows success banner + result grid; status line refreshes.

**F2 — Validate (EMBEDDED)**: same audit pattern with `'VALIDATE_BACKUP'`; path check = §H3-07 `canonical_bundle_anywhere`; `validate_bundle`; verdict + restorable computed; result returned.

**F3 — Test backup (EMBEDDED, H4)**: `begin_restore_verification_attempt` (policy trigger applies) → isolated drill (§H4-04) → `complete_restore_verification_attempt`.

**F4 — Real restore (EMBEDDED, H5)**: confirm dialog → takeover screen subscribes to events → invokes `restore_backup_live` → command validates request, checks mode, checks confirmation, acquires lease, begins audit (`RESTORE_LIVE`), spawns worker thread holding lease + pool clone + pg handle → returns `{started:true}` → worker runs steps (§H5-03) emitting progress → outcome event → success: stop server, restart; failure: takeover screen shows outcome with "Restart Stockiha" button → `restart_after_recovery`.

**F5 — New PC (EMBEDDED, H5)**: first-run embedded setup completes as today → app restarts → `get_setup_status.initialized == false` → `SetupScreen` → "Restore from a backup instead" (only if `get_recovery_mode` = EMBEDDED) → `FreshInstallRestoreScreen` → pick folder → `inspect_backup_for_fresh_install` → details shown → confirm → takeover screen → `restore_backup_fresh_install` → same worker with fresh-install options → restart → Login screen with the old accounts.

**F6 — Update (H6)**: user clicks install in `UpdateBanner` → `performUpdate`: `download()` → `runAutomaticBackup(token, {reason:'PRE_UPDATE'})` → `CREATED` or `SKIPPED/MODE_UNSUPPORTED` → `prepare_for_update_install` → `install()`. Any backup error → stop; nothing stopped; banner shows `update.backupFailed`.

**F7 — Daily (H6)**: `AuthenticatedApp` mounts → 60 s timer (once per app process) → `runAutomaticBackup(token, {reason:'DAILY'})` → backend checks `get_backup_status.last_success_at` < now-20h → creates → retention → silent. Failures are visible later via the status line.

---

## PART 6 — DEPENDENCY AND ORDER

```
H3-01 mode resolver ─┬─> H3-06 dispatcher/commands ─┬─> H3-09 frontend ─> H3-10 tests/marker
H3-02 migration ─────┤                              │
H3-03 schema helpers ┤                              │
H3-04 destination ───┤                              │
H3-05 bundle v2 ─────┴─> H3-07 backup+validate ─────┘
H3-08 startup gating (independent after H3-01)
                     │
                     ▼ (Owner accepts WS-H-3 on Windows)
H4-01 list ─┐
H4-02 copy ─┼─> H4-05 commands ─> H4-06 frontend (screen restructure) ─> H4-07 tests
H4-03 drill cluster helpers ─> H4-04 isolated drill ─┘
H4-08 startup sweep (after H4-03)
                     │
                     ▼ (Owner accepts WS-H-4)
H5-01 engine restore primitives ─> H5-02 fault hooks ─> H5-03 worker ─> H5-04 commands ─> H5-05 takeover UI ─> H5-06 fresh-install UI ─> H5-07 tests
                     │
                     ▼ (Owner accepts WS-H-5)
H6-01 automatic backup backend ─> H6-02 retention ─> H6-03 command ─> H6-04 update flow ─> H6-05 daily trigger + status warning ─> H6-06 tests
                     │
                     ▼ (Owner accepts WS-H-6)
H7 translations + docs (depends on every screen being final)
```

Within a sub-plan, steps marked independent above may be done in any order, but the commit must contain all of them. Nothing in a later sub-plan may start before the Owner accepts the earlier one on a real installed build.

---

## PART 7 — WS-H-3: EMBEDDED BACKUP FOUNDATION

**Goal:** On an installed build, an administrator can see the backup screen, see where backups go (default folder shown), change the folder, create a backup, and validate any backup folder (including one on a USB stick). Users without backup permissions do not see the screen. The developer `run.bat` workflow behaves exactly as before.

**Out of scope for H3:** list, copy, isolated test, real restore, automatic backups, Arabic wording quality (Arabic strings may be English copies marked `// TODO(WS-H-7)`; French must be real French).

### H3-01 — Recovery mode resolver
- **Objective:** one function decides EMBEDDED / EXTERNAL / UNAVAILABLE.
- **Files:** create `src-tauri/src/infrastructure/recovery_engine/mod.rs` (declares `pub(crate) mod mode; pub(crate) mod schema; pub(crate) mod destination; pub(crate) mod bundle; pub(crate) mod tools; pub(crate) mod errors; pub(crate) mod log;`), create `recovery_engine/mode.rs`; edit `src-tauri/src/infrastructure/mod.rs` to add `pub(crate) mod recovery_engine;`.
- **Change / logic:** implement §5.1 exactly. Also create `recovery_engine/log.rs` with `pub(crate) fn append(app_data_dir: &Path, operation: &str, line: &str)` (format §4.6; errors ignored) and `recovery_engine/errors.rs` with `EngineError { code: &'static str, log_detail: String }`, `impl EngineError { pub(crate) fn new(code, detail) -> Self; pub(crate) fn to_app_error(&self) -> AppError }` implementing the mapping table of §5.7.1.
- **Depends on:** nothing.
- **Expected:** `cargo check` passes; module compiles with no Tauri imports.
- **Pitfalls:** do not import `tauri` in `recovery_engine`; treat an env var containing only spaces as unset.
- **Edge cases:** `migrator.json` exists but is corrupt → `load_migrator_connection_info` returns `None` → UNAVAILABLE(NoMigratorCredential).
- **Verify:** unit tests in `mode.rs`: (a) env set → External even when migrator present; (b) env `"  "` + all present → Embedded; (c) no app data → AppDataUnavailable; (d) no resource → ResourceDirUnavailable; (e) migrator absent → NoMigratorCredential; (f) Embedded context has `bin_dir` ending `postgres\win64\bin` (use `ends_with(Path::new("postgres").join("win64").join("bin"))`). `errors.rs` test: every code in §5.7.1 maps to the IPC code in the mapping table.

### H3-02 — Database migration + fixture repair
- **Objective:** add every DB object WS-H-3..6 needs, and keep the WS-K-5 integration test valid.
- **Files:** create `src-tauri/migrations/20260915120000_ws_h_003_recovery_embedded_foundation.sql` (§5.6); edit `src-tauri/src/infrastructure/safe_upgrade.rs` test module only: function `rewind_latest_migration`.
- **Change / logic:**
  1. Write the migration exactly per §5.6.
  2. In `rewind_latest_migration`, delete the `DROP FUNCTION IF EXISTS sales.confirm_cash_sale(...)` statement and its comment; keep only `DELETE FROM _sqlx_migrations WHERE version = $1`. Replace the doc comment with: "The newest migration (WS-H-3 onward) is written to be fully idempotent, so deleting its bookkeeping row alone is an honest 'one migration behind' fixture. Any future migration that becomes the newest MUST stay idempotent, or this fixture must undo its non-idempotent statements."
  3. Add a new non-ignored Rust test in `src-tauri/src/infrastructure/schema_version.rs` tests: `newest_migration_keeps_schema_state_current` — read `CARGO_MANIFEST_DIR/migrations`, take the lexicographically greatest `*.sql` file name, take its first 14 characters as the version, assert the file text contains `migration_version = <version>`. Panic message: "The newest migration <file> must end with `UPDATE operations.schema_state SET migration_version = <version>, updated_at = now() WHERE singleton;` (see WS-H plan R4)."
  4. Add `src-tauri/tests/recovery/ws_h_003_recovery_foundation_integration.sql` and register it in `src-tauri/tests/run_current_sql_suites.sh` next to the r6_002 suite. Model it on `r6_002_restore_verification_authorization_integration.sql` (users/roles/`iam.application_sessions` setup). Assertions: ADMIN has `RESTORE_BACKUP_LIVE`, CASHIER does not; `get_recovery_capabilities` true/false per role; cashier can `begin_automatic_backup_attempt` and `complete_automatic_backup_attempt` its own attempt; another user completing it raises SQLSTATE 42501; replay returns `is_replay=true`; `begin_recovery_attempt(...,'RESTORE_LIVE',...)` denied for cashier (42501), allowed for admin; `get_backup_status` returns `last_success_at` after a succeeded AUTO_BACKUP; runtime cannot `SELECT` from `operations.restore_events` (expect `insufficient_privilege`); two `CREATE_BACKUP`/`AUTO_BACKUP` rows with the same bundle identifier raise 23505; `operations.schema_state.migration_version = 20260915120000`; the migration is re-runnable: if `run_current_sql_suites.sh` can include a file (it uses `psql`), add a second `\i` of the migration file at the end of the suite and assert no error; if the runner cannot do that, state so in the report — idempotency is then proven by the WS-K-5 ignored tests, which re-apply the newest migration.
  5. Regenerate `scripts/recovery/stockiha_bootstrap_roles_and_grants.sql` with `scripts/recovery/generate-bootstrap-roles-and-grants.ps1` if a migrated dev database is available; otherwise list "bootstrap grants script not regenerated — needs dev DB" under Pending in the report.
- **Depends on:** nothing.
- **Expected:** fresh embedded setup applies 153 migrations; `schema_state` = new version.
- **Pitfalls:** `CREATE OR REPLACE FUNCTION` must keep the exact parameter list and return type or PostgreSQL creates an overload/fails; `SET search_path = pg_catalog` means every object must be schema-qualified inside new functions; the permission CHECK guard must not duplicate the code on a second run; do not use `CREATE TABLE ... ` without `IF NOT EXISTS`.
- **Edge cases:** a database where `SUPER_ADMIN` does not exist → the INSERT simply selects nothing (fine); `CEO` role absent → not referenced.
- **Verify:** `cargo test --lib newest_migration_keeps_schema_state_current`; on Windows `cargo test --lib -- --ignored safe_upgrade` (all three must pass); `embedded_setup` end-to-end ignored test prints `embedded=153 applied_rows=153 verdict=UpToDate`; SQL suite passes.

### H3-03 — Schema helpers
- **Objective:** authoritative schema version and verdict.
- **Files:** `src-tauri/src/infrastructure/schema_version.rs` (add `embedded_versions`, `embedded_checksums`), create `recovery_engine/schema.rs` (§5.4).
- **Logic:** as §5.4. `embedded_checksums` uses `m.checksum.to_vec()`.
- **Depends on:** H3-01 (module exists).
- **Expected:** pure functions unit-tested.
- **Pitfalls:** `MIGRATOR.migrations` may include down-migrations in some SQLx configs — filter `m.migration_type.is_up_migration()` if that method exists in the pinned SQLx version; otherwise note that this repo has only up migrations (all files are `*.sql` without `.up/.down`).
- **Edge cases:** bundle version `"0"` (legacy transient) → `Unknown`; `" 20260915120000\n"` → trimmed → parsed.
- **Verify:** tests for Same/Older/Newer/Unknown (non-number, older-not-in-list, empty list → `Unknown`, never panic).

### H3-04 — Destination rules
- **Objective:** default folder, safe saving, fallback for automatic backups.
- **Files:** create `recovery_engine/destination.rs` (§5.5); edit `application/recovery.rs`: move `canonicalize_best_effort` and `drive_letter` into `destination.rs` as `pub(crate)` and make the old call sites call the moved functions (bodies unchanged).
- **Logic:** §5.5 exactly. Writable probe: `OpenOptions::new().write(true).create_new(true).open(dir.join(".stockiha-write-probe"))`; if `AlreadyExists`, remove it and retry once; always `remove_file` after.
- **Depends on:** H3-01.
- **Expected:** functions unit-tested with temp directories.
- **Pitfalls:** canonicalizing a Windows path returns `\\?\` form — always `dunce::simplified` before comparing or storing; never store the canonical form in the DB — store the user's trimmed path (the existing SQL function does that).
- **Edge cases:** candidate is a file, not a folder → `BACKUP_DESTINATION_CREATE_FAILED`; candidate is a drive root `E:\` → allowed; candidate equals app data dir itself → allowed (only `pgdata` and resource dir are forbidden); stored path on an unplugged USB → Manual error / Automatic fallback.
- **Verify:** unit tests: default created; inside `pgdata` rejected; inside resource dir rejected; case-insensitive comparison (`...\PGDATA\x` rejected when pgdata is `...\pgdata`) — gate this assertion with `#[cfg(windows)]`; unusable stored path → Manual `Err(BACKUP_DESTINATION_UNAVAILABLE)`, Automatic `used_fallback == true`.

### H3-05 — Bundle format 2 + tools
- **Objective:** write and read format 2 bundles; spawn tools correctly.
- **Files:** `src-tauri/src/infrastructure/backup_proof/mod.rs` (validator changes only); create `recovery_engine/bundle.rs`, `recovery_engine/tools.rs`.
- **Logic:**
  - `backup_proof`: add `pub(crate) const SUPPORTED_BUNDLE_FORMAT_VERSIONS: [u32; 2] = [1, 2];` and change the format check in `validate_bundle` to `if !SUPPORTED_BUNDLE_FORMAT_VERSIONS.contains(&manifest.bundle_format_version)`. Extend `ManifestDe` and `ValidatedBundle` per §5.3. Keep `BUNDLE_FORMAT_VERSION = 1` (legacy writer unchanged). Add test: format 2 manifest validates; format 3 rejected; format 1 with `dump_includes_privileges: true` reports `false`.
  - `tools.rs`:
    - `pub(crate) fn pg_tool_version(bin_dir, exe_name) -> Result<(String, u32), EngineError>` — runs `<exe> --version` with `hide_console_window`, parses with `backup_proof::parse_pg_dump_major_version`, requires 18 (`BACKUP_PG_DUMP_VERSION_MISMATCH` otherwise, `BACKUP_PG_DUMP_VERSION_FAILED` on spawn/parse error).
    - `pub(crate) fn run_pg_dump(bin_dir, info: &MigratorConnectionInfo, out: &Path) -> Result<(), EngineError>` — §5.3 command line; non-zero exit → `BACKUP_PG_DUMP_FAILED` with stderr (≤500 chars) in `log_detail`.
    - `pub(crate) struct RestoreTarget<'a> { host: &'a str, port: u16, database: &'a str, username: &'a str, password: &'a str }`
    - `pub(crate) fn run_pg_restore(bin_dir, target, dump: &Path, with_privileges: bool, code_on_error: &'static str) -> Result<(), EngineError>` — args `--exit-on-error --single-transaction --no-owner [--no-privileges if !with_privileges] --host --port --username --dbname <dump>`, `PGPASSWORD` env, console hidden.
    - `pub(crate) fn run_pg_restore_list(bin_dir, dump) -> Result<(), EngineError>` — `pg_restore --list <dump>`, stdout null.
  - `bundle.rs`:
    - `pub(crate) enum BackupKind { Manual, Daily, PreUpdate, PreRestore }` with `as_str()` → `MANUAL|DAILY|PRE_UPDATE|PRE_RESTORE` and `parse(Option<&str>) -> &'static str` returning `UNKNOWN` for anything else.
    - `pub(crate) struct BundleMetadata<'a> { schema_version: &'a str, app_version: &'a str, kind: BackupKind }`
    - `pub(crate) fn finalize_bundle_metadata(bundle_dir: &Path, meta: &BundleMetadata) -> Result<(), EngineError>`: write `schema-version.txt` and `application-version.txt` (synced); read `manifest.json` into `serde_json::Value`; set `bundle_format_version=2`, `schema_version`, `application_version`, `backup_kind`, `dump_includes_privileges=true`, `source="EMBEDDED"`; for each entry in `files` whose `path` is one of the two txt files, update `sha256` and `size_bytes`; reject duplicate paths; sort `files` by `path`; write compact JSON (`serde_json::to_vec`), sync; rebuild `checksums.sha256` exactly like `recovery_creation::rewrite_schema_metadata` (entries + manifest hash, sorted, `"{hash}  {path}\n"`). Failure code `BACKUP_METADATA_WRITE_FAILED`.
    - `pub(crate) fn canonical_bundle_anywhere(raw: &str) -> Result<(PathBuf, String), EngineError>`: trim; final component must satisfy `is_canonical_bundle_identifier` (make that function in `application/recovery.rs` `pub(crate)`) else `BACKUP_BUNDLE_NAME_INVALID`; `symlink_metadata` must be a real directory (not symlink/reparse) before and after `canonicalize`, else `BACKUP_BUNDLE_NOT_A_DIRECTORY`; canonical final name must equal the original name; return `(dunce::simplified(canonical), name)`.
    - `pub(crate) struct BundleSummary { validated: ValidatedBundle, file_count: u64, total_bytes: u64, verdict: SchemaVerdict, restorable: bool, created_at_utc: Option<String> }`
    - `pub(crate) fn inspect_bundle(dir: &Path, embedded_mode: bool) -> Result<BundleSummary, EngineError>` → `validate_bundle` (error → `BACKUP_INTEGRITY_INVALID`, backup_proof code in log detail) + stats (reuse the logic of `canonical_bundle_stats`; make it `pub(crate)` in `application/recovery.rs`) + verdict (`schema::classify(&v.schema_version, &embedded_versions())`) + `restorable = embedded_mode && v.bundle_format_version == 2 && v.dump_includes_privileges && v.postgres_major_version == 18 && matches!(verdict, Same|Older)`; `created_at_utc` from `created_at_unix` (RFC3339) else parsed from the folder name.
- **Depends on:** H3-01, H3-03.
- **Expected:** unit tests create a fake bundle with `create_backup_bundle` + fake dump bytes, finalize to format 2, validate OK; tamper one byte in `application-version.txt` → validation fails.
- **Pitfalls:** the existing `MutableManifest` struct in `recovery_creation.rs` would drop new fields — do not use it for format 2; `serde_json::Value` preserves them. Hashing the manifest must use the exact bytes written.
- **Edge cases:** manifest missing `files` array → `BACKUP_METADATA_WRITE_FAILED`; txt file entry missing from manifest → same.
- **Verify:** unit tests listed; `cargo test --lib backup_proof` still green (legacy tests untouched).

### H3-06 — Application layer + command dispatch
- **Objective:** route every recovery command by mode.
- **Files:** create `src-tauri/src/application/recovery_embedded.rs`; edit `application/mod.rs` (`pub(crate) mod recovery_embedded;`); edit `commands/recovery.rs`; edit `lib.rs` `generate_handler!` (add new commands); edit `domain/recovery.rs` (DTOs §5.8/§5.8.1); edit `error.rs` (§5.7); edit `application/recovery.rs` `stable_error_code` (new arms).
- **Logic:**
  - `commands/recovery.rs`: add `fn resolve_recovery_mode(app: &AppHandle) -> RecoveryMode` (§5.1). Add `app: AppHandle` parameter to commands that need it (Tauri injects it; the frontend call does not change).
  - New command `get_recovery_mode(app)` → `RecoveryModeResponse { mode: String, unavailable_reason: Option<UnavailableReason> }` (camelCase).
  - New command `get_recovery_capabilities(app, state, session_token)`: UNAVAILABLE → all false; else `SELECT operations.get_recovery_capabilities($1)` → parse `{can_create_backup,...}` → return camelCase DTO with `mode`.
  - New command `get_backup_status(app, state, session_token)`: UNAVAILABLE → `RECOVERY_UNAVAILABLE`; else `SELECT operations.get_backup_status($1)` → DTO.
  - `get_backup_destination_setting`: EXTERNAL → existing call + `effectivePath = path.or(env STOCKIHA_BACKUP_ROOT)`, `isDefault=false`, `available=true`, `sameDriveWarning=false`. EMBEDDED → existing SQL read, then `destination::resolve(stored, ctx, Manual)`: Ok → `effectivePath=path`, `available=true`, `isDefault`, `sameDriveWarning` via `drive_letter` compare with pgdata; `Err(BACKUP_DESTINATION_UNAVAILABLE)` → `effectivePath=stored`, `available=false`. UNAVAILABLE → `RECOVERY_UNAVAILABLE`.
  - `update_backup_destination_setting`: EXTERNAL → unchanged `recovery::update_backup_destination`. EMBEDDED → `recovery_embedded::update_destination(pool, token, ctx, path)` = `check_candidate` then the existing SQL `update_backup_destination_setting`; return `{path, sameDriveWarning}`. UNAVAILABLE → error.
  - `create_operator_backup`: acquire lease first (unchanged). EXTERNAL → existing body unchanged (move it into a private `async fn create_operator_backup_external(...)` verbatim). EMBEDDED → `recovery_embedded::create_manual_backup(...)` (H3-07). UNAVAILABLE → error.
  - `validate_operator_backup`: same split; EMBEDDED → `recovery_embedded::validate_backup(...)` (H3-07).
  - `verify_operator_backup_restore`: in H3, EMBEDDED → `RECOVERY_UNAVAILABLE` (implemented in H4); EXTERNAL unchanged.
- **Depends on:** H3-01..H3-05.
- **Expected:** all commands compile and are registered.
- **Pitfalls:** `AppError` match arms are exhaustive in several places (`Debug`, `Display`, `From`, `stable_error_code`) — add all; the `Debug` impl must print `<redacted>`. Do not change any existing command's name or existing argument names.
- **Edge cases:** DB unavailable → `pool_or_unavailable` error is returned before mode-specific work (keep existing order: mode check first, then pool).
- **Verify:** `cargo clippy -D warnings`; unit test that each new `ErrorCode` serializes to the exact string in §5.7; unit test that `stable_error_code` returns them.

### H3-07 — Embedded manual backup and validation
- **Objective:** the two core operations on an installed build.
- **Files:** `application/recovery_embedded.rs`; create `recovery_engine/backup.rs`.
- **Logic:**
  - `recovery_engine/backup.rs`:
```rust
pub(crate) struct CreateBundleInput<'a> {
    pub ctx: &'a EmbeddedRecoveryContext,
    pub destination: &'a Path,        // resolved, real directory
    pub bundle_name: &'a str,         // canonical, from the audit envelope
    pub kind: BackupKind,
    pub stage_tag: &'a str,           // e.g. attempt id as string
}
pub(crate) struct CreatedBundle { pub path: PathBuf, pub summary: BundleSummary }
pub(crate) async fn create_bundle(input: CreateBundleInput<'_>) -> Result<CreatedBundle, EngineError>
```
    Steps (log each to `recovery.log` with operation `BACKUP`):
    1. `pg_process::preflight_backup_binaries(&ctx.bin_dir)` → `BACKUP_PREFLIGHT_BINARIES_MISSING`.
    2. `tools::pg_tool_version(bin_dir, "pg_dump.exe")` → `pg_version_string`.
    3. `info = local_config::load_migrator_connection_info(&ctx.app_data_dir)`; `None` → `EngineError` `BACKUP_SCHEMA_VERSION_UNREADABLE` with log detail "migrator credential missing".
    4. Connect as migrator (`PgConnectOptions` from `info`, same as `safe_upgrade::connect_options` — copy the 7 lines); `schema::applied_version` → `BACKUP_SCHEMA_VERSION_UNREADABLE`; `SELECT pg_database_size(current_database())`; close.
    5. Free space: `pg_process::free_disk_space_bytes(destination)`; required = `db_size * 2 + 50 * 1024 * 1024` (saturating); `None` or less → `BACKUP_INSUFFICIENT_SPACE`.
    6. Final path = `destination.join(bundle_name)`; exists → `BACKUP_IDENTIFIER_COLLISION`.
    7. Stage root = `destination.join(format!(".{bundle_name}.staging-{stage_tag}-{nanos}"))`, `create_dir` (→ `BACKUP_STAGE_FAILED`), guard removes it on drop.
    8. Parse time from `bundle_name` (make `recovery_creation::parse_bundle_identifier_time` `pub(crate)`).
    9. Collect assets (make `recovery_creation::collect_backup_inputs` `pub(crate)`; errors → `BACKUP_ASSET_COPY_FAILED`).
    10. `spawn_blocking`: `backup_proof::create_backup_bundle(&stage, time, &pg_version_string, &inputs, |out| tools::run_pg_dump(...).map_err(|_| BackupProofError::PgDumpFailed(None)))` — capture the real `EngineError` in a `std::cell::RefCell`/`Option` outside the closure so the original code/detail is kept; staged folder name must equal `bundle_name`.
    11. `bundle::finalize_bundle_metadata(staged, {schema_version: applied.to_string(), app_version: ctx.app_version, kind})`.
    12. `bundle::inspect_bundle(staged, true)` → `BACKUP_VALIDATION_AFTER_CREATE_FAILED` on error; `summary.validated.schema_version` must equal the applied version.
    13. Re-check final path does not exist; `fs::rename(staged, final)` → `BACKUP_PUBLISH_FAILED`.
    14. `inspect_bundle(final, true)` → `BACKUP_VALIDATION_AFTER_CREATE_FAILED`.
    15. Return `CreatedBundle`.
  - `application/recovery_embedded.rs`:
    - `pub(crate) async fn create_manual_backup(pool, token, ctx, request) -> Result<OperatorBackupCreationResult, AppError>`: F1 steps 1–4 (§5.10). Use `recovery_creation::begin_operator_backup_creation` **only if** it does exactly step 1; it also computes the candidate itself — reuse it and add the collision retry loop around it here (on `AppError::IdempotencyConflict` when the request id is new: sleep 1 s, call again, max 3 attempts). Completion via `recovery_creation::complete_operator_backup_creation_success/failure`.
    - Build the result DTO: `request_id`, `bundle_identifier`, `created_at_label` (name without prefix), `application_version` (bundle), `schema_version`, `postgres_major_version`, `integrity_valid: true`, `application_compatible: true`, `schema_compatible: verdict ∈ {Same, Older}`, `postgres_compatible: major == 18`, `file_count`, `total_bytes`, plus optional fields `format_version`, `backup_kind`, `schema_verdict`, `restorable`, `created_at_utc`, `used_fallback_destination: Some(false)`.
    - `pub(crate) async fn validate_backup(pool, token, ctx, request)`: `request.validate()`; `bundle::canonical_bundle_anywhere(&request.bundle_path)` (errors → `BackupValidationFailed`); `begin_recovery_attempt(token, request_id, 'VALIDATE_BACKUP', name)` (reuse `recovery::begin_operator_backup_validation`, which already does exactly this); replay → return; run `inspect_bundle(path, true)` in `spawn_blocking`; complete success/failure with the existing `recovery::complete_operator_backup_validation_*`; return the DTO (same field rules).
    - `pub(crate) async fn update_destination(...)` (H3-06).
- **Depends on:** H3-02..H3-06.
- **Expected:** on an installed build, Create produces `<destination>\GestStock-Backup-...` with format 2 manifest; Validate accepts that folder from any location.
- **Pitfalls:** do not hold the migrator connection open while `pg_dump` runs (it is a separate process); `spawn_blocking` for all file/process work; lease already held by the command; a failure inside the closure must not lose its detail code.
- **Edge cases:** two clicks in the same second → lease refuses the second (`RECOVERY_OPERATION_IN_PROGRESS`); app data contains zero asset files → empty asset folders still created; destination on a FAT32 USB with a > 4 GB dump → `pg_dump` fails → `BACKUP_PG_DUMP_FAILED` (logged); antivirus holding the staged folder so rename fails → `BACKUP_PUBLISH_FAILED`, staging removed.
- **Verify:** ignored real-PG test `recovery_engine::backup::tests::creates_format_2_bundle_with_privileges` (Windows): reuse the test helpers from `safe_upgrade.rs` (make `provision_fresh_instance`, `temp_app_data_dir_for_tests`, `stop_server` etc. `pub(crate)` inside a new `#[cfg(test)] pub(crate) mod test_support` in `safe_upgrade.rs` — moving test-only code is allowed); seed a row, create bundle, assert: manifest format 2, kind MANUAL, schema version == `embedded_latest_version()`, `pg_restore --list` output contains the text `ACL` (privileges present), `validate_bundle` OK, no `.staging` folder remains.

### H3-08 — Startup behaviour by mode
- **Objective:** stop misleading warnings on installed builds.
- **Files:** `src-tauri/src/lib.rs`.
- **Change:** wrap the two calls
```rust
application::recovery::startup_environment_diagnostic();
application::recovery::sweep_orphaned_restore_databases().await;
```
  in `if std::env::var(infrastructure::db::DATABASE_URL_ENV).map(|v| !v.trim().is_empty()).unwrap_or(false) { ... }`.
- **Depends on:** nothing.
- **Expected:** installed build prints no `[RECOVERY_STARTUP]` line; `run.bat` still does.
- **Pitfalls:** do not touch the rest of `.setup()`.
- **Verify:** code review + Owner manual check M3-6.

### H3-09 — Frontend
- **Objective:** screen reflects mode, capabilities, default destination, status, and new errors.
- **Files:** `src/shared/ipc/commands.ts` (add `GET_RECOVERY_MODE: 'get_recovery_mode'`, `GET_RECOVERY_CAPABILITIES: 'get_recovery_capabilities'`, `GET_BACKUP_STATUS: 'get_backup_status'`); `src/shared/ipc/recoveryDto.ts`; `src/shared/ipc/recoveryGateway.ts` (functions `getRecoveryMode()`, `getRecoveryCapabilities(token)`, `getBackupStatus(token)`, same try/catch → `GatewayError` pattern); `src/shared/types/errors.ts` (7 codes + keys); `src/shared/i18n/locales.ts` (7 `errors.*` keys in fr/ar/en; ar = English text + `// TODO(WS-H-7)` comment on the line above each); `src/features/settings/RecoverySettingsScreen.tsx`; `src/shared/version.ts` (`'WS-H-3.0'`).
- **Logic (RecoverySettingsScreen):**
  1. On mount call `getRecoveryCapabilities(sessionToken)`. While loading render nothing. If the call fails or all four booleans are false → `return null` (the card disappears for cashiers/managers).
  2. If `mode === 'UNAVAILABLE'` → render the card title plus `<Banner tone="error">{t('errors.recoveryUnavailable')}</Banner>` and nothing else.
  3. Status line at the top (only if `canCreateBackup`): call `getBackupStatus`; render "Last successful backup: {localized date time}" or "No backup has been made yet." Warning tone if null or older than 3 days; error tone if `lastFailureAt > lastSuccessAt` with text "The last backup attempt failed." Refresh after each create.
  4. Destination box: show `effectivePath`; when `isDefault` add the helper "Default folder on this computer. For real protection choose a USB drive or another disk."; when `sameDriveWarning` show warning Banner "This folder is on the same disk as your data. If the disk fails, the backups are lost too."; when `available === false` show error Banner `errors.backupDestinationUnavailable`. After a successful change, re-fetch the setting (to get `effectivePath` etc.).
  5. Hide Create box if `!canCreateBackup`; hide Validate box if `!canValidateBackup`; hide the whole restore card if `!canVerifyRestore`.
  6. Delete the constant `RESTORE_DRILL_AVAILABLE` and the deferred-restore branches/copy (`restoreComingSoon`, `restoreDeferredTitle`, `restoreDeferredBody`).
  7. Result grid: when `result.applicationCompatible` is true show only the version (no "Compatible" suffix) — application version is informational. Add rows "Backup type" (kind label: Manual / Daily automatic / Before update / Before restore / Unknown) and "Can be restored by this version" (Yes/No) when the fields are present.
  8. In EMBEDDED mode the "Verify temporary restore" button remains visible but calling it returns `RECOVERY_UNAVAILABLE` until H4 — acceptable for H3 (Owner is told).
  9. New copy strings go into the existing `COPY` object for H3 (en, fr real; ar English + TODO). Keys: `lastBackup`, `noBackupYet`, `lastBackupFailed`, `destinationDefaultHelp`, `sameDriveWarning`, `kind`, `kindManual`, `kindDaily`, `kindPreUpdate`, `kindPreRestore`, `kindUnknown`, `restorable`.
- **Depends on:** H3-06.
- **Pitfalls:** `useErrorText` needs the new keys in `ERROR_MESSAGE_KEYS` or TypeScript fails (`satisfies Record<AppErrorCode, string>`); `BACKEND_ERROR_CODES` order does not matter but all must be present; do not change `AppRouter.tsx` in H3.
- **Edge cases:** capabilities call fails with `SESSION_INVALID` → return null (session handling elsewhere logs out); date formatting uses `new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' })`.
- **Verify:** vitest (H3-10).

### H3-10 — Tests and marker
- **Files:** `tests/recovery-settings.workflow.test.tsx` (update the `invokeMock` router to answer the three new commands; keep all existing assertions that still apply; delete assertions about the deferred-restore copy); `APP_VERSION_MARKER = 'WS-H-3.0'`; create `WS-H-MANUAL-VERIFICATION.md` at repo root containing PART 14 §M3 verbatim.
- **New vitest cases:** (1) all capabilities false → screen renders nothing; (2) mode UNAVAILABLE → only the error banner; (3) default destination → helper text shown, path shown; (4) `sameDriveWarning` → warning shown; (5) `available=false` → error banner; (6) create success → status line refetched; (7) new error code `BACKUP_DESTINATION_UNAVAILABLE` from create → localized text shown; (8) cashier-like capabilities (only none) → nothing; (9) `canCreateBackup=false, canValidateBackup=true` → only validate box.
- **Verify:** `npm test -- --run` green.

### H3 Acceptance criteria
1. All gates in §4.5 pass (Windows ignored tests: `recovery_engine`, `safe_upgrade`, `embedded_setup`).
2. Installed build (fresh PC or reset app data): Settings shows the backup card to the admin; destination shows the default folder; Create backup succeeds and the folder appears with a `manifest.json` whose `bundle_format_version` is 2 and `backup_kind` is `MANUAL`.
3. Changing the destination to another folder works; choosing the Stockiha install folder or the `pgdata` folder is refused with a clear message.
4. Validate accepts that backup after copying it by hand to a USB stick (any folder).
5. Tampering one byte of `database.dump` in a copy → Validate fails with the "could not be validated" message.
6. A cashier account does not see the backup card.
7. `run.bat` developer workflow: create/validate/verify behave exactly as before (Owner may skip if the dev cluster is no longer used — record "not run").
8. No console window flashes during backup.

---

## PART 8 — WS-H-4: BACKUP LIST, COPY, ISOLATED RESTORE TEST

**Goal:** The admin sees every backup in the destination folder, can copy any of them to a USB stick, can open a backup from anywhere, and can "Test this backup" — which restores it into a throwaway PostgreSQL server, brings it up to the current version if older, checks the totals, and deletes the throwaway server. Live data is never touched.

### H4-01 — Backup list (engine)
- **Files:** create `recovery_engine/catalog.rs`.
- **Logic:**
```rust
pub(crate) const MAX_LIST_ITEMS: usize = 200;
pub(crate) const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;
pub(crate) fn list_bundles(root: &Path, embedded_mode: bool) -> Vec<BackupListItemDto>
```
  1. `read_dir(root)`; on error return empty vec (log).
  2. Keep entries whose `file_name` passes `is_canonical_bundle_identifier` AND `symlink_metadata` is a real directory (skip symlinks/reparse points and every name starting with `.`).
  3. For each: open `manifest.json`; if missing, larger than `MAX_MANIFEST_BYTES`, or unparsable → item with `manifestReadable=false`, `backupKind=UNKNOWN`, `formatVersion=null`, `schemaVersion=null`, `schemaVerdict=UNKNOWN`, `restorable=false`, `totalBytes=0`, `createdAtUtc` from the name.
  4. Else fill from manifest fields (`serde_json::Value`, tolerant): `totalBytes` = sum of `files[].size_bytes`; `schemaVerdict` = `schema::classify`; `restorable` = same formula as `inspect_bundle` but WITHOUT hashing (list is advisory; the real operations re-validate fully).
  5. Sort by `createdAtUtc` descending (None last), then name descending; truncate to `MAX_LIST_ITEMS`.
- **Pitfalls:** never hash in the list (a 2 GB dump would freeze the screen); `path` must be `dunce::simplified`.
- **Edge cases:** destination folder missing → empty list (not an error); 500 bundles → newest 200; a folder named correctly but containing garbage → `manifestReadable=false`.
- **Verify:** unit tests with a temp dir: canonical/non-canonical names, hidden staging folder ignored, unreadable manifest, ordering, cap.

### H4-02 — Copy to another folder (engine)
- **Files:** create `recovery_engine/copy.rs`.
- **Logic:** `pub(crate) fn copy_bundle(source: &Path, target_dir: &Path) -> Result<(PathBuf, u64), EngineError>`
  1. `inspect_bundle(source, false)` (full validation) → failure `COPY_SOURCE_INVALID`.
  2. `target_dir` must be an existing real directory (not symlink/reparse) → else `COPY_TARGET_INVALID`.
  3. Refuse when canonical `target_dir` equals canonical source parent (copying onto itself) → `COPY_TARGET_INVALID`.
  4. `final = target_dir.join(name)`; exists → `COPY_TARGET_EXISTS`.
  5. Free space on target ≥ `total_bytes * 11 / 10 + 10 MB` → else `INSUFFICIENT_DISK_SPACE` (use detail `BACKUP_INSUFFICIENT_SPACE`).
  6. Temp = `target_dir.join(format!(".{name}.copying-{nanos}"))`; guard removes it on drop.
  7. Copy: the six top-level files and the three asset directories' regular files (flat, like the bundle format). Sync each file. Any IO error → `COPY_IO_FAILED`.
  8. `inspect_bundle(temp, false)` → failure `COPY_VALIDATION_FAILED`. (Validation hashes the copy — this is what proves a USB copy is good.)
  9. `rename(temp, final)` → `COPY_IO_FAILED`; return `(final, total_bytes)`.
- **Pitfalls:** `rename` fails across volumes — temp is on the target volume by construction, so rename stays on one volume; never copy symlinks.
- **Edge cases:** USB removed mid-copy → IO error → guard removes temp if still possible; if the drive is gone the temp cannot be removed — acceptable, report failure.
- **Verify:** unit tests: happy path copies and validates; target exists → error; corrupted source → `COPY_SOURCE_INVALID`; no temp folder remains after a failure.

### H4-03 — Throwaway cluster helpers
- **Files:** `src-tauri/src/infrastructure/embedded_setup.rs` (visibility only), create `recovery_engine/drill_cluster.rs`.
- **Change in `embedded_setup.rs` (bodies unchanged):** make `generate_password`, `run_initdb`, `write_server_config`, `connect_as_admin`, `create_roles`, `create_database` → `pub(crate)`; make struct `RolePasswords` and its fields `pub(crate)`; make `const DATABASE_NAME` → `pub(crate)`.
- **Logic (`drill_cluster.rs`):**
```rust
pub(crate) const DRILL_DIR_PREFIX: &str = "restore-drill-";
pub(crate) const DRILL_MARKER_FILE: &str = ".stockiha-drill";
pub(crate) const DRILL_PREFERRED_PORT: u16 = 55480;

pub(crate) struct DrillCluster {
    pub root: PathBuf, pub data: PathBuf, pub bin_dir: PathBuf, pub port: u16,
    pub migrator_password: Zeroizing<String>,
    child: Option<std::process::Child>,
    stopped: bool,
}
impl DrillCluster {
    pub(crate) async fn start(ctx: &EmbeddedRecoveryContext, required_free_bytes: u64) -> Result<Self, EngineError>;
    pub(crate) fn restore_target(&self) -> RestoreTarget<'_>;   // 127.0.0.1, port, DATABASE_NAME, "stockiha_migrator", password
    pub(crate) fn connect_options(&self) -> PgConnectOptions;   // same fields
    pub(crate) fn stop(&mut self) -> Result<(), EngineError>;   // pg_ctl stop fast→immediate (10 s), child.wait(); sets stopped
    pub(crate) fn remove_files(&self) -> bool;                  // remove_dir_all(root) up to 3 tries, 1 s apart; true if gone
}
impl Drop for DrillCluster { fn drop(&mut self) { if !self.stopped { let _ = self.stop(); } let _ = self.remove_files(); } }
```
  `start` steps:
  1. `parent = ctx.pgdata.parent()`; `root = parent.join(format!("{DRILL_DIR_PREFIX}{unix}-{pid}"))`; if `!root.to_str().map(str::is_ascii).unwrap_or(false)` → `DRILL_PATH_NOT_ASCII`.
  2. `free_disk_space_bytes(parent)` ≥ `required_free_bytes` else `DRILL_INSUFFICIENT_SPACE`.
  3. `create_dir_all(root.join("data"))`; write marker `pid=<pid>\nstarted=<unix>\n`. From this line on, construct the `DrillCluster` value immediately (with `child: None`, `stopped: true`) so `Drop` cleans the folder on any early return; set `stopped=false` only after spawning.
  4. `password = generate_password()`; `run_initdb(bin_dir, data, &password)` → `DRILL_INITDB_FAILED`.
  5. `port = find_free_port(DRILL_PREFERRED_PORT)` → `DRILL_NO_FREE_PORT`; `write_server_config(data, port)`.
  6. `spawn_postgres(bin_dir, data)` → `DRILL_SERVER_START_FAILED`; store child; `wait_until_ready(port, 30 s)` → `DRILL_SERVER_START_FAILED`.
  7. `create_roles(port, password.clone())` → `DRILL_ROLE_SETUP_FAILED`; take `migrator` password (must be `Some`); `create_database(port, password)` → `DRILL_ROLE_SETUP_FAILED`.
- **Pitfalls:** `stop_postgres` uses `pg_ctl -D <data>` which reads THIS cluster's `postmaster.pid` — correct; never call `stop_embedded_postgres_if_running` here (that targets the live server). `required_free_bytes` for a test = `dump_size * 4 + 200 MB`.
- **Edge cases:** initdb fails → folder removed by Drop; server fails to start → Drop stops nothing (no child) and removes the folder; Windows keeps a file open → `remove_files` returns false → caller reports `cleanupPending`.
- **Verify:** ignored real-PG test: start, connect as migrator, `SELECT 1`, stop, removed; assert live server (started by `provision_fresh_instance` in the same test) still answers afterwards.

### H4-04 — Isolated restore test (engine)
- **Files:** create `recovery_engine/drill.rs`; edit `application/recovery.rs`: make `collect_restore_control_totals` `pub(crate)` (body unchanged).
- **Logic:**
```rust
pub(crate) struct DrillReport {
    pub verdict: SchemaVerdict, pub migrated_forward: bool,
    pub totals: RestoreControlTotals, pub journal_balanced: bool,
    pub server_stopped: bool, pub cleanup_pending: bool,
}
pub(crate) async fn run_isolated_drill(ctx: &EmbeddedRecoveryContext, summary: &BundleSummary) -> Result<DrillReport, EngineError>
```
  1. If `summary.verdict` is `Newer` → `BACKUP_SCHEMA_NEWER_THAN_APP`; `Unknown` → `BACKUP_SCHEMA_UNKNOWN`. (Checked before starting any server.)
  2. `required = dump_size * 4 + 200 MB`; `cluster = DrillCluster::start(ctx, required)`.
  3. `tools::run_pg_restore(bin_dir, cluster.restore_target(), dump_path, with_privileges = summary.validated.bundle_format_version == 2 && summary.validated.dump_includes_privileges, "DRILL_RESTORE_FAILED")` inside `spawn_blocking`.
  4. Connect with `cluster.connect_options()`; `schema::applied_history(conn)`; compare to `embedded_checksums()`: any restored version missing from the binary or with a different checksum → `DRILL_MIGRATION_HISTORY_MISMATCH`.
  5. If `verdict == Older` → `schema_version::run_all_migrations(&mut conn)` → `DRILL_FORWARD_MIGRATION_FAILED`; then `check_schema_compatibility` must be `UpToDate` → else `DRILL_FORWARD_MIGRATION_FAILED`. `migrated_forward = true`.
  6. `collect_restore_control_totals(&mut conn)` → `DRILL_RECONCILIATION_FAILED` on error.
  7. Close conn; `cluster.stop()` → failure `DRILL_SERVER_STOP_FAILED` (this IS a failure); `cleanup_pending = !cluster.remove_files()`.
  8. Return report (journal imbalance is reported, not an error, here).
- **Pitfalls:** step 5 uses the drill connection — `run_all_migrations` takes `&mut PgConnection`, the migrator's session role is `stockiha_owner` (set by `create_database`), exactly like production; do not open a second connection for migrations.
- **Edge cases:** format 1 bundle → restored without privileges; totals still computed (migrator/owner can read). Very large dump → no timeout; progress is not streamed for the standalone test (button shows spinner).
- **Verify:** ignored real-PG tests (Windows): (a) SAME bundle → verdict Same, not migrated, totals equal to the source's totals, folder removed; (b) OLDER bundle (build it by deleting the newest `_sqlx_migrations` row in the source before dumping — valid because the newest migration is idempotent) → `migrated_forward = true`; (c) NEWER (insert a fake row `version = 99999999999999` with any checksum into the source before dumping) → `BACKUP_SCHEMA_NEWER_THAN_APP` before any server starts (assert no `restore-drill-*` folder was created); (d) history mismatch (update the checksum of the earliest row in the source before dumping) → `DRILL_MIGRATION_HISTORY_MISMATCH` and folder removed; (e) after every case the live test server still answers.

### H4-05 — Commands
- **Files:** `commands/recovery.rs`, `application/recovery_embedded.rs`, `lib.rs`, `domain/recovery.rs`.
- **Logic:**
  - `list_backups(app, state, session_token)`: permission check first by calling `SELECT operations.get_recovery_capabilities($1)` and requiring `can_validate_backup` (else `PERMISSION_DENIED`). Root: EMBEDDED → `destination::resolve(stored, ctx, Manual)`; if that errors with unavailable → return `{destination: stored, items: []}`. EXTERNAL → `recovery_creation::resolve_backup_root(pool, token)`; error → `{destination: null, items: []}`. Run `catalog::list_bundles` in `spawn_blocking`.
  - `copy_backup_to(app, state, session_token, request)`: validate request (`requestId` rule, both paths non-empty ≤4096, no NUL); capabilities `can_create_backup` else `PERMISSION_DENIED`; lease; `canonical_bundle_anywhere(bundlePath)`; `copy::copy_bundle` in `spawn_blocking`; log to `recovery.log` (operation `COPY`); return `{copiedPath, totalBytes}`. No DB audit row (copying does not change data).
  - `verify_operator_backup_restore` EMBEDDED branch → `recovery_embedded::test_backup(pool, token, ctx, request)`: `request.validate()` (keeps the `confirmed` requirement); `canonical_bundle_anywhere`; `recovery::begin_operator_restore_verification` (policy trigger applies; replay supported); `inspect_bundle(path, true)`; `run_isolated_drill`; complete success with DTO (`temporaryDatabaseCleaned = report.server_stopped`, `journalBalanced`, `controlTotals`, `schemaVerdict`, `migratedForward`, `cleanupPending`, `schemaVersion` = bundle schema, `postgresMajorVersion`) or failure with the detail code via `recovery::complete_operator_restore_verification_failure`.
- **Pitfalls:** `begin_operator_restore_verification` uses `selected_bundle_identity` (name check only) — fine; it does NOT enforce the root in its own body (the root check is in the later file step, which the EMBEDDED branch replaces).
- **Verify:** clippy; unit tests for request validation of `copy_backup_to`.

### H4-06 — Frontend restructure
- **Files:** create `src/features/settings/recovery/recoveryCopy.ts`, `BackupStatusLine.tsx`, `DestinationBox.tsx`, `BackupList.tsx`, `BackupResultGrid.tsx`, `RestoreTestResultGrid.tsx`; rewrite `src/features/settings/RecoverySettingsScreen.tsx` as the container; gateway/DTO/commands additions (`LIST_BACKUPS`, `COPY_BACKUP_TO`; `listBackups(token)`, `copyBackupTo(token, request)`).
- **Copy migration:** move every string of the old `COPY` object into `src/shared/i18n/locales.ts` under `recovery.*` keys (fr real, en real, ar = existing Arabic where it existed, English + TODO for new strings); components use `t('recovery.<key>')`. Delete the in-file `COPY` object.
- **Screen layout (top to bottom):**
  1. Card "Backup and recovery": status line; destination box; "Create backup now" button (primary).
  2. Card "Your backups": table with columns Date (local, `Intl.DateTimeFormat`), Type (kind label), Size (`Intl.NumberFormat` with unit: bytes → KB/MB/GB, 1 decimal), Version status (`Current` for SAME, `Older — will be updated` for OLDER, `Newer — needs a newer Stockiha` for NEWER, `Unknown` otherwise), Actions.
     Row actions (buttons, secondary): "Check" (validate; needs `canValidateBackup`), "Test" (needs `canVerifyRestore` and policy ON), "Copy to…" (needs `canCreateBackup`; opens native folder picker `open({directory: true, multiple: false, title})`), "Restore…" (rendered in H5; in H4 do not render it).
     Above the table: "Open a backup from another folder…" (native picker; the selected folder is validated with `validateOperatorBackup` and, if valid, shown in a separate one-row table "Selected backup" with the same actions).
     Empty state: "No backups in this folder yet."; loading state: `Spinner`; list error: error Banner.
  3. Result area below the list: validation grid (`BackupResultGrid`) or test grid (`RestoreTestResultGrid`) for the last action, with the row's date as heading. Test grid shows: "Server stopped" yes/no, "Journals balanced", "Updated to current version" yes/no, and the existing totals; if `cleanupPending` show info Banner "A temporary folder could not be removed yet; Stockiha will remove it at next start."
  4. Card "Advanced": the existing restore-test policy checkbox (unchanged behaviour). Remove the separate "I understand…" checkbox from the main flow; instead, clicking "Test" opens `ConfirmDialog` with title "Test this backup?", body "Stockiha will start a temporary database, load this backup into it, check it, and delete it. Your live data is not touched. This can take a few minutes.", confirm "Start test"; on confirm call `verifyOperatorBackupRestore(token, {requestId, bundlePath, confirmed: true})`.
  5. One global busy state (`busy: { action, bundleIdentifier } | null`); while busy every action button is disabled and the active one shows `loading`. After create/copy/test/check success, re-fetch list and status.
- **Pitfalls:** keep `data-testid="backup-result"` and `data-testid="restore-result"` for existing tests; row buttons need `aria-label` including the date (e.g. "Test backup of 15 Sep 2026 14:30") so tests and screen readers can distinguish them; RTL: the table must use logical CSS (`text-align: start`).
- **Edge cases:** policy OFF → "Test" buttons hidden and a note "Backup testing is turned off in Advanced."; mode EXTERNAL → list works, Test uses the legacy path (unchanged behaviour), Copy works.
- **Verify:** H4-07.

### H4-07 — Tests
- Rust unit (H4-01, H4-02, request validation) + ignored real-PG (H4-03, H4-04).
- Vitest (update `tests/recovery-settings.workflow.test.tsx`, add `tests/recovery-backup-list.test.tsx`): list renders rows sorted as returned, kind labels, size formatting, verdict labels; empty state; list error; Copy calls `open` then `copy_backup_to` with the picked folder, success banner shows copied path; picker cancelled → no IPC call; Test opens dialog, cancel does nothing, confirm calls `verify_operator_backup_restore` with `confirmed: true`; policy OFF hides Test; "Open a backup from another folder" validates and shows the selected row; all buttons disabled while busy; Arabic render has `dir="rtl"` ancestor (existing pattern in the old test).
- `APP_VERSION_MARKER = 'WS-H-4.0'`; append §M4 to `WS-H-MANUAL-VERIFICATION.md`.

### H4-08 — Startup sweep of abandoned test servers
- **Files:** create `recovery_engine/sweep.rs`; edit `lib.rs`.
- **Logic:** `pub(crate) fn sweep_abandoned_drills(pgdata: &Path, bin_dir: &Path) -> Vec<String>` (returns removed folder names):
  1. `parent = pgdata.parent()`; for each child dir whose name starts with `DRILL_DIR_PREFIX` AND contains `DRILL_MARKER_FILE` (skip anything else — never delete a folder without the marker).
  2. `live_pid = pg_process::read_postmaster_pid(pgdata)`.
  3. `drill_pid = read_postmaster_pid(child/data)`: if `Some(p)` and `Some(p) != live_pid` and `check_postmaster_pid(p) == Alive` → `stop_postgres(bin_dir, child/data, 10 s)` (ignore errors). If `Some(p) == live_pid` → do NOT signal (PID reuse); just continue.
  4. `remove_dir_all(child)`; push name on success.
  In `lib.rs`, after `ensure_embedded_postgres_running(...)` and only when the env var is NOT set and `app_data_dir`/`resource_dir` are known: `std::thread::spawn(move || { let removed = sweep_abandoned_drills(&pgdata, &bin_dir); if !removed.is_empty() { recovery_engine::log::append(&app_data_dir, "SWEEP", &format!("removed {}", removed.join(", "))); } });` — a background thread so startup is never delayed.
- **Pitfalls:** the live `postmaster.pid` must be read *before* deciding; never pass the live `pgdata` to `stop_postgres`.
- **Verify:** unit test with fake folders (no marker → untouched; marker + no pid → removed; pid equal to "live" pid → not signalled). Ignored real-PG test: start a drill cluster, `mem::forget` it (simulating a crash), run the sweep, assert the drill port stops answering, folder removed, live server still answers.

### H4 Acceptance criteria
1. Gates pass (including new ignored tests on Windows).
2. Installed build: after creating two backups, both appear newest first with correct type and size.
3. "Copy to…" onto a USB stick produces a folder that "Open a backup from another folder…" then checks successfully.
4. "Test" on a current backup succeeds, shows balanced journals and totals; Task Manager shows no extra `postgres.exe` afterwards; no `restore-drill-*` folder remains in `%APPDATA%\com.raqmenha.stockiha`.
5. While a test runs, other Stockiha screens (for example Products) stay usable; only the backup buttons are disabled.
6. Killing Stockiha from Task Manager during a test, then starting it again, removes the leftover test server and folder within a minute.
7. Policy OFF hides Test; Create/Check/Copy still work.

---

## PART 9 — WS-H-5: REAL RESTORE AND NEW-PC RESTORE

**Goal:** An administrator can replace the shop's current data with a chosen backup from inside Stockiha, safely. On a brand-new installation, the first screen offers "Restore from a backup" so a shop whose PC died can continue on a new PC.

**Risk class:** data loss. Every step below is mandatory. No step may be reordered.

### H5-01 — Restore primitives (engine)
- **Files:** `infrastructure/safe_upgrade.rs` (visibility only: make `reset_all_schemas` `pub(crate)`, body unchanged); create `recovery_engine/live.rs`.
- **Logic (`live.rs`):**
```rust
pub(crate) async fn migrator_connection(info: &MigratorConnectionInfo) -> Result<PgConnection, EngineError>
    // PgConnectOptions from info; after connect run "SET lock_timeout = '30s'" and "SET statement_timeout = 0".

pub(crate) async fn count_users(conn: &mut PgConnection) -> Result<i64, EngineError>
    // SELECT count(*) FROM iam.users   (to_regclass('iam.users') IS NULL → 0)

pub(crate) async fn wait_for_no_other_sessions(conn: &mut PgConnection, timeout: Duration) -> Result<(), EngineError>
    // loop every 500 ms: SELECT count(*) FROM pg_stat_activity
    //   WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend'
    // 0 → Ok; timeout → Err(RESTORE_DATABASE_BUSY)

pub(crate) async fn replace_database(ctx, info, dump: &Path, with_privileges: bool) -> Result<(), EngineError>
    // 1. conn = migrator_connection; safe_upgrade::reset_all_schemas(&mut conn) → RESTORE_RESET_FAILED; close
    // 2. spawn_blocking tools::run_pg_restore(bin_dir, live target from info, dump, with_privileges, "RESTORE_PG_RESTORE_FAILED")

pub(crate) async fn bring_schema_forward(info) -> Result<bool, EngineError>
    // conn; verdict = check_schema_compatibility; OlderThanBinary → run_all_migrations (→ RESTORE_FORWARD_MIGRATION_FAILED), return true;
    // UpToDate → false; anything else → RESTORE_VERIFY_SCHEMA_FAILED

pub(crate) async fn verify_restored(info, expected: &RestoreControlTotals) -> Result<(), EngineError>
    // conn; check_schema_compatibility must be UpToDate (→ RESTORE_VERIFY_SCHEMA_FAILED);
    // collect_restore_control_totals; journal_balanced must be true (→ RESTORE_JOURNALS_UNBALANCED);
    // totals must equal `expected` field by field (→ RESTORE_VERIFY_TOTALS_MISMATCH; log both JSONs)

pub(crate) struct AssetSwap { previous_root: PathBuf, moved: Vec<(PathBuf, PathBuf)> }
pub(crate) fn swap_in_assets(app_data_dir: &Path, bundle_dir: &Path) -> Result<AssetSwap, EngineError>
    // targets: [("attachments","attachments"), ("generated-documents","generated/customer-documents"), ("company-assets","company-assets")]
    // previous_root = app_data_dir/recovery-asset-previous-<unix>; for each target that exists: create parent in previous_root, rename live dir into it, record move.
    // then create each live target dir and copy the bundle's flat files into it (sync).
    // any error → undo (see restore_previous_assets) and return RESTORE_ASSET_COPY_FAILED
pub(crate) fn restore_previous_assets(swap: &AssetSwap, app_data_dir: &Path) -> bool
    // remove the newly created live target dirs, rename each recorded dir back; true if all succeeded
pub(crate) fn discard_previous_assets(swap: &AssetSwap)
    // remove_dir_all(previous_root), errors ignored (logged)

pub(crate) async fn record_restore_event(info, event: &RestoreEventRow) -> Result<(), EngineError>
    // INSERT INTO operations.restore_events (...) VALUES (...) as migrator (session role = owner)
    // failure is logged but NOT fatal (data is already restored and verified)
```
- **Pitfalls:** `reset_all_schemas` drops every non-system schema including `operations` — so the `RESTORE_LIVE` audit row disappears; that is expected (R16). `lock_timeout` prevents an infinite hang on `DROP SCHEMA`. `pg_stat_activity` visibility for a non-superuser: rows of other roles are visible with limited columns; `datname`/`pid`/`backend_type` are visible — sufficient.
- **Edge cases:** `generated/` parent missing → create it; bundle asset dir missing (format validation guarantees it exists).
- **Verify:** covered by H5-07 ignored tests.

### H5-02 — Fault injection (tests only)
- **Files:** `recovery_engine/live.rs`.
- **Logic:** `#[derive(Default, Clone, Copy)] pub(crate) struct RestoreFaults { pub fail_after_replace: bool, pub fail_verify: bool, pub fail_rollback: bool }`. The worker takes `faults: RestoreFaults`; production always passes `RestoreFaults::default()`. Checks are plain `if faults.x { return Err(...) }` at the named points. Not behind `cfg(test)` (keeps one code path) but no production caller can set them (no IPC field).
- **Verify:** grep in review: only test code constructs non-default faults.

### H5-03 — The restore worker
- **Files:** create `recovery_engine/restore_flow.rs`.
- **Types:**
```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum RestoreStep { ValidateBackup, Preflight, TestRestore, SafetyBackup, StopConnections,
    ReplaceData, UpdateSchema, Verify, RestoreFiles, Record, Rollback, Restart }

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum RestoreStepStatus { Running, Done, Failed, Skipped }

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RestoreProgress { pub step: RestoreStep, pub status: RestoreStepStatus, pub detail_code: Option<String> }

pub(crate) enum RestoreKind {
    Live { safety_destination: PathBuf, actor_username: Option<String>, workstation_id: Option<String> },
    FreshInstall,
}
pub(crate) enum RestoreOutcome {  // serialized per §5.9
    Succeeded { bundle_identifier: String, migrated_forward: bool },
    AbortedBeforeChange { error_code: String, restart_required: bool },
    RolledBack { error_code: String, safety_bundle_identifier: Option<String> },
    RollbackFailed { error_code: String, safety_bundle_path: Option<String>, log_path: String },
}

pub(crate) async fn run_restore(
    ctx: &EmbeddedRecoveryContext,
    bundle_dir: &Path,
    kind: RestoreKind,
    close_app_pool: impl FnOnce() -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>>,   // closes the DatabaseState pool; no-op if unconfigured (the `futures` crate is NOT a dependency — do not add it)
    faults: RestoreFaults,
    emit: impl FnMut(RestoreProgress) + Send,
) -> RestoreOutcome
```
- **Algorithm (each step: emit RUNNING, log, do work, emit DONE / FAILED with detail code). "Pool closed" is a local bool.**
  1. **VALIDATE_BACKUP** — `summary = bundle::inspect_bundle(bundle_dir, true)`; require `summary.restorable` → else `BACKUP_FORMAT_NOT_RESTORABLE` (or `BACKUP_SCHEMA_NEWER_THAN_APP` / `BACKUP_SCHEMA_UNKNOWN` by verdict). Failure → `AbortedBeforeChange { restart_required: false }`.
  2. **PREFLIGHT** — `preflight_backup_binaries`; `info = load_migrator_connection_info` (None → `BACKUP_SCHEMA_VERSION_UNREADABLE`); live db size via migrator; `dump_size`; free space on pgdata parent ≥ `dump_size*4 + 200 MB` (drill) AND, for Live, free space on `safety_destination` ≥ `db_size*2 + 50 MB` → else `BACKUP_INSUFFICIENT_SPACE`. For FreshInstall: `count_users` must be 0 → else `FRESH_RESTORE_NOT_ALLOWED`. Failure → `AbortedBeforeChange { restart_required: false }`.
  3. **TEST_RESTORE** — `report = drill::run_isolated_drill(ctx, &summary)`; failure → `AbortedBeforeChange { restart_required: false }`; `!report.journal_balanced` → `RESTORE_JOURNALS_UNBALANCED`, AbortedBeforeChange. Keep `expected = report.totals`, `will_migrate = report.migrated_forward`.
  4. **SAFETY_BACKUP** — Live: `name = bundle_directory_name(now)` (if exists, sleep 1 s and regenerate, max 3); `backup::create_bundle({destination: safety_destination, bundle_name: name, kind: PreRestore, stage_tag: "restore"})`; then `tools::run_pg_restore_list(bin_dir, safety.dump_path)`; any failure → `RESTORE_SAFETY_BACKUP_FAILED`, AbortedBeforeChange. FreshInstall: emit `SKIPPED`. (The safety backup has no audit row of its own; it is referenced by the restore event.)
  5. **STOP_CONNECTIONS** — `close_app_pool().await`; `pool_closed = true`; `conn = migrator_connection`; re-check for FreshInstall `count_users == 0` (race guard) → else `FRESH_RESTORE_NOT_ALLOWED`; `wait_for_no_other_sessions(conn, 15 s)`; close conn. Failure → `AbortedBeforeChange { restart_required: true }`.
     *From here on the live data may change. Every failure goes to ROLLBACK.*
  6. **REPLACE_DATA** — `live::replace_database(ctx, &info, dump, true)`; then `if faults.fail_after_replace { Err(RESTORE_PG_RESTORE_FAILED) }`.
  7. **UPDATE_SCHEMA** — `migrated = live::bring_schema_forward(&info)`; if `migrated != will_migrate` → log a warning only (not fatal). If not needed emit `SKIPPED`.
  8. **VERIFY** — `live::verify_restored(&info, &expected)`; `if faults.fail_verify { Err(RESTORE_VERIFY_TOTALS_MISMATCH) }`.
  9. **RESTORE_FILES** — `swap = live::swap_in_assets(app_data_dir, bundle_dir)`.
  10. **RECORD** — `record_restore_event` with: `restore_mode` LIVE/FRESH_INSTALL, `bundle_identifier`, `backup_kind` (summary), `bundle_schema_version`, `restored_schema_version = embedded_latest_version().to_string()`, `migrated_forward`, `actor_username`, `workstation_id`, `safety_bundle_identifier`. Non-fatal. Then `live::discard_previous_assets(&swap)`. Log `SUCCEEDED`.
  11. Return `Succeeded` (the RESTART step is emitted by the command layer, H5-04).
  **ROLLBACK (failure in steps 6–9):** emit `ROLLBACK RUNNING`; `if faults.fail_rollback { → RollbackFailed }`.
   - If assets were swapped: `restore_previous_assets` (false → RollbackFailed with `RESTORE_ASSET_COPY_FAILED`).
   - Live: `replace_database(ctx, &info, safety.dump_path, true)`; then `check_schema_compatibility == UpToDate` (the safety backup was taken at the current schema) → Ok → emit `ROLLBACK DONE` → `RolledBack { error_code: <original step code>, safety_bundle_identifier }`.
   - FreshInstall: `reset_all_schemas` + `schema_version::run_all_migrations` (recreates the empty current schema) → `RolledBack { safety_bundle_identifier: None }`.
   - Any rollback error → emit `ROLLBACK FAILED` → `RollbackFailed { error_code: "RESTORE_ROLLBACK_FAILED", safety_bundle_path: Some(path) (Live) / None, log_path: app_data_dir/recovery.log }`. The safety bundle is NEVER moved or deleted in this case.
   - Live rollback success: the `RESTORE_LIVE` audit row (inserted before the safety backup) exists again → the command layer completes it as FAILED (H5-04).
- **Pitfalls:** the order "safety backup → close pool" matters (pg_dump needs the database; the app must not write after the safety copy — the frontend takeover screen already blocks input); never delete `swap.previous_root` before VERIFY and RESTORE_FILES succeed; the drill totals and the live totals are both computed after forward migration, so they are comparable.
- **Edge cases:** restoring a backup identical to current data → still works; restoring a `PRE_RESTORE` safety backup (undoing a restore) → allowed, it is a normal format-2 bundle; power cut or crash during REPLACE_DATA/UPDATE_SCHEMA → see §12 E-24 (the database comes back empty, the app brings it to an empty current schema on the next start, and the first-run "Restore from a backup instead" path restores the `PRE_RESTORE` safety copy).
- **Verify:** H5-07.

### H5-04 — Commands
- **Files:** `commands/recovery.rs`, `application/recovery_embedded.rs`, `domain/recovery.rs`, `lib.rs`.
- **`restore_backup_live(app, state: State<DatabaseState>, pg_handle: State<Arc<Mutex<EmbeddedPostgresHandle>>>, session_token, request: RestoreBackupLiveRequest { request_id, bundle_path, confirmation_text })`:**
  1. `request.validate()`: request id rule; path rule; `confirmation_text.trim() == "RESTORE"` (case-sensitive) else `VALIDATION_ERROR` (log `RESTORE_CONFIRMATION_INVALID`).
  2. Mode must be EMBEDDED else `RECOVERY_UNAVAILABLE`.
  3. `lease = RecoveryOperationLease::acquire()?` (the lease value is moved into the worker thread; make the struct `pub(crate)` inside the module if needed).
  4. `pool = db::pool_or_unavailable(state)?.clone()`.
  5. `(path, name) = canonical_bundle_anywhere(bundle_path)` → error mapping.
  6. `envelope = SELECT operations.begin_recovery_attempt(token, request_id, 'RESTORE_LIVE', name)`; status `SUCCEEDED`/`FAILED` (replay of an old request) → return `VALIDATION_ERROR` (a live restore request id is never replayed); `STARTED` with `is_replay=true` → `RECOVERY_OPERATION_IN_PROGRESS`.
  7. Resolve `actor_username` and `workstation_id`: `SELECT u.username, a.workstation_id FROM operations.recovery_attempts a JOIN iam.users u ON u.id = a.actor_id WHERE a.id = $1` — run through a migrator connection (runtime cannot read that table).
  8. Read the stored destination through a migrator connection (`SELECT backup_destination_path FROM operations.recovery_settings WHERE singleton`), then `safety_destination = destination::resolve(stored, ctx, Automatic)?.path`.
  9. Spawn `std::thread::spawn(move || tauri::async_runtime::block_on(async move { ... }))` (same pattern as `commands/safe_upgrade.rs`) and return `Ok(RestoreStarted { started: true })`.
  10. Inside the thread: `outcome = run_restore(ctx, path, RestoreKind::Live{..}, move || Box::pin(async move { pool_for_close.close().await }), RestoreFaults::default(), |p| { let _ = emit_app.emit("recovery-restore-progress", &p); })`.
      - `Succeeded` → emit `RESTART RUNNING`; emit outcome; sleep 1500 ms (lets the UI show "Done"); stop the embedded server exactly as `commands/embedded_setup.rs` does (take `child` from the handle, `stop_postgres`, `child.wait()`; if no child, call `pg_process::stop_embedded_postgres_if_running`); drop lease; `tauri::process::restart(&app.env())`.
      - `AbortedBeforeChange` → complete the audit row FAILED via a migrator connection: `SELECT operations.complete_recovery_attempt($token, $attempt_id, false, $code, NULL)` (the function is owned by `stockiha_owner`, so the migrator/owner session may execute it); emit outcome.
      - `RolledBack` → same completion call (the row exists again), emit outcome.
      - `RollbackFailed` → do NOT attempt completion; emit outcome; log.
      - Drop lease at the end of the thread in all cases.
- **`inspect_backup_for_fresh_install(app, request { bundle_path })`:** mode EMBEDDED; lease; migrator connection `count_users == 0` else `FRESH_RESTORE_NOT_ALLOWED`; `canonical_bundle_anywhere`; `inspect_bundle(path, true)` in `spawn_blocking`; return `BackupListItem` built from the summary (`totalBytes` from stats).
- **`restore_backup_fresh_install(app, state, pg_handle, request { bundle_path })`:** mode EMBEDDED; lease; `count_users == 0` else `FRESH_RESTORE_NOT_ALLOWED`; canonical path; spawn worker with `RestoreKind::FreshInstall`; `close_app_pool` = close the pool if `DatabaseState::Configured`, else no-op; outcomes: same as live but no audit completion; `Succeeded` → stop server + restart.
- **`restart_after_recovery(app, pg_handle)`:** stop the embedded server as above, then `tauri::process::restart(&app.env())`. Registered in `generate_handler!`.
- **Pitfalls:** `State<'_, T>` cannot move into a thread — clone the `Arc` from `pg_handle.inner()` and clone the `PgPool` (cheap `Arc`); the `AppHandle` is `Clone + Send`. Never call `restart` while the embedded server is still owned by this process (WS-K-4.7 orphan bug).
- **Verify:** clippy; unit test for `RestoreBackupLiveRequest::validate` (exact word, whitespace trimmed, lowercase rejected).

### H5-05 — Takeover screen (frontend)
- **Files:** create `src/features/settings/recovery/RecoveryTakeoverContext.tsx`, `LiveRestoreScreen.tsx`, `RestoreConfirmDialog.tsx`; edit `src/App.tsx` (wrap `<AppRouter />` with `<RecoveryTakeoverProvider>` inside `SessionProvider`); edit `src/app/AppRouter.tsx` (first statement of `AppRouter` render: `const takeover = useRecoveryTakeover(); if (takeover.request) return <LiveRestoreScreen request={takeover.request} />;`); edit `BackupList.tsx` (add "Restore…" action when `canRestoreLive && item.restorable`); gateway/DTO/commands (`RESTORE_BACKUP_LIVE`, `RESTORE_BACKUP_FRESH_INSTALL`, `INSPECT_BACKUP_FOR_FRESH_INSTALL`, `RESTART_AFTER_RECOVERY`, event names `RECOVERY_RESTORE_PROGRESS_EVENT = 'recovery-restore-progress'`, `RECOVERY_RESTORE_OUTCOME_EVENT = 'recovery-restore-outcome'`, `RESTORE_STEPS` constant array in §5.9 order).
- **Context:**
```ts
type TakeoverRequest =
  | { kind: 'LIVE'; sessionToken: string; bundlePath: string; bundleIdentifier: string; requestId: string; confirmationText: string }
  | { kind: 'FRESH_INSTALL'; bundlePath: string; bundleIdentifier: string };
interface RecoveryTakeover { request: TakeoverRequest | null; begin(r: TakeoverRequest): void; }
```
  `begin` can only be called once per app process (subsequent calls ignored).
- **RestoreConfirmDialog** (own markup with `sk-modal*` classes because the confirm button must be disabled until valid): title "Replace your data with this backup?"; body lists: backup date (local), type; warning Banner (tone warning): "Everything recorded in Stockiha after {date} will be removed: sales, purchases, stock changes, customers, users. Before anything changes, Stockiha tests this backup and saves a safety copy of today's data. Stockiha will restart at the end."; if `schemaVerdict === 'OLDER'`: info "This backup is from an older version; it will be updated automatically."; checkbox "I understand that recent data will be removed."; text field label "Type RESTORE to confirm"; confirm button "Restore now" (`variant="danger"`, which exists in `ButtonVariant`) enabled only when checkbox checked AND `value.trim() === 'RESTORE'`; cancel button.
  If a cash session is open (`useSession().activeCashSession !== null`) the dialog shows an error Banner "Close the open cash session before restoring." and the confirm button stays disabled.
- **LiveRestoreScreen** (model on `DatabaseUpgradeScreen.tsx`):
  1. On mount: subscribe to both events (`listen`), THEN invoke `restore_backup_live` (LIVE) or `restore_backup_fresh_install` (FRESH_INSTALL). Use a `startedRef` so React StrictMode double-mount invokes only once.
  2. If invoke rejects → show error Banner with `useErrorText` and a "Restart Stockiha" button (calls `restartAfterRecovery()`); nothing was changed in this case except possibly nothing — the text says "The restore did not start. Your data was not changed."
  3. Checklist: all steps except `ROLLBACK` and `RESTART` always shown; `ROLLBACK` shown only once it reports; `SKIPPED` rendered as "Not needed".
  4. Outcome views:
     - SUCCEEDED: success Banner "Restore complete. Stockiha is restarting…" (+ "It was updated to the current version." if `migratedForward`).
     - ABORTED_BEFORE_CHANGE: warning Banner "The restore was stopped before anything changed. Your data is exactly as it was." + localized reason from `errorCode` (map detail codes to the IPC-level messages of §5.7 via a small table `detailCodeToMessageKey`) + "Restart Stockiha" button (always shown; required when `restartRequired`).
     - ROLLED_BACK: warning Banner "The restore failed and your data was put back exactly as it was before." + reason + "A safety copy is kept in your backups list: {safetyBundleIdentifier}." + "Restart Stockiha".
     - ROLLBACK_FAILED: error Banner "The restore failed and Stockiha could not put your data back automatically. Do not use Stockiha. Contact your supplier now and give them this information:" + a read-only box with `errorCode`, `safetyBundlePath`, `logPath`, `APP_VERSION_MARKER` + "Copy details" button (clipboard, like `DatabaseUpgradeScreen`) + "Restart Stockiha".
  5. The screen shows `APP_VERSION_MARKER` in its footer.
  6. No navigation, no logout, no other UI is rendered while the takeover is active.
- **Pitfalls:** subscribe before invoking (events emitted before `listen` resolves are lost); unlisten on unmount; do not call any other IPC command while the takeover screen is up (the pool is closed); in `AppRouter`, call `useRecoveryTakeover()` together with the other hooks at the top of the component and put the `if (takeover.request)` check immediately after the last hook — never call a hook after an early return (React rules of hooks).
- **Verify:** H5-07.

### H5-06 — New-PC restore (frontend)
- **Files:** create `src/features/settings/recovery/FreshInstallRestoreScreen.tsx`; edit `src/features/setup/SetupScreen.tsx`.
- **SetupScreen change:** on mount call `getRecoveryMode()` (ignore errors → treat as not EMBEDDED). If EMBEDDED, render below the form a secondary Button "Restore from a backup instead". Clicking sets local state `restoreMode = true`, which renders `<FreshInstallRestoreScreen onBack={() => setRestoreMode(false)} />` instead of the form.
- **FreshInstallRestoreScreen:** title "Restore from a backup"; text "Use this if Stockiha was used on another computer. Choose the backup folder (for example on a USB stick). Your user accounts and all data will come from the backup."; button "Choose backup folder…" (native picker) → `inspectBackupForFreshInstall({bundlePath})` → show date, type, version status, size; if `!restorable` show error Banner `errors.backupNotRestorable` and no restore button; else checkbox "I understand this installation will use the data from this backup." + button "Restore" → `takeover.begin({kind:'FRESH_INSTALL', bundlePath, bundleIdentifier})`. Error from inspect with `FRESH_RESTORE_NOT_ALLOWED` → error Banner and a Back button. "Back" returns to the setup form.
- **After restart:** `get_setup_status.initialized` is true (the backup contains the admin, warehouse, fiscal period and workstation) → Login screen. If the restored backup was itself never initialized (edge case) → setup form appears again; acceptable.
- **Verify:** H5-07.

### H5-07 — Tests
- **Ignored real-PG (Windows), in `recovery_engine/restore_flow.rs` tests, using `safe_upgrade::test_support`:**
  1. `live_restore_replaces_data_and_keeps_a_safety_copy`: provision; seed marker A (insert into `finance.accounts` like the WS-K-5 test, code `998`); create backup; seed marker B (`997`); run `run_restore(Live)`; assert outcome Succeeded; A present, B absent; `check_schema_compatibility == UpToDate`; one row in `operations.restore_events` with `restore_mode = 'LIVE'`; a `PRE_RESTORE` bundle exists in the safety destination and, when itself tested with `run_isolated_drill`, contains B.
  2. `live_restore_of_older_backup_migrates_forward`: backup made after deleting the newest `_sqlx_migrations` row; outcome Succeeded with `migrated_forward = true`; schema UpToDate.
  3. `failure_after_replace_rolls_back_exactly`: seed A, backup, seed B, `faults.fail_after_replace = true` → `RolledBack`; A and B both present; UpToDate.
  4. `verify_mismatch_rolls_back`: `faults.fail_verify = true` → `RolledBack`; asset folders are the pre-restore ones (put a file `attachments/before.txt` before; bundle has `attachments/in-backup.txt`; after rollback only `before.txt` exists).
  5. `failed_rollback_keeps_safety_bundle_in_place`: `fail_after_replace + fail_rollback` → `RollbackFailed` with `safety_bundle_path` pointing to an existing folder.
  6. `newer_backup_is_refused_before_any_change`: outcome `AbortedBeforeChange`, no safety bundle created, data unchanged.
  7. `fresh_install_restore_brings_users`: provision fresh (0 users); source instance with 1 user → bundle; `run_restore(FreshInstall)` → Succeeded; users = 1.
  8. `fresh_install_refused_when_users_exist`: → AbortedBeforeChange `FRESH_RESTORE_NOT_ALLOWED`.
  9. `busy_database_aborts_before_change`: hold an extra `stockiha_runtime`-equivalent connection (connect as migrator from the test and keep it open — it counts as another client backend) → `AbortedBeforeChange` `RESTORE_DATABASE_BUSY`, `restart_required = true`, data unchanged.
  After every test: live test server still answers (except where the test stops it), no `restore-drill-*` folder remains.
- **Vitest:** confirm dialog gating (checkbox + exact word; lowercase `restore` rejected; open cash session blocks); `begin` called with the right payload; AppRouter renders LiveRestoreScreen when a request exists; LiveRestoreScreen calls `listen` twice before `invoke` (assert call order on mocks); renders each outcome; "Copy details" writes the expected text; "Restart Stockiha" invokes `restart_after_recovery`; SetupScreen shows the restore link only for EMBEDDED; FreshInstallRestoreScreen: non-restorable backup hides Restore; `FRESH_RESTORE_NOT_ALLOWED` message.
- `APP_VERSION_MARKER = 'WS-H-5.0'`; append §M5 to `WS-H-MANUAL-VERIFICATION.md`.

### H5 Acceptance criteria
1. Gates pass, including all nine ignored restore tests on Windows.
2. Installed build: make a backup, record a sale, restore the backup → Stockiha restarts, the sale is gone, login works, a "Before restore" backup appears in the list, restoring that one brings the sale back.
3. Cancelling the dialog, or typing anything other than `RESTORE`, never starts a restore.
4. With a cash session open, Restore cannot be confirmed.
5. New PC: install Stockiha, finish first-run database setup, choose "Restore from a backup instead", pick the USB copy → Stockiha restarts to the login screen and the old admin password works; products and balances match the old PC.
6. Task Manager after each restore shows exactly one Stockiha-owned `postgres.exe` group (the live server), no leftovers.

---

## PART 10 — WS-H-6: AUTOMATIC BACKUPS

**Goal:** A full backup is taken before every update install (Owner ruling), and once a day automatically. Old automatic backups are cleaned up. The admin is warned when no backup has been made for 7 days.

### H6-01 — Automatic backup (application layer)
- **Files:** `application/recovery_embedded.rs`, `domain/recovery.rs`.
- **DTOs:** `RunAutomaticBackupRequest { request_id: String, reason: String }` with `validate()`: request id rule; `reason ∈ {"DAILY","PRE_UPDATE"}` else validation error. Response `AutomaticBackupResponse { status: String, skip_reason: Option<String>, result: Option<OperatorBackupCreationResult>, used_fallback_destination: bool }` (camelCase).
- **Logic `run_automatic_backup(pool, token, ctx, request)`** (lease already held by the command):
  1. `reason == DAILY`: `status = SELECT operations.get_backup_status($1)`; parse `last_success_at` (`time::OffsetDateTime::parse(s, &Rfc3339)`; PostgreSQL's jsonb timestamp text is RFC3339-compatible; if parsing fails treat as "not due" and log). If `now - last_success_at < 20 h` → return `SKIPPED/NOT_DUE`.
  2. Candidate name `bundle_directory_name(now)`; `SELECT operations.begin_automatic_backup_attempt($token, $request_id, $name)`; parse the same envelope as `recovery_creation::CreationAttemptEnvelope` (make that struct `pub(crate)`); replay SUCCEEDED → return `CREATED` with stored result; FAILED → error; STARTED → continue. Collision (`IdempotencyConflict` on a fresh request) → sleep 1 s, new name, max 3.
  3. `stored = get_backup_destination_setting` (note: this SQL function requires `CREATE_BACKUP_BUNDLE`; a cashier session would be denied). Therefore read the stored path through a **migrator connection** instead: `SELECT backup_destination_path FROM operations.recovery_settings WHERE singleton`. Then `destination::resolve(stored, ctx, Automatic)`.
  4. `backup::create_bundle({kind: Daily|PreUpdate, stage_tag: attempt_id})`.
  5. Success → `SELECT operations.complete_automatic_backup_attempt($token, $attempt_id, true, NULL, $result_json)`; run retention (H6-02) for this kind, excluding the new folder; return `CREATED` with `used_fallback_destination`.
  6. Failure → complete with `false`, detail code; return the mapped `AppError`.
- **Pitfalls:** automatic backups must work for any role (cashier clicks "Update") — hence the migrator read in step 3; never widen `get_backup_destination_setting`'s permission.
- **Edge cases:** clock moved backwards (last success in the future) → treat as due (`now - last < 0` → due); destination USB unplugged → fallback default, `usedFallbackDestination=true`.

### H6-02 — Retention
- **Files:** create `recovery_engine/retention.rs`; edit `recovery_engine/restore_flow.rs` step RECORD (after the event insert: apply retention for `PRE_RESTORE` in `safety_destination`, excluding the safety bundle just made).
- **Logic:**
```rust
pub(crate) fn keep_count(kind: BackupKind) -> Option<usize>  // Daily→14, PreUpdate→5, PreRestore→5, Manual→None
pub(crate) fn select_for_deletion(items: &[BackupListItemDto], kind: BackupKind, exclude: &Path) -> Vec<PathBuf>
    // candidates: manifest_readable && backup_kind == kind.as_str() && path != exclude
    // sort by created_at_utc desc (None = oldest); keep the first keep_count-1 (the excluded new one counts as one kept); return the rest
pub(crate) fn apply(root: &Path, kind: BackupKind, exclude: &Path, app_data_dir: &Path) -> usize
    // items = catalog::list_bundles(root, true) — NOTE list is capped at 200; for retention call an uncapped variant `list_bundles_uncapped`
    // for each selected path: must be a direct child of root (parent equality after dunce) and name canonical → remove_dir_all; log each deletion; return count
```
- **Pitfalls:** never delete `MANUAL` or `UNKNOWN`; never delete anything outside `root`; retention failures are logged, never returned as errors.
- **Verify:** unit tests: 20 DAILY + 3 MANUAL + 2 UNKNOWN → 6 DAILY deleted (14 kept incl. new), MANUAL/UNKNOWN untouched; exclude honoured; `None` dates deleted first.

### H6-03 — Command
- **Files:** `commands/recovery.rs`, `lib.rs`, `shared/ipc/commands.ts` (`RUN_AUTOMATIC_BACKUP: 'run_automatic_backup'`), gateway `runAutomaticBackup(token, request)`, DTO.
- **Logic:** `run_automatic_backup(app, state, session_token, request)`:
  1. Validate the request.
  2. Mode EXTERNAL (developer machine) → `Ok(SKIPPED/MODE_UNSUPPORTED)` for both reasons.
  3. Mode UNAVAILABLE → DAILY: `Ok(SKIPPED/MODE_UNSUPPORTED)`; PRE_UPDATE: `Err(RECOVERY_UNAVAILABLE)` — a client machine that cannot back up must not update silently (Owner ruling).
  4. Lease: DAILY → if busy return `Ok(SKIPPED/BUSY)`; PRE_UPDATE → if busy return `Err(RECOVERY_OPERATION_IN_PROGRESS)`.
  5. Call H6-01.
- **Verify:** unit test for request validation.

### H6-04 — Backup before every update
- **Files:** `src/features/update/useAppUpdate.ts`, `src/features/update/UpdateBanner.tsx`, `src/shared/i18n/locales.ts`, `tests/update-engine.test.tsx` (and any other file found by `grep -rl useAppUpdate tests src`).
- **Changes:**
  1. `UseAppUpdateOptions` gains `sessionToken: string | null`.
  2. `AppUpdateState` gains `phase: 'idle' | 'downloading' | 'backing_up' | 'installing'` and `errorKind: 'download' | 'backup' | 'install' | null`. `installing` stays and equals `phase !== 'idle'`.
  3. `performUpdate` new sequence:
```ts
if (cashSessionOpenRef.current) return;
if (!update) return;
if (!sessionTokenRef.current) { setState(e => ({...e, errorKind: 'backup', error: 'login required'})); return; }
setPhase('downloading');            await update.download();                         // failure → errorKind 'download'
setPhase('backing_up');             const backup = await runAutomaticBackup(token, { requestId: `auto-update-${Date.now()}`, reason: 'PRE_UPDATE' });
                                    // any throw → errorKind 'backup'; STOP (do not call prepare/install)
                                    // backup.status must be 'CREATED' or (SKIPPED && skipReason === 'MODE_UNSUPPORTED'); anything else → errorKind 'backup'; STOP
setPhase('installing');             await invoke(PREPARE_FOR_UPDATE_INSTALL); stoppedDatabase = true;
                                    await update.install();                          // failure → errorKind 'install' (+ existing resume logic)
```
     Keep the existing `stoppedDatabase` / `RESUME_AFTER_FAILED_UPDATE_INSTALL` logic unchanged.
  4. `UpdateBanner`: get `const { user } = useSession();` and pass `sessionToken: user?.token ?? null`. Show `t('update.downloading')` / `t('update.backingUp')` / existing `t('update.installing')` by phase. When `errorKind === 'backup'` show `t('update.backupFailed')` instead of the raw message; other error kinds keep today's behaviour.
  5. New i18n keys (fr/en real, ar TODO): `update.downloading` "Downloading the update…", `update.backingUp` "Saving a safety backup before updating… this can take a minute or two.", `update.backupFailed` "The update was not installed because the safety backup failed. Check the backup folder in Settings, then try again."
- **Pitfalls:** use a ref for the token (same stale-closure reason as `cashSessionOpenRef`); a forced update must still never block trading — a failed backup only leaves the banner showing the error.
- **Verify:** vitest: call order `download` → `run_automatic_backup` → `prepare_for_update_install` → `install`; backup throws → neither prepare nor install called and `errorKind === 'backup'`; `SKIPPED/MODE_UNSUPPORTED` → continues; `SKIPPED/BUSY` cannot occur for PRE_UPDATE but if returned → treated as failure; no token → nothing called after the guard.

### H6-05 — Daily trigger and overdue warning
- **Files:** `src/app/AppRouter.tsx` (`AuthenticatedApp` only), `src/shared/i18n/locales.ts`.
- **Logic:**
  1. Module-level `let dailyBackupTimer: number | null = null; let dailyBackupDone = false;`.
  2. `useEffect` on `user?.token`: if token and `!dailyBackupDone` and `dailyBackupTimer === null` → `dailyBackupTimer = window.setTimeout(() => { dailyBackupDone = true; dailyBackupTimer = null; void runAutomaticBackup(token, { requestId: \`auto-daily-${Date.now()}\`, reason: 'DAILY' }).then(refreshBackupWarning).catch(() => {}); }, 60_000)`. Cleanup: if the timer has not fired, `clearTimeout` and reset `dailyBackupTimer = null`.
  3. Overdue warning: on mount (and after the daily call) fetch `getRecoveryCapabilities`; if `canCreateBackup` fetch `getBackupStatus`; show `Banner tone="warning"` (testId `backup-overdue-warning`) under the config warning when `lastSuccessAt` is null or older than 7 days: text `t('recovery.overdueWarning')` "No backup has been made in the last 7 days." with a Button `t('recovery.overdueAction')` "Open backup settings" → `setView('settings')`. Errors → no banner.
- **Pitfalls:** do not block rendering; do not fire during takeover (AppRouter returns the takeover screen before `AuthenticatedApp` mounts, so the effect is not running then — keep it that way).
- **Verify:** vitest with fake timers: nothing before 60 s; one call after; remount does not call again; logout before 60 s → no call; banner shown for null/old dates, hidden for recent, hidden for non-admin capabilities.

### H6-06 — Tests, marker, manual
- Ignored real-PG: `automatic_daily_backup_skips_when_recent` (create manual, then DAILY → NOT_DUE); `automatic_backup_works_for_cashier_session` (DB-level: cashier token begins/completes AUTO_BACKUP; engine creates the bundle); `retention_runs_after_automatic_backup` (15 fake DAILY folders with manifests + 1 real → 14 remain).
- `APP_VERSION_MARKER = 'WS-H-6.0'`; append §M6.

### H6 Acceptance criteria
1. Gates pass.
2. Installing an update from the banner shows "Saving a safety backup…", then installs; a "Before update" backup appears in the list after restart.
3. With the backup folder set to an unplugged USB drive, the update still backs up (to the default folder) and installs; the result says the default folder was used (visible in the list).
4. If the backup cannot be made at all (e.g. disk full), the update is not installed and the banner explains why; Stockiha keeps working.
5. A minute after the first login of the day, a "Daily automatic" backup appears; logging in again the same day does not create another.
6. After 15+ days of daily backups only 14 daily ones remain; manual backups are never deleted.
7. An admin who has no backup for 7 days sees the warning on every screen, with a button to the backup settings.

---

## PART 11 — WS-H-7: TRANSLATIONS AND DOCUMENTATION (Gemini)

**Hard limits for this sub-plan:** edit only `src/shared/i18n/locales.ts`, the Markdown files listed below, `src/shared/version.ts`, and tests that assert exact translated text. No Rust, no TypeScript logic, no CSS, no migrations.

### H7-01 — Arabic
- Find every line marked `// TODO(WS-H-7)` in `locales.ts` (and every `recovery.*`, `errors.recoveryUnavailable`, `errors.backupDestinationUnavailable`, `errors.backupNotRestorable`, `errors.restoreTestFailed`, `errors.freshRestoreNotAllowed`, `errors.backupCopyFailed`, `errors.insufficientDiskSpace`, `update.downloading`, `update.backingUp`, `update.backupFailed` key in the `ar` dictionary). Replace the English value with Arabic; delete the TODO comment.
- Glossary (use exactly): backup = نسخة احتياطية; backups = النسخ الاحتياطية; restore (verb) = استرجاع; safety copy = نسخة أمان; backup folder = مجلد النسخ الاحتياطية; test (a backup) = اختبار; check (validate) = فحص; daily automatic = تلقائية يومية; before update = قبل التحديث; before restore = قبل الاسترجاع; copy to… = نسخ إلى…; restart Stockiha = إعادة تشغيل Stockiha; cash session = حصة الصندوق (match the existing Arabic used for cash session elsewhere in `locales.ts` — search for `cash` keys and reuse their term).
- Keep `RESTORE` in Latin letters inside the Arabic confirmation label: "اكتب RESTORE للتأكيد".
- Keep `{placeholders}` exactly.

### H7-02 — French review
- Glossary: backup = sauvegarde; restore = restauration / restaurer; safety copy = copie de sécurité; backup folder = dossier de sauvegarde; test = tester; check = vérifier; daily automatic = automatique quotidienne; before update = avant mise à jour; before restore = avant restauration.
- Use the typographic apostrophe `’` consistently with the surrounding French strings.
- Keep `RESTORE` untranslated in the confirmation label: "Tapez RESTORE pour confirmer".

### H7-03 — Documents
1. `docs/recovery/RESTORE_PROCEDURE.md`: add at the top a section "Installed Stockiha (WS-H-5 and later)" explaining in plain language: restore from Settings → Backup and recovery → Your backups → Restore…; new PC → first-run screen → "Restore from a backup instead"; the command-line procedure below applies only to developer/`run.bat` databases. Add the E-24 recovery path (§12).
2. `CURRENT_STEP.md`: replace the WS-H row status with "Repaired for installed builds — WS-H-3..WS-H-6 accepted on <dates filled by Owner>" and a two-sentence summary.
3. `STOCKIHA_GROUND_TRUTH.md` §4 WS-H (explicitly authorized): replace "Current status: Not yet trusted…" and the MVP list with: Current status: repaired for embedded installs (WS-H-3..6). MVP: manual backup bundles with checksum validation; backup list and copy to external drive; isolated restore test; in-app restore with automatic safety copy and rollback; restore on a new PC; automatic backup before every update and daily local backup with retention. Future: cloud/off-device sync, encryption, scheduled backups at chosen times.
4. `docs/slices/R6-001-operator-backup-validation.md` and `R6-002-controlled-restore-verification.md`: add one line under the title: "> Installed (embedded) builds: superseded by WS-H-3..WS-H-6. This document now describes only the developer (`run.bat`) path."
5. `WS-H-MANUAL-VERIFICATION.md`: ensure it contains §M3–§M6 plus §M7 (full end-to-end run).
- `APP_VERSION_MARKER = 'WS-H-7.0'`.
- **Verify:** `npm run typecheck`, `npm run lint`, `npm test -- --run`, `npm run build` (update text-asserting tests only where Arabic/French strings changed).

---

## PART 12 — EDGE-CASE CATALOGUE

| ID | Situation | Required behaviour | Covered in |
|---|---|---|---|
| E-01 | Two recovery actions clicked quickly | Second refused with `RECOVERY_OPERATION_IN_PROGRESS` | existing lease |
| E-02 | Two backups in the same second (manual + daily) | Unique index + folder check → retry with the next second, max 3 | H3-07, H6-01 |
| E-03 | No destination ever chosen | Default `operator-backups` folder, shown as default | H3-04 |
| E-04 | Destination on unplugged USB | Manual: `BACKUP_DESTINATION_UNAVAILABLE`; automatic: default folder + flag | H3-04, H6-01 |
| E-05 | Destination inside `pgdata` or install folder | Refused on save | H3-04 |
| E-06 | Destination on the same disk as data | Saved, warning shown | H3-04, H3-09 |
| E-07 | Disk full | `INSUFFICIENT_DISK_SPACE` before any heavy work | H3-07, H4-03, H5-03 |
| E-08 | FAT32 USB and dump > 4 GB | `pg_dump` fails → `BACKUP_PG_DUMP_FAILED`; staging removed | H3-07 |
| E-09 | Backup folder renamed by the user | Name not canonical → `BACKUP_BUNDLE_NAME_INVALID`; not listed | H3-05, H4-01 |
| E-10 | One byte changed in a backup | Validation fails; never repaired | H3-05 |
| E-11 | Old format-1 backup (developer machine) | Check and Test work; Restore hidden/refused | R3, H3-05 |
| E-12 | Backup from a newer Stockiha | Listed as "Newer"; Restore refused before anything starts | H4-04, H5-03 |
| E-13 | Backup from an older Stockiha | Restored and migrated forward | H4-04, H5-03 |
| E-14 | Backup whose migration history differs (tampered/foreign build) | `DRILL_MIGRATION_HISTORY_MISMATCH` → not restorable | H4-04 |
| E-15 | Backup with unbalanced journals | Test reports it; Restore refused | H4-04, H5-03 |
| E-16 | App killed during a test | Leftover test server stopped and folder removed at next start | H4-08 |
| E-17 | PID in an abandoned test folder reused by the live server | Never signalled | H4-08 |
| E-18 | Antivirus locks the test folder | Success with `cleanupPending`; removed at next start | H4-03 |
| E-19 | Cash session open when restoring | Confirm disabled | H5-05 |
| E-20 | Another connection to the live DB during restore | Abort before change (`RESTORE_DATABASE_BUSY`), restart offered | H5-03 |
| E-21 | Restore fails after data replaced | Automatic rollback from safety copy; assets restored | H5-03 |
| E-22 | Rollback also fails | Critical screen with safety copy path and log path; nothing deleted | H5-03, H5-05 |
| E-23 | Restore request id reused | `VALIDATION_ERROR` (never replayed) | H5-04 |
| E-24 | Power cut during data replacement | On restart: the database is empty → the upgrade screen rebuilds an empty current schema → first-run setup appears (0 users) → "Restore from a backup instead" → choose the newest "Before restore" backup in the backup folder (path also in `recovery.log`) | H5-03, H7-03 |
| E-25 | New-PC restore attempted after an admin was created | `FRESH_RESTORE_NOT_ALLOWED` | H5-04 |
| E-26 | New-PC backup's saved destination (old PC's E:\) missing | Status shows "not available"; automatic backups fall back to default; admin changes folder | H3-04 |
| E-27 | Cashier clicks "Update" | Pre-update backup still runs (session-only authorization) | H6-01 |
| E-28 | Update clicked while a manual backup runs | Pre-update backup refused as busy → update not installed, message shown | H6-03 |
| E-29 | Developer machine with `run.bat` and an old `migrator.json` in app data | EXTERNAL mode wins; embedded code never targets the embedded cluster | R1, H3-01 |
| E-30 | `recovery.log` not writable | Logging silently skipped; operations unaffected | H3-01 |
| E-31 | Very large database (several GB) | No timeouts on dump/restore; UI shows spinner/progress; space checks scale with size | H3-07, H4-04 |
| E-32 | Windows path with spaces or Arabic user name | Bundles/destination use Rust std paths (Unicode-safe); test cluster lives next to `pgdata`, which is already ASCII-safe by `resolve_pgdata_dir`; non-ASCII drill root refused with `DRILL_PATH_NOT_ASCII` | H4-03 |
| E-33 | Restore-test policy OFF | Test hidden/refused; Restore still allowed (its internal test is mandatory) | R13 |
| E-34 | Session expired mid-operation | DB calls fail with `SESSION_INVALID`; attempt left STARTED; next login allowed (new request ids) | existing |
| E-35 | Clock changed | Daily due check treats future timestamps as due | H6-01 |

---

## PART 13 — TESTING PLAN (summary matrix)

| Layer | What | Where | Runs on |
|---|---|---|---|
| Unit (Rust) | mode resolver, error mapping, schema verdict, destination rules, bundle format 2 write/read/tamper, canonical path checks, list scan, copy, retention selection, sweep selection, request validation, newest-migration schema_state guard | `recovery_engine/*` tests, `backup_proof` tests, `schema_version` tests, `domain/recovery.rs` tests | CI + Windows |
| Integration (SQL) | permissions per role, capabilities, automatic attempt ownership, RESTORE_LIVE authorization, status function, unique index, runtime denied on `restore_events`, migration idempotency | `src-tauri/tests/recovery/ws_h_003_recovery_foundation_integration.sql` via `run_current_sql_suites.sh` | CI (PostgreSQL 18) |
| Integration (real embedded PostgreSQL, `#[ignore]`) | create bundle with privileges; drill SAME/OLDER/NEWER/mismatch; drill cleanup; sweep; nine restore scenarios; automatic backup scenarios; WS-K-5 regression | `recovery_engine/*` ignored tests, `safe_upgrade` ignored tests | Windows (`cargo test --lib -- --ignored`) |
| Frontend unit/workflow (Vitest) | capabilities gating, modes, destination states, status line, list, copy, test dialog, restore dialog gating, takeover ordering and outcomes, fresh-install flow, update ordering, daily timer, overdue banner, i18n/RTL | `tests/recovery-*.test.tsx`, update tests | CI + Windows |
| Regression | all existing Rust, SQL, Vitest suites; WS-K-5 upgrade tests; embedded setup E2E (`embedded=153`) | existing | CI + Windows |
| Permission/role | SQL suite + Vitest (cashier sees nothing; cashier can still trigger automatic backup) | as above | CI |
| Boundary | 0 backups, 200+ backups, 0-byte asset folders, max path length 4096, request id 7/8/128/129 chars, confirmation text with spaces/lowercase | unit tests | CI |
| End-to-end manual | installed build on the Owner's test PC and a fresh PC | PART 14 | Owner |

---

## PART 14 — MANUAL WINDOWS ACCEPTANCE (for the Owner, plain language)

Before each round: build the installer yourself (`npm run tauri:build`), install it, and check the version text on the screen shows the right `WS-H-x.y` marker. Paste every result (screenshots welcome) back to Claude without editing.

### §M3 — after WS-H-3
1. Log in as admin → Settings → the "Backup and recovery" card is there and shows a folder path with the note "Default folder…".
2. Click "Create backup now" (or "Create backup"). Wait. You should see a green success message and a status line "Last successful backup: today …".
3. Open that folder in File Explorer. There is a new folder named `GestStock-Backup-…`. Open its `manifest.json` with Notepad and check it contains `"bundle_format_version":2` and `"backup_kind":"MANUAL"`.
4. Copy that backup folder by hand to a USB stick. In Stockiha click Browse (validate), choose the USB copy, click Validate → success.
5. On the USB copy, open `database.dump` with Notepad, change one character, save. Validate again → it must fail.
6. Close Stockiha. In Task Manager, no "PostgreSQL" process should remain. No black window should have appeared at any point.
7. Change the backup folder to a folder on another drive (or USB). Then try to choose the Stockiha installation folder → it must be refused.
8. Log in as a cashier → Settings → the backup card must not be visible.

### §M4 — after WS-H-4
1. Create two backups. The "Your backups" list shows both, newest first, type "Manual", with sizes.
2. On one row click "Copy to…" and choose the USB stick → success message.
3. Click "Open a backup from another folder…", choose the USB copy → it appears as "Selected backup".
4. Click "Test" on a backup → confirm → wait → success, "Journals balanced: Yes", totals shown. While it runs, open another screen (Products) — it must work.
5. After the test, Task Manager shows no extra PostgreSQL processes, and `%APPDATA%\com.raqmenha.stockiha` has no folder starting with `restore-drill-`.
6. Start a Test, and while it runs end Stockiha from Task Manager. Start Stockiha again, wait one minute → the leftover `restore-drill-…` folder is gone.
7. Advanced → turn the test policy OFF → Test buttons disappear; Create, Check and Copy still work. Turn it back ON.

### §M5 — after WS-H-5
1. Create a backup. Then make one cash sale (open a cash session, sell one item, close the session).
2. Backup list → "Restore…" on that backup. Try to confirm without ticking the box or with `restore` in small letters → the button stays disabled. Tick the box, type `RESTORE` → confirm.
3. The full-screen progress shows the steps. Stockiha restarts. Log in. The sale you made is gone.
4. In the backup list there is now a "Before restore" backup. Restore it → after restart the sale is back.
5. Open a cash session, then try Restore → it must refuse until the session is closed.
6. New PC test: on a second computer (or after resetting Stockiha's app data folder), install, let first-run setup finish, click "Restore from a backup instead", choose the USB backup, confirm. Stockiha restarts to the login screen; your old admin password works; products and customer balances match.
7. After each restore, Task Manager shows only Stockiha's own PostgreSQL processes (no duplicates remain after closing Stockiha).

### §M6 — after WS-H-6
1. Publish a test update (as in WS-K-6) and install it from the banner. You should see "Saving a safety backup before updating…" before it installs. After restart the list shows a "Before update" backup.
2. Set the backup folder to a USB stick, unplug it, install another test update → it still works; the new "Before update" backup is in the default folder.
3. Log in, wait a bit more than one minute → a "Daily automatic" backup appears. Log out and in again → no second daily backup today.
4. (Optional, needs date change) Set the PC date 8 days ahead → log in as admin → the "No backup in the last 7 days" warning appears with a button to backup settings. Restore the correct date afterwards.

### §M7 — after WS-H-7 (final end-to-end)
1. Switch the language to Arabic: the backup screens read correctly right-to-left, no English left.
2. Switch to French: same check.
3. Repeat §M5 steps 1–3 once more on the final build.

---

## PART 15 — RESULT REPORT TEMPLATE, JUNIOR-DEVELOPER TEST, MISSING-DETAILS AUDIT

### 15.1 Result Report (every sub-plan, exact headings)
```
# WS-H-<n> Result Report
## Branch and commit
Branch: task/ws-h-<n>-...
Base: <hash>
Head: <full 40-char hash>
Pushed: yes/no   (git ls-remote output pasted)
## Steps completed
H<n>-01 ... done / partial (why)
## Files changed
<git diff --stat>
## Gates (real output, last 20 lines each)
cargo fmt --check / cargo check / clippy / cargo test --lib / ignored tests run (list) / npm typecheck / lint / test / build / SQL suites
## Deviations from the plan
<none, or each deviation with reason>
## Blockers / questions for the Architect
## Pending manual checks (PART 14 §M<n>)
## Unrelated problems noticed (not fixed)
```

### 15.2 Junior-developer test — points most likely to be misunderstood, restated
1. EXTERNAL-mode code must not change. If you are editing the body of `recovery_creation::create_operator_backup_files` or `recovery::verify_operator_backup_restore_runtime`, you are doing it wrong — call new code instead.
2. The migrator password never goes on a command line. Only `.env("PGPASSWORD", ...)`.
3. Every `std::process::Command` you create goes through `pg_process::hide_console_window`.
4. `pg_dump` in EMBEDDED mode has **no** `--no-privileges`. `pg_restore` in the real restore has **no** `--no-privileges`.
5. The newest migration must be idempotent and must update `operations.schema_state` to its own version; the WS-K-5 fixture now deletes only the bookkeeping row.
6. The live-restore command returns immediately; the work happens in a background thread that owns the lease.
7. The takeover screen subscribes to events **before** invoking the command.
8. The server must be stopped before `tauri::process::restart`.
9. Automatic backups read the destination through the migrator connection, not through `get_backup_destination_setting`.
10. Retention never deletes `MANUAL`/`UNKNOWN` backups and never anything outside the destination root.
11. New `ErrorCode`s must be added in Rust and TypeScript in the same commit.
12. Replayed results from before WS-H-3 have no new fields — new DTO fields are optional.

### 15.3 Missing-details audit (checked)
- Files: every new file is named (PART 4.3, steps). ✔
- Dependencies: no new crates. Uses only direct dependencies already present: `dunce`, `time` (`serde-well-known` includes RFC3339 parsing/formatting), `serde_json`, `sha2`, `zeroize`, `sqlx`, `tokio` (`rt`, `time`), `getrandom`, `tauri-plugin-dialog`. `futures` is not a dependency — use `Pin<Box<dyn Future>>`. ✔
- Data structures: manifest v2, DTOs, events, DB table. ✔
- Validation: request ids, paths, confirmation word, reasons, destination rules, bundle names, format/schema/privileges. ✔
- Permissions: four permissions + session-only automatic path; SQL-enforced; UI gating via capabilities. ✔
- Errors: seven new IPC codes + detail codes + mapping. ✔
- State transitions: audit rows STARTED→SUCCEEDED/FAILED; restore outcomes; update phases; takeover state. ✔
- Tests: PART 13 + per-step Verify. ✔
- Integration points: `lib.rs` handler list and startup; `App.tsx` provider; `AppRouter.tsx` takeover + daily timer + banner; `SetupScreen.tsx`; `UpdateBanner`/`useAppUpdate`; `commands.ts`; `errors.ts`; `locales.ts`; SQL suite runner; bootstrap grants script. ✔
- Observability: `recovery.log`, `tracing`, outcome payloads, version marker. ✔

---

## APPENDIX — PASTE-READY KICKOFF PROMPTS

### A.1 WS-H-3 (Claude Code)
```
You are implementing WS-H-3 of Stockiha. Read the attached plan "WS-H Backup & Recovery Repair — Executable Implementation Specification" PARTS 0–7, 12, 13, 15 in full before editing anything, and follow the stockiha-task-execution skill.
Create branch task/ws-h-3-embedded-backup from main (expected base e65642962008b7c76ba663550dc68cd1615871e1; if main has moved, report the new hash and continue from it).
Implement steps H3-01 to H3-10 exactly. Do not implement anything from WS-H-4 or later.
Run every gate in §4.5, including the ignored Windows tests for recovery_engine, safe_upgrade and embedded_setup, and paste real output.
Commit, push, then write the Result Report in the format of §15.1, ending with the full commit hash and "Pushed: yes/no".
If the repository contradicts the plan, stop at that point and report it under Blockers instead of improvising.
```

### A.2 WS-H-4 (Claude Code)
```
You are implementing WS-H-4 of Stockiha. Read the plan PARTS 0–6, 8, 12, 13, 15 before editing. Create branch task/ws-h-4-backup-list-and-test from the accepted WS-H-3 branch head <paste hash>.
Implement H4-01 to H4-08 exactly; do not render or implement the Restore action (that is WS-H-5).
Run all §4.5 gates including the new ignored real-PostgreSQL tests on Windows. Commit, push, report per §15.1.
```

### A.3 WS-H-5 (Claude Code)
```
You are implementing WS-H-5 of Stockiha — the highest-risk sub-plan (live data replacement). Read the plan PARTS 0–6, 9, 12, 13, 15 before editing. Create branch task/ws-h-5-live-restore from the accepted WS-H-4 branch head <paste hash>.
Implement H5-01 to H5-07 exactly and in order. Do not reorder restore steps. All nine ignored restore tests in H5-07 must be written and must pass on Windows before you push.
Commit, push, report per §15.1.
```

### A.4 WS-H-6 (Claude Code)
```
You are implementing WS-H-6 of Stockiha. Read the plan PARTS 0–6, 10, 12, 13, 15 before editing. Create branch task/ws-h-6-automatic-backups from the accepted WS-H-5 branch head <paste hash>.
Implement H6-01 to H6-06 exactly. Keep the WS-K-6 update behaviour (download → prepare → install, resume on failure) intact apart from inserting the backup step.
Run all §4.5 gates. Commit, push, report per §15.1.
```

### A.5 WS-H-7 (Gemini)
```
You are doing WS-H-7 of Stockiha: translations and documentation only. Read the plan PART 4.1, PART 11 and PART 14 §M7.
Create branch task/ws-h-7-translations-docs from the accepted WS-H-6 branch head <paste hash>.
You may edit ONLY: src/shared/i18n/locales.ts, the Markdown files named in H7-03, src/shared/version.ts, and test files whose assertions contain the exact strings you changed. Do not touch any other file.
Complete H7-01, H7-02, H7-03 using the glossaries given. Run npm run typecheck, npm run lint, npm test -- --run, npm run build and paste the real output.
Commit, push, and report per §15.1 with the full commit hash and "Pushed: yes/no".
```
