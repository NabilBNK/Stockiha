//! S0-008 — ESC/POS Windows RAW spooler proof.
//!
//! Proves the Rust backend can send raw ESC/POS bytes through the Windows
//! print spooler (`RAW` datatype) to a selected printer, with correct Win32
//! lifecycle ordering and safe error handling — no browser, no frontend, no
//! IPC, no database, and no durable print-job queue.
//!
//! Following the S0-005/S0-006/S0-007 precedent, this module is crate-private
//! and carries its own non-serializable, redacted error type
//! ([`EscposProofError`]); it does not touch the public IPC `ErrorCode`
//! contract.
//!
//! ## Platform split
//! [`SpoolerJob`], its validation, [`EscposProofError`], the harmless payload
//! builder, and [`write_all_tracked`] are platform-neutral and unit-tested on
//! every platform. Only the Win32 FFI writer ([`send_raw_job`]) and the live
//! proof are compiled and run on Windows (`#[cfg(windows)]`).
//!
//! ## Secrets / data-leak policy
//! `EscposProofError`'s `Display`/`Debug` are redacted to a stable
//! `ESCPOS_PROOF_*` code, exactly like [`super::pdf_proof::PdfProofError`].
//! Neither the printer name nor the payload bytes are ever interpolated into
//! an error message, a log line, or any `Display`/`Debug` output — printer
//! names and raw payloads may embed customer-identifying or receipt data in
//! future slices, so this proof treats them as sensitive from the start. The
//! private `diagnostic()` accessor retains detail for trusted in-crate use
//! (tests) only.

/// Maximum length, in UTF-16 code units (excluding the terminating NUL), that
/// a printer name may have. Printer names are Unicode; ASCII is not required.
pub(crate) const MAX_PRINTER_NAME_UTF16_LEN: usize = 538;

/// Maximum payload size accepted by this proof, in bytes. This is an
/// arbitrary, generous safety bound for the proof only — it is not a Win32 or
/// ESC/POS specification limit, and real receipt sizing is out of scope here.
pub(crate) const MAX_PAYLOAD_BYTES: usize = 64 * 1024;

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

/// A validated spooler job: a printer name and a raw byte payload, ready to
/// hand to the Win32 writer. Deliberately carries no `Debug`/`Display` impl —
/// both fields may hold sensitive data in future slices, and accidental
/// derived logging is exactly what this type must never allow.
pub(crate) struct SpoolerJob {
    /// Original printer name, validated (non-empty, no embedded NUL, within
    /// [`MAX_PRINTER_NAME_UTF16_LEN`] UTF-16 code units).
    pub(crate) printer_name: String,
    /// NUL-terminated UTF-16 encoding of `printer_name`, precomputed once at
    /// construction so the Win32 call site never re-validates or re-encodes.
    pub(crate) printer_name_utf16: Vec<u16>,
    /// Validated raw payload (non-empty, within [`MAX_PAYLOAD_BYTES`]).
    pub(crate) payload: Vec<u8>,
}

impl SpoolerJob {
    /// Validate `printer_name` and `payload` and build a [`SpoolerJob`].
    pub(crate) fn new(printer_name: &str, payload: Vec<u8>) -> Result<Self, EscposProofError> {
        let printer_name_utf16 = validate_printer_name(printer_name)?;
        validate_payload(&payload)?;
        Ok(SpoolerJob {
            printer_name: printer_name.to_string(),
            printer_name_utf16,
            payload,
        })
    }
}

/// Validate a printer name and return its NUL-terminated UTF-16 encoding.
///
/// Printer names are Unicode: ASCII is not required. Rejects an empty name,
/// a name containing an embedded NUL code unit, and a name exceeding
/// [`MAX_PRINTER_NAME_UTF16_LEN`] UTF-16 code units (excluding the
/// terminator this function appends).
pub(crate) fn validate_printer_name(name: &str) -> Result<Vec<u16>, EscposProofError> {
    if name.is_empty() {
        return Err(EscposProofError::NameValidation("printer name is empty"));
    }
    let units: Vec<u16> = name.encode_utf16().collect();
    if units.contains(&0) {
        return Err(EscposProofError::NameValidation(
            "printer name contains an embedded NUL",
        ));
    }
    if units.len() > MAX_PRINTER_NAME_UTF16_LEN {
        return Err(EscposProofError::NameValidation(
            "printer name exceeds the maximum UTF-16 length",
        ));
    }
    let mut terminated = units;
    terminated.push(0);
    Ok(terminated)
}

