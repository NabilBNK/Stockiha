//! Backup destination rules for EMBEDDED mode (plan §5.5, ruling R11).
//!
//! - No stored setting → the default `<app_data_dir>\operator-backups`,
//!   created on demand.
//! - A stored setting that is unusable right now (USB unplugged) fails a
//!   manual backup with `BACKUP_DESTINATION_UNAVAILABLE`; an automatic
//!   backup falls back to the default folder and says so.
//! - Saving a destination is refused inside the live data folder or the
//!   install/resource folder (replaced by updates), and the folder must be
//!   creatable and writable (probe file).
//!
//! Path comparisons are case-insensitive on Windows, on the `dunce`-
//! simplified canonical form — never on the raw string the user typed, and
//! never stored back in canonical form (the SQL function keeps the user's
//! trimmed path).

use std::fs;
use std::path::{Path, PathBuf};

use super::errors::{codes, EngineError};
use super::is_symlink_or_reparse;
use super::mode::EmbeddedRecoveryContext;

pub(crate) const DEFAULT_DESTINATION_DIR: &str = "operator-backups";

const WRITE_PROBE_FILE: &str = ".stockiha-write-probe";

#[derive(Debug)]
pub(crate) struct ResolvedDestination {
    pub path: PathBuf,
    pub is_default: bool,
    pub used_fallback: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum DestinationPurpose {
    Manual,
    Automatic,
}

#[derive(Debug)]
pub(crate) struct DestinationCheck {
    pub canonical: PathBuf,
    pub same_drive_warning: bool,
}

/// Resolve where the next backup goes. See the module doc for the rules.
pub(crate) fn resolve(
    stored: Option<&str>,
    ctx: &EmbeddedRecoveryContext,
    purpose: DestinationPurpose,
) -> Result<ResolvedDestination, EngineError> {
    let Some(stored) = stored.map(str::trim).filter(|s| !s.is_empty()) else {
        return resolve_default(ctx, false);
    };
    match usable_directory(Path::new(stored)) {
        Ok(path) => Ok(ResolvedDestination {
            path,
            is_default: false,
            used_fallback: false,
        }),
        Err(detail) => match purpose {
            DestinationPurpose::Manual => Err(EngineError::new(
                codes::BACKUP_DESTINATION_UNAVAILABLE,
                format!("stored destination '{stored}' is not usable: {detail}"),
            )),
            DestinationPurpose::Automatic => resolve_default(ctx, true),
        },
    }
}

fn resolve_default(
    ctx: &EmbeddedRecoveryContext,
    used_fallback: bool,
) -> Result<ResolvedDestination, EngineError> {
    let default = ctx.app_data_dir.join(DEFAULT_DESTINATION_DIR);
    let path = usable_directory(&default).map_err(|detail| {
        EngineError::new(
            codes::BACKUP_DESTINATION_UNAVAILABLE,
            format!(
                "default destination '{}' is not usable: {detail}",
                default.display()
            ),
        )
    })?;
    Ok(ResolvedDestination {
        path,
        is_default: true,
        used_fallback,
    })
}

/// `create_dir_all` + real-directory check + writable probe. Returns the
/// directory as given (not canonicalized — the caller decides whether to
/// canonicalize; a destination on a removable drive should keep the letter
/// the user chose).
fn usable_directory(dir: &Path) -> Result<PathBuf, String> {
    fs::create_dir_all(dir).map_err(|e| format!("create_dir_all failed ({e})"))?;
    validate_real_directory(dir)?;
    write_probe(dir)?;
    Ok(dir.to_path_buf())
}

fn validate_real_directory(dir: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(dir).map_err(|e| format!("metadata failed ({e})"))?;
    if is_symlink_or_reparse(&metadata) {
        return Err("path is a symlink or reparse point".to_string());
    }
    if !metadata.is_dir() {
        return Err("path is not a directory".to_string());
    }
    Ok(())
}

/// Create-new a probe file and delete it again. If a stale probe exists
/// from a crashed earlier run, remove it and retry once.
fn write_probe(dir: &Path) -> Result<(), String> {
    let probe = dir.join(WRITE_PROBE_FILE);
    let mut attempts = 0;
    loop {
        attempts += 1;
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&probe)
        {
            Ok(file) => {
                drop(file);
                let _ = fs::remove_file(&probe);
                return Ok(());
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists && attempts == 1 => {
                let _ = fs::remove_file(&probe);
                continue;
            }
            Err(e) => {
                let _ = fs::remove_file(&probe);
                return Err(format!("write probe failed ({e})"));
            }
        }
    }
}

/// Validate a candidate the administrator wants to save (plan §5.5).
pub(crate) fn check_candidate(
    candidate: &str,
    ctx: &EmbeddedRecoveryContext,
) -> Result<DestinationCheck, EngineError> {
    let trimmed = candidate.trim();
    if trimmed.is_empty() {
        return Err(EngineError::new(
            codes::VALIDATION_ERROR,
            "backup destination path is empty",
        ));
    }
    let candidate_path = Path::new(trimmed);
    let canonical = dunce::simplified(&canonicalize_best_effort(candidate_path)).to_path_buf();

    let forbidden = [
        ctx.pgdata.clone(),
        ctx.resource_dir.clone(),
        ctx.app_data_dir.join("pgdata"),
    ];
    for root in forbidden {
        let root = dunce::simplified(&canonicalize_best_effort(&root)).to_path_buf();
        if is_same_or_inside(&canonical, &root) {
            return Err(EngineError::new(
                codes::BACKUP_DESTINATION_INSIDE_DATA_DIRECTORY,
                format!(
                    "'{}' is inside the protected folder '{}'",
                    canonical.display(),
                    root.display()
                ),
            ));
        }
    }

    usable_directory(candidate_path).map_err(|detail| {
        EngineError::new(
            codes::BACKUP_DESTINATION_CREATE_FAILED,
            format!("'{}' cannot be used: {detail}", canonical.display()),
        )
    })?;

    let same_drive_warning = same_drive(&canonical, &ctx.pgdata);
    Ok(DestinationCheck {
        canonical,
        same_drive_warning,
    })
}

/// `true` when both paths carry a drive letter and it is the same one;
/// `false` whenever either side has no drive letter (UNC, non-Windows).
pub(crate) fn same_drive(left: &Path, right: &Path) -> bool {
    match (drive_letter(left), drive_letter(right)) {
        (Some(a), Some(b)) => a == b,
        _ => false,
    }
}

/// Case-insensitive, component-wise containment (`Path::starts_with` on
/// lower-cased copies), so `...\PGDATA\x` is inside `...\pgdata`.
fn is_same_or_inside(candidate: &Path, root: &Path) -> bool {
    let candidate = lowercase_path(candidate);
    let root = lowercase_path(root);
    candidate == root || candidate.starts_with(&root)
}

fn lowercase_path(path: &Path) -> PathBuf {
    PathBuf::from(path.to_string_lossy().to_lowercase())
}

/// Canonicalize `path`, falling back to canonicalizing the nearest existing
/// ancestor when `path` itself does not exist yet (a not-yet-created backup
/// destination candidate). Never fails: an unresolvable path is returned
/// as-is, which simply makes the containment/same-drive comparisons using it
/// a syntactic (not symlink-resistant) best effort.
///
/// Moved verbatim from `application::recovery` (WS-H-1) in WS-H-3.
pub(crate) fn canonicalize_best_effort(path: &Path) -> PathBuf {
    if let Ok(canonical) = path.canonicalize() {
        return canonical;
    }
    let mut trailing: Vec<std::ffi::OsString> = Vec::new();
    let mut ancestor = path.to_path_buf();
    loop {
        let Some(file_name) = ancestor.file_name() else {
            break;
        };
        trailing.push(file_name.to_os_string());
        if !ancestor.pop() {
            break;
        }
        if let Ok(canonical_ancestor) = ancestor.canonicalize() {
            let mut resolved = canonical_ancestor;
            for component in trailing.into_iter().rev() {
                resolved.push(component);
            }
            return resolved;
        }
    }
    path.to_path_buf()
}

/// Moved verbatim from `application::recovery` (WS-H-1) in WS-H-3.
#[cfg(windows)]
pub(crate) fn drive_letter(path: &Path) -> Option<char> {
    use std::path::{Component, Prefix};
    match path.components().next() {
        Some(Component::Prefix(prefix)) => match prefix.kind() {
            Prefix::Disk(letter) | Prefix::VerbatimDisk(letter) => {
                Some((letter as char).to_ascii_uppercase())
            }
            _ => None,
        },
        _ => None,
    }
}

#[cfg(not(windows))]
pub(crate) fn drive_letter(_path: &Path) -> Option<char> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "sk-destination-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn ctx(app_data_dir: &Path) -> EmbeddedRecoveryContext {
        let resource_dir = app_data_dir.join("install");
        fs::create_dir_all(&resource_dir).unwrap();
        EmbeddedRecoveryContext {
            app_data_dir: app_data_dir.to_path_buf(),
            bin_dir: resource_dir.join("postgres").join("win64").join("bin"),
            resource_dir,
            pgdata: app_data_dir.join("pgdata"),
            app_version: "0.5.0".to_string(),
        }
    }

    #[test]
    fn no_stored_setting_creates_and_returns_the_default_folder() {
        let root = scratch("default");
        let ctx = ctx(&root);
        let resolved = resolve(None, &ctx, DestinationPurpose::Manual).unwrap();
        assert!(resolved.is_default);
        assert!(!resolved.used_fallback);
        assert_eq!(resolved.path, root.join(DEFAULT_DESTINATION_DIR));
        assert!(resolved.path.is_dir());
        assert!(!resolved.path.join(WRITE_PROBE_FILE).exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn a_usable_stored_setting_is_returned_as_given() {
        let root = scratch("stored");
        let ctx = ctx(&root);
        let chosen = root.join("usb-like");
        let resolved = resolve(chosen.to_str(), &ctx, DestinationPurpose::Manual).unwrap();
        assert!(!resolved.is_default);
        assert_eq!(resolved.path, chosen);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn an_unusable_stored_setting_fails_manual_and_falls_back_for_automatic() {
        let root = scratch("unusable");
        let ctx = ctx(&root);
        // A regular file where a directory is expected is unusable on every
        // platform without needing an unplugged drive.
        let blocker = root.join("blocker.txt");
        fs::write(&blocker, b"x").unwrap();
        let stored = blocker.to_str();

        let manual = resolve(stored, &ctx, DestinationPurpose::Manual).unwrap_err();
        assert_eq!(manual.code, codes::BACKUP_DESTINATION_UNAVAILABLE);

        let automatic = resolve(stored, &ctx, DestinationPurpose::Automatic).unwrap();
        assert!(automatic.is_default);
        assert!(automatic.used_fallback);
        assert_eq!(automatic.path, root.join(DEFAULT_DESTINATION_DIR));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn candidate_inside_pgdata_is_refused() {
        let root = scratch("inside-pgdata");
        let ctx = ctx(&root);
        fs::create_dir_all(&ctx.pgdata).unwrap();
        let inside = ctx.pgdata.join("backups");
        let error = check_candidate(inside.to_str().unwrap(), &ctx).unwrap_err();
        assert_eq!(error.code, codes::BACKUP_DESTINATION_INSIDE_DATA_DIRECTORY);
        let exact = check_candidate(ctx.pgdata.to_str().unwrap(), &ctx).unwrap_err();
        assert_eq!(exact.code, codes::BACKUP_DESTINATION_INSIDE_DATA_DIRECTORY);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn candidate_inside_the_install_folder_is_refused() {
        let root = scratch("inside-install");
        let ctx = ctx(&root);
        let inside = ctx.resource_dir.join("resources").join("backups");
        let error = check_candidate(inside.to_str().unwrap(), &ctx).unwrap_err();
        assert_eq!(error.code, codes::BACKUP_DESTINATION_INSIDE_DATA_DIRECTORY);
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(windows)]
    #[test]
    fn containment_is_case_insensitive_on_windows() {
        let root = scratch("case");
        let ctx = ctx(&root);
        fs::create_dir_all(&ctx.pgdata).unwrap();
        let upper = root.join("PGDATA").join("x");
        let error = check_candidate(upper.to_str().unwrap(), &ctx).unwrap_err();
        assert_eq!(error.code, codes::BACKUP_DESTINATION_INSIDE_DATA_DIRECTORY);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn app_data_dir_itself_and_a_sibling_folder_are_allowed() {
        let root = scratch("allowed");
        let ctx = ctx(&root);
        let sibling = root.join("my backups");
        let check = check_candidate(sibling.to_str().unwrap(), &ctx).unwrap();
        assert!(sibling.is_dir(), "the folder must be created on demand");
        assert!(!sibling.join(WRITE_PROBE_FILE).exists());
        assert_eq!(check.same_drive_warning, same_drive(&sibling, &ctx.pgdata));
        let own = check_candidate(root.to_str().unwrap(), &ctx).unwrap();
        assert!(own.canonical.ends_with(root.file_name().unwrap()));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn a_file_candidate_cannot_be_created() {
        let root = scratch("file-candidate");
        let ctx = ctx(&root);
        let file = root.join("not-a-folder.txt");
        fs::write(&file, b"x").unwrap();
        let error = check_candidate(file.to_str().unwrap(), &ctx).unwrap_err();
        assert_eq!(error.code, codes::BACKUP_DESTINATION_CREATE_FAILED);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn empty_candidate_is_a_validation_error() {
        let root = scratch("empty");
        let ctx = ctx(&root);
        assert_eq!(
            check_candidate("   ", &ctx).unwrap_err().code,
            codes::VALIDATION_ERROR
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn a_stale_probe_file_is_removed_and_retried() {
        let root = scratch("stale-probe");
        fs::write(root.join(WRITE_PROBE_FILE), b"stale").unwrap();
        write_probe(&root).unwrap();
        assert!(!root.join(WRITE_PROBE_FILE).exists());
        let _ = fs::remove_dir_all(root);
    }
}
