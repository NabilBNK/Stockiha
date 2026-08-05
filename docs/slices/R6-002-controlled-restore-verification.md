# R6-002 — Controlled Temporary Restore Verification

## Purpose

Prove that a Stockiha operator backup can actually be restored and reconciled before the pilot relies on it.

R6-001 proves that Stockiha can create and cryptographically validate a backup bundle. R6-002 adds the missing recoverability proof:

```text
validated backup bundle
→ generated temporary PostgreSQL database
→ PostgreSQL 18 pg_restore
→ critical control-total reconciliation
→ forced temporary-database cleanup
→ audited success or failure
```

This slice does **not** replace the live Stockiha database.

## Authorization

The workflow requires the dedicated `VERIFY_BACKUP_RESTORE` permission.

- `ADMIN` receives the permission.
- A future `CEO` role receives it automatically when present.
- `CASHIER` and ordinary operators do not receive it.
- The runtime role can call only the guarded begin/complete functions and has no direct access to recovery audit tables.

## Preconditions

A restore verification request is valid only when:

1. the caller has `VERIFY_BACKUP_RESTORE`;
2. the caller explicitly confirms the temporary-database drill;
3. the selected folder is a canonical `GestStock-Backup-YYYYMMDD-HHMMSS` bundle;
4. the folder is directly inside `STOCKIHA_BACKUP_ROOT`;
5. the folder and its contents are real files/directories rather than symlinks or Windows reparse points;
6. every manifest/checksum entry passes the existing authoritative bundle validator;
7. application version matches the running Stockiha build;
8. schema version matches `operations.schema_state` exactly;
9. the bundle and installed tools use PostgreSQL major version 18;
10. the deployer-configured `STOCKIHA_RESTORE_ADMIN_DATABASE_URL` targets the `postgres` maintenance database.

The administrative connection configuration is resolved inside the backend. No database role, password, connection URL, executable path, or target database name crosses Tauri IPC.

## Temporary Restore Boundary

The backend generates a database name with the fixed destructive guard prefix:

```text
stockiha_restore_proof_*
```

Only generated lowercase ASCII names with that prefix can be created or dropped by the restore adapter.

The restore process uses:

```text
pg_restore
--exit-on-error
--single-transaction
--no-owner
--no-privileges
```

The `pg_restore` process runs on a blocking worker so the Tauri async runtime remains responsive.

## Reconciliation Result

After restore, Stockiha reads only fixed internal queries and returns these safe totals:

- application schema count;
- application table count;
- users;
- products;
- customers;
- suppliers;
- inventory positions;
- inventory movements;
- cash sales;
- journals;
- total journal debit;
- total journal credit;
- journal-balance status;
- total customer exposure;
- total supplier outstanding balance;
- applied opening-state count.

The result never contains:

- temporary database name;
- database URL;
- password or credential;
- raw `pg_restore` output;
- unrestricted filesystem path;
- PostgreSQL diagnostic text.

## Cleanup and Failure Semantics

The generated database must be deleted with `DROP DATABASE ... WITH (FORCE)` before success is reported.

- Successful restore + successful reconciliation + successful cleanup → audited success.
- Restore or reconciliation failure → preserve the original failure and attempt cleanup.
- Successful restore but failed cleanup → failure; never report success while a temporary database remains.
- A retry with the same request ID and bundle replays the immutable result.
- Reusing a request ID for another bundle is rejected.
- Another administrator or workstation cannot complete the first actor’s attempt.

## User Experience

The restricted Backup and recovery Settings screen provides:

1. Create backup.
2. Validate backup.
3. Select the existing backup folder.
4. Explicitly acknowledge temporary database creation/deletion.
5. Run **Verify temporary restore**.
6. Review cleanup status, journal balance, and critical control totals.

Copy is provided in English, French, and Arabic with RTL support.

## Explicit Non-Goals

R6-002 does not:

- replace or rename the live database;
- stop the live Stockiha application;
- restore over an existing database;
- accept a caller-selected database target;
- restore an incompatible backup;
- copy restored asset files into live application directories;
- schedule backups;
- implement retention, encryption, cloud upload, or off-device replication;
- provide a live restore button.

A future live replacement workflow would require a separate maintenance-mode design, pre-restore backup, explicit confirmation, rollback plan, and its own acceptance gate.

## Required Verification

Automated verification must prove:

- permission grant and operator denial;
- replay and request-conflict behavior;
- actor/workstation ownership;
- runtime table-access denial;
- backup-role read-only audit inclusion;
- bundle path and confirmation validation;
- no secret or temporary target in IPC results;
- frontend confirmation and fixed safe failure copy;
- complete migration, SQL, Rust, frontend, concurrency, backup, and historical-upgrade suites remain green.

One targeted Windows/Tauri recovery drill must then prove:

- a real R6-001 backup is selected through the application;
- `npm run tauri dev` runs the actual UI;
- PostgreSQL 18 `pg_restore` executes;
- restored totals match expected live-source totals captured before backup;
- the live database remains accessible and unchanged;
- no `stockiha_restore_proof_*` database remains after success;
- the repository worktree remains clean.
