# R8-001 — Integrated Pilot Acceptance

## Status

Active release gate. No new product feature scope is authorized here.

## Purpose

Prove one controlled Windows/Tauri pilot on a reproducible, least-privilege PostgreSQL 18 environment. R8 evidence is valid only when the database was provisioned from a fresh empty database through the documented role posture and SQLx migration path without ad-hoc ownership or ACL repair.

## Why the provisioning helper exists

R8 fresh-database testing exposed two deployment-path gaps that older raw-administrator migration verification could not detect:

1. `sqlx migrate` creates `public._sqlx_migrations` before any repository migration executes.
2. The immutable historical S3 migration band `20260725130000` through `20260725140200` predates the repository's explicit `SET ROLE stockiha_owner` convention and contains owner-only DDL/function replacement operations.

The first gap requires one explicit provisioning privilege before SQLx starts: `USAGE, CREATE` on schema `public` for `stockiha_migrator`, with `CREATE` revoked from `PUBLIC`.

The second gap must **not** be fixed by rewriting already-released migration files because SQLx validates their checksums. Instead, the accepted fresh-install path uses a bounded session-only compatibility bridge:

1. SQLx authenticates normally as `stockiha_migrator` and migrates through `20260725120200`, creating `public._sqlx_migrations` under the migrator.
2. `stockiha_owner` receives temporary `SELECT, INSERT, UPDATE` on SQLx metadata only.
3. For new SQLx connections only, PostgreSQL startup option `role=stockiha_owner` is supplied while the authenticated `session_user` remains `stockiha_migrator`.
4. SQLx applies only `20260725130000` through `20260725140200` under that effective owner role.
5. The startup-role option is removed and the temporary metadata grants are revoked.
6. All later migrations run normally as `stockiha_migrator`; modern migration files request `SET ROLE stockiha_owner` themselves where required.
7. A second complete SQLx pass proves no checksum, dirty-state, missing-migration, or pending-migration defect remains.

This bridge changes no historical migration byte, no role default, no schema ownership, and no SQLx metadata ownership.

The official helper is:

`scripts/r8-001-provision-acceptance-database.ps1`

It creates a fresh, name-guarded R8 acceptance database, validates the fixed role posture, performs the bounded compatibility path, and verifies the resulting metadata, runtime isolation, and backup ACL.

## Required role posture

- `stockiha_owner`: `NOLOGIN`, `NOINHERIT`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`, `NOBYPASSRLS`.
- `stockiha_migrator`: `LOGIN`, `NOINHERIT`, otherwise non-privileged, with exactly one membership: `stockiha_owner` using `ADMIN FALSE`, `INHERIT FALSE`, `SET TRUE`.
- `stockiha_runtime`: `LOGIN`, no owner membership, no cluster administration privileges.
- `stockiha_backup`: `LOGIN`, no owner membership, no cluster administration privileges.

## Migration acceptance contract

Valid R8 migration evidence requires all of the following:

1. Fresh database whose validated name matches `stockiha_r8_acceptance*_test`.
2. PostgreSQL major version 18.
3. SQLx CLI 0.8.x, matching the repository SQLx dependency line.
4. `STOCKIHA_R8_ADMIN_DATABASE_URL` supplied only through the process environment.
5. `STOCKIHA_R8_MIGRATOR_DATABASE_URL` supplied only through the process environment and authenticating as `stockiha_migrator` to the exact acceptance database.
6. `public._sqlx_migrations` created by SQLx and owned by `stockiha_migrator`.
7. The compatibility bridge is bounded to versions `20260725130000` through `20260725140200`; `session_user` remains `stockiha_migrator` and only `current_user` becomes `stockiha_owner` for that phase.
8. Temporary owner DML rights on SQLx metadata are fully revoked before normal migration execution resumes.
9. Repository migrations reach schema version `20260807230000` without editing historical migration files.
10. A second `sqlx migrate run` succeeds without checksum, dirty-state, missing-migration, or pending-migration failure.
11. R6-001 backup ACL leaves `stockiha_backup` with `SELECT` only on SQLx metadata.
12. `stockiha_runtime` has no `CREATE` privilege on `public`.

## Forbidden acceptance repairs

The following invalidate the database as release evidence:

- manually executing repository migrations with `psql -f`;
- modifying an already-released migration file to make a fresh install pass;
- manually inserting, updating, deleting, or forging rows in `_sqlx_migrations`;
- `ALTER SCHEMA public OWNER ...` as a migration workaround;
- `GRANT ALL ON SCHEMA public ...` as a migration workaround;
- `GRANT ALL ON ALL TABLES IN SCHEMA public ...` as a migration workaround;
- changing `_sqlx_migrations` ownership after SQLx creates it;
- persistent `ALTER ROLE stockiha_migrator IN DATABASE ... SET role = stockiha_owner` as a workaround;
- expanding the session-only owner bridge beyond its documented legacy version interval;
- running the Tauri application as `postgres`, `stockiha_owner`, or `stockiha_migrator`;
- recovering an administrator credential from Git history;
- weakening `pg_hba.conf` or PostgreSQL authentication to make acceptance pass.

If provisioning fails, that database is rejected. Diagnose the failure in code/tooling, then create another fresh acceptance database. Do not repair the failed database into a passing state.

## Runtime acceptance contract

After provisioning, `STOCKIHA_DEV_DATABASE_URL` must point to the same acceptance database and authenticate as `stockiha_runtime`.

Required runtime proof:

- `current_user = stockiha_runtime`;
- `current_setting('is_superuser') = off`;
- `SET ROLE stockiha_owner` is denied;
- Tauri starts through `run-app.bat` / `npm run tauri dev` without a permission error;
- no credential or complete connection URL is included in acceptance evidence.

## UI evidence rule

A UI item is `PASS` only when the operator actually interacted with the running Tauri desktop application and recorded a concrete visible element or result unique to that screen. Source inspection, route existence, frontend unit tests, or code knowledge cannot be substituted for GUI evidence. If the automation cannot interact with the desktop UI, report `NOT TESTED`.

## Full R8 journey after entry passes

The integrated pilot gate then exercises, on one exact candidate and one controlled database:

setup/login -> historical onboarding -> opening-state handling -> catalog/stock -> procurement -> cash sale -> credit sale -> customer payment/refund -> cashier close/variance/suspend/handover -> restart -> backup creation/validation -> temporary restore verification -> control-total reconciliation.

Any unexplained money, stock, AR, AP, journal, import, opening-state, or restore variance blocks release.
