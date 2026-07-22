//! S0-007 — Backend PDF generation proof (Typst French/Arabic).
//!
//! Proves the Rust backend can render a deterministic, printable PDF entirely
//! in-process using the embedded Typst compiler — no browser print, no frontend
//! HTML, no external CLI, no cloud service, no database.
//!
//! Scope (deliberate): one fixed proof document, deterministic geometry and
//! pagination, an atomic file write that never partially overwrites an existing
//! destination, and a clearly-addressed Arabic/Latin text strategy. There is no
//! Tauri command, no IPC surface, no business invoice, and no print queue.
//!
//! Following the S0-006 precedent, this module is crate-private and carries its
//! own non-serializable, redacted error type ([`PdfProofError`]); it does not
//! touch the public IPC `ErrorCode` contract.
//!
//! ## Money representation
//! All monetary values are exact **integer minor units** (DZD centimes, `i64`).
//! No floating point is used for any authoritative value. Formatting to a
//! human string happens in Rust (see [`format_dzd`]); the Typst template
//! performs no arithmetic and no locale logic.
//!
//! ## Text strategy (Arabic + Latin)
//! Typst shapes complex scripts natively (RTL and Arabic contextual forms via
//! rustybuzz). Latin/French glyphs come from the OFL fonts bundled in
//! `typst-assets` (Libertinus Serif et al.); Arabic glyphs come from the OFL
//! **Amiri** face bundled beside this module and embedded at compile time via
//! `include_bytes!`. Both are Open Font License 1.1 — not proprietary — so
//! bundling is permitted. System fonts are deliberately NOT searched, which is
//! what makes output identical on every machine. (Rasterized Arabic fallback
//! for thermal receipts is a separate concern handled by the ESC/POS proof,
//! S0-008, not here.)

use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};

use typst::diag::{FileError, FileResult, SourceDiagnostic, Warned};
use typst::foundations::{Bytes, Datetime, Duration};
use typst::syntax::{FileId, RootedPath, Source, VirtualPath, VirtualRoot};
use typst::text::{Font, FontBook};
use typst::utils::LazyHash;
use typst::{Library, LibraryExt, World};
use typst_layout::PagedDocument;
use typst_pdf::PdfOptions;

/// OFL 1.1 Amiri Naskh face, bundled for deterministic Arabic shaping.
static AMIRI_REGULAR: &[u8] = include_bytes!("fonts/Amiri-Regular.ttf");

/// Layout-only Typst source. Data is appended by the renderer.
static TEMPLATE: &str = include_str!("template.typ");

// ---------------------------------------------------------------------------
// Document model
// ---------------------------------------------------------------------------

/// A single proof line item. Quantities and prices are exact integers.
#[derive(Clone, Debug)]
pub(crate) struct LineItem {
    /// Human description (Latin or Arabic). Must be non-empty.
    pub description: String,
    /// Quantity in whole units. Must be > 0.
    pub quantity: u32,
    /// Unit price in DZD minor units (centimes). Must be >= 0.
    pub unit_price_minor: i64,
}

impl LineItem {
    /// Exact line amount in minor units, using checked integer arithmetic.
    fn line_total_minor(&self) -> Result<i64, PdfProofError> {
        i64::from(self.quantity)
            .checked_mul(self.unit_price_minor)
            .ok_or(PdfProofError::Validation("line total overflow"))
    }
}

/// The fixed proof document. `new_proof_document` builds the canonical instance.
#[derive(Clone, Debug)]
pub(crate) struct ProofDocument {
    pub document_number: String,
    /// ISO date `YYYY-MM-DD`, supplied as data (never `datetime.today()`), so
    /// rendering is deterministic.
    pub document_date: String,
    pub line_items: Vec<LineItem>,
}

