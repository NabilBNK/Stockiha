use crate::domain::credit_override::{
    CreditOverrideTokenResult, GenerateCreditOverridePayload,
};
use crate::error::AppError;
use serde_json::Value as JsonValue;
use sqlx::PgPool;

fn parse_hex_bytes(s: &str) -> Result<Vec<u8>, AppError> {
    let clean = s.trim_start_matches("0x");
    if clean.len() % 2 != 0 {
        return Err(AppError::ValidationError {
            diagnostic: "Hex string length must be even.".to_string(),
        });
    }
    (0..clean.len())
        .step_by(2)
        .map(|i| {
            u8::from_str_radix(&clean[i..i + 2], 16).map_err(|_| AppError::ValidationError {
                diagnostic: "Invalid hex character.".to_string(),
            })
        })
        .collect()
}

pub(crate) async fn generate_credit_override_token(
    pool: &PgPool,
    session_token: &str,
    payload: GenerateCreditOverridePayload,
) -> Result<CreditOverrideTokenResult, AppError> {
    let payload_bytes = parse_hex_bytes(&payload.payload_hash)?;

    let res: JsonValue =
        sqlx::query_scalar("SELECT sales.generate_credit_override_token($1, $2, $3, $4)")
            .bind(session_token)
            .bind(payload.customer_id)
            .bind(payload_bytes.as_slice())
            .bind(payload.valid_minutes.unwrap_or(15))
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    let token_str = res["token"]
        .as_str()
        .ok_or_else(|| AppError::internal("Invalid token response"))?
        .to_string();
    let customer_id = res["customer_id"].as_i64().unwrap_or(payload.customer_id);
    let expires_at = res["expires_at"]
        .as_str()
        .unwrap_or_default()
        .to_string();

    Ok(CreditOverrideTokenResult {
        token: token_str,
        customer_id,
        expires_at,
    })
}
