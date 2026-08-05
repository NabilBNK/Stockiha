# Current Execution Status

> This is an execution tracker, not an architecture authority. See [`Stockiha_Audit_Redesigned_Roadmap_2026-08-02.md`](./Stockiha_Audit_Redesigned_Roadmap_2026-08-02.md) for target architecture and release scope. Running behavior, migrations, tests, and verified Windows evidence remain stronger than status prose.

## Released baseline

- **Branch:** `main`
- **Commit:** `d98093ad22f66e0f609001ea14b778e6fb8a0ca2`
- **Verified boundary:** UI foundation, S0 through S4-003, R2 supplier-accounting repair, R6-001 operator backup creation/validation, R0-001 finance-only historical onboarding, and R5-002 current opening-state reconciliation
- **Most recent integration:** PR #15 — opening-state reconciliation

## Completed recent work

- **R2:** forward-only supplier accounting repair using GRNI/AP semantics and selected Cash/Bank settlement accounts.
- **R6-001:** administrator-only backup creation and validation, PostgreSQL 18 `pg_dump`, Credential Manager secret consumption, immutable audit, hidden staging, independent checksum validation, SQLx metadata compatibility, and no restore command.
- **R0-001:** controlled Excel/manual historical-finance staging, validation, reporting approval, estimated profit/loss, duplicate protection, feature toggle, and operational-ledger isolation.
- **R5-002:** current cutover assets, liabilities, and equity; accounting-equation reconciliation; customer/supplier identity requirements; audited approval as `APPROVED_FOR_APPLICATION`; no-live-posting isolation.
- **MVP financial boundary:** TVA and discounts remain deferred; unsupported non-zero values are rejected rather than guessed.

## Current implementation slice

- **Roadmap path:** R5 — opening operational state
- **Slice:** R5-003 — approved opening-state application
- **Branch:** `task/r5-003-opening-state-application`
- **Purpose:** apply exactly one approved R5-002 package to controlled live financial and counterparty subledgers, atomically and idempotently.
- **Current increment:**
  - application contract and posting matrix frozen;
  - dedicated application permission and feature toggle planned, default ON;
  - explicit mapping from reviewed customer/supplier names to existing operational master records;
  - no automatic customer or supplier creation;
  - one posted opening journal for the cutover date;
  - customer receivable and supplier payable opening subledger records;
  - Cash, Bank, Inventory Value, Loan, Tax, Owner Capital, Retained Earnings, and explicitly mapped other balances;
  - inventory value remains financial-only until item quantities and WAC are applied later;
  - exact one-package and one-application guards;
  - immutable application, mapping, journal-link, and audit evidence;
  - all-or-nothing rollback and conflicting-replay rejection required.

## Safety boundary

R5-003 must not replay the 1.5-year historical archive, infer product quantities, create inventory movements from a value-only inventory balance, auto-create counterparties, post to a closed fiscal period, or mutate an already applied opening state.

## Historical versus opening state

- **Historical finance:** prior 1.5-year sales, purchases, expenses, payments, and estimated result; product details excluded by default; reporting-only.
- **Opening state:** current cutover balances needed to start Stockiha; reconciled and then applied through a separate controlled transaction.
- **Physical stock quantities:** separate later workflow when item-level inventory control is required. R5-003 may post the financial inventory asset value but must not fabricate quantities or WAC.

## Deadline control

The pilot target remains approximately 9 August 2026. Verification policy is one implementation cycle, automated checks, one targeted Windows/Tauri acceptance, then merge unless evidence reveals a real product defect. Do not reopen completed R0/R5-002/R6 work or start deferred breadth.

## Explicitly deferred

- opening item quantities and WAC posting;
- automatic customer/supplier creation or fuzzy auto-matching;
- historical product-line reconstruction;
- mandatory OCR or scanning;
- live database restore;
- TVA/HT/TTC/discount accounting;
- payroll, advanced analytics, updater, and non-selected hardware/package work.

Do not merge stale S5–S7 branches. New work must follow the redesigned roadmap and current `main`.