impl ProofDocument {
    /// Validate all invariants required before rendering.
    pub fn validate(&self) -> Result<(), PdfProofError> {
        if self.document_number.trim().is_empty() {
            return Err(PdfProofError::Validation("empty document number"));
        }
        if !is_iso_date(&self.document_date) {
            return Err(PdfProofError::Validation("document date is not YYYY-MM-DD"));
        }
        if self.line_items.is_empty() {
            return Err(PdfProofError::Validation("no line items"));
        }
        for item in &self.line_items {
            if item.description.trim().is_empty() {
                return Err(PdfProofError::Validation("empty line description"));
            }
            if item.quantity == 0 {
                return Err(PdfProofError::Validation("line quantity must be > 0"));
            }
            if item.unit_price_minor < 0 {
                return Err(PdfProofError::Validation("line unit price is negative"));
            }
            // Surfaces overflow deterministically during validation.
            let _ = item.line_total_minor()?;
        }
        // Ensure the subtotal itself does not overflow.
        let _ = self.subtotal_minor()?;
        Ok(())
    }

    /// Exact subtotal in minor units (sum of line totals), checked.
    pub fn subtotal_minor(&self) -> Result<i64, PdfProofError> {
        let mut sum: i64 = 0;
        for item in &self.line_items {
            sum = sum
                .checked_add(item.line_total_minor()?)
                .ok_or(PdfProofError::Validation("subtotal overflow"))?;
        }
        Ok(sum)
    }

    /// Total in minor units. For this proof there is no tax or discount
    /// (deliberately out of scope; Slice 1), so the total equals the subtotal.
    pub fn total_minor(&self) -> Result<i64, PdfProofError> {
        self.subtotal_minor()
    }

    /// Serialize this document into a Typst dictionary literal, with all money
    /// and quantity values pre-formatted as strings in Rust.
    fn to_typst_dict(&self) -> Result<String, PdfProofError> {
        let mut items = String::new();
        for item in &self.line_items {
            items.push_str(&format!(
                "(desc: {}, qty: {}, unit: {}, line: {}), ",
                typst_string(&item.description),
                typst_string(&item.quantity.to_string()),
                typst_string(&format_dzd(item.unit_price_minor)),
                typst_string(&format_dzd(item.line_total_minor()?)),
            ));
        }
        Ok(format!(
            "(number: {number}, date: {date}, items: ({items}), subtotal: {subtotal}, total: {total})",
            number = typst_string(&self.document_number),
            date = typst_string(&self.document_date),
            items = items,
            subtotal = typst_string(&format_dzd(self.subtotal_minor()?)),
            total = typst_string(&format_dzd(self.total_minor()?)),
        ))
    }
}

/// The one canonical proof document. Fixed content → fixed output.
pub(crate) fn new_proof_document() -> ProofDocument {
    ProofDocument {
        document_number: "PROOF-0001".to_string(),
        document_date: "2026-01-15".to_string(),
        line_items: vec![
            LineItem {
                description: "Café moulu 250g".to_string(),
                quantity: 3,
                unit_price_minor: 45000, // 450,00 DZD
            },
            LineItem {
                description: "سكر أبيض 1kg".to_string(), // Arabic description
                quantity: 2,
                unit_price_minor: 12050, // 120,50 DZD
            },
            LineItem {
                description: "Thé vert (boîte)".to_string(),
                quantity: 1,
                unit_price_minor: 89900, // 899,00 DZD
            },
        ],
    }
}

// ---------------------------------------------------------------------------
// Money formatting & date validation (exact, integer-only)
// ---------------------------------------------------------------------------

/// Format DZD minor units as `1 234,56 DZD` using only integer arithmetic.
/// French convention: space thousands separator, comma decimal separator.
pub(crate) fn format_dzd(minor: i64) -> String {
    let negative = minor < 0;
    let abs = (minor as i128).unsigned_abs(); // avoids i64::MIN overflow
    let units = abs / 100;
    let cents = abs % 100;

    // Group the integer part in threes from the right with a space separator.
    // Counter-based (no `% 3 == 0`) so it stays clippy-clean and toolchain-agnostic.
    let mut reversed = String::new();
    let mut count: u8 = 0;
    for ch in units.to_string().chars().rev() {
        if count == 3 {
            reversed.push(' ');
            count = 0;
        }
        reversed.push(ch);
        count += 1;
    }
    let grouped: String = reversed.chars().rev().collect();

    format!(
        "{}{},{:02} DZD",
        if negative { "-" } else { "" },
        grouped,
        cents
    )
}

