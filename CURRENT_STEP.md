# Current Implementation Step

> This document tracks the active implementation position and immediate execution objective.
> See [`STOCKIHA_GROUND_TRUTH.md`](./STOCKIHA_GROUND_TRUTH.md) for the single authoritative product roadmap, architecture principles, and workstream definitions.

---

## 1. Active Implementation Position

- **Active Workstream:** **WS-D — Product & Inventory Core**
- **Active Branch:** `task/ws-d-product-inventory` (created from merged `main` at `WS-D-0`)
- **Current Focus:** Product catalogue UI/UX rebuild, catalogue reference data, barcode-first global search, inventory analytics MVP.
- **Completed baseline (do not restart):** `fix/sub-plan-03-final-ux` (tracking `task/part-02-inventory-corrections`) — inventory UX overhaul and correction work already merged into `main`. WS-D builds forward from this baseline; it is not the active branch.
- **Authority Reference:** [`STOCKIHA_GROUND_TRUTH.md`](./STOCKIHA_GROUND_TRUTH.md)

---

## 2. Immediate Objectives & Next Actions

1. **Product Catalogue UI/UX Rebuild (WS-D):**
   - Stabilize Product Backend (6.5/10) and redesign Product Frontend (4.0/10) per `DESIGN.md`'s WS-D scope ruling (§0).
   - Catalogue reference data, barcode-first global search expansion, inventory analytics MVP (stock turnover, valuation, low-stock warnings).

2. **Procurement & Direct Purchase Verification (WS-E):**
   - Verify Direct Purchase foundation against local PostgreSQL 18 test database.
   - Maintain supplier accounting integrity (GRNI/AP semantics, cash/bank selection).
   - Known defects (see §5) block a clean lint/test baseline in this area; fix before or alongside WS-E work.

3. **Windows / Tauri Desktop Verification (WS-K):**
   - Execute single-pass Windows verification on modified features.
   - Confirm proper execution via `run.bat` / `npm run tauri dev`.
   - WS-H restore-drill and bootstrap-role scripts specifically require live PostgreSQL 18 + Windows acceptance (see §4).

---

## 3. Active Blockers & Risks

- **Windows Runtime Verification:** Physical printer / cash drawer hardware requires real Windows hardware validation.
- **PostgreSQL Port & Service:** Local database on port 5433 must be running before executing SQLx migrations and tests.
- **Non-Authoritative React:** Maintain strict separation; business logic and inventory/financial state remain in PostgreSQL.
- **Rust test coverage is partial on this (Linux) sandbox:** 22 of 290 `stockiha-backend` lib tests are `#[ignore]`d because they require a live PostgreSQL server/PostgreSQL 18, Windows Credential Manager, or a real Windows printer. Most are general integration coverage (auth, cash sale, IAM, onboarding, setup, stock receipt). The WS-H-specific ones among them are: `application::recovery::tests::update_backup_destination_rejects_the_real_pg_data_directory`, `infrastructure::backup_proof::tests::windows_live_proof_creates_a_real_backup_bundle`, `infrastructure::bootstrap::tests::bootstrap_executes_idempotently_against_role_bootstrap_test_database`, `infrastructure::bootstrap::tests::concurrent_bootstrap_runs_safely_under_advisory_lock`, `infrastructure::bootstrap::tests::permission_probe_tests_verify_exact_role_restrictions`, `infrastructure::restore_proof::tests::windows_live_proof_restores_and_reconciles_against_a_real_postgres`, `infrastructure::session_proof::tests::security_definer_session_proof_end_to_end`, and `infrastructure::db::tests::*` live cases. WS-H is **not release-trusted** until those run green on Windows against a live PostgreSQL 18 instance.

---

## 4. Acceptance Status

