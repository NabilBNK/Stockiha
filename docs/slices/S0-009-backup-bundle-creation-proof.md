# S0-009 — Backup Bundle Creation Proof

> Companion specification for Slice 0, Task S0-009. Proves the Rust backend
> can assemble one durable, atomically-written Stockiha backup bundle using
> the existing `stockiha_backup` role and its S0-005-stored password.
> Subordinate to `final-architecture.md`; where they conflict, the
> architecture wins.

## Scope

- One crate-private module, `infrastructure::backup_proof`, with its own
  non-serializable, redacted error type (`BackupProofError`). It does **not**
  touch the public IPC `ErrorCode` contract (mirrors S0-006/S0-007/S0-008).
- A single fixed bundle layout, `GestStock-Backup-YYYYMMDD-HHMMSS/`:
  `database.dump`, `attachments/`, `generated-documents/`, `company-assets/`,
  `manifest.json`, `checksums.sha256`, `schema-version.txt`,
  `application-version.txt`, `postgres-version.txt`. The three asset
  directories always exist (may be empty).
- `pg_dump` (custom format, `--no-owner --no-privileges --no-password`)
  invoked as a child process, connecting as the fixed `stockiha_backup` role.
  The password comes from the existing S0-005 Windows Credential Manager
  store (`CredentialTarget::Backup`) and is placed **only** in the child's
  environment.
- An atomic writer: a hidden temporary directory under the same bundle root,
  assembled fully, then renamed into place in one filesystem operation. An
  existing final bundle is never overwritten; a failure removes only that
  call's own temporary directory.
- A manifest (hand-written JSON — write-only, no parser needed) and a
  `sha256sum`-compatible checksums file covering every payload/version file
  plus the manifest itself, but never itself.

## Out of scope

Restore (S0-010), scheduling, retention policy, cloud upload, encryption
(architecture explicitly places "Encrypted backup bundles" in Slice 9, not
Slice 0), frontend, Tauri IPC, and any tracker update. `TASKS.md` /
`CURRENT_SLICE.md` advance only after the Windows/PostgreSQL live proof
passes.

## Bundle layout

```
GestStock-Backup-20260722-093015/
├── database.dump
├── attachments/            (may be empty)
├── generated-documents/    (may be empty)
├── company-assets/         (may be empty)
├── manifest.json
├── checksums.sha256
├── schema-version.txt
├── application-version.txt
└── postgres-version.txt
```

## PostgreSQL dump mechanism

`pg_dump`, not SQLx or a hand-rolled exporter — SQLx is a query/pool library,
not a dump tool, and re-implementing `pg_dump` would duplicate substantial,
already-trusted OS-provided tooling (the same posture S0-008 took toward the
Windows print spooler). Flags: `--format=custom --no-owner --no-privileges
--no-password`. `--no-owner`/`--no-privileges` keep the dump portable
(matches the architecture's role-separation model — a restore should not need
to recreate exact ownership/grants). `--no-password` forbids any interactive
password fallback; authentication happens exclusively through `PGPASSWORD` in
the child's environment.

**Discovery:** `STOCKIHA_PG_DUMP_PATH` if set and non-empty, otherwise the
bare name `pg_dump` — `std::process::Command`'s own PATH/`PATHEXT` resolution
finds `pg_dump.exe` on Windows without any hand-rolled directory scan.

**Version validation:** `pg_dump --version` is parsed (pure string parsing,
unit-tested with static samples) and its major version must equal `18`;
otherwise the bundle is never started. The same trimmed version string is
recorded in `postgres-version.txt` — it reflects the dump *tool's* reported
version, not a separate `SELECT version()` server query, which keeps this
proof from requiring an extra async database round trip for a value that
already correlates with server-version compatibility.

## Credential handling

Reuses the existing S0-005 `CredentialTarget::Backup`
(`"Stockiha/PostgreSQL/backup/password"`). `infrastructure::credentials`
gains one new re-export, `pub(crate) use windows::read_secret;` — the exact
consumer its own doc comment anticipated. The password is read once into a
`SecretBytes` wrapper, validated as UTF-8 (rejected otherwise —
`CredentialNotUtf8` — rather than attempting a lossy or byte-level
environment-variable encoding), and passed to `Command::env("PGPASSWORD",
password)`, which affects only the spawned child's environment, never this
process's own. The password is never placed in argv, never in a connection
URL, and never appears in any `Display`/`Debug` output or log. The role name
(`stockiha_backup`) is a fixed literal, never a caller-supplied parameter —
a backup can never run as a different, more privileged role by accident.
Reading the credential (`resolve_backup_credential`) is the **only**
Windows-specific function in the module; the `pg_dump` invocation itself
(`run_pg_dump`) is platform-neutral `std::process::Command` code and is
unit-tested against a fake executable script in this sandbox.