/// Strict `YYYY-MM-DD` check without pulling a date crate.
fn is_iso_date(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return false;
    }
    for (i, c) in b.iter().enumerate() {
        if i == 4 || i == 7 {
            continue;
        }
        if !c.is_ascii_digit() {
            return false;
        }
    }
    let month = s[5..7].parse::<u8>().unwrap_or(0);
    let day = s[8..10].parse::<u8>().unwrap_or(0);
    (1..=12).contains(&month) && (1..=31).contains(&day)
}

/// Escape a Rust string into a Typst double-quoted string literal.
fn typst_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for ch in s.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            _ => out.push(ch),
        }
    }
    out.push('"');
    out
}

// ---------------------------------------------------------------------------
// Errors (non-serializable, redacted — mirrors the S0-006 proof error)
// ---------------------------------------------------------------------------

/// Internal PDF-proof error. Not serialized; does not cross any IPC boundary.
/// `Debug`/`Display` are redacted to stable, payload-free strings so that no
/// internal diagnostic (or, in a real document, sensitive data) can leak.
pub(crate) enum PdfProofError {
    /// Input document failed validation. Carries a fixed, input-independent
    /// reason string (never user data).
    Validation(&'static str),
    /// Typst failed to compile the source. The diagnostic detail is retained
    /// privately for trusted in-crate debugging and never rendered.
    Render(String),
    /// PDF export failed. Diagnostic retained privately.
    Export(String),
    /// Filesystem error during the atomic write. Retained privately.
    Io(std::io::Error),
}

impl PdfProofError {
    fn code(&self) -> &'static str {
        match self {
            PdfProofError::Validation(_) => "PDF_PROOF_VALIDATION",
            PdfProofError::Render(_) => "PDF_PROOF_RENDER",
            PdfProofError::Export(_) => "PDF_PROOF_EXPORT",
            PdfProofError::Io(_) => "PDF_PROOF_IO",
        }
    }

    /// Internal-only diagnostic detail, retained for trusted in-crate debugging.
    /// It is never serialized and never surfaced by `Display`/`Debug`; callers
    /// inside the crate are responsible for redaction/logging policy.
    pub(crate) fn diagnostic(&self) -> String {
        match self {
            PdfProofError::Validation(s) => (*s).to_string(),
            PdfProofError::Render(s) | PdfProofError::Export(s) => s.clone(),
            PdfProofError::Io(e) => e.to_string(),
        }
    }
}

impl std::fmt::Display for PdfProofError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Redacted: only the stable code, never the private payload.
        write!(f, "{}", self.code())
    }
}

impl std::fmt::Debug for PdfProofError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Redacted: identical to Display; payload is intentionally withheld.
        write!(f, "PdfProofError({})", self.code())
    }
}

impl std::error::Error for PdfProofError {}

impl From<std::io::Error> for PdfProofError {
    fn from(e: std::io::Error) -> Self {
        PdfProofError::Io(e)
    }
}

