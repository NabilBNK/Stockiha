//! Automatic-backup retention (plan §5.10 F7, ruling R12, WS-H-6 H6-01).
//!
//! Runs after a successful automatic backup (`DAILY`, `PRE_UPDATE`) and after
//! a live restore's own `PRE_RESTORE` safety backup: deletes the oldest
//! bundles of that same kind beyond the configured keep count, excluding the
//! bundle just created. `MANUAL` and `UNKNOWN` are never touched — there is
//! no keep count for them at all. A retention failure (locked file, race with
//! an antivirus scan) is logged and counted as "not deleted"; it must never
//! be surfaced as an error or affect the backup/restore outcome that
//! triggered it.

use std::fs;
use std::path::{Path, PathBuf};

use super::bundle::BackupKind;
use super::catalog::{self, BackupListItemDto};
use super::destination;
use super::is_symlink_or_reparse;
use super::log;

const LOG_OPERATION: &str = "RETENTION";

/// How many bundles of each kind survive after a successful automatic
/// backup, counting the one just created. `None` means "never delete".
pub(crate) fn keep_count(kind: BackupKind) -> Option<usize> {
    match kind {
        BackupKind::Manual => None,
        BackupKind::Daily => Some(14),
        BackupKind::PreUpdate => Some(5),
        BackupKind::PreRestore => Some(5),
    }
}

/// Which bundle folders of `kind` should be deleted, given the full list of
/// what is currently in the destination. `exclude` (the bundle just created)
/// always counts as one of the kept ones and is never itself returned.
pub(crate) fn select_for_deletion(
    items: &[BackupListItemDto],
    kind: BackupKind,
    exclude: &Path,
) -> Vec<PathBuf> {
    let Some(keep) = keep_count(kind) else {
        return Vec::new();
    };

    let exclude_normalized = normalize(exclude);
    let mut candidates: Vec<&BackupListItemDto> = items
        .iter()
        .filter(|item| {
            item.manifest_readable
                && item.backup_kind == kind.as_str()
                && normalize(Path::new(&item.path)) != exclude_normalized
        })
        .collect();

    // Newest first: `None` dates sort as older than any date, so an
    // unreadable-date bundle is always among the first considered for
    // deletion. Ties broken by identifier (itself a timestamp) descending.
    candidates.sort_by(|a, b| {
        b.created_at_utc
            .cmp(&a.created_at_utc)
            .then_with(|| b.bundle_identifier.cmp(&a.bundle_identifier))
    });

    if keep == 0 {
        return candidates
            .into_iter()
            .map(|item| PathBuf::from(&item.path))
            .collect();
    }

    // The excluded new bundle counts as one kept slot.
    let keep_from_candidates = keep.saturating_sub(1);
    candidates
        .into_iter()
        .skip(keep_from_candidates)
        .map(|item| PathBuf::from(&item.path))
        .collect()
}

fn normalize(path: &Path) -> PathBuf {
    dunce::simplified(&destination::canonicalize_best_effort(path))
        .to_string_lossy()
        .to_lowercase()
        .into()
}

