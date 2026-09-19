//! Bundle format 2 (plan §5.3, ruling R3) and bundle inspection.
//!
//! Layout is identical to format 1 (`backup_proof`): `database.dump`,
//! `manifest.json`, `checksums.sha256`, three version files, three flat
//! asset directories. Format 2 adds manifest fields (`backup_kind`,
//! `dump_includes_privileges`, `source`) and stamps the **real** schema
//! version (`_sqlx_migrations`, see `schema.rs`) instead of the stale
//! `operations.schema_state` value. The manifest is rewritten as a
//! `serde_json::Value` so no field is ever dropped, and `checksums.sha256`
//! is rebuilt exactly the way `recovery_creation::rewrite_schema_metadata`
//! builds it.

use std::collections::HashSet;
use std::ffi::OsStr;
use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};

use serde_json::Value as JsonValue;
use sha2::{Digest, Sha256};

use super::errors::{codes, EngineError};
use super::is_symlink_or_reparse;
use super::schema::{self, SchemaVerdict};
use crate::application::recovery::{canonical_bundle_stats, is_canonical_bundle_identifier};
use crate::application::recovery_creation::parse_bundle_identifier_time;
use crate::infrastructure::backup_proof::{self, ValidatedBundle};
use crate::infrastructure::schema_version;

pub(crate) const BUNDLE_FORMAT_VERSION_2: u32 = 2;
pub(crate) const SOURCE_EMBEDDED: &str = "EMBEDDED";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum BackupKind {
    Manual,
    Daily,
    PreUpdate,
    PreRestore,
}

impl BackupKind {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            BackupKind::Manual => "MANUAL",
            BackupKind::Daily => "DAILY",
            BackupKind::PreUpdate => "PRE_UPDATE",
            BackupKind::PreRestore => "PRE_RESTORE",
        }
    }

    /// Readers map anything else — or a missing field — to `UNKNOWN`.
    pub(crate) fn parse(value: Option<&str>) -> &'static str {
        match value {
            Some("MANUAL") => "MANUAL",
            Some("DAILY") => "DAILY",
            Some("PRE_UPDATE") => "PRE_UPDATE",
            Some("PRE_RESTORE") => "PRE_RESTORE",
            _ => "UNKNOWN",
        }
    }
}

pub(crate) struct BundleMetadata<'a> {
    pub schema_version: &'a str,
    pub app_version: &'a str,
    pub kind: BackupKind,
}

