use std::collections::HashSet;
use std::ffi::OsStr;
use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sha2::{Digest, Sha256};
use sqlx::{query_scalar, PgPool};
use time::{Date, Month, OffsetDateTime, PrimitiveDateTime, Time};

use crate::domain::recovery::{CreateOperatorBackupRequest, OperatorBackupCreationResult};
use crate::error::AppError;
use crate::infrastructure::{backup_proof, db};

use super::recovery::BACKUP_ROOT_ENV;

static STAGE_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Deserialize)]
struct CreationAttemptEnvelope {
    attempt_id: i64,
    status: String,
    bundle_identifier: String,
    error_code: Option<String>,
    result: Option<JsonValue>,
    current_schema_version: String,
}

pub(crate) enum CreationAttempt {
    Run {
        attempt_id: i64,
        request_id: String,
        bundle_identifier: String,
        current_schema_version: String,
    },
    Replay(OperatorBackupCreationResult),
}

#[derive(Deserialize, Serialize)]
struct MutableManifestEntry {
    path: String,
    size_bytes: u64,
    sha256: String,
}

#[derive(Deserialize, Serialize)]
struct MutableManifest {
    bundle_format_version: u32,
    application_version: String,
    schema_version: String,
    created_at_unix: u64,
    database_dump_filename: String,
    files: Vec<MutableManifestEntry>,
}

struct StageCleanup(PathBuf);

