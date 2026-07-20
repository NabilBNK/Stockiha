# S0-002 — Development Configuration and Typed Error Foundation

> Companion specification for Slice 0, Task S0-002. Defines the reusable error
> boundary, the frontend error contract, and the Content Security Policy that
> later slices build on. This document is subordinate to `final-architecture.md`;
> where they conflict, the architecture wins.

## Scope

- A non-serializable internal Rust error type (`AppError`) that may hold private
  diagnostics for internal handling only.
- A separate serializable public IPC error type (`IpcError`) with a stable wire
  contract, plus an explicit `From<AppError>` conversion.
- A strongly typed, stable public `ErrorCode` enum.
- A frontend error-code contract: an allowlist of backend codes, a frontend-only
  `UNKNOWN_ERROR`, stable i18n message keys, a defensive parser for unknown Tauri
  rejection values, and a minimal safe message resolver for the current technical
  screen.
- A restrictive production CSP and the minimal development-only CSP required by
  the existing Vite/Tauri configuration.
- Focused Rust and frontend security/contract tests.

## Out of scope

- Any business functionality, domain error variants, or placeholder variants for
  future modules.
- Any new or fallible Tauri command; `get_app_info` stays infallible.
- A custom success/error response envelope (future fallible commands use the
  normal `Result<T, IpcError>` rejection channel).
- Full French / Arabic / English i18n integration (only key ownership is defined).
- Database, session, or idempotency work.
- Windows-runtime and WebView2 CSP verification (performed separately on Windows).

## Internal-versus-public error boundary

| Concern | `AppError` (internal) | `IpcError` (public) |
| --- | --- | --- |
| Location | `src-tauri/src/error.rs` | `src-tauri/src/error.rs` |
| Serialize | Never (`Serialize` not derived) | Yes (`Serialize`) |
| Crosses IPC | Never | Only type that may |
| Diagnostics | May hold private detail | None ever |
| `Debug`/`Display` | Redacted (no payloads) | Derived; exposes only the public code |

The only bridge between them is `impl From<AppError> for IpcError`, which uses an
**exhaustive** `match` (no `_` arm) so each future `AppError` variant must be
explicitly classified to a public `ErrorCode`.

## Exact wire schema

`IpcError` serializes to exactly:

```json
{ "code": "INTERNAL_ERROR" }
```

`code` is an `ErrorCode` serialized in `SCREAMING_SNAKE_CASE`. No `message`,
`details`, `source`, or `stack` field is present or permitted.

## Error-code naming and extension rules

- `ErrorCode` variants serialize in `SCREAMING_SNAKE_CASE`.
- Existing codes are a public contract: never rename or remove them.
- To add a code: (1) add the Rust `ErrorCode` variant, (2) add the matching arm
  in `From<AppError>`, (3) add the string to `BACKEND_ERROR_CODES` in
  `src/shared/types/errors.ts`, (4) add its message key and safe message.
- Never introduce speculative codes for modules that do not yet exist.

## Frontend localization ownership

- The frontend owns user-facing error text via message keys in
  `ERROR_MESSAGE_KEYS` (`errors.internal`, `errors.unknown`).
- S0-002 ships fixed English strings for the current technical screen only; the
  FR/AR/EN localization layer will later resolve the keys.
- Backend payloads never carry human-facing text.

## Unknown-error behavior

`parseTauriError(error: unknown)`:

- Reads **only** the `code` property, inside `try/catch` (a getter may throw).
- Accepts a value **only** if `code` is an allowlisted backend code string.
- Ignores `message`, `details`, `stack`, and every other property.
- Never calls `String(error)` and never echoes arbitrary content.
- Returns `UNKNOWN_ERROR` for: `Error`, string, number, boolean, `null`,
  `undefined`, arrays, malformed objects, non-string `code`, unknown code, and
  objects whose `code` getter throws.

## Diagnostic isolation

- `AppError` diagnostics are not serialized across IPC and are not exposed by its
  standard `Debug` or `Display` implementations. Trusted in-crate Rust code may
  inspect them deliberately and remains responsible for logging and redaction
  policy.
- Diagnostics are dropped at the `From<AppError>` boundary; only the public
  `ErrorCode` survives onto the wire.
- A sentinel (`DO_NOT_EXPOSE_DIAGNOSTIC`) is asserted absent from serialized
  output, from `Debug`/`Display`, and from rendered UI.
- No paths, SQL, tokens, credentials, hashes, or source-error strings are
  serialized across IPC.

### Internal module visibility (dead-code exemption)

The `error` module is registered privately in `src-tauri/src/lib.rs` as
`mod error;` — the typed error contract is not part of the public library API.
Because S0-002 defines this contract *before* the first genuinely fallible
command consumes it, the module is annotated
`#[cfg_attr(not(test), allow(dead_code))]`. **Removal condition:** delete this
exemption when the first genuine consumer (a fallible Tauri command returning
`Result<T, IpcError>`) is added. No artificial production consumer is introduced
solely to silence dead-code warnings.

