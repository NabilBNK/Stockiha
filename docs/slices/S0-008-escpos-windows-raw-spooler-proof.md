# S0-008 — ESC/POS Windows RAW Spooler Proof

> Companion specification for Slice 0, Task S0-008. Proves the Rust backend
> can send raw ESC/POS bytes through the Windows print spooler (`RAW`
> datatype) to a selected printer, with correct Win32 lifecycle ordering and
> safe error handling. Subordinate to `final-architecture.md`; where they
> conflict, the architecture wins.

## Scope

- One crate-private module, `infrastructure::escpos_proof`, with its own
  non-serializable, redacted error type (`EscposProofError`). It does **not**
  touch the public IPC `ErrorCode` contract (mirrors S0-006/S0-007).
- `SpoolerJob`: a validated printer name (Unicode, NUL-terminated UTF-16, no
  embedded NUL, ≤538 UTF-16 code units) and a validated raw byte payload
  (non-empty, ≤64 KiB — an arbitrary, generous bound for this proof only).
- A Win32 writer (`send_raw_job`, Windows-only) implementing the exact
  lifecycle: `OpenPrinterW` → `StartDocPrinterW` (datatype `RAW`) →
  `StartPagePrinter` → `WritePrinter` (looped, partial-write safe) →
  `EndPagePrinter` → `EndDocPrinter` → `ClosePrinter`.
- A platform-neutral partial-write accounting helper (`write_all_tracked`),
  unit-tested on every platform without any Win32 dependency.
- A deterministic, harmless payload builder (ESC `@` + one identifying text
  line + three line feeds — no cut, no drawer kick) and a single `#[ignore]`
  Windows live proof gated by two environment variables.

## Out of scope

Frontend, Tauri commands/IPC, database, the `documents.print_jobs` durable
queue and its retry/lease semantics, receipt formatting, Arabic thermal
rasterization, paper-cut and cash-drawer commands, and any ESC/POS command
library beyond the one harmless payload used by the live proof. `TASKS.md` /
`CURRENT_SLICE.md` advance only after the Windows live proof passes.

## Win32 mechanism

The Windows print spooler's RAW-datatype job API (`winspool.drv`): a document
is opened against a named printer, one page is written as an opaque byte
stream (`RAW` datatype bypasses GDI rendering entirely — required for direct
ESC/POS control codes), then the document is closed. This is the same
mechanism generic/text-only printer drivers and POS software use to send raw
receipt data.

## Dependency decision

No new crate. `windows-sys` (`0.61.2`, already a dependency since S0-005)
gains two feature groups:

- `Win32_Graphics_Printing` — `OpenPrinterW`, `StartDocPrinterW`,
  `StartPagePrinter`, `WritePrinter`, `EndPagePrinter`, `EndDocPrinter`,
  `AbortPrinter`, `ClosePrinter`, `DOC_INFO_1W`, `PRINTER_HANDLE`.
