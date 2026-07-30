use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};
use sqlx::{query_scalar, PgPool};
use time::Date;

use crate::domain::canonical_json::payload_hash;
use crate::error::AppError;

#[derive(Debug, Clone, Serialize)]
pub(crate) struct CreditSaleLineInput {
    pub variant_id: i64,
    pub quantity: Decimal,
    pub unit_price: Decimal,
}

#[derive(Debug, Clone)]
pub(crate) struct CreditSaleDraft {
    pub customer_id: i64,
    pub warehouse_id: i64,
    pub fiscal_period_id: i64,
    pub document_date: Date,
    pub lines: Vec<CreditSaleLineInput>,
}

pub(crate) struct ConfirmCreditSaleRequest {
    pub request_id: String,
    pub draft: CreditSaleDraft,
    pub override_token: Option<String>,
}

pub(crate) struct AuthorizeCreditOverrideRequest {
    pub token_id: String,
    pub draft: CreditSaleDraft,
    pub reason: String,
    pub ttl_minutes: i32,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CreditSaleResult {
    pub document_id: i64,
    pub document_number: String,
    pub customer_id: i64,
    pub total_amount: String,
    pub due_date: String,
    pub exposure_amount: String,
    pub available_credit: String,
    pub journal_document_id: i64,
}

fn validate_draft(draft: &CreditSaleDraft) -> Result<(), AppError> {
    if draft.customer_id <= 0 || draft.warehouse_id <= 0 || draft.fiscal_period_id <= 0 {
        return Err(AppError::ValidationError {
            diagnostic: "customer, warehouse, and fiscal period must be selected".to_string(),
        });
    }
    if draft.lines.is_empty() {
        return Err(AppError::ValidationError {
            diagnostic: "credit sale must contain at least one line".to_string(),
        });
    }
    for (index, line) in draft.lines.iter().enumerate() {
        if line.variant_id <= 0 || line.quantity <= Decimal::ZERO || line.unit_price < Decimal::ZERO {
            return Err(AppError::ValidationError {
                diagnostic: format!("credit sale line {} is invalid", index + 1),
            });
        }
    }
    Ok(())
}

fn canonical_payload(draft: &CreditSaleDraft, lines_json: JsonValue) -> JsonValue {
    json!({
        "customer_id": draft.customer_id,
        "warehouse_id": draft.warehouse_id,
        "fiscal_period_id": draft.fiscal_period_id,
        "document_date": draft.document_date.to_string(),
        "lines": lines_json,
    })
}

pub(crate) async fn confirm_credit_sale(
    pool: &PgPool,
    session_token: &str,
    request: ConfirmCreditSaleRequest,
) -> Result<CreditSaleResult, AppError> {
    validate_draft(&request.draft)?;
    let lines_json = serde_json::to_value(&request.draft.lines)
        .map_err(|e| AppError::internal(format!("failed to serialize credit sale lines: {e}")))?;
    let hash = payload_hash(&canonical_payload(&request.draft, lines_json.clone()));

    let result: JsonValue = query_scalar(
        "SELECT sales.confirm_credit_sale(\
            $1, $2::uuid, $3, $4, $5, $6, $7, $8, $9::uuid\
         )",
    )
    .bind(session_token)
    .bind(&request.request_id)
    .bind(hash.as_slice())
    .bind(request.draft.customer_id)
    .bind(request.draft.warehouse_id)
    .bind(request.draft.fiscal_period_id)
    .bind(request.draft.document_date)
    .bind(lines_json)
    .bind(request.override_token.as_deref())
    .fetch_one(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    serde_json::from_value(result)
        .map_err(|e| AppError::internal(format!("failed to parse credit sale result: {e}")))
}

pub(crate) async fn authorize_credit_override(
    pool: &PgPool,
    session_token: &str,
    request: AuthorizeCreditOverrideRequest,
) -> Result<String, AppError> {
    validate_draft(&request.draft)?;
    if request.reason.trim().is_empty() {
        return Err(AppError::ValidationError {
            diagnostic: "credit override reason is required".to_string(),
        });
    }
    if !(1..=60).contains(&request.ttl_minutes) {
        return Err(AppError::ValidationError {
            diagnostic: "credit override ttl must be between 1 and 60 minutes".to_string(),
        });
    }

    let lines_json = serde_json::to_value(&request.draft.lines)
        .map_err(|e| AppError::internal(format!("failed to serialize credit sale lines: {e}")))?;
    let hash = payload_hash(&canonical_payload(&request.draft, lines_json));

    let token: String = query_scalar(
        "SELECT receivables.authorize_credit_override(\
            $1, $2::uuid, $3, $4, $5, $6\
         )::text",
    )
    .bind(session_token)
    .bind(&request.token_id)
    .bind(request.draft.customer_id)
    .bind(hash.as_slice())
    .bind(request.reason.trim())
    .bind(request.ttl_minutes)
    .fetch_one(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    Ok(token)
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::Month;

    fn draft(price: i64) -> CreditSaleDraft {
        CreditSaleDraft {
            customer_id: 1,
            warehouse_id: 1,
            fiscal_period_id: 1,
            document_date: Date::from_calendar_date(2026, Month::July, 30).unwrap(),
            lines: vec![CreditSaleLineInput {
                variant_id: 1,
                quantity: Decimal::ONE,
                unit_price: Decimal::new(price, 2),
            }],
        }
    }

    #[test]
    fn canonical_override_hash_changes_when_cart_changes() {
        let a = draft(10_000);
        let b = draft(20_000);
        let a_lines = serde_json::to_value(&a.lines).unwrap();
        let b_lines = serde_json::to_value(&b.lines).unwrap();
        assert_ne!(
            payload_hash(&canonical_payload(&a, a_lines)),
            payload_hash(&canonical_payload(&b, b_lines))
        );
    }

    #[test]
    fn rejects_invalid_line_before_database_call() {
        let mut invalid = draft(10_000);
        invalid.lines[0].quantity = Decimal::ZERO;
        assert!(validate_draft(&invalid).is_err());
    }
}
