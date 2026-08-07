use serde_json::{json, Value as JsonValue};
use sqlx::{query_scalar, PgPool};

use crate::domain::onboarding::{
    parse_iso_date, CreateHistoricalFinanceBatchRequest, CreateHistoricalTradeBatchRequest,
    HistoricalFinanceApprovalResult, HistoricalFinanceBatchDataResult,
    HistoricalFinanceBatchIdRequest, HistoricalFinanceBatchResult, HistoricalFinanceSettingResult,
    HistoricalFinanceSummaryRequest, HistoricalFinanceSummaryResult,
    HistoricalFinanceValidationResult, HistoricalTradeAnalyticsRequest,
    HistoricalTradeBatchDataResult, HistoricalTradeBatchResult, HistoricalTradeValidationResult,
    ReplaceHistoricalFinanceBatchDataRequest, ReplaceHistoricalTradeBatchDataRequest,
    UpdateHistoricalFinanceSettingRequest,
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

pub(crate) async fn get_historical_finance_setting(
    pool: &PgPool,
    session_token: &str,
) -> Result<HistoricalFinanceSettingResult, AppError> {
    let result: JsonValue = query_scalar("SELECT onboarding.get_historical_finance_setting($1)")
        .bind(session_token)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    parse_result(result, "historical finance setting")
}

pub(crate) async fn update_historical_finance_setting(
    pool: &PgPool,
    session_token: &str,
    request: UpdateHistoricalFinanceSettingRequest,
) -> Result<HistoricalFinanceSettingResult, AppError> {
    let result: JsonValue =
        query_scalar("SELECT onboarding.update_historical_finance_setting($1, $2)")
            .bind(session_token)
            .bind(request.enabled)
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    parse_result(result, "updated historical finance setting")
}

pub(crate) async fn create_historical_finance_batch(
    pool: &PgPool,
    session_token: &str,
    request: CreateHistoricalFinanceBatchRequest,
) -> Result<HistoricalFinanceBatchResult, AppError> {
    request.validate().map_err(validation_error)?;

    let source_type = request.source_type.trim().to_ascii_uppercase();
    let original_filename = request
        .original_filename
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let result: JsonValue =
        query_scalar("SELECT onboarding.create_historical_finance_batch($1, $2, $3, $4)")
            .bind(session_token)
            .bind(request.request_id.trim())
            .bind(source_type)
            .bind(original_filename)
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    parse_result(result, "historical finance batch")
}

pub(crate) async fn replace_historical_finance_batch_data(
    pool: &PgPool,
    session_token: &str,
    request: ReplaceHistoricalFinanceBatchDataRequest,
) -> Result<HistoricalFinanceBatchDataResult, AppError> {
    request.validate().map_err(validation_error)?;

    let rows = request
        .rows
        .iter()
        .map(|row| {
            json!({
                "source_row_number": row.source_row_number,
                "paper_id": row.paper_id.trim(),
                "transaction_date": row.transaction_date.trim(),
                "transaction_type": row.transaction_type.trim().to_ascii_uppercase(),
                "description_or_category": row.description_or_category.trim(),
                "net_amount_dzd": row.net_amount_dzd,
                "payment_status": row.payment_status.trim().to_ascii_uppercase(),
                "amount_paid_dzd": row.amount_paid_dzd,
                "expense_category": row.expense_category.as_deref().map(str::trim),
                "supplier_fournisseur": row.supplier_fournisseur.as_deref().map(str::trim),
                "customer_client": row.customer_client.as_deref().map(str::trim),
                "notes": row.notes.as_deref().map(str::trim),
                "review_status": row.review_status.trim().to_ascii_uppercase(),
            })
        })
        .collect::<Vec<_>>();

    let balances = request
        .balances
        .iter()
        .map(|balance| {
            json!({
                "source_row_number": balance.source_row_number,
                "balance_date": balance.balance_date.trim(),
                "balance_type": balance.balance_type.trim().to_ascii_uppercase(),
                "amount_dzd": balance.amount_dzd,
                "supplier_fournisseur": balance.supplier_fournisseur.as_deref().map(str::trim),
                "customer_client": balance.customer_client.as_deref().map(str::trim),
                "notes": balance.notes.as_deref().map(str::trim),
                "review_status": balance.review_status.trim().to_ascii_uppercase(),
            })
        })
        .collect::<Vec<_>>();

    let result: JsonValue =
        query_scalar("SELECT onboarding.replace_historical_finance_batch_data($1, $2, $3, $4)")
            .bind(session_token)
            .bind(request.batch_id)
            .bind(JsonValue::Array(rows))
            .bind(JsonValue::Array(balances))
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    parse_result(result, "historical finance batch data result")
}

pub(crate) async fn validate_historical_finance_batch(
    pool: &PgPool,
    session_token: &str,
    request: HistoricalFinanceBatchIdRequest,
) -> Result<HistoricalFinanceValidationResult, AppError> {
    request.validate().map_err(validation_error)?;

    let result: JsonValue =
        query_scalar("SELECT onboarding.validate_historical_finance_batch($1, $2)")
            .bind(session_token)
            .bind(request.batch_id)
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    parse_result(result, "historical finance validation result")
}

pub(crate) async fn approve_historical_finance_batch(
    pool: &PgPool,
    session_token: &str,
    request: HistoricalFinanceBatchIdRequest,
) -> Result<HistoricalFinanceApprovalResult, AppError> {
    request.validate().map_err(validation_error)?;

    let result: JsonValue =
        query_scalar("SELECT onboarding.approve_historical_finance_batch($1, $2)")
            .bind(session_token)
            .bind(request.batch_id)
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    parse_result(result, "historical finance approval result")
}

pub(crate) async fn get_historical_finance_summary(
    pool: &PgPool,
    session_token: &str,
    request: HistoricalFinanceSummaryRequest,
) -> Result<HistoricalFinanceSummaryResult, AppError> {
    request.validate().map_err(validation_error)?;
    let date_from = parse_iso_date(&request.date_from, "dateFrom").map_err(validation_error)?;
    let date_to = parse_iso_date(&request.date_to, "dateTo").map_err(validation_error)?;

    let result: JsonValue =
        query_scalar("SELECT onboarding.get_historical_finance_summary($1, $2, $3)")
            .bind(session_token)
            .bind(date_from)
            .bind(date_to)
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    parse_result(result, "historical finance summary")
}

pub(crate) async fn create_historical_trade_batch(
    pool: &PgPool,
    session_token: &str,
    request: CreateHistoricalTradeBatchRequest,
) -> Result<HistoricalTradeBatchResult, AppError> {
    request.validate().map_err(validation_error)?;

    let original_filename = request.original_filename.trim();
    let content_hash = request
        .content_hash
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty());

    let result: JsonValue =
        query_scalar("SELECT onboarding.create_historical_trade_batch($1, $2, $3, $4)")
            .bind(session_token)
            .bind(request.request_id.trim())
            .bind(original_filename)
            .bind(content_hash)
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    parse_result(result, "historical trade batch")
}

