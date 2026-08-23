# Current Implementation Step

> This document tracks the active implementation position and immediate execution objective.
> See [`STOCKIHA_GROUND_TRUTH.md`](./STOCKIHA_GROUND_TRUTH.md) for the single authoritative product roadmap, architecture principles, and workstream definitions.

---

## 1. Active Implementation Position

- **Active Workstream:** **WS-D — Product & Inventory Core** (with ongoing convergence into **WS-E — Procurement & Supplier Operations**)
- **Active Branch:** `fix/sub-plan-03-final-ux` (tracking `task/part-02-inventory-corrections`)
- **Current Focus:** Inventory UX overhaul, barcode-first search stabilization, and inventory corrections validation.
- **Authority Reference:** [`STOCKIHA_GROUND_TRUTH.md`](./STOCKIHA_GROUND_TRUTH.md)

---

## 2. Immediate Objectives & Next Actions

1. **Documentation Synchronization (Current Task):**
   - Complete documentation recovery and establish `STOCKIHA_GROUND_TRUTH.md` as the single ground-truth authority.
   - Establish `CURRENT_STEP.md` as the active execution tracker (replacing `CURRENT_SLICE.md`).
   - Archive historical roadmap documents into [`old-documents/`](./old-documents/README.md).
   - Clean up active stale references across repository documentation.

2. **Inventory UX & Barcode-First Search (WS-D):**
   - Finalize UX ergonomics on inventory screens.
   - Ensure barcode-first search is robust and prepare for global expansion across POS and operational screens.
   - Validate stock adjustment, zero-stock safeguards, and WAC calculation integrity.

3. **Procurement & Direct Purchase Verification (WS-E):**
   - Verify Direct Purchase foundation against local PostgreSQL 18 test database.
   - Maintain supplier accounting integrity (GRNI/AP semantics, cash/bank selection).

4. **Windows / Tauri Desktop Verification (WS-K):**
   - Execute single-pass Windows verification on modified features.
   - Confirm proper execution via `run.bat` / `npm run tauri dev`.

---

## 3. Active Blockers & Risks

- **Windows Runtime Verification:** Physical printer / cash drawer hardware requires real Windows hardware validation.
- **PostgreSQL Port & Service:** Local database on port 5433 must be running before executing SQLx migrations and tests.
- **Non-Authoritative React:** Maintain strict separation; business logic and inventory/financial state remain in PostgreSQL.

---

## 4. Acceptance Status

| Workstream | Area | Status | Verification Reference |
|---|---|:---:|---|
| **WS-A** | Foundation & Auth | Confirmed | Argon2 login, session tokens, SECURITY DEFINER functions |
| **WS-A** | User Management & RBAC | Critical MVP | Multi-role schema defined; UI & backend authorization active |
| **WS-B** | Financial Core | Confirmed | Double-entry journal postings, exact decimal arithmetic |
| **WS-D** | Inventory Core & Search | In Progress | Barcode search active on inventory; UX refinement in flight |
| **WS-E** | Direct Purchase | Staged | Direct purchase migration present; awaiting full acceptance |
| **WS-F** | POS & Cash Sessions | In Progress | Cashier lifecycle implemented; scheduled for comprehensive revision |
| **WS-H** | Backup & Recovery | Untrusted | Manual backup/restore proofs exist; requires full verification |
| **WS-K** | Windows Desktop Acceptance | Active Gate | Mandatory for candidate progression |