/// Turn a freshly staged format 1 bundle (from
/// `backup_proof::create_backup_bundle`) into a format 2 bundle: rewrite the
/// two version text files, patch the manifest, rebuild `checksums.sha256`.
pub(crate) fn finalize_bundle_metadata(
    bundle_dir: &Path,
    meta: &BundleMetadata<'_>,
) -> Result<(), EngineError> {
    let fail = |detail: String| EngineError::new(codes::BACKUP_METADATA_WRITE_FAILED, detail);

    let schema_version = meta.schema_version.trim();
    let app_version = meta.app_version.trim();
    if schema_version.is_empty()
        || app_version.is_empty()
        || schema_version.chars().any(char::is_control)
        || app_version.chars().any(char::is_control)
    {
        return Err(fail(
            "schema or application version is empty or invalid".into(),
        ));
    }

    let schema_path = bundle_dir.join(backup_proof::SCHEMA_VERSION_FILENAME);
    write_synced(&schema_path, format!("{schema_version}\n").as_bytes()).map_err(fail)?;
    let application_path = bundle_dir.join(backup_proof::APPLICATION_VERSION_FILENAME);
    write_synced(&application_path, format!("{app_version}\n").as_bytes()).map_err(fail)?;
    let (schema_hash, schema_size) = hash_file(&schema_path).map_err(fail)?;
    let (application_hash, application_size) = hash_file(&application_path).map_err(fail)?;

    let manifest_path = bundle_dir.join(backup_proof::MANIFEST_FILENAME);
    let manifest_bytes =
        fs::read(&manifest_path).map_err(|e| fail(format!("read manifest ({e})")))?;
    let mut manifest: JsonValue = serde_json::from_slice(&manifest_bytes)
        .map_err(|e| fail(format!("parse manifest ({e})")))?;
    let object = manifest
        .as_object_mut()
        .ok_or_else(|| fail("manifest is not a JSON object".into()))?;
    object.insert(
        "bundle_format_version".into(),
        JsonValue::from(BUNDLE_FORMAT_VERSION_2),
    );
    object.insert("schema_version".into(), JsonValue::from(schema_version));
    object.insert("application_version".into(), JsonValue::from(app_version));
    object.insert("backup_kind".into(), JsonValue::from(meta.kind.as_str()));
    object.insert("dump_includes_privileges".into(), JsonValue::Bool(true));
    object.insert("source".into(), JsonValue::from(SOURCE_EMBEDDED));

    let files = object
        .get_mut("files")
        .and_then(JsonValue::as_array_mut)
        .ok_or_else(|| fail("manifest has no files array".into()))?;
    let mut seen = HashSet::new();
    let mut schema_entries = 0;
    let mut application_entries = 0;
    for entry in files.iter_mut() {
        let path = entry
            .get("path")
            .and_then(JsonValue::as_str)
            .ok_or_else(|| fail("manifest file entry has no path".into()))?
            .to_string();
        if !seen.insert(path.clone()) {
            return Err(fail(format!("duplicate manifest path '{path}'")));
        }
        let (hash, size) = if path == backup_proof::SCHEMA_VERSION_FILENAME {
            schema_entries += 1;
            (&schema_hash, schema_size)
        } else if path == backup_proof::APPLICATION_VERSION_FILENAME {
            application_entries += 1;
            (&application_hash, application_size)
        } else {
            continue;
        };
        let entry_object = entry
            .as_object_mut()
            .ok_or_else(|| fail("manifest file entry is not an object".into()))?;
        entry_object.insert("sha256".into(), JsonValue::from(hash.as_str()));
        entry_object.insert("size_bytes".into(), JsonValue::from(size));
    }
    if schema_entries != 1 || application_entries != 1 {
        return Err(fail(
            "manifest must list the two version files exactly once".into(),
        ));
    }
    files.sort_by(|left, right| {
        let l = left.get("path").and_then(JsonValue::as_str).unwrap_or("");
        let r = right.get("path").and_then(JsonValue::as_str).unwrap_or("");
        l.cmp(r)
    });

    let mut checksum_lines: Vec<(String, String)> = files
        .iter()
        .map(|entry| {
            let path = entry
                .get("path")
                .and_then(JsonValue::as_str)
                .unwrap_or_default()
                .to_string();
            let hash = entry
                .get("sha256")
                .and_then(JsonValue::as_str)
                .unwrap_or_default()
                .to_string();
            (path, hash)
        })
        .collect();

    let rewritten = serde_json::to_vec(&manifest).map_err(|e| fail(format!("serialize ({e})")))?;
    write_synced(&manifest_path, &rewritten).map_err(fail)?;
    checksum_lines.push((
        backup_proof::MANIFEST_FILENAME.to_string(),
        hash_bytes(&rewritten),
    ));
    checksum_lines.sort_by(|left, right| left.0.cmp(&right.0));
    let mut checksums = String::new();
    for (path, hash) in checksum_lines {
        checksums.push_str(&format!("{hash}  {path}\n"));
    }
    write_synced(
        &bundle_dir.join(backup_proof::CHECKSUMS_FILENAME),
        checksums.as_bytes(),
    )
    .map_err(fail)
}