pub(crate) async fn replace_historical_trade_batch_data(
    pool: &PgPool,
    session_token: &str,
    request: ReplaceHistoricalTradeBatchDataRequest,
) -> Result<HistoricalTradeBatchDataResult, AppError> {
    request.validate().map_err(validation_error)?;

    let transactions = request
        .transactions
        .iter()
        .map(|txn| {
            let lines = txn
                .lines
                .iter()
                .map(|line| {
                    json!({
                        "source_row_number": line.source_row_number,
                        "line_sequence": line.line_sequence,
                        "product_name": line.product_name.as_deref().map(str::trim),
                        "brand": line.brand.as_deref().map(str::trim),
                        "custom_details": line.custom_details.as_deref().map(str::trim),
                        "quantity": line.quantity,
                        "unit_price_dzd": line.unit_price_dzd,
                        "manual_line_total_dzd": line.manual_line_total_dzd,
                    })
                })
                .collect::<Vec<_>>();

            json!({
                "source_transaction_sequence": txn.source_transaction_sequence,
                "source_first_excel_row": txn.source_first_excel_row,
                "source_excel_txn_ref": txn.source_excel_txn_ref.as_deref().map(str::trim),
                "transaction_date": txn.transaction_date.trim(),
                "transaction_type": txn.transaction_type.trim().to_ascii_uppercase(),
                "payment_status": txn.payment_status.trim().to_ascii_uppercase(),
                "party_company": txn.party_company.as_deref().map(str::trim),
                "page_number": txn.page_number,
                "lines": lines,
            })
        })
        .collect::<Vec<_>>();

    let result: JsonValue =
        query_scalar("SELECT onboarding.replace_historical_trade_batch_data($1, $2, $3)")
            .bind(session_token)
            .bind(request.batch_id)
            .bind(JsonValue::Array(transactions))
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    parse_result(result, "historical trade batch data result")
}

pub(crate) async fn validate_historical_trade_batch(
    pool: &PgPool,
    session_token: &str,
    request: HistoricalFinanceBatchIdRequest,
) -> Result<HistoricalTradeValidationResult, AppError> {
    request.validate().map_err(validation_error)?;

    let result: JsonValue =
        query_scalar("SELECT onboarding.validate_historical_trade_batch($1, $2)")
            .bind(session_token)
            .bind(request.batch_id)
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    parse_result(result, "historical trade validation result")
}

pub(crate) async fn approve_historical_trade_batch(
    pool: &PgPool,
    session_token: &str,
    request: HistoricalFinanceBatchIdRequest,
) -> Result<HistoricalFinanceApprovalResult, AppError> {
    request.validate().map_err(validation_error)?;

    let result: JsonValue =
        query_scalar("SELECT onboarding.approve_historical_trade_batch($1, $2)")
            .bind(session_token)
            .bind(request.batch_id)
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    parse_result(result, "historical trade approval result")
}

pub(crate) async fn get_historical_trade_analytics(
    pool: &PgPool,
    session_token: &str,
    request: HistoricalTradeAnalyticsRequest,
) -> Result<JsonValue, AppError> {
    request.validate().map_err(validation_error)?;
    let date_from = parse_iso_date(&request.date_from, "dateFrom").map_err(validation_error)?;
    let date_to = parse_iso_date(&request.date_to, "dateTo").map_err(validation_error)?;

    let result: JsonValue =
        query_scalar("SELECT onboarding.get_historical_trade_analytics($1, $2, $3)")
            .bind(session_token)
            .bind(date_from)
            .bind(date_to)
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    Ok(result)
}
