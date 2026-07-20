# S0-003 — Local PostgreSQL and SQLx Connectivity Proof

> Companion specification for Slice 0, Task S0-003. Defines the minimal
> infrastructure proving that the Rust backend can safely connect to a local
> PostgreSQL instance. Subordinate to `final-architecture.md`; where they
> conflict, the architecture wins.

## Scope

- SQLx 0.8.6 pinned with `default-features = false` and exactly
  `runtime-tokio` + `postgres`.
- Environment-based development configuration (`STOCKIHA_DEV_DATABASE_URL`),
  read via `std::env` only — no dotenv loader, no configuration framework.
- A Tauri-free infrastructure module (`src-tauri/src/infrastructure/db.rs`)
  owning configuration parsing, pool construction, and the health check.
- Managed state `DatabaseState { Unconfigured, InvalidConfiguration,
  Configured(PgPool) }` — no raw URLs, credentials, or SQLx errors in state;
  no mutex around `PgPool`.
- One thin fallible Tauri command, `check_db_health`, returning
  `Result<DbHealthReport, IpcError>` with the minimal typed success payload
  `{"status":"CONNECTED"}`. This is the first genuine consumer of the S0-002
  error contract, so the `error` module's dead-code exemption is removed. The
  `error` and `infrastructure` modules stay **crate-private** (`mod error;`,
  `mod infrastructure;`); the command is `pub(crate)` so its signature does
  not expose those private types through a public interface.
- Two new internal error variants and public codes, mapped exhaustively:
  - `AppError::DatabaseConfiguration { diagnostic }` → `CONFIGURATION_ERROR`
  - `AppError::DatabaseUnavailable { diagnostic }` → `DATABASE_UNAVAILABLE`
- Technical-screen display of exactly one safe status: **Not configured**,
  **Connected**, or **Unavailable** (plus a transient "Checking..." while the
  first check is in flight).
- Focused unit tests plus opt-in (`#[ignore]`) PostgreSQL integration tests.

## Out of scope

Database-role bootstrap (S0-004), Windows Credential Manager (S0-005),
SECURITY DEFINER / session tokens (S0-006), schemas, migrations, business
tables, posting functions, authentication, TLS, business UI, backup/restore.

## Connection architecture

- All SQLx access lives in Rust (`infrastructure::db`); React only invokes
  `check_db_health` and never receives credentials, hosts, ports, database
  names, server versions, URLs, or SQLx diagnostics.
- Pool: `PgPoolOptions::new().max_connections(5).acquire_timeout(5s)
  .connect_lazy_with(parsed_options)`. Lazy connection means startup never
  blocks on database availability; connection failures surface at the first
  acquire, bounded by the acquire timeout. No `tokio::time::timeout` in
  production code.
- Health check: exactly `SELECT 1` via the runtime query API (no macros, no
  offline mode). Read-only; no transaction or cleanup required.
- Nothing assumes localhost beyond the URL value, keeping the future LAN
  topology possible.

## Configuration and secrets

| Context | Source | Notes |
| --- | --- | --- |
| Development | `STOCKIHA_DEV_DATABASE_URL` | Session-scoped env var; never committed, never logged. |
| Connectivity tests | `STOCKIHA_TEST_DATABASE_URL` | Parsed database name must end in `_test` (a guard that reduces accidental targeting, not an absolute barrier). |
| Production (future) | Windows Credential Manager (S0-005) | Not implemented here; nothing in S0-003 presumes it. |

- `.env*` files remain gitignored and are **not** used by S0-003 (no loader
  exists; do not create one without approval).
- Missing configuration is a safe state: the app starts, and the health check
  reports `CONFIGURATION_ERROR` (displayed as "Not configured").
- Local development/test URLs may append `?sslmode=disable`; this is a
  per-URL developer choice and is not encoded as policy anywhere in code.

## Error-boundary behavior

