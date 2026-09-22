//! WS-F-002 — synchronous raw printing for till receipts.
//! WS-M-1 — shop identity, print settings and the company logo file.
//!
//! Sends ESC/POS bytes to a named Windows printer using the already-tested
//! spooler writer in `infrastructure::escpos_proof`. Printing is synchronous
//! and deliberately has no retry queue: the sale is already recorded before
//! this is called, and a failure is surfaced to the cashier who can reprint.
//!
//! Neither the printer name nor the payload is ever interpolated into an
//! error message — both may carry customer data.
//!
//! Printing settings (including the new WS-M-1 identity columns) are carried
//! as raw `jsonb` end to end: PostgreSQL owns the field list, so a new
//! identity column never needs a matching Rust struct.
//!
//! The logo is a file, not a database blob (`<app_data_dir>/company-assets/
//! logo.<ext>`), so it rides along automatically with the existing backup
//! and restore of that whole directory (`recovery_creation.rs`,
//! `recovery_engine/live.rs`) with no code change there.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::Value as JsonValue;
use sqlx::{query_scalar, PgPool};

use crate::error::AppError;
use crate::infrastructure::escpos_proof::{send_raw_job, SpoolerJob};

const COMPANY_ASSETS_DIR: &str = "company-assets";
const MAX_LOGO_BYTES: u64 = 2 * 1024 * 1024;
const SUPPORTED_LOGO_EXTENSIONS: [&str; 4] = ["png", "jpg", "jpeg", "webp"];

/// Sends raw bytes to a Windows printer by name.
///
/// Returns the number of bytes the spooler accepted.
#[cfg(windows)]
pub(crate) fn print_raw(printer_name: &str, payload: Vec<u8>) -> Result<usize, AppError> {
    let job =
        SpoolerJob::new(printer_name, payload).map_err(|error| AppError::ValidationError {
            diagnostic: format!("Printer job rejected: {error}"),
        })?;

    send_raw_job(&job).map_err(|error| AppError::internal(format!("Printing failed: {error}")))
}

/// Non-Windows builds compile but cannot print. The app ships on Windows only;
/// this arm exists so `cargo check` and CI pass on Linux.
#[cfg(not(windows))]
pub(crate) fn print_raw(printer_name: &str, payload: Vec<u8>) -> Result<usize, AppError> {
    let _ = SpoolerJob::new(printer_name, payload).map_err(|error| AppError::ValidationError {
        diagnostic: format!("Printer job rejected: {error}"),
    })?;

    Err(AppError::internal(
        "Raw printing is only available on Windows".to_string(),
    ))
}

pub(crate) async fn get_printing_settings(
    pool: &PgPool,
    session_token: &str,
) -> Result<JsonValue, AppError> {
    query_scalar("SELECT core.get_printing_settings($1)")
        .bind(session_token)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)
}

pub(crate) async fn save_printing_settings(
    pool: &PgPool,
    session_token: &str,
    settings: JsonValue,
) -> Result<JsonValue, AppError> {
    query_scalar("SELECT core.save_printing_settings($1, $2)")
        .bind(session_token)
        .bind(settings)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)
}

