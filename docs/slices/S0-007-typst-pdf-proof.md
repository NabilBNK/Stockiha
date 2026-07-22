# S0-007 — Typst French/Arabic PDF Proof

> Companion specification for Slice 0, Task S0-007. Proves the Rust backend can
> generate a deterministic, printable PDF entirely in-process using the embedded
> Typst compiler — no browser print, no frontend HTML, no external `typst` CLI,
> no cloud service, and no database. Subordinate to `final-architecture.md`;
> where they conflict, the architecture wins.

## Scope

- One crate-private module, `infrastructure::pdf_proof`, with its own
  non-serializable, redacted error type (`PdfProofError`). It does **not** touch
  the public IPC `ErrorCode` contract (mirrors the S0-006 precedent).
- One fixed proof document: `Stockiha` heading, document number, date, a
  line-item table, and subtotal/total rows.
- A `DocumentRenderer` trait with a single `EmbeddedTypstRenderer` implementation
  that compiles Typst in-process and exports a PDF, so a controlled-CLI renderer
  could replace it later without changing call sites. Only the embedded
  mechanism is implemented in S0-007 (no dual implementation).
- Deterministic page geometry (ISO A4, fixed 20 mm margins) and deterministic
  output bytes (no embedded timestamp; the document date is supplied as data,
  never `datetime.today()`; system fonts are never searched).
- An atomic file write (sibling temp → `sync_all` → rename) that never partially
  overwrites an existing destination on failure.

## Out of scope

Frontend, Tauri commands/IPC, database, the document generation/print/drawer
queues, business invoice + document numbering, ESC/POS printing, the rasterized
Arabic thermal fallback (S0-008), the i18n framework, and any font-provisioning
pipeline. `TASKS.md` / `CURRENT_SLICE.md` advance only after the Windows
verification pass.

## Money representation

All monetary values are exact **integer minor units** (DZD centimes, `i64`);
no floating point is used for any authoritative value. Line totals and the
subtotal use checked integer arithmetic. Human formatting (`1 234,56 DZD`,
French convention) happens in Rust; the Typst template performs no arithmetic
and no locale logic. For this proof there is no tax or discount (Slice 1), so
the total equals the subtotal.

## Text strategy (Arabic + Latin)

Typst shapes complex scripts natively (RTL and Arabic contextual joining via
rustybuzz). Latin/French glyphs come from the OFL fonts bundled in the
`typst-assets` crate (Libertinus Serif, New Computer Modern, DejaVu Sans Mono).
Arabic glyphs come from the OFL **Amiri** Naskh face bundled beside the module
and embedded at compile time with `include_bytes!`.

Both font sources are SIL Open Font License 1.1 — **not proprietary** — so
bundling is permitted (acceptance criterion 9 forbids proprietary fonts and
committing generated PDFs, not OFL source fonts). `fonts/OFL.txt` accompanies
the Amiri binary. System fonts are deliberately not searched, which is what
makes output byte-identical on every machine.

> Note on the originally-proposed "pinned OFL crate": no maintained crate ships
> Amiri/Noto Naskh Arabic bytes; the standard, deterministic, offline approach
> in the Typst ecosystem is to vendor the OFL font file and `include_bytes!` it.
> That is what this proof does; it fulfils the same intent (deterministic OFL
> Arabic, no system fonts).

## Dependencies (pinned exactly)

| Crate | Version | Purpose |
| --- | --- | --- |
| `typst` | `=0.15.1` | Compiler core, `World` trait, `Library`, `Font`/`FontBook`. |
| `typst-layout` | `=0.15.1` | `PagedDocument` output type (page count / dimensions). |
| `typst-pdf` | `=0.15.1` | PDF export (`typst_pdf::pdf`). |
| `typst-assets` (feat. `fonts`) | `=0.15.1` | OFL Latin fonts baked in for deterministic Latin/French. |

No `rust_decimal`, `chrono`, or `tempfile` are introduced (integer money,
data-supplied date, std-only atomic write). `src-tauri/Cargo.lock` is updated by
Cargo when the dependencies are added.

## Files

| File | Purpose |
| --- | --- |
| `src-tauri/Cargo.toml` | Add the four pinned Typst crates (with justification). |
| `src-tauri/src/infrastructure/mod.rs` | Register `mod pdf_proof;` (crate-private, `#[cfg_attr(not(test), allow(dead_code))]` like `session_proof`). |
| `src-tauri/src/infrastructure/pdf_proof/mod.rs` | Model, validation, renderer trait + embedded Typst renderer, redacted error, atomic write, tests. |
| `src-tauri/src/infrastructure/pdf_proof/template.typ` | Layout-only Typst source (`include_str!`). |
| `src-tauri/src/infrastructure/pdf_proof/fonts/Amiri-Regular.ttf` | OFL 1.1 Arabic face (`include_bytes!`). |
| `src-tauri/src/infrastructure/pdf_proof/fonts/OFL.txt` | Amiri license text. |
| `.gitignore` | Defensively ignore generated `*.pdf` (fonts remain tracked). |

## Tests

**Unit (`cargo test`, no external resources):**
- validation rejects empty items, zero quantity, negative price, and malformed dates;
- subtotal/total are exact integer sums; `format_dzd` is deterministic and grouped;
- the document→Typst-dict mapping is stable across calls; Typst-string escaping;
- `PdfProofError` `Display`/`Debug` are redacted to stable codes while the
  private diagnostic is retained (never leaked);
- atomic write produces exact bytes and leaves no temp file; an injected fault
  before rename leaves an existing destination byte-for-byte intact.

**Integration (`cargo test`, local, no server/hardware):** render the fixed
document to a real PDF and assert the `%PDF-` signature, non-empty output,
exactly one A4 page (595 × 842 pt), byte-identical output across two renders
(determinism), an atomic write to a temp path, and cleanup.
`STOCKIHA_PDF_PROOF_KEEP=<path>` optionally keeps the artifact for manual
visual inspection.

## Verification

```bash
cd src-tauri
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test            # includes the render integration test (no server needed)
```

No frontend checks — no frontend files change.

### Local visual check

```bash
STOCKIHA_PDF_PROOF_KEEP=/tmp/s0007.pdf cargo test pdf_proof -- --nocapture
xdg-open /tmp/s0007.pdf      # Linux
# start  \tmp\s0007.pdf      # Windows
```

## Windows / manual verification

The Linux sandbox cannot build the full Tauri crate (it requires
`webkit2gtk-4.1`/GTK system libraries) and cannot exercise the Windows runtime.
On the Windows dev machine, run the verification block above inside `src-tauri`
to confirm `cargo fmt`/`clippy`/`test` pass with the whole crate compiled, and
visually confirm Arabic RTL shaping in the emitted PDF. The PDF pipeline itself
is pure Rust and platform-independent, so no Windows-only APIs are involved.

## Tracker

`TASKS.md` and `CURRENT_SLICE.md` are advanced only after the Windows
verification passes. Until then the verdict is **PASS WITH MANUAL CHECKS**.
