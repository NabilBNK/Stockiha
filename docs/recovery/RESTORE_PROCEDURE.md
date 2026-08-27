# Stockiha manual restore procedure

**Audience:** the developer performing a restore, on a machine where Stockiha
will not start (new PC, reinstalled Windows, failed drive replaced). This is
not a Stockiha UI feature — restoring the live database is a deliberately
manual, command-line procedure. There is no "restore" button in the app; see
`docs/slices/R6-002-controlled-restore-verification.md` and the WS-H-1 task
report for why that is a frozen (deferred) scope decision, not an oversight.

Every step below was executed once, for real, during the WS-H-1 task against
a throwaway PostgreSQL cluster — not written from assumption. See the WS-H-1
Result Report for the exact commands run and their real output, and for where
this document had to be corrected to match reality.

## What you need before starting

- A Stockiha backup bundle: a folder named `GestStock-Backup-YYYYMMDD-HHMMSS`
  containing `database.dump`, `manifest.json`, `checksums.sha256`,
  `schema-version.txt`, `application-version.txt`, `postgres-version.txt`, and
  the three asset directories (`attachments/`, `generated-documents/`,
  `company-assets/`).
- PostgreSQL 18 client tools (`pg_restore`, `psql`) and, ideally, a PostgreSQL
  18 server installer, matching the major version recorded in the bundle's
  `postgres-version.txt`. A client older than the server (or vice versa on
  major version) is not supported — Stockiha requires an exact PostgreSQL 18
  match.
- This repository checked out, for `scripts/recovery/stockiha_bootstrap_roles_and_grants.sql`.
- Administrator access on the target Windows machine.

## Step 1 — Verify the bundle before touching any database

Never restore an unvalidated bundle. From an elevated PowerShell prompt:

```powershell
pwsh -File scripts\r6-001-verify-bundle.ps1 -BundlePath "C:\path\to\GestStock-Backup-YYYYMMDD-HHMMSS"
```

Confirm `integrityValid: true` in the output before continuing. If this step
fails, stop — do not attempt to restore a bundle that failed checksum
verification.

## Step 2 — Install PostgreSQL 18 and initialize a cluster (new machine only)

Skip this step if a working PostgreSQL 18 cluster already exists.

1. Install PostgreSQL 18 (the same major version as `postgres-version.txt` in
   the bundle). Note the installation path, typically
   `C:\Program Files\PostgreSQL\18\bin`.
2. Initialize a data directory and start the cluster, e.g.:
   ```powershell
   & "C:\Program Files\PostgreSQL\18\bin\initdb.exe" -D "C:\StockihaData" -U stockiha_admin -A scram-sha-256 --pwfile=<a temp file containing a chosen admin password> --encoding=UTF8
   & "C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe" -D "C:\StockihaData" -l "C:\StockihaData\startup.log" start
   ```
   Choose the `stockiha_admin` password yourself; it is never shipped with
   the application. Delete the temporary password file immediately after
   `initdb` succeeds.
3. Confirm the server is accepting connections:
   ```powershell
   & "C:\Program Files\PostgreSQL\18\bin\pg_isready.exe" -h 127.0.0.1 -p 5432
   ```

## Step 3 — Create the target database

```powershell
$env:PGPASSWORD = '<the stockiha_admin password you chose>'
& psql -h 127.0.0.1 -p 5432 -U stockiha_admin -d postgres -c "CREATE DATABASE stockiha_acceptance;"
```