/// Validates and copies a chosen image file into
/// `<app_data_dir>/company-assets/logo.<ext>`, then records the file name in
/// `core.printing_settings` via `core.set_printing_logo`.
///
/// The file copy happens before the database call, so a failed copy never
/// records a logo file name that does not exist on disk.
pub(crate) async fn set_company_logo(
    pool: &PgPool,
    app_data_dir: &Path,
    session_token: &str,
    source_path: &str,
) -> Result<JsonValue, AppError> {
    if source_path.is_empty() || source_path.len() > 4096 {
        return Err(AppError::ValidationError {
            diagnostic: "logo source path is empty or too long".to_string(),
        });
    }

    let source = Path::new(source_path);
    let metadata = fs::symlink_metadata(source).map_err(|_| AppError::LogoNotAFile {
        diagnostic: "LOGO_NOT_A_FILE: source path does not exist".to_string(),
    })?;
    if is_symlink_or_reparse(&metadata) || !metadata.is_file() {
        return Err(AppError::LogoNotAFile {
            diagnostic: "LOGO_NOT_A_FILE: source path is not a regular file".to_string(),
        });
    }
    if metadata.len() > MAX_LOGO_BYTES {
        return Err(AppError::LogoTooLarge {
            diagnostic: format!("LOGO_TOO_LARGE: {} bytes", metadata.len()),
        });
    }

    let extension = source
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .filter(|ext| SUPPORTED_LOGO_EXTENSIONS.contains(&ext.as_str()))
        .ok_or_else(|| AppError::LogoUnsupportedType {
            diagnostic: "LOGO_UNSUPPORTED_TYPE: unsupported extension".to_string(),
        })?;

    let bytes = fs::read(source).map_err(|_| AppError::LogoNotAFile {
        diagnostic: "LOGO_NOT_A_FILE: source file could not be read".to_string(),
    })?;
    if bytes.len() as u64 > MAX_LOGO_BYTES {
        return Err(AppError::LogoTooLarge {
            diagnostic: format!("LOGO_TOO_LARGE: {} bytes", bytes.len()),
        });
    }
    if !magic_bytes_match(&extension, &bytes) {
        return Err(AppError::LogoUnsupportedType {
            diagnostic: "LOGO_UNSUPPORTED_TYPE: magic bytes do not match the extension".to_string(),
        });
    }

    let assets_dir = app_data_dir.join(COMPANY_ASSETS_DIR);
    fs::create_dir_all(&assets_dir).map_err(|_| {
        AppError::internal("could not create the company-assets directory".to_string())
    })?;

    let file_name = format!("logo.{extension}");
    let target = assets_dir.join(&file_name);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let tmp_path = assets_dir.join(format!("logo.{extension}.tmp-{nanos}"));

    write_atomically(&tmp_path, &target, &bytes)?;
    remove_other_logo_files(&assets_dir, &file_name);

    let result = query_scalar("SELECT core.set_printing_logo($1, $2)")
        .bind(session_token)
        .bind(&file_name)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    Ok(result)
}

fn write_atomically(tmp_path: &Path, target: &Path, bytes: &[u8]) -> Result<(), AppError> {
    fs::write(tmp_path, bytes)
        .map_err(|_| AppError::internal("could not write the logo file".to_string()))?;

    let sync_result = fs::File::open(tmp_path).and_then(|file| file.sync_all());
    if sync_result.is_err() {
        let _ = fs::remove_file(tmp_path);
        return Err(AppError::internal(
            "could not flush the logo file to disk".to_string(),
        ));
    }

    fs::rename(tmp_path, target).map_err(|_| {
        let _ = fs::remove_file(tmp_path);
        AppError::internal("could not finalize the logo file".to_string())
    })
}

fn remove_other_logo_files(assets_dir: &Path, keep_file_name: &str) {
    let Ok(entries) = fs::read_dir(assets_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if name == keep_file_name {
            continue;
        }
        if name.starts_with("logo.") && !name.contains(".tmp-") {
            let _ = fs::remove_file(&path);
        }
    }
}

fn magic_bytes_match(extension: &str, bytes: &[u8]) -> bool {
    match extension {
        "png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "jpg" | "jpeg" => bytes.starts_with(b"\xFF\xD8\xFF"),
        "webp" => bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP",
        _ => false,
    }
}

/// Reads the recorded logo file from `company-assets/` and returns it as a
/// `data:` URL so both the print HTML and the settings preview can embed it
/// without a `file://` URL (WebView2 blocks those inside the print iframe).
/// Never fails: a missing/oversized/unreadable file simply yields `None`, so
/// printing and Settings keep working without a logo.
pub(crate) async fn get_company_logo(
    pool: &PgPool,
    app_data_dir: &Path,
    session_token: &str,
) -> Result<Option<String>, AppError> {
    let settings: JsonValue = query_scalar("SELECT core.get_printing_settings($1)")
        .bind(session_token)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    let Some(file_name) = settings
        .get("logo_file_name")
        .and_then(JsonValue::as_str)
        .filter(|name| !name.is_empty())
    else {
        return Ok(None);
    };

    let path: PathBuf = app_data_dir.join(COMPANY_ASSETS_DIR).join(file_name);
    let Ok(metadata) = fs::symlink_metadata(&path) else {
        return Ok(None);
    };
    if is_symlink_or_reparse(&metadata) || !metadata.is_file() || metadata.len() > MAX_LOGO_BYTES {
        return Ok(None);
    }

    let Ok(bytes) = fs::read(&path) else {
        return Ok(None);
    };

    let mime = match path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        _ => return Ok(None),
    };

    Ok(Some(format!(
        "data:{mime};base64,{}",
        STANDARD.encode(bytes)
    )))
}

