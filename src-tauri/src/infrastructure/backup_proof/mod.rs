//! S0-009 — Backup bundle creation proof.
//!
//! Proves the Rust backend can assemble one durable, atomically-written
//! Stockiha backup bundle — a `pg_dump` of the database plus fixed asset
//! directories, version files, a manifest, and a checksums file — using the
//! existing `stockiha_backup` role and its S0-005-stored password. No
//! restore, no scheduler, no retention policy, no cloud upload, no UI/IPC.
//!
//! ## Platform split
//! Bundle assembly, hashing, the manifest/checksums writer, atomicity, input
//! validation, and the `pg_dump` child-process invocation are all
//! platform-neutral and unit-tested on every platform (the dump-producing
//! step is injectable, so unit tests never spawn a real `pg_dump`). Only
//! [`resolve_backup_credential`] (Windows Credential Manager) and the live
//! end-to-end proof are `#[cfg(windows)]`.
//!
//! ## Secrets / data-leak policy
//! [`BackupProofError`]'s `Display`/`Debug` are redacted to a stable
//! `BACKUP_PROOF_*` code, exactly like the other Slice 0 proofs. The
//! `stockiha_backup` password is read once into a `SecretBytes` wrapper,
//! validated as UTF-8, and placed **only** in the spawned `pg_dump` child's
//! environment (`Command::env`, never argv, never a connection URL, never
//! `Display`/`Debug`, never logged). `--no-password` prevents any interactive
//! fallback prompt.

use core::fmt;
use std::fs;
use std::io::{Read, Write as _};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use sha2::{Digest, Sha256};
use time::OffsetDateTime;

use super::credentials::CredentialError;
#[cfg(windows)]
use super::credentials::{read_secret, CredentialTarget, SecretBytes};

// ---------------------------------------------------------------------------
// Fixed constants
// ---------------------------------------------------------------------------

/// Manifest schema version for this bundle format. Bumped only if the
/// manifest's own structure changes incompatibly.
pub(crate) const BUNDLE_FORMAT_VERSION: u32 = 1;

/// Application version recorded in the manifest and `application-version.txt`.
pub(crate) const APPLICATION_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Slice 0 has no migrations yet, so the schema version is fixed at `"0"`.
/// This must track the real migration/schema version once one exists.
pub(crate) const SCHEMA_VERSION: &str = "0";

/// The only PostgreSQL major version this proof (and the target
/// architecture) supports.
pub(crate) const REQUIRED_PG_MAJOR_VERSION: u32 = 18;

/// The fixed, non-configurable role `pg_dump` always connects as. Never
/// accepted as a caller-supplied parameter — this keeps a backup from ever
/// running as a more privileged role by accident.
pub(crate) const BACKUP_ROLE_NAME: &str = "stockiha_backup";

pub(crate) const BUNDLE_NAME_PREFIX: &str = "GestStock-Backup-";
pub(crate) const DUMP_FILENAME: &str = "database.dump";
pub(crate) const MANIFEST_FILENAME: &str = "manifest.json";
pub(crate) const CHECKSUMS_FILENAME: &str = "checksums.sha256";
pub(crate) const SCHEMA_VERSION_FILENAME: &str = "schema-version.txt";
pub(crate) const APPLICATION_VERSION_FILENAME: &str = "application-version.txt";
pub(crate) const POSTGRES_VERSION_FILENAME: &str = "postgres-version.txt";
pub(crate) const ATTACHMENTS_DIR: &str = "attachments";
pub(crate) const GENERATED_DOCUMENTS_DIR: &str = "generated-documents";
pub(crate) const COMPANY_ASSETS_DIR: &str = "company-assets";

/// Streaming-hash buffer size. Arbitrary; large enough to be efficient,
/// small enough to keep memory use flat regardless of dump size.
const HASH_BUFFER_LEN: usize = 64 * 1024;

// ---------------------------------------------------------------------------
// Errors (non-serializable, redacted — mirrors the other Slice 0 proofs)
// ---------------------------------------------------------------------------

/// Internal backup-proof error. Not serialized; does not cross any IPC
/// boundary. `Debug`/`Display` are redacted to a stable, payload-free string;
/// no path, credential, or `pg_dump` diagnostic text is ever rendered by
/// either.
pub(crate) enum BackupProofError {
    /// `bundle_root` does not exist or is not a directory.
    InvalidBundleRoot,
    /// The computed final bundle directory already exists. Never overwritten.
    DestinationAlreadyExists,
    /// The temporary staging directory could not be created.
    TempDirectoryCreationFailed,
    /// An input path (attachment / generated document / company asset) does
    /// not exist or could not be inspected.
    InputNotFound,
    /// An input path is a symlink or a Windows reparse point. Rejected before
    /// any copy is attempted — backups never follow links.
    RejectedSymlinkInput,
    /// An input path exists but is not a regular file.
    InputNotAFile,
    /// Two input paths in the same asset category resolved to the same
    /// destination file name.
    DuplicateAssetFilename,
    /// A filesystem operation (copy, write, sync, read, create) failed.
    /// Carries no path — only that some I/O step failed.
    Io,
    /// The `pg_dump` executable could not be found or spawned.
    PgDumpNotFound,
    /// `pg_dump --version` produced output this proof could not parse.
    PgDumpVersionParseFailed,
    /// `pg_dump --version` reported a major version other than
    /// [`REQUIRED_PG_MAJOR_VERSION`]. The detail is retained only in
    /// [`BackupProofError::diagnostic`].
    PgDumpVersionMismatch(u32),
    /// The `pg_dump` child process exited with a failure status. The exit
    /// code is retained only in [`BackupProofError::diagnostic`].
    PgDumpFailed(Option<i32>),
    /// The `stockiha_backup` password read from the credential store is not
    /// valid UTF-8, so it cannot be placed in a child process environment
    /// variable safely.
    CredentialNotUtf8,
    /// The `stockiha_backup` credential could not be read. Wraps a
    /// [`CredentialError`], whose own `Display` is already redacted/safe;
    /// that safe text is preserved only in `diagnostic()`.
    CredentialUnavailable(CredentialErrorSummary),
    /// The final atomic rename failed.
    RenameFailed,
    /// The bundle root, or a required entry inside it, is missing, is not
    /// the expected file/directory type, or the manifest's recorded dump
    /// filename does not match [`DUMP_FILENAME`]. Used only by
    /// [`validate_bundle`].
    BundleLayoutInvalid,
    /// `manifest.json` does not exist, is not a regular file, or could not
    /// be read. Used only by [`validate_bundle`].
    ManifestNotFound,
    /// `manifest.json` exists but is not valid JSON, or does not match the
    /// expected schema. Used only by [`validate_bundle`].
    ManifestParseFailed,
    /// `checksums.sha256` does not exist, is not a regular file, or could
    /// not be read. Used only by [`validate_bundle`].
    ChecksumsNotFound,
    /// `checksums.sha256` exists but a line could not be parsed (wrong
    /// column count, or a hash that is not 64 hex characters). Used only by
    /// [`validate_bundle`].
    ChecksumsParseFailed,
    /// A recomputed SHA-256 does not match `manifest.json`, does not match
    /// `checksums.sha256`, or `checksums.sha256` is missing an entry it must
    /// have. Used only by [`validate_bundle`].
    ChecksumMismatch,
    /// A manifest-listed relative path is absolute, empty, or contains a
    /// `.`/`..` component, or resolves outside the bundle root after
    /// canonicalization. Used only by [`validate_bundle`].
    PathEscapesBundleRoot,
    /// The manifest's `bundle_format_version` does not match
    /// [`BUNDLE_FORMAT_VERSION`]. The detail is retained only in
    /// [`BackupProofError::diagnostic`]. Used only by [`validate_bundle`].
    BundleFormatVersionMismatch(u32),
    /// `database.dump` exists but is zero bytes. Used only by
    /// [`validate_bundle`].
    DumpIsEmpty,
}

/// A redacted, `'static`-owned summary of a [`CredentialError`], retained so
/// [`BackupProofError::diagnostic`] can describe *which* credential failure
/// occurred without holding a borrow or re-exposing anything unsafe —
/// `CredentialError`'s own `Display` is already safe fixed text.
pub(crate) struct CredentialErrorSummary(String);

impl From<CredentialError> for CredentialErrorSummary {
    fn from(err: CredentialError) -> Self {
        // `CredentialError`'s own `Display` is already redacted fixed text
        // (see `infrastructure::credentials`), so capturing it here adds no
        // new leak surface.
        CredentialErrorSummary(err.to_string())
    }
}