fn render_diagnostics(diags: &[SourceDiagnostic]) -> String {
    diags
        .iter()
        .map(|d| d.message.to_string())
        .collect::<Vec<_>>()
        .join("; ")
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

/// Outcome of a successful render: the PDF bytes plus structural properties
/// used by tests to assert determinism and pagination.
pub(crate) struct RenderOutcome {
    pub bytes: Vec<u8>,
    pub page_count: usize,
    /// First page dimensions in PDF points, rounded to whole points.
    pub page_size_pt: (i64, i64),
}

/// A backend document renderer. Isolating this behind a trait keeps the door
/// open for a controlled-CLI renderer later (per the S0-007 decision) without
/// touching call sites.
pub(crate) trait DocumentRenderer {
    fn render(&self, doc: &ProofDocument) -> Result<RenderOutcome, PdfProofError>;
}

/// Renderer that compiles Typst in-process and exports a PDF.
pub(crate) struct EmbeddedTypstRenderer;

impl DocumentRenderer for EmbeddedTypstRenderer {
    fn render(&self, doc: &ProofDocument) -> Result<RenderOutcome, PdfProofError> {
        doc.validate()?;

        let main = format!("{}\n#render-proof({})\n", TEMPLATE, doc.to_typst_dict()?);
        let world = ProofWorld::new(main);

        let Warned {
            output,
            warnings: _,
        } = typst::compile::<PagedDocument>(&world);
        let document = output.map_err(|d| PdfProofError::Render(render_diagnostics(&d)))?;

        let page_count = document.pages().len();
        let size =
            document
                .pages()
                .first()
                .map(|p| p.frame.size())
                .ok_or(PdfProofError::Render(
                    "document produced zero pages".to_string(),
                ))?;
        let page_size_pt = (size.x.to_pt().round() as i64, size.y.to_pt().round() as i64);

        // Deterministic PDF: no embedded timestamp; stable content-derived id.
        let options = PdfOptions::default();
        let bytes = typst_pdf::pdf(&document, &options)
            .map_err(|d| PdfProofError::Export(render_diagnostics(&d)))?;

        Ok(RenderOutcome {
            bytes,
            page_count,
            page_size_pt,
        })
    }
}

/// Minimal single-source `World`. No external files, no images, no packages,
/// no system fonts, and `today()` is `None` — all of which keep output
/// deterministic.
struct ProofWorld {
    library: LazyHash<Library>,
    book: LazyHash<FontBook>,
    fonts: Vec<Font>,
    main_id: FileId,
    main: Source,
}

impl ProofWorld {
    fn new(main_text: String) -> Self {
        // Latin/French from typst-assets (OFL), Arabic from bundled Amiri (OFL).
        let mut fonts: Vec<Font> = typst_assets::fonts()
            .flat_map(|data| Font::iter(Bytes::new(data)))
            .collect();
        fonts.extend(Font::iter(Bytes::new(AMIRI_REGULAR)));

        let book = FontBook::from_fonts(&fonts);
        // Single in-memory main source rooted at the (unused) project root.
        let vpath = VirtualPath::new("main.typ").expect("static path is valid");
        let main_id = FileId::new(RootedPath::new(VirtualRoot::Project, vpath));
        let main = Source::new(main_id, main_text);

        ProofWorld {
            library: LazyHash::new(Library::builder().build()),
            book: LazyHash::new(book),
            fonts,
            main_id,
            main,
        }
    }
}

impl World for ProofWorld {
    fn library(&self) -> &LazyHash<Library> {
        &self.library
    }

    fn book(&self) -> &LazyHash<FontBook> {
        &self.book
    }

    fn main(&self) -> FileId {
        self.main_id
    }

    fn source(&self, id: FileId) -> FileResult<Source> {
        if id == self.main_id {
            Ok(self.main.clone())
        } else {
            Err(FileError::NotFound(std::path::PathBuf::from(
                "<unavailable>",
            )))
        }
    }

    fn file(&self, _id: FileId) -> FileResult<Bytes> {
        // The proof uses no external binary files.
        Err(FileError::NotFound(std::path::PathBuf::from(
            "<unavailable>",
        )))
    }

    fn font(&self, index: usize) -> Option<Font> {
        self.fonts.get(index).cloned()
    }

    fn today(&self, _offset: Option<Duration>) -> Option<Datetime> {
        // Deterministic: the document supplies its own date as data.
        None
    }
}

// ---------------------------------------------------------------------------
// Atomic write
// ---------------------------------------------------------------------------

/// Write `bytes` to `dest` atomically: write to a sibling temp file, flush and
/// fsync, then rename over the destination. On any failure the temp file is
/// removed and an existing destination is left byte-for-byte untouched.
///
/// `fault_before_rename` exists only for tests, to exercise the failure path
/// deterministically without needing a real I/O fault.
pub(crate) fn write_pdf_atomic(dest: &Path, bytes: &[u8]) -> Result<(), PdfProofError> {
    write_pdf_atomic_inner(dest, bytes, false)
}

fn write_pdf_atomic_inner(
    dest: &Path,
    bytes: &[u8],
    fault_before_rename: bool,
) -> Result<(), PdfProofError> {
    let parent = dest.parent().unwrap_or_else(|| Path::new("."));
    let file_name = dest
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or(PdfProofError::Validation("destination has no file name"))?;

    // Unique sibling temp name on the same filesystem (so rename is atomic).
    let unique = format!("{}-{}", std::process::id(), next_counter());
    let tmp: PathBuf = parent.join(format!(".{file_name}.tmp-{unique}"));

    // `create_new` guarantees we never clobber an unrelated file.
    let write_result = (|| -> std::io::Result<()> {
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)?;
        f.write_all(bytes)?;
        f.flush()?;
        f.sync_all()?;
        Ok(())
    })();

    if let Err(e) = write_result {
        let _ = fs::remove_file(&tmp);
        return Err(PdfProofError::Io(e));
    }

    if fault_before_rename {
        // Simulated failure after writing the temp but before publishing it.
        let _ = fs::remove_file(&tmp);
        return Err(PdfProofError::Io(std::io::Error::other("injected fault")));
    }

    if let Err(e) = fs::rename(&tmp, dest) {
        let _ = fs::remove_file(&tmp);
        return Err(PdfProofError::Io(e));
    }
    Ok(())
}

