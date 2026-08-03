# R6-001 — Operator Backup Creation and Bundle Validation

## Status

Approved for implementation from `main` after PR #12. This slice starts R6 without exposing destructive restore operations.

## Objective

Turn the existing S0-009 backup proof into a typed, permission-controlled operator workflow that can:

1. create a complete Stockiha backup bundle;
2. validate an existing bundle without modifying the live database;
3. return a redacted, auditable result suitable for a Settings/Recovery screen.

## Safety boundary

This slice **must not**:

- restore into or replace the live database;
- delete, overwrite, or silently reuse an existing bundle directory;
- accept caller-supplied PostgreSQL roles or credentials;
- expose credential bytes, connection strings, filesystem diagnostics, or child-process output through IPC;
- run during an active import apply, financial posting, or unsafe maintenance state once those locks exist;
- claim that backup/restore is production-complete.

Live restore, temporary-database reconciliation, retention, scheduling, and production credential-backed startup remain later R6 work.

## Existing foundation

The repository already contains proof modules for:

- bundle creation, manifests, checksums, assets, and atomic rename;
- PostgreSQL 18 `pg_dump` validation;
- Windows Credential Manager access for the fixed `stockiha_backup` role;
- bundle validation;
- temporary-database restore and reconciliation proof code.

Those modules are infrastructure proofs and currently have no product-facing IPC or UI consumer.

## Required implementation

### Backend boundary

Add a dedicated recovery domain/application/command boundary rather than exposing proof types directly.

Required commands:

- `create_operator_backup`
- `validate_operator_backup`

Each command must use typed request/response DTOs and stable public error codes. Internal proof diagnostics remain private.

### Authorization

- Backup creation and validation require an explicitly assigned recovery capability.
- The capability defaults enabled for the authorized CEO/administrator role under the project toggle policy.
- Runtime database roles remain fixed and database-authoritative.
- Every attempt records actor, workstation, operation, outcome, timestamp, and a non-secret bundle identifier.

### Backup request

The caller may select only an allowed destination root. The backend resolves all included Stockiha data locations itself.

The request must not contain:

- a password;
- a database URL;
- a PostgreSQL role;
- arbitrary asset source paths;
- a caller-selected dump executable.

### Backup result

Return only safe metadata:

- bundle identifier/name;
- creation timestamp;
- application version;
- schema/migration version;
- PostgreSQL major version;
- manifest/checksum validation status;
- total bundle bytes and file count;
- stable status/error code.

Do not return credential, connection, raw process, or unrestricted filesystem details.

### Validation request/result

Validation is read-only. It must verify:

- bundle layout;
- manifest schema/version;
- required files;
- path containment;
- dump non-emptiness;
- all recorded SHA-256 checksums;
- application/schema/PostgreSQL compatibility metadata.

An invalid bundle returns a typed failure and never mutates or repairs the bundle.

### Frontend

Add a minimal Recovery section under Settings that supports:

- creating a backup;
- selecting and validating an existing backup;
- showing progress and the final safe result;
- preventing duplicate submissions;
- EN/FR/AR and RTL labels;
- a clear warning that restore is not available in R6-001.

## Acceptance criteria

- Authorized operator can create a bundle on Windows through Tauri.
- Bundle creation uses the fixed backup role and Credential Manager secret.
- Successful creation is followed by backend validation before success is returned.
- Existing destinations are never overwritten.
- Symlink/reparse-point and path-escape inputs are rejected.
- Tampered manifest, checksum, dump, or asset produces a typed validation failure.
- Unauthorized callers cannot create or validate backups.
- Retrying a completed request does not create ambiguous duplicate audit records.
- No secret or raw child-process output reaches logs, IPC, UI, or test snapshots.
- Frontend typecheck, lint, tests, and build pass.
- Rust unit tests and targeted Windows tests pass.

## Required tests

- authorization and capability defaults;
- request validation and allowed-root enforcement;
- existing destination collision;
- missing `pg_dump` and PostgreSQL version mismatch;
- unavailable/invalid credential;
- dump failure and interrupted creation cleanup;
- manifest/checksum tampering;
- path traversal, symlink, and reparse-point rejection;
- duplicate submission/idempotency behavior;
- audit success/failure records;
- EN/FR/AR, RTL, loading, error, and success UI states.

## Completion evidence

- exact commit SHA;
- CI results;
- Windows/Tauri backup creation log using a test database;
- independent bundle checksum validation;
- tamper-detection evidence;
- proof that no live restore command is registered.
