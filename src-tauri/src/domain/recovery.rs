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
    let bundle_path = bundle_path.trim();
    if bundle_path.is_empty() || bundle_path.len() > PATH_MAX_LEN {
        return Err("bundlePath is empty or too long".to_string());
    }
    if bundle_path.contains('\0') {
        return Err("bundlePath contains a NUL character".to_string());
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
}