impl Drop for StageCleanup {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

pub(crate) async fn begin_operator_backup_creation(
    pool: &PgPool,
    session_token: &str,
    request: CreateOperatorBackupRequest,
) -> Result<CreationAttempt, AppError> {
    request
        .validate()
        .map_err(|diagnostic| AppError::ValidationError { diagnostic })?;

    let candidate_identifier = backup_proof::bundle_directory_name(OffsetDateTime::now_utc());
    let value: JsonValue = query_scalar(
        "SELECT operations.begin_recovery_attempt($1, $2, 'CREATE_BACKUP', $3)",
    )
    .bind(session_token)
    .bind(request.request_id.trim())
    .bind(candidate_identifier)
    .fetch_one(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    let envelope: CreationAttemptEnvelope = serde_json::from_value(value).map_err(|error| {
        AppError::internal(format!("failed to parse backup creation attempt: {error}"))
    })?;

    match envelope.status.as_str() {
        "SUCCEEDED" => {
            let result = envelope.result.ok_or_else(|| {
                AppError::internal("completed backup creation attempt has no result metadata")
            })?;
            let parsed: OperatorBackupCreationResult = serde_json::from_value(result).map_err(
                |error| {
                    AppError::internal(format!(
                        "failed to parse completed backup creation result: {error}"
                    ))
                },
            )?;
            if parsed.request_id != request.request_id.trim()
                || parsed.bundle_identifier != envelope.bundle_identifier
            {
                return Err(AppError::internal(
                    "completed backup creation result does not match its request",
                ));
            }
            Ok(CreationAttempt::Replay(parsed))
        }
        "FAILED" => Err(AppError::BackupCreationFailed {
            diagnostic: envelope
                .error_code
                .unwrap_or_else(|| "BACKUP_CREATION_FAILED".to_string()),
        }),
        "STARTED" => Ok(CreationAttempt::Run {
            attempt_id: envelope.attempt_id,
            request_id: request.request_id.trim().to_string(),
            bundle_identifier: envelope.bundle_identifier,
            current_schema_version: envelope.current_schema_version,
        }),
        other => Err(AppError::internal(format!(
            "unknown backup creation attempt status: {other}"
        ))),
    }
}

pub(crate) fn create_operator_backup_files(
    request_id: String,
    attempt_id: i64,
    bundle_identifier: String,
    current_schema_version: String,
    app_data_dir: PathBuf,
) -> Result<OperatorBackupCreationResult, AppError> {
    let canonical_root = configured_backup_root()?;
    let final_path = canonical_root.join(&bundle_identifier);

    if final_path.exists() {
        return result_from_existing_bundle(
            request_id,
            final_path,
            bundle_identifier,
            current_schema_version,
        );
    }

    let bundle_time = parse_bundle_identifier_time(&bundle_identifier)?;
    let inputs = collect_backup_inputs(&app_data_dir)?;
    let executable = backup_proof::resolve_pg_dump_executable();
    let postgres_version = backup_proof::discover_and_validate_pg_dump(&executable)
        .map_err(map_creation_proof_error)?;
    let (host, port, database) = resolve_pg_dump_target()?;

    #[cfg(not(windows))]
    {
        let _ = (
            request_id,
            attempt_id,
            bundle_time,
            inputs,
            executable,
            postgres_version,
            host,
            port,
            database,
            current_schema_version,
        );
        return Err(AppError::BackupCreationFailed {
            diagnostic: "BACKUP_CREATION_REQUIRES_WINDOWS".to_string(),
        });
    }

    #[cfg(windows)]
    {
        let credential =
            backup_proof::resolve_backup_credential().map_err(map_creation_proof_error)?;
        let password = std::str::from_utf8(credential.as_ref()).map_err(|_| {
            AppError::BackupCreationFailed {
                diagnostic: "BACKUP_PROOF_CREDENTIAL_NOT_UTF8".to_string(),
            }
        })?;

        let stage_root = create_stage_root(&canonical_root, attempt_id)?;
        let _cleanup = StageCleanup(stage_root.clone());
        let target = backup_proof::PgDumpTarget {
            host: &host,
            port,
            database: &database,
        };
        let staged_bundle = backup_proof::create_backup_bundle(
            &stage_root,
            bundle_time,
            &postgres_version,
            &inputs,
            |out_path| backup_proof::run_pg_dump(&executable, &target, password, out_path),
        )
        .map_err(map_creation_proof_error)?;

        if staged_bundle.file_name().and_then(OsStr::to_str)
            != Some(bundle_identifier.as_str())
        {
            return Err(AppError::BackupCreationFailed {
                diagnostic: "BACKUP_CREATION_IDENTIFIER_MISMATCH".to_string(),
            });
        }

        rewrite_schema_metadata(&staged_bundle, &current_schema_version)?;
        let staged_validated = backup_proof::validate_bundle(&staged_bundle)
            .map_err(map_creation_proof_error)?;
        if staged_validated.schema_version != current_schema_version {
            return Err(AppError::BackupCreationFailed {
                diagnostic: "BACKUP_CREATION_SCHEMA_METADATA_MISMATCH".to_string(),
            });
        }
        if final_path.exists() {
            return Err(AppError::BackupCreationFailed {
                diagnostic: "BACKUP_PROOF_DESTINATION_ALREADY_EXISTS".to_string(),
            });
        }

        fs::rename(&staged_bundle, &final_path).map_err(|_| {
            AppError::BackupCreationFailed {
                diagnostic: "BACKUP_CREATION_PUBLISH_FAILED".to_string(),
            }
        })?;

        let validated =
            backup_proof::validate_bundle(&final_path).map_err(map_creation_proof_error)?;
        build_result(
            request_id,
            bundle_identifier,
            current_schema_version,
            validated,
            &final_path,
        )
    }
}

pub(crate) async fn complete_operator_backup_creation_success(
    pool: &PgPool,
    session_token: &str,
    attempt_id: i64,
    result: &OperatorBackupCreationResult,
) -> Result<(), AppError> {
    let result_json = serde_json::to_value(result).map_err(|error| {
        AppError::internal(format!("failed to serialize backup creation result: {error}"))
    })?;
    let _: JsonValue = query_scalar(
        "SELECT operations.complete_recovery_attempt($1, $2, true, NULL, $3)",
    )
    .bind(session_token)
    .bind(attempt_id)
    .bind(result_json)
    .fetch_one(pool)
    .await
    .map_err(AppError::from_posting_error)?;
    Ok(())
}

pub(crate) async fn complete_operator_backup_creation_failure(
    pool: &PgPool,
    session_token: &str,
    attempt_id: i64,
    error: &AppError,
) -> Result<(), AppError> {
    let stable_code = creation_audit_error_code(error);
    let _: JsonValue = query_scalar(
        "SELECT operations.complete_recovery_attempt($1, $2, false, $3, NULL)",
    )
    .bind(session_token)
    .bind(attempt_id)
    .bind(stable_code)
    .fetch_one(pool)
    .await
    .map_err(AppError::from_posting_error)?;
    Ok(())
}

fn result_from_existing_bundle(
    request_id: String,
    final_path: PathBuf,
    bundle_identifier: String,
    current_schema_version: String,
) -> Result<OperatorBackupCreationResult, AppError> {
    let validated =
        backup_proof::validate_bundle(&final_path).map_err(map_creation_proof_error)?;
    if validated.schema_version != current_schema_version {
        return Err(AppError::BackupCreationFailed {
            diagnostic: "BACKUP_CREATION_EXISTING_BUNDLE_SCHEMA_MISMATCH".to_string(),
        });
    }
    build_result(
        request_id,
        bundle_identifier,
        current_schema_version,
        validated,
        &final_path,
    )
}

fn build_result(
    request_id: String,
    bundle_identifier: String,
    current_schema_version: String,
    validated: backup_proof::ValidatedBundle,
    bundle_path: &Path,
) -> Result<OperatorBackupCreationResult, AppError> {
    let (file_count, total_bytes) = canonical_bundle_stats(bundle_path)?;
    Ok(OperatorBackupCreationResult {
        request_id,
        created_at_label: bundle_identifier
            .strip_prefix(backup_proof::BUNDLE_NAME_PREFIX)
            .unwrap_or_default()
            .to_string(),
        bundle_identifier,
        application_compatible: validated.application_version == env!("CARGO_PKG_VERSION"),
        schema_compatible: validated.schema_version == current_schema_version,
        postgres_compatible: validated.postgres_major_version
            == backup_proof::REQUIRED_PG_MAJOR_VERSION,
        application_version: validated.application_version,
        schema_version: validated.schema_version,
        postgres_major_version: validated.postgres_major_version,
        integrity_valid: true,
        file_count,
        total_bytes,
    })
}

fn configured_backup_root() -> Result<PathBuf, AppError> {
    let value = std::env::var_os(BACKUP_ROOT_ENV).ok_or_else(|| {
        AppError::database_configuration(format!("{BACKUP_ROOT_ENV} is not configured"))
    })?;
    if value.is_empty() {
        return Err(AppError::database_configuration(format!(
            "{BACKUP_ROOT_ENV} is empty"
        )));
    }
    let configured = PathBuf::from(value);
    let canonical = configured.canonicalize().map_err(|_| {
        AppError::database_configuration("configured backup root is unavailable")
    })?;
    let metadata = fs::symlink_metadata(&canonical).map_err(|_| {
        AppError::database_configuration("configured backup root cannot be inspected")
    })?;
    if is_symlink_or_reparse(&metadata) || !metadata.is_dir() {
        return Err(AppError::database_configuration(
            "configured backup root is not a real directory",
        ));
    }
    Ok(canonical)
}

fn resolve_pg_dump_target() -> Result<(String, u16, String), AppError> {
    let url = std::env::var(db::DEV_DATABASE_URL_ENV).map_err(|_| {
        AppError::database_configuration("database target configuration is not set")
    })?;
    let options = db::parse_connect_options(&url)?;
    let database = options
        .get_database()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AppError::database_configuration("database target has no database name"))?
        .to_string();
    Ok((
        options.get_host().to_string(),
        options.get_port(),
        database,
    ))
}

fn collect_backup_inputs(app_data_dir: &Path) -> Result<backup_proof::BackupInputs, AppError> {
    Ok(backup_proof::BackupInputs {
        attachments: collect_flat_files(&app_data_dir.join("attachments"))?,
        generated_documents: collect_flat_files(
            &app_data_dir.join("generated").join("customer-documents"),
        )?,
        company_assets: collect_flat_files(&app_data_dir.join("company-assets"))?,
    })
}

fn collect_flat_files(directory: &Path) -> Result<Vec<PathBuf>, AppError> {
    if !directory.exists() {
        return Ok(Vec::new());
    }
    let metadata =
        fs::symlink_metadata(directory).map_err(|_| AppError::BackupCreationFailed {
            diagnostic: "BACKUP_CREATION_ASSET_DIRECTORY_UNAVAILABLE".to_string(),
        })?;
    if is_symlink_or_reparse(&metadata) || !metadata.is_dir() {
        return Err(AppError::BackupCreationFailed {
            diagnostic: "BACKUP_CREATION_ASSET_DIRECTORY_INVALID".to_string(),
        });
    }

    let mut files = Vec::new();
    for entry in fs::read_dir(directory).map_err(|_| AppError::BackupCreationFailed {
        diagnostic: "BACKUP_CREATION_ASSET_DIRECTORY_UNAVAILABLE".to_string(),
    })? {
        let path = entry
            .map_err(|_| AppError::BackupCreationFailed {
                diagnostic: "BACKUP_CREATION_ASSET_DIRECTORY_UNAVAILABLE".to_string(),
            })?
            .path();
        let metadata =
            fs::symlink_metadata(&path).map_err(|_| AppError::BackupCreationFailed {
                diagnostic: "BACKUP_CREATION_ASSET_INPUT_UNAVAILABLE".to_string(),
            })?;
        if is_symlink_or_reparse(&metadata) || !metadata.is_file() {
            return Err(AppError::BackupCreationFailed {
                diagnostic: "BACKUP_CREATION_ASSET_INPUT_INVALID".to_string(),
            });
        }
        files.push(path);
    }
    files.sort();
    Ok(files)
}

fn create_stage_root(root: &Path, attempt_id: i64) -> Result<PathBuf, AppError> {
    let counter = STAGE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let stage = root.join(format!(
        ".r6-001-stage-{attempt_id}-{}-{nanos}-{counter}",
        std::process::id()
    ));
    fs::create_dir(&stage).map_err(|_| AppError::BackupCreationFailed {
        diagnostic: "BACKUP_CREATION_STAGE_FAILED".to_string(),
    })?;
    Ok(stage)
}

fn parse_bundle_identifier_time(value: &str) -> Result<OffsetDateTime, AppError> {
    let timestamp = value
        .strip_prefix(backup_proof::BUNDLE_NAME_PREFIX)
        .ok_or_else(identifier_error)?;
    if timestamp.len() != 15 || timestamp.as_bytes().get(8) != Some(&b'-') {
        return Err(identifier_error());
    }
    let digits = format!("{}{}", &timestamp[..8], &timestamp[9..]);
    if !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(identifier_error());
    }

