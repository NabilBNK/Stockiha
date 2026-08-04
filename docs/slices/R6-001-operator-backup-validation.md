# R6-001 — Operator Backup Creation and Bundle Validation

## Status

Implementation remains on draft PR #13. Exact-head automated verification and one clean Windows/Tauri acceptance run are required before the PR may leave draft state.

## Objective

Turn the existing backup proof into a typed, permission-controlled operator workflow that can:

1. create a complete Stockiha backup bundle;
2. validate an existing bundle without modifying the live database;
3. return a redacted, auditable result suitable for Settings → Backup and recovery.

## Safety boundary

This slice must not:

- restore into or replace the live database;
- delete, overwrite, or silently reuse an unrelated existing bundle;
- accept caller-supplied PostgreSQL roles, credentials, database URLs, asset paths, destination roots, or dump executables;
- expose credential bytes, connection strings, filesystem diagnostics, or child-process output through IPC;
- make `stockiha_owner` login-capable;
- require manual schema ownership or ACL repair;
- claim that restore or production startup configuration is complete.

Live restore, temporary-database reconciliation, retention, scheduling, and production credential-backed startup remain later R6 work.

## Implemented backend boundary

Commands:

- `create_operator_backup`
- `validate_operator_backup`

Both commands use typed request/response DTOs and stable public error codes. Internal proof diagnostics remain private.

### Authorization and audit

- `CREATE_BACKUP_BUNDLE` and `VALIDATE_BACKUP_BUNDLE` are database-authoritative permissions.
- Both default to the `ADMIN` role only.
- Every attempt records actor, workstation, operation, outcome, timestamp, request id, and a non-secret bundle identifier.
- Request ids are replay-safe. A completed request returns its original safe result.
- A creation retry resumes only the original database-owned bundle identifier.
- Two creation requests cannot claim the same second-based bundle name.

### Backup creation

The request contains only an idempotency request id. The backend resolves:

- configured `STOCKIHA_BACKUP_ROOT`;
- fixed `stockiha_backup` PostgreSQL role;
- fixed Windows Credential Manager target;
- host, port, and database from application database configuration;
- PostgreSQL 18 `pg_dump`;
- fixed application-data asset locations.

Creation stages the bundle on the destination filesystem, rewrites real recoverable schema metadata, validates before publication, publishes atomically without overwrite, validates again, and records only safe result metadata.

### Read-only validation

Validation checks root containment, original paths before canonicalization, symlinks and Windows reparse points, layout, manifest, required files, dump non-emptiness, sizes, SHA-256 values, traversal, and application/schema/PostgreSQL compatibility. Invalid bundles are never changed or repaired.

## SQLx metadata compatibility

Windows acceptance exposed that `sqlx migrate` creates `public._sqlx_migrations` before repository migrations. That table is not directly owned by `stockiha_owner`, so the previous owner-schema ACL sweep did not cover it and PostgreSQL `pg_dump` could fail.

Forward migration `20260804120500_r6_001_sqlx_metadata_backup_acl.sql` grants `stockiha_backup` read-only `SELECT` on `public._sqlx_migrations` when present. It does not:

- make `stockiha_owner` login-capable;
- change `public` schema ownership;
- grant CREATE;
- grant writes to SQLx metadata;
- broaden access to unrelated public objects.

CI now creates a representative SQLx metadata table outside `stockiha_owner` ownership before repository migrations and requires:

- `stockiha_owner` to remain `NOLOGIN`;
- backup SELECT access to SQLx metadata;
- no INSERT, UPDATE, DELETE, or TRUNCATE access;
- a successful PostgreSQL 18 custom-format `pg_dump` as `stockiha_backup`.

## Frontend

Settings supports:

- creating a backup in the configured root;
- selecting and validating an existing backup;
- one global in-flight lock;
- safe success and failure states;
- EN/FR/AR copy and RTL behavior;
- an explicit warning that restore is unavailable.

## Windows acceptance requirements

Acceptance must use:

1. A fresh dedicated test database.
2. Normal role posture, including `stockiha_owner NOLOGIN` throughout.
3. The normal SQLx migration path without manual schema ownership or ACL repair.
4. The official `scripts/r6-001-provision-backup-credential.ps1` helper only.
5. A new empty backup root.
6. Creation through the real Tauri Settings UI.
7. Complete sanitized JSON from `scripts/r6-001-verify-bundle.ps1`.
8. A copied tampered bundle rejected by the application.
9. Revalidation of the untouched original.
10. A clean working tree and preserved stashes.

Evidence is rejected if it contains passwords, complete database URLs, credential bytes, secret-bearing commands, custom credential provisioning code, manual owner-login changes, manual schema ownership changes, manual ACL repair, or temporary weakening of PostgreSQL authentication.

## Remaining completion gate

- exact final commit SHA and green exact-head CI;
- clean Windows/Tauri backup creation against a fresh dedicated test database;
- independent checksum verification;
- copied-bundle tamper rejection;
- untouched-original revalidation;
- confirmation that no restore command exists.
