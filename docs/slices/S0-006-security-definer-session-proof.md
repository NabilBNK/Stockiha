# S0-006 — SECURITY DEFINER and Session-Token Proof

> Companion specification for Slice 0, Task S0-006. Proves that a PostgreSQL
> `SECURITY DEFINER` function can safely validate an opaque application-session
> token, run under `stockiha_owner`, and be callable only by `stockiha_runtime`.
> Subordinate to `final-architecture.md`; where they conflict, the architecture
> wins.

## Scope

- One proof-only `SECURITY DEFINER` function, `s0_006_proof.resolve_session(token text)`.
- Owned by the existing `stockiha_owner` role; fixed `search_path = pg_catalog, s0_006_proof`.
- `EXECUTE` revoked from `PUBLIC`, granted only to `stockiha_runtime`.
- Two protected tables (`app_sessions`, `actors`) the runtime role cannot read or modify.
- Opaque-token contract: the function receives a token, never an `actor_user_id`.
- The database stores only `sha256(token)` — never the raw token.
- A valid, active session resolves an actor + workstation snapshot; missing,
  expired, and revoked sessions are rejected with SQLSTATE `28000`.
- Catalog tests verify owner, `SECURITY DEFINER`, `search_path`, and ACLs.
- Crate-private `infrastructure::session_proof`; non-serializable `SessionProofError`.

## Out of scope

The full Slice-1 `iam.application_sessions` subsystem, token issuance/rotation,
idempotency, business schemas/posting, authentication or user-management UI,
Windows Credential Manager, Tauri IPC/commands, frontend, and `TASKS.md` /
`CURRENT_SLICE.md` changes (advanced only after the Windows live proof).

## Roles

Uses the current repository role names (`stockiha_owner`, `stockiha_migrator`,
`stockiha_runtime`, `stockiha_backup`) from S0-004. These match
`final-architecture.md` — no mismatch, no duplicate roles created. The four
roles must already exist (bootstrapped by S0-004) before the live proof runs.

## Database objects (`s0_006_proof`, owned by `stockiha_owner`)

| Object | Notes |
| --- | --- |
| `actors(user_id, display_name)` | Protected reference table; runtime has no privileges. |
| `app_sessions(id, token_hash, user_id, workstation_id, created_at, expires_at, revoked_at)` | `token_hash bytea` = `sha256(token)`; no raw token column. Runtime has no privileges. |
| `resolve_session(token text) RETURNS TABLE(user_id, workstation_id, display_name)` | `SECURITY DEFINER`, fixed `search_path`, owner `stockiha_owner`; `EXECUTE` for `stockiha_runtime` only. |

Runtime is granted only schema `USAGE` + function `EXECUTE`; the function (running
as owner) is the sole path to the protected data.

## Security boundaries

- Runtime **can** `EXECUTE resolve_session`; runtime **cannot** `SELECT`/write
  `app_sessions`/`actors`, cannot `ALTER`/`DROP` the function, cannot change its
  `search_path`, and cannot `SET ROLE stockiha_owner`.
- Only the token hash is stored; the raw token is bound solely to compute
  `sha256()` and never persisted or logged.
- `SessionProofError` is non-serializable with redacted `Debug`/`Display`.

## Tests

**Unit (`cargo test`, no server):** SQL-literal stability (`SECURITY DEFINER`,
fixed `search_path`, `REVOKE … FROM PUBLIC`, `GRANT EXECUTE … stockiha_runtime`,
no `%` placeholders, hash-only storage); confirmation-env parsing; redacted
error rendering.

**Live proof (`#[ignore]`, env-gated, dedicated DB):** catalog posture from
`pg_proc` (`prosecdef`, owner, fixed `search_path`, runtime EXECUTE, no PUBLIC
EXECUTE); behavioral under `SET SESSION AUTHORIZATION stockiha_runtime`: valid
token resolves the snapshot; missing/expired/revoked → `28000`; direct table
`SELECT` → `42501`; `ALTER FUNCTION` → denied.

## Windows verification

```powershell
cd src-tauri
cargo fmt --check
cargo check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
$env:STOCKIHA_ALLOW_SESSION_DEFINER_PROOF = "YES"
$env:STOCKIHA_SESSION_PROOF_ADMIN_DATABASE_URL =
  "postgres://<superuser>:<pw>@localhost:5432/stockiha_session_definer_test"
cargo test -- --ignored   # requires PostgreSQL 18 and the S0-004 roles
```

No frontend checks — no frontend files change.

## Tracker

`TASKS.md` and `CURRENT_SLICE.md` are advanced only after the Windows live proof
passes against PostgreSQL 18. Until then the verdict is **PASS WITH MANUAL CHECKS**.