Use whatever database name your `run.bat` / deployment configuration expects
(`stockiha_acceptance` in this repository's dev/acceptance convention).

## Step 4 — Restore the dump into the new, empty database

```powershell
& pg_restore --exit-on-error --single-transaction --no-owner --no-privileges `
    --host=127.0.0.1 --port=5432 --username=stockiha_admin --dbname=stockiha_acceptance `
    "C:\path\to\GestStock-Backup-YYYYMMDD-HHMMSS\database.dump"
```

This restores every schema, table, and function — owned, for now, by whichever
role ran `pg_restore` (here, `stockiha_admin`), with **no** grants, because the
backup was produced with `--no-owner --no-privileges` (see the WS-H diagnostic
report for why: a single-database dump captures no cluster globals). The
database now has all your data but the application cannot yet use it.

## Step 5 — Rebuild roles, ownership, and grants (G1)

This is what `scripts/recovery/stockiha_bootstrap_roles_and_grants.sql`
exists for. Run it against the freshly restored database:

```powershell
$env:PGPASSWORD = '<the stockiha_admin password you chose>'
& psql -h 127.0.0.1 -p 5432 -U stockiha_admin -d stockiha_acceptance -v ON_ERROR_STOP=1 -f scripts\recovery\stockiha_bootstrap_roles_and_grants.sql
```

This creates the four Stockiha roles (`stockiha_owner`, `stockiha_migrator`,
`stockiha_runtime`, `stockiha_backup`) if they do not already exist, fixes
every table/sequence/function/schema ownership back to what the application
expects, and reapplies every `GRANT`. It is safe to run more than once — every
statement is idempotent. **Run it twice** as part of this drill to confirm
that in practice: the second run must produce no errors and change nothing
further.

## Step 6 — Set real passwords

Every role the bootstrap script creates gets the fixed placeholder password
`CHANGE_ME_BOOTSTRAP_PLACEHOLDER`. Set the real ones now, interactively, one
at a time — never as a script argument or in shell history:

```
psql -h 127.0.0.1 -p 5432 -U stockiha_admin -d stockiha_acceptance
\password stockiha_runtime
\password stockiha_migrator
\password stockiha_backup
\q
```

Use the same passwords stored in this machine's Windows Credential Manager /
`runtime.key` / `migrator.key` / `backup.key`-equivalent secrets — whatever
your deployment's credential provisioning uses. If you are also re-provisioning
credentials from scratch, generate new passwords and store them the same way
`run_r8_provisioning.ps1` does for a dev/acceptance machine (see that script
for the exact provisioning pattern; it is not itself part of this restore
procedure).

## Step 7 — Verify the restore

Compare row counts and the journal balance against what you expect (the
bundle's manifest does not carry row counts, so compare against your own
records or a prior report):

```sql
SELECT 'iam.users', count(*) FROM iam.users
UNION ALL SELECT 'finance.journal_entries', count(*) FROM finance.journal_entries
UNION ALL SELECT 'finance.journal_lines', count(*) FROM finance.journal_lines
UNION ALL SELECT 'core.business_documents', count(*) FROM core.business_documents
UNION ALL SELECT '_sqlx_migrations', count(*) FROM public._sqlx_migrations;

SELECT document_id, SUM(debit), SUM(credit)
FROM finance.journal_lines
GROUP BY document_id
HAVING SUM(debit) <> SUM(credit);
-- Expect 0 rows: every document's debits and credits balance.
```

Then confirm the application itself can start: point `STOCKIHA_DEV_DATABASE_URL`
(or the deployment's equivalent) at this database and launch Stockiha.

## Step 8 — Restore file-based assets (if the bundle contains any)

Copy the contents of the bundle's `attachments/`, `generated-documents/`, and
`company-assets/` directories back into the application's data directory
(Tauri's `app_data_dir`, under `attachments/`, `generated/customer-documents/`,
and `company-assets/` respectively). Stockiha's database restore (Steps 4-7)
does not touch these — they are plain files copied alongside the dump.

## What this procedure deliberately does NOT do

- It never targets a database still in use by a running Stockiha instance.
  Stop the application first.
- It never uses `--clean`/`--create`/`dropdb`/`DROP SCHEMA` against the
  target — those are reserved for disposable verification databases only (see
  `src-tauri/src/infrastructure/restore_proof/mod.rs`), never a real restore.
- It does not reconfigure `pg_hba.conf` or cluster-level authentication.
