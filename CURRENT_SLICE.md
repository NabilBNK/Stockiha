# Current Execution Status

> This is an execution tracker, not an architecture authority. See [`Stockiha_Audit_Redesigned_Roadmap_2026-08-02.md`](./Stockiha_Audit_Redesigned_Roadmap_2026-08-02.md) for target architecture and release scope. Running behavior, migrations, tests, and verified Windows evidence remain stronger than status prose.

## Released baseline

- **Branch:** `main`
- **Code baseline:** `f554f3983792c4fe4c7576987f6fdb48aabc9ecf`
- **Verified boundary:** UI foundation, S0 through S4-003, R2 supplier-accounting repair, R6-001 operator backup creation/validation, R6-002 temporary database restore verification, R0-001 finance-only historical onboarding, R5-002/R5-003 opening-state application, and R0-002 historical XLSX trade staging/analytics.
- **Most recent integrations:** PR #18 removed the committed development-runner database credential and restored the real Tauri launch; PR #19 made the R0-002 SQL regression mandatory, corrected its suite transaction ownership, and synchronized the R6 restore regression with schema `20260807230000`.

## Completed recent work

- **R2:** forward-only supplier accounting repair using GRNI/AP semantics and selected Cash/Bank settlement accounts.
- **R6-001/R6-002:** administrator-only backup creation, validation, and temporary database restore verification with control-total reconciliation.
- **R0-001/R0-002:** controlled Excel/manual historical trade and finance staging, validation, reporting approval, estimated profit/loss, duplicate protection, feature toggle, and operational analytics.
- **R5-002/R5-003:** optional one-time CEO/admin setup, current cutover reconciliation, explicit customer/supplier mapping, one atomic opening journal, opening AR/AP subledgers, replay safety, and no fabricated physical stock.
- **R0-002 stabilization:** the historical-trade SQL integration test is now part of the mandatory PostgreSQL CI runner; cross-slice recovery schema-version expectations track the new migration.
- **Development runner hardening:** `run-app.bat` no longer contains a tracked database connection secret and again launches `npm run tauri dev` after successful build preflight.
- **MVP financial boundary:** TVA and discounts remain deferred; unsupported non-zero values are rejected rather than guessed.
- **R8-B/R8-C:** user-confirmed complete before entry into R8-D; running behavior and exact-candidate verification remain stronger evidence than this tracker.
- **R8-D:** accepted after the focused Windows/Tauri confirmation passed on exact
  candidate `27e8ad14133953ee7e4d8b2367797c2cf4d00090`; merged through PR #21 as
  `f554f3983792c4fe4c7576987f6fdb48aabc9ecf`.

## Current implementation slice

- **Roadmap path:** R8 — Consolidated Pilot Release Acceptance Gate
- **Slice:** R8-E — Procurement Acceptance
- **Branch:** `task/r8-e-procurement`
- **Base:** accepted R8-D `main` at `f554f3983792c4fe4c7576987f6fdb48aabc9ecf`
- **Candidate schema version:** `20260811140000`
- **Purpose:** close the pilot procurement journey from supplier and purchase order
  through receipt, landed cost, exact receipt-line invoice matching, supplier
  return, allocated payment, open-payable filtering, and auditable official results.
- **Status:** automated candidate. The published code candidate passed frontend,
  Rust, PostgreSQL 18, race, and historical/existing-database upgrade gates.
  One focused Windows/Tauri Antigravity acceptance pass remains.

## R8 entry evidence

The exact PR #19 candidate passed the mandatory automated gate after the R0-002 regression was wired into CI:

- frontend typecheck, lint, test suite, and production build;
- Rust unit verification;
- complete PostgreSQL 18 migration chain through `20260807230000`;
- PostgreSQL 18 backup-role `pg_dump` verification;
- mandatory R0-002 historical-trade staging/analytics/operational-isolation SQL regression;
- all current accounting/onboarding/recovery SQL suites;
- S2 stock-adjustment and zero-quantity races;
- S3 purchase-receipt race;
- S4 cash-session and credit-limit races;
- all four historical/existing-database S4 upgrade workflows.

## R8-E Windows/Tauri gate

The R8-E decision must come from one exact-candidate Windows/Tauri journey using
the real application UI and a controlled test database. See
[`docs/slices/R8-E-procurement.md`](./docs/slices/R8-E-procurement.md) for the
deterministic fixture, exact totals, and command gate.

Required proof:

1. pull the exact R8-E candidate and configure the database URL outside tracked source;
2. rotate/remove the PostgreSQL credential that was previously committed in the public repository before using the environment again;
3. start the app through the fixed `run-app.bat` / `npm run tauri dev` path;
4. run the Rust gate and the complete PostgreSQL 18 migration/SQL suite gate;
5. verify manager and cashier procurement capability boundaries;
6. create the exact `10 × 100.00 DZD` supplier/PO/receipt fixture and safely retry the receipt;
7. allocate `100.00 DZD` landed cost and verify `10`, `1100.00 DZD`, `110.000000 DZD` WAC;
8. post a `1050.00 DZD` matched invoice, return `2` units, and reconcile the exact GRNI/AP/variance controls;
9. reject an over-return and overpayment, then settle the exact open liabilities through bank, cash, and check postings;
10. verify official document/journal results, open-payable filtering, EN/FR/AR, RTL, narrow-window, and restart persistence;
11. record exact SHA, database identity, test results, defects, and control totals. Any unexplained stock/AP/GRNI/value/journal variance blocks R8-E.

## Safety boundary

R8 does **not** authorize scope expansion. In particular, it does not add:

- live database replacement;
- automatic replay of the 1.5-year historical archive into live ledgers;
- mandatory OCR or historical product reconstruction;
- scheduled/retained/off-device/encrypted backups;
- TVA/HT/TTC/discount accounting;
- payroll, advanced analytics, updater, or unconfirmed hardware/package work.

The historical paper workflow remains staged and reviewable. Historical-only rows must not alter live stock, cash, AR, AP, sales, purchases, or journals.

## Security follow-up

A database administrator credential was committed in an earlier `run-app.bat` revision and therefore must be treated as exposed even though PR #18 removed it from the current tree. Rotate that credential or destroy/recreate the disposable local database environment. Do not restore the old value into tracked files, chat logs, screenshots, or acceptance reports.

## Deadline control

The pilot target remains approximately 9 August 2026. R8 is a feature freeze and consolidated acceptance gate: fix only defects that prevent the selected pilot journeys or violate security/accounting/data-integrity invariants. Defer new feature breadth.

## Next release gate

Complete R8 on one exact candidate. If the full Windows/Tauri gate passes with zero unexplained financial/inventory/import/recovery variance, freeze/tag that exact candidate as the pilot baseline. R7 hardware/installer work remains conditional unless explicitly required for launch.

## Explicitly deferred

- live database replacement workflow;
- scheduled/retained/off-device/encrypted backups;
- opening item quantities and WAC posting beyond the approved opening-state boundary;
- automatic customer/supplier creation or fuzzy matching;
- historical product reconstruction and mandatory OCR;
- TVA/HT/TTC/discount accounting;
- payroll, advanced analytics, updater, and unconfirmed hardware/package work.
