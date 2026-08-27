use serde::{Deserialize, Serialize};

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
    pub(crate) path: Option<String>,
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
    pub(crate) temporary_database_cleaned: bool,
    pub(crate) journal_balanced: bool,
    pub(crate) control_totals: RestoreControlTotals,
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
        };

        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"bundleIdentifier\""));
        assert!(json.contains("\"schemaCompatible\":true"));
        assert!(!json.contains("bundle_identifier"));
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
        };
        let value = serde_json::to_value(result).unwrap();
        assert_eq!(value["temporaryDatabaseCleaned"], true);
        assert!(value.get("temporaryDatabaseName").is_none());
        assert!(value.get("databaseUrl").is_none());
        assert!(value.get("credential").is_none());
    }
}
