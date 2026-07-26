use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerateCreditOverridePayload {
    pub customer_id: i64,
    pub payload_hash: String,
    pub valid_minutes: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreditOverrideTokenResult {
    pub token: String,
    pub customer_id: i64,
    pub expires_at: String,
}
