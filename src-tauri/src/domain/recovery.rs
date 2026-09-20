use serde::{Deserialize, Serialize};

use crate::infrastructure::recovery_engine::mode::UnavailableReason;

const REQUEST_ID_MIN_LEN: usize = 8;
const REQUEST_ID_MAX_LEN: usize = 128;
const PATH_MAX_LEN: usize = 4096;

fn validate_request_id(request_id: &str) -> Result<(), String> {
    let request_id = request_id.trim();
    if !(REQUEST_ID_MIN_LEN..=REQUEST_ID_MAX_LEN).contains(&request_id.len()) {
        return Err(format!(
            "requestId length must be between {REQUEST_ID_MIN_LEN} and {REQUEST_ID_MAX_LEN} characters"
        ));
    }
    if request_id.chars().any(char::is_control) {
        return Err("requestId must not contain control characters".to_string());
    }
    Ok(())
}

fn validate_bundle_path(bundle_path: &str) -> Result<(), String> {
    validate_path_field(bundle_path, "bundlePath")
}

/// Shared by every request that carries a plain filesystem path (a bundle
/// folder, or — WS-H-4 — a copy target directory): non-empty, within the
/// length budget, no NUL. Never itself resolves or canonicalizes anything.
fn validate_path_field(value: &str, field_name: &str) -> Result<(), String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.len() > PATH_MAX_LEN {
        return Err(format!("{field_name} is empty or too long"));
    }
    if trimmed.contains('\0') {
        return Err(format!("{field_name} contains a NUL character"));
    }
    Ok(())
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateOperatorBackupRequest {
    pub(crate) request_id: String,
}

