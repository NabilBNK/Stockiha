# R6-001 — Operator Backup Creation and Bundle Validation

## Status

Implementation is complete on draft PR #13. Automated verification is running on the exact hardened head. Real Windows/Tauri creation, independent checksum verification, and tamper-detection evidence remain mandatory before the PR may leave draft state.

## Objective

Turn the existing S0-009 backup proof into a typed, permission-controlled operator workflow that can:

1. create a complete Stockiha backup bundle;
2. validate an existing bundle without modifying the live database;
3. return a redacted, auditable result suitable for a Settings/Recovery screen.

## Safety boundary

This slice **must not**:

- restore into or replace the live database;
- delete, overwrite, or silently reuse an unrelated existing bundle directory;
- accept caller-supplied PostgreSQL roles, credentials, database URLs, asset paths, destination roots, or dump executables;
- expose credential bytes, connection strings, filesystem diagnostics, or child-process output through IPC;
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

- the configured `STOCKIHA_BACKUP_ROOT`;
- the fixed `stockiha_backup` PostgreSQL role;
- the fixed Windows Credential Manager target;
- the PostgreSQL host, port, and database from the existing application database configuration;
- the PostgreSQL 18 `pg_dump` executable;
- fixed application-data locations for attachments, generated customer documents, and company assets.

Creation flow:

1. reject a missing, non-directory, symlink, or Windows reparse-point backup root;
2. reserve the request and bundle identifier in the database audit;
3. discover and require PostgreSQL 18 `pg_dump`;
4. read the fixed backup credential without logging or returning it;
5. create the bundle in a hidden staging directory on the destination filesystem;
6. replace the proof-only schema value with the database-owned migration version and regenerate manifest/checksums;
7. validate the staged bundle;
8. atomically publish it without overwrite;
9. validate the published bundle again;
10. complete the audit with safe metadata only.

If publication succeeded but audit completion failed, retrying the same request validates and returns that exact published bundle instead of creating a duplicate. A first attempt never reuses a pre-existing directory.

### Read-only validation

Validation verifies:

- configured-root and direct-child containment;
- the original selected root/bundle path before canonicalization;
- symlink and Windows reparse-point rejection;
- bundle layout and required directories/files;
- manifest format and schema;
- path traversal and canonical containment;
- dump non-emptiness;
- all recorded SHA-256 checksums and file sizes;
- application, schema, and PostgreSQL compatibility metadata.

Invalid bundles are never modified or repaired.

### Safe result

Creation and validation return only:

- request id;
- bundle identifier/name;
- creation timestamp label;
- application version;
- schema/migration version;
- PostgreSQL major version;
- integrity and compatibility flags;
- total bundle bytes and file count.

No credential, connection string, database URL, process output, or unrestricted filesystem path is returned.

## Frontend

Settings now supports:

- creating a backup in the configured root;
- selecting and validating an existing backup;
- one global in-flight lock to prevent duplicate submissions;
- safe success and failure states;
- EN/FR/AR copy and RTL behavior;
- a clear warning that restore is unavailable.

## Automated verification

Covered by unit, SQL, and frontend workflow tests:

- authorization and role defaults;
- request replay/idempotency;
- actor/workstation ownership;
- same-name creation collision rejection;
- root/path containment;
- existing destination behavior;
- PostgreSQL version and credential proof mappings;
- interrupted creation cleanup through staged-directory guards;
- manifest/checksum rewriting with the real schema version;
- tamper/layout/path traversal/symlink proof coverage;
- redacted creation and validation errors;
- request-id-only creation payload;
- duplicate-submit prevention;
- EN/FR/AR and RTL states;
- proof that no restore command is registered.

## Windows acceptance procedure

Use a dedicated local test database, never a live production database.

### 1. Prepare configuration

Set the existing development database URL, a real backup directory, and the PostgreSQL 18 `pg_dump.exe` path in the same PowerShell session that starts Tauri:

```powershell
$env:STOCKIHA_DEV_DATABASE_URL = 'postgres://stockiha_runtime:<runtime-password>@127.0.0.1:5432/stockiha_test?sslmode=disable'
$env:STOCKIHA_BACKUP_ROOT = 'C:\Stockiha-R6-Test-Backups'
$env:STOCKIHA_PG_DUMP_PATH = 'C:\Program Files\PostgreSQL\18\bin\pg_dump.exe'
New-Item -ItemType Directory -Force -Path $env:STOCKIHA_BACKUP_ROOT | Out-Null
```

Do not paste real credentials into logs, screenshots, issue comments, or chat.

### 2. Set the PostgreSQL backup-role password

Open `psql` as an authorized local administrator and use its interactive hidden prompt:

```text
\password stockiha_backup
```

The role must remain `LOGIN`, `NOINHERIT`, non-superuser, and without owner membership.

### 3. Provision the matching Credential Manager secret

Run the repository helper and enter the same password at its hidden prompt:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\r6-001-provision-backup-credential.ps1
```

The helper writes and verifies only the fixed target `Stockiha/PostgreSQL/backup/password` as raw UTF-8 bytes. It never passes the password through Tauri IPC or prints it.

### 4. Run Stockiha and create the bundle

```powershell
npm ci
npm run tauri dev
```

Sign in as an administrator, open **Settings → Backup and recovery**, and select **Create backup**. Record only the returned safe metadata and bundle identifier.

### 5. Independently verify checksums

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\r6-001-verify-bundle.ps1 `
  -BundlePath 'C:\Stockiha-R6-Test-Backups\GestStock-Backup-YYYYMMDD-HHMMSS'
```

The script independently parses `checksums.sha256` and `manifest.json`, rejects traversal/reparse points, recomputes SHA-256, checks file sizes, and emits safe JSON evidence.

### 6. Create a tampered copy

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\r6-001-verify-bundle.ps1 `
  -BundlePath 'C:\Stockiha-R6-Test-Backups\GestStock-Backup-YYYYMMDD-HHMMSS' `
  -CreateTamperedCopy
```

The script copies the valid bundle to a new canonical bundle name and appends one byte to the copied `database.dump`. It never changes the original.

Use the Settings validation action on the returned tampered path. The expected public result is `BACKUP_VALIDATION_FAILED`. Then validate the original again and confirm it still succeeds.

### 7. Capture evidence

Record:

- exact branch commit;
- PostgreSQL and `pg_dump` major version;
- safe creation result;
- independent verifier JSON;
- tampered bundle rejection;
- original bundle revalidation;
- confirmation that no restore action exists.

Redact passwords, URLs containing passwords, local usernames, and unrelated filesystem paths.

## Remaining completion evidence

- exact final commit SHA and green exact-head CI;
- Windows/Tauri backup creation against a dedicated test database;
- independent checksum verification of the created bundle;
- tamper-detection evidence on a copied bundle;
- proof that no live restore command is registered.