- `Win32_Graphics_Gdi` — **required**, not optional: verified by compiling
  against the real `windows-sys 0.61.2` source (not assumed) that
  `OpenPrinterW`'s own FFI binding is itself `#[cfg(feature =
  "Win32_Graphics_Gdi")]`-gated in this crate version, because its
  `PRINTER_DEFAULTSW` parameter type lives behind that feature. No GDI or
  `DEVMODE` value is ever constructed or used by this proof — a null
  `pDefault` is passed to `OpenPrinterW` — only the type needs to resolve for
  the function signature to compile.

Both are additions to the existing `[target.'cfg(windows)'.dependencies]`
`windows-sys` feature list; no new crate is introduced.

## Printer name validation (Unicode)

Printer names are Unicode; ASCII is not required. `validate_printer_name`
rejects an empty name, a name containing an embedded UTF-16 NUL code unit, and
a name whose UTF-16 encoding exceeds 538 code units (excluding the terminator
this function appends). On success it returns a NUL-terminated `Vec<u16>`
ready to pass to `OpenPrinterW`.

## Payload validation

`validate_payload` rejects an empty payload and a payload exceeding 64 KiB
(arbitrary safety bound for this proof; not a Win32 or ESC/POS specification
limit — real receipt sizing is a later slice's concern).

## Lifecycle and failure handling

Exact success order: `OpenPrinterW` → `StartDocPrinterW` (`RAW`) →
`StartPagePrinter` → `WritePrinter` loop → `EndPagePrinter` →
`EndDocPrinter` → `ClosePrinter`.

Failure handling:

- **Before `StartDocPrinterW` succeeds:** the only cleanup is `ClosePrinter`
  — there is no job yet to abort.
- **After `StartDocPrinterW` succeeds:** any later failure (`StartPagePrinter`,
  `WritePrinter`, `EndPagePrinter`, or `EndDocPrinter`) triggers a best-effort
  `AbortPrinter` followed by `ClosePrinter`. `EndDocPrinter` is never used as a
  cancellation mechanism — it does not cancel a job.
- Cleanup call outcomes are always discarded: a cleanup failure never replaces
  the original operation error that triggered the cleanup.
- On the pure success path, a failing final `ClosePrinter` **is** the
  reportable error — there is no earlier failure for it to protect.

Partial writes are handled by `write_all_tracked`, a platform-neutral helper
that loops `WritePrinter` until the full payload is accounted for, treats a
reported write of zero bytes as a hard `NoProgress` failure (prevents an
infinite loop), and clamps any over-reported write count to the bytes actually
offered (so a misbehaving lower layer can never corrupt the accounting).

## Secrets / data-leak policy

`EscposProofError`'s `Display`/`Debug` are redacted to a stable
`ESCPOS_PROOF_*` code, exactly like `PdfProofError`. Neither the printer name
nor the payload bytes are ever interpolated into an error message, a log
line, or any `Display`/`Debug` output. The private `diagnostic()` accessor
retains detail (validation reason, or the failing Win32 operation name plus
its `GetLastError()` code) for trusted in-crate use — tests only.

## Files

| File | Purpose |
| --- | --- |
| `src-tauri/Cargo.toml` | Add `Win32_Graphics_Printing` + `Win32_Graphics_Gdi` to the existing `windows-sys` feature list. |
| `src-tauri/src/infrastructure/mod.rs` | Register `mod escpos_proof;` (crate-private, `#[cfg_attr(not(test), allow(dead_code))]`, **not** `cfg(windows)` — the model/validation/error/payload-builder are platform-neutral). |
| `src-tauri/src/infrastructure/escpos_proof/mod.rs` | `SpoolerJob`, validation, `EscposProofError`, harmless payload builder, `write_all_tracked`, the `cfg(windows)` Win32 writer, and all tests. |

## Tests

**Unit (`cargo test`, every platform, no printer):** empty / embedded-NUL /
over-length Unicode printer names rejected; a non-ASCII (Arabic) printer name
accepted and round-trips through UTF-16; empty / over-size payloads rejected;
boundary sizes accepted; the harmless payload is deterministic across calls
and contains no cut (`GS V` / `ESC i` / `ESC m`) or drawer-kick (`ESC p`)
sequence; `EscposProofError` `Display`/`Debug` redact every variant to a
stable code while `diagnostic()` retains the detail; `SpoolerJob::new`
validates both fields and stores them; `write_all_tracked` correctly accounts
simulated partial writes, detects zero-progress, clamps an over-reported
write, and propagates a writer error unchanged.

**Windows live proof (`#[cfg(windows)] #[ignore]`):** gated by
`STOCKIHA_ALLOW_ESCPOS_PROOF=YES` and `STOCKIHA_ESCPOS_PROOF_PRINTER=<name>`.
Sends ESC `@` + `"Stockiha S0-008 RAW spooler proof\r\n"` + three line feeds —
no cut, no drawer command — and asserts the spooler accepted every byte.

## Verification

```powershell
cd src-tauri
cargo fmt --check
cargo check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
$env:STOCKIHA_ALLOW_ESCPOS_PROOF = "YES"
$env:STOCKIHA_ESCPOS_PROOF_PRINTER = "<exact printer name from Windows>"
cargo test -- --ignored   # requires a locally installed printer
```

No frontend checks — no frontend files change.

### What was verified without Windows

The FFI code was cross-checked against the real `windows-sys 0.61.2` source
(not assumed) and type-checked cleanly with `cargo check --target
x86_64-pc-windows-gnu`; `cargo clippy --target x86_64-pc-windows-gnu
--all-targets --all-features -- -D warnings` also passed cleanly (this
compiles, but does not link or run, the `cfg(windows)` writer and the ignored
live-proof test). Full linking requires a `mingw-w64` toolchain not available
in this sandbox's package repository, and actual spooler I/O requires Windows
— both remain genuine Windows-only manual checks.

## Windows / manual verification

- Windows fmt/check/clippy/test passed.
- 69 tests passed, 0 failed.
- Physical ESC/POS printer was unavailable.
- Live RAW spooler and paper-output validation is deferred.
- Future validation requires:
  STOCKIHA_ALLOW_ESCPOS_PROOF=YES
  STOCKIHA_ESCPOS_PROOF_PRINTER=<exact installed printer name>
- The deferred hardware test does not block subsequent development.

## Tracker

`TASKS.md` and `CURRENT_SLICE.md` are advanced only after the Windows live
proof passes against a real printer. Until then the verdict is **PASS WITH
MANUAL CHECKS**.
