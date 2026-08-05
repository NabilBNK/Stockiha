# Current Execution Status

> This is an execution tracker, not an architecture authority. See [`Stockiha_Audit_Redesigned_Roadmap_2026-08-02.md`](./Stockiha_Audit_Redesigned_Roadmap_2026-08-02.md) for target architecture and release scope. Running behavior, migrations, tests, and verified Windows evidence remain stronger than status prose.

## Released baseline

- **Branch:** `main`
- **Commit:** `4e282b4c799d96c4c8f745e9487e956bbb6334ca`
- **Verified boundary:** UI foundation, S0 through S4-003, R2 supplier-accounting repair, R6-001 operator backup creation/validation, and R0-001 finance-only historical onboarding
- **Most recent integration:** PR #14 — historical finance onboarding

## Completed recent work

- **R2:** forward-only supplier accounting repair using GRNI/AP semantics and selected Cash/Bank settlement accounts.
- **R6-001:** administrator-only backup creation and validation, PostgreSQL 18 `pg_dump`, Credential Manager secret consumption, immutable audit, hidden staging, independent checksum validation, SQLx metadata compatibility, and no restore command.
- **R0-001:** controlled Excel/manual historical-finance staging, validation, reporting approval, estimated profit/loss, duplicate protection, feature toggle, and operational-ledger isolation.
- **MVP financial boundary:** TVA and discounts remain deferred; unsupported non-zero values are rejected rather than guessed.

## Current implementation slice

- **Roadmap path:** R5 — opening operational state
- **Slice:** R5-002 — current opening-state reconciliation
- **Branch:** `task/r5-002-opening-state-reconciliation`
- **Purpose:** establish what the business owns and owes on the Stockiha cutover date, separately from the 1.5-year historical archive.
- **Current increment:**
  - administrator-only manage/review permissions;
  - feature toggle, default ON;
  - one cutover-date package with Excel/manual source metadata;
  - current cash, bank, inventory value, customer receivables, supplier payables, loans, taxes, owner capital, retained earnings, and other described assets/liabilities;
  - customer/supplier identity requirements for open balances;
  - accounting-equation validation (`Assets = Liabilities + Equity`);
  - exact reconciliation difference;
  - audited `APPROVED_FOR_APPLICATION` evidence;
  - single-approved-package guard;
  - direct runtime table access denied;
  - read-only backup inclusion;
  - explicit no-live-posting boundary;
  - SQL integration regression added to the current suite.

## Safety boundary

R5-002 approval does not create live sales, purchases, cash movements, inventory movements, customer receivables, supplier payables, or journals. A later forward-only application slice must define and test the idempotent posting matrix.

## Historical versus opening state

- **Historical finance:** prior 1.5-year sales, purchases, expenses, payments, and estimated result; product details excluded by default; reporting-only.
- **Opening state:** current cutover balances needed to start Stockiha; reconciled as assets, liabilities, and equity.
- **Physical stock quantities:** separate later workflow when item-level inventory control is required. Current inventory financial value belongs in R5-002, but historical product reconstruction does not.

## Deadline control

The pilot target remains approximately 9 August 2026. Verification policy is one implementation cycle, automated checks, one targeted Windows/Tauri acceptance, then merge unless evidence reveals a real product defect. Do not reopen completed R0/R6 work or start deferred breadth.

## Explicitly deferred

- direct application of opening balances to live ledgers;
- opening item quantities and WAC posting;
- automatic customer/supplier master creation;
- mandatory OCR or scanning;
- historical product-line reconstruction;
- live database restore;
- TVA/HT/TTC/discount accounting;
- payroll, advanced analytics, updater, and non-selected hardware/package work.

Do not merge stale S5–S7 branches. New work must follow the redesigned roadmap and current `main`.