## CSP requirements

Configured in `src-tauri/tauri.conf.json` under `app.security`. Tauri's automatic
asset-CSP modification remains enabled (`dangerousDisableAssetCspModification` is
not set), so asset sources are injected by Tauri as needed and are not hand-added.

**Production (`csp`):**

```
default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self';
font-src 'self'; connect-src 'self' ipc: http://ipc.localhost;
object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'
```

- Includes the Tauri IPC sources (`ipc:` and `http://ipc.localhost`).
- Excludes localhost, WebSocket, CDNs, remote/wildcard hosts, `blob:`, and
  `asset:`/protocol sources.
- No `unsafe-inline` / `unsafe-eval`.
- `object-src`, `frame-src`, `base-uri`, and `form-action` are all `'none'`.

**Development (`devCsp`):** production policy plus only the standard local dev
origin and HMR socket discovered in the repository configuration
(`vite.config.ts`: port `1420`, `strictPort`; `tauri.conf.json`
`build.devUrl: http://localhost:1420`):

```
connect-src 'self' ipc: http://ipc.localhost http://localhost:1420 ws://localhost:1420
```

- Supports the standard local development configuration only. It intentionally
  does **not** attempt to support arbitrary `TAURI_DEV_HOST` values (which use a
  remote host and HMR port `1421`); developers using that mode adjust locally.
- No `unsafe-inline` / `unsafe-eval`. If a Windows `tauri dev` run proves the dev
  bundler requires one, a narrowly scoped development-only relaxation may be added
  then — not pre-emptively.

## Required tests

**Rust (`src-tauri/src/error.rs`, using `serde_json` dev-dependency):**

- `IpcError` serializes to exactly `{"code":"INTERNAL_ERROR"}`.
- `ErrorCode::InternalError` serializes to `"INTERNAL_ERROR"` (stable code).
- `From<AppError>` conversion is explicit and maps to `InternalError`.
- Private diagnostics are omitted from serialized output.
- The sentinel `DO_NOT_EXPOSE_DIAGNOSTIC` never appears in serialized output or
  in redacted `Debug`/`Display`.
- Trusted in-crate Rust code can deliberately inspect the `AppError::Internal`
  diagnostic (per the documented contract) — verified by pattern-matching the
  variant and reading its payload.
- (Runtime tests do not attempt to prove `AppError` lacks `Serialize`.)

These Rust tests may be exercised in the sandbox as a **supplemental
contract check** by compiling the `error` module in isolation (serde +
serde_json only). That isolated run validates the error contract's behavior;
it is **not** proof that the complete Stockiha Rust crate compiles — the full
`cargo check`/`clippy`/`test` require the Tauri toolchain and are run on Windows
(see below).

**Frontend (`tests/tauriError.test.ts`, `tests/App.test.tsx`):**

- Recognized backend code, unknown code, missing code, malformed object,
  `Error`, arbitrary string, number, boolean, `null`/`undefined`, array,
  throwing `code` getter, revoked `Proxy`, and extra secret-like properties.
- The sentinel never appears in any resolved message or rendered UI.
- Existing successful `get_app_info` behavior is unchanged.

## Windows verification steps

Linux compilation cannot validate WebView2 CSP behavior. On Windows, run
`npm run tauri dev` and confirm:

1. Stockiha loads normally.
2. React-to-Rust IPC (`get_app_info`) still works.
3. Neither the production nor development CSP blocks required resources
   (scripts, styles, fonts, IPC, HMR socket).
4. No raw backend diagnostic is ever displayed.

## Definition of done

Stockiha is Windows-first, and the standard Linux sandbox lacks the GTK/WebKit
system dependencies (and, here, a C toolchain) that the Tauri crate needs. The
definition of done is therefore split by platform rather than requiring every
Rust/Tauri check to pass on Linux.

**In the sandbox (required):**

- Frontend checks pass: `npm run typecheck`, `npm run lint`, `npm test`,
  `npm run build`.
- The isolated Rust error-contract check passes (supplemental; compiles the
  `error` module with serde + serde_json only).
- `cargo fmt --check` passes and `git diff --check` is clean.

**On Windows (required before full completion):**

- Full `cargo check`, `cargo clippy --all-targets --all-features -- -D warnings`,
  and `cargo test` pass on the complete `src-tauri` crate.
- `npm run tauri build -- --debug --no-bundle` succeeds.
- Tauri / WebView2 / CSP runtime verification passes (`npm run tauri dev`): app
  loads, `get_app_info` IPC works, neither production nor development CSP blocks
  required resources, and no raw backend diagnostic is displayed.

**Tracker:** on full completion, `TASKS.md` marks S0-002 complete and `S0-003`
becomes the current task, and `CURRENT_SLICE.md` reflects S0-003 as active.
Until the Windows checks above pass, the delivery verdict is
**PASS WITH WINDOWS MANUAL CHECKS**.