/// Validate a raw payload: rejects empty and over-sized payloads.
pub(crate) fn validate_payload(payload: &[u8]) -> Result<(), EscposProofError> {
    if payload.is_empty() {
        return Err(EscposProofError::PayloadValidation("payload is empty"));
    }
    if payload.len() > MAX_PAYLOAD_BYTES {
        return Err(EscposProofError::PayloadValidation(
            "payload exceeds the maximum size for this proof",
        ));
    }
    Ok(())
}

/// Build the deterministic, harmless payload used by the live proof: an
/// ESC/POS initialize command, one line of identifying text, and three line
/// feeds. Deliberately contains **no** paper-cut and **no** cash-drawer
/// command — this proof only proves the spooler write path.
pub(crate) fn harmless_proof_payload() -> Vec<u8> {
    let mut payload = Vec::new();
    payload.extend_from_slice(&[0x1B, 0x40]); // ESC @ — initialize printer.
    payload.extend_from_slice(b"Stockiha S0-008 RAW spooler proof\r\n");
    payload.extend_from_slice(b"\n\n\n"); // Three line feeds.
    payload
}

// ---------------------------------------------------------------------------
// Errors (non-serializable, redacted — mirrors PdfProofError / SessionProofError)
// ---------------------------------------------------------------------------

/// Internal ESC/POS-proof error. Not serialized; does not cross any IPC
/// boundary. `Debug`/`Display` are redacted to a stable, payload-free string
/// so that no internal diagnostic — and no printer name or payload byte —
/// can leak into a log or an error surface.
pub(crate) enum EscposProofError {
    /// Printer name failed validation. Carries a fixed, input-independent
    /// reason string (never the printer name itself).
    NameValidation(&'static str),
    /// Payload failed validation. Carries a fixed, input-independent reason
    /// string (never the payload bytes).
    PayloadValidation(&'static str),
    /// A write helper made zero progress on a call that reported success,
    /// which would otherwise loop forever. Treated as a hard failure.
    NoProgress,
    /// A Win32 spooler API call failed. `operation` names the call (e.g.
    /// `"OpenPrinterW"`); `code` is the `GetLastError()` value. Neither the
    /// printer name nor the payload are retained here.
    #[cfg_attr(not(windows), allow(dead_code))]
    Win32 { operation: &'static str, code: u32 },
}

impl EscposProofError {
    fn code(&self) -> &'static str {
        match self {
            EscposProofError::NameValidation(_) => "ESCPOS_PROOF_NAME_VALIDATION",
            EscposProofError::PayloadValidation(_) => "ESCPOS_PROOF_PAYLOAD_VALIDATION",
            EscposProofError::NoProgress => "ESCPOS_PROOF_NO_PROGRESS",
            EscposProofError::Win32 { .. } => "ESCPOS_PROOF_WIN32",
        }
    }

    /// Internal-only diagnostic detail, retained for trusted in-crate
    /// debugging and tests. Never serialized and never surfaced by
    /// `Display`/`Debug`.
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn diagnostic(&self) -> String {
        match self {
            EscposProofError::NameValidation(s) | EscposProofError::PayloadValidation(s) => {
                (*s).to_string()
            }
            EscposProofError::NoProgress => "no progress".to_string(),
            EscposProofError::Win32 { operation, code } => format!("{operation} failed: {code}"),
        }
    }
}

impl std::fmt::Display for EscposProofError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.code())
    }
}

impl std::fmt::Debug for EscposProofError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "EscposProofError({})", self.code())
    }
}

impl std::error::Error for EscposProofError {}

// ---------------------------------------------------------------------------
// Partial-write accounting (platform-neutral, testable without a printer)
// ---------------------------------------------------------------------------

