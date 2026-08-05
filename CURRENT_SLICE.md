# Current Execution Status

> This is an execution tracker, not an architecture authority. See [`Stockiha_Audit_Redesigned_Roadmap_2026-08-02.md`](./Stockiha_Audit_Redesigned_Roadmap_2026-08-02.md) for target architecture and release scope. Running behavior, migrations, tests, and verified Windows evidence remain stronger than status prose.

## Released baseline

- **Branch:** `main`
- **Commit:** `9112820e8b4c2e2c72fd69dc660d564493bbc1d9`
- **Verified boundary:** UI foundation, S0 through S4-003, R2 supplier-accounting repair, R6-001 operator backup creation/validation, R0-001 finance-only historical onboarding, and R5-002/R5-003 one-time opening-state reconciliation/application
- **Most recent integration:** PR #16 — approved opening-state application

## Completed recent work

- **R2:** forward-only supplier accounting repair using GRNI/AP semantics and selected Cash/Bank settlement accounts.
- **R6-001:** administrator-only backup creation and validation, PostgreSQL 18 `pg_dump`, Credential Manager backup-role secret consumption, immutable audit, hidden staging, independent checksum validation, SQLx metadata compatibility, and no restore command.
- **R0-001:** controlled Excel/manual historical-finance staging, validation, reporting approval, estimated profit/loss, duplicate protection, feature toggle, and operational-ledger isolation.
- **R5-002/R5-003:** optional one-time CEO/admin setup, current cutover reconciliation, explicit customer/supplier mapping, one atomic opening journal, opening AR/AP subledgers, replay safety, and no fabricated physical stock.
- **MVP financial boundary:** TVA and discounts remain deferred; unsupported non-zero values are rejected rather than guessed.

## Current implementation slice

- **Roadmap path:** R6 — backup, restore, and recovery operations
- **Slice:** R6-002 — controlled temporary restore verification
- **Branch:** `task/r6-002-controlled-restore-recovery`
- **PR:** #17, draft
- **Base:** merged `main` at `9112820e8b4c2e2c72fd69dc660d564493bbc1d9`
- **Purpose:** prove that a validated R6-001 backup is actually recoverable by restoring it into one generated temporary PostgreSQL database, reconciling critical control totals, and deleting the temporary database before reporting success.

### Implemented authorization and audit

- dedicated `VERIFY_BACKUP_RESTORE` permission for ADMIN and future CEO roles;
- CASHIER/operator denial;
- recovery audit operation `VERIFY_RESTORE`;
- replay-safe request IDs and conflicting-request rejection;
- only the initiating actor and workstation may complete the attempt;
- runtime has no direct access to recovery audit tables;
- backup role includes audit evidence read-only;
- schema version advanced to `20260805150500`.

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

- permission, operator denial, replay, conflict, actor/workstation ownership, runtime ACL, and backup ACL SQL regression;
- request confirmation and safe result DTO tests;
- focused Settings create/validate/temporary-restore workflow tests;
- complete migration chain and PostgreSQL 18 backup verification;
- all existing accounting SQL and concurrency suites;
- Rust, frontend, production build, and historical-upgrade workflows.

One exact-head Windows/Tauri recovery drill remains required before merge. It must use a real R6-001 bundle, execute PostgreSQL 18 `pg_restore`, compare restored control totals, prove the live database remains unchanged, and prove no generated temporary database remains.

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