- Configuration parse failures carry a **fixed, input-independent diagnostic
  constant** (`"database connection configuration could not be parsed"`) — the
  URL value and the parser's own message are both discarded, so no input is
  retained anywhere, not even in internal logs. Missing/invalid configuration
  states likewise use fixed constants. All map to `CONFIGURATION_ERROR`.
- Connection/authentication/timeout failures capture the SQLx message into
  `AppError::DatabaseUnavailable` for trusted internal handling only.
- Both variants have redacted `Debug`/`Display` and are dropped to bare public
  codes at the `From<AppError> for IpcError` boundary — raw SQLx, PostgreSQL,
  filesystem, or OS diagnostics can never reach React.
- Frontend allowlist additions: `CONFIGURATION_ERROR`,
  `DATABASE_UNAVAILABLE`; message keys `errors.configuration`,
  `errors.databaseUnavailable`.

## Test matrix

**Unit (no server, no env):** URL parsing (valid / invalid / missing),
parse diagnostic proven input-independent by equality to the fixed constant
across several malformed inputs (including secret-like content),
`DatabaseState` derivation, lazy pool construction without I/O, exhaustive
error mapping, redaction and no-leak assertions (Rust); parser allowlist,
safe messages, runtime health-payload validation, and
no-connection-detail-rendering (frontend).

**Connectivity tests (crate-internal `#[cfg(test)]` in
`infrastructure::db`, `#[ignore]`, require `STOCKIHA_TEST_DATABASE_URL`):**
- `SELECT 1` succeeds against the dedicated `*_test` database (the real
  connectivity proof — the unit tests never claim this).
- Managed-state path reports connected.
- Unreachable server (derived options, port 1) maps to
  `DATABASE_UNAVAILABLE` within the acquire-timeout bound.

The tests live inside the crate (not an external `tests/` crate) so the
`error` and `infrastructure` modules can remain private. The `_test`-suffix
guard is enforced on **parsed** `PgConnectOptions` (`get_database()`), not on
the raw URL string; it reduces the risk of accidental targeting and the tests
execute only `SELECT 1`.

## Running the proof on Windows (PostgreSQL 18)

1. Create the databases once (as a superuser, e.g. in `psql`):
   ```sql
   CREATE DATABASE stockiha_dev;
   CREATE DATABASE stockiha_test;
   ```
2. In PowerShell, set session-scoped variables (they vanish when the window
   closes; do not use `setx`, which persists them):
   ```powershell
   $env:STOCKIHA_DEV_DATABASE_URL  = "postgres://<user>:<password>@localhost:5432/stockiha_dev?sslmode=disable"
   $env:STOCKIHA_TEST_DATABASE_URL = "postgres://<user>:<password>@localhost:5432/stockiha_test?sslmode=disable"
   ```
3. Run the app: `npm run tauri dev` — the technical screen must show
   **Database Status: Connected**. Unset the variable (new shell) → **Not
   configured**. Stop the PostgreSQL Windows service → **Unavailable**.
4. Full verification:
   ```powershell
   cd src-tauri
   cargo fmt --check
   cargo check
   cargo clippy --all-targets --all-features -- -D warnings
   cargo test
   cargo test -- --ignored   # runs the crate-internal connectivity tests
   cd ..
   npm run typecheck; npm run lint; npm test; npm run build
   npm run tauri build -- --debug --no-bundle
   ```

## Definition of done

**In the sandbox (required):** frontend `typecheck`/`lint`/`test`/`build`
pass; `cargo fmt --check` passes; the isolated Rust harness (error + db
modules with sqlx/serde/tokio only) compiles and its unit tests pass; the
derived unreachable-server integration test passes against a loopback closed
port.

**On Windows (required before completion):** the full command set above
passes against live PostgreSQL 18, including all three UI states and the
ignored integration tests. Until then the verdict is
**PASS WITH MANUAL CHECKS**.

**Tracker:** `TASKS.md` S0-003 stays unchecked and `CURRENT_SLICE.md` stays on
S0-003 until every Windows check and the real PostgreSQL 18 health check pass.
