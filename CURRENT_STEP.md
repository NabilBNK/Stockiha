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
| **WS-H** | Backup & Recovery | **Implemented — pending Windows acceptance** | Manual backup creation, read-only validation, and temporary-database restore verification implemented end-to-end (frontend, Rust commands, migration `20260829100000_r6_003_backup_destination_setting.sql`); restore procedure documented in [`docs/recovery/RESTORE_PROCEDURE.md`](./docs/recovery/RESTORE_PROCEDURE.md); 268 Rust unit tests pass, 22 ignored pending live PostgreSQL 18 / Windows (see §3) |
| **WS-K** | Windows Desktop Acceptance | Active Gate | Mandatory for candidate progression |

---

## 5. Known Defects (out of scope for WS-D-0, tracked for the responsible workstream)

- **WS-E — `src/features/procurement/PurchaseOrdersScreen.tsx`:** 8 pre-existing ESLint errors (`@typescript-eslint/no-unused-vars` on `_id`/`_result` bindings at lines 229–234, `no-constant-binary-expression` at line 731). Confirmed byte-identical before and after the WS-H merge (`git show 3ad7eb8:...`), so this predates WS-H and is unrelated to it. Fix as part of WS-E.
- **WS-E — `tests/procurement.workflow.test.tsx`:** 1 pre-existing failure (`navigates to Purchase Orders screen and confirms a goods receipt` — cannot find rendered `PO-2026-000001` text). Same provenance as above: pre-existing on `main`, unrelated to WS-H. Fix as part of WS-E.
- **WS-H — `src-tauri/tests/recovery/r6_002_restore_verification_authorization_integration.sql`:** asserts a hardcoded `current_schema_version = '20260812100000'`, so it has failed on every migration applied since `2026-08-13` (i.e. essentially the entire time WS-H has existed) — discovered while running the full SQL regression suite for WS-D-1, unrelated to catalogue work. This is a stale test assertion (the literal needs to track the latest migration, not a fixed one), not a functional regression in the restore-verification code it exercises. WS-H's **"Implemented — pending Windows acceptance"** status in §4 stands; whoever runs WS-H's Windows acceptance pass should be aware this one regression suite is red for this reason and not mistake it for a real failure.