    let year = digits[0..4]
        .parse::<i32>()
        .map_err(|_| identifier_error())?;
    let month = digits[4..6]
        .parse::<u8>()
        .map_err(|_| identifier_error())?;
    let day = digits[6..8]
        .parse::<u8>()
        .map_err(|_| identifier_error())?;
    let hour = digits[8..10]
        .parse::<u8>()
        .map_err(|_| identifier_error())?;
    let minute = digits[10..12]
        .parse::<u8>()
        .map_err(|_| identifier_error())?;
    let second = digits[12..14]
        .parse::<u8>()
        .map_err(|_| identifier_error())?;
    let month = Month::try_from(month).map_err(|_| identifier_error())?;
    let date = Date::from_calendar_date(year, month, day).map_err(|_| identifier_error())?;
    let time = Time::from_hms(hour, minute, second).map_err(|_| identifier_error())?;
    Ok(PrimitiveDateTime::new(date, time).assume_utc())
}

fn identifier_error() -> AppError {
    AppError::BackupCreationFailed {
        diagnostic: "BACKUP_CREATION_IDENTIFIER_INVALID".to_string(),
    }
}

fn rewrite_schema_metadata(bundle_path: &Path, schema_version: &str) -> Result<(), AppError> {
    if schema_version.trim().is_empty() || schema_version.chars().any(char::is_control) {
        return Err(AppError::BackupCreationFailed {
            diagnostic: "BACKUP_CREATION_SCHEMA_VERSION_INVALID".to_string(),
        });
    }

    let schema_path = bundle_path.join(backup_proof::SCHEMA_VERSION_FILENAME);
    write_synced(
        &schema_path,
        format!("{}\n", schema_version.trim()).as_bytes(),
    )?;
    let (schema_hash, schema_size) = hash_file(&schema_path)?;

    let manifest_path = bundle_path.join(backup_proof::MANIFEST_FILENAME);
    let manifest_bytes = fs::read(&manifest_path).map_err(|_| {
        AppError::BackupCreationFailed {
            diagnostic: "BACKUP_CREATION_MANIFEST_REWRITE_FAILED".to_string(),
        }
    })?;
    let mut manifest: MutableManifest = serde_json::from_slice(&manifest_bytes).map_err(|_| {
        AppError::BackupCreationFailed {
            diagnostic: "BACKUP_CREATION_MANIFEST_REWRITE_FAILED".to_string(),
        }
    })?;
    manifest.schema_version = schema_version.trim().to_string();

    let mut schema_entry_count = 0;
    let mut paths = HashSet::new();
    for entry in &mut manifest.files {
        if !paths.insert(entry.path.clone()) {
            return Err(AppError::BackupCreationFailed {
                diagnostic: "BACKUP_CREATION_MANIFEST_DUPLICATE_PATH".to_string(),
            });
        }
        if entry.path == backup_proof::SCHEMA_VERSION_FILENAME {
            entry.sha256 = schema_hash.clone();
            entry.size_bytes = schema_size;
            schema_entry_count += 1;
        }
    }
    if schema_entry_count != 1 {
        return Err(AppError::BackupCreationFailed {
            diagnostic: "BACKUP_CREATION_SCHEMA_ENTRY_INVALID".to_string(),
        });
    }
    manifest
        .files
        .sort_by(|left, right| left.path.cmp(&right.path));

    let rewritten_manifest = serde_json::to_vec(&manifest).map_err(|_| {
        AppError::BackupCreationFailed {
            diagnostic: "BACKUP_CREATION_MANIFEST_REWRITE_FAILED".to_string(),
        }
    })?;
    write_synced(&manifest_path, &rewritten_manifest)?;
    let manifest_hash = hash_bytes(&rewritten_manifest);

    let mut checksum_lines: Vec<(String, String)> = manifest
        .files
        .iter()
        .map(|entry| (entry.path.clone(), entry.sha256.clone()))
        .collect();
    checksum_lines.push((
        backup_proof::MANIFEST_FILENAME.to_string(),
        manifest_hash,
    ));
    checksum_lines.sort_by(|left, right| left.0.cmp(&right.0));
    let mut checksums = String::new();
    for (path, hash) in checksum_lines {
        checksums.push_str(&format!("{hash}  {path}\n"));
    }
    write_synced(
        &bundle_path.join(backup_proof::CHECKSUMS_FILENAME),
        checksums.as_bytes(),
    )
}

