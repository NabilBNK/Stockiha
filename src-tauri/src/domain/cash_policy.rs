use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CashMovementDto {
    pub movement_id: i64,
    pub movement_type: String,
    pub amount: String,
    pub reason_code: Option<String>,
    pub note: Option<String>,
    pub business_document_id: Option<i64>,
    pub journal_document_id: Option<i64>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordCashMovementResult {
    pub movement_id: i64,
    pub cash_session_id: i64,
    pub movement_type: String,
    pub amount: String,
    pub reason_code: String,
    pub journal_document_id: i64,
    #[serde(default)]
    pub approved_by_user_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CashSessionPolicyDto {
    pub material_variance_threshold: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CashCapabilitiesDto {
    pub can_record_cash_movement: bool,
    pub can_approve_cash_out: bool,
}