| Workstream | Area | Status | Verification Reference |
|---|---|:---:|---|
| **WS-A** | Foundation & Auth | Confirmed | Argon2 login, session tokens, SECURITY DEFINER functions |
| **WS-A** | User Management & RBAC | Critical MVP | Multi-role schema defined; UI & backend authorization active |
| **WS-B** | Financial Core | Confirmed | Double-entry journal postings, exact decimal arithmetic |
| **WS-D** | Inventory Core & Search | In Progress | Barcode search active on inventory; catalogue UI/UX rebuild starting on `task/ws-d-product-inventory` |
| **WS-E** | Direct Purchase | Staged | Direct purchase migration present; awaiting full acceptance; known lint/test defects, see §5 |
| **WS-F** | POS & Cash Sessions | In Progress | Cashier lifecycle implemented; scheduled for comprehensive revision |
| **WS-H** | Backup & Recovery | **Acceptance-passed — closed** | Full recovery flow — backup creation, validation, and **in-app restore verification** — passed Windows acceptance on 2026-09-01, after a cluster restart cleared the checkpointer that had been wedged (see §6). Screenshot-confirmed: schema/PostgreSQL version match, temporary database cleaned up, journals balanced. The earlier intermittent PostgreSQL abort (§6) remains a **known environmental risk**, not a Stockiha defect, with its existing mitigations (update to current PostgreSQL 18.x, run the cluster as a Windows service with `logging_collector = on`) still recommended and not yet applied. The documented manual procedure ([`docs/recovery/RESTORE_PROCEDURE.md`](./docs/recovery/RESTORE_PROCEDURE.md)) remains the fallback if that risk recurs. WS-H-2 also fixed: the misleading "permission denied" on validate/restore (now `BACKUP_BUNDLE_OUTSIDE_ROOT`), native folder pickers, the restore-card layout, the stale `r6_002` assertion, a startup diagnostic naming a missing `STOCKIHA_BACKUP_ROOT`/`STOCKIHA_RESTORE_ADMIN_DATABASE_URL`, a concurrency guard (`RECOVERY_OPERATION_IN_PROGRESS`), and a bounded restore-drill cleanup sweep that cannot hang app startup. Must be launched via `run.bat` — a bare `npm run tauri dev` exports none of the recovery environment. |
| **WS-K** | Windows Desktop Acceptance | In Progress — redesigned onto embedded PostgreSQL (WS-K-4), installer rebuilt, unverified on a clean VM | WS-K-1/1.2 unchanged and still authoritative: production `database.json` config resolution (env var → per-install config file → dev `runtime.key`), the ten-state startup-failure screen, fail-open schema-version check. **WS-K-2 and WS-K-3's Windows-service provisioning design is retired**, not merely superseded — three consecutive real-machine installs on that line failed (`$PSScriptRoot`-empty, wrong resource-path math, `SetShellVarContext all`/`$APPDATA` bugs, each fixed in turn — and the install *still* failed after all three fixes), with the leading suspect being `New-StockihaServiceAccount`/`Grant-LogOnAsServiceRight`'s `LsaAddAccountRights` P/Invoke, which real-machine testing never once actually exercised successfully. **WS-K-4 replaces the whole service-account architecture**: PostgreSQL now runs as a plain child process of Stockiha itself (`src-tauri/src/infrastructure/pg_process.rs`), started/stopped by the app, no Windows service, no dedicated service account, no elevation. First-run provisioning (`src-tauri/src/infrastructure/embedded_setup.rs`) moved from an unattended PowerShell script run once during install into the app itself, visible on screen (`EmbeddedSetupScreen.tsx`) with a live 9-step checklist and a working Retry that resumes without reinstalling. `Provision-StockihaPostgres.ps1`, `Uninstall-StockihaPostgres.ps1`, `Test-ProvisionInvocationSmoke.ps1`, and `src-tauri/nsis/hooks.nsh` are all **deleted** — the installer's only remaining job is copying files (`installMode` is now `"currentUser"`, no elevation). All 7 required scenarios (full setup end-to-end, stale-pid dead/live, post-exit process cleanup, migration-failure leaves no `database.json`, no password in `setup.log`, and — the highest-probability remaining risk — a non-ASCII **Arabic** data path) were run for real against the bundled PostgreSQL 18.6 binaries; the Arabic-path case failed on first attempt (`initdb` truncates non-ASCII path characters via its own ANSI-codepage argument handling) and now falls back to a fixed ASCII path under `%ProgramData%\Stockiha\pgdata` when `app_data_dir` is not ASCII-safe (`pg_process::resolve_pgdata_dir`). **WS-K-4.2 fixes the packaging bug that made WS-K-4.1's install fail on the Owner's real machine**, found by the Owner inspecting the installed folder directly: `tauri.conf.json`'s resource mapping used a glob (`resources/postgres/win64/**/*` → `postgres/win64/`), and in map form a glob flattens every matched file into the target directory **by basename** (`tauri_utils::resources` computes the target as `dest.join(path.file_name())`). `bin/`, `lib/` and `share/` therefore did not exist in the installed app at all, and 1,565 source files collapsed to 1,100 — 465 silently overwrote each other, so the shipped PostgreSQL was corrupted, not merely misplaced. Mapping the directory itself (`"resources/postgres/win64": "postgres/win64"`) takes the structure-preserving walk branch instead. Three new non-ignored tests now guard it: the materialized (staged) resource layout is asserted against what the shipped code reads, the config is asserted to contain no glob patterns, and the missing-binary diagnostic is asserted to name the exact path searched plus a listing of the nearest folder that does exist — all three verified to **fail** against the old mapping. The real-PostgreSQL tests were also repointed from the pristine source tree to the staged tree, since reading the source tree is precisely why they stayed green throughout this bug. **WS-K-4.3 fixes the second real-machine failure**, found by the Owner running WS-K-4.2's installer on a fresh PC: setup failed at `InitializeDatabase` with `initdb exited with exit code: 0xc0000135` and no error text, and Windows' own dialog named the cause — `VCRUNTIME140.dll est introuvable`. `0xC0000135` is `STATUS_DLL_NOT_FOUND`: the bundled PostgreSQL binaries are MSVC-built and link against the Visual C++ 2015-2022 Redistributable (154 of them import `vcruntime140.dll`, 12 `vcruntime140_1.dll`, 9 `msvcp140.dll`), which is **not** part of a clean Windows install. EDB's own installer installs that redistributable as one of its steps; bundling the raw zip binaries skipped it. Every development machine worked because Visual Studio's Build Tools leave those DLLs in `System32` — so no local test could ever have caught it by running the binaries. Fixed by deploying the three DLLs **app-local** in `postgres/win64/bin/` (the executable's own directory is first in Windows' DLL search order), rather than running `vc_redist.x64.exe`, which would require elevation and break WS-K-4's no-admin guarantee; all three are Authenticode-signed and verify `Valid`, a stronger provenance chain than the PostgreSQL binaries themselves. Guarded by a new test that parses the **PE import tables** of every bundled executable and fails if any Visual C++ runtime import is absent from the bundle — environment-independent by construction, and verified to fail against the previous build. Also fixed in the same pass, both visible in the Owner's screenshots: `initdb`/`postgres`/`pg_ctl` now spawn with `CREATE_NO_WINDOW` (a black console window was appearing mid-setup, which this document explicitly promises will never happen), and load-failure exit codes are now translated into plain language instead of surfacing as bare hex. **The rebuilt installer has not been run on any machine, clean VM or otherwise** — see `WS-K-4-MANUAL-VERIFICATION.md` for the Owner's own test script; that is the next required action before WS-K can move to Confirmed. |

