use std::collections::HashSet;

use serde::{Deserialize, Serialize};

const MAX_MAPPINGS: usize = 5_000;
const ACCOUNT_CODE_MAX_LEN: usize = 120;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpeningStateAccountOption {
    pub(crate) account_code: String,
    pub(crate) normal_side: String,
    pub(crate) description: String,
    pub(crate) is_default: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpeningStateApplicationLine {
    pub(crate) line_id: i64,
    pub(crate) source_row_number: i32,
    pub(crate) line_type: String,
    pub(crate) description: String,
    pub(crate) amount_dzd: i64,
    pub(crate) counterparty_name: Option<String>,
    pub(crate) external_reference: Option<String>,
    pub(crate) notes: Option<String>,
    pub(crate) account_options: Vec<OpeningStateAccountOption>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpeningStateApplicationPackage {
    pub(crate) package_id: i64,
    pub(crate) status: String,
    pub(crate) cutover_date: String,
    pub(crate) total_assets_dzd: i64,
    pub(crate) total_liabilities_dzd: i64,
    pub(crate) total_equity_dzd: i64,
    pub(crate) reconciliation_difference_dzd: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpeningStateApplicationContextResult {
    pub(crate) enabled: bool,
    pub(crate) has_approved_package: bool,
    pub(crate) applied: bool,
    pub(crate) application_id: Option<i64>,
    pub(crate) journal_document_id: Option<i64>,
    pub(crate) package: Option<OpeningStateApplicationPackage>,
    pub(crate) lines: Vec<OpeningStateApplicationLine>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateOpeningStateApplicationSettingRequest {
    pub(crate) enabled: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpeningStateApplicationSettingResult {
    pub(crate) enabled: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpeningStateApplicationMappingInput {
    pub(crate) line_id: i64,
    pub(crate) customer_id: Option<i64>,
    pub(crate) supplier_id: Option<i64>,
    pub(crate) account_code: Option<String>,
}

impl OpeningStateApplicationMappingInput {
    fn validate(&self) -> Result<(), String> {
        if self.line_id <= 0 {
            return Err("mapping lineId must be positive".to_string());
        }
        if self.customer_id.is_some_and(|id| id <= 0) {
            return Err("mapping customerId must be positive".to_string());
        }
        if self.supplier_id.is_some_and(|id| id <= 0) {
            return Err("mapping supplierId must be positive".to_string());
        }
        if self.customer_id.is_some() && self.supplier_id.is_some() {
            return Err("a mapping cannot select both a customer and supplier".to_string());
        }
        if let Some(account_code) = &self.account_code {
            let account_code = account_code.trim();
            if account_code.is_empty()
                || account_code.len() > ACCOUNT_CODE_MAX_LEN
                || account_code.chars().any(char::is_control)
            {
                return Err("mapping accountCode is empty, too long, or invalid".to_string());
            }
        }
        if self.customer_id.is_none() && self.supplier_id.is_none() && self.account_code.is_none() {
            return Err(
                "a mapping must select a customer, supplier, or controlled account".to_string(),
            );
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApplyOpeningStateRequest {
    pub(crate) request_id: String,
    pub(crate) package_id: i64,
    pub(crate) fiscal_period_id: i64,
    pub(crate) mappings: Vec<OpeningStateApplicationMappingInput>,
}

impl ApplyOpeningStateRequest {
    pub(crate) fn validate(&self) -> Result<(), String> {
        let request_id = self.request_id.trim();
        if request_id.len() < 8
            || request_id.len() > 128
            || request_id.chars().any(char::is_control)
        {
            return Err("requestId is invalid".to_string());
        }
        if self.package_id <= 0 || self.fiscal_period_id <= 0 {
            return Err("packageId and fiscalPeriodId must be positive".to_string());
        }
        if self.mappings.len() > MAX_MAPPINGS {
            return Err(format!("at most {MAX_MAPPINGS} mappings are allowed"));
        }

        let mut line_ids = HashSet::with_capacity(self.mappings.len());
        for (index, mapping) in self.mappings.iter().enumerate() {
            mapping
                .validate()
                .map_err(|error| format!("mappings[{index}]: {error}"))?;
            if !line_ids.insert(mapping.line_id) {
                return Err(format!("mappings[{index}]: duplicate lineId"));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpeningStateApplicationResult {
    pub(crate) application_id: i64,
    pub(crate) package_id: i64,
    pub(crate) journal_document_id: i64,
    pub(crate) status: String,
    pub(crate) is_replay: bool,
    pub(crate) physical_inventory_incomplete: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mapping(line_id: i64) -> OpeningStateApplicationMappingInput {
        OpeningStateApplicationMappingInput {
            line_id,
            customer_id: Some(1),
            supplier_id: None,
            account_code: None,
        }
    }

    #[test]
    fn validates_a_minimal_application_request() {
        let request = ApplyOpeningStateRequest {
            request_id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
            package_id: 1,
            fiscal_period_id: 1,
            mappings: vec![mapping(1)],
        };
        assert!(request.validate().is_ok());
    }

    #[test]
    fn rejects_duplicate_line_mappings() {
        let request = ApplyOpeningStateRequest {
            request_id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
            package_id: 1,
            fiscal_period_id: 1,
            mappings: vec![mapping(1), mapping(1)],
        };
        assert!(request.validate().is_err());
    }

    #[test]
    fn rejects_ambiguous_party_mapping() {
        let request = ApplyOpeningStateRequest {
            request_id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
            package_id: 1,
            fiscal_period_id: 1,
            mappings: vec![OpeningStateApplicationMappingInput {
                line_id: 1,
                customer_id: Some(1),
                supplier_id: Some(2),
                account_code: None,
            }],
        };
        assert!(request.validate().is_err());
    }
}