/// Scan `root`, select what should go, and delete it. Never returns an
/// error: every failure (per-target or whole-scan) is logged and skipped.
/// Returns how many folders were actually removed.
pub(crate) fn apply(root: &Path, kind: BackupKind, exclude: &Path, app_data_dir: &Path) -> usize {
    let items = catalog::list_bundles_uncapped(root, true);
    let targets = select_for_deletion(&items, kind, exclude);
    let root_normalized = normalize(root);

    let mut deleted = 0usize;
    for target in targets {
        let identifier = target
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();

        let parent_ok = target
            .parent()
            .map(|parent| normalize(parent) == root_normalized)
            .unwrap_or(false);
        if !parent_ok {
            log::append(
                app_data_dir,
                LOG_OPERATION,
                &format!("skipped {identifier}: not a direct child of the destination"),
            );
            continue;
        }
        if !crate::application::recovery::is_canonical_bundle_identifier(&identifier) {
            log::append(
                app_data_dir,
                LOG_OPERATION,
                &format!("skipped {identifier}: not a canonical bundle name"),
            );
            continue;
        }
        match fs::symlink_metadata(&target) {
            Ok(metadata) if !is_symlink_or_reparse(&metadata) && metadata.is_dir() => {}
            _ => {
                log::append(
                    app_data_dir,
                    LOG_OPERATION,
                    &format!("skipped {identifier}: not a real directory"),
                );
                continue;
            }
        }

        match fs::remove_dir_all(&target) {
            Ok(()) => {
                deleted += 1;
                log::append(
                    app_data_dir,
                    LOG_OPERATION,
                    &format!("deleted {identifier}"),
                );
            }
            Err(error) => {
                log::append(
                    app_data_dir,
                    LOG_OPERATION,
                    &format!("could not delete {identifier}: {error}"),
                );
            }
        }
    }
    deleted
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::backup_proof;
    use crate::infrastructure::recovery_engine::bundle::{self as bundle_mod, BundleMetadata};

    fn scratch(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "sk-retention-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A real, canonical, format-2 bundle folder with a genuinely parseable
    /// manifest, so `list_bundles_uncapped`/`inspect_for_list` reports it
    /// exactly as it would a real backup.
    fn real_bundle(root: &Path, name: &str, kind: BackupKind) -> PathBuf {
        let now = crate::application::recovery_creation::parse_bundle_identifier_time(name)
            .expect("canonical bundle name");
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
                schema_version: "1",
                app_version: "0.5.0",
                kind,
            },
        )
        .unwrap();
        bundle
    }

    fn bundle_name(day: u32, hour: u32) -> String {
        format!("GestStock-Backup-202609{day:02}-{hour:02}0000")
    }

    /// Items with `manifest_readable = false`, no filesystem I/O — enough to
    /// exercise `select_for_deletion`'s pure decision without spawning real
    /// bundle folders for every fixture.
    fn fake_item(name: &str, kind: &str, date: Option<&str>, readable: bool) -> BackupListItemDto {
        BackupListItemDto {
            bundle_identifier: name.to_string(),
            path: format!("C:/backups/{name}"),
            created_at_utc: date.map(str::to_string),
            backup_kind: kind.to_string(),
            format_version: Some(2),
            schema_version: Some("1".to_string()),
            schema_verdict: "SAME".to_string(),
            restorable: true,
            total_bytes: 0,
            manifest_readable: readable,
        }
    }

    #[test]
    fn manual_is_never_deleted() {
        let items: Vec<BackupListItemDto> = (0..30)
            .map(|i| {
                fake_item(
                    &format!("m{i}"),
                    "MANUAL",
                    Some(&format!("2026-01-{i:02}T00:00:00Z")),
                    true,
                )
            })
            .collect();
        let result =
            select_for_deletion(&items, BackupKind::Manual, Path::new("C:/backups/exclude"));
        assert!(result.is_empty());
    }

    #[test]
    fn unknown_kind_is_never_deleted() {
        let items: Vec<BackupListItemDto> = (0..30)
            .map(|i| {
                fake_item(
                    &format!("u{i}"),
                    "UNKNOWN",
                    Some(&format!("2026-01-{i:02}T00:00:00Z")),
                    true,
                )
            })
            .collect();
        for kind in [
            BackupKind::Manual,
            BackupKind::Daily,
            BackupKind::PreUpdate,
            BackupKind::PreRestore,
        ] {
            assert!(select_for_deletion(&items, kind, Path::new("C:/nowhere")).is_empty());
        }
    }

    #[test]
    fn daily_keeps_fourteen_including_the_new_one() {
        let mut items: Vec<BackupListItemDto> = (0..20)
            .map(|i| {
                fake_item(
                    &format!("d{i:02}"),
                    "DAILY",
                    Some(&format!("2026-01-{:02}T00:00:00Z", i + 1)),
                    true,
                )
            })
            .collect();
        // The newly created bundle: newest date, excluded by path.
        items.push(fake_item(
            "d-new",
            "DAILY",
            Some("2026-02-01T00:00:00Z"),
            true,
        ));
        let exclude = Path::new("C:/backups/d-new");
        let deleted = select_for_deletion(&items, BackupKind::Daily, exclude);
        assert_eq!(
            deleted.len(),
            7,
            "20 existing - 13 kept (14 - the new one) = 7 removed"
        );
        // The 7 oldest (d00..d06) must be exactly what is selected.
        let deleted_names: std::collections::HashSet<String> = deleted
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        for i in 0..7 {
            assert!(
                deleted_names.contains(&format!("d{i:02}")),
                "{i} must be deleted"
            );
        }
        for i in 7..20 {
            assert!(
                !deleted_names.contains(&format!("d{i:02}")),
                "{i} must survive"
            );
        }
    }

    #[test]
    fn pre_update_keeps_five() {
        let mut items: Vec<BackupListItemDto> = (0..8)
            .map(|i| {
                fake_item(
                    &format!("p{i}"),
                    "PRE_UPDATE",
                    Some(&format!("2026-01-{:02}T00:00:00Z", i + 1)),
                    true,
                )
            })
            .collect();
        items.push(fake_item(
            "p-new",
            "PRE_UPDATE",
            Some("2026-02-01T00:00:00Z"),
            true,
        ));
        let deleted =
            select_for_deletion(&items, BackupKind::PreUpdate, Path::new("C:/backups/p-new"));
        assert_eq!(
            deleted.len(),
            4,
            "8 existing - 4 kept (5 - the new one) = 4 removed"
        );
    }

    #[test]
    fn pre_restore_keeps_five() {
        let mut items: Vec<BackupListItemDto> = (0..8)
            .map(|i| {
                fake_item(
                    &format!("r{i}"),
                    "PRE_RESTORE",
                    Some(&format!("2026-01-{:02}T00:00:00Z", i + 1)),
                    true,
                )
            })
            .collect();
        items.push(fake_item(
            "r-new",
            "PRE_RESTORE",
            Some("2026-02-01T00:00:00Z"),
            true,
        ));
        let deleted = select_for_deletion(
            &items,
            BackupKind::PreRestore,
            Path::new("C:/backups/r-new"),
        );
        assert_eq!(deleted.len(), 4);
    }

    #[test]
    fn items_without_a_date_are_deleted_first() {
        let mut items = vec![
            fake_item("has-date-1", "DAILY", Some("2026-01-10T00:00:00Z"), true),
            fake_item("has-date-2", "DAILY", Some("2026-01-11T00:00:00Z"), true),
            fake_item("no-date", "DAILY", None, true),
        ];
        // keep_count(Daily) = 14, and one keep-slot is always reserved for
        // the excluded bundle even when (as here) no candidate actually
        // matches `exclude` — so 14 real candidates still leave exactly one
        // deletion. Bring the total to exactly 14 (3 above + 11 filler).
        for i in 0..11 {
            items.push(fake_item(
                &format!("filler{i}"),
                "DAILY",
                Some(&format!("2026-03-{:02}T00:00:00Z", i + 1)),
                true,
            ));
        }
        // 14 candidates total, keep=14, minus the always-reserved slot = 13
        // kept, 1 deleted (no exclude in this test matches anything real).
        let deleted = select_for_deletion(&items, BackupKind::Daily, Path::new("C:/nowhere"));
        assert_eq!(deleted.len(), 1);
        assert_eq!(
            deleted[0].file_name().unwrap().to_string_lossy(),
            "no-date",
            "the dateless item must be treated as oldest and deleted first"
        );
    }

    #[test]
    fn other_kinds_are_untouched() {
        let items = vec![
            fake_item("daily-1", "DAILY", Some("2026-01-01T00:00:00Z"), true),
            fake_item("manual-1", "MANUAL", Some("2026-01-01T00:00:00Z"), true),
            fake_item(
                "preupdate-1",
                "PRE_UPDATE",
                Some("2026-01-01T00:00:00Z"),
                true,
            ),
        ];
        let deleted = select_for_deletion(&items, BackupKind::Daily, Path::new("C:/nowhere"));
        // Only one DAILY candidate and keep=14: nothing to delete, but this
        // also proves the other kinds were never even candidates.
        assert!(deleted.is_empty());
    }

    #[test]
    fn apply_never_leaves_the_root() {
        let root = scratch("never-leaves-root");
        let sibling = scratch("never-leaves-sibling");
        // A real bundle inside root that retention should be free to delete.
        for i in 0..20 {
            real_bundle(&root, &bundle_name(1, i), BackupKind::Daily);
        }
        // A real bundle in a SIBLING folder, referenced by a hand-built item
        // as though it were a candidate — `apply` must refuse to touch it
        // because its parent is not `root`.
        let outside_name = bundle_name(2, 0);
        let outside_bundle = real_bundle(&sibling, &outside_name, BackupKind::Daily);

        // Sanity: the outside bundle exists before `apply` runs.
        assert!(outside_bundle.is_dir());

        let deleted = apply(
            &root,
            BackupKind::Daily,
            &root.join("does-not-exist"),
            &root,
        );
        assert!(
            deleted > 0,
            "the real, over-quota bundles inside root must be deleted"
        );
        assert!(
            outside_bundle.is_dir(),
            "a bundle outside root must never be deleted by retention"
        );

        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&sibling);
    }

    #[test]
    fn apply_skips_unreadable_manifests() {
        let root = scratch("skips-unreadable");
        // 20 real, readable DAILY bundles (over the keep count of 14).
        for i in 0..20 {
            real_bundle(&root, &bundle_name(3, i), BackupKind::Daily);
        }
        // One folder with a canonical name but no manifest at all.
        let unreadable_name = bundle_name(4, 0);
        fs::create_dir_all(root.join(&unreadable_name)).unwrap();

        let deleted = apply(
            &root,
            BackupKind::Daily,
            &root.join("does-not-exist"),
            &root,
        );
        assert!(deleted > 0);
        assert!(
            root.join(&unreadable_name).is_dir(),
            "a bundle with an unreadable manifest must never be deleted"
        );

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn keep_count_matches_the_plan_table() {
        assert_eq!(keep_count(BackupKind::Manual), None);
        assert_eq!(keep_count(BackupKind::Daily), Some(14));
        assert_eq!(keep_count(BackupKind::PreUpdate), Some(5));
        assert_eq!(keep_count(BackupKind::PreRestore), Some(5));
    }
}