/// Resolve a user-chosen bundle folder from **any** location (ruling R9):
/// canonical name, real directory before and after canonicalization, name
/// unchanged by resolution. Returns the `dunce`-simplified canonical path
/// and the bundle identifier.
pub(crate) fn canonical_bundle_anywhere(raw: &str) -> Result<(PathBuf, String), EngineError> {
    let raw = raw.trim();
    let path = Path::new(raw);
    let name = path
        .file_name()
        .and_then(OsStr::to_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            EngineError::new(
                codes::BACKUP_BUNDLE_NAME_INVALID,
                format!("'{raw}' has no final directory name"),
            )
        })?
        .to_string();
    if !is_canonical_bundle_identifier(&name) {
        return Err(EngineError::new(
            codes::BACKUP_BUNDLE_NAME_INVALID,
            format!("'{name}' is not a GestStock-Backup-YYYYMMDD-HHMMSS name"),
        ));
    }

    let not_a_directory =
        |detail: String| EngineError::new(codes::BACKUP_BUNDLE_NOT_A_DIRECTORY, detail);
    let metadata =
        fs::symlink_metadata(path).map_err(|e| not_a_directory(format!("'{raw}': {e}")))?;
    if is_symlink_or_reparse(&metadata) || !metadata.is_dir() {
        return Err(not_a_directory(format!(
            "'{raw}' is not a real directory (symlink, reparse point, or file)"
        )));
    }
    let canonical = path
        .canonicalize()
        .map_err(|e| not_a_directory(format!("'{raw}' could not be canonicalized: {e}")))?;
    let canonical_metadata =
        fs::symlink_metadata(&canonical).map_err(|e| not_a_directory(format!("'{raw}': {e}")))?;
    if is_symlink_or_reparse(&canonical_metadata) || !canonical_metadata.is_dir() {
        return Err(not_a_directory(format!(
            "'{}' is not a real directory after resolution",
            canonical.display()
        )));
    }
    if canonical.file_name().and_then(OsStr::to_str) != Some(name.as_str()) {
        return Err(EngineError::new(
            codes::BACKUP_BUNDLE_NAME_INVALID,
            "bundle name changed during path resolution".to_string(),
        ));
    }
    Ok((dunce::simplified(&canonical).to_path_buf(), name))
}

#[derive(Debug)]
pub(crate) struct BundleSummary {
    pub validated: ValidatedBundle,
    pub file_count: u64,
    pub total_bytes: u64,
    pub verdict: SchemaVerdict,
    /// EMBEDDED ∧ format 2 ∧ privileges ∧ PG 18 ∧ verdict ∈ {SAME, OLDER}.
    pub restorable: bool,
    pub created_at_utc: Option<String>,
}

impl BundleSummary {
    pub(crate) fn backup_kind(&self) -> &'static str {
        BackupKind::parse(self.validated.backup_kind.as_deref())
    }
}

/// Full validation (every hash) plus stats, schema verdict and
/// restorability. `embedded_mode` is `false` in EXTERNAL mode, where nothing
/// is ever restorable in-app (ruling R10).
pub(crate) fn inspect_bundle(
    dir: &Path,
    embedded_mode: bool,
) -> Result<BundleSummary, EngineError> {
    let validated = backup_proof::validate_bundle(dir).map_err(|error| {
        EngineError::new(
            codes::BACKUP_INTEGRITY_INVALID,
            format!("{}: {}", dir.display(), error),
        )
    })?;
    let (file_count, total_bytes) = canonical_bundle_stats(dir).map_err(|error| {
        EngineError::new(
            codes::BACKUP_INTEGRITY_INVALID,
            format!("{}: bundle stats failed ({error})", dir.display()),
        )
    })?;
    let verdict = schema::classify(
        &validated.schema_version,
        &schema_version::embedded_versions(),
    );
    let restorable = embedded_mode
        && validated.bundle_format_version == BUNDLE_FORMAT_VERSION_2
        && validated.dump_includes_privileges
        && validated.postgres_major_version == backup_proof::REQUIRED_PG_MAJOR_VERSION
        && verdict.is_restorable();
    let created_at_utc = created_at_from(validated.created_at_unix, dir);
    Ok(BundleSummary {
        validated,
        file_count,
        total_bytes,
        verdict,
        restorable,
        created_at_utc,
    })
}

/// RFC3339 from the manifest's `created_at_unix`, else from the canonical
/// folder name, else `None`.
pub(crate) fn created_at_from(created_at_unix: Option<u64>, dir: &Path) -> Option<String> {
    let from_manifest = created_at_unix
        .and_then(|unix| i64::try_from(unix).ok())
        .and_then(|unix| time::OffsetDateTime::from_unix_timestamp(unix).ok());
    let from_name = || {
        dir.file_name()
            .and_then(OsStr::to_str)
            .and_then(|name| parse_bundle_identifier_time(name).ok())
    };
    from_manifest.or_else(from_name).and_then(|stamp| {
        stamp
            .format(&time::format_description::well_known::Rfc3339)
            .ok()
    })
}

fn write_synced(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file =
        fs::File::create(path).map_err(|e| format!("create {} ({e})", path.display()))?;
    file.write_all(bytes)
        .map_err(|e| format!("write {} ({e})", path.display()))?;
    file.sync_all()
        .map_err(|e| format!("sync {} ({e})", path.display()))
}

