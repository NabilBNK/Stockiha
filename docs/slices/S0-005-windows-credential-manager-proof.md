# S0-005 — Windows Credential Manager Proof

> Companion specification for Slice 0, Task S0-005. Proves that crate-private
> Rust infrastructure can write, read, overwrite, and delete password blobs in
> the current Windows user's Credential Manager. Subordinate to
> `final-architecture.md`; where they conflict, the architecture wins.

## Scope

- Crate-private credential storage over the Win32 generic-credential API
  (`CredWriteW` / `CredReadW` / `CredDeleteW` / `CredFree`), using
  `windows-sys 0.61.2` (features `Win32_Foundation`,
  `Win32_Security_Credentials`) and `zeroize 1.9.0`.
- `CRED_TYPE_GENERIC` credentials with `CRED_PERSIST_LOCAL_MACHINE` persistence.
- Three internal operations: `write_secret`, `read_secret`, `delete_secret`.
- A closed set of credential targets (enum, not free-form strings).
- Focused platform-independent unit tests, plus one `#[ignore]` Windows live
  round-trip test.

## Out of scope

No Tauri command, no IPC, no frontend, no serialization. No wiring of these
credentials into the database connection yet (that is a later task). No owner /
superuser / migrator provisioning logic (S0-004 owns role creation).

## What is stored

**Only password bytes.** Never a complete PostgreSQL URL, owner or superuser
credentials, hostname, port, or any database configuration.

Fixed production targets:

| Target enum | Credential Manager name |
| --- | --- |
| `RuntimePassword`  | `Stockiha/PostgreSQL/runtime/password` |
| `MigratorPassword` | `Stockiha/PostgreSQL/migrator/password` |
| `BackupPassword`   | `Stockiha/PostgreSQL/backup/password` |

Fixed test target (test builds only): `Stockiha/S0-005/TestCredential`.

Targets are an enum (`CredentialTarget`), so arbitrary target names are
unrepresentable — callers cannot pass a free-form string.

## Module layout

- `src-tauri/src/infrastructure/credentials/mod.rs` — platform-independent
  contract: `CredentialTarget`, blob validation, and the redacted
  `CredentialError`. Compiled and unit-tested on every platform.
- `src-tauri/src/infrastructure/credentials/windows.rs` — Win32 FFI and the
  live round-trip test. Compiled only on Windows (`#[cfg(windows)]`).

The module is registered crate-private (`mod credentials;`) and, having no
consumer yet, is `#[cfg_attr(not(test), allow(dead_code))]` until a later slice
wires it in.

## Security requirements (and how they are met)

- **Crate-private only; no Tauri command; no frontend; no serialization.**
  `CredentialError`/`CredentialTarget` derive no `Serialize`.
- **Zeroizing buffers.** `read_secret` returns a `SecretBytes` wrapper around
  `Zeroizing<Vec<u8>>`; its `Debug` is the fixed string `SecretBytes(<redacted>)`
  and bytes are reachable only via `AsRef<[u8]>`. The live test holds its
  secrets in `SecretBytes`. On read, the Win32-owned blob memory is zeroized
  before `CredFree`. A non-zero blob size with a null pointer returns
  `InvalidStoredCredential` (after freeing the record).
- **Reject empty and oversized blobs.** `validate_secret` runs before any Win32
  call; the maximum is `CRED_MAX_CREDENTIAL_BLOB_SIZE` (5 × 512 = 2560 bytes).
- **Redacted `Debug`/`Display`.** `CredentialError` renders only fixed category
  text; it carries no secret bytes and no target string, and never prints a
  Win32 status value.
- **`ERROR_NOT_FOUND` mapped safely.** Both read and delete translate it to
  `CredentialError::NotFound`.
- **`CredReadW` buffers always freed.** `read_secret` calls `CredFree` on the
  allocated record before returning, including the zero-length path.
- **Never log secrets or target values.** Nothing in this module logs; error
  values are inherently free of secret/target content.

## Tests

**Platform-independent unit tests (`credentials/mod.rs`, run everywhere):**
target names equal the fixed strings; `validate_secret` rejects empty and
oversized and accepts one byte and exactly the maximum; `Debug`/`Display` are
fixed redacted text.

**Windows live round-trip (`credentials/windows.rs`, `#[cfg(windows)]`,
`#[ignore]`):** asserts `STOCKIHA_ALLOW_WINDOWS_CREDENTIAL_TEST=YES` and
**fails** (does not silently skip) if the opt-in is absent. Steps:
(1) clean the test target, (2) write secret A, (3) read A, (4) overwrite with
secret B, (5) read B, (6) delete, (7) confirm `NotFound`. A `Drop` guard
deletes the test credential even if an assertion panics (step 8).

## Sandbox vs. Windows verification

The Linux sandbox cannot exercise the real Credential Manager. Verified in the
sandbox: `cargo fmt --check`, the platform-independent unit tests, Clippy
(`-D warnings`), and a **cross-compile type-check** of the Windows FFI via
`cargo check`/`cargo clippy --target x86_64-pc-windows-gnu` (compiles
`windows.rs` against `windows-sys` without linking).

**On Windows (required before completion):**

```powershell
cd src-tauri
cargo fmt --check
cargo check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
$env:STOCKIHA_ALLOW_WINDOWS_CREDENTIAL_TEST = "YES"
cargo test -- --ignored   # runs the live credential round-trip
```

No frontend checks: no frontend files change in this task.

## Tracker

`TASKS.md` and `CURRENT_SLICE.md` are **not** advanced until the Windows live
round-trip passes. Until then the delivery verdict is
**PASS WITH MANUAL CHECKS**.