fn next_counter() -> u64 {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    // Mix in a monotonic nanosecond reading for cross-run uniqueness.
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    COUNTER.fetch_add(1, Ordering::Relaxed) ^ nanos
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // ---- Unit: validation ------------------------------------------------

    #[test]
    fn canonical_document_is_valid() {
        assert!(new_proof_document().validate().is_ok());
    }

    #[test]
    fn rejects_empty_items() {
        let mut d = new_proof_document();
        d.line_items.clear();
        assert!(matches!(d.validate(), Err(PdfProofError::Validation(_))));
    }

    #[test]
    fn rejects_zero_quantity_and_negative_price() {
        let mut d = new_proof_document();
        d.line_items[0].quantity = 0;
        assert!(d.validate().is_err());

        let mut d2 = new_proof_document();
        d2.line_items[0].unit_price_minor = -1;
        assert!(d2.validate().is_err());
    }

    #[test]
    fn rejects_bad_date() {
        let mut d = new_proof_document();
        d.document_date = "2026-13-40".to_string();
        assert!(d.validate().is_err());
        d.document_date = "15/01/2026".to_string();
        assert!(d.validate().is_err());
    }

    // ---- Unit: exact money math & formatting -----------------------------

    #[test]
    fn subtotal_is_exact_integer_sum() {
        // 3*45000 + 2*12050 + 1*89900 = 135000 + 24100 + 89900 = 249000
        let d = new_proof_document();
        assert_eq!(d.subtotal_minor().unwrap(), 249_000);
        assert_eq!(d.total_minor().unwrap(), d.subtotal_minor().unwrap());
    }

    #[test]
    fn format_dzd_is_deterministic_and_grouped() {
        assert_eq!(format_dzd(0), "0,00 DZD");
        assert_eq!(format_dzd(45000), "450,00 DZD");
        assert_eq!(format_dzd(12050), "120,50 DZD");
        assert_eq!(format_dzd(1_234_567), "12 345,67 DZD");
        assert_eq!(format_dzd(-100), "-1,00 DZD");
    }

    // ---- Unit: deterministic document data -------------------------------

    #[test]
    fn typst_dict_is_stable_across_calls() {
        let d = new_proof_document();
        assert_eq!(d.to_typst_dict().unwrap(), d.to_typst_dict().unwrap());
    }

    #[test]
    fn typst_string_escapes_quotes_and_backslashes() {
        assert_eq!(typst_string(r#"a"b\c"#), r#""a\"b\\c""#);
    }

    // ---- Unit: redacted error rendering ----------------------------------

    #[test]
    fn errors_are_redacted() {
        let e = PdfProofError::Render("secret typst internals".to_string());
        assert_eq!(format!("{e}"), "PDF_PROOF_RENDER");
        assert_eq!(format!("{e:?}"), "PdfProofError(PDF_PROOF_RENDER)");
        assert!(!format!("{e} {e:?}").contains("secret"));
        // The detail is retained internally but only reachable via `diagnostic()`.
        assert!(e.diagnostic().contains("secret"));

        // Every variant redacts in Display/Debug while retaining its detail.
        let variants = [
            PdfProofError::Validation("v-detail"),
            PdfProofError::Export("x-detail".to_string()),
            PdfProofError::Io(std::io::Error::other("io-detail")),
        ];
        for v in &variants {
            assert!(format!("{v}").starts_with("PDF_PROOF_"));
            assert!(!format!("{v:?}").contains("detail"));
            assert!(!v.diagnostic().is_empty());
        }
    }

    // ---- Unit: atomic write safety ---------------------------------------

    #[test]
    fn atomic_write_creates_file_with_exact_bytes() {
        let dir = std::env::temp_dir().join(format!("s0007-aw-{}", next_counter()));
        fs::create_dir_all(&dir).unwrap();
        let dest = dir.join("out.pdf");
        write_pdf_atomic(&dest, b"%PDF-1.7 hello").unwrap();
        assert_eq!(fs::read(&dest).unwrap(), b"%PDF-1.7 hello");
        // No leftover temp files.
        let leftovers: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp-"))
            .collect();
        assert!(leftovers.is_empty(), "temp file was left behind");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn failed_write_never_partially_overwrites_existing_destination() {
        let dir = std::env::temp_dir().join(format!("s0007-fault-{}", next_counter()));
        fs::create_dir_all(&dir).unwrap();
        let dest = dir.join("ledger.pdf");
        fs::write(&dest, b"ORIGINAL-INTACT").unwrap();

        // Inject a fault after the temp write, before the rename.
        let err = write_pdf_atomic_inner(&dest, b"NEW-DATA-THAT-MUST-NOT-LAND", true);
        assert!(err.is_err());

        // Destination is byte-for-byte unchanged, and no temp file remains.
        assert_eq!(fs::read(&dest).unwrap(), b"ORIGINAL-INTACT");
        let leftovers: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp-"))
            .collect();
        assert!(leftovers.is_empty(), "temp file was left behind on failure");
        fs::remove_dir_all(&dir).ok();
    }

    // ---- Integration: render a real PDF ----------------------------------

    #[test]
    fn integration_renders_real_deterministic_pdf() {
        let doc = new_proof_document();
        let renderer = EmbeddedTypstRenderer;

        let first = renderer.render(&doc).expect("render should succeed");

        // PDF signature + non-empty.
        assert!(first.bytes.starts_with(b"%PDF-"), "missing PDF signature");
        assert!(first.bytes.len() > 1000, "PDF unexpectedly small");

        // Structural: exactly one A4 page (595 x 842 pt, within rounding).
        assert_eq!(first.page_count, 1, "expected a single-page proof");
        assert_eq!(
            first.page_size_pt,
            (595, 842),
            "expected A4 portrait points"
        );

        // Determinism: a second render is byte-identical.
        let second = renderer.render(&doc).expect("second render should succeed");
        assert_eq!(
            first.bytes, second.bytes,
            "PDF output is not byte-deterministic"
        );

        // Write it out atomically and verify on disk, then clean up.
        let dir = std::env::temp_dir().join(format!("s0007-int-{}", next_counter()));
        fs::create_dir_all(&dir).unwrap();
        let dest = dir.join("proof.pdf");
        write_pdf_atomic(&dest, &first.bytes).unwrap();
        let on_disk = fs::read(&dest).unwrap();
        assert!(on_disk.starts_with(b"%PDF-"));
        assert_eq!(on_disk, first.bytes);

        // Optional: keep the artifact for manual visual inspection.
        if let Ok(keep) = std::env::var("STOCKIHA_PDF_PROOF_KEEP") {
            if !keep.is_empty() {
                fs::write(&keep, &first.bytes).ok();
            }
        }
        fs::remove_dir_all(&dir).ok();
    }
}