---

## 5. Known Defects (out of scope for WS-D-0, tracked for the responsible workstream)

- **WS-E — `src/features/procurement/PurchaseOrdersScreen.tsx`:** 8 pre-existing ESLint errors (`@typescript-eslint/no-unused-vars` on `_id`/`_result` bindings at lines 229–234, `no-constant-binary-expression` at line 731). Confirmed byte-identical before and after the WS-H merge (`git show 3ad7eb8:...`), so this predates WS-H and is unrelated to it. Fix as part of WS-E.
- **WS-E — `tests/procurement.workflow.test.tsx`:** 1 pre-existing failure (`navigates to Purchase Orders screen and confirms a goods receipt` — cannot find rendered `PO-2026-000001` text). Same provenance as above: pre-existing on `main`, unrelated to WS-H. Fix as part of WS-E.
- ~~**WS-H — `src-tauri/tests/recovery/r6_002_restore_verification_authorization_integration.sql`:** asserted a hardcoded `current_schema_version = '20260812100000'`.~~ **Resolved in WS-H-2:** the assertion now reads the live `operations.schema_state.migration_version` instead of a fixed literal, so it tracks whatever migration is actually applied. The suite passes.

---

## 6. WS-H parking note — PostgreSQL instability on the acceptance machine (environmental, closed)

