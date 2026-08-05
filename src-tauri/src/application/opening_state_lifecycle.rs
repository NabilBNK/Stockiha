use serde_json::Value as JsonValue;
use sqlx::{query_scalar, PgPool};

use crate::domain::opening_state_lifecycle::{
    OpeningStateOnboardingStatusResult, SetOpeningStateOnboardingChoiceRequest,
};
use crate::error::AppError;

fn parse_result(value: JsonValue) -> Result<OpeningStateOnboardingStatusResult, AppError> {
    serde_json::from_value(value).map_err(|error| {
        AppError::internal(format!(
            "Failed to parse opening-state onboarding status: {error}"
        ))
    })
}

pub(crate) async fn get_status(
    pool: &PgPool,
    session_token: &str,
) -> Result<OpeningStateOnboardingStatusResult, AppError> {
    let value: JsonValue =
        query_scalar("SELECT onboarding.get_opening_state_onboarding_status($1)")
            .bind(session_token)
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    parse_result(value)
}

pub(crate) async fn set_choice(
    pool: &PgPool,
    session_token: &str,
    request: SetOpeningStateOnboardingChoiceRequest,
) -> Result<OpeningStateOnboardingStatusResult, AppError> {
    request
        .validate()
        .map_err(|diagnostic| AppError::ValidationError { diagnostic })?;

    let value: JsonValue =
        query_scalar("SELECT onboarding.set_opening_state_onboarding_choice($1, $2)")
            .bind(session_token)
            .bind(request.choice.trim().to_ascii_uppercase())
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    parse_result(value)
}
