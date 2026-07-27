use crate::domain::history::*;
use crate::error::AppError;
use serde_json::Value as JsonValue;
use sqlx::PgPool;

pub(crate) async fn create_import_batch(
    pool: &PgPool,
    session_token: &str,
    payload: CreateImportBatchPayload,
) -> Result<JsonValue, AppError> {
    let res: JsonValue = sqlx::query_scalar("SELECT core.create_import_batch($1, $2, $3)")
        .bind(session_token)
        .bind(&payload.file_name)
        .bind(payload.total_rows)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    Ok(res)
}

pub(crate) async fn list_import_batches(
    pool: &PgPool,
    session_token: &str,
) -> Result<Vec<ImportBatchDto>, AppError> {
    let res: JsonValue = sqlx::query_scalar(
        "SELECT jsonb_agg(b) FROM (
            SELECT b.id, b.batch_number, b.status, b.file_name, b.total_rows, b.valid_rows, b.error_rows, b.created_by, b.created_at, b.validated_at, b.locked_at
            FROM core.list_import_batches($1) b
         ) b"
    )
    .bind(session_token)
    .fetch_one(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    if res.is_null() {
        return Ok(Vec::new());
    }

    let list: Vec<ImportBatchDto> = serde_json::from_value(res)
        .map_err(|e| AppError::internal(format!("Failed to parse import batches: {e}")))?;

    Ok(list)
}

pub(crate) async fn get_staged_records(
    pool: &PgPool,
    session_token: &str,
    batch_id: &str,
) -> Result<Vec<StagedRecordDto>, AppError> {
    let res: JsonValue = sqlx::query_scalar(
        "SELECT jsonb_agg(r) FROM (
            SELECT r.id, r.batch_id, r.row_number, r.entity_type, r.raw_json, r.corrected_json, r.validation_errors, r.status, r.created_at
            FROM core.get_staged_records($1, $2::uuid) r
         ) r"
    )
    .bind(session_token)
    .bind(batch_id)
    .fetch_one(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    if res.is_null() {
        return Ok(Vec::new());
    }

    let list: Vec<StagedRecordDto> = serde_json::from_value(res)
        .map_err(|e| AppError::internal(format!("Failed to parse staged records: {e}")))?;

    Ok(list)
}

pub(crate) async fn update_staged_record(
    pool: &PgPool,
    session_token: &str,
    payload: UpdateStagedRecordPayload,
) -> Result<JsonValue, AppError> {
    let res: JsonValue = sqlx::query_scalar("SELECT core.update_staged_record($1, $2::uuid, $3)")
        .bind(session_token)
        .bind(&payload.record_id)
        .bind(payload.corrected_json)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    Ok(res)
}

pub(crate) async fn replay_historical_batch(
    pool: &PgPool,
    session_token: &str,
    batch_id: &str,
) -> Result<ReplayResultDto, AppError> {
    let res: JsonValue = sqlx::query_scalar("SELECT core.replay_historical_batch($1, $2::uuid)")
        .bind(session_token)
        .bind(batch_id)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    let dto: ReplayResultDto = serde_json::from_value(res)
        .map_err(|e| AppError::internal(format!("Failed to parse replay result: {e}")))?;

    Ok(dto)
}

pub(crate) async fn commit_historical_batch(
    pool: &PgPool,
    session_token: &str,
    batch_id: &str,
) -> Result<CommitBatchResultDto, AppError> {
    let res: JsonValue = sqlx::query_scalar("SELECT core.commit_historical_batch($1, $2::uuid)")
        .bind(session_token)
        .bind(batch_id)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    let dto: CommitBatchResultDto = serde_json::from_value(res)
        .map_err(|e| AppError::internal(format!("Failed to parse commit result: {e}")))?;

    Ok(dto)
}
