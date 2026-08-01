use serde_json::Value as JsonValue;
use sqlx::{query_scalar, PgPool};

use crate::domain::drawer::{DrawerOperationPolicy, UpdateDrawerOperationPolicyPayload};
use crate::error::AppError;

pub(crate) async fn list_drawer_operation_policy(
    pool: &PgPool,
    session_token: &str,
) -> Result<Vec<DrawerOperationPolicy>, AppError> {
    let result: JsonValue = query_scalar("SELECT cash.list_drawer_operation_policy($1)")
        .bind(session_token)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    serde_json::from_value(result)
        .map_err(|error| AppError::internal(format!("Failed to parse drawer policy: {error}")))
}

pub(crate) async fn update_drawer_operation_policy(
    pool: &PgPool,
    session_token: &str,
    payload: UpdateDrawerOperationPolicyPayload,
) -> Result<DrawerOperationPolicy, AppError> {
    payload
        .validate()
        .map_err(|diagnostic| AppError::ValidationError { diagnostic })?;

    let result: JsonValue = query_scalar(
        "SELECT cash.update_drawer_operation_policy($1, $2, $3)",
    )
    .bind(session_token)
    .bind(payload.operation_code.trim().to_ascii_uppercase())
    .bind(payload.is_enabled)
    .fetch_one(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    serde_json::from_value(result)
        .map_err(|error| AppError::internal(format!("Failed to parse updated drawer policy: {error}")))
}