fn canonical_bundle_stats(bundle_root: &Path) -> Result<(u64, u64), AppError> {
    let mut file_count = 0u64;
    let mut total_bytes = 0u64;
    for file_name in [
        backup_proof::DUMP_FILENAME,
        backup_proof::MANIFEST_FILENAME,
        backup_proof::CHECKSUMS_FILENAME,
        backup_proof::SCHEMA_VERSION_FILENAME,
        backup_proof::APPLICATION_VERSION_FILENAME,
        backup_proof::POSTGRES_VERSION_FILENAME,
    ] {
        add_regular_file_stats(
            &bundle_root.join(file_name),
            &mut file_count,
            &mut total_bytes,
        )?;
    }
    for directory in [
        backup_proof::ATTACHMENTS_DIR,
        backup_proof::GENERATED_DOCUMENTS_DIR,
        backup_proof::COMPANY_ASSETS_DIR,
    ] {
        for entry in fs::read_dir(bundle_root.join(directory)).map_err(|_| {
            AppError::BackupCreationFailed {
                diagnostic: "BACKUP_CREATION_BUNDLE_STATS_FAILED".to_string(),
            }
        })? {
            let path = entry
                .map_err(|_| AppError::BackupCreationFailed {
                    diagnostic: "BACKUP_CREATION_BUNDLE_STATS_FAILED".to_string(),
                })?
                .path();
            add_regular_file_stats(&path, &mut file_count, &mut total_bytes)?;
        }
    }
    Ok((file_count, total_bytes))
}

