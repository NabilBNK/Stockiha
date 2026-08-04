use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use serde_json::{json, Value as JsonValue};
use sqlx::{query_scalar, PgPool};

use crate::domain::recovery::{
    OperatorBackupValidationResult, ValidateOperatorBackupRequest,
};
use crate::error::AppError;
use crate::infrastructure::backup_proof;

pub(crate) const BACKUP_ROOT_ENV: &str = "STOCKIHA_BACKUP_ROOT";

#[derive(Deserialize)]
struct RecoveryAttemptEnvelope {
    attempt_id: i64,
    is_replay: bool,
    status: String,
    error_code: Option<String>,
    result: Option<JsonValue>,
    current_schema_version: String,
}

pub(crate) enum ValidationAttempt {
    Run {
        attempt_id: i64,
        request_id: String,
        bundle_path: PathBuf,
        bundle_identifier: String,
        current_schema_version: String,
    },
    Replay(OperatorBackupValidationResult),
}

pub(crate) async fn begin_operator_backup_validation(
    pool: &PgPool,
    session_token: &str,
    request: ValidateOperatorBackupRequest,
) -> Result<ValidationAttempt, AppError> {
    request
        .validate()
        .map_err(|diagnostic| AppError::ValidationError { diagnostic })?;

    let bundle_path = PathBuf::from(request.bundle_path.trim());
    let bundle_identifier = bundle_path
        .file_name()
        .and_then(OsStr::to_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::ValidationError {
            diagnostic: "backup bundle path has no safe final directory name".to_string(),
        })?
        .to_string();

    if !is_canonical_bundle_identifier(&bundle_identifier) {
        return Err(AppError::ValidationError {
            diagnostic: "backup bundle identifier does not match the Stockiha format".to_string(),
        });
    }

    let value: JsonValue = query_scalar(
        "SELECT operations.begin_recovery_attempt($1, $2, 'VALIDATE_BACKUP', $3)",
    )
    .bind(session_token)
    .bind(request.request_id.trim())
    .bind(&bundle_identifier)
    .fetch_one(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    let envelope: RecoveryAttemptEnvelope = serde_json::from_value(value).map_err(|error| {
        AppError::internal(format!("failed to parse recovery attempt envelope: {error}"))
    })?;

    match envelope.status.as_str() {
        "SUCCEEDED" => {
            let result = envelope.result.ok_or_else(|| {
                AppError::internal("completed recovery attempt has no result metadata")
            })?;
            let parsed: OperatorBackupValidationResult = serde_json::from_value(result).map_err(
                |error| {
                    AppError::internal(format!(
                        "failed to parse completed backup validation result: {error}"
                    ))
                },
            )?;
            if parsed.request_id != request.request_id.trim()
                || parsed.bundle_identifier != bundle_identifier
            {
                return Err(AppError::internal(
                    "completed backup validation result does not match its request",
                ));
            }
            Ok(ValidationAttempt::Replay(parsed))
        }
        "FAILED" => Err(AppError::BackupValidationFailed {
            diagnostic: envelope
                .error_code
                .unwrap_or_else(|| "BACKUP_VALIDATION_FAILED".to_string()),
        }),
        "STARTED" => Ok(ValidationAttempt::Run {
            attempt_id: envelope.attempt_id,
            request_id: request.request_id.trim().to_string(),
            bundle_path,
            bundle_identifier,
            current_schema_version: envelope.current_schema_version,
        }),
        other => Err(AppError::internal(format!(
            "unknown recovery attempt status: {other}"
        ))),
    }
}

pub(crate) fn validate_operator_backup_files(
    request_id: String,
    bundle_path: PathBuf,
    bundle_identifier: String,
    current_schema_version: String,
) -> Result<OperatorBackupValidationResult, AppError> {
    let canonical_root = configured_backup_root()?;

    let selected_metadata = fs::symlink_metadata(&bundle_path).map_err(|_| {
        AppError::BackupValidationFailed {
            diagnostic: "BACKUP_PROOF_BUNDLE_LAYOUT_INVALID".to_string(),
        }
    })?;
    if is_symlink_or_reparse(&selected_metadata) || !selected_metadata.is_dir() {
        return Err(AppError::BackupValidationFailed {
            diagnostic: "BACKUP_PROOF_REJECTED_SYMLINK_INPUT".to_string(),
        });
    }

    let canonical_bundle = bundle_path.canonicalize().map_err(|_| {
        AppError::BackupValidationFailed {
            diagnostic: "BACKUP_PROOF_BUNDLE_LAYOUT_INVALID".to_string(),
        }
    })?;
    let canonical_metadata = fs::symlink_metadata(&canonical_bundle).map_err(|_| {
        AppError::BackupValidationFailed {
            diagnostic: "BACKUP_PROOF_BUNDLE_LAYOUT_INVALID".to_string(),
        }
    })?;
    if is_symlink_or_reparse(&canonical_metadata) || !canonical_metadata.is_dir() {
        return Err(AppError::BackupValidationFailed {
            diagnostic: "BACKUP_PROOF_REJECTED_SYMLINK_INPUT".to_string(),
        });
    }

    if canonical_bundle.parent() != Some(canonical_root.as_path()) {
        return Err(AppError::PermissionDenied {
            diagnostic: "backup bundle is outside the configured root".to_string(),
        });
    }
    if canonical_bundle.file_name().and_then(OsStr::to_str) != Some(bundle_identifier.as_str()) {
        return Err(AppError::ValidationError {
            diagnostic: "canonical backup bundle identifier changed during path resolution"
                .to_string(),
        });
    }

    let validated = backup_proof::validate_bundle(&canonical_bundle).map_err(|error| {
        AppError::BackupValidationFailed {
            diagnostic: error.to_string(),
        }
    })?;
    let (file_count, total_bytes) = canonical_bundle_stats(&canonical_bundle)?;

    Ok(OperatorBackupValidationResult {
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

pub(crate) async fn complete_operator_backup_validation_success(
    pool: &PgPool,
    session_token: &str,
    attempt_id: i64,
    result: &OperatorBackupValidationResult,
) -> Result<(), AppError> {
    let result_json = serde_json::to_value(result).map_err(|error| {
        AppError::internal(format!("failed to serialize backup validation result: {error}"))
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

pub(crate) async fn complete_operator_backup_validation_failure(
    pool: &PgPool,
    session_token: &str,
    attempt_id: i64,
    error: &AppError,
) -> Result<(), AppError> {
    let stable_code = stable_error_code(error);
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

pub(crate) fn stable_error_code(error: &AppError) -> &'static str {
    match error {
        AppError::Internal(_) => "INTERNAL_ERROR",
        AppError::DatabaseConfiguration { .. } => "CONFIGURATION_ERROR",
        AppError::DatabaseUnavailable { .. } => "DATABASE_UNAVAILABLE",
        AppError::SessionInvalid { .. } => "SESSION_INVALID",
        AppError::PermissionDenied { .. } => "PERMISSION_DENIED",
        AppError::ValidationError { .. } => "VALIDATION_ERROR",
        AppError::PreconditionFailed { .. } => "PRECONDITION_FAILED",
        AppError::BackupCreationFailed { .. } => "BACKUP_CREATION_FAILED",
        AppError::BackupValidationFailed { .. } => "BACKUP_VALIDATION_FAILED",
        AppError::IdempotencyConflict { .. } => "IDEMPOTENCY_CONFLICT",
        AppError::ImmutableRecord { .. } => "IMMUTABLE_RECORD",
        AppError::UnsafeZeroStockValuation { .. } => "UNSAFE_ZERO_STOCK_VALUATION",
        AppError::CreditPolicyBlocked { .. } => "CREDIT_POLICY_BLOCKED",
    }
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
    let configured_metadata = fs::symlink_metadata(&configured).map_err(|_| {
        AppError::database_configuration("configured backup root cannot be inspected")
    })?;
    if is_symlink_or_reparse(&configured_metadata) || !configured_metadata.is_dir() {
        return Err(AppError::database_configuration(
            "configured backup root is not a real directory",
        ));
    }

    let canonical = configured.canonicalize().map_err(|_| {
        AppError::database_configuration("configured backup root is unavailable")
    })?;
    let canonical_metadata = fs::symlink_metadata(&canonical).map_err(|_| {
        AppError::database_configuration("configured backup root cannot be inspected")
    })?;
    if is_symlink_or_reparse(&canonical_metadata) || !canonical_metadata.is_dir() {
        return Err(AppError::database_configuration(
            "configured backup root does not resolve to a real directory",
        ));
    }
    Ok(canonical)
}

fn is_canonical_bundle_identifier(value: &str) -> bool {
    let Some(timestamp) = value.strip_prefix(backup_proof::BUNDLE_NAME_PREFIX) else {
        return false;
    };
    let bytes = timestamp.as_bytes();
    bytes.len() == 15
        && bytes[8] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| index == 8 || byte.is_ascii_digit())
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
        let directory_path = bundle_root.join(directory);
        for entry in fs::read_dir(directory_path).map_err(|_| {
            AppError::BackupValidationFailed {
                diagnostic: "BACKUP_PROOF_BUNDLE_LAYOUT_INVALID".to_string(),
            }
        })? {
            let path = entry
                .map_err(|_| AppError::BackupValidationFailed {
                    diagnostic: "BACKUP_PROOF_IO".to_string(),
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
    let metadata = fs::symlink_metadata(path).map_err(|_| {
        AppError::BackupValidationFailed {
            diagnostic: "BACKUP_PROOF_BUNDLE_LAYOUT_INVALID".to_string(),
        }
    })?;
    if is_symlink_or_reparse(&metadata) || !metadata.is_file() {
        return Err(AppError::BackupValidationFailed {
            diagnostic: "BACKUP_PROOF_REJECTED_SYMLINK_INPUT".to_string(),
        });
    }
    *file_count = file_count.saturating_add(1);
    *total_bytes = total_bytes.saturating_add(metadata.len());
    Ok(())
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

    #[test]
    fn accepts_only_canonical_stockiha_bundle_identifiers() {
        assert!(is_canonical_bundle_identifier(
            "GestStock-Backup-20260803-195700"
        ));
        assert!(!is_canonical_bundle_identifier("backup-20260803"));
        assert!(!is_canonical_bundle_identifier(
            "GestStock-Backup-2026-08-03"
        ));
        assert!(!is_canonical_bundle_identifier(
            "GestStock-Backup-20260803_195700"
        ));
    }

    #[test]
    fn error_code_mapping_is_stable_and_payload_free() {
        let error = AppError::BackupValidationFailed {
            diagnostic: "DO_NOT_EXPOSE".to_string(),
        };
        assert_eq!(stable_error_code(&error), "BACKUP_VALIDATION_FAILED");
        assert!(!stable_error_code(&error).contains("DO_NOT_EXPOSE"));
    }

    #[test]
    fn result_json_uses_only_safe_metadata() {
        let result = OperatorBackupValidationResult {
            request_id: "validate-20260803-001".to_string(),
            bundle_identifier: "GestStock-Backup-20260803-195700".to_string(),
            created_at_label: "20260803-195700".to_string(),
            application_version: "0.1.0".to_string(),
            schema_version: "20260803201500".to_string(),
            postgres_major_version: 18,
            integrity_valid: true,
            application_compatible: true,
            schema_compatible: true,
            postgres_compatible: true,
            file_count: 7,
            total_bytes: 2048,
        };
        let value = serde_json::to_value(&result).unwrap();
        assert_eq!(value["bundleIdentifier"], json!(result.bundle_identifier));
        assert!(value.get("bundlePath").is_none());
        assert!(value.get("databaseUrl").is_none());
        assert!(value.get("credential").is_none());
    }
}