/// Drive `write_once` until every byte of `payload` has been accounted for.
///
/// `write_once` receives the remaining unwritten slice and returns the number
/// of bytes it actually wrote. This helper:
/// - loops until the full payload is written;
/// - treats a reported write of `0` bytes as [`EscposProofError::NoProgress`]
///   (prevents an infinite loop if a lower layer stalls);
/// - clamps an over-report (a `write_once` claiming more bytes written than
///   it was offered) to the offered length, so accounting can never overrun
///   the payload;
/// - propagates any error from `write_once` unchanged.
///
/// This is the exact accounting `WritePrinter`'s partial-write behavior needs
/// on the Windows path, but it has no Win32 dependency and is fully testable
/// with a fake closure on every platform.
pub(crate) fn write_all_tracked<F>(
    payload: &[u8],
    mut write_once: F,
) -> Result<usize, EscposProofError>
where
    F: FnMut(&[u8]) -> Result<u32, EscposProofError>,
{
    let mut total_written: usize = 0;
    while total_written < payload.len() {
        let remaining = &payload[total_written..];
        let written = write_once(remaining)? as usize;
        if written == 0 {
            return Err(EscposProofError::NoProgress);
        }
        total_written += written.min(remaining.len());
    }
    Ok(total_written)
}

// ---------------------------------------------------------------------------
// Win32 writer (Windows only)
// ---------------------------------------------------------------------------

/// Send `job` to the Windows print spooler as a single `RAW` document.
///
/// Lifecycle (exact order): `OpenPrinterW` → `StartDocPrinterW` (datatype
/// `RAW`) → `StartPagePrinter` → `WritePrinter` (looped via
/// [`write_all_tracked`]) → `EndPagePrinter` → `EndDocPrinter` →
/// `ClosePrinter`.
///
/// Failure handling:
/// - **Before** `StartDocPrinterW` succeeds, the only cleanup is
///   `ClosePrinter` (there is no job to abort yet).
/// - **After** `StartDocPrinterW` succeeds, any later failure triggers a
///   best-effort `AbortPrinter` followed by `ClosePrinter`; `EndDocPrinter`
///   is never used as a cancellation mechanism — it does not cancel a job.
/// - Cleanup call outcomes are always discarded: a cleanup failure never
///   replaces the original operation error that triggered the cleanup.
/// - On the pure success path, a failing final `ClosePrinter` **is** the
///   reportable error (there is no earlier failure for it to preserve).
#[cfg(windows)]
pub(crate) fn send_raw_job(job: &SpoolerJob) -> Result<usize, EscposProofError> {
    use core::ffi::c_void;
    use core::ptr;
    use windows_sys::Win32::Foundation::GetLastError;
    use windows_sys::Win32::Graphics::Printing::{
        EndDocPrinter, EndPagePrinter, OpenPrinterW, StartDocPrinterW, StartPagePrinter,
        WritePrinter, DOC_INFO_1W, PRINTER_HANDLE,
    };

    // Wide, NUL-terminated buffers kept alive on this stack frame for the
    // duration of the calls that reference them; Win32 does not take
    // ownership of these pointers.
    let mut doc_name: Vec<u16> = "Stockiha S0-008 ESC/POS proof\0".encode_utf16().collect();
    let mut datatype: Vec<u16> = "RAW\0".encode_utf16().collect();

    let mut handle = PRINTER_HANDLE::default();
    // SAFETY: `job.printer_name_utf16` is validated, NUL-terminated UTF-16
    // (see `validate_printer_name`); `handle` is a valid out-pointer; a null
    // `pDefault` requests the printer's default access/datatype, which Win32
    // permits.
    let opened = unsafe { OpenPrinterW(job.printer_name_utf16.as_ptr(), &mut handle, ptr::null()) };
    if opened == 0 {
        // Before StartDocPrinter succeeds: nothing was opened, so there is
        // nothing to clean up at all.
        return Err(EscposProofError::Win32 {
            operation: "OpenPrinterW",
            code: unsafe { GetLastError() },
        });
    }

    let doc_info = DOC_INFO_1W {
        pDocName: doc_name.as_mut_ptr(),
        pOutputFile: ptr::null_mut(),
        pDatatype: datatype.as_mut_ptr(),
    };
    // SAFETY: `handle` was just successfully opened by `OpenPrinterW` above;
    // `doc_info` points at buffers alive for the duration of this call.
    let job_id = unsafe { StartDocPrinterW(handle, 1, &doc_info) };
    if job_id == 0 {
        let original = EscposProofError::Win32 {
            operation: "StartDocPrinterW",
            code: unsafe { GetLastError() },
        };
        // Before StartDocPrinter succeeds: ClosePrinter only.
        // SAFETY: `handle` was successfully opened above and not yet closed.
        unsafe { close_printer_best_effort(handle) };
        return Err(original);
    }

    // From here on, StartDocPrinter has succeeded: any failure below uses the
    // after-StartDocPrinter cleanup path, and the ORIGINAL error — never a
    // cleanup outcome — is what this function returns.
    // SAFETY: `handle` has an open document (StartDocPrinterW succeeded).
    let page_started = unsafe { StartPagePrinter(handle) };
    if page_started == 0 {
        let original = EscposProofError::Win32 {
            operation: "StartPagePrinter",
            code: unsafe { GetLastError() },
        };
        // SAFETY: `handle` has an open document that must be abandoned.
        unsafe { abort_and_close_best_effort(handle) };
        return Err(original);
    }

    let write_result = write_all_tracked(&job.payload, |chunk| {
        let mut written: u32 = 0;
        // SAFETY: `chunk` is a valid slice of length `chunk.len()`; `handle`
        // has an active page (StartPagePrinter succeeded); `written` is a
        // valid out-pointer for the duration of this call.
        let ok = unsafe {
            WritePrinter(
                handle,
                chunk.as_ptr() as *const c_void,
                chunk.len() as u32,
                &mut written,
            )
        };
        if ok == 0 {
            Err(EscposProofError::Win32 {
                operation: "WritePrinter",
                code: unsafe { GetLastError() },
            })
        } else {
            Ok(written)
        }
    });
    let total_written = match write_result {
        Ok(n) => n,
        Err(original) => {
            // SAFETY: `handle` has an open document/page that must be abandoned.
            unsafe { abort_and_close_best_effort(handle) };
            return Err(original);
        }
    };

    // SAFETY: `handle` has an active page to end.
    let page_ended = unsafe { EndPagePrinter(handle) };
    if page_ended == 0 {
        let original = EscposProofError::Win32 {
            operation: "EndPagePrinter",
            code: unsafe { GetLastError() },
        };
        unsafe { abort_and_close_best_effort(handle) };
        return Err(original);
    }

    // SAFETY: `handle` has an open document to end.
    let doc_ended = unsafe { EndDocPrinter(handle) };
    if doc_ended == 0 {
        let original = EscposProofError::Win32 {
            operation: "EndDocPrinter",
            code: unsafe { GetLastError() },
        };
        unsafe { abort_and_close_best_effort(handle) };
        return Err(original);
    }

    // Pure success path: ClosePrinter is now the primary remaining operation,
    // not failure cleanup. If it fails, that failure IS the reportable error
    // — there is no earlier error here for it to accidentally replace.
    // SAFETY: `handle` is open and every prior stage succeeded.
    let closed = unsafe { windows_sys::Win32::Graphics::Printing::ClosePrinter(handle) };
    if closed == 0 {
        return Err(EscposProofError::Win32 {
            operation: "ClosePrinter",
            code: unsafe { GetLastError() },
        });
    }

    Ok(total_written)
}