Diagnosis only, per the WS-H-2 final-pass scope. **No fix was attempted beyond
guaranteeing cleanup** (Task 1's `TempDbGuard` + startup sweep). The Lead
Architect has reviewed this diagnosis and closed it: **this is an
environmental PostgreSQL fault, not a Stockiha code defect**, and no further
engineering time is being spent on the crash itself.

**What the operator saw.** Repeatedly clicking "Create backup" produced
`The database is currently unavailable.`, preceded by
`terminating connection because of crash of another server process` (os error
10054), and two orphaned 15 MB `stockiha_restore_proof_verify_*` databases were
left behind.

**The PostgreSQL server's own log does not exist for that window.** The
cluster runs with `logging_collector = off` and `log_destination = stderr`, and
`postmaster.opts` shows it was started as
`postgres.exe -D ... -p 5433` with **no** `-l` redirect — so its stderr went to
a console window that is gone. The crash was recovered instead from the Windows
Application event log (verbatim excerpt in the WS-H-2 Result Report).

**What the crash actually is.** `postgres.exe` 18.0.4.0 faulting inside
`ucrtbase.dll` with exception code `0xC0000409` at a *constant* fault offset
`0x7286e`, twice (2026-08-31 23:55:52 and 2026-09-01 08:31:46).
`0xC0000409` is `STATUS_STACK_BUFFER_OVERRUN`, which modern Windows also uses
for `__fastfail`; the WER parameter `P9 = 7` is `FAST_FAIL_FATAL_APP_EXIT` —
i.e. the C runtime's `abort()` path. This is **not** a segmentation fault, not
an out-of-memory kill, and not an I/O error. The repeated identical offset
means it is deterministic, not random corruption.

**Ruled out by measurement, not assumption:**
- *Disk full* — 42.78 GB free on `C:`.
- *Antivirus real-time scanning* — Defender `RealTimeProtectionEnabled: False`.

**Still open, and the reason restore verification is called unreliable:** the
cluster's **checkpointer wedges**. After the crash-restart, `DROP DATABASE` and
even a bare `CHECKPOINT` block forever on `CheckpointStart`/`CheckpointDone`
while the checkpointer process sits at a flat 2.28s CPU — alive, but not
servicing requests. Cancelling the waiting backends did not release it. That is
why the two orphaned databases could not be dropped in-session, and it is a
plausible common cause with the `abort()` above. Clearing it requires a cluster
restart.

**Assessment (accepted, closed).** This is a fault inside `postgres.exe`
itself, not in Stockiha code — Stockiha only sends SQL over a socket. It is
therefore **not** a Stockiha code defect. It is not explained by the usual
environmental suspects checked here (disk, antivirus), but the version and
launch posture are both plausible independent causes: PostgreSQL 18.0 is the
initial 18.x release, and the cluster is launched as a plain console child
process — this data directory has previously logged `background worker ...
was terminated by exception 0xC000013A` (`STATUS_CONTROL_C_EXIT`), the
signature of a console control event (Ctrl+C, window close, logoff)
propagating to the server.

**Recommended mitigations for the Project Owner** (not implemented here —
system/infrastructure changes are outside this task's scope):

1. **Update PostgreSQL 18.0 to the current 18.x patch release.** The crash is
   inside `ucrtbase.dll` at a fixed offset, which is consistent with a known,
   already-patched bug rather than something specific to this machine.
2. **Run the cluster as a Windows service, with `logging_collector = on`.**
   This removes the console-control-event exposure above and — regardless of
   whether it changes the crash itself — preserves the server's own log for
   next time, which this investigation did not have.

No further engineering time will be spent on the crash itself. Task 1's
cleanup guarantee (`TempDbGuard` + startup sweep) means it is no longer
harmful when it happens, which is the scope this task closes at.
