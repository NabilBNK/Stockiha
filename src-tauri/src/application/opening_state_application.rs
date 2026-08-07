use serde_json::{json, Value as JsonValue};
use sqlx::{query_scalar, PgPool};

use crate::domain::canonical_json::payload_hash;
use crate::domain::opening_state_application::{
    ApplyOpeningStateRequest, OpeningStateApplicationContextResult, OpeningStateApplicationResult,
    OpeningStateApplicationSettingResult, UpdateOpeningStateApplicationSettingRequest,
};
use crate::error::AppError;

fn validation_error(diagnostic: String) -> AppError {
    AppError::ValidationError { diagnostic }
}

fn parse_result<T: serde::de::DeserializeOwned>(
    value: JsonValue,
    label: &str,
) -> Result<T, AppError> {
    serde_json::from_value(value)
        .map_err(|error| AppError::internal(format!("Failed to parse {label}: {error}")))
}

pub(crate) async fn get_context(
    pool: &PgPool,
    session_token: &str,
) -> Result<OpeningStateApplicationContextResult, AppError> {
    let value: JsonValue =
        query_scalar("SELECT onboarding.get_opening_state_application_context($1)")
            .bind(session_token)
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    parse_result(value, "opening-state application context")
}

pub(crate) async fn update_setting(
    pool: &PgPool,
    session_token: &str,
    request: UpdateOpeningStateApplicationSettingRequest,
) -> Result<OpeningStateApplicationSettingResult, AppError> {
    let value: JsonValue =
        query_scalar("SELECT onboarding.update_opening_state_application_setting($1, $2)")
            .bind(session_token)
            .bind(request.enabled)
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    parse_result(value, "opening-state application setting")
}

pub(crate) async fn apply(
    pool: &PgPool,
    session_token: &str,
    request: ApplyOpeningStateRequest,
) -> Result<OpeningStateApplicationResult, AppError> {
    request.validate().map_err(validation_error)?;

    let mut mappings = request.mappings.clone();
    mappings.sort_by_key(|mapping| mapping.line_id);

    let canonical_mappings = mappings
        .iter()
        .map(|mapping| {
            json!({
                "lineId": mapping.line_id,
                "customerId": mapping.customer_id,
                "supplierId": mapping.supplier_id,
                "accountCode": mapping.account_code.as_deref().map(str::trim),
            })
        })
        .collect::<Vec<_>>();

    let canonical_payload = json!({
        "packageId": request.package_id,
        "fiscalPeriodId": request.fiscal_period_id,
        "mappings": canonical_mappings,
    });
    let hash = payload_hash(&canonical_payload).to_vec();

    let database_mappings = mappings
        .iter()
        .map(|mapping| {
            json!({
                "line_id": mapping.line_id,
                "customer_id": mapping.customer_id,
                "supplier_id": mapping.supplier_id,
                "account_code": mapping.account_code.as_deref().map(str::trim),
            })
        })
        .collect::<Vec<_>>();

    let value: JsonValue = query_scalar(
        "SELECT onboarding.apply_opening_state(\
            $1, $2::uuid, $3, $4, $5, $6\
         )",
    )
    .bind(session_token)
    .bind(request.request_id.trim())
    .bind(hash)
    .bind(request.package_id)
    .bind(request.fiscal_period_id)
    .bind(JsonValue::Array(database_mappings))
    .fetch_one(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    parse_result(value, "opening-state application result")
}
