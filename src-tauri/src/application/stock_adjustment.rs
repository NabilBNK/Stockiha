//! S2-002 application service for `inventory.confirm_stock_adjustment`.
//! PostgreSQL remains authoritative for stock, valuation, posting and journals;
//! this layer validates the closed reason vocabulary, canonicalizes the
//! idempotency payload, binds exact decimals and maps the cohesive response.

use rust_decimal::Decimal;
use serde_json::{json, Value as JsonValue};
use sqlx::PgPool;
use time::Date;

use crate::domain::canonical_json::payload_hash;
use crate::domain::stock::StockAdjustmentReason;
use crate::error::AppError;

pub(crate) struct StockAdjustmentRequest {
    pub request_id: String,
    pub warehouse_id: i64,
    pub variant_id: i64,
    pub unit_id: i64,
    pub quantity_delta: Decimal,
    pub reason: StockAdjustmentReason,
    pub note: Option<String>,
    pub fiscal_period_id: i64,
    pub document_date: Date,
}

pub(crate) struct StockAdjustmentResult {
    pub document_id: i64,
    pub document_number: String,
    pub movement_id: i64,
    pub journal_document_id: Option<i64>,
    pub journal_document_number: Option<String>,
    pub warehouse_id: i64,
    pub variant_id: i64,
    pub quantity_delta: String,
    pub inventory_value_delta: String,
    pub resulting_quantity_on_hand: String,
    pub resulting_total_value: String,
    pub reason_code: String,
}

pub(crate) struct StockAdjustmentUnit {
    pub unit_id: i64,
    pub unit_code: String,
    pub unit_name: String,
    pub conversion_factor: String,
    pub is_base: bool,
}

fn normalize_note(note: Option<String>) -> Option<String> {
    note.and_then(|value| {
        let trimmed = value.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_owned())
    })
}

fn canonical_payload(request: &StockAdjustmentRequest, note: Option<&str>) -> JsonValue {
    json!({
        "warehouse_id": request.warehouse_id,
        "variant_id": request.variant_id,
        "unit_id": request.unit_id,
        "quantity_delta": request.quantity_delta.to_string(),
        "reason_code": request.reason.as_db_str(),
        "note": note,
        "fiscal_period_id": request.fiscal_period_id,
        "document_date": request.document_date.to_string(),
    })
}

fn required_i64(value: &JsonValue, field: &str) -> Result<i64, AppError> {
    value.get(field).and_then(JsonValue::as_i64).ok_or_else(|| {
        AppError::internal(format!(
            "missing integer {field} in stock adjustment response"
        ))
    })
}

fn required_string(value: &JsonValue, field: &str) -> Result<String, AppError> {
    value
        .get(field)
        .and_then(JsonValue::as_str)
        .map(str::to_owned)
        .ok_or_else(|| {
            AppError::internal(format!(
                "missing string {field} in stock adjustment response"
            ))
        })
}

fn optional_i64(value: &JsonValue, field: &str) -> Result<Option<i64>, AppError> {
    match value.get(field) {
        None | Some(JsonValue::Null) => Ok(None),
        Some(raw) => raw.as_i64().map(Some).ok_or_else(|| {
            AppError::internal(format!(
                "invalid integer {field} in stock adjustment response"
            ))
        }),
    }
}

fn optional_string(value: &JsonValue, field: &str) -> Result<Option<String>, AppError> {
    match value.get(field) {
        None | Some(JsonValue::Null) => Ok(None),
        Some(raw) => raw
            .as_str()
            .map(|text| Some(text.to_owned()))
            .ok_or_else(|| {
                AppError::internal(format!(
                    "invalid string {field} in stock adjustment response"
                ))
            }),
    }
}

fn parse_response(value: JsonValue) -> Result<StockAdjustmentResult, AppError> {
    Ok(StockAdjustmentResult {
        document_id: required_i64(&value, "document_id")?,
        document_number: required_string(&value, "document_number")?,
        movement_id: required_i64(&value, "movement_id")?,
        journal_document_id: optional_i64(&value, "journal_document_id")?,
        journal_document_number: optional_string(&value, "journal_document_number")?,
        warehouse_id: required_i64(&value, "warehouse_id")?,
        variant_id: required_i64(&value, "variant_id")?,
        quantity_delta: required_string(&value, "quantity_delta")?,
        inventory_value_delta: required_string(&value, "inventory_value_delta")?,
        resulting_quantity_on_hand: required_string(&value, "resulting_quantity_on_hand")?,
        resulting_total_value: required_string(&value, "resulting_total_value")?,
        reason_code: required_string(&value, "reason_code")?,
    })
}