fn hash_file(path: &Path) -> Result<(String, u64), String> {
    let bytes = fs::read(path).map_err(|e| format!("read {} ({e})", path.display()))?;
    Ok((hash_bytes(&bytes), bytes.len() as u64))
}

fn hash_bytes(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut output = String::with_capacity(digest.len() * 2);
    for byte in digest {
        output.push_str(&format!("{byte:02x}"));
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "sk-bundle-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A staged format 1 bundle with fake dump bytes, exactly what
    /// `backup_proof::create_backup_bundle` hands the engine.
    fn staged_bundle(root: &Path) -> PathBuf {
        let now = parse_bundle_identifier_time("GestStock-Backup-20260919-101500").unwrap();
        backup_proof::create_backup_bundle(
            root,
            now,
            "pg_dump (PostgreSQL) 18.0",
            &backup_proof::BackupInputs::empty(),
            |path| {
                fs::write(path, b"fake-custom-dump-with-acl")
                    .map_err(|_| backup_proof::BackupProofError::Io)
            },
        )
        .unwrap()
    }

    fn latest() -> String {
        schema_version::embedded_latest_version().to_string()
    }

    #[test]
    fn finalize_produces_a_valid_restorable_format_2_bundle() {
        let root = scratch("finalize");
        let bundle = staged_bundle(&root);
        let latest = latest();
        finalize_bundle_metadata(
            &bundle,
            &BundleMetadata {
                schema_version: &latest,
                app_version: "0.5.0",
                kind: BackupKind::Manual,
            },
        )
        .unwrap();

        let manifest: JsonValue = serde_json::from_slice(
            &fs::read(bundle.join(backup_proof::MANIFEST_FILENAME)).unwrap(),
        )
        .unwrap();
        assert_eq!(manifest["bundle_format_version"], 2);
        assert_eq!(manifest["backup_kind"], "MANUAL");
        assert_eq!(manifest["dump_includes_privileges"], true);
        assert_eq!(manifest["source"], "EMBEDDED");
        assert_eq!(manifest["application_version"], "0.5.0");
        assert_eq!(manifest["schema_version"], latest);
        let expected_unix = parse_bundle_identifier_time("GestStock-Backup-20260919-101500")
            .unwrap()
            .unix_timestamp();
        assert_eq!(manifest["created_at_unix"], expected_unix);
        assert_eq!(
            fs::read_to_string(bundle.join(backup_proof::APPLICATION_VERSION_FILENAME)).unwrap(),
            "0.5.0\n"
        );

        let summary = inspect_bundle(&bundle, true).unwrap();
        assert_eq!(summary.validated.bundle_format_version, 2);
        assert!(summary.validated.dump_includes_privileges);
        assert_eq!(summary.verdict, SchemaVerdict::Same);
        assert!(summary.restorable);
        assert_eq!(summary.backup_kind(), "MANUAL");
        assert_eq!(summary.file_count, 6);
        assert_eq!(
            summary.created_at_utc.as_deref(),
            Some("2026-09-19T10:15:00Z")
        );

        let external = inspect_bundle(&bundle, false).unwrap();
        assert!(
            !external.restorable,
            "nothing is restorable in EXTERNAL mode"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn tampering_one_byte_of_a_version_file_fails_inspection() {
        let root = scratch("tamper");
        let bundle = staged_bundle(&root);
        let latest = latest();
        finalize_bundle_metadata(
            &bundle,
            &BundleMetadata {
                schema_version: &latest,
                app_version: "0.5.0",
                kind: BackupKind::Daily,
            },
        )
        .unwrap();
        fs::write(
            bundle.join(backup_proof::APPLICATION_VERSION_FILENAME),
            b"0.5.1\n",
        )
        .unwrap();
        let error = inspect_bundle(&bundle, true).unwrap_err();
        assert_eq!(error.code, codes::BACKUP_INTEGRITY_INVALID);
        assert!(error.log_detail.contains("BACKUP_PROOF_CHECKSUM_MISMATCH"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn newer_and_unknown_schema_versions_are_not_restorable() {
        let root = scratch("verdicts");
        let bundle = staged_bundle(&root);
        finalize_bundle_metadata(
            &bundle,
            &BundleMetadata {
                schema_version: "99999999999999",
                app_version: "0.5.0",
                kind: BackupKind::Manual,
            },
        )
        .unwrap();
        let summary = inspect_bundle(&bundle, true).unwrap();
        assert_eq!(summary.verdict, SchemaVerdict::Newer);
        assert!(!summary.restorable);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn a_legacy_format_1_bundle_inspects_but_is_never_restorable() {
        let root = scratch("legacy");
        let bundle = staged_bundle(&root);
        let summary = inspect_bundle(&bundle, true).unwrap();
        assert_eq!(summary.validated.bundle_format_version, 1);
        assert!(!summary.restorable);
        assert_eq!(summary.backup_kind(), "UNKNOWN");
        assert_eq!(
            summary.verdict,
            SchemaVerdict::Unknown,
            "legacy writer stamps '0'"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn finalize_rejects_a_manifest_without_the_version_entries() {
        let root = scratch("no-entries");
        let bundle = staged_bundle(&root);
        fs::write(
            bundle.join(backup_proof::MANIFEST_FILENAME),
            br#"{"bundle_format_version":1,"files":[]}"#,
        )
        .unwrap();
        let error = finalize_bundle_metadata(
            &bundle,
            &BundleMetadata {
                schema_version: "1",
                app_version: "0.5.0",
                kind: BackupKind::Manual,
            },
        )
        .unwrap_err();
        assert_eq!(error.code, codes::BACKUP_METADATA_WRITE_FAILED);
        fs::write(
            bundle.join(backup_proof::MANIFEST_FILENAME),
            br#"{"bundle_format_version":1}"#,
        )
        .unwrap();
        let error = finalize_bundle_metadata(
            &bundle,
            &BundleMetadata {
                schema_version: "1",
                app_version: "0.5.0",
                kind: BackupKind::Manual,
            },
        )
        .unwrap_err();
        assert_eq!(error.code, codes::BACKUP_METADATA_WRITE_FAILED);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn canonical_bundle_anywhere_accepts_any_parent_and_rejects_bad_names() {
        let root = scratch("anywhere");
        let bundle = staged_bundle(&root);
        let (canonical, name) = canonical_bundle_anywhere(bundle.to_str().unwrap()).unwrap();
        assert_eq!(name, "GestStock-Backup-20260919-101500");
        assert!(canonical.is_dir());
        assert!(!canonical.to_string_lossy().starts_with(r"\\?\"));

        let renamed = root.join("my-backup");
        fs::rename(&bundle, &renamed).unwrap();
        let error = canonical_bundle_anywhere(renamed.to_str().unwrap()).unwrap_err();
        assert_eq!(error.code, codes::BACKUP_BUNDLE_NAME_INVALID);

        let missing = root.join("GestStock-Backup-20260919-101501");
        let error = canonical_bundle_anywhere(missing.to_str().unwrap()).unwrap_err();
        assert_eq!(error.code, codes::BACKUP_BUNDLE_NOT_A_DIRECTORY);

        let file = root.join("GestStock-Backup-20260919-101502");
        fs::write(&file, b"x").unwrap();
        let error = canonical_bundle_anywhere(file.to_str().unwrap()).unwrap_err();
        assert_eq!(error.code, codes::BACKUP_BUNDLE_NOT_A_DIRECTORY);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn backup_kind_parsing_is_closed() {
        assert_eq!(BackupKind::parse(Some("PRE_UPDATE")), "PRE_UPDATE");
        assert_eq!(BackupKind::parse(Some("weird")), "UNKNOWN");
        assert_eq!(BackupKind::parse(None), "UNKNOWN");
        assert_eq!(BackupKind::PreRestore.as_str(), "PRE_RESTORE");
    }

    #[test]
    fn created_at_falls_back_to_the_folder_name() {
        let dir = Path::new("C:/x/GestStock-Backup-20260919-101500");
        assert_eq!(
            created_at_from(None, dir).as_deref(),
            Some("2026-09-19T10:15:00Z")
        );
        assert_eq!(
            created_at_from(Some(0), dir).as_deref(),
            Some("1970-01-01T00:00:00Z")
        );
        assert_eq!(created_at_from(None, Path::new("C:/x/other")), None);
    }
}
