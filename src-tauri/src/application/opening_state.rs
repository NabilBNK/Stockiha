use serde_json::{json, Value as JsonValue};
use sqlx::{query_scalar, PgPool};

use crate::application::parse_iso_date;
use crate::domain::opening_state::{
    CreateOpeningStatePackageRequest, OpeningStateApprovalResult, OpeningStatePackageDataResult,
    OpeningStatePackageIdRequest, OpeningStatePackageResult, OpeningStatePackageSummaryResult,
    OpeningStateSettingResult, OpeningStateValidationResult, ReplaceOpeningStatePackageDataRequest,
    UpdateOpeningStateSettingRequest,
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

pub(crate) async fn get_opening_state_setting(
    pool: &PgPool,
    session_token: &str,
) -> Result<OpeningStateSettingResult, AppError> {
    let result: JsonValue = query_scalar("SELECT onboarding.get_opening_state_setting($1)")
        .bind(session_token)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    parse_result(result, "opening-state setting")
}

pub(crate) async fn update_opening_state_setting(
    pool: &PgPool,
    session_token: &str,
    request: UpdateOpeningStateSettingRequest,
) -> Result<OpeningStateSettingResult, AppError> {
    let result: JsonValue = query_scalar("SELECT onboarding.update_opening_state_setting($1, $2)")
        .bind(session_token)
        .bind(request.enabled)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    parse_result(result, "updated opening-state setting")
}

pub(crate) async fn create_opening_state_package(
    pool: &PgPool,
    session_token: &str,
    request: CreateOpeningStatePackageRequest,
) -> Result<OpeningStatePackageResult, AppError> {
    request.validate().map_err(validation_error)?;

    let cutover_date = parse_iso_date(request.cutover_date.trim())?;
    let source_type = request.source_type.trim().to_ascii_uppercase();
    let original_filename = request
        .original_filename
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let result: JsonValue =
        query_scalar("SELECT onboarding.create_opening_state_package($1, $2, $3, $4, $5)")
            .bind(session_token)
            .bind(request.request_id.trim())
            .bind(source_type)
            .bind(original_filename)
            .bind(cutover_date)
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    parse_result(result, "opening-state package")
}

pub(crate) async fn replace_opening_state_package_data(
    pool: &PgPool,
    session_token: &str,
    request: ReplaceOpeningStatePackageDataRequest,
) -> Result<OpeningStatePackageDataResult, AppError> {
    request.validate().map_err(validation_error)?;

    let lines = request
        .lines
        .iter()
        .map(|line| {
            json!({
                "source_row_number": line.source_row_number,
                "line_type": line.line_type.trim().to_ascii_uppercase(),
                "description": line.description.trim(),
                "amount_dzd": line.amount_dzd,
                "counterparty_name": line.counterparty_name.as_deref().map(str::trim),
                "external_reference": line.external_reference.as_deref().map(str::trim),
                "notes": line.notes.as_deref().map(str::trim),
                "review_status": line.review_status.trim().to_ascii_uppercase(),
            })
        })
        .collect::<Vec<_>>();

    let result: JsonValue =
        query_scalar("SELECT onboarding.replace_opening_state_package_data($1, $2, $3)")
            .bind(session_token)
            .bind(request.package_id)
            .bind(JsonValue::Array(lines))
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    parse_result(result, "opening-state package data result")
}

pub(crate) async fn validate_opening_state_package(
    pool: &PgPool,
    session_token: &str,
    request: OpeningStatePackageIdRequest,
) -> Result<OpeningStateValidationResult, AppError> {
    request.validate().map_err(validation_error)?;

    let result: JsonValue =
        query_scalar("SELECT onboarding.validate_opening_state_package($1, $2)")
            .bind(session_token)
            .bind(request.package_id)
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    parse_result(result, "opening-state validation result")
}

pub(crate) async fn approve_opening_state_package(
    pool: &PgPool,
    session_token: &str,
    request: OpeningStatePackageIdRequest,
) -> Result<OpeningStateApprovalResult, AppError> {
    request.validate().map_err(validation_error)?;

    let result: JsonValue = query_scalar("SELECT onboarding.approve_opening_state_package($1, $2)")
        .bind(session_token)
        .bind(request.package_id)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    parse_result(result, "opening-state approval result")
}

pub(crate) async fn get_opening_state_package(
    pool: &PgPool,
    session_token: &str,
    request: OpeningStatePackageIdRequest,
) -> Result<OpeningStatePackageSummaryResult, AppError> {
    request.validate().map_err(validation_error)?;

    let result: JsonValue = query_scalar("SELECT onboarding.get_opening_state_package($1, $2)")
        .bind(session_token)
        .bind(request.package_id)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    parse_result(result, "opening-state package summary")
}
