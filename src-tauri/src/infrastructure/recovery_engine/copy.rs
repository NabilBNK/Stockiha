//! Copy a bundle to another folder (plan H4-02) — the "onto a USB stick"
//! path. Validates the source fully, stages the copy under a hidden name on
//! the *target* volume (so the final `rename` never crosses a volume
//! boundary), then validates the copy — hashes and all — before publishing
//! it. That final validation is the whole point: it is what proves a USB
//! copy is actually good, not merely that the bytes were written.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use super::bundle::{self, BundleSummary};
use super::errors::{codes, EngineError};
use super::is_symlink_or_reparse;
use crate::infrastructure::backup_proof;
use crate::infrastructure::pg_process;

/// 10% margin over the source's own reported size, plus a fixed 10 MB for
/// filesystem overhead — generous enough that a copy never fails on space
/// right after `total_bytes` said it would fit.
const COPY_SPACE_MARGIN_NUMERATOR: u64 = 11;
const COPY_SPACE_MARGIN_DENOMINATOR: u64 = 10;
const COPY_SPACE_FIXED_MARGIN_BYTES: u64 = 10 * 1024 * 1024;

struct CopyStageGuard(PathBuf);

impl Drop for CopyStageGuard {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// Copy the bundle at `source` into `target_dir`. Returns the final path and
/// the (validated) total byte count.
pub(crate) fn copy_bundle(source: &Path, target_dir: &Path) -> Result<(PathBuf, u64), EngineError> {
    // 1. Full validation of the source (this is what makes the corrupted-
    //    source case fail loudly instead of copying garbage).
    let source_summary = bundle::inspect_bundle(source, false).map_err(|error| {
        EngineError::new(
            codes::COPY_SOURCE_INVALID,
            format!(
                "{}: {} - {}",
                source.display(),
                error.code,
                error.log_detail
            ),
        )
    })?;
    let name = source_summary.validated.bundle_dir.file_name().map_or_else(
        || "backup".to_string(),
        |n| n.to_string_lossy().into_owned(),
    );

    // 2. Target must be a real, existing directory.
    let target_metadata = fs::symlink_metadata(target_dir).map_err(|e| {
        EngineError::new(
            codes::COPY_TARGET_INVALID,
            format!("{} ({e})", target_dir.display()),
        )
    })?;
    if is_symlink_or_reparse(&target_metadata) || !target_metadata.is_dir() {
        return Err(EngineError::new(
            codes::COPY_TARGET_INVALID,
            format!("{} is not a real directory", target_dir.display()),
        ));
    }

    // 3. Refuse copying a bundle onto its own parent folder.
    let canonical_target = target_dir
        .canonicalize()
        .unwrap_or_else(|_| target_dir.to_path_buf());
    let canonical_target = dunce::simplified(&canonical_target).to_path_buf();
    if let Some(source_parent) = source_summary.validated.bundle_dir.parent() {
        let canonical_source_parent = source_parent
            .canonicalize()
            .unwrap_or_else(|_| source_parent.to_path_buf());
        let canonical_source_parent = dunce::simplified(&canonical_source_parent).to_path_buf();
        if lowercase_eq(&canonical_target, &canonical_source_parent) {
            return Err(EngineError::new(
                codes::COPY_TARGET_INVALID,
                "target folder is the source bundle's own parent folder".to_string(),
            ));
        }
    }

    // 4. Final path must not already exist.
    let final_path = target_dir.join(&name);
    if final_path.exists() {
        return Err(EngineError::new(
            codes::COPY_TARGET_EXISTS,
            format!("{} already exists", final_path.display()),
        ));
    }

    // 5. Free space on the target volume.
    let required = source_summary
        .total_bytes
        .saturating_mul(COPY_SPACE_MARGIN_NUMERATOR)
        .checked_div(COPY_SPACE_MARGIN_DENOMINATOR)
        .unwrap_or(source_summary.total_bytes)
        .saturating_add(COPY_SPACE_FIXED_MARGIN_BYTES);
    match pg_process::free_disk_space_bytes(target_dir) {
        Some(free) if free >= required => {}
        _ => {
            return Err(EngineError::new(
                codes::BACKUP_INSUFFICIENT_SPACE,
                format!(
                    "need {required} bytes free on {}, source is {} bytes",
                    target_dir.display(),
                    source_summary.total_bytes
                ),
            ));
        }
    }

    // 6. Stage on the target volume (so the final rename is same-volume).
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temp_path = target_dir.join(format!(".{name}.copying-{nanos}"));
    fs::create_dir(&temp_path).map_err(|e| {
        EngineError::new(
            codes::COPY_IO_FAILED,
            format!("create {} ({e})", temp_path.display()),
        )
    })?;
    let _guard = CopyStageGuard(temp_path.clone());

    // 7. Copy every top-level file and the three flat asset directories.
    copy_flat_files(&source_summary.validated.bundle_dir, &temp_path)?;

    // 8. Validate the copy — hashes and all. This is the proof.
    let copy_summary: BundleSummary =
        bundle::inspect_bundle(&temp_path, false).map_err(|error| {
            EngineError::new(
                codes::COPY_VALIDATION_FAILED,
                format!(
                    "{}: {} - {}",
                    temp_path.display(),
                    error.code,
                    error.log_detail
                ),
            )
        })?;

    // 9. Publish.
    if final_path.exists() {
        return Err(EngineError::new(
            codes::COPY_TARGET_EXISTS,
            format!("{} appeared during copy", final_path.display()),
        ));
    }
    fs::rename(&temp_path, &final_path).map_err(|e| {
        EngineError::new(
            codes::COPY_IO_FAILED,
            format!("rename to {} failed ({e})", final_path.display()),
        )
    })?;

    Ok((final_path, copy_summary.total_bytes))
}

fn lowercase_eq(a: &Path, b: &Path) -> bool {
    a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
}

/// Copy the six top-level bundle files and the regular files inside the
/// three flat asset directories — never a symlink, matching the bundle
/// format's own flat, non-recursive layout.
fn copy_flat_files(source_dir: &Path, dest_dir: &Path) -> Result<(), EngineError> {
    for file_name in [
        backup_proof::DUMP_FILENAME,
        backup_proof::MANIFEST_FILENAME,
        backup_proof::CHECKSUMS_FILENAME,
        backup_proof::SCHEMA_VERSION_FILENAME,
        backup_proof::APPLICATION_VERSION_FILENAME,
        backup_proof::POSTGRES_VERSION_FILENAME,
    ] {
        copy_one_file(&source_dir.join(file_name), &dest_dir.join(file_name))?;
    }
    for dir_name in [
        backup_proof::ATTACHMENTS_DIR,
        backup_proof::GENERATED_DOCUMENTS_DIR,
        backup_proof::COMPANY_ASSETS_DIR,
    ] {
        let source_subdir = source_dir.join(dir_name);
        let dest_subdir = dest_dir.join(dir_name);
        fs::create_dir_all(&dest_subdir).map_err(|e| {
            EngineError::new(
                codes::COPY_IO_FAILED,
                format!("create {} ({e})", dest_subdir.display()),
            )
        })?;
        let entries = fs::read_dir(&source_subdir).map_err(|e| {
            EngineError::new(
                codes::COPY_IO_FAILED,
                format!("read {} ({e})", source_subdir.display()),
            )
        })?;
        for entry in entries {
            let entry = entry.map_err(|e| {
                EngineError::new(codes::COPY_IO_FAILED, format!("read entry ({e})"))
            })?;
            let metadata = fs::symlink_metadata(entry.path()).map_err(|e| {
                EngineError::new(
                    codes::COPY_IO_FAILED,
                    format!("metadata {} ({e})", entry.path().display()),
                )
            })?;
            if is_symlink_or_reparse(&metadata) || !metadata.is_file() {
                continue;
            }
            let dest_file = dest_subdir.join(entry.file_name());
            copy_one_file(&entry.path(), &dest_file)?;
        }
    }
    Ok(())
}

fn copy_one_file(source: &Path, dest: &Path) -> Result<(), EngineError> {
    fs::copy(source, dest).map_err(|e| {
        EngineError::new(
            codes::COPY_IO_FAILED,
            format!("copy {} -> {} ({e})", source.display(), dest.display()),
        )
    })?;
    let file = fs::OpenOptions::new().write(true).open(dest).map_err(|e| {
        EngineError::new(
            codes::COPY_IO_FAILED,
            format!("reopen {} for sync ({e})", dest.display()),
        )
    })?;
    file.sync_all().map_err(|e| {
        EngineError::new(
            codes::COPY_IO_FAILED,
            format!("sync {} ({e})", dest.display()),
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::recovery_engine::bundle::{BackupKind, BundleMetadata};

    fn scratch(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "sk-copy-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn real_bundle(root: &Path, name: &str) -> PathBuf {
        let now =
            crate::application::recovery_creation::parse_bundle_identifier_time(name).unwrap();
        let bundle = backup_proof::create_backup_bundle(
            root,
            now,
            "pg_dump (PostgreSQL) 18.0",
            &backup_proof::BackupInputs::empty(),
            |path| {
                fs::write(path, b"fake-dump-bytes").map_err(|_| backup_proof::BackupProofError::Io)
            },
        )
        .unwrap();
        bundle::finalize_bundle_metadata(
            &bundle,
            &BundleMetadata {
                schema_version: "1",
                app_version: "0.5.0",
                kind: BackupKind::Manual,
            },
        )
        .unwrap();
        bundle
    }

    #[test]
    fn happy_path_copies_and_validates() {
        let root = scratch("happy");
        let source_root = root.join("source");
        let target = root.join("target");
        fs::create_dir_all(&source_root).unwrap();
        fs::create_dir_all(&target).unwrap();
        let source = real_bundle(&source_root, "GestStock-Backup-20260919-101500");

        let (final_path, total_bytes) = copy_bundle(&source, &target).unwrap();
        assert!(final_path.starts_with(&target));
        assert!(total_bytes > 0);
        assert!(backup_proof::validate_bundle(&final_path).is_ok());
        assert!(
            !fs::read_dir(&target).unwrap().any(|e| e
                .unwrap()
                .file_name()
                .to_string_lossy()
                .contains(".copying-")),
            "no staging folder may remain"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn target_already_containing_the_bundle_name_is_refused() {
        let root = scratch("exists");
        let source_root = root.join("source");
        let target = root.join("target");
        fs::create_dir_all(&source_root).unwrap();
        fs::create_dir_all(&target).unwrap();
        let source = real_bundle(&source_root, "GestStock-Backup-20260919-101500");
        fs::create_dir_all(target.join("GestStock-Backup-20260919-101500")).unwrap();

        let error = copy_bundle(&source, &target).unwrap_err();
        assert_eq!(error.code, codes::COPY_TARGET_EXISTS);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn a_corrupted_source_is_refused_before_any_copy() {
        let root = scratch("corrupt");
        let source_root = root.join("source");
        let target = root.join("target");
        fs::create_dir_all(&source_root).unwrap();
        fs::create_dir_all(&target).unwrap();
        let source = real_bundle(&source_root, "GestStock-Backup-20260919-101500");
        fs::write(source.join(backup_proof::DUMP_FILENAME), b"tampered").unwrap();

        let error = copy_bundle(&source, &target).unwrap_err();
        assert_eq!(error.code, codes::COPY_SOURCE_INVALID);
        assert_eq!(
            fs::read_dir(&target).unwrap().count(),
            0,
            "nothing must be created in the target"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn a_missing_target_directory_is_refused() {
        let root = scratch("no-target");
        let source_root = root.join("source");
        fs::create_dir_all(&source_root).unwrap();
        let source = real_bundle(&source_root, "GestStock-Backup-20260919-101500");
        let missing_target = root.join("does-not-exist");

        let error = copy_bundle(&source, &missing_target).unwrap_err();
        assert_eq!(error.code, codes::COPY_TARGET_INVALID);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn copying_onto_the_bundles_own_parent_is_refused() {
        let root = scratch("self-copy");
        let source_root = root.join("source");
        fs::create_dir_all(&source_root).unwrap();
        let source = real_bundle(&source_root, "GestStock-Backup-20260919-101500");

        let error = copy_bundle(&source, &source_root).unwrap_err();
        assert_eq!(error.code, codes::COPY_TARGET_INVALID);
        let _ = fs::remove_dir_all(root);
    }
}