## Atomicity and integrity

- **Temporary uniqueness without UUID:** `.tmp-<final-name>-<pid>-<nanos>-<counter>`,
  combining the process id, a nanosecond timestamp, and a per-process atomic
  counter. No UUID, archive, walkdir, or tempfile dependency.
- **Never overwrite:** the final bundle path is checked for existence before
  any work starts, and re-checked immediately before the rename; either
  check failing returns `DestinationAlreadyExists` without touching the
  existing bundle.
- **Sync before rename:** every file (dump, copied assets, version files,
  manifest, checksums) is `sync_all()`-ed immediately after being written,
  before the final rename is attempted.
- **Failure cleanup:** a `TempDirCleanup` guard removes exactly the one
  temporary directory this call created, on any early return — success or
  failure. It is a no-op if the rename already moved that path away, so it
  is unconditional and needs no "disarm" step. No other path is ever
  touched, so every existing bundle is unaffected by a failure.
- **Kill-and-wait on interrupted/error cleanup:** the spawned `pg_dump` child
  is wrapped in a `ChildGuard` whose `Drop` always attempts `kill()` then
  `wait()`, regardless of whether the primary path already waited
  successfully (killing/waiting on an already-exited child is a harmless
  no-op). Verified directly in this sandbox by wrapping a real long-running
  child and confirming it is not left running after the guard drops.
- **Integrity order (exact, matches the implementation):**
  1. Create the dump and copy asset inputs.
  2. Write `schema-version.txt` / `application-version.txt` /
     `postgres-version.txt`.
  3. Hash every payload/version file written so far (streaming SHA-256, flat
     memory use regardless of file size).
  4. Write `manifest.json` with sorted, forward-slash-normalized relative
     paths, sizes, and SHA-256 digests.
  5. Hash `manifest.json` itself.
  6. Write `checksums.sha256` last — every payload/version file plus
     `manifest.json`, never itself.
  7. Atomically rename the temporary directory to the final bundle name.

A bundle's mere presence at its final path is therefore proof of
completeness: nothing renames into place except after every prior step
succeeded, and nothing else ever creates a directory at that exact final
path.

## Versions

- **Application version:** `CARGO_PKG_VERSION` (currently `0.1.0`).
- **Schema version:** fixed literal `"0"` — Slice 0 has no migrations yet;
  this must track the real schema/migration version once one exists.
- **PostgreSQL/pg_dump version:** the trimmed `pg_dump --version` string,
  recorded without ever touching credentials (`--version` performs no
  authentication).

## Dependencies

- **`sha2 = "=0.10.9"`** (new direct dependency, one exact pinned version) —
  computes every SHA-256 digest. Already transitively locked at this exact
  version by the existing dependency graph; promoting it to a direct
  dependency of `stockiha-backend` adds **zero** new packages and changes
  **zero** other package's version or checksum in `Cargo.lock` (verified:
  638 packages before and after; the only lock diff is
  `stockiha-backend`'s own `dependencies` list gaining `sha2` and `time`).
- **`time = { version = "=0.3.53", default-features = false, features =
  ["std"] }`** (new direct dependency) — renders the UTC bundle directory
  name via plain field accessors (`.year()`, `.month()`, …), not the
  `format_description!` macro, so only the `std` feature is needed (no
  `formatting`/`macros`). Also already transitively locked at this exact
  version; same zero-churn guarantee as `sha2`.
- **No UUID, archive, `walkdir`, or `tempfile` dependency** — temp-directory
  uniqueness uses process id + nanosecond timestamp + an atomic counter (see
  above); the bundle is a plain directory tree, not an archive; asset
  directories are enumerated with `std::fs::read_dir`, not a recursive
  walker (only one level deep, by design).
- `serde_json` was **not** promoted from `[dev-dependencies]` to
  `[dependencies]`: the manifest schema is small and fixed, and this proof
  only ever *writes* it (restore, which would need to parse it back, is
  S0-010), so a small hand-written, unit-tested JSON serializer avoids that
  scope change entirely.

## Files

