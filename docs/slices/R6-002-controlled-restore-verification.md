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

## Authorization and Policy

The workflow requires the dedicated `VERIFY_BACKUP_RESTORE` permission.

- `ADMIN` receives the permission.
- A future `CEO` role receives it automatically when present.
- `CASHIER` and ordinary operators do not receive it.
- The runtime role can call only guarded functions and has no direct access to recovery settings or audit tables.

Temporary restore verification has a separate CEO/administrator-controlled feature setting:

```text
RESTORE_VERIFICATION_ENABLED = ON by default
```

When the setting is OFF:

- new temporary restore attempts are blocked by a database trigger;
- backup creation remains available;
- read-only bundle validation remains available;
- previous restore-verification evidence remains immutable and readable;
- a retry of an already completed request can still return its historical result;
- every setting change is audited with actor and workstation.

## Preconditions

A new restore verification request is valid only when:

1. the caller has `VERIFY_BACKUP_RESTORE`;
2. restore verification is enabled by policy;
3. the caller explicitly confirms the temporary-database drill;
4. the selected folder is a canonical `GestStock-Backup-YYYYMMDD-HHMMSS` bundle;
5. the folder is directly inside `STOCKIHA_BACKUP_ROOT`;
6. the folder and its contents are real files/directories rather than symlinks or Windows reparse points;
7. every manifest/checksum entry passes the existing authoritative bundle validator;
8. application version matches the running Stockiha build;
9. schema version matches `operations.schema_state` exactly;
10. the bundle and installed tools use PostgreSQL major version 18;
11. the deployer-configured `STOCKIHA_RESTORE_ADMIN_DATABASE_URL` targets the `postgres` maintenance database.

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

- Successful restore + reconciliation + cleanup → audited success.
- Restore or reconciliation failure → preserve the original failure and attempt cleanup.
- Successful restore but failed cleanup → failure; never report success while a temporary database remains.
- A retry with the same request ID and bundle replays the immutable result.
- Reusing a request ID for another bundle is rejected.
- Another administrator or workstation cannot complete the first actor’s attempt.

## User Experience

The restricted **Backup and recovery** Settings screen provides:

1. Default-ON policy toggle for temporary restore verification.
2. Create backup.
3. Validate backup.
4. Select the existing backup folder.
5. Explicitly acknowledge temporary database creation/deletion.
6. Run **Verify temporary restore**.
7. Review cleanup status, journal balance, and critical control totals.

Disabling the policy removes only the ability to start a new recovery drill. Create and Validate remain usable.

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
- setting defaults ON;
- admin enable/disable and audited changes;
- database enforcement while disabled;
- backup creation and validation remain available while restore is disabled;
- replay and request-conflict behavior;
- actor/workstation ownership;
- runtime table-access denial;
- backup-role read-only settings/audit inclusion;
- bundle path and confirmation validation;
- no secret or temporary target in IPC results;
- frontend policy control, confirmation, and fixed safe failure copy;
- complete migration, SQL, Rust, frontend, concurrency, backup, and historical-upgrade suites remain green.

One targeted Windows/Tauri recovery drill must then prove:

- the default-ON policy can be turned OFF and ON through the real UI;
- OFF blocks new restore drills without blocking Create or Validate;
- a real R6-001 backup is selected through the application;
- `npm run tauri dev` runs the actual UI;
- PostgreSQL 18 `pg_restore` executes;
- restored totals match expected live-source totals captured before backup;
- the live database remains accessible and unchanged;
- no `stockiha_restore_proof_*` database remains after success;
- the repository worktree remains clean.