/// Clears the recorded logo and deletes every `company-assets/logo.*` file.
/// Deletion errors are ignored (best effort) once the database record is
/// already cleared.
pub(crate) async fn clear_company_logo(
    pool: &PgPool,
    app_data_dir: &Path,
    session_token: &str,
) -> Result<JsonValue, AppError> {
    let result: JsonValue = query_scalar("SELECT core.set_printing_logo($1, NULL)")
        .bind(session_token)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    let assets_dir = app_data_dir.join(COMPANY_ASSETS_DIR);
    if let Ok(entries) = fs::read_dir(&assets_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if name.starts_with("logo.") {
                    let _ = fs::remove_file(&path);
                }
            }
        }
    }

    Ok(result)
}

#[cfg(windows)]
fn is_symlink_or_reparse(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    metadata.file_type().is_symlink()
        || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
fn is_symlink_or_reparse(metadata: &fs::Metadata) -> bool {
    metadata.file_type().is_symlink()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static SCRATCH_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn scratch_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "stockiha-ws-m-1-logo-{}-{}",
            std::process::id(),
            SCRATCH_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    const PNG_MAGIC: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    const JPEG_MAGIC: [u8; 3] = [0xFF, 0xD8, 0xFF];

    #[test]
    fn magic_bytes_accept_matching_png() {
        let mut bytes = PNG_MAGIC.to_vec();
        bytes.extend_from_slice(b"rest-of-file");
        assert!(magic_bytes_match("png", &bytes));
    }

    #[test]
    fn magic_bytes_reject_mismatched_extension() {
        let mut bytes = JPEG_MAGIC.to_vec();
        bytes.extend_from_slice(b"rest-of-file");
        assert!(!magic_bytes_match("png", &bytes));
    }

    #[test]
    fn magic_bytes_accept_matching_webp() {
        let mut bytes = b"RIFF".to_vec();
        bytes.extend_from_slice(&[0, 0, 0, 0]);
        bytes.extend_from_slice(b"WEBP");
        assert!(magic_bytes_match("webp", &bytes));
    }

    #[test]
    fn magic_bytes_reject_truncated_webp() {
        assert!(!magic_bytes_match("webp", b"RIFF"));
    }

    #[test]
    fn magic_bytes_reject_unknown_extension() {
        assert!(!magic_bytes_match("gif", &PNG_MAGIC));
    }

    #[tokio::test]
    async fn set_company_logo_rejects_missing_source_file() {
        let dir = scratch_dir();
        let missing = dir.join("does-not-exist.png");
        let err = set_company_logo(
            &sqlx::PgPool::connect_lazy("postgres://invalid/invalid").unwrap(),
            &dir,
            "irrelevant-session-token",
            missing.to_str().unwrap(),
        )
        .await
        .expect_err("missing source file must be rejected before any database call");
        assert!(matches!(err, AppError::LogoNotAFile { .. }));
    }

    #[tokio::test]
    async fn set_company_logo_rejects_oversized_file() {
        let dir = scratch_dir();
        let source = dir.join("big.png");
        let mut bytes = PNG_MAGIC.to_vec();
        bytes.extend(std::iter::repeat_n(0u8, (MAX_LOGO_BYTES as usize) + 1));
        fs::write(&source, &bytes).unwrap();

        let err = set_company_logo(
            &sqlx::PgPool::connect_lazy("postgres://invalid/invalid").unwrap(),
            &dir,
            "irrelevant-session-token",
            source.to_str().unwrap(),
        )
        .await
        .expect_err("oversized source file must be rejected before any database call");
        assert!(matches!(err, AppError::LogoTooLarge { .. }));
    }

    #[tokio::test]
    async fn set_company_logo_rejects_unsupported_extension() {
        let dir = scratch_dir();
        let source = dir.join("logo.gif");
        fs::write(&source, b"GIF89a").unwrap();

        let err = set_company_logo(
            &sqlx::PgPool::connect_lazy("postgres://invalid/invalid").unwrap(),
            &dir,
            "irrelevant-session-token",
            source.to_str().unwrap(),
        )
        .await
        .expect_err("unsupported extension must be rejected before any database call");
        assert!(matches!(err, AppError::LogoUnsupportedType { .. }));
    }

    #[tokio::test]
    async fn set_company_logo_rejects_extension_magic_byte_mismatch() {
        let dir = scratch_dir();
        let source = dir.join("fake.png");
        fs::write(&source, b"not-actually-a-png").unwrap();

        let err = set_company_logo(
            &sqlx::PgPool::connect_lazy("postgres://invalid/invalid").unwrap(),
            &dir,
            "irrelevant-session-token",
            source.to_str().unwrap(),
        )
        .await
        .expect_err("magic-byte mismatch must be rejected before any database call");
        assert!(matches!(err, AppError::LogoUnsupportedType { .. }));
    }
}