/// Best-effort `ClosePrinter` used on the before-`StartDocPrinter` failure
/// path. The outcome is intentionally discarded — cleanup errors must never
/// replace the original operation error the caller is already returning.
///
/// # Safety
/// `handle` must be a printer handle successfully returned by `OpenPrinterW`
/// and not already closed.
#[cfg(windows)]
unsafe fn close_printer_best_effort(
    handle: windows_sys::Win32::Graphics::Printing::PRINTER_HANDLE,
) {
    let _ = unsafe { windows_sys::Win32::Graphics::Printing::ClosePrinter(handle) };
}

/// Best-effort `AbortPrinter` then `ClosePrinter`, used on any failure that
/// occurs after `StartDocPrinterW` has succeeded. `EndDocPrinter` is
/// deliberately never called here: it does not cancel a job. Both outcomes
/// are intentionally discarded — cleanup errors must never replace the
/// original operation error the caller is already returning.
///
/// # Safety
/// `handle` must be a printer handle for which `StartDocPrinterW` succeeded
/// and which has not already been closed.
#[cfg(windows)]
unsafe fn abort_and_close_best_effort(
    handle: windows_sys::Win32::Graphics::Printing::PRINTER_HANDLE,
) {
    let _ = unsafe { windows_sys::Win32::Graphics::Printing::AbortPrinter(handle) };
    let _ = unsafe { windows_sys::Win32::Graphics::Printing::ClosePrinter(handle) };
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // ---- Printer name validation (Unicode; ASCII not required) -----------

    #[test]
    fn rejects_empty_printer_name() {
        assert!(matches!(
            validate_printer_name(""),
            Err(EscposProofError::NameValidation(_))
        ));
    }

    #[test]
    fn rejects_printer_name_with_embedded_nul() {
        let name = "Ticket\0Printer";
        assert!(matches!(
            validate_printer_name(name),
            Err(EscposProofError::NameValidation(_))
        ));
    }

    #[test]
    fn rejects_printer_name_over_max_utf16_length() {
        let name: String = "a".repeat(MAX_PRINTER_NAME_UTF16_LEN + 1);
        assert!(matches!(
            validate_printer_name(&name),
            Err(EscposProofError::NameValidation(_))
        ));
    }

    #[test]
    fn accepts_printer_name_at_max_utf16_length() {
        let name: String = "a".repeat(MAX_PRINTER_NAME_UTF16_LEN);
        let encoded = validate_printer_name(&name).expect("boundary length must be accepted");
        // NUL-terminated: max length + 1 terminator.
        assert_eq!(encoded.len(), MAX_PRINTER_NAME_UTF16_LEN + 1);
        assert_eq!(*encoded.last().unwrap(), 0);
    }

    #[test]
    fn accepts_non_ascii_unicode_printer_name() {
        // Arabic printer name: ASCII is explicitly not required.
        let name = "طابعة المطبخ";
        let encoded = validate_printer_name(name).expect("Unicode name must be accepted");
        assert_eq!(*encoded.last().unwrap(), 0, "must be NUL-terminated");
        // Round-trip (excluding the terminator) must reproduce the name.
        let without_nul = &encoded[..encoded.len() - 1];
        assert_eq!(String::from_utf16(without_nul).unwrap(), name);
    }

    // ---- SpoolerJob::new (the real constructor, not just the loose
    // validation functions) -------------------------------------------------

    #[test]
    fn spooler_job_new_validates_and_stores_fields() {
        let payload = harmless_proof_payload();
        let job = SpoolerJob::new("Kitchen Printer", payload.clone())
            .expect("a valid name and payload must construct a job");
        assert_eq!(job.printer_name, "Kitchen Printer");
        assert_eq!(job.payload, payload);
        assert_eq!(
            *job.printer_name_utf16.last().unwrap(),
            0,
            "must be NUL-terminated"
        );
    }

    #[test]
    fn spooler_job_new_propagates_name_validation_error() {
        assert!(matches!(
            SpoolerJob::new("", vec![1]),
            Err(EscposProofError::NameValidation(_))
        ));
    }

    #[test]
    fn spooler_job_new_propagates_payload_validation_error() {
        assert!(matches!(
            SpoolerJob::new("Kitchen Printer", vec![]),
            Err(EscposProofError::PayloadValidation(_))
        ));
    }

    // ---- Payload validation -----------------------------------------------

    #[test]
    fn rejects_empty_payload() {
        assert!(matches!(
            validate_payload(&[]),
            Err(EscposProofError::PayloadValidation(_))
        ));
    }

    #[test]
    fn rejects_oversized_payload() {
        let payload = vec![0u8; MAX_PAYLOAD_BYTES + 1];
        assert!(matches!(
            validate_payload(&payload),
            Err(EscposProofError::PayloadValidation(_))
        ));
    }

    #[test]
    fn accepts_payload_at_max_size() {
        let payload = vec![0u8; MAX_PAYLOAD_BYTES];
        assert!(validate_payload(&payload).is_ok());
    }

    // ---- Deterministic harmless payload -----------------------------------

    #[test]
    fn harmless_payload_is_deterministic_and_exact() {
        let a = harmless_proof_payload();
        let b = harmless_proof_payload();
        assert_eq!(a, b, "payload must be deterministic across calls");

        let mut expected = vec![0x1B, 0x40];
        expected.extend_from_slice(b"Stockiha S0-008 RAW spooler proof\r\n");
        expected.extend_from_slice(b"\n\n\n");
        assert_eq!(a, expected);

        // No cut command (GS V / ESC i / ESC m) and no drawer-kick (ESC p).
        assert!(!contains_subsequence(&a, &[0x1D, b'V']));
        assert!(!contains_subsequence(&a, &[0x1B, b'i']));
        assert!(!contains_subsequence(&a, &[0x1B, b'm']));
        assert!(!contains_subsequence(&a, &[0x1B, b'p']));
    }

    fn contains_subsequence(haystack: &[u8], needle: &[u8]) -> bool {
        haystack.windows(needle.len()).any(|w| w == needle)
    }

    // ---- Error redaction ----------------------------------------------------

    #[test]
    fn errors_are_redacted() {
        let variants: Vec<EscposProofError> = vec![
            EscposProofError::NameValidation("name-detail"),
            EscposProofError::PayloadValidation("payload-detail"),
            EscposProofError::NoProgress,
            EscposProofError::Win32 {
                operation: "WritePrinter",
                code: 1450,
            },
        ];
        for e in &variants {
            let displayed = format!("{e}");
            let debugged = format!("{e:?}");
            assert!(displayed.starts_with("ESCPOS_PROOF_"));
            assert!(debugged.starts_with("EscposProofError(ESCPOS_PROOF_"));
            assert!(!displayed.contains("detail"));
            assert!(!debugged.contains("detail"));
            assert!(!displayed.contains("1450"));
            assert!(!debugged.contains("1450"));
            assert!(!e.diagnostic().is_empty());
        }
        // The Win32 code is retained in the private diagnostic, not in Display/Debug.
        let win32 = &variants[3];
        assert!(win32.diagnostic().contains("1450"));
        assert!(win32.diagnostic().contains("WritePrinter"));
    }

    // ---- Partial-write accounting (no Win32 dependency) --------------------

    #[test]
    fn write_all_tracked_accounts_partial_writes() {
        let payload = b"Stockiha ESC/POS partial write test payload";
        let mut offset = 0usize;
        let total = write_all_tracked(payload, |chunk| {
            // Simulate a spooler that only accepts 3 bytes per call.
            let n = chunk.len().min(3);
            offset += n;
            Ok(n as u32)
        })
        .expect("partial writes must eventually complete");
        assert_eq!(total, payload.len());
        assert_eq!(offset, payload.len());
    }

    #[test]
    fn write_all_tracked_detects_zero_progress() {
        let payload = b"anything";
        let result = write_all_tracked(payload, |_chunk| Ok(0));
        assert!(matches!(result, Err(EscposProofError::NoProgress)));
    }

    #[test]
    fn write_all_tracked_clamps_over_reported_write() {
        let payload = b"abc";
        // A misbehaving writer claims to have written more than it was given.
        let total = write_all_tracked(payload, |chunk| Ok((chunk.len() + 100) as u32))
            .expect("clamped over-report must still complete without overrun");
        assert_eq!(total, payload.len());
    }

    #[test]
    fn write_all_tracked_propagates_write_error() {
        let payload = b"abc";
        let result = write_all_tracked(payload, |_chunk| {
            Err(EscposProofError::Win32 {
                operation: "WritePrinter",
                code: 5,
            })
        });
        assert!(matches!(
            result,
            Err(EscposProofError::Win32 {
                operation: "WritePrinter",
                code: 5
            })
        ));
    }

    // ---- Windows live proof (ignored by default; requires a real printer) --

    /// Sends the harmless proof payload to a locally installed Windows
    /// printer through the real spooler. Ignored by default. To run:
    ///
    /// ```powershell
    /// $env:STOCKIHA_ALLOW_ESCPOS_PROOF = "YES"
    /// $env:STOCKIHA_ESCPOS_PROOF_PRINTER = "<exact printer name from Windows>"
    /// cargo test -p stockiha-backend escpos_proof -- --ignored
    /// ```
    ///
    /// Sends: ESC `@`, one identifying text line, three line feeds. No cut,
    /// no drawer kick. Asserts the spooler accepted every byte of the payload.
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn windows_live_proof_sends_harmless_payload_to_real_printer() {
        let allowed = std::env::var("STOCKIHA_ALLOW_ESCPOS_PROOF").unwrap_or_default();
        assert_eq!(
            allowed, "YES",
            "set STOCKIHA_ALLOW_ESCPOS_PROOF=YES to run this live proof"
        );
        let printer_name = std::env::var("STOCKIHA_ESCPOS_PROOF_PRINTER")
            .expect("set STOCKIHA_ESCPOS_PROOF_PRINTER=<printer name> to run this live proof");

        let job = SpoolerJob::new(&printer_name, harmless_proof_payload())
            .expect("the canonical harmless payload and a configured printer name must validate");
        let written = send_raw_job(&job).expect("the spooler must accept the harmless payload");
        assert_eq!(
            written,
            job.payload.len(),
            "the spooler must accept every byte of the payload"
        );
    }
}
