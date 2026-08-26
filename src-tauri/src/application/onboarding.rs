use serde_json::{json, Value as JsonValue};
use sqlx::{query_scalar, PgPool};

use crate::domain::onboarding::{
    parse_iso_date, ApplyHistoricalProductAliasDecisionsRequest,
    ClearHistoricalProductAliasRequest, CreateHistoricalFinanceBatchRequest,
    CreateHistoricalTradeBatchRequest, HistoricalFinanceApprovalResult,
    HistoricalFinanceBatchDataResult, HistoricalFinanceBatchIdRequest,
    HistoricalFinanceBatchResult, HistoricalFinanceSettingResult, HistoricalFinanceSummaryRequest,
    HistoricalFinanceSummaryResult, HistoricalFinanceValidationResult,
    HistoricalProductAliasClearResult, HistoricalProductAliasWriteResult,
    HistoricalProductMappingRequest, HistoricalReportRequest, HistoricalTradeAnalyticsRequest,
    HistoricalTradeBatchDataResult, HistoricalTradeBatchResult, HistoricalTradeValidationResult,
    InventoryCorrectionsSettingResult, ReplaceHistoricalFinanceBatchDataRequest,
    ReplaceHistoricalTradeBatchDataRequest, UpdateHistoricalFinanceSettingRequest,
    UpdateInventoryCorrectionsSettingRequest,
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

pub(crate) async fn get_inventory_corrections_setting(
    pool: &PgPool,
    session_token: &str,
) -> Result<InventoryCorrectionsSettingResult, AppError> {
    let result: JsonValue = query_scalar("SELECT onboarding.get_inventory_corrections_setting($1)")
        .bind(session_token)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    parse_result(result, "inventory corrections setting")
}

pub(crate) async fn update_inventory_corrections_setting(
    pool: &PgPool,
    session_token: &str,
    request: UpdateInventoryCorrectionsSettingRequest,
) -> Result<InventoryCorrectionsSettingResult, AppError> {
    let result: JsonValue =
        query_scalar("SELECT onboarding.update_inventory_corrections_setting($1, $2)")
            .bind(session_token)
            .bind(request.enabled)
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    parse_result(result, "updated inventory corrections setting")
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
    let import_profile = request
        .import_profile
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or("PAPER_BOOK_V2");

    let result: JsonValue =
        query_scalar("SELECT onboarding.create_historical_trade_batch($1, $2, $3, $4, $5)")
            .bind(session_token)
            .bind(request.request_id.trim())
            .bind(original_filename)
            .bind(content_hash)
            .bind(import_profile)
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
                        "party_company": line.party_company.as_deref().map(str::trim),
                        // Exact decimal strings. PostgreSQL casts them into
                        // bigint/numeric; Rust never turns them into a float.
                        "manual_benefit_dzd": line.manual_benefit_dzd.as_deref().map(str::trim),
                        "quantity": line.quantity.as_deref().map(str::trim),
                        "unit_price_dzd": line.unit_price_dzd.as_deref().map(str::trim),
                        "manual_line_total_dzd": line.manual_line_total_dzd.as_deref().map(str::trim),
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
                "manual_benefit_dzd": txn.manual_benefit_dzd.as_deref().map(str::trim),
                "page_number": txn.page_number.as_deref().map(str::trim),
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

// --- R0-005 Historical product description mapping ---

pub(crate) async fn get_historical_product_mapping(
    pool: &PgPool,
    session_token: &str,
    request: HistoricalProductMappingRequest,
) -> Result<JsonValue, AppError> {
    request.validate().map_err(validation_error)?;

    let result: JsonValue =
        query_scalar("SELECT onboarding.get_historical_product_mapping($1, $2)")
            .bind(session_token)
            .bind(request.batch_id)
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    Ok(result)
}

pub(crate) async fn get_historical_mapping_readiness(
    pool: &PgPool,
    session_token: &str,
    request: HistoricalProductMappingRequest,
) -> Result<JsonValue, AppError> {
    request.validate().map_err(validation_error)?;

    let result: JsonValue =
        query_scalar("SELECT onboarding.get_historical_mapping_readiness($1, $2)")
            .bind(session_token)
            .bind(request.batch_id)
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    Ok(result)
}

/// WS-I: one historical financial report.
///
/// The whole computation — cost of goods sold, the weighted average, the
/// readiness gate, every total — happens inside the SQL function. This is a
/// typed pass-through: it validates the shape and hands the exact-decimal JSON
/// straight to the caller. It deliberately does not interpret, re-round or
/// re-total anything, because Rust is not the authority for a financial figure.
pub(crate) async fn get_historical_report(
    pool: &PgPool,
    session_token: &str,
    request: HistoricalReportRequest,
) -> Result<JsonValue, AppError> {
    request.validate().map_err(validation_error)?;

    let date_from = request.parsed_date_from().map_err(validation_error)?;
    let date_to = request.parsed_date_to().map_err(validation_error)?;

    let result: JsonValue =
        query_scalar("SELECT onboarding.get_historical_report($1, $2, $3, $4, $5)")
            .bind(session_token)
            .bind(request.normalized_code())
            .bind(request.batch_id)
            .bind(date_from)
            .bind(date_to)
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    Ok(result)
}

/// WS-I: the date span and batch the reports can currently cover, so the range
/// filter can offer real bounds instead of asking the operator to guess.
pub(crate) async fn get_historical_report_scope(
    pool: &PgPool,
    session_token: &str,
) -> Result<JsonValue, AppError> {
    let result: JsonValue = query_scalar("SELECT onboarding.get_historical_report_scope($1)")
        .bind(session_token)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    Ok(result)
}

/// Records administrator confirmations. There is no other write path into the
/// alias table, which is what makes "no automatic merge" enforceable.
pub(crate) async fn apply_historical_product_alias_decisions(
    pool: &PgPool,
    session_token: &str,
    request: ApplyHistoricalProductAliasDecisionsRequest,
) -> Result<HistoricalProductAliasWriteResult, AppError> {
    request.validate().map_err(validation_error)?;

    let decisions = request
        .decisions
        .iter()
        .map(|decision| {
            json!({
                "normalized_key": decision.normalized_key.trim(),
                "raw_sample": decision.raw_sample.as_deref().map(str::trim),
                "decision": decision.decision.trim().to_ascii_uppercase(),
                "canonical_key": decision.canonical_key.as_deref().map(str::trim),
                "note": decision.note.as_deref().map(str::trim),
            })
        })
        .collect::<Vec<_>>();

    let result: JsonValue =
        query_scalar("SELECT onboarding.apply_historical_product_alias_decisions($1, $2)")
            .bind(session_token)
            .bind(JsonValue::Array(decisions))
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    parse_result(result, "historical product alias decisions result")
}

pub(crate) async fn clear_historical_product_alias(
    pool: &PgPool,
    session_token: &str,
    request: ClearHistoricalProductAliasRequest,
) -> Result<HistoricalProductAliasClearResult, AppError> {
    request.validate().map_err(validation_error)?;

    let result: JsonValue =
        query_scalar("SELECT onboarding.clear_historical_product_alias($1, $2)")
            .bind(session_token)
            .bind(request.normalized_key.trim())
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    parse_result(result, "historical product alias clear result")
}

#[cfg(test)]
mod wsg_import_integration_tests {
    use super::*;
    use crate::application::test_fixtures;

    /// Drives the WS-G historical import through the real authoritative path:
    /// the same `application::onboarding` functions the Tauri commands call,
    /// which hand the exact-decimal strings to the `SECURITY DEFINER` SQL.
    ///
    /// The payload is produced by the production TypeScript parser from the
    /// CORRECTED oracle workbook (row 6 date fixed, row 83 future date fixed)
    /// and written to the file named by `STOCKIHA_WSG_PAYLOAD`.
    #[tokio::test]
    #[ignore = "requires a live PostgreSQL server, STOCKIHA_TEST_DATABASE_URL and STOCKIHA_WSG_PAYLOAD"]
    async fn stages_the_oracle_workbook_through_the_real_path() {
        let pool = sqlx::PgPool::connect(&test_fixtures::require_test_pool_url())
            .await
            .expect("failed to connect to the integration test database");

        let (_user_id, token) = test_fixtures::root_admin_session(&pool).await;

        update_historical_finance_setting(
            &pool,
            &token,
            UpdateHistoricalFinanceSettingRequest { enabled: true },
        )
        .await
        .expect("enabling the historical finance import must succeed");

        let payload_path =
            std::env::var("STOCKIHA_WSG_PAYLOAD").expect("STOCKIHA_WSG_PAYLOAD must be set");
        let payload_text =
            std::fs::read_to_string(&payload_path).expect("payload file must be readable");

        let batch = create_historical_trade_batch(
            &pool,
            &token,
            CreateHistoricalTradeBatchRequest {
                request_id: format!("wsg-oracle-{}", std::process::id()),
                original_filename: "Stockiha_Historical_TEST_DATASET_corrected.xlsx".to_string(),
                content_hash: None,
                import_profile: Some("PAPER_BOOK_V2".to_string()),
            },
        )
        .await
        .expect("creating the batch must succeed");
        println!("BATCH_ID={}", batch.batch_id);

        let mut request: ReplaceHistoricalTradeBatchDataRequest =
            serde_json::from_str(&payload_text).expect("payload must deserialise into the DTO");
        request.batch_id = batch.batch_id;
        println!("TXN_COUNT_IN_PAYLOAD={}", request.transactions.len());

        let staged = replace_historical_trade_batch_data(&pool, &token, request)
            .await
            .expect("staging must succeed");

        println!(
            "STAGED batch={} txns={} lines={} unmatched={} overrides={} missingQty={}",
            staged.batch_id,
            staged.transaction_count,
            staged.line_count,
            staged.unmatched_product_count,
            staged.override_count,
            staged.missing_qty_count
        );

        assert_eq!(staged.transaction_count, 235);
        assert_eq!(staged.line_count, 469);
    }
}