| File | Purpose |
| --- | --- |
| `src-tauri/Cargo.toml` | Add `sha2` and `time` (both already-locked versions). |
| `src-tauri/Cargo.lock` | Regenerated offline; `stockiha-backend`'s own dependency list gains `sha2`/`time` — no other package changes. |
| `src-tauri/src/infrastructure/mod.rs` | Register `mod backup_proof;` (crate-private, dead-code-exempt like the other proofs). |
| `src-tauri/src/infrastructure/credentials/mod.rs` | Add `pub(crate) use windows::read_secret;` and make the `windows` submodule `pub(crate)` so `backup_proof` can reach it — the exact consumer its own doc comment anticipated. |
| `src-tauri/src/infrastructure/backup_proof/mod.rs` | Model, validation, `pg_dump` invocation, atomic writer, manifest/checksums, redacted error, all tests. |

## Tests

**Unit (`cargo test`, every platform, no PostgreSQL, no real `pg_dump`):**
`pg_dump --version` parsing (static samples); exact bundle layout with empty
asset directories; version-file contents; deterministic sorted manifest
entries (forward-slash-only paths, verified against a fresh second run);
checksums.sha256 covers the manifest and every payload file but never
itself (independently re-hashes `manifest.json` and compares); fixture
attachment/generated-document/company-asset copying through the real
production code path; duplicate-filename rejection within one asset
category; symlink-input rejection (`std::os::unix::fs::symlink` on this
platform); an existing final bundle is never overwritten (verified
byte-for-byte unchanged after a rejected second attempt); an injected
dump-producer failure leaves no final bundle and no leftover temp directory;
the `ChildGuard` kill-and-wait mechanism, proven directly against a real
long-running child process; redacted `Display`/`Debug` for every error
variant; the credential-missing mapping path (`CredentialError::NotFound` →
a safe, redacted `BackupProofError`) exercised without touching Windows
Credential Manager at all. Two additional tests spawn a small fake
`pg_dump`-compatible shell script (test-scoped, not committed) to prove the
real argv construction and the child-only `PGPASSWORD` wiring end-to-end
without any real PostgreSQL.

**Windows/PostgreSQL live proof (`#[cfg(windows)] #[ignore]`):** gated by
`STOCKIHA_ALLOW_BACKUP_PROOF=YES` and `STOCKIHA_BACKUP_PROOF_DATABASE=<name>`
(must end in `_test`, same convention as S0-003/S0-004). Discovers and
version-validates the real `pg_dump`, reads the real `stockiha_backup`
credential, runs the full pipeline against a real PostgreSQL 18 database,
and asserts the resulting dump file is non-empty.

## Verification

```powershell
cd src-tauri
cargo fmt --check
cargo check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
$env:STOCKIHA_ALLOW_BACKUP_PROOF = "YES"
$env:STOCKIHA_BACKUP_PROOF_DATABASE = "stockiha_backup_proof_test"
cargo test -- --ignored   # requires PostgreSQL 18, pg_dump, and the stored stockiha_backup credential
```

No frontend checks — no frontend files change.

### What was verified without Windows

All unit tests above (30 in total) were run directly in this Linux sandbox —
this module's design keeps the dump-producing step injectable specifically
so the atomicity/integrity/manifest logic never needs a real `pg_dump` to be
exercised. The `cfg(windows)` credential-resolution function and reparse-point
check were cross-checked against the real `windows-sys 0.61.2` source and
type-checked cleanly with `cargo check --target x86_64-pc-windows-gnu`;
`cargo clippy --target x86_64-pc-windows-gnu --all-targets --all-features --
-D warnings` also passed cleanly. Full linking (a real `mingw-w64`
toolchain) and the live PostgreSQL proof remain genuine Windows-only manual
checks, as in S0-007/S0-008.

## Windows / manual verification

Unverified here: real Windows Credential Manager read of the stored
`stockiha_backup` password, real `pg_dump` linkage/execution against a live
PostgreSQL 18 instance, and Windows reparse-point rejection specifically
(the symlink-rejection test runs on Unix in this sandbox; the Windows
`FILE_ATTRIBUTE_REPARSE_POINT` check is exercised only by type-checking, not
by a live junction/symlink on Windows). Run the verification block above on
Windows, including the live proof against a real `_test`-suffixed database,
and confirm the resulting bundle directory matches the exact layout above.

## Tracker

`TASKS.md` and `CURRENT_SLICE.md` are advanced only after the Windows live
proof passes against a real PostgreSQL 18 instance. Until then the verdict
is **PASS WITH MANUAL CHECKS**.
