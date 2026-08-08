# R8-001 — Integrated Pilot Acceptance

## Status

Active release gate. No new product feature scope is authorized here.

## Purpose

Prove one controlled Windows/Tauri pilot on a reproducible, least-privilege PostgreSQL 18 environment. R8 evidence is valid only when the database was provisioned from a fresh empty database through the documented role posture and SQLx migration path without ad-hoc ownership, ACL, migration-metadata, or authentication repair.

## Why the provisioning helper exists

Real R8 fresh-database testing exposed migration assumptions that older raw-administrator CI could not reveal:

1. SQLx creates `public._sqlx_migrations` before repository migrations execute, so `stockiha_migrator` needs the minimal `USAGE, CREATE` privilege on `public`.
2. Immutable historical S3 migrations `20260725130000` through `20260725140200` predate the explicit `SET ROLE stockiha_owner` convention and contain owner-only DDL/function operations.
3. Four later compatibility shims were intentionally written for an administrative migration connection because they inspect or normalize legacy postgres-owned objects:
   - `20260731125975_cash_session_function_owner_compat.sql`;
   - `20260731125990_cash_session_api_collision_compat.sql`;
   - `20260801100000_s4_003_function_owner_compat.sql`;
   - `20260803125900_r2_s3_owner_compat.sql`.

Already-released migration files are checksum history and must remain byte-for-byte immutable. The accepted fresh-install path therefore uses three bounded execution modes instead of rewriting old migrations:

- **Normal migrator:** SQLx authenticates as `stockiha_migrator`; modern migrations request `SET ROLE stockiha_owner` themselves when required.
- **Immutable S3 owner bridge:** SQLx still authenticates as `stockiha_migrator`, but new connections receive the session-only startup option `role=stockiha_owner` only for the S3 legacy band. `stockiha_owner` receives temporary `SELECT, INSERT, UPDATE` on SQLx metadata so SQLx can record those rows, and those rights are revoked immediately afterward.
- **Administrative compatibility shims:** SQLx uses a separate process-only administrator migration URL only for the four explicit legacy compatibility migrations listed above, then returns immediately to `stockiha_migrator`.

No role default is changed, no schema ownership is changed, and `public._sqlx_migrations` remains owned by `stockiha_migrator` throughout.

The official helper is:

`scripts/r8-001-provision-acceptance-database.ps1`

The exact helper is exercised on PostgreSQL 18 by `.github/workflows/r8-sqlx-fresh-provisioning.yml`. The workflow also proves that the historical migration files used by the compatibility path are unchanged versus `main`.

## Required role posture

- `stockiha_owner`: `NOLOGIN`, `NOINHERIT`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`, `NOBYPASSRLS`.
- `stockiha_migrator`: `LOGIN`, `NOINHERIT`, otherwise non-privileged, with exactly one membership: `stockiha_owner` using `ADMIN FALSE`, `INHERIT FALSE`, `SET TRUE`.
- `stockiha_runtime`: `LOGIN`, no owner membership, no cluster administration privileges.
- `stockiha_backup`: `LOGIN`, no owner membership, no cluster administration privileges.

## Provisioning environment contract

The helper accepts secrets only from the current process environment. Do not print or persist them.

Administrator `psql` connection:

- `PGHOST`
- `PGPORT`
- `PGUSER`
- `PGPASSWORD`
- `PGDATABASE` — an existing control database, not the fresh acceptance database.

SQLx migrator connection:

- `DATABASE_URL` — must authenticate as `stockiha_migrator` and target the exact fresh acceptance database.

Administrative compatibility connection:

- `STOCKIHA_R8_ADMIN_MIGRATION_DATABASE_URL` — must authenticate as the same administrator role as `PGUSER`, target the same PostgreSQL server, and target the exact fresh acceptance database. It is used only for the four historical administrative compatibility shims.

## Migration acceptance contract

Valid R8 provisioning evidence requires all of the following:

1. Fresh database whose validated name matches `stockiha_r8_acceptance*_test`.
2. PostgreSQL major version 18.
3. SQLx CLI 0.8.x, matching the repository SQLx dependency line.
4. `public._sqlx_migrations` created by SQLx and owned by `stockiha_migrator`.
5. S3 owner bridge bounded to the immutable S3 legacy band only; no persistent owner-role default.
6. Temporary owner DML rights on SQLx metadata fully revoked after the S3 bridge.
7. Direct administrator SQLx used only for the four documented compatibility shims.
8. All historical migration files remain byte-for-byte unchanged.
9. Repository migrations reach `20260807230000`.
10. A second complete `sqlx migrate run` as `stockiha_migrator` succeeds without checksum, dirty-state, missing-migration, or pending-migration failure.
11. `stockiha_backup` has `SELECT` only on SQLx metadata.
12. `stockiha_runtime` has no `CREATE` privilege on `public`.

## Forbidden acceptance repairs

The following invalidate the database as release evidence:

- manually executing repository migrations with `psql -f`;
- modifying any already-released migration file;
- manually inserting, updating, deleting, or forging `_sqlx_migrations` rows;
- changing `_sqlx_migrations` ownership after SQLx creates it;
- `ALTER SCHEMA public OWNER ...` as a workaround;
- `GRANT ALL ON SCHEMA public ...` or `GRANT ALL ON ALL TABLES ...` as a workaround;
- persistent `ALTER ROLE stockiha_migrator IN DATABASE ... SET role = stockiha_owner`;
- expanding the session-only owner bridge beyond the documented S3 interval;
- using the administrative SQLx connection for ordinary migrations outside the four documented compatibility shims;
- running Tauri as `postgres`, `stockiha_owner`, or `stockiha_migrator`;
- recovering administrator credentials from Git history;
- weakening `pg_hba.conf` or PostgreSQL authentication to make acceptance pass.

If provisioning fails, that database is rejected. Diagnose the tooling or migration-path defect, then create a new fresh database. Do not repair a failed database into a passing state.

## Runtime acceptance contract

After provisioning, `STOCKIHA_DEV_DATABASE_URL` must point to the same acceptance database and authenticate as `stockiha_runtime`.

Required runtime proof:

- `current_user = stockiha_runtime`;
- `current_setting('is_superuser') = off`;
- `SET ROLE stockiha_owner` is denied;
- Tauri starts through `run-app.bat` / `npm run tauri dev` without a permission error;
- no credential or complete connection URL is included in evidence.

## UI evidence rule

A UI item is `PASS` only when the operator actually interacted with the running Tauri desktop application and recorded a concrete visible element or result unique to that screen. Source inspection, route existence, frontend tests, or code knowledge cannot substitute for GUI evidence. If automation cannot interact with the desktop UI, report `NOT TESTED`.

## Full R8 journey after entry passes

The integrated pilot gate then exercises, on one exact candidate and one controlled database:

setup/login -> historical onboarding -> opening-state handling -> catalog/stock -> procurement -> cash sale -> credit sale -> customer payment/refund -> cashier close/variance/suspend/handover -> restart -> backup creation/validation -> temporary restore verification -> control-total reconciliation.

Any unexplained money, stock, AR, AP, journal, import, opening-state, or restore variance blocks release.
