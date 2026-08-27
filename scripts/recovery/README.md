# Stockiha recovery bootstrap (WS-H-1, G1)

## What this is

`stockiha_bootstrap_roles_and_grants.sql` is a **generated, idempotent** SQL
artifact that rebuilds the four fixed Stockiha PostgreSQL roles
(`stockiha_owner`, `stockiha_migrator`, `stockiha_runtime`, `stockiha_backup`,
plus any admin/superuser role actually present on the source cluster) and
reapplies every schema/table/sequence/function **ownership** and **GRANT**
currently in effect, derived directly from the live catalog.

It exists because the Stockiha backup bundle is a single-database `pg_dump
--no-owner --no-privileges` (see `docs/recovery/RESTORE_PROCEDURE.md`): the
dump restores tables and data, but **not** roles, ownership, or grants. This
script is what a developer runs, once, immediately after `pg_restore`, to
bring a freshly restored database back to a working authorization state.

It never contains a real password or password hash — every `CREATE ROLE`
uses the fixed placeholder `'CHANGE_ME_BOOTSTRAP_PLACEHOLDER'`, and the file
ends with an explicit instruction to set real passwords immediately
afterward, interactively (`\password`), never via a script argument.

## Regenerating it — REQUIRED whenever a migration changes authorization

**Any migration that adds a role, a `GRANT`, changes object ownership, or
adds an `ALTER DEFAULT PRIVILEGES` rule makes this file stale.** Regenerate it
in the same change:

```powershell
$env:STOCKIHA_DEV_DATABASE_URL = <the usual dev/acceptance connection string>
pwsh -File scripts/recovery/generate-bootstrap-roles-and-grants.ps1
```

Or pass an explicit connection string:

```powershell
pwsh -File scripts/recovery/generate-bootstrap-roles-and-grants.ps1 -ConnectionString "postgres://stockiha_runtime:<password>@127.0.0.1:5433/stockiha_acceptance?sslmode=disable"
```

The generator only **reads** `pg_roles`, `pg_auth_members`, `pg_namespace`,
`pg_class`, `pg_proc`, and `pg_default_acl` — it issues no DDL/DML against the
source database and never touches business data. Commit the regenerated
`stockiha_bootstrap_roles_and_grants.sql` in the same commit as the migration
that changed authorization.

## Idempotency

Every statement in the generated file is safe to run twice:
- `CREATE ROLE` is wrapped in `IF NOT EXISTS`.
- `ALTER ROLE ... <attributes>` sets fixed attributes; setting them twice is
  a no-op.
- `GRANT ... TO ...` and `ALTER DEFAULT PRIVILEGES ... GRANT ...` are
  declarative; PostgreSQL accepts granting an already-held privilege again.
- `ALTER <object> OWNER TO ...` setting an object to its current owner again
  is a no-op.

This was proven during the WS-H-1 task by running the script twice against a
throwaway cluster — see the task's Result Report for both real outputs.

## What it does NOT do

- It does not create schemas, tables, or functions — those come from
  `pg_restore`.
- It does not set real passwords — see the NOTICE at the end of the
  generated file.
- It does not touch `pg_hba.conf` or any cluster-level configuration.