impl CreateOperatorBackupRequest {
    pub(crate) fn validate(&self) -> Result<(), String> {
        validate_request_id(&self.request_id)
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ValidateOperatorBackupRequest {
    pub(crate) request_id: String,
    pub(crate) bundle_path: String,
}

impl ValidateOperatorBackupRequest {
    pub(crate) fn validate(&self) -> Result<(), String> {
        validate_request_id(&self.request_id)?;
        validate_bundle_path(&self.bundle_path)
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VerifyOperatorBackupRestoreRequest {
    pub(crate) request_id: String,
    pub(crate) bundle_path: String,
    pub(crate) confirmed: bool,
}

impl VerifyOperatorBackupRestoreRequest {
    pub(crate) fn validate(&self) -> Result<(), String> {
        validate_request_id(&self.request_id)?;
        validate_bundle_path(&self.bundle_path)?;
        if !self.confirmed {
            return Err(
                "temporary restore verification requires explicit confirmation".to_string(),
            );
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OperatorBackupValidationResult {
    pub(crate) request_id: String,
    pub(crate) bundle_identifier: String,
    pub(crate) created_at_label: String,
    pub(crate) application_version: String,
    pub(crate) schema_version: String,
    pub(crate) postgres_major_version: u32,
    pub(crate) integrity_valid: bool,
    pub(crate) application_compatible: bool,
    pub(crate) schema_compatible: bool,
    pub(crate) postgres_compatible: bool,
    pub(crate) file_count: u64,
    pub(crate) total_bytes: u64,
    // WS-H-3 (plan section 5.8.1): optional so a result stored before WS-H-3
    // still replays. `None` is omitted on the wire.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) format_version: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) backup_kind: Option<String>,
    /// `SAME | OLDER | NEWER | UNKNOWN`
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) schema_verdict: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) restorable: Option<bool>,
    /// RFC3339
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) created_at_utc: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) used_fallback_destination: Option<bool>,
}

/// Creation and validation intentionally return the same safe metadata shape.
/// Neither result exposes a credential, connection string, process output, or
/// unrestricted filesystem path.
pub(crate) type OperatorBackupCreationResult = OperatorBackupValidationResult;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RestoreControlTotals {
    pub(crate) schema_count: i64,
    pub(crate) table_count: i64,
    pub(crate) user_count: i64,
    pub(crate) product_count: i64,
    pub(crate) customer_count: i64,
    pub(crate) supplier_count: i64,
    pub(crate) inventory_position_count: i64,
    pub(crate) inventory_movement_count: i64,
    pub(crate) cash_sale_count: i64,
    pub(crate) journal_count: i64,
    pub(crate) journal_debit_total: String,
    pub(crate) journal_credit_total: String,
    pub(crate) customer_exposure_total: String,
    pub(crate) supplier_outstanding_total: String,
    pub(crate) opening_state_application_count: i64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateBackupDestinationRequest {
    pub(crate) path: String,
}

impl UpdateBackupDestinationRequest {
    pub(crate) fn validate(&self) -> Result<(), String> {
        let trimmed = self.path.trim();
        if trimmed.is_empty() || trimmed.len() > PATH_MAX_LEN {
            return Err("path is empty or too long".to_string());
        }
        if trimmed.contains('\0') {
            return Err("path contains a NUL character".to_string());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BackupDestinationSetting {
    /// The stored setting (what the administrator chose), or `None`.
    pub(crate) path: Option<String>,
    /// WS-H-3: where the next backup would actually go - the stored path,
    /// the EMBEDDED default folder, or (EXTERNAL) the `STOCKIHA_BACKUP_ROOT`
    /// env var. `None` only when nothing at all is configured.
    pub(crate) effective_path: Option<String>,
    /// WS-H-3: `true` when `effective_path` is the EMBEDDED default folder.
    pub(crate) is_default: bool,
    /// WS-H-3: `false` when the stored destination cannot be used right now
    /// (drive unplugged, folder not creatable).
    pub(crate) available: bool,
    /// WS-H-3: the effective folder is on the same drive as the live data.
    pub(crate) same_drive_warning: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateBackupDestinationResult {
    pub(crate) path: Option<String>,
    pub(crate) same_drive_warning: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OperatorRestoreVerificationResult {
    pub(crate) request_id: String,
    pub(crate) bundle_identifier: String,
    pub(crate) schema_version: String,
    pub(crate) postgres_major_version: u32,
    /// In EMBEDDED mode (WS-H-4) this means "the test server was stopped".
    pub(crate) temporary_database_cleaned: bool,
    pub(crate) journal_balanced: bool,
    pub(crate) control_totals: RestoreControlTotals,
    // WS-H-3 (plan section 5.8.1): optional so pre-WS-H-3 stored results replay.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) schema_verdict: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) migrated_forward: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) cleanup_pending: Option<bool>,
}

// ---------------------------------------------------------------------------
// WS-H-3: mode, capabilities and status (plan section 5.8).
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecoveryModeResponse {
    /// `EMBEDDED | EXTERNAL | UNAVAILABLE`
    pub(crate) mode: String,
    /// Set only when `mode == "UNAVAILABLE"`.
    pub(crate) unavailable_reason: Option<UnavailableReason>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecoveryCapabilities {
    pub(crate) mode: String,
    pub(crate) can_create_backup: bool,
    pub(crate) can_validate_backup: bool,
    pub(crate) can_verify_restore: bool,
    pub(crate) can_restore_live: bool,
}

impl RecoveryCapabilities {
    pub(crate) fn none(mode: &str) -> Self {
        RecoveryCapabilities {
            mode: mode.to_string(),
            can_create_backup: false,
            can_validate_backup: false,
            can_verify_restore: false,
            can_restore_live: false,
        }
    }
}

/// Raw shape of `operations.get_recovery_capabilities`.
#[derive(Clone, Debug, Deserialize)]
pub(crate) struct RecoveryCapabilitiesRow {
    pub(crate) can_create_backup: bool,
    pub(crate) can_validate_backup: bool,
    pub(crate) can_verify_restore: bool,
    pub(crate) can_restore_live: bool,
}

/// `operations.get_backup_status`: timestamps are ISO-8601 strings exactly
/// as PostgreSQL's `jsonb` renders `timestamptz`; nulls stay `null`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BackupStatus {
    #[serde(default)]
    pub(crate) last_success_at: Option<String>,
    #[serde(default)]
    pub(crate) last_success_bundle: Option<String>,
    #[serde(default)]
    pub(crate) last_failure_at: Option<String>,
    #[serde(default)]
    pub(crate) last_failure_code: Option<String>,
    #[serde(default)]
    pub(crate) last_restore_at: Option<String>,
    #[serde(default)]
    pub(crate) last_restore_bundle: Option<String>,
}

// ---------------------------------------------------------------------------
// WS-H-4: backup list and copy-to-folder (plan §5.8/§5.8.1).
// ---------------------------------------------------------------------------

/// `{ destination: string | null, items: BackupListItem[] }`. `destination`
/// is the resolved folder that was scanned, or `None` when nothing could be
/// resolved at all (never an error by itself — see `list_bundles`).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ListBackupsResponse {
    pub(crate) destination: Option<String>,
    pub(crate) items: Vec<crate::infrastructure::recovery_engine::catalog::BackupListItemDto>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CopyBackupToRequest {
    pub(crate) request_id: String,
    pub(crate) bundle_path: String,
    pub(crate) target_directory: String,
}

impl CopyBackupToRequest {
    pub(crate) fn validate(&self) -> Result<(), String> {
        validate_request_id(&self.request_id)?;
        validate_path_field(&self.bundle_path, "bundlePath")?;
        validate_path_field(&self.target_directory, "targetDirectory")
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CopyBackupToResult {
    pub(crate) copied_path: String,
    pub(crate) total_bytes: u64,
}

// ---------------------------------------------------------------------------
// WS-H-5: real restore and new-PC restore (plan H5-04).
// ---------------------------------------------------------------------------

/// The exact confirmation word, case-sensitive, checked after trimming
/// surrounding whitespace (plan R15 / H5-04 step 1).
const RESTORE_CONFIRMATION_WORD: &str = "RESTORE";

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RestoreBackupLiveRequest {
    pub(crate) request_id: String,
    pub(crate) bundle_path: String,
    pub(crate) confirmation_text: String,
}

impl RestoreBackupLiveRequest {
    pub(crate) fn validate(&self) -> Result<(), String> {
        validate_request_id(&self.request_id)?;
        validate_path_field(&self.bundle_path, "bundlePath")?;
        if self.confirmation_text.trim() != RESTORE_CONFIRMATION_WORD {
            return Err("RESTORE_CONFIRMATION_INVALID".to_string());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RestoreStarted {
    pub(crate) started: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InspectBackupForFreshInstallRequest {
    pub(crate) bundle_path: String,
}

impl InspectBackupForFreshInstallRequest {
    pub(crate) fn validate(&self) -> Result<(), String> {
        validate_path_field(&self.bundle_path, "bundlePath")
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RestoreBackupFreshInstallRequest {
    pub(crate) bundle_path: String,
}

impl RestoreBackupFreshInstallRequest {
    pub(crate) fn validate(&self) -> Result<(), String> {
        validate_path_field(&self.bundle_path, "bundlePath")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_validation_request() -> ValidateOperatorBackupRequest {
        ValidateOperatorBackupRequest {
            request_id: "validate-20260803-001".to_string(),
            bundle_path: r"C:\Stockiha Backups\GestStock-Backup-20260803-190000".to_string(),
        }
    }

    #[test]
    fn accepts_valid_creation_request() {
        assert!(CreateOperatorBackupRequest {
            request_id: "create-20260803-001".to_string(),
        }
        .validate()
        .is_ok());
    }

    #[test]
    fn accepts_valid_validation_request() {
        assert!(valid_validation_request().validate().is_ok());
    }

    #[test]
    fn restore_verification_requires_explicit_confirmation() {
        let request = VerifyOperatorBackupRestoreRequest {
            request_id: "restore-20260805-001".to_string(),
            bundle_path: r"C:\Stockiha Backups\GestStock-Backup-20260805-150500".to_string(),
            confirmed: false,
        };
        assert!(request.validate().is_err());
        assert!(VerifyOperatorBackupRestoreRequest {
            confirmed: true,
            ..request
        }
        .validate()
        .is_ok());
    }

    #[test]
    fn rejects_short_request_id_for_all_operations() {
        assert!(CreateOperatorBackupRequest {
            request_id: "short".to_string(),
        }
        .validate()
        .is_err());

        let mut request = valid_validation_request();
        request.request_id = "short".to_string();
        assert!(request.validate().is_err());

        assert!(VerifyOperatorBackupRestoreRequest {
            request_id: "short".to_string(),
            bundle_path: request.bundle_path,
            confirmed: true,
        }
        .validate()
        .is_err());
    }

    #[test]
    fn rejects_empty_bundle_path() {
        let mut request = valid_validation_request();
        request.bundle_path = "   ".to_string();
        assert!(request.validate().is_err());
    }

    #[test]
    fn validation_result_serializes_with_camel_case_wire_names() {
        let result = OperatorBackupValidationResult {
            request_id: "validate-20260803-001".to_string(),
            bundle_identifier: "GestStock-Backup-20260803-190000".to_string(),
            created_at_label: "20260803-190000".to_string(),
            application_version: "0.1.0".to_string(),
            schema_version: "20260803193000".to_string(),
            postgres_major_version: 18,
            integrity_valid: true,
            application_compatible: true,
            schema_compatible: true,
            postgres_compatible: true,
            file_count: 7,
            total_bytes: 1024,
            format_version: None,
            backup_kind: None,
            schema_verdict: None,
            restorable: None,
            created_at_utc: None,
            used_fallback_destination: None,
        };

        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"bundleIdentifier\""));
        assert!(json.contains("\"schemaCompatible\":true"));
        assert!(!json.contains("bundle_identifier"));
        // WS-H-3 optional fields are omitted when absent, so a stored
        // pre-WS-H-3 result and a fresh one serialize identically.
        assert!(!json.contains("formatVersion"));
        assert!(!json.contains("restorable"));
    }

    /// WS-H-3: a result stored before the optional fields existed must still
    /// deserialize (replay of an old audit row), and a format 2 result
    /// carries its new fields in camelCase.
    #[test]
    fn validation_result_tolerates_missing_and_present_ws_h_3_fields() {
        let legacy: OperatorBackupValidationResult = serde_json::from_str(
            r#"{"requestId":"validate-20260803-001","bundleIdentifier":"GestStock-Backup-20260803-190000",
                "createdAtLabel":"20260803-190000","applicationVersion":"0.1.0","schemaVersion":"20260803193000",
                "postgresMajorVersion":18,"integrityValid":true,"applicationCompatible":true,
                "schemaCompatible":true,"postgresCompatible":true,"fileCount":7,"totalBytes":1024}"#,
        )
        .unwrap();
        assert_eq!(legacy.format_version, None);
        assert_eq!(legacy.restorable, None);

        let modern = OperatorBackupValidationResult {
            format_version: Some(2),
            backup_kind: Some("MANUAL".to_string()),
            schema_verdict: Some("SAME".to_string()),
            restorable: Some(true),
            created_at_utc: Some("2026-09-19T10:15:00Z".to_string()),
            used_fallback_destination: Some(false),
            ..legacy
        };
        let value = serde_json::to_value(&modern).unwrap();
        assert_eq!(value["formatVersion"], 2);
        assert_eq!(value["backupKind"], "MANUAL");
        assert_eq!(value["schemaVerdict"], "SAME");
        assert_eq!(value["restorable"], true);
        assert_eq!(value["createdAtUtc"], "2026-09-19T10:15:00Z");
        assert_eq!(value["usedFallbackDestination"], false);
    }

    #[test]
    fn backup_status_tolerates_nulls_and_missing_fields() {
        let status: BackupStatus = serde_json::from_str(
            r#"{"last_success_at":null,"last_success_bundle":null,"last_failure_at":null,
                "last_failure_code":null,"last_restore_at":null,"last_restore_bundle":null}"#,
        )
        .unwrap();
        assert_eq!(status.last_success_at, None);
        let empty: BackupStatus = serde_json::from_str("{}").unwrap();
        assert_eq!(empty, status);
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("\"lastSuccessAt\":null"));
    }

    #[test]
    fn capabilities_and_mode_serialize_camel_case() {
        let caps = RecoveryCapabilities::none("UNAVAILABLE");
        let json = serde_json::to_string(&caps).unwrap();
        assert_eq!(
            json,
            r#"{"mode":"UNAVAILABLE","canCreateBackup":false,"canValidateBackup":false,"canVerifyRestore":false,"canRestoreLive":false}"#
        );
        let mode = RecoveryModeResponse {
            mode: "UNAVAILABLE".to_string(),
            unavailable_reason: Some(UnavailableReason::NoMigratorCredential),
        };
        assert_eq!(
            serde_json::to_string(&mode).unwrap(),
            r#"{"mode":"UNAVAILABLE","unavailableReason":"NO_MIGRATOR_CREDENTIAL"}"#
        );
        let destination = BackupDestinationSetting {
            path: None,
            effective_path: Some("C:/x".to_string()),
            is_default: true,
            available: true,
            same_drive_warning: false,
        };
        let value = serde_json::to_value(&destination).unwrap();
        assert_eq!(value["isDefault"], true);
        assert_eq!(value["effectivePath"], "C:/x");
    }

    #[test]
    fn restore_result_contains_no_target_or_secret_fields() {
        let result = OperatorRestoreVerificationResult {
            request_id: "restore-20260805-001".to_string(),
            bundle_identifier: "GestStock-Backup-20260805-150500".to_string(),
            schema_version: "20260805150500".to_string(),
            postgres_major_version: 18,
            temporary_database_cleaned: true,
            journal_balanced: true,
            control_totals: RestoreControlTotals {
                schema_count: 12,
                table_count: 42,
                user_count: 1,
                product_count: 0,
                customer_count: 0,
                supplier_count: 0,
                inventory_position_count: 0,
                inventory_movement_count: 0,
                cash_sale_count: 0,
                journal_count: 0,
                journal_debit_total: "0".to_string(),
                journal_credit_total: "0".to_string(),
                customer_exposure_total: "0".to_string(),
                supplier_outstanding_total: "0".to_string(),
                opening_state_application_count: 0,
            },
            schema_verdict: None,
            migrated_forward: None,
            cleanup_pending: None,
        };
        let value = serde_json::to_value(result).unwrap();
        assert_eq!(value["temporaryDatabaseCleaned"], true);
        assert!(value.get("temporaryDatabaseName").is_none());
        assert!(value.get("databaseUrl").is_none());
        assert!(value.get("credential").is_none());
        assert!(value.get("schemaVerdict").is_none());
    }

    // ---- WS-H-4: copy_backup_to request validation --------------------------

    fn valid_copy_request() -> CopyBackupToRequest {
        CopyBackupToRequest {
            request_id: "copy-20260919-001".to_string(),
            bundle_path: r"C:\Stockiha Backups\GestStock-Backup-20260919-101500".to_string(),
            target_directory: r"D:\USB Backups".to_string(),
        }
    }

    #[test]
    fn accepts_a_well_formed_copy_request() {
        assert!(valid_copy_request().validate().is_ok());
    }

    #[test]
    fn rejects_a_short_request_id_for_copy() {
        let mut request = valid_copy_request();
        request.request_id = "short".to_string();
        assert!(request.validate().is_err());
    }

    #[test]
    fn rejects_an_empty_bundle_path_for_copy() {
        let mut request = valid_copy_request();
        request.bundle_path = "   ".to_string();
        assert!(request.validate().is_err());
    }

    #[test]
    fn rejects_an_empty_or_nul_target_directory_for_copy() {
        let mut request = valid_copy_request();
        request.target_directory = "".to_string();
        assert!(request.validate().is_err());

        let mut request = valid_copy_request();
        request.target_directory = "D:\\has\0nul".to_string();
        assert!(request.validate().is_err());
    }

    #[test]
    fn rejects_an_overlong_target_directory_for_copy() {
        let mut request = valid_copy_request();
        request.target_directory = "D:\\".to_string() + &"x".repeat(PATH_MAX_LEN);
        assert!(request.validate().is_err());
    }

    #[test]
    fn list_backups_response_serializes_camel_case() {
        let response = ListBackupsResponse {
            destination: Some(r"C:\backups".to_string()),
            items: Vec::new(),
        };
        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"destination\""));
        assert!(json.contains("\"items\""));
    }

    #[test]
    fn copy_backup_to_result_serializes_camel_case() {
        let result = CopyBackupToResult {
            copied_path: r"D:\GestStock-Backup-20260919-101500".to_string(),
            total_bytes: 4096,
        };
        let value = serde_json::to_value(&result).unwrap();
        assert_eq!(value["copiedPath"], r"D:\GestStock-Backup-20260919-101500");
        assert_eq!(value["totalBytes"], 4096);
    }

    fn valid_restore_request() -> RestoreBackupLiveRequest {
        RestoreBackupLiveRequest {
            request_id: "restore-request-0001".to_string(),
            bundle_path: r"C:\backups\GestStock-Backup-20260919-101500".to_string(),
            confirmation_text: "RESTORE".to_string(),
        }
    }

    #[test]
    fn accepts_the_exact_confirmation_word() {
        assert!(valid_restore_request().validate().is_ok());
    }

    #[test]
    fn trims_surrounding_whitespace_from_the_confirmation_word() {
        let mut request = valid_restore_request();
        request.confirmation_text = "  RESTORE  ".to_string();
        assert!(request.validate().is_ok());
    }

    #[test]
    fn rejects_a_lowercase_confirmation_word() {
        let mut request = valid_restore_request();
        request.confirmation_text = "restore".to_string();
        assert!(request.validate().is_err());
    }

    #[test]
    fn rejects_any_text_other_than_the_exact_word() {
        for text in ["Restore", "RESTORE!", "RESTOREs", "please restore", ""] {
            let mut request = valid_restore_request();
            request.confirmation_text = text.to_string();
            assert!(request.validate().is_err(), "{text:?} must be rejected");
        }
    }

    #[test]
    fn rejects_a_short_request_id_for_live_restore() {
        let mut request = valid_restore_request();
        request.request_id = "x".to_string();
        assert!(request.validate().is_err());
    }

    #[test]
    fn rejects_an_empty_bundle_path_for_live_restore() {
        let mut request = valid_restore_request();
        request.bundle_path = "".to_string();
        assert!(request.validate().is_err());
    }

    #[test]
    fn restore_started_serializes_camel_case() {
        let value = serde_json::to_value(RestoreStarted { started: true }).unwrap();
        assert_eq!(value["started"], true);
    }
}
