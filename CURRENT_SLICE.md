# Current Execution Status

> This is an execution tracker, not an architecture authority. See [`Stockiha_Audit_Redesigned_Roadmap_2026-08-02.md`](./Stockiha_Audit_Redesigned_Roadmap_2026-08-02.md) for target architecture and release scope. Running behavior, migrations, tests, and verified Windows evidence remain stronger than status prose.

## Released baseline

- **Branch:** `main`
- **Commit:** `3e77f5d`
- **Verified boundary:** UI foundation, S0 through S4-003, R2 supplier-accounting repair, R6-001 operator backup creation/validation, R6-002 temporary database restore verification, R0-001 finance-only historical onboarding, R5-002/R5-003 opening-state application, and R0-002 historical XLSX trade staging/analytics.
- **Most recent integration:** Merge R0-002 historical paper-book XLSX import & analytics

## Completed recent work

- **R2:** forward-only supplier accounting repair using GRNI/AP semantics and selected Cash/Bank settlement accounts.
- **R6-001/R6-002:** administrator-only backup creation, validation, and temporary database restore verification with control-total reconciliation.
- **R0-001/R0-002:** controlled Excel/manual historical trade and finance staging, validation, reporting approval, estimated profit/loss, duplicate protection, feature toggle, and operational analytics.
- **R5-002/R5-003:** optional one-time CEO/admin setup, current cutover reconciliation, explicit customer/supplier mapping, one atomic opening journal, opening AR/AP subledgers, replay safety, and no fabricated physical stock.
- **MVP financial boundary:** TVA and discounts remain deferred; unsupported non-zero values are rejected rather than guessed.

## Current implementation slice

- **Roadmap path:** R8 — Consolidated Pilot Release Acceptance Gate
- **Slice:** R8-001 — Consolidated Pilot Release Verification
- **Branch:** `main` at `3e77f5d`
- **Current schema version:** `20260807230000`
- **Purpose:** verify end-to-end user workflows across the complete pilot boundary (Onboarding cutover -> Catalog -> POS Sales -> Cashier Session -> Backup verification) on Windows desktop.

### Implemented authorization, policy, and audit

- dedicated `VERIFY_BACKUP_RESTORE` permission for ADMIN and future CEO roles;
- CASHIER/operator denial;
- restore-verification feature setting defaults ON;
- CEO/admin can disable or re-enable new restore drills;
- disabling restore drills does not disable backup creation or read-only validation;
- setting changes are audited with actor and workstation;
- database trigger blocks new restore attempts while disabled;
- recovery audit operation `VERIFY_RESTORE`;
- replay-safe request IDs and conflicting-request rejection;
- only the initiating actor and workstation may complete the attempt;
- runtime has no direct access to recovery settings or audit tables;
- backup role includes settings/audit evidence read-only.

### Implemented recovery drill

- explicit user acknowledgement required;
- selected bundle must be a canonical direct child of `STOCKIHA_BACKUP_ROOT`;
- existing authoritative bundle checksum/path/symlink validator reused;
- exact application, schema, and PostgreSQL 18 compatibility required;
- administrative connection configuration resolved only by the backend from `STOCKIHA_RESTORE_ADMIN_DATABASE_URL`;
- generated `stockiha_restore_proof_*` target names only;
- fixed PostgreSQL 18 `pg_restore` adapter with single-transaction and exit-on-error behavior;
- blocking restore process isolated from the async Tauri runtime;
- control-total reconciliation for schemas, tables, users, products, parties, inventory, sales, journals, AR/AP, and applied opening state;
- journal debit/credit equality reported explicitly;
- generated database forcibly deleted before success;
- original operation failure preserved even if cleanup also fails;
- no temporary database name, connection URL, credential, raw process output, or database diagnostic crosses IPC.

### Implemented Settings workflow

- default-ON temporary restore-verification toggle;
- create backup;
- validate an existing backup;
- explicitly acknowledge the temporary database drill;
- run **Verify temporary restore**;
- review cleanup status, journal balance, and critical control totals;
- English, French, and Arabic/RTL copy;
- fixed safe failure messages.

## Safety boundary

R6-002 does **not**:

- replace, rename, stop, or modify the live Stockiha database;
- accept a caller-selected database, role, password, connection URL, or executable;
- restore an incompatible bundle;
- copy backup assets into live directories;
- expose a live restore button;
- implement scheduler, retention, encryption, cloud upload, or off-device replication.

Live database replacement remains deferred until a separate maintenance-mode design includes a pre-restore backup, explicit destructive confirmation, rollback plan, and dedicated acceptance gate.

## Verification state

Implemented automated coverage includes:

- permission, operator denial, default-ON setting, audited enable/disable, database enforcement, replay, conflict, actor/workstation ownership, runtime ACL, and backup ACL SQL regression;
- request confirmation and safe result DTO tests;
- focused Settings toggle/create/validate/temporary-restore workflow tests;
- complete migration chain and PostgreSQL 18 backup verification;
- all existing accounting SQL and concurrency suites;
- Rust, frontend, production build, and historical-upgrade workflows.

One exact-head Windows/Tauri recovery drill remains required before merge. It must use a real R6-001 bundle, verify the OFF/ON setting behavior, execute PostgreSQL 18 `pg_restore`, compare restored control totals, prove the live database remains unchanged, and prove no generated temporary database remains.

## Deadline control

The pilot target remains approximately 9 August 2026. Verification policy is one implementation cycle, automated checks, one targeted Windows/Tauri acceptance, then merge unless evidence reveals a real product defect.

## Next release gate

After R6-002, move to the consolidated R8 pilot acceptance gate unless the client confirms a launch-critical R7 hardware/installer requirement. Do not revive or merge stale S5–S7 branches.

## Explicitly deferred

- live database replacement workflow;
- scheduled/retained/off-device/encrypted backups;
- opening item quantities and WAC posting;
- automatic customer/supplier creation or fuzzy matching;
- historical product reconstruction and mandatory OCR;
- TVA/HT/TTC/discount accounting;
- payroll, advanced analytics, updater, and unconfirmed hardware/package work.