fn add_regular_file_stats(
    path: &Path,
    file_count: &mut u64,
    total_bytes: &mut u64,
) -> Result<(), AppError> {
    let metadata = fs::symlink_metadata(path).map_err(|_| AppError::BackupCreationFailed {
        diagnostic: "BACKUP_CREATION_BUNDLE_STATS_FAILED".to_string(),
    })?;
    if is_symlink_or_reparse(&metadata) || !metadata.is_file() {
        return Err(AppError::BackupCreationFailed {
            diagnostic: "BACKUP_CREATION_BUNDLE_STATS_FAILED".to_string(),
        });
    }
    *file_count = file_count.saturating_add(1);
    *total_bytes = total_bytes.saturating_add(metadata.len());
    Ok(())
}

fn write_synced(path: &Path, bytes: &[u8]) -> Result<(), AppError> {
    let mut file = fs::File::create(path).map_err(|_| AppError::BackupCreationFailed {
        diagnostic: "BACKUP_CREATION_METADATA_WRITE_FAILED".to_string(),
    })?;
    file.write_all(bytes)
        .map_err(|_| AppError::BackupCreationFailed {
            diagnostic: "BACKUP_CREATION_METADATA_WRITE_FAILED".to_string(),
        })?;
    file.sync_all().map_err(|_| AppError::BackupCreationFailed {
        diagnostic: "BACKUP_CREATION_METADATA_WRITE_FAILED".to_string(),
    })
}

