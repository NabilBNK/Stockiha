# S0-010 — Temporary-Database Restore and Reconciliation Proof

> Companion specification for Slice 0, Task S0-010. Proves the Rust backend
> can validate an S0-009 backup bundle, restore its `database.dump` into a
> uniquely named, throwaway PostgreSQL 18 database via `pg_restore`, run
> deterministic reconciliation, and always drop both temporary databases.
> Subordinate to `final-architecture.md`; where they conflict, the
> architecture wins.

## Scope

- One crate-private module, `infrastructure::restore_proof`, with its own
  non-serializable, redacted error type (`RestoreProofError`). Mirrors
  S0-006/S0-007/S0-008/S0-009.
- One new, minimal `pub(crate)` addition to `backup_proof/mod.rs`:
  `validate_bundle` + `ValidatedBundle` — the single authoritative bundle
  preflight validator. `restore_proof` calls it via a thin `preflight_bundle`
  wrapper and never re-parses `manifest.json`/`checksums.sha256` itself.
- One distinct admin connection (never a Stockiha app role) that creates and
  drops both temporary databases, runs the reconciliation queries, and
  authenticates `pg_restore`.
- `pg_restore` (custom-format input, `--exit-on-error --single-transaction
  --no-owner --no-privileges`) invoked as a child process.
- Deterministic fixture-table reconciliation: row count plus a SHA-256 of
  canonically ordered, canonically formatted rows, compared source vs.
  restored.
- Explicit async cleanup (never `Drop`) that always drops both temporary
  databases, on every path, and preserves the original failure.

## Out of scope

Production restore, UI, IPC, existing-database overwrite, scheduler,
retention, encryption, disaster-recovery automation, and any tracker update.
`TASKS.md` / `CURRENT_SLICE.md` advance only after the Windows/PostgreSQL
live proof passes.

## Role and credential strategy (checked, not assumed)

S0-004's role posture matrix gives **all four** fixed Stockiha roles
`NOCREATEDB`; `stockiha_backup` additionally has no memberships and only
per-object `SELECT`. None can create/drop a database or run a DDL-heavy
restore. Every destructive operation — creating and dropping both temporary
databases, running `pg_restore`, and the reconciliation queries — uses one
distinct **admin** connection, read from
`STOCKIHA_RESTORE_PROOF_ADMIN_DATABASE_URL` and gated by
`STOCKIHA_ALLOW_RESTORE_PROOF=YES`, mirroring S0-004's
`STOCKIHA_BOOTSTRAP_ADMIN_DATABASE_URL` precedent rather than inventing a new
pattern. The raw URL is parsed exactly once (`parse_admin_url`) and never
retained, logged, reported, or rendered by any `Display`/`Debug`.

**Real finding, not assumed:** `sqlx::postgres::PgConnectOptions` derives
`Debug` **without** redacting its password field (confirmed against the real
`sqlx-postgres 0.8.6` source). Neither `ParsedAdminUrl` nor
`RestoreProofError` derive or implement `Debug` in a way that could expose
it, and this module never calls `{:?}`/`{}` on a `PgConnectOptions` value
anywhere. There is also no public password getter on `PgConnectOptions`, so
the admin password is captured once from `parse_admin_url` and threaded
through directly to both the SQLx options builder and `pg_restore`'s
`PGPASSWORD`.

## Bundle preflight

`backup_proof::validate_bundle` (new, `pub(crate)`) is the single
authoritative validator. Checks, in order: `bundle_dir` itself is a real
directory, not a symlink/reparse point; `manifest.json` and
`checksums.sha256` exist as regular files and parse (`manifest.json` via
`serde_json`, never hand-parsed); every manifest-listed relative path is
free of traversal (`.`/`..`/absolute rejected, plus a canonicalize +
containment check), resolves inside `bundle_dir`, is not a
symlink/reparse point (the exact check `validate_input_file` already uses,
refactored into a shared `reject_symlink_or_reparse_point` helper — not
duplicated), and its recomputed size/SHA-256 matches both `manifest.json`
and `checksums.sha256`; `checksums.sha256` covers `manifest.json` itself but
never itself; the four required files are present, the three fixed asset
directories exist and are not symlinks, `database.dump` is non-empty, and
the recorded PostgreSQL major version equals 18.

`restore_proof::preflight_bundle` is a two-line wrapper that calls
`validate_bundle` and maps its error — it adds no validation logic of its
own, satisfying "expose the smallest `pub(crate)` API" literally.

**A real bug this design caught:** the first implementation of
`validate_bundle` collapsed every `validate_input_file` failure for a
manifest-listed file — including `RejectedSymlinkInput` — into the generic
`BundleLayoutInvalid`. `validate_bundle_rejects_a_symlink_replacing_a_listed_file`
failed against that version (expected `RejectedSymlinkInput`, got
`BundleLayoutInvalid`), which is exactly why that test exists. Fixed by
propagating `validate_input_file`'s own error directly instead of remapping
it.

