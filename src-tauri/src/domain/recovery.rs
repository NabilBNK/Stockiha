use serde::{Deserialize, Serialize};

const REQUEST_ID_MIN_LEN: usize = 8;
const REQUEST_ID_MAX_LEN: usize = 128;
const PATH_MAX_LEN: usize = 4096;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ValidateOperatorBackupRequest {
    pub(crate) request_id: String,
    pub(crate) bundle_path: String,
}

impl ValidateOperatorBackupRequest {
    pub(crate) fn validate(&self) -> Result<(), String> {
        let request_id = self.request_id.trim();
        if !(REQUEST_ID_MIN_LEN..=REQUEST_ID_MAX_LEN).contains(&request_id.len()) {
            return Err(format!(
                "requestId length must be between {REQUEST_ID_MIN_LEN} and {REQUEST_ID_MAX_LEN} characters"
            ));
        }
        if request_id.chars().any(char::is_control) {
            return Err("requestId must not contain control characters".to_string());
        }

        let bundle_path = self.bundle_path.trim();
        if bundle_path.is_empty() || bundle_path.len() > PATH_MAX_LEN {
            return Err("bundlePath is empty or too long".to_string());
        }
        if bundle_path.contains('\0') {
            return Err("bundlePath contains a NUL character".to_string());
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

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_request() -> ValidateOperatorBackupRequest {
        ValidateOperatorBackupRequest {
            request_id: "validate-20260803-001".to_string(),
            bundle_path: r"C:\Stockiha Backups\GestStock-Backup-20260803-190000".to_string(),
        }
    }

    #[test]
    fn accepts_valid_request() {
        assert!(valid_request().validate().is_ok());
    }

    #[test]
    fn rejects_short_request_id() {
        let mut request = valid_request();
        request.request_id = "short".to_string();
        assert!(request.validate().is_err());
    }

    #[test]
    fn rejects_empty_bundle_path() {
        let mut request = valid_request();
        request.bundle_path = "   ".to_string();
        assert!(request.validate().is_err());
    }

    #[test]
    fn result_serializes_with_camel_case_wire_names() {
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
}