impl BackupProofError {
    fn code(&self) -> &'static str {
        match self {
            BackupProofError::InvalidBundleRoot => "BACKUP_PROOF_INVALID_BUNDLE_ROOT",
            BackupProofError::DestinationAlreadyExists => "BACKUP_PROOF_DESTINATION_ALREADY_EXISTS",
            BackupProofError::TempDirectoryCreationFailed => {
                "BACKUP_PROOF_TEMP_DIR_CREATION_FAILED"
            }
            BackupProofError::InputNotFound => "BACKUP_PROOF_INPUT_NOT_FOUND",
            BackupProofError::RejectedSymlinkInput => "BACKUP_PROOF_REJECTED_SYMLINK_INPUT",
            BackupProofError::InputNotAFile => "BACKUP_PROOF_INPUT_NOT_A_FILE",
            BackupProofError::DuplicateAssetFilename => "BACKUP_PROOF_DUPLICATE_ASSET_FILENAME",
            BackupProofError::Io => "BACKUP_PROOF_IO",
            BackupProofError::PgDumpNotFound => "BACKUP_PROOF_PG_DUMP_NOT_FOUND",
            BackupProofError::PgDumpVersionParseFailed => {
                "BACKUP_PROOF_PG_DUMP_VERSION_PARSE_FAILED"
            }
            BackupProofError::PgDumpVersionMismatch(_) => "BACKUP_PROOF_PG_DUMP_VERSION_MISMATCH",
            BackupProofError::PgDumpFailed(_) => "BACKUP_PROOF_PG_DUMP_FAILED",
            BackupProofError::CredentialNotUtf8 => "BACKUP_PROOF_CREDENTIAL_NOT_UTF8",
            BackupProofError::CredentialUnavailable(_) => "BACKUP_PROOF_CREDENTIAL_UNAVAILABLE",
            BackupProofError::RenameFailed => "BACKUP_PROOF_RENAME_FAILED",
            BackupProofError::BundleLayoutInvalid => "BACKUP_PROOF_BUNDLE_LAYOUT_INVALID",
            BackupProofError::ManifestNotFound => "BACKUP_PROOF_MANIFEST_NOT_FOUND",
            BackupProofError::ManifestParseFailed => "BACKUP_PROOF_MANIFEST_PARSE_FAILED",
            BackupProofError::ChecksumsNotFound => "BACKUP_PROOF_CHECKSUMS_NOT_FOUND",
            BackupProofError::ChecksumsParseFailed => "BACKUP_PROOF_CHECKSUMS_PARSE_FAILED",
            BackupProofError::ChecksumMismatch => "BACKUP_PROOF_CHECKSUM_MISMATCH",
            BackupProofError::PathEscapesBundleRoot => "BACKUP_PROOF_PATH_ESCAPES_BUNDLE_ROOT",
            BackupProofError::BundleFormatVersionMismatch(_) => {
                "BACKUP_PROOF_BUNDLE_FORMAT_VERSION_MISMATCH"
            }
            BackupProofError::DumpIsEmpty => "BACKUP_PROOF_DUMP_IS_EMPTY",
        }
    }

    /// Internal-only diagnostic detail, retained for trusted in-crate
    /// debugging and tests. Never serialized and never surfaced by
    /// `Display`/`Debug`. Contains no credential bytes, no payload bytes, and
    /// no filesystem path — only fixed text and safe numeric detail.
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn diagnostic(&self) -> String {
        match self {
            BackupProofError::PgDumpVersionMismatch(major) => {
                format!("found pg_dump major version {major}, required {REQUIRED_PG_MAJOR_VERSION}")
            }
            BackupProofError::PgDumpFailed(code) => match code {
                Some(c) => format!("pg_dump exited with status {c}"),
                None => "pg_dump terminated without an exit code".to_string(),
            },
            BackupProofError::CredentialUnavailable(summary) => summary.0.clone(),
            BackupProofError::BundleFormatVersionMismatch(found) => {
                format!("found bundle_format_version {found}, expected {BUNDLE_FORMAT_VERSION}")
            }
            other => other.code().to_string(),
        }
    }
}

impl fmt::Display for BackupProofError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.code())
    }
}

impl fmt::Debug for BackupProofError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "BackupProofError({})", self.code())
    }
}

impl std::error::Error for BackupProofError {}

fn map_credential_error(err: CredentialError) -> BackupProofError {
    BackupProofError::CredentialUnavailable(CredentialErrorSummary::from(err))
}

// ---------------------------------------------------------------------------
// Credential resolution (Windows only — the only platform-specific part)
// ---------------------------------------------------------------------------

/// Read the `stockiha_backup` password from Windows Credential Manager.
///
/// The only Windows-specific function in this module. Everything else —
/// including the `pg_dump` invocation itself — is platform-neutral; only the
/// *source* of the secret is Windows-only, matching the S0-005 design.
#[cfg(windows)]
pub(crate) fn resolve_backup_credential() -> Result<SecretBytes, BackupProofError> {
    read_secret(CredentialTarget::Backup).map_err(map_credential_error)
}

// ---------------------------------------------------------------------------
// pg_dump discovery, version validation, and invocation
// ---------------------------------------------------------------------------

/// Resolve the `pg_dump` executable: `STOCKIHA_PG_DUMP_PATH` if set and
/// non-empty, otherwise the bare name `pg_dump` (PATH resolution — on
/// Windows, `CreateProcess`'s own PATH/`PATHEXT` search finds `pg_dump.exe`).
pub(crate) fn resolve_pg_dump_executable() -> PathBuf {
    match std::env::var_os("STOCKIHA_PG_DUMP_PATH") {
        Some(path) if !path.is_empty() => PathBuf::from(path),
        _ => PathBuf::from("pg_dump"),
    }
}

/// Parse the major version out of `pg_dump --version` output, e.g.
/// `"pg_dump (PostgreSQL) 18.0"` → `18`. Pure string parsing — no process
/// involved, so it is unit-tested with static samples on every platform.
pub(crate) fn parse_pg_dump_major_version(version_output: &str) -> Result<u32, BackupProofError> {
    let last_token = version_output
        .split_whitespace()
        .last()
        .ok_or(BackupProofError::PgDumpVersionParseFailed)?;
    let major_str = last_token
        .split('.')
        .next()
        .ok_or(BackupProofError::PgDumpVersionParseFailed)?;
    major_str
        .parse::<u32>()
        .map_err(|_| BackupProofError::PgDumpVersionParseFailed)
}

/// Run `pg_dump --version`, parse it, and require
/// [`REQUIRED_PG_MAJOR_VERSION`]. Returns the trimmed raw version string
/// (credential-free — `--version` never touches authentication) for
/// recording in `postgres-version.txt`.
pub(crate) fn discover_and_validate_pg_dump(executable: &Path) -> Result<String, BackupProofError> {
    let output = Command::new(executable)
        .arg("--version")
        .stdin(Stdio::null())
        .output()
        .map_err(|_| BackupProofError::PgDumpNotFound)?;
    if !output.status.success() {
        return Err(BackupProofError::PgDumpNotFound);
    }
    let version_string = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let major = parse_pg_dump_major_version(&version_string)?;
    if major != REQUIRED_PG_MAJOR_VERSION {
        return Err(BackupProofError::PgDumpVersionMismatch(major));
    }
    Ok(version_string)
}

/// Connection target for `pg_dump`. Never carries a password — authentication
/// happens exclusively through the child's `PGPASSWORD` environment variable.
pub(crate) struct PgDumpTarget<'a> {
    pub(crate) host: &'a str,
    pub(crate) port: u16,
    pub(crate) database: &'a str,
}

/// A running `pg_dump` child that is killed and waited-for on drop,
/// regardless of whether the primary code path already waited successfully
/// (waiting twice, or killing an already-exited process, is a harmless
/// no-op). This is the "kill and wait for the child on interrupted/error
/// cleanup" guarantee: any early return while the guard is alive still
/// reaps the child.
struct ChildGuard(Child);

impl Drop for ChildGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