## pg_restore lifecycle

Discovery: `STOCKIHA_PG_RESTORE_PATH` then PATH. Version-gated to major 18,
via `backup_proof::parse_pg_dump_major_version` reused directly — `pg_restore
--version` reports the identical `"<tool> (PostgreSQL) X.Y"` shape
`pg_dump --version` does, so the parser is generic and reusing it avoids a
second, textually-identical implementation. Flags: `--exit-on-error
--single-transaction --no-owner --no-privileges --host --port --username
--dbname`, plus the archive path as a **positional** trailing argument
(`pg_restore`'s own CLI convention — unlike `pg_dump`'s `--file` output
flag). Host/port/username are ordinary non-secret arguments; the password is
placed **only** in the child's `PGPASSWORD` environment variable, never
argv, never a connection URL. A local `ChildGuard` (the same
kill-and-wait-on-drop pattern S0-009 uses for `pg_dump`, reimplemented here
rather than exposed from `backup_proof` — a generic process-cleanup helper
is not bundle-validation domain logic) guarantees the child is reaped even
on an early return.

## Temporary-database safety

- **Naming:** `stockiha_restore_proof_<role>_<pid>_<nanos>_<counter>` — the
  same no-UUID uniqueness technique S0-009 uses for temporary directories.
  `<role>` is always a fixed lowercase-ASCII literal (`"source"`/`"restore"`)
  chosen by the caller, never external input.
- **Destructive-prefix guard:** `validate_generated_database_name` checks
  the `stockiha_restore_proof_` prefix and that every character is lowercase
  ASCII letter/digit/underscore. Called immediately before **every**
  `CREATE`/`DROP DATABASE` — never trusted from an earlier check alone.
- **Identifier quoting:** `quote_identifier` wraps in double quotes and
  doubles any embedded double quote, applied even though
  `validate_generated_database_name` already makes an embedded quote
  impossible for names this module accepts — defense in depth, verified in
  isolation with a hypothetical embedded-quote input.
- **Outside transactions:** `CREATE DATABASE` and `DROP DATABASE` each run as
  a single bare `.execute()` call — sqlx never wraps a single statement in
  an implicit transaction, and `CREATE`/`DROP DATABASE` cannot run inside
  one regardless.
- **`WITH (FORCE)`:** `DROP DATABASE IF EXISTS <name> WITH (FORCE)` (PG 13+)
  terminates other connections to the database as part of the drop itself,
  so a separate manual `pg_terminate_backend` pass is unnecessary in the
  common case — this is the "terminate connections only when necessary"
  default.
- **Maintenance database:** checked twice — at URL-parse time (the
  declared database must literally be `postgres`) and again live
  (`SELECT current_database()`), since the URL's declared database is a
  request, not a guarantee of what the server actually connects you to.

## Cleanup (explicit async, never Drop)

