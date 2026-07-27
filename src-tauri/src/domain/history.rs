use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct ImportBatchDto {
    pub id: String,
    pub batch_number: String,
    pub status: String,
    pub file_name: String,
    pub total_rows: i32,
    pub valid_rows: i32,
    pub error_rows: i32,
    pub created_by: String,
    pub created_at: String,
    pub validated_at: Option<String>,
    pub locked_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateImportBatchPayload {
    pub file_name: String,
    pub total_rows: i32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StagedRecordDto {
    pub id: String,
    pub batch_id: String,
    pub row_number: i32,
    pub entity_type: String,
    pub raw_json: serde_json::Value,
    pub corrected_json: Option<serde_json::Value>,
    pub validation_errors: Option<serde_json::Value>,
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateStagedRecordPayload {
    pub record_id: String,
    pub corrected_json: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ReplayResultDto {
    pub batch_id: String,
    pub status: String,
    pub total_records: i32,
    pub valid_records: i32,
    pub reconstruction_status: String,
    pub discrepancies_found: i32,
    pub calculated_stock_value: f64,
    pub calculated_receivables: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CommitBatchResultDto {
    pub batch_id: String,
    pub batch_number: String,
    pub status: String,
    pub message: String,
}
