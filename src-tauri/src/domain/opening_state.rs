use serde::{Deserialize, Serialize};

use crate::domain::onboarding::parse_iso_date;

const REQUEST_ID_MIN_LEN: usize = 8;
const REQUEST_ID_MAX_LEN: usize = 128;
const FILENAME_MAX_LEN: usize = 255;
const DESCRIPTION_MAX_LEN: usize = 500;
const COUNTERPARTY_MAX_LEN: usize = 300;
const REFERENCE_MAX_LEN: usize = 200;
const NOTES_MAX_LEN: usize = 1000;
const MAX_LINES_PER_REQUEST: usize = 5_000;

const LINE_TYPES: &[&str] = &[
    "CASH",
    "BANK",
    "INVENTORY_VALUE",
    "CUSTOMER_RECEIVABLE",
    "SUPPLIER_PAYABLE",
    "LOAN_PAYABLE",
    "TAX_PAYABLE",
    "OWNER_CAPITAL",
    "RETAINED_EARNINGS",
    "OTHER_ASSET",
    "OTHER_LIABILITY",
];

const REVIEW_STATUSES: &[&str] = &["READY", "NEEDS_REVIEW", "APPROVED", "REJECTED"];

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

fn validate_optional_text(
    value: &Option<String>,
    field: &str,
    max_len: usize,
) -> Result<(), String> {
    if let Some(value) = value {
        let value = value.trim();
        if value.is_empty() || value.len() > max_len || value.chars().any(char::is_control) {
            return Err(format!(
                "{field} is empty, too long, or contains control characters"
            ));
        }
    }
    Ok(())
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateOpeningStateSettingRequest {
    pub(crate) enabled: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpeningStateSettingResult {
    pub(crate) enabled: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateOpeningStatePackageRequest {
    pub(crate) request_id: String,
    pub(crate) source_type: String,
    pub(crate) original_filename: Option<String>,
    pub(crate) cutover_date: String,
}

impl CreateOpeningStatePackageRequest {
    pub(crate) fn validate(&self) -> Result<(), String> {
        validate_request_id(&self.request_id)?;
        parse_iso_date(&self.cutover_date, "cutoverDate")?;

        let source_type = self.source_type.trim().to_ascii_uppercase();
        if !matches!(source_type.as_str(), "EXCEL" | "MANUAL") {
            return Err("sourceType must be EXCEL or MANUAL".to_string());
        }

        match (source_type.as_str(), self.original_filename.as_ref()) {
            ("EXCEL", Some(filename)) => {
                let filename = filename.trim();
                if filename.is_empty()
                    || filename.len() > FILENAME_MAX_LEN
                    || filename.chars().any(char::is_control)
                    || filename.contains('/')
                    || filename.contains('\\')
                    || !filename.to_ascii_lowercase().ends_with(".xlsx")
                {
                    return Err("originalFilename must be a safe .xlsx filename".to_string());
                }
            }
            ("EXCEL", None) => {
                return Err("Excel packages require originalFilename".to_string());
            }
            ("MANUAL", Some(_)) => {
                return Err("Manual packages must not include originalFilename".to_string());
            }
            ("MANUAL", None) => {}
            _ => unreachable!(),
        }

        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpeningStatePackageResult {
    pub(crate) package_id: i64,
    pub(crate) status: String,
    pub(crate) is_replay: bool,
    pub(crate) source_type: String,
    pub(crate) original_filename: Option<String>,
    pub(crate) cutover_date: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpeningStateLineInput {
    pub(crate) source_row_number: i32,
    pub(crate) line_type: String,
    pub(crate) description: String,
    pub(crate) amount_dzd: i64,
    pub(crate) counterparty_name: Option<String>,
    pub(crate) external_reference: Option<String>,
    pub(crate) notes: Option<String>,
    pub(crate) review_status: String,
}

impl OpeningStateLineInput {
    fn validate(&self) -> Result<(), String> {
        if self.source_row_number < 2 {
            return Err("sourceRowNumber must be at least 2".to_string());
        }

        let line_type = self.line_type.trim().to_ascii_uppercase();
        if !LINE_TYPES.contains(&line_type.as_str()) {
            return Err("lineType is unsupported".to_string());
        }

        let description = self.description.trim();
        if description.is_empty()
            || description.len() > DESCRIPTION_MAX_LEN
            || description.chars().any(char::is_control)
        {
            return Err(
                "description is empty, too long, or contains control characters".to_string(),
            );
        }

        if self.amount_dzd < 0 {
            return Err("amountDzd must not be negative".to_string());
        }

        let review_status = self.review_status.trim().to_ascii_uppercase();
        if !REVIEW_STATUSES.contains(&review_status.as_str()) {
            return Err("reviewStatus is unsupported".to_string());
        }

        validate_optional_text(
            &self.counterparty_name,
            "counterpartyName",
            COUNTERPARTY_MAX_LEN,
        )?;
        validate_optional_text(
            &self.external_reference,
            "externalReference",
            REFERENCE_MAX_LEN,
        )?;
        validate_optional_text(&self.notes, "notes", NOTES_MAX_LEN)?;

        if line_type == "CUSTOMER_RECEIVABLE" && self.counterparty_name.is_none() {
            return Err("customer receivables require counterpartyName".to_string());
        }
        if line_type == "SUPPLIER_PAYABLE" && self.counterparty_name.is_none() {
            return Err("supplier payables require counterpartyName".to_string());
        }

        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReplaceOpeningStatePackageDataRequest {
    pub(crate) package_id: i64,
    pub(crate) lines: Vec<OpeningStateLineInput>,
}

impl ReplaceOpeningStatePackageDataRequest {
    pub(crate) fn validate(&self) -> Result<(), String> {
        if self.package_id <= 0 {
            return Err("packageId must be positive".to_string());
        }
        if self.lines.len() > MAX_LINES_PER_REQUEST {
            return Err(format!(
                "A request may contain at most {MAX_LINES_PER_REQUEST} opening-state lines"
            ));
        }

        for (index, line) in self.lines.iter().enumerate() {
            line.validate()
                .map_err(|error| format!("lines[{index}]: {error}"))?;
        }

        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpeningStatePackageDataResult {
    pub(crate) package_id: i64,
    pub(crate) status: String,
    pub(crate) line_count: i64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpeningStatePackageIdRequest {
    pub(crate) package_id: i64,
}

impl OpeningStatePackageIdRequest {
    pub(crate) fn validate(&self) -> Result<(), String> {
        if self.package_id <= 0 {
            return Err("packageId must be positive".to_string());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpeningStateValidationResult {
    pub(crate) package_id: i64,
    pub(crate) status: String,
    pub(crate) row_count: i64,
    pub(crate) invalid_row_count: i64,
    pub(crate) total_assets_dzd: i64,
    pub(crate) total_liabilities_dzd: i64,
    pub(crate) total_equity_dzd: i64,
    pub(crate) reconciliation_difference_dzd: i64,
    pub(crate) validation_errors: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpeningStateApprovalResult {
    pub(crate) package_id: i64,
    pub(crate) status: String,
    pub(crate) is_replay: bool,
    pub(crate) cutover_date: String,
    pub(crate) total_assets_dzd: i64,
    pub(crate) total_liabilities_dzd: i64,
    pub(crate) total_equity_dzd: i64,
    pub(crate) reconciliation_difference_dzd: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpeningStatePackageSummaryResult {
    pub(crate) package_id: i64,
    pub(crate) status: String,
    pub(crate) source_type: String,
    pub(crate) original_filename: Option<String>,
    pub(crate) cutover_date: String,
    pub(crate) row_count: i64,
    pub(crate) invalid_row_count: i64,
    pub(crate) total_assets_dzd: i64,
    pub(crate) total_liabilities_dzd: i64,
    pub(crate) total_equity_dzd: i64,
    pub(crate) reconciliation_difference_dzd: i64,
    pub(crate) validation_errors: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_line() -> OpeningStateLineInput {
        OpeningStateLineInput {
            source_row_number: 2,
            line_type: "CASH".to_string(),
            description: "Cash on hand".to_string(),
            amount_dzd: 10_000,
            counterparty_name: None,
            external_reference: None,
            notes: None,
            review_status: "READY".to_string(),
        }
    }

    #[test]
    fn validates_a_manual_package() {
        let request = CreateOpeningStatePackageRequest {
            request_id: "opening-0001".to_string(),
            source_type: "MANUAL".to_string(),
            original_filename: None,
            cutover_date: "2026-08-05".to_string(),
        };
        assert!(request.validate().is_ok());
    }

    #[test]
    fn rejects_unsafe_excel_filename() {
        let request = CreateOpeningStatePackageRequest {
            request_id: "opening-0002".to_string(),
            source_type: "EXCEL".to_string(),
            original_filename: Some("../opening.xlsx".to_string()),
            cutover_date: "2026-08-05".to_string(),
        };
        assert!(request.validate().is_err());
    }

    #[test]
    fn requires_counterparty_for_receivables() {
        let mut line = valid_line();
        line.line_type = "CUSTOMER_RECEIVABLE".to_string();
        assert!(line.validate().is_err());
        line.counterparty_name = Some("Customer A".to_string());
        assert!(line.validate().is_ok());
    }

    #[test]
    fn rejects_negative_amounts() {
        let mut line = valid_line();
        line.amount_dzd = -1;
        assert!(line.validate().is_err());
    }

    #[test]
    fn validates_bounded_package_data() {
        let request = ReplaceOpeningStatePackageDataRequest {
            package_id: 1,
            lines: vec![valid_line()],
        };
        assert!(request.validate().is_ok());
    }
}