pub(crate) async fn confirm_stock_adjustment(
    pool: &PgPool,
    session_token: &str,
    request: StockAdjustmentRequest,
) -> Result<StockAdjustmentResult, AppError> {
    if request.quantity_delta.is_zero() {
        return Err(AppError::ValidationError {
            diagnostic: "stock adjustment quantity delta must not be zero".to_owned(),
        });
    }

    let note = normalize_note(request.note.clone());
    if request.reason == StockAdjustmentReason::Other && note.is_none() {
        return Err(AppError::ValidationError {
            diagnostic: "OTHER stock adjustment reason requires a note".to_owned(),
        });
    }

    let hash = payload_hash(&canonical_payload(&request, note.as_deref()));
    let (response,) = sqlx::query_as::<_, (JsonValue,)>(
        "SELECT inventory.confirm_stock_adjustment(\
            $1, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11\
         )",
    )
    .bind(session_token)
    .bind(&request.request_id)
    .bind(hash.as_slice())
    .bind(request.warehouse_id)
    .bind(request.variant_id)
    .bind(request.unit_id)
    .bind(request.quantity_delta)
    .bind(request.reason.as_db_str())
    .bind(note.as_deref())
    .bind(request.fiscal_period_id)
    .bind(request.document_date)
    .fetch_one(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    parse_response(response)
}

pub(crate) async fn list_stock_adjustment_units(
    pool: &PgPool,
    session_token: &str,
    variant_id: i64,
) -> Result<Vec<StockAdjustmentUnit>, AppError> {
    let rows = sqlx::query_as::<_, (i64, String, String, Decimal, bool)>(
        "SELECT unit_id, unit_code, unit_name, conversion_factor, is_base \
         FROM inventory.list_stock_adjustment_units($1, $2)",
    )
    .bind(session_token)
    .bind(variant_id)
    .fetch_all(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    Ok(rows
        .into_iter()
        .map(|row| StockAdjustmentUnit {
            unit_id: row.0,
            unit_code: row.1,
            unit_name: row.2,
            conversion_factor: row.3.to_string(),
            is_base: row.4,
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::Month;

    fn request(
        reason: StockAdjustmentReason,
        note: Option<&str>,
        delta: Decimal,
    ) -> StockAdjustmentRequest {
        StockAdjustmentRequest {
            request_id: "00000000-0000-4000-8000-000000000001".to_owned(),
            warehouse_id: 1,
            variant_id: 2,
            unit_id: 3,
            quantity_delta: delta,
            reason,
            note: note.map(str::to_owned),
            fiscal_period_id: 4,
            document_date: Date::from_calendar_date(2026, Month::July, 24).unwrap(),
        }
    }

    #[test]
    fn canonical_payload_preserves_signed_decimal_and_stable_reason() {
        let req = request(
            StockAdjustmentReason::RecordingError,
            Some("  corrected count  "),
            Decimal::new(-1250, 3),
        );
        let note = normalize_note(req.note.clone());
        let payload = canonical_payload(&req, note.as_deref());
        assert_eq!(payload["quantity_delta"], "-1.250");
        assert_eq!(payload["reason_code"], "RECORDING_ERROR");
        assert_eq!(payload["note"], "corrected count");
    }

    #[test]
    fn other_requires_a_non_blank_note() {
        let req = request(StockAdjustmentReason::Other, Some("   "), Decimal::ONE);
        assert!(normalize_note(req.note).is_none());
    }

    #[test]
    fn parses_cohesive_response_with_exact_decimal_strings() {
        let response = json!({
            "document_id": 10,
            "document_number": "SA-2026-000001",
            "movement_id": 11,
            "journal_document_id": 12,
            "journal_document_number": "JE-2026-000001",
            "warehouse_id": 1,
            "variant_id": 2,
            "quantity_delta": "3.000",
            "inventory_value_delta": "30.0000",
            "resulting_quantity_on_hand": "8.000",
            "resulting_total_value": "80.0000",
            "reason_code": "FOUND_STOCK"
        });
        let parsed = parse_response(response).unwrap();
        assert_eq!(parsed.document_number, "SA-2026-000001");
        assert_eq!(parsed.quantity_delta, "3.000");
        assert_eq!(parsed.journal_document_id, Some(12));
    }
}