fn hash_file(path: &Path) -> Result<(String, u64), AppError> {
    let bytes = fs::read(path).map_err(|_| AppError::BackupCreationFailed {
        diagnostic: "BACKUP_CREATION_METADATA_HASH_FAILED".to_string(),
    })?;
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

fn map_creation_proof_error(error: backup_proof::BackupProofError) -> AppError {
    AppError::BackupCreationFailed {
        diagnostic: error.to_string(),
    }
}

fn creation_audit_error_code(error: &AppError) -> String {
    match error {
        AppError::BackupCreationFailed { diagnostic }
            if diagnostic.starts_with("BACKUP_")
                && diagnostic.len() <= 128
                && diagnostic.bytes().all(|byte| {
                    byte.is_ascii_uppercase() || byte == b'_' || byte.is_ascii_digit()
                }) =>
        {
            diagnostic.clone()
        }
        AppError::DatabaseConfiguration { .. } => "CONFIGURATION_ERROR".to_string(),
        AppError::SessionInvalid { .. } => "SESSION_INVALID".to_string(),
        AppError::PermissionDenied { .. } => "PERMISSION_DENIED".to_string(),
        AppError::ValidationError { .. } => "VALIDATION_ERROR".to_string(),
        AppError::IdempotencyConflict { .. } => "IDEMPOTENCY_CONFLICT".to_string(),
        _ => "BACKUP_CREATION_FAILED".to_string(),
    }
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

    fn scratch_dir(tag: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "stockiha-r6-create-{tag}-{}-{}",
            std::process::id(),
            STAGE_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn parses_canonical_bundle_time() {
        let parsed =
            parse_bundle_identifier_time("GestStock-Backup-20260803-203015").unwrap();
        assert_eq!(
            backup_proof::bundle_directory_name(parsed),
            "GestStock-Backup-20260803-203015"
        );
        assert!(parse_bundle_identifier_time("GestStock-Backup-2026-08-03").is_err());
    }

    #[test]
    fn rewrites_transient_zero_schema_before_validation() {
        let root = scratch_dir("schema-rewrite");
        let now = parse_bundle_identifier_time("GestStock-Backup-20260803-203015").unwrap();
        let bundle = backup_proof::create_backup_bundle(
            &root,
            now,
            "pg_dump (PostgreSQL) 18.0",
            &backup_proof::BackupInputs::empty(),
            |path| {
                fs::write(path, b"fake-custom-dump")
                    .map_err(|_| backup_proof::BackupProofError::Io)
            },
        )
        .unwrap();

        rewrite_schema_metadata(&bundle, "20260803193000").unwrap();
        let validated = backup_proof::validate_bundle(&bundle).unwrap();
        assert_eq!(validated.schema_version, "20260803193000");
        assert_eq!(
            fs::read_to_string(bundle.join(backup_proof::SCHEMA_VERSION_FILENAME)).unwrap(),
            "20260803193000\n"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn audit_error_code_never_returns_free_form_diagnostics() {
        assert_eq!(
            creation_audit_error_code(&AppError::BackupCreationFailed {
                diagnostic: "BACKUP_PROOF_PG_DUMP_FAILED".to_string(),
            }),
            "BACKUP_PROOF_PG_DUMP_FAILED"
        );
        assert_eq!(
            creation_audit_error_code(&AppError::BackupCreationFailed {
                diagnostic: "secret detail".to_string(),
            }),
            "BACKUP_CREATION_FAILED"
        );
    }
}