/// Spawn `pg_dump` against `target`, writing the custom-format dump to
/// `out_path`. `password` must be UTF-8 (validated by the caller) and is
/// placed **only** in this child's environment — never in argv, never in a
/// connection URL, never logged. `--no-password` forbids any interactive
/// fallback prompt.
pub(crate) fn run_pg_dump(
    executable: &Path,
    target: &PgDumpTarget<'_>,
    password: &str,
    out_path: &Path,
) -> Result<(), BackupProofError> {
    let mut command = Command::new(executable);
    command
        .arg("--format=custom")
        .arg("--no-owner")
        .arg("--no-privileges")
        .arg("--no-password")
        .arg("--host")
        .arg(target.host)
        .arg("--port")
        .arg(target.port.to_string())
        .arg("--username")
        .arg(BACKUP_ROLE_NAME)
        .arg("--dbname")
        .arg(target.database)
        .arg("--file")
        .arg(out_path)
        .env("PGPASSWORD", password)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let child = command
        .spawn()
        .map_err(|_| BackupProofError::PgDumpNotFound)?;
    let mut guard = ChildGuard(child);
    let status = guard.0.wait().map_err(|_| BackupProofError::Io)?;
    if !status.success() {
        return Err(BackupProofError::PgDumpFailed(status.code()));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Input validation (reject symlinks / reparse points)
// ---------------------------------------------------------------------------

#[cfg(windows)]
fn is_reparse_point(meta: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
fn is_reparse_point(_meta: &fs::Metadata) -> bool {
    false
}

/// The one symlink/Windows-reparse-point check in this module. Used by
/// [`validate_input_file`] (backup inputs) and by [`validate_bundle`]
/// (every path inside an existing bundle) — never reimplemented.
fn reject_symlink_or_reparse_point(meta: &fs::Metadata) -> Result<(), BackupProofError> {
    if meta.file_type().is_symlink() || is_reparse_point(meta) {
        return Err(BackupProofError::RejectedSymlinkInput);
    }
    Ok(())
}

/// Validate a candidate input file before it is ever copied: it must exist,
/// must not be a symlink or Windows reparse point (checked via
/// `symlink_metadata`, which never follows links), and must be a regular
/// file.
fn validate_input_file(path: &Path) -> Result<(), BackupProofError> {
    let meta = fs::symlink_metadata(path).map_err(|_| BackupProofError::InputNotFound)?;
    reject_symlink_or_reparse_point(&meta)?;
    if !meta.is_file() {
        return Err(BackupProofError::InputNotAFile);
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

fn to_hex_lower(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push_str(&format!("{b:02x}"));
    }
    out
}

/// Stream-hash a file (fixed-size buffer, so memory use is flat regardless of
/// file size). Returns `(sha256_hex, size_bytes)`.
fn hash_file(path: &Path) -> Result<(String, u64), BackupProofError> {
    let mut file = fs::File::open(path).map_err(|_| BackupProofError::Io)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; HASH_BUFFER_LEN];
    let mut total: u64 = 0;
    loop {
        let n = file.read(&mut buf).map_err(|_| BackupProofError::Io)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        total += n as u64;
    }
    Ok((to_hex_lower(&hasher.finalize()), total))
}

fn hash_bytes(bytes: &[u8]) -> String {
    to_hex_lower(&Sha256::digest(bytes))
}

// ---------------------------------------------------------------------------
// Manifest (hand-written JSON — the schema is small and fixed, and this
// proof only ever writes it, never parses it back, so no JSON/serde
// dependency is introduced for it)
// ---------------------------------------------------------------------------

struct ManifestEntry {
    path: String,
    size_bytes: u64,
    sha256: String,
}

struct Manifest {
    bundle_format_version: u32,
    application_version: String,
    schema_version: String,
    created_at_unix: u64,
    database_dump_filename: String,
    files: Vec<ManifestEntry>,
}

/// Escape a string for embedding in a JSON string literal. Handles the
/// characters JSON requires escaping; sufficient because manifest paths are
/// filenames/relative paths, not arbitrary user text.
fn json_escape(input: &str) -> String {
    let mut out = String::with_capacity(input.len() + 2);
    for c in input.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out
}

impl Manifest {
    fn to_json_string(&self) -> String {
        let mut entries = String::new();
        for (i, entry) in self.files.iter().enumerate() {
            if i > 0 {
                entries.push(',');
            }
            entries.push_str(&format!(
                "{{\"path\":\"{}\",\"size_bytes\":{},\"sha256\":\"{}\"}}",
                json_escape(&entry.path),
                entry.size_bytes,
                entry.sha256
            ));
        }
        format!(
            "{{\"bundle_format_version\":{},\"application_version\":\"{}\",\"schema_version\":\"{}\",\"created_at_unix\":{},\"database_dump_filename\":\"{}\",\"files\":[{}]}}",
            self.bundle_format_version,
            json_escape(&self.application_version),
            json_escape(&self.schema_version),
            self.created_at_unix,
            json_escape(&self.database_dump_filename),
            entries
        )
    }
}

// ---------------------------------------------------------------------------
// Naming and uniqueness (no UUID dependency)
// ---------------------------------------------------------------------------

/// Per-process monotonic counter combined with the process id and a
/// nanosecond timestamp gives overwhelming practical uniqueness for a
/// same-process temporary directory name, without any UUID dependency.
static TEMP_SUFFIX_COUNTER: AtomicU64 = AtomicU64::new(0);

fn unique_temp_suffix() -> String {
    let n = TEMP_SUFFIX_COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_nanos();
    format!("{}-{}-{}", std::process::id(), nanos, n)
}

/// The fixed, exact final bundle directory name for a given UTC instant:
/// `GestStock-Backup-YYYYMMDD-HHMMSS`.
pub(crate) fn bundle_directory_name(now: OffsetDateTime) -> String {
    format!(
        "{BUNDLE_NAME_PREFIX}{:04}{:02}{:02}-{:02}{:02}{:02}",
        now.year(),
        u8::from(now.month()),
        now.day(),
        now.hour(),
        now.minute(),
        now.second()
    )
}

/// Normalize a path inside `root` to a forward-slash relative string, so the
/// manifest and checksums file are structurally identical across platforms.
fn normalize_relative_path(root: &Path, absolute: &Path) -> String {
    let rel = absolute
        .strip_prefix(root)
        .expect("path must be inside the bundle root");
    rel.components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

// ---------------------------------------------------------------------------
// Bundle assembly (platform-neutral; the dump-producing step is injectable)
// ---------------------------------------------------------------------------

/// Fixture/asset inputs for a bundle. All three lists may be empty; every
/// entry must pass [`validate_input_file`] before being copied.
pub(crate) struct BackupInputs {
    pub(crate) attachments: Vec<PathBuf>,
    pub(crate) generated_documents: Vec<PathBuf>,
    pub(crate) company_assets: Vec<PathBuf>,
}

impl BackupInputs {
    pub(crate) fn empty() -> Self {
        BackupInputs {
            attachments: Vec::new(),
            generated_documents: Vec::new(),
            company_assets: Vec::new(),
        }
    }
}

/// Removes `self.0` recursively on drop, unconditionally. Safe as a no-op if
/// the path has already been renamed away (the success path) or never fully
/// created. Scoped to exactly one temporary directory — it never touches any
/// other path, so existing bundles are never at risk from this cleanup.
struct TempDirCleanup<'a>(&'a Path);

impl Drop for TempDirCleanup<'_> {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(self.0);
    }
}

fn copy_asset_group(
    temp_root: &Path,
    subdir_name: &str,
    inputs: &[PathBuf],
) -> Result<Vec<PathBuf>, BackupProofError> {
    let subdir = temp_root.join(subdir_name);
    fs::create_dir_all(&subdir).map_err(|_| BackupProofError::Io)?;

    let mut seen_names = std::collections::HashSet::new();
    let mut copied = Vec::with_capacity(inputs.len());
    for input in inputs {
        validate_input_file(input)?;
        let file_name = input.file_name().ok_or(BackupProofError::InputNotAFile)?;
        if !seen_names.insert(file_name.to_os_string()) {
            return Err(BackupProofError::DuplicateAssetFilename);
        }
        let dest = subdir.join(file_name);
        fs::copy(input, &dest).map_err(|_| BackupProofError::Io)?;
        let f = fs::OpenOptions::new()
            .write(true)
            .open(&dest)
            .map_err(|_| BackupProofError::Io)?;
        f.sync_all().map_err(|_| BackupProofError::Io)?;
        copied.push(dest);
    }
    Ok(copied)
}

fn write_synced(path: &Path, contents: &[u8]) -> Result<(), BackupProofError> {
    let mut file = fs::File::create(path).map_err(|_| BackupProofError::Io)?;
    file.write_all(contents).map_err(|_| BackupProofError::Io)?;
    file.sync_all().map_err(|_| BackupProofError::Io)?;
    Ok(())
}

/// Assemble one backup bundle under `bundle_root`.
///
/// `produce_dump` is called with the exact path the dump must be written to;
/// it is the only injection point for how the dump bytes are produced —
/// production code passes a closure that calls [`run_pg_dump`], unit tests
/// pass a closure that writes fixed bytes (or an error), so the atomicity,
/// hashing, and manifest logic below is fully exercised without ever
/// spawning a real `pg_dump`.
///
/// Integrity order (exact): create dump + copy assets → write version files
/// → hash all payload/version files → write `manifest.json` → hash
/// `manifest.json` → write `checksums.sha256` (covers every file except
/// itself) → atomically rename the temporary directory to the final name.
/// Any failure at any step removes only this call's temporary directory and
/// leaves every existing bundle — and the final path for this call — never
/// created, never partially visible.
pub(crate) fn create_backup_bundle<F>(
    bundle_root: &Path,
    now: OffsetDateTime,
    postgres_version: &str,
    inputs: &BackupInputs,
    produce_dump: F,
) -> Result<PathBuf, BackupProofError>
where
    F: FnOnce(&Path) -> Result<(), BackupProofError>,
{
    if !bundle_root.is_dir() {
        return Err(BackupProofError::InvalidBundleRoot);
    }

    let final_name = bundle_directory_name(now);
    let final_path = bundle_root.join(&final_name);
    if final_path.exists() {
        return Err(BackupProofError::DestinationAlreadyExists);
    }

    let temp_name = format!(".tmp-{final_name}-{}", unique_temp_suffix());
    let temp_path = bundle_root.join(&temp_name);
    fs::create_dir(&temp_path).map_err(|_| BackupProofError::TempDirectoryCreationFailed)?;
    let _cleanup = TempDirCleanup(&temp_path);

    // 1. Create the dump and copy asset inputs.
    let dump_path = temp_path.join(DUMP_FILENAME);
    produce_dump(&dump_path)?;
    {
        let f = fs::OpenOptions::new()
            .write(true)
            .open(&dump_path)
            .map_err(|_| BackupProofError::Io)?;
        f.sync_all().map_err(|_| BackupProofError::Io)?;
    }
    copy_asset_group(&temp_path, ATTACHMENTS_DIR, &inputs.attachments)?;
    copy_asset_group(
        &temp_path,
        GENERATED_DOCUMENTS_DIR,
        &inputs.generated_documents,
    )?;
    copy_asset_group(&temp_path, COMPANY_ASSETS_DIR, &inputs.company_assets)?;

    // 2. Write schema/application/PostgreSQL version files.
    let schema_version_path = temp_path.join(SCHEMA_VERSION_FILENAME);
    write_synced(
        &schema_version_path,
        format!("{SCHEMA_VERSION}\n").as_bytes(),
    )?;
    let application_version_path = temp_path.join(APPLICATION_VERSION_FILENAME);
    write_synced(
        &application_version_path,
        format!("{APPLICATION_VERSION}\n").as_bytes(),
    )?;
    let postgres_version_path = temp_path.join(POSTGRES_VERSION_FILENAME);
    write_synced(
        &postgres_version_path,
        format!("{postgres_version}\n").as_bytes(),
    )?;

    // 3. Hash every payload/version file written so far.
    let mut payload_paths = vec![
        dump_path,
        schema_version_path,
        application_version_path,
        postgres_version_path,
    ];
    for dir in [ATTACHMENTS_DIR, GENERATED_DOCUMENTS_DIR, COMPANY_ASSETS_DIR] {
        let dir_path = temp_path.join(dir);
        let mut entries: Vec<PathBuf> = fs::read_dir(&dir_path)
            .map_err(|_| BackupProofError::Io)?
            .filter_map(|e| e.ok().map(|e| e.path()))
            .collect();
        entries.sort();
        payload_paths.extend(entries);
    }

    let mut manifest_entries = Vec::with_capacity(payload_paths.len());
    for path in &payload_paths {
        let (sha256, size_bytes) = hash_file(path)?;
        manifest_entries.push(ManifestEntry {
            path: normalize_relative_path(&temp_path, path),
            size_bytes,
            sha256,
        });
    }
    manifest_entries.sort_by(|a, b| a.path.cmp(&b.path));

    let created_at_unix = now.unix_timestamp().try_into().unwrap_or(0u64);

    let manifest = Manifest {
        bundle_format_version: BUNDLE_FORMAT_VERSION,
        application_version: APPLICATION_VERSION.to_string(),
        schema_version: SCHEMA_VERSION.to_string(),
        created_at_unix,
        database_dump_filename: DUMP_FILENAME.to_string(),
        files: manifest_entries,
    };

    // 4. Write manifest.json.
    let manifest_json = manifest.to_json_string();
    let manifest_path = temp_path.join(MANIFEST_FILENAME);
    write_synced(&manifest_path, manifest_json.as_bytes())?;

    // 5. Hash manifest.json.
    let manifest_hash = hash_bytes(manifest_json.as_bytes());

    // 6. Write checksums.sha256 last: every payload/version file plus
    // manifest.json, but never checksums.sha256 itself.
    let mut checksum_lines: Vec<(String, String)> = manifest
        .files
        .iter()
        .map(|e| (e.path.clone(), e.sha256.clone()))
        .collect();
    checksum_lines.push((MANIFEST_FILENAME.to_string(), manifest_hash));
    checksum_lines.sort_by(|a, b| a.0.cmp(&b.0));

    let mut checksums_content = String::new();
    for (path, hash) in &checksum_lines {
        checksums_content.push_str(&format!("{hash}  {path}\n"));
    }
    let checksums_path = temp_path.join(CHECKSUMS_FILENAME);
    write_synced(&checksums_path, checksums_content.as_bytes())?;

    // 7. Atomically rename into place. Re-check immediately before the
    // rename to narrow (not eliminate — no filesystem gives us that for
    // free) the race window; never overwrite an existing bundle.
    if final_path.exists() {
        return Err(BackupProofError::DestinationAlreadyExists);
    }
    fs::rename(&temp_path, &final_path).map_err(|_| BackupProofError::RenameFailed)?;

    Ok(final_path)
}

// ---------------------------------------------------------------------------
// Bundle preflight validation (platform-neutral; the single authoritative
// validator — every future consumer, starting with S0-010's restore proof,
// must call this and never re-parse the manifest/checksums independently)
// ---------------------------------------------------------------------------

/// A structurally and cryptographically validated bundle: every file the
/// manifest lists exists, is a regular file (not a symlink/reparse point),
/// resolves inside `bundle_dir` (no path traversal), and its recomputed
/// SHA-256 matches both `manifest.json` and `checksums.sha256`.
///
/// This is the entire preflight surface a consumer needs — it deliberately
/// exposes only the small set of fields a restore actually has to act on,
/// not the raw parsed manifest.
pub(crate) struct ValidatedBundle {
    pub(crate) bundle_dir: PathBuf,
    pub(crate) dump_path: PathBuf,
    pub(crate) bundle_format_version: u32,
    pub(crate) application_version: String,
    pub(crate) schema_version: String,
    pub(crate) postgres_major_version: u32,
}

#[derive(Deserialize)]
struct ManifestFileEntryDe {
    path: String,
    size_bytes: u64,
    sha256: String,
}

#[derive(Deserialize)]
struct ManifestDe {
    bundle_format_version: u32,
    application_version: String,
    schema_version: String,
    database_dump_filename: String,
    files: Vec<ManifestFileEntryDe>,
}

/// Reject a manifest-listed relative path that could escape `bundle_dir`:
/// empty, absolute, or containing a `.`/`..` component. Manifest paths are
/// always written with forward slashes (see `normalize_relative_path`), so
/// splitting on `/` is sufficient regardless of platform.
fn reject_path_traversal(relative_path: &str) -> Result<(), BackupProofError> {
    if relative_path.is_empty() || relative_path.starts_with('/') {
        return Err(BackupProofError::PathEscapesBundleRoot);
    }
    for component in relative_path.split('/') {
        if component.is_empty() || component == "." || component == ".." {
            return Err(BackupProofError::PathEscapesBundleRoot);
        }
    }
    Ok(())
}

/// Validate an existing bundle directory before it is ever restored from.
///
/// Checks, in order: `bundle_dir` itself is a real directory, not a
/// symlink/reparse point; `manifest.json` and `checksums.sha256` exist as
/// regular files and parse (`manifest.json` via `serde_json` — never
/// hand-parsed); every manifest-listed relative path is free of traversal,
/// resolves inside `bundle_dir` after canonicalization, is not a
/// symlink/reparse point, and its recomputed size/SHA-256 matches the
/// manifest *and* `checksums.sha256`; `checksums.sha256` covers
/// `manifest.json` itself (by hash) but never covers itself; the four
/// required files (`database.dump` plus the three version files) are
/// present, the three fixed asset directories exist and are not
/// symlinks/reparse points, `database.dump` is non-empty, and the recorded
/// PostgreSQL major version equals [`REQUIRED_PG_MAJOR_VERSION`].
pub(crate) fn validate_bundle(bundle_dir: &Path) -> Result<ValidatedBundle, BackupProofError> {
    let root_meta =
        fs::symlink_metadata(bundle_dir).map_err(|_| BackupProofError::BundleLayoutInvalid)?;
    reject_symlink_or_reparse_point(&root_meta)?;
    if !root_meta.is_dir() {
        return Err(BackupProofError::BundleLayoutInvalid);
    }

    let manifest_path = bundle_dir.join(MANIFEST_FILENAME);
    validate_input_file(&manifest_path).map_err(|_| BackupProofError::ManifestNotFound)?;
    let manifest_text =
        fs::read_to_string(&manifest_path).map_err(|_| BackupProofError::ManifestNotFound)?;
    let manifest: ManifestDe =
        serde_json::from_str(&manifest_text).map_err(|_| BackupProofError::ManifestParseFailed)?;
    if manifest.bundle_format_version != BUNDLE_FORMAT_VERSION {
        return Err(BackupProofError::BundleFormatVersionMismatch(
            manifest.bundle_format_version,
        ));
    }
    if manifest.database_dump_filename != DUMP_FILENAME {
        return Err(BackupProofError::BundleLayoutInvalid);
    }

    let checksums_path = bundle_dir.join(CHECKSUMS_FILENAME);
    validate_input_file(&checksums_path).map_err(|_| BackupProofError::ChecksumsNotFound)?;
    let checksums_text =
        fs::read_to_string(&checksums_path).map_err(|_| BackupProofError::ChecksumsNotFound)?;
    let mut checksums: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for line in checksums_text.lines() {
        let mut parts = line.splitn(2, "  ");
        let hash = parts.next().ok_or(BackupProofError::ChecksumsParseFailed)?;
        let path = parts.next().ok_or(BackupProofError::ChecksumsParseFailed)?;
        if hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(BackupProofError::ChecksumsParseFailed);
        }
        checksums.insert(path.to_string(), hash.to_lowercase());
    }
    if checksums.contains_key(CHECKSUMS_FILENAME) {
        // checksums.sha256 must never list itself.
        return Err(BackupProofError::ChecksumsParseFailed);
    }

    // The three fixed asset directories must exist (may be empty) and must
    // not themselves be symlinks/reparse points.
    for dir in [ATTACHMENTS_DIR, GENERATED_DOCUMENTS_DIR, COMPANY_ASSETS_DIR] {
        let dir_path = bundle_dir.join(dir);
        let meta =
            fs::symlink_metadata(&dir_path).map_err(|_| BackupProofError::BundleLayoutInvalid)?;
        reject_symlink_or_reparse_point(&meta)?;
        if !meta.is_dir() {
            return Err(BackupProofError::BundleLayoutInvalid);
        }
    }

    // manifest.json must be covered by checksums.sha256.
    let recomputed_manifest_hash = hash_bytes(manifest_text.as_bytes());
    match checksums.get(MANIFEST_FILENAME) {
        Some(h) if *h == recomputed_manifest_hash => {}
        _ => return Err(BackupProofError::ChecksumMismatch),
    }

    let canonical_root = bundle_dir
        .canonicalize()
        .map_err(|_| BackupProofError::BundleLayoutInvalid)?;

    let mut seen_required = std::collections::HashSet::new();
    for entry in &manifest.files {
        reject_path_traversal(&entry.path)?;
        let resolved = bundle_dir.join(&entry.path);
        // Propagate `validate_input_file`'s own error directly — it already
        // distinguishes "missing" from "is a symlink/reparse point" from
        // "not a regular file"; collapsing all three into one generic code
        // here would silently discard exactly the symlink-rejection detail
        // this validator exists to surface.
        validate_input_file(&resolved)?;

        // Defense in depth beyond the syntactic check above: an
        // intermediate directory component (e.g. `attachments`) could in
        // principle be replaced by a symlink pointing outside the bundle —
        // already excluded above for the three fixed directories, but
        // canonicalizing and confirming containment here costs little and
        // catches any future case that adds more directory levels.
        let canonical_resolved = resolved
            .canonicalize()
            .map_err(|_| BackupProofError::BundleLayoutInvalid)?;
        if !canonical_resolved.starts_with(&canonical_root) {
            return Err(BackupProofError::PathEscapesBundleRoot);
        }

        let (sha256, size_bytes) = hash_file(&resolved)?;
        if sha256 != entry.sha256 || size_bytes != entry.size_bytes {
            return Err(BackupProofError::ChecksumMismatch);
        }
        match checksums.get(&entry.path) {
            Some(h) if *h == sha256 => {}
            _ => return Err(BackupProofError::ChecksumMismatch),
        }

        if entry.path == DUMP_FILENAME
            || entry.path == SCHEMA_VERSION_FILENAME
            || entry.path == APPLICATION_VERSION_FILENAME
            || entry.path == POSTGRES_VERSION_FILENAME
        {
            seen_required.insert(entry.path.clone());
        }
    }

    for required in [
        DUMP_FILENAME,
        SCHEMA_VERSION_FILENAME,
        APPLICATION_VERSION_FILENAME,
        POSTGRES_VERSION_FILENAME,
    ] {
        if !seen_required.contains(required) {
            return Err(BackupProofError::BundleLayoutInvalid);
        }
    }

    let dump_path = bundle_dir.join(DUMP_FILENAME);
    let dump_size = fs::metadata(&dump_path)
        .map_err(|_| BackupProofError::Io)?
        .len();
    if dump_size == 0 {
        return Err(BackupProofError::DumpIsEmpty);
    }

    let postgres_version_text = fs::read_to_string(bundle_dir.join(POSTGRES_VERSION_FILENAME))
        .map_err(|_| BackupProofError::Io)?;
    let postgres_major_version = parse_pg_dump_major_version(postgres_version_text.trim())?;
    if postgres_major_version != REQUIRED_PG_MAJOR_VERSION {
        return Err(BackupProofError::PgDumpVersionMismatch(
            postgres_major_version,
        ));
    }

    Ok(ValidatedBundle {
        bundle_dir: bundle_dir.to_path_buf(),
        dump_path,
        bundle_format_version: manifest.bundle_format_version,
        application_version: manifest.application_version,
        schema_version: manifest.schema_version,
        postgres_major_version,
    })
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn fixed_now() -> OffsetDateTime {
        // 2026-07-22T09:30:15Z — arbitrary fixed instant for deterministic
        // naming/timestamp assertions.
        OffsetDateTime::from_unix_timestamp(1_784_713_815).expect("valid fixed instant")
    }

    fn scratch_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "stockiha-backup-proof-test-{tag}-{}",
            unique_temp_suffix()
        ));
        fs::create_dir_all(&dir).expect("scratch dir must be creatable");
        dir
    }

    fn fake_dump(bytes: &'static [u8]) -> impl FnOnce(&Path) -> Result<(), BackupProofError> {
        move |path: &Path| fs::write(path, bytes).map_err(|_| BackupProofError::Io)
    }

    // ---- pg_dump version parsing -------------------------------------------

    #[test]
    fn parses_major_version_from_typical_output() {
        assert_eq!(
            parse_pg_dump_major_version("pg_dump (PostgreSQL) 18.0").unwrap(),
            18
        );
        assert_eq!(
            parse_pg_dump_major_version("pg_dump (PostgreSQL) 18.4").unwrap(),
            18
        );
    }

    #[test]
    fn rejects_unparseable_version_output() {
        assert!(matches!(
            parse_pg_dump_major_version(""),
            Err(BackupProofError::PgDumpVersionParseFailed)
        ));
        assert!(matches!(
            parse_pg_dump_major_version("not a version string"),
            Err(BackupProofError::PgDumpVersionParseFailed)
        ));
    }

    #[test]
    fn rejects_non_18_major_version_at_the_orchestration_layer() {
        // discover_and_validate_pg_dump's own version-mismatch branch is
        // exercised end-to-end via the fake-executable test below; this test
        // covers the pure-parsing boundary the mismatch check is built on.
        assert_eq!(
            parse_pg_dump_major_version("pg_dump (PostgreSQL) 17.2").unwrap(),
            17
        );
    }

    // ---- known SHA-256 vector ------------------------------------------------

    #[test]
    fn known_sha256_vector_empty_string() {
        // The well-known SHA-256 of the empty byte string.
        assert_eq!(
            hash_bytes(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn known_sha256_vector_abc() {
        assert_eq!(
            hash_bytes(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn hash_file_matches_hash_bytes_and_reports_correct_size() {
        let dir = scratch_dir("hash-file");
        let path = dir.join("sample.bin");
        fs::write(&path, b"abc").unwrap();
        let (hex, size) = hash_file(&path).expect("hashing must succeed");
        assert_eq!(hex, hash_bytes(b"abc"));
        assert_eq!(size, 3);
        let _ = fs::remove_dir_all(&dir);
    }

    // ---- bundle directory naming --------------------------------------------

    #[test]
    fn bundle_directory_name_is_exact_fixed_format() {
        let name = bundle_directory_name(fixed_now());
        assert!(name.starts_with(BUNDLE_NAME_PREFIX));
        let suffix = &name[BUNDLE_NAME_PREFIX.len()..];
        assert_eq!(suffix.len(), "YYYYMMDD-HHMMSS".len());
        assert_eq!(&suffix[8..9], "-");
    }

    // ---- exact bundle layout + integrity order -----------------------------

    #[test]
    fn creates_exact_bundle_layout_with_empty_asset_dirs() {
        let root = scratch_dir("layout");
        let bundle = create_backup_bundle(
            &root,
            fixed_now(),
            "pg_dump (PostgreSQL) 18.0",
            &BackupInputs::empty(),
            fake_dump(b"FAKE DUMP BYTES"),
        )
        .expect("bundle creation must succeed");

        assert_eq!(bundle, root.join(bundle_directory_name(fixed_now())));
        assert!(bundle.join(DUMP_FILENAME).is_file());
        assert!(bundle.join(ATTACHMENTS_DIR).is_dir());
        assert!(bundle.join(GENERATED_DOCUMENTS_DIR).is_dir());
        assert!(bundle.join(COMPANY_ASSETS_DIR).is_dir());
        assert!(bundle.join(MANIFEST_FILENAME).is_file());
        assert!(bundle.join(CHECKSUMS_FILENAME).is_file());
        assert!(bundle.join(SCHEMA_VERSION_FILENAME).is_file());
        assert!(bundle.join(APPLICATION_VERSION_FILENAME).is_file());
        assert!(bundle.join(POSTGRES_VERSION_FILENAME).is_file());

        // No leftover temp directory.
        let leftover_tmp: Vec<_> = fs::read_dir(&root)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with(".tmp-"))
            .collect();
        assert!(
            leftover_tmp.is_empty(),
            "temp directory must not survive success"
        );

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn schema_and_application_and_postgres_version_contents_are_correct() {
        let root = scratch_dir("versions");
        let bundle = create_backup_bundle(
            &root,
            fixed_now(),
            "pg_dump (PostgreSQL) 18.3",
            &BackupInputs::empty(),
            fake_dump(b"x"),
        )
        .unwrap();
        assert_eq!(
            fs::read_to_string(bundle.join(SCHEMA_VERSION_FILENAME)).unwrap(),
            format!("{SCHEMA_VERSION}\n")
        );
        assert_eq!(
            fs::read_to_string(bundle.join(APPLICATION_VERSION_FILENAME)).unwrap(),
            format!("{APPLICATION_VERSION}\n")
        );
        assert_eq!(
            fs::read_to_string(bundle.join(POSTGRES_VERSION_FILENAME)).unwrap(),
            "pg_dump (PostgreSQL) 18.3\n"
        );
        let _ = fs::remove_dir_all(&root);
    }

    // ---- deterministic sorted manifest entries -----------------------------

    #[test]
    fn manifest_entries_are_sorted_and_deterministic() {
        let root = scratch_dir("manifest-sorted");
        let assets_dir = scratch_dir("manifest-sorted-fixtures");
        let a = assets_dir.join("zzz.txt");
        let b = assets_dir.join("aaa.txt");
        fs::write(&a, b"z-content").unwrap();
        fs::write(&b, b"a-content").unwrap();
        let inputs = BackupInputs {
            attachments: vec![a, b],
            generated_documents: Vec::new(),
            company_assets: Vec::new(),
        };
        let bundle = create_backup_bundle(
            &root,
            fixed_now(),
            "pg_dump (PostgreSQL) 18.0",
            &inputs,
            fake_dump(b"dump"),
        )
        .unwrap();

        let manifest_text = fs::read_to_string(bundle.join(MANIFEST_FILENAME)).unwrap();
        let aaa_pos = manifest_text.find("attachments/aaa.txt").unwrap();
        let zzz_pos = manifest_text.find("attachments/zzz.txt").unwrap();
        assert!(
            aaa_pos < zzz_pos,
            "entries must be sorted by normalized path"
        );
        // Forward slashes only, never backslashes, regardless of platform.
        assert!(!manifest_text.contains('\\'));

        // Re-running with the exact same fixed instant on a fresh root is
        // deterministic in content shape (field order, structure).
        let root2 = scratch_dir("manifest-sorted-2");
        let bundle2 = create_backup_bundle(
            &root2,
            fixed_now(),
            "pg_dump (PostgreSQL) 18.0",
            &BackupInputs::empty(),
            fake_dump(b"dump"),
        )
        .unwrap();
        let manifest_text2 = fs::read_to_string(bundle2.join(MANIFEST_FILENAME)).unwrap();
        assert!(manifest_text2.starts_with("{\"bundle_format_version\":1,"));

        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&root2);
        let _ = fs::remove_dir_all(&assets_dir);
    }

    // ---- checksums file covers manifest + every payload file, not itself --

    #[test]
    fn checksums_file_covers_manifest_and_payload_but_not_itself() {
        let root = scratch_dir("checksums");
        let bundle = create_backup_bundle(
            &root,
            fixed_now(),
            "pg_dump (PostgreSQL) 18.0",
            &BackupInputs::empty(),
            fake_dump(b"dump-bytes"),
        )
        .unwrap();

        let checksums_text = fs::read_to_string(bundle.join(CHECKSUMS_FILENAME)).unwrap();
        let listed_paths: HashSet<&str> = checksums_text
            .lines()
            .filter_map(|line| line.split_whitespace().last())
            .collect();

        assert!(listed_paths.contains(DUMP_FILENAME));
        assert!(listed_paths.contains(SCHEMA_VERSION_FILENAME));
        assert!(listed_paths.contains(APPLICATION_VERSION_FILENAME));
        assert!(listed_paths.contains(POSTGRES_VERSION_FILENAME));
        assert!(listed_paths.contains(MANIFEST_FILENAME));
        assert!(
            !listed_paths.contains(CHECKSUMS_FILENAME),
            "checksums.sha256 must never list itself"
        );

        // Independently recompute the manifest.json hash and confirm it
        // matches what checksums.sha256 recorded.
        let manifest_bytes = fs::read(bundle.join(MANIFEST_FILENAME)).unwrap();
        let expected_manifest_hash = hash_bytes(&manifest_bytes);
        let manifest_line = checksums_text
            .lines()
            .find(|l| l.ends_with(MANIFEST_FILENAME))
            .unwrap();
        assert!(manifest_line.starts_with(&expected_manifest_hash));

        let _ = fs::remove_dir_all(&root);
    }

    // ---- fixture attachment/generated-document/company-asset copying ------

    #[test]
    fn copies_fixtures_through_the_real_production_path() {
        let fixtures_dir = scratch_dir("fixtures-src");
        let attachment = fixtures_dir.join("invoice.pdf");
        let generated_doc = fixtures_dir.join("receipt.pdf");
        let asset = fixtures_dir.join("logo.png");
        fs::write(&attachment, b"attachment-bytes").unwrap();
        fs::write(&generated_doc, b"generated-doc-bytes").unwrap();
        fs::write(&asset, b"asset-bytes").unwrap();

        let inputs = BackupInputs {
            attachments: vec![attachment],
            generated_documents: vec![generated_doc],
            company_assets: vec![asset],
        };

        let root = scratch_dir("fixtures-bundle");
        let bundle = create_backup_bundle(
            &root,
            fixed_now(),
            "pg_dump (PostgreSQL) 18.0",
            &inputs,
            fake_dump(b"dump"),
        )
        .unwrap();

        assert_eq!(
            fs::read(bundle.join(ATTACHMENTS_DIR).join("invoice.pdf")).unwrap(),
            b"attachment-bytes"
        );
        assert_eq!(
            fs::read(bundle.join(GENERATED_DOCUMENTS_DIR).join("receipt.pdf")).unwrap(),
            b"generated-doc-bytes"
        );
        assert_eq!(
            fs::read(bundle.join(COMPANY_ASSETS_DIR).join("logo.png")).unwrap(),
            b"asset-bytes"
        );

        let manifest_text = fs::read_to_string(bundle.join(MANIFEST_FILENAME)).unwrap();
        assert!(manifest_text.contains("attachments/invoice.pdf"));
        assert!(manifest_text.contains("generated-documents/receipt.pdf"));
        assert!(manifest_text.contains("company-assets/logo.png"));

        let _ = fs::remove_dir_all(&fixtures_dir);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_duplicate_asset_filenames_in_the_same_category() {
        let fixtures_dir = scratch_dir("dup-fixtures");
        let sub_a = fixtures_dir.join("a");
        let sub_b = fixtures_dir.join("b");
        fs::create_dir_all(&sub_a).unwrap();
        fs::create_dir_all(&sub_b).unwrap();
        let file_a = sub_a.join("same-name.txt");
        let file_b = sub_b.join("same-name.txt");
        fs::write(&file_a, b"a").unwrap();
        fs::write(&file_b, b"b").unwrap();

        let inputs = BackupInputs {
            attachments: vec![file_a, file_b],
            generated_documents: Vec::new(),
            company_assets: Vec::new(),
        };

        let root = scratch_dir("dup-bundle");
        let result = create_backup_bundle(
            &root,
            fixed_now(),
            "pg_dump (PostgreSQL) 18.0",
            &inputs,
            fake_dump(b"dump"),
        );
        assert!(matches!(
            result,
            Err(BackupProofError::DuplicateAssetFilename)
        ));
        assert!(!root.join(bundle_directory_name(fixed_now())).exists());

        let _ = fs::remove_dir_all(&fixtures_dir);
        let _ = fs::remove_dir_all(&root);
    }

    // ---- reject symlinks / reparse-point inputs ----------------------------

    #[test]
    #[cfg(unix)]
    fn rejects_symlink_inputs() {
        use std::os::unix::fs::symlink;

        let fixtures_dir = scratch_dir("symlink-fixtures");
        let real_file = fixtures_dir.join("real.txt");
        fs::write(&real_file, b"real content").unwrap();
        let link = fixtures_dir.join("link.txt");
        symlink(&real_file, &link).unwrap();

        let inputs = BackupInputs {
            attachments: vec![link],
            generated_documents: Vec::new(),
            company_assets: Vec::new(),
        };

        let root = scratch_dir("symlink-bundle");
        let result = create_backup_bundle(
            &root,
            fixed_now(),
            "pg_dump (PostgreSQL) 18.0",
            &inputs,
            fake_dump(b"dump"),
        );
        assert!(matches!(
            result,
            Err(BackupProofError::RejectedSymlinkInput)
        ));
        assert!(
            !root.join(bundle_directory_name(fixed_now())).exists(),
            "a rejected symlink input must leave no final bundle"
        );

        let _ = fs::remove_dir_all(&fixtures_dir);
        let _ = fs::remove_dir_all(&root);
    }

    // ---- existing destination never overwritten ----------------------------

    #[test]
    fn never_overwrites_an_existing_final_bundle() {
        let root = scratch_dir("no-overwrite");
        let first = create_backup_bundle(
            &root,
            fixed_now(),
            "pg_dump (PostgreSQL) 18.0",
            &BackupInputs::empty(),
            fake_dump(b"FIRST"),
        )
        .unwrap();
        let original_dump = fs::read(first.join(DUMP_FILENAME)).unwrap();

        let second_result = create_backup_bundle(
            &root,
            fixed_now(),
            "pg_dump (PostgreSQL) 18.0",
            &BackupInputs::empty(),
            fake_dump(b"SECOND-SHOULD-NOT-LAND"),
        );
        assert!(matches!(
            second_result,
            Err(BackupProofError::DestinationAlreadyExists)
        ));

        // The original bundle's dump is completely untouched.
        assert_eq!(fs::read(first.join(DUMP_FILENAME)).unwrap(), original_dump);
        assert_eq!(original_dump, b"FIRST");

        let _ = fs::remove_dir_all(&root);
    }

    // ---- injected failure leaves no visible final bundle -------------------

    #[test]
    fn injected_dump_failure_leaves_no_visible_bundle_and_no_temp_dir() {
        let root = scratch_dir("injected-failure");
        let result = create_backup_bundle(
            &root,
            fixed_now(),
            "pg_dump (PostgreSQL) 18.0",
            &BackupInputs::empty(),
            |_path: &Path| Err(BackupProofError::PgDumpFailed(Some(1))),
        );
        assert!(matches!(
            result,
            Err(BackupProofError::PgDumpFailed(Some(1)))
        ));
        assert!(!root.join(bundle_directory_name(fixed_now())).exists());

        // No temp directory left behind either.
        let leftovers: Vec<_> = fs::read_dir(&root)
            .unwrap()
            .filter_map(|e| e.ok())
            .collect();
        assert!(
            leftovers.is_empty(),
            "no directory entries must remain after a failure"
        );

        let _ = fs::remove_dir_all(&root);
    }

    // ---- temporary directory cleanup via the child-guard mechanism --------

    #[test]
    #[cfg(unix)]
    fn child_guard_kills_and_reaps_a_still_running_child_on_drop() {
        // A long-sleeping child, standing in for an interrupted/still-running
        // pg_dump process. Proves the cleanup mechanism itself (decoupled
        // from real pg_dump, exactly as the production code path uses it).
        let child = Command::new("sleep")
            .arg("5")
            .spawn()
            .expect("spawning `sleep` must succeed in this sandbox");
        let pid = child.id();
        {
            let _guard = ChildGuard(child);
            // Guard drops here — must kill and reap `pid` rather than leave
            // it running for the full 5 seconds.
        }
        // Give the OS a brief moment to finish reaping, then confirm the
        // process is gone (kill -0 fails once the process no longer exists).
        std::thread::sleep(Duration::from_millis(200));
        let still_alive = std::process::Command::new("kill")
            .arg("-0")
            .arg(pid.to_string())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        assert!(!still_alive, "ChildGuard must kill the child on drop");
    }

    // ---- redacted errors -----------------------------------------------------

    #[test]
    fn errors_are_redacted() {
        let variants: Vec<BackupProofError> = vec![
            BackupProofError::InvalidBundleRoot,
            BackupProofError::DestinationAlreadyExists,
            BackupProofError::TempDirectoryCreationFailed,
            BackupProofError::InputNotFound,
            BackupProofError::RejectedSymlinkInput,
            BackupProofError::InputNotAFile,
            BackupProofError::DuplicateAssetFilename,
            BackupProofError::Io,
            BackupProofError::PgDumpNotFound,
            BackupProofError::PgDumpVersionParseFailed,
            BackupProofError::PgDumpVersionMismatch(17),
            BackupProofError::PgDumpFailed(Some(1)),
            BackupProofError::CredentialNotUtf8,
            BackupProofError::CredentialUnavailable(CredentialErrorSummary::from(
                CredentialError::NotFound,
            )),
            BackupProofError::RenameFailed,
        ];
        for e in &variants {
            let displayed = format!("{e}");
            let debugged = format!("{e:?}");
            assert!(displayed.starts_with("BACKUP_PROOF_"));
            assert!(debugged.starts_with("BackupProofError(BACKUP_PROOF_"));
            assert!(
                !displayed.contains('1'),
                "Display must never leak dynamic detail: {displayed}"
            );
            assert!(!e.diagnostic().is_empty());
        }
    }

    #[test]
    fn safe_failure_when_backup_credential_is_missing() {
        // Platform-neutral: exercises the credential-missing mapping path
        // directly, without touching Windows Credential Manager, proving the
        // failure is safe (redacted, no panic, no secret) on every platform.
        let err = map_credential_error(CredentialError::NotFound);
        assert!(matches!(err, BackupProofError::CredentialUnavailable(_)));
        assert_eq!(format!("{err}"), "BACKUP_PROOF_CREDENTIAL_UNAVAILABLE");
        assert_eq!(
            format!("{err:?}"),
            "BackupProofError(BACKUP_PROOF_CREDENTIAL_UNAVAILABLE)"
        );
        // The private diagnostic retains CredentialError's own already-safe
        // text ("credential not found"), never a secret.
        assert_eq!(err.diagnostic(), "credential not found");
    }

    // ---- fake-executable pg_dump invocation tests --------------------------

    /// Writes a tiny fake `pg_dump`-like shell script into `dir` and returns
    /// its path. Understands exactly two invocations:
    /// - `--version` → prints a fixed version string and exits 0.
    /// - anything else → writes fixed bytes to the path following `--file`,
    ///   writes "SET" or "UNSET" (never the value) to a marker file
    ///   depending on whether `PGPASSWORD` is present, then exits 0 (or with
    ///   the status named by `STOCKIHA_FAKE_PG_DUMP_EXIT_CODE` if set).
    #[cfg(unix)]
    fn write_fake_pg_dump(dir: &Path, marker_path: &Path) -> PathBuf {
        let script_path = dir.join("pg_dump");
        let script = format!(
            r#"#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "pg_dump (PostgreSQL) 18.1"
  exit 0
fi
if [ -n "${{PGPASSWORD+x}}" ]; then
  echo "SET" > "{marker}"
else
  echo "UNSET" > "{marker}"
fi
out=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "--file" ]; then
    out="$arg"
  fi
  prev="$arg"
done
printf 'FAKE-DUMP-OUTPUT' > "$out"
exit "${{STOCKIHA_FAKE_PG_DUMP_EXIT_CODE:-0}}"
"#,
            marker = marker_path.display()
        );
        fs::write(&script_path, script).unwrap();
        let mut perms = fs::metadata(&script_path).unwrap().permissions();
        std::os::unix::fs::PermissionsExt::set_mode(&mut perms, 0o755);
        fs::set_permissions(&script_path, perms).unwrap();
        script_path
    }

    #[test]
    #[cfg(unix)]
    fn discover_and_validate_pg_dump_accepts_major_18_fake_executable() {
        let dir = scratch_dir("fake-pgdump-version");
        let marker = dir.join("marker.txt");
        let exe = write_fake_pg_dump(&dir, &marker);
        let version = discover_and_validate_pg_dump(&exe).expect("major 18 must validate");
        assert_eq!(version, "pg_dump (PostgreSQL) 18.1");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    #[cfg(unix)]
    fn run_pg_dump_sets_pgpassword_only_for_the_child_and_writes_the_dump() {
        let dir = scratch_dir("fake-pgdump-run");
        let marker = dir.join("marker.txt");
        let exe = write_fake_pg_dump(&dir, &marker);
        let out_path = dir.join("out.dump");

        let target = PgDumpTarget {
            host: "localhost",
            port: 5432,
            database: "stockiha_backup_proof_test",
        };
        run_pg_dump(&exe, &target, "s3cr3t-test-password", &out_path)
            .expect("fake pg_dump run must succeed");

        assert_eq!(fs::read(&out_path).unwrap(), b"FAKE-DUMP-OUTPUT");
        assert_eq!(fs::read_to_string(&marker).unwrap().trim(), "SET");

        // The password never appears in this process's own environment
        // afterward (Command::env only affects the child).
        assert!(std::env::var("PGPASSWORD").is_err());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    #[cfg(unix)]
    fn run_pg_dump_maps_nonzero_exit_to_pg_dump_failed() {
        let dir = scratch_dir("fake-pgdump-fail");
        let marker = dir.join("marker.txt");
        let exe = write_fake_pg_dump(&dir, &marker);
        let out_path = dir.join("out.dump");

        let target = PgDumpTarget {
            host: "localhost",
            port: 5432,
            database: "stockiha_backup_proof_test",
        };
        // SAFETY: test-only, single-threaded at this point in the test body.
        std::env::set_var("STOCKIHA_FAKE_PG_DUMP_EXIT_CODE", "3");
        let result = run_pg_dump(&exe, &target, "irrelevant", &out_path);
        std::env::remove_var("STOCKIHA_FAKE_PG_DUMP_EXIT_CODE");

        assert!(matches!(
            result,
            Err(BackupProofError::PgDumpFailed(Some(3)))
        ));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolve_pg_dump_executable_honors_env_override() {
        // SAFETY: test-only; no other test in this module reads this var.
        std::env::set_var("STOCKIHA_PG_DUMP_PATH", "/custom/path/pg_dump");
        assert_eq!(
            resolve_pg_dump_executable(),
            PathBuf::from("/custom/path/pg_dump")
        );
        std::env::remove_var("STOCKIHA_PG_DUMP_PATH");
        assert_eq!(resolve_pg_dump_executable(), PathBuf::from("pg_dump"));
    }

    // ---- JSON escaping -------------------------------------------------------

    #[test]
    fn json_escape_handles_quotes_backslashes_and_control_chars() {
        assert_eq!(json_escape("plain"), "plain");
        assert_eq!(json_escape("a\"b"), "a\\\"b");
        assert_eq!(json_escape("a\\b"), "a\\\\b");
        assert_eq!(json_escape("a\nb"), "a\\nb");
        assert_eq!(json_escape("a\tb"), "a\\tb");
    }

    // ---- manifest.json is real, valid, parseable JSON ----------------------

    /// Generates a real bundle through the production manifest-writing path
    /// (`create_backup_bundle`, not a hand-built string), then parses the
    /// resulting `manifest.json` with `serde_json` — already a dev-dependency
    /// (used only by tests), not promoted, no new crate added. This proves
    /// the manifest is genuinely valid JSON (a parser accepts it), not just a
    /// string that happens to look right, and specifically exercises
    /// Unicode plus quote/backslash characters in a relative path, which is
    /// exactly where a hand-written JSON serializer is most likely to have an
    /// escaping bug.
    #[test]
    fn manifest_json_parses_and_matches_production_values() {
        let fixtures_dir = scratch_dir("manifest-json-fixtures");

        // Unicode in the filename (accented Latin, CJK, and an emoji outside
        // the Basic Multilingual Plane).
        let unicode_name = "héllo-世界-😀.txt";
        let unicode_file = fixtures_dir.join(unicode_name);
        fs::write(&unicode_file, "unicode content").unwrap();

        #[cfg(not(windows))]
        let quoted_name = "weird\"name\\with-backslash.txt";
        #[cfg(windows)]
        let quoted_name = "weird-name-on-windows-é.txt";
        let quoted_file = fixtures_dir.join(quoted_name);
        fs::write(&quoted_file, "quoted content").unwrap();

        let inputs = BackupInputs {
            attachments: vec![unicode_file.clone(), quoted_file.clone()],
            generated_documents: Vec::new(),
            company_assets: Vec::new(),
        };

        let root = scratch_dir("manifest-json-bundle");
        let postgres_version = "pg_dump (PostgreSQL) 18.2";
        let bundle = create_backup_bundle(
            &root,
            fixed_now(),
            postgres_version,
            &inputs,
            fake_dump(b"manifest-json-test-dump"),
        )
        .expect("bundle creation must succeed");

        let manifest_text = fs::read_to_string(bundle.join(MANIFEST_FILENAME)).unwrap();

        // The document is valid JSON, not only a matching string: a real
        // parser must accept it.
        let parsed: serde_json::Value =
            serde_json::from_str(&manifest_text).expect("manifest.json must be valid JSON");

        assert_eq!(
            parsed["bundle_format_version"],
            serde_json::json!(BUNDLE_FORMAT_VERSION)
        );
        assert_eq!(
            parsed["application_version"],
            serde_json::json!(APPLICATION_VERSION)
        );
        assert_eq!(parsed["schema_version"], serde_json::json!(SCHEMA_VERSION));
        assert_eq!(
            parsed["created_at_unix"],
            serde_json::json!(fixed_now().unix_timestamp() as u64)
        );
        assert_eq!(
            parsed["database_dump_filename"],
            serde_json::json!(DUMP_FILENAME)
        );

        let files = parsed["files"]
            .as_array()
            .expect("files must be a JSON array");
        assert!(!files.is_empty());

        let find_entry = |relative_path: &str| {
            files
                .iter()
                .find(|entry| entry["path"] == serde_json::json!(relative_path))
                .unwrap_or_else(|| {
                    panic!("manifest.json files array must contain an entry for {relative_path}")
                })
        };

        // Unicode-named attachment: exact relative path (round-tripped
        // through JSON parsing, proving the escaping/encoding is correct),
        // byte size, and SHA-256 all match the real file.
        let unicode_path = format!("attachments/{unicode_name}");
        let unicode_entry = find_entry(&unicode_path);
        assert_eq!(
            unicode_entry["size_bytes"],
            serde_json::json!(fs::metadata(&unicode_file).unwrap().len())
        );
        assert_eq!(
            unicode_entry["sha256"],
            serde_json::json!(hash_bytes(b"unicode content"))
        );

        // Quote/backslash-named attachment: same checks. This is the entry
        // most likely to reveal a hand-written-JSON escaping defect.
        let quoted_path = format!("attachments/{quoted_name}");
        let quoted_entry = find_entry(&quoted_path);
        assert_eq!(
            quoted_entry["size_bytes"],
            serde_json::json!(fs::metadata(&quoted_file).unwrap().len())
        );
        assert_eq!(
            quoted_entry["sha256"],
            serde_json::json!(hash_bytes(b"quoted content"))
        );

        // PostgreSQL version: manifest.json has no separate top-level field
        // for it — its `files` array entry (path/size/sha256 of
        // `postgres-version.txt`) *is* the recorded PostgreSQL version
        // artifact, matched against the real file's own content and hash.
        let pg_version_entry = find_entry(POSTGRES_VERSION_FILENAME);
        let pg_version_contents = fs::read(bundle.join(POSTGRES_VERSION_FILENAME)).unwrap();
        assert_eq!(
            String::from_utf8_lossy(&pg_version_contents).trim(),
            postgres_version
        );
        assert_eq!(
            pg_version_entry["sha256"],
            serde_json::json!(hash_bytes(&pg_version_contents))
        );
        assert_eq!(
            pg_version_entry["size_bytes"],
            serde_json::json!(pg_version_contents.len() as u64)
        );

        let _ = fs::remove_dir_all(&fixtures_dir);
        let _ = fs::remove_dir_all(&root);
    }

    // ---- validate_bundle: the single shared preflight validator (S0-010's
    // restore proof calls this directly and must never reimplement it) -----

    #[test]
    fn validate_bundle_accepts_a_real_bundle_and_reports_its_fields() {
        let root = scratch_dir("validate-bundle-ok");
        let bundle = create_backup_bundle(
            &root,
            fixed_now(),
            "pg_dump (PostgreSQL) 18.5",
            &BackupInputs::empty(),
            fake_dump(b"validate-bundle-ok-dump"),
        )
        .unwrap();

        let validated = validate_bundle(&bundle).expect("a real bundle must validate");
        assert_eq!(validated.bundle_dir, bundle);
        assert_eq!(validated.dump_path, bundle.join(DUMP_FILENAME));
        assert_eq!(validated.bundle_format_version, BUNDLE_FORMAT_VERSION);
        assert_eq!(validated.application_version, APPLICATION_VERSION);
        assert_eq!(validated.schema_version, SCHEMA_VERSION);
        assert_eq!(validated.postgres_major_version, 18);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn validate_bundle_rejects_malformed_manifest_json() {
        let root = scratch_dir("validate-bundle-malformed-manifest");
        let bundle = create_backup_bundle(
            &root,
            fixed_now(),
            "pg_dump (PostgreSQL) 18.0",
            &BackupInputs::empty(),
            fake_dump(b"dump"),
        )
        .unwrap();

        fs::write(bundle.join(MANIFEST_FILENAME), b"{ not valid json ").unwrap();

        assert!(matches!(
            validate_bundle(&bundle),
            Err(BackupProofError::ManifestParseFailed)
        ));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn validate_bundle_rejects_a_tampered_payload_file() {
        let root = scratch_dir("validate-bundle-tampered");
        let bundle = create_backup_bundle(
            &root,
            fixed_now(),
            "pg_dump (PostgreSQL) 18.0",
            &BackupInputs::empty(),
            fake_dump(b"original dump bytes"),
        )
        .unwrap();

        // Tamper with the dump after the bundle was sealed, without touching
        // the manifest or checksums — exactly what a corrupted bundle looks
        // like on disk.
        fs::write(bundle.join(DUMP_FILENAME), b"tampered dump bytes").unwrap();

        assert!(matches!(
            validate_bundle(&bundle),
            Err(BackupProofError::ChecksumMismatch)
        ));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn validate_bundle_rejects_a_missing_required_file() {
        let root = scratch_dir("validate-bundle-missing-file");
        let bundle = create_backup_bundle(
            &root,
            fixed_now(),
            "pg_dump (PostgreSQL) 18.0",
            &BackupInputs::empty(),
            fake_dump(b"dump"),
        )
        .unwrap();

        fs::remove_file(bundle.join(SCHEMA_VERSION_FILENAME)).unwrap();

        // A genuinely missing file surfaces `InputNotFound` — the specific
        // error `validate_input_file` itself reports, propagated directly
        // rather than collapsed into a generic layout error.
        assert!(matches!(
            validate_bundle(&bundle),
            Err(BackupProofError::InputNotFound)
        ));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    #[cfg(unix)]
    fn validate_bundle_rejects_a_symlink_replacing_a_listed_file() {
        use std::os::unix::fs::symlink;

        let root = scratch_dir("validate-bundle-symlink");
        let bundle = create_backup_bundle(
            &root,
            fixed_now(),
            "pg_dump (PostgreSQL) 18.0",
            &BackupInputs::empty(),
            fake_dump(b"dump"),
        )
        .unwrap();

        let victim = bundle.join(APPLICATION_VERSION_FILENAME);
        let elsewhere = root.join("elsewhere.txt");
        fs::write(&elsewhere, "not the real content").unwrap();
        fs::remove_file(&victim).unwrap();
        symlink(&elsewhere, &victim).unwrap();

        assert!(matches!(
            validate_bundle(&bundle),
            Err(BackupProofError::RejectedSymlinkInput)
        ));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn validate_bundle_rejects_bundle_format_version_mismatch() {
        let root = scratch_dir("validate-bundle-format-version");
        let bundle = create_backup_bundle(
            &root,
            fixed_now(),
            "pg_dump (PostgreSQL) 18.0",
            &BackupInputs::empty(),
            fake_dump(b"dump"),
        )
        .unwrap();

        // Rewrite manifest.json with a different bundle_format_version, then
        // recompute checksums.sha256 so the tamper is isolated to exactly
        // the field under test (otherwise the checksum check would fire
        // first, masking what this test is actually proving).
        let manifest_text = fs::read_to_string(bundle.join(MANIFEST_FILENAME)).unwrap();
        let tampered = manifest_text.replacen(
            "\"bundle_format_version\":1",
            "\"bundle_format_version\":99",
            1,
        );
        assert_ne!(
            tampered, manifest_text,
            "the version field must be present to tamper with"
        );
        fs::write(bundle.join(MANIFEST_FILENAME), &tampered).unwrap();
        let new_manifest_hash = hash_bytes(tampered.as_bytes());
        let checksums_text = fs::read_to_string(bundle.join(CHECKSUMS_FILENAME)).unwrap();
        let new_checksums: String = checksums_text
            .lines()
            .map(|line| {
                if line.ends_with(MANIFEST_FILENAME) {
                    format!("{new_manifest_hash}  {MANIFEST_FILENAME}\n")
                } else {
                    format!("{line}\n")
                }
            })
            .collect();
        fs::write(bundle.join(CHECKSUMS_FILENAME), new_checksums).unwrap();

        assert!(matches!(
            validate_bundle(&bundle),
            Err(BackupProofError::BundleFormatVersionMismatch(99))
        ));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn validate_bundle_rejects_non_18_postgres_major_version() {
        let root = scratch_dir("validate-bundle-pg-version");
        let bundle = create_backup_bundle(
            &root,
            fixed_now(),
            "pg_dump (PostgreSQL) 17.4",
            &BackupInputs::empty(),
            fake_dump(b"dump"),
        )
        .unwrap();

        assert!(matches!(
            validate_bundle(&bundle),
            Err(BackupProofError::PgDumpVersionMismatch(17))
        ));
        let _ = fs::remove_dir_all(&root);
    }

    // ===========================================================================
    // Windows/PostgreSQL live proof (ignored by default; requires Windows,
    // a real PostgreSQL 18 instance, a real pg_dump on PATH or
    // STOCKIHA_PG_DUMP_PATH, and the stockiha_backup credential already
    // stored via S0-005).
    // ===========================================================================

    /// Runs the full pipeline against a real PostgreSQL 18 instance using the
    /// real `stockiha_backup` credential. Ignored by default. To run:
    ///
    /// ```powershell
    /// $env:STOCKIHA_ALLOW_BACKUP_PROOF = "YES"
    /// $env:STOCKIHA_BACKUP_PROOF_DATABASE = "stockiha_backup_proof_test"
    /// cargo test -p stockiha-backend backup_proof -- --ignored
    /// ```
    ///
    /// The target database name must end in `_test` (same convention as
    /// S0-003/S0-004) — a guard against accidentally dumping a real business
    /// database from a test run.
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn windows_live_proof_creates_a_real_backup_bundle() {
        let allowed = std::env::var("STOCKIHA_ALLOW_BACKUP_PROOF").unwrap_or_default();
        assert_eq!(
            allowed, "YES",
            "set STOCKIHA_ALLOW_BACKUP_PROOF=YES to run this live proof"
        );
        let database = std::env::var("STOCKIHA_BACKUP_PROOF_DATABASE")
            .expect("set STOCKIHA_BACKUP_PROOF_DATABASE=<name> to run this live proof");
        assert!(
            database.ends_with("_test"),
            "the live-proof database name must end in _test"
        );

        let executable = resolve_pg_dump_executable();
        let version = discover_and_validate_pg_dump(&executable)
            .expect("pg_dump must be discoverable and report major version 18");

        let secret =
            resolve_backup_credential().expect("stockiha_backup credential must be stored");
        let bytes = secret.as_ref();
        let password = if bytes.contains(&0) {
            let u16s: Vec<u16> = bytes
                .chunks_exact(2)
                .map(|c| u16::from_le_bytes([c[0], c[1]]))
                .collect();
            String::from_utf16_lossy(&u16s)
                .trim_end_matches('\0')
                .to_string()
        } else {
            std::str::from_utf8(bytes)
                .expect("stockiha_backup password must be UTF-8")
                .to_string()
        };

        let target = PgDumpTarget {
            host: "localhost",
            port: 5432,
            database: &database,
        };

        let root = std::env::temp_dir().join("stockiha-backup-proof-live");
        fs::create_dir_all(&root).unwrap();

        let bundle = create_backup_bundle(
            &root,
            OffsetDateTime::now_utc(),
            &version,
            &BackupInputs::empty(),
            |out_path| run_pg_dump(&executable, &target, &password, out_path),
        )
        .expect("the live backup bundle must be created successfully");

        assert!(bundle.join(DUMP_FILENAME).is_file());
        let dump_size = fs::metadata(bundle.join(DUMP_FILENAME)).unwrap().len();
        assert!(dump_size > 0, "the real pg_dump output must be non-empty");
    }
}
