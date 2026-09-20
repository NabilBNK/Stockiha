//! Backup list (plan H4-01) — a read-only folder scan, advisory only.
//!
//! Never hashes: a 2 GB dump would freeze the screen. The real operations
//! (validate, test, copy, restore) always re-validate fully through
//! `bundle::inspect_bundle` / `backup_proof::validate_bundle` — this list
//! exists only to show what is there and let the operator pick one.

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;

use super::bundle::BackupKind;
use super::is_symlink_or_reparse;
use super::schema::{self, SchemaVerdict};
use crate::application::recovery::is_canonical_bundle_identifier;
use crate::infrastructure::backup_proof;
use crate::infrastructure::schema_version;

/// A folder with 500 bundles is a real, if unusual, shop history; showing
/// more than this would make the list itself slow to render and scroll.
pub(crate) const MAX_LIST_ITEMS: usize = 200;

/// `manifest.json` larger than this is treated as unreadable rather than
/// parsed — a legitimate manifest never approaches this size (it lists file
/// names and hashes, not payload), so a file this large is either corrupt or
/// hostile, and parsing it would block the UI thread pointlessly.
pub(crate) const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BackupListItemDto {
    /// Folder name.
    pub bundle_identifier: String,
    /// Absolute folder path, `dunce`-simplified.
    pub path: String,
    /// From the manifest's `created_at_unix`, else parsed from the name.
    pub created_at_utc: Option<String>,
    pub backup_kind: String,
    pub format_version: Option<u32>,
    pub schema_version: Option<String>,
    pub schema_verdict: String,
    pub restorable: bool,
    /// Sum of `files[].size_bytes` in the manifest. No hashing.
    pub total_bytes: u64,
    pub manifest_readable: bool,
}

/// List every canonically named bundle folder directly inside `root`,
/// newest first, capped at [`MAX_LIST_ITEMS`]. `root` missing, unreadable,
/// or empty is not an error — it is simply an empty list (plan edge case).
pub(crate) fn list_bundles(root: &Path, embedded_mode: bool) -> Vec<BackupListItemDto> {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(e) => {
            tracing::warn!("backup list: could not read {} ({e})", root.display());
            return Vec::new();
        }
    };

    let mut items: Vec<BackupListItemDto> = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        // Hidden-by-convention staging/copying folders (`.<name>.staging-*`,
        // `.<name>.copying-*`) and anything else non-canonical are skipped
        // silently — they are not backups yet, or no longer.
        if !is_canonical_bundle_identifier(name) {
            continue;
        }
        let path = entry.path();
        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };
        if is_symlink_or_reparse(&metadata) || !metadata.is_dir() {
            continue;
        }
        items.push(inspect_for_list(&path, name, embedded_mode));
    }

    items.sort_by(|a, b| {
        // Descending by date (`None` sorts last), then descending by name
        // (the name is itself a timestamp, so this is a stable tiebreak for
        // equal or missing dates).
        b.created_at_utc
            .cmp(&a.created_at_utc)
            .then_with(|| b.bundle_identifier.cmp(&a.bundle_identifier))
    });
    items.truncate(MAX_LIST_ITEMS);
    items
}

/// Same as [`list_bundles`] but uncapped — used by retention (WS-H-6), which
/// must see every bundle of a given kind, not just the newest 200.
pub(crate) fn list_bundles_uncapped(root: &Path, embedded_mode: bool) -> Vec<BackupListItemDto> {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(_) => return Vec::new(),
    };
    let mut items: Vec<BackupListItemDto> = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if !is_canonical_bundle_identifier(name) {
            continue;
        }
        let path = entry.path();
        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };
        if is_symlink_or_reparse(&metadata) || !metadata.is_dir() {
            continue;
        }
        items.push(inspect_for_list(&path, name, embedded_mode));
    }
    items.sort_by(|a, b| {
        b.created_at_utc
            .cmp(&a.created_at_utc)
            .then_with(|| b.bundle_identifier.cmp(&a.bundle_identifier))
    });
    items
}

