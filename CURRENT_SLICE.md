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
- **Slice:** R5-003 — optional one-time setup lifecycle and approved opening-state application
- **Branch:** `task/r5-003-opening-state-application`
- **PR:** #16, draft
- **Purpose:** make opening state an optional, CEO/admin-controlled one-time setup step, then apply exactly one approved R5-002 package to controlled live financial and counterparty subledgers atomically and idempotently.

### Implemented lifecycle correction

- opening state removed from normal daily navigation;
- first administrator receives `Enter now`, `Do later`, and `Do not use` choices during initial setup;
- lifecycle states: `PENDING`, `DEFERRED`, `DECLINED`, and `COMPLETED`;
- deferred access appears later only inside restricted Settings;
- declined and completed workflows remain hidden from normal access;
- cashier/operator permission denial prevents discovery and access;
- existing approved packages migrate directly to `COMPLETED`;
- approval completes the lifecycle and disables additional entry;
- defer, decline, and completion decisions are immutable-audited;
- typed Rust/Tauri and frontend IPC boundaries added.

### Implemented one-time application

- dedicated `APPLY_OPENING_STATE` permission for ADMIN and future CEO roles;
- separate application feature toggle, default ON;
- restricted Settings card appears only when one approved package still requires application;
- final review UI displays approved evidence, cutover totals, controlled account destinations, and irreversible-action warnings;
- every customer receivable requires an explicit existing-customer mapping;
- every supplier payable requires an explicit existing-supplier mapping;
- no customer or supplier is automatically created, merged, or guessed;
- one atomic, balanced, posted opening journal dated on the approved cutover date;
- Cash, Bank, Inventory Value, Accounts Receivable, Accounts Payable, Loan, Tax, Owner Capital, Retained Earnings, and controlled other-account semantics;
- opening customer receivables enter the customer ledger and exposure state;
- opening supplier payables enter the supplier-liability subledger;
- value-only inventory posts only to the financial inventory account and explicitly leaves physical inventory incomplete;
- no product quantities, warehouse positions, WAC, inventory movements, sales, purchases, or purchase receipts are fabricated;
- one successful application per package, exact replay support, conflicting-request rejection, immutable snapshots, and immutable audit evidence;
- runtime has no direct table access and backup remains read-only.

### Automated verification

- lifecycle SQL regression;
- atomic application SQL regression covering permission, toggle, approval, period, mapping, journal, AR/AP subledgers, no-stock/no-sales boundaries, replay/conflict, immutability, audit, and backup ACL;
- focused frontend application workflow regression;
- complete migration chain and PostgreSQL 18 `pg_dump`;
- existing SQL integration and concurrency suites;
- frontend typecheck, lint, tests, and production build;
- Rust unit verification and historical upgrade workflows required green on the final exact head before Windows acceptance.

## Opening-State Lifecycle

| Status | Meaning | Product behavior |
|---|---|---|
| `PENDING` | Initial setup choice is unresolved. | Offered only to first CEO/admin. |
| `DEFERRED` | CEO/admin postponed it. | Available later only from restricted Settings. |
| `DECLINED` | CEO/admin chose not to use it. | Hidden and disabled. |
| `COMPLETED` | One balanced package was approved. | Hidden and disabled for new entry; approved package may still require one controlled application. |

Opening state is not annual. Normal fiscal-year closing and balance carry-forward are separate future accounting workflows.

## Safety boundary

R5-003 must not replay the 1.5-year historical archive, infer product quantities, create inventory movements from a value-only inventory balance, auto-create counterparties, post to a closed fiscal period, expose opening state as a daily module, permit operator access, or mutate an already completed/applied opening state.

## Historical versus opening state

- **Historical finance:** prior 1.5-year sales, purchases, expenses, payments, and estimated result; product details excluded by default; reporting-only.
- **Opening state:** optional one-time current cutover balances needed to start Stockiha; reconciled and then applied through a separate controlled transaction.
- **Physical stock quantities:** separate later workflow when item-level inventory control is required. R5-003 posts only the approved financial inventory asset value and never fabricates quantities or WAC.

## Deadline control

The pilot target remains approximately 9 August 2026. Verification policy is one implementation cycle, automated checks, one targeted Windows/Tauri acceptance, then merge unless evidence reveals a real product defect. Do not reopen completed R0/R5-002/R6 work or start deferred breadth.

## Explicitly deferred

- opening item quantities and WAC posting;
- automatic customer/supplier creation or fuzzy auto-matching;
- historical product-line reconstruction;
- mandatory OCR or scanning;
- live database restore;
- TVA/HT/TTC/discount accounting;
- opening-state reversal/correction UI after application;
- payroll, advanced analytics, updater, and non-selected hardware/package work.

Do not merge stale S5–S7 branches. New work must follow the redesigned roadmap and current `main`.
