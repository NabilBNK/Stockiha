# Current Execution Status

> This is an execution tracker, not an architecture authority. See [`Stockiha_Audit_Redesigned_Roadmap_2026-08-02.md`](./Stockiha_Audit_Redesigned_Roadmap_2026-08-02.md) for target architecture and release scope. Running behavior, migrations, tests, and verified Windows evidence remain stronger than status prose.

## Released baseline

- **Branch:** `main`
- **Commit:** `820d85c3dce9925f0cb7e5e0a8b615c96748942c`
- **Verified boundary:** UI foundation, S0 through S4-003, R2 supplier-accounting repair, and R6-001 operator backup creation/validation
- **Most recent integration:** PR #13 — R6-001 backup creation and validation

## Completed recent work

- **S4-003:** central drawer policy, customer-payment refunds, cash/bank invariants, and customer-payment controls.
- **R2:** forward-only supplier accounting repair using GRNI/AP semantics and selected Cash/Bank settlement accounts.
- **R6-001:** administrator-only backup creation and validation, PostgreSQL 18 `pg_dump`, Credential Manager secret consumption, immutable audit, hidden staging, independent checksum validation, SQLx metadata compatibility, and no restore command.
- **MVP financial boundary:** TVA and discounts remain deferred; unsupported non-zero values are rejected rather than guessed.

## Current implementation slice

- **Roadmap path:** R0/R4/R5 — historical finance onboarding and opening-state preparation
- **Slice:** R0-001 — finance-only historical onboarding
- **Branch:** `task/r0-001-paper-intake-contract`
- **PR:** #14, draft
- **Confirmed workflow:** a paid employee enters 1.5 years of paper history manually; the controlled Excel workbook is primary; direct Stockiha entry is secondary; scanning every paper is not required; product-level reconstruction is excluded by default.
- **Implemented on branch:**
  - finance-only onboarding contract and representative fixtures;
  - isolated `onboarding` staging schema;
  - administrator-visible import setting, default ON, with immutable setting-change audit;
  - administrator-only manage/review permissions;
  - replay-safe `EXCEL` and `MANUAL` batches;
  - minimal transaction rows matching the approved workbook columns;
  - optional supplier/fournisseur and customer/client fields;
  - opening/closing balance rows, including inventory value;
  - unique `Paper_ID` duplicate protection;
  - batch-scoped validation and issue storage;
  - audited approval for historical reporting only;
  - preliminary and inventory-adjusted finance summary functions;
  - explicit no-direct-posting boundary for stock, cash, AR, AP, and journals;
  - read-only backup ACL for all onboarding evidence;
  - typed Rust application services and Tauri commands;
  - typed frontend IPC gateway and DTOs;
  - constrained `.xlsx` parser for the official two-sheet template;
  - formula rejection, archive/path/size/integrity guards, exact-header checks, and row limits;
  - direct-entry fallback form;
  - Excel staging, validation, approval, feature-toggle, and historical-summary UI;
  - EN/FR/AR copy and RTL behavior;
  - focused frontend, Rust, SQL, backup, and workflow regressions.
- **Automated evidence before final documentation sync:** frontend typecheck/lint/tests/build and the complete PostgreSQL migration/backup/SQL/concurrency gate passed. Exact final-head CI remains mandatory after this tracker update.
- **Remaining R0-001 gate:** one targeted Windows/Tauri acceptance using a small populated copy of the official workbook, plus one manual-entry row and a historical summary check.

## Safety boundary

Approved historical batches become available for historical reporting only. They do **not** replay 1.5 years of paper transactions into live operational ledgers. A later opening-state application requires its own idempotent reconciliation and approval boundary.

## MVP finance interpretation

Stockiha can show sales, purchases, expenses, other income, refunds, receivables/payables when available, and a preliminary result. A trustworthy inventory-adjusted profit/loss estimate requires both opening and closing inventory values. Missing inventory values must be shown explicitly as incomplete, not as exact profit.

## Deadline control

The one-week pilot target remains approximately 9 August 2026. Verification policy is one implementation cycle, automated checks, one targeted Windows/Tauri acceptance, then merge unless evidence reveals a real product defect. Do not reopen completed R6 work or start deferred breadth.

## Explicitly deferred

- mandatory OCR or scanning of every paper;
- historical product-line reconstruction;
- direct historical replay into live stock, cash, AR, AP, or journals;
- live database restore;
- TVA/HT/TTC/discount accounting;
- payroll, advanced analytics, updater, and non-selected hardware/package work.

Do not merge stale S5–S7 branches. New work must follow the redesigned roadmap and current `main`.
