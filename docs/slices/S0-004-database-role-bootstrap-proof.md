# S0-004 — Database-Role Bootstrap Proof

> Companion specification for Slice 0, Task S0-004. Defines the technical
> foundation proving safe, atomic, and idempotent PostgreSQL database role
> creation and verification. Subordinate to `final-architecture.md`; where they
> conflict, the architecture wins.

## Scope

- Four fixed, cluster-wide application roles:
  - `stockiha_owner`: Schema owner role (`NOLOGIN`, `NOINHERIT`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`, `NOBYPASSRLS`).
  - `stockiha_migrator`: Migration runner role (`LOGIN`, `NOINHERIT`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`, `NOBYPASSRLS`).
  - `stockiha_runtime`: Application runtime connection role (`LOGIN`, `NOINHERIT`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`, `NOBYPASSRLS`).
  - `stockiha_backup`: Database backup role (`LOGIN`, `NOINHERIT`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`, `NOBYPASSRLS`).
- Single explicit membership grant:
  - `GRANT stockiha_owner TO stockiha_migrator WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;`
  - `stockiha_runtime` and `stockiha_backup` are strictly **not** members of `stockiha_owner`.
- Cluster-wide & environment safety guards required before execution:
  - `STOCKIHA_BOOTSTRAP_ADMIN_DATABASE_URL` environment variable.
  - `STOCKIHA_ALLOW_CLUSTER_ROLE_BOOTSTRAP` environment variable set to exactly `"YES"`.
  - Target database name must be exactly `stockiha_role_bootstrap_test` for integration tests.
  - PostgreSQL major version must be `18`.
  - Active session user must equal current user and be a superuser (`current_setting('is_superuser') = 'on'`).
- Atomic, concurrency-safe bootstrap execution:
  - Runs in a single transaction (`BEGIN` / `COMMIT`).
  - Acquires a fixed 64-bit PostgreSQL advisory transaction lock (`pg_advisory_xact_lock`).
  - Uses fixed literal DDL SQL statements — zero dynamic string construction for role names.
- Double catalog assertions against PostgreSQL system catalogs:
  - `pg_roles`: Verifies exact attribute flags (`rolsuper`, `rolcreaterole`, `rolcreatedb`, `rolbypassrls`, `rolcanlogin`, `rolinherit`, `rolreplication`).
  - `pg_auth_members`: Verifies complete outgoing membership graph (exact `migrator` -> `owner` membership options with `admin=false`, `inherit=false`, `set=true`; zero memberships for `owner`, `runtime`, and `backup`).
- Crate-private infrastructure modules (`infrastructure::bootstrap`) and internal non-serializable `BootstrapError`.
- No passwords created, altered, cleared, logged, or persisted (owned by S0-005).

## Out of Scope

Windows Credential Manager (S0-005), SECURITY DEFINER / session validation (S0-006), schemas, migrations, business tables, posting functions, authentication, frontend changes, Tauri IPC commands, updating `TASKS.md` or `CURRENT_SLICE.md`.

## Role Posture Matrix

| Role Name | LOGIN | INHERIT | SUPERUSER | CREATEDB | CREATEROLE | REPLICATION | BYPASSRLS | Memberships |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `stockiha_owner` | `false` | `false` | `false` | `false` | `false` | `false` | `false` | None |
| `stockiha_migrator` | `true` | `false` | `false` | `false` | `false` | `false` | `false` | `stockiha_owner` (`admin=f, inherit=f, set=t`) |
| `stockiha_runtime` | `true` | `false` | `false` | `false` | `false` | `false` | `false` | None |
| `stockiha_backup` | `true` | `false` | `false` | `false` | `false` | `false` | `false` | None |

## Verification Matrix

**Unit Tests (`cargo test`):**
- Role constant literal stability assertions.
- Fixed DDL string format checks.
- Environment variable guard parsing and validation logic.

**Ignored Integration Tests (`cargo test -- --ignored` on Windows with PostgreSQL 18):**
- Execute bootstrap against `stockiha_role_bootstrap_test` database.
- Idempotency proof (running bootstrap twice consecutively succeeds with identical catalog state).
- Concurrent execution proof using parallel tasks guarded by advisory locks.
- Catalog verification querying `pg_roles` and `pg_auth_members`.
- Controlled object permission probe tests using fresh dedicated connections with `SET SESSION AUTHORIZATION`:
  - `stockiha_runtime` denied `CREATE SCHEMA`.
  - `stockiha_runtime` denied `CREATE TABLE` in controlled probe schema.
  - `stockiha_migrator` allowed `SET ROLE stockiha_owner`.
  - `stockiha_runtime` and `stockiha_backup` denied `SET ROLE stockiha_owner`.
  - `stockiha_backup` allowed `SELECT` on granted probe table, but denied `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`.
