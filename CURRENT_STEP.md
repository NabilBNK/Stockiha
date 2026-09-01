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
| **WS-H** | Backup & Recovery | **Functional for MVP — parked** | Backup creation and validation are **acceptance-passed on Windows**. In-app restore verification is **unreliable on this hardware** and its cause is recorded in §6; the Task 1 (cleanup guarantee) and Task 3 (log capture) fixes are in, but the underlying PostgreSQL fault is not fixed and is out of scope. **Disaster recovery for MVP relies on [`docs/recovery/RESTORE_PROCEDURE.md`](./docs/recovery/RESTORE_PROCEDURE.md)**, not on the in-app drill. WS-H-2 also fixed: the misleading "permission denied" on validate/restore (now `BACKUP_BUNDLE_OUTSIDE_ROOT`), native folder pickers, the restore-card layout, the stale `r6_002` assertion, a startup diagnostic naming a missing `STOCKIHA_BACKUP_ROOT`/`STOCKIHA_RESTORE_ADMIN_DATABASE_URL`, and a concurrency guard (`RECOVERY_OPERATION_IN_PROGRESS`) so overlapping recovery operations are refused rather than piled onto the database. Must be launched via `run.bat` — a bare `npm run tauri dev` exports none of the recovery environment. |
| **WS-K** | Windows Desktop Acceptance | Active Gate | Mandatory for candidate progression |

---

## 5. Known Defects (out of scope for WS-D-0, tracked for the responsible workstream)

- **WS-E — `src/features/procurement/PurchaseOrdersScreen.tsx`:** 8 pre-existing ESLint errors (`@typescript-eslint/no-unused-vars` on `_id`/`_result` bindings at lines 229–234, `no-constant-binary-expression` at line 731). Confirmed byte-identical before and after the WS-H merge (`git show 3ad7eb8:...`), so this predates WS-H and is unrelated to it. Fix as part of WS-E.
- **WS-E — `tests/procurement.workflow.test.tsx`:** 1 pre-existing failure (`navigates to Purchase Orders screen and confirms a goods receipt` — cannot find rendered `PO-2026-000001` text). Same provenance as above: pre-existing on `main`, unrelated to WS-H. Fix as part of WS-E.
- ~~**WS-H — `src-tauri/tests/recovery/r6_002_restore_verification_authorization_integration.sql`:** asserted a hardcoded `current_schema_version = '20260812100000'`.~~ **Resolved in WS-H-2:** the assertion now reads the live `operations.schema_state.migration_version` instead of a fixed literal, so it tracks whatever migration is actually applied. The suite passes.

---

## 6. WS-H parking note — PostgreSQL instability on the acceptance machine (recorded, not fixed)

Diagnosis only, per the WS-H-2 final-pass scope. **No fix was attempted beyond
guaranteeing cleanup**; the decision to spend further time belongs to the Lead
Architect.

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

**Assessment.** This is a fault inside `postgres.exe` itself, not in Stockiha
code — Stockiha only sends SQL over a socket. It is therefore **not** a
Stockiha code defect, but neither is it explained by the usual environmental
suspects (disk, antivirus). One further environmental lead worth noting: the
cluster is launched as a plain console child process, and this data directory
has previously logged `background worker ... was terminated by exception
0xC000013A` (`STATUS_CONTROL_C_EXIT`) — the signature of a console control
event (Ctrl+C, window close, logoff) propagating to the server. Running the
cluster as a Windows **service**, with `logging_collector = on`, would both
remove that exposure and preserve the server log needed to take this further.