fn unreadable_item(path: &Path, name: &str) -> BackupListItemDto {
    BackupListItemDto {
        bundle_identifier: name.to_string(),
        path: dunce::simplified(path).to_string_lossy().into_owned(),
        created_at_utc: super::bundle::created_at_from(None, path),
        backup_kind: "UNKNOWN".to_string(),
        format_version: None,
        schema_version: None,
        schema_verdict: SchemaVerdict::Unknown.as_str().to_string(),
        restorable: false,
        total_bytes: 0,
        manifest_readable: false,
    }
}

fn inspect_for_list(path: &Path, name: &str, embedded_mode: bool) -> BackupListItemDto {
    let manifest_path = path.join(backup_proof::MANIFEST_FILENAME);
    let metadata = match fs::metadata(&manifest_path) {
        Ok(m) => m,
        Err(_) => return unreadable_item(path, name),
    };
    if !metadata.is_file() || metadata.len() > MAX_MANIFEST_BYTES {
        return unreadable_item(path, name);
    }
    let Ok(bytes) = fs::read(&manifest_path) else {
        return unreadable_item(path, name);
    };
    let Ok(manifest) = serde_json::from_slice::<JsonValue>(&bytes) else {
        return unreadable_item(path, name);
    };

    let format_version = manifest
        .get("bundle_format_version")
        .and_then(JsonValue::as_u64)
        .map(|v| v as u32);
    let schema_version = manifest
        .get("schema_version")
        .and_then(JsonValue::as_str)
        .map(str::to_string);
    let backup_kind = BackupKind::parse(manifest.get("backup_kind").and_then(JsonValue::as_str));
    let dump_includes_privileges = manifest
        .get("dump_includes_privileges")
        .and_then(JsonValue::as_bool)
        .unwrap_or(false);
    let created_at_unix = manifest.get("created_at_unix").and_then(JsonValue::as_u64);
    let total_bytes = manifest
        .get("files")
        .and_then(JsonValue::as_array)
        .map(|files| {
            files
                .iter()
                .filter_map(|entry| entry.get("size_bytes").and_then(JsonValue::as_u64))
                .sum()
        })
        .unwrap_or(0);

    let verdict = schema_version
        .as_deref()
        .map(|v| schema::classify(v, &schema_version::embedded_versions()))
        .unwrap_or(SchemaVerdict::Unknown);
    // Same formula as `bundle::inspect_bundle`, without the hash check
    // (this list never hashes — see the module doc comment).
    let restorable = embedded_mode
        && format_version == Some(super::bundle::BUNDLE_FORMAT_VERSION_2)
        && dump_includes_privileges
        && verdict.is_restorable();

    BackupListItemDto {
        bundle_identifier: name.to_string(),
        path: dunce::simplified(path).to_string_lossy().into_owned(),
        created_at_utc: super::bundle::created_at_from(created_at_unix, path),
        backup_kind: backup_kind.to_string(),
        format_version,
        schema_version,
        schema_verdict: verdict.as_str().to_string(),
        restorable,
        total_bytes,
        manifest_readable: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::backup_proof;
    use std::fs;

    fn scratch(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "sk-catalog-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    use crate::infrastructure::recovery_engine::bundle::{self as bundle_mod, BundleMetadata};

    /// A minimal, real format 2 bundle (built via `backup_proof` +
    /// `bundle::finalize_bundle_metadata`), for list tests that need a
    /// genuinely parseable manifest.
    fn real_bundle(root: &Path, name: &str, kind: BackupKind, schema_version: &str) {
        let now =
            crate::application::recovery_creation::parse_bundle_identifier_time(name).unwrap();
        let bundle = backup_proof::create_backup_bundle(
            root,
            now,
            "pg_dump (PostgreSQL) 18.0",
            &backup_proof::BackupInputs::empty(),
            |path| fs::write(path, b"fake-dump").map_err(|_| backup_proof::BackupProofError::Io),
        )
        .unwrap();
        bundle_mod::finalize_bundle_metadata(
            &bundle,
            &BundleMetadata {
                schema_version,
                app_version: "0.5.0",
                kind,
            },
        )
        .unwrap();
    }

    #[test]
    fn a_missing_destination_folder_is_an_empty_list_not_an_error() {
        let missing = std::env::temp_dir().join("sk-catalog-does-not-exist-anywhere");
        assert_eq!(list_bundles(&missing, true), Vec::new());
    }

    #[test]
    fn non_canonical_and_hidden_staging_names_are_skipped() {
        let root = scratch("skip");
        fs::create_dir_all(root.join("not-a-backup")).unwrap();
        fs::create_dir_all(root.join(".GestStock-Backup-20260919-101500.staging-1")).unwrap();
        fs::write(
            root.join("GestStock-Backup-20260919-101500"),
            b"a file, not a dir",
        )
        .unwrap();
        assert_eq!(list_bundles(&root, true), Vec::new());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn an_unreadable_manifest_is_reported_not_hidden() {
        let root = scratch("unreadable");
        let name = "GestStock-Backup-20260919-101500";
        fs::create_dir_all(root.join(name)).unwrap();
        // No manifest.json at all.
        let items = list_bundles(&root, true);
        assert_eq!(items.len(), 1);
        assert!(!items[0].manifest_readable);
        assert_eq!(items[0].backup_kind, "UNKNOWN");
        assert_eq!(items[0].schema_verdict, "UNKNOWN");
        assert!(!items[0].restorable);
        assert_eq!(items[0].total_bytes, 0);
        // Falls back to the name for the date.
        assert_eq!(
            items[0].created_at_utc.as_deref(),
            Some("2026-09-19T10:15:00Z")
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn ordering_is_newest_first_by_date_then_name() {
        let root = scratch("order");
        real_bundle(
            &root,
            "GestStock-Backup-20260919-101500",
            BackupKind::Manual,
            "1",
        );
        real_bundle(
            &root,
            "GestStock-Backup-20260919-121500",
            BackupKind::Daily,
            "1",
        );
        let items = list_bundles(&root, true);
        assert_eq!(items.len(), 2);
        assert_eq!(
            items[0].bundle_identifier,
            "GestStock-Backup-20260919-121500"
        );
        assert_eq!(
            items[1].bundle_identifier,
            "GestStock-Backup-20260919-101500"
        );
        assert_eq!(items[0].backup_kind, "DAILY");
        assert_eq!(items[1].backup_kind, "MANUAL");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn the_list_is_capped_at_max_list_items() {
        let root = scratch("cap");
        // Vary hour *and* minute (not just hour) so every generated name
        // stays within the fixed two-digit HHMMSS fields the canonical
        // identifier requires — 205 distinct minutes fits easily in one day.
        for n in 0..(MAX_LIST_ITEMS + 5) {
            let hour = n / 60;
            let minute = n % 60;
            let name = format!("GestStock-Backup-20260919-{hour:02}{minute:02}00");
            fs::create_dir_all(root.join(&name)).unwrap();
        }
        let items = list_bundles(&root, true);
        assert_eq!(items.len(), MAX_LIST_ITEMS);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn embedded_mode_gates_restorable_but_external_mode_never_is() {
        let root = scratch("restorable");
        real_bundle(
            &root,
            "GestStock-Backup-20260919-101500",
            BackupKind::Manual,
            &schema_version::embedded_latest_version().to_string(),
        );
        let embedded = list_bundles(&root, true);
        assert!(embedded[0].restorable);
        let external = list_bundles(&root, false);
        assert!(
            !external[0].restorable,
            "ruling R10: nothing is restorable in EXTERNAL mode"
        );
        let _ = fs::remove_dir_all(root);
    }
}