`run_restore_and_reconcile` sequences: create the restore-target database →
restore → reconcile → **always** drop both databases, on every path.
Cleanup outcomes are discarded on any earlier failure (the original
`restore`/`reconcile` error is what's returned); on the pure success path, a
cleanup failure **is** the reportable error, since there is no earlier
failure for it to protect — the same rule S0-008/S0-009 apply to their own
success-path final steps. `TempDbObligation` is a **passive** record only:
`Drop` cannot run async code, so its `Drop` impl does nothing but emit a
debug-only diagnostic if a value is dropped unmarked — it never claims to
guarantee cleanup, and callers must call `mark_cleaned()` only after the
real, explicit async drop has actually run.

## Reconciliation

No business ledger exists yet (Slice 0), so reconciliation is a fixed
fixture: `stockiha_restore_proof_fixture (id, label, amount)`, three literal
rows, no dynamic string construction. `compute_fixture_digest` reads
`ORDER BY id`, canonically formats each row as `id:label:amount`, joins with
`\n`, and SHA-256-hashes the result. `compare_fixture_digests` is a pure
function (row count and hash must both match) — fully unit-testable without
any database.

## Dependencies

`serde_json` promoted from `[dev-dependencies]` to `[dependencies]`
(unpinned exactly as before, `"1"`) — it is now needed at runtime, not just
in tests, to parse `manifest.json` inside `validate_bundle`, which must use
a real JSON parser rather than hand-parsing. **`Cargo.lock` requires zero
changes**: `serde_json` was already present in `stockiha-backend`'s resolved
dependency list (Cargo.lock includes dev-dependencies in the graph too), so
promoting it changes nothing — verified with `cargo metadata --offline`
before and after: 638 packages, byte-identical lock file. No new crate is
added; `sqlx` (already a dependency since S0-003) is the only crate this
proof adds real usage of beyond what already existed.

## Files

| File | Purpose |
| --- | --- |
| `src-tauri/Cargo.toml` | Promote `serde_json` to `[dependencies]`. |
| `src-tauri/src/infrastructure/mod.rs` | Register `mod restore_proof;`. |
| `src-tauri/src/infrastructure/backup_proof/mod.rs` | Add `validate_bundle` + `ValidatedBundle` + nine new redacted error variants; refactor the existing symlink check into a shared helper; add matching tests. |
| `src-tauri/src/infrastructure/restore_proof/mod.rs` | URL parsing, naming/quoting, async DB operations, `pg_restore` invocation, reconciliation, cleanup orchestration, all tests. |

## Tests

**Unit (`cargo test`, every platform, no PostgreSQL, no real `pg_restore`):**
generated-name validation and the destructive-prefix guard; identifier
quoting (including a hypothetical embedded-quote input); admin URL parsing
(well-formed, default port, percent-decoded password, malformed rejection);
maintenance-database enforcement at parse time; password/URL redaction
(including a sentinel password proven never to reach any error text, and
compile-time proof via the *absence* of `Debug` on `ParsedAdminUrl`); shared
S0-009 bundle validation via `preflight_bundle` (accept + a tampered-bundle
rejection, reusing `backup_proof::create_backup_bundle` to build the
fixture); `pg_restore --version` parsing (reused parser); fake-`pg_restore`
argv/environment (argv never contains the password; `PGPASSWORD` set only
for the child); pure fixture-digest comparison; the full cleanup-semantics
matrix via fake async closures — explicit cleanup on success (and a sole
cleanup failure surfacing), after a restore failure, after a reconciliation
failure, and the original error preserved when cleanup also fails;
`TempDbObligation` as a passive, non-cleaning record.

**Windows/PostgreSQL live proof (`#[cfg(windows)] #[ignore]`):** gated by
`STOCKIHA_ALLOW_RESTORE_PROOF=YES` and
`STOCKIHA_RESTORE_PROOF_ADMIN_DATABASE_URL`. Runs the full ten-step sequence
from the task: create source db → seed fixture → generate a real S0-009
bundle through **unmodified** production backup code (granting
`stockiha_backup` read access on the throwaway source db first, so the real
role/credential model is exercised exactly as it would be against a real
database) → preflight → create restore db → restore → verify major version
18 → reconcile via the same `run_restore_and_reconcile` orchestrator the
fake-closure tests exercise → drop both databases → remove the generated
bundle. Never touches a real Stockiha application database — both databases
are freshly created and `stockiha_restore_proof_`-prefixed.

## Verification

```powershell
cd src-tauri
cargo fmt --check
cargo check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
$env:STOCKIHA_ALLOW_RESTORE_PROOF = "YES"
$env:STOCKIHA_RESTORE_PROOF_ADMIN_DATABASE_URL = "postgres://<admin>:<password>@localhost:5432/postgres"
cargo test -- --ignored   # requires PostgreSQL 18, pg_dump, pg_restore, and the stockiha_backup credential
```

No frontend checks — no frontend files change.

### What was verified without Windows

All 66 unit tests run directly in this Linux sandbox — the design keeps
`pg_restore` invocation, database creation/drop, and the cleanup
orchestrator either fully injectable (fake async closures) or exercised via
a fake shell-script executable, so almost the entire module is exercised
without any real PostgreSQL server. The `cfg(windows)` credential-resolution
call site and the live proof itself were cross-checked against the real
`windows-sys`/`sqlx-postgres 0.8.6` source and type-checked cleanly with
`cargo check --target x86_64-pc-windows-gnu`; `cargo clippy --target
x86_64-pc-windows-gnu --all-targets --all-features -- -D warnings` also
passed cleanly (this compiles, but does not link, run, or connect to a real
database). This process caught one real cross-platform bug on its own: a
Unix-only test helper (`chmod`-based) called from a test that wasn't itself
`#[cfg(unix)]`-gated, which only surfaced when cross-checking the Windows
target. Full linking and the live PostgreSQL proof remain genuine
Windows-only manual checks, as in S0-007/S0-008/S0-009.

## Windows / manual verification

Unverified here: real admin-connection authentication against a live
PostgreSQL 18 instance, real `pg_restore` linkage/execution, real Windows
Credential Manager read of the stored `stockiha_backup` password, and
Windows reparse-point rejection specifically inside a restored/validated
bundle (exercised only by type-checking on this platform, not by a live
junction). Run the verification block above on Windows, including the live
proof, and confirm both temporary databases are gone afterward
(`SELECT datname FROM pg_database WHERE datname LIKE 'stockiha_restore_proof_%'`
must return no rows).

## Tracker

`TASKS.md` and `CURRENT_SLICE.md` are advanced only after the Windows live
proof passes against a real PostgreSQL 18 instance. Until then the verdict
is **PASS WITH MANUAL CHECKS**.
