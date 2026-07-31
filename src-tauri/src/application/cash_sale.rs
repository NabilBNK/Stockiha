//! Slice 1 MVP batch — application service wrapping
//! `sales.confirm_cash_sale`.
//!
//! Same division of responsibility as [`super::stock_receipt`]: every
//! business rule (stock locking, WAC-costed COGS, balanced journal,
//! numbering, job enqueueing) lives in the SQL posting function. This
//! layer builds the canonical idempotency payload, serializes the line
//! array to the `jsonb` shape the function expects, and classifies errors.

use rust_decimal::Decimal;
use serde::Serialize;
use serde_json::json;
use sqlx::PgPool;
use time::Date;

use crate::domain::canonical_json::payload_hash;
use crate::error::AppError;

#[derive(Serialize)]
pub(crate) struct CashSaleLineInput {
    pub variant_id: i64,
    pub quantity: Decimal,
    pub unit_price: Decimal,
}

pub(crate) struct CashSaleRequest {
    pub request_id: String,
    pub cash_session_id: i64,
    pub warehouse_id: i64,
    pub fiscal_period_id: i64,
    pub document_date: Date,
    pub lines: Vec<CashSaleLineInput>,
}

/// Returns the posted cash sale's `core.business_documents.id`. An
/// identical retry (same `request_id`, same fields) returns the same id
/// instead of posting a second time; a retry with the same `request_id`
/// but different fields is rejected as an idempotency conflict.
pub(crate) async fn confirm_cash_sale(
    pool: &PgPool,
    session_token: &str,
    request: CashSaleRequest,
) -> Result<i64, AppError> {
    let lines_json = serde_json::to_value(&request.lines)
        .map_err(|e| AppError::internal(format!("failed to serialize sale lines: {e}")))?;

    let payload = json!({
        "cash_session_id": request.cash_session_id,
        "warehouse_id": request.warehouse_id,
        "fiscal_period_id": request.fiscal_period_id,
        "document_date": request.document_date.to_string(),
        "lines": lines_json,
    });
    let hash = payload_hash(&payload);

    let document_id: i64 = sqlx::query_scalar(
        "SELECT sales.confirm_cash_sale(\
            $1, $2::uuid, $3, $4, $5, $6, $7, $8\
         )",
    )
    .bind(session_token)
    .bind(&request.request_id)
    .bind(hash.as_slice())
    .bind(request.cash_session_id)
    .bind(request.warehouse_id)
    .bind(request.fiscal_period_id)
    .bind(request.document_date)
    .bind(lines_json)
    .fetch_one(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    Ok(document_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::{cash_session, stock_receipt};
    use crate::domain::cash_session::DenominationCountInput;
    use time::Month;

    // See `super::super::stock_receipt::tests` for the full fixture
    // requirements and `STOCKIHA_TEST_DATABASE_URL` setup this shares.
    fn require_test_pool_url() -> String {
        let url = std::env::var("STOCKIHA_TEST_DATABASE_URL")
            .expect("STOCKIHA_TEST_DATABASE_URL must be set to run this integration test");
        let options: sqlx::postgres::PgConnectOptions = url
            .parse()
            .expect("STOCKIHA_TEST_DATABASE_URL must be a valid PostgreSQL URL");
        let database = options.get_database().unwrap_or_default();
        assert!(
            database.ends_with("_test"),
            "refusing to run against a database not ending in `_test`: {database:?}"
        );
        url
    }

    #[tokio::test]
    #[ignore = "requires a live PostgreSQL server and STOCKIHA_TEST_DATABASE_URL"]
    async fn full_receipt_then_sale_chain_via_rust_application_services() {
        let pool = sqlx::PgPool::connect(&require_test_pool_url())
            .await
            .expect("failed to connect to the integration test database");

        // The documented rust-integration-token fixture is bound to POS-RUST.
        // S4-002 correctly requires the opened cash session to use the
        // authenticated session's workstation instead of accepting an
        // arbitrary caller-supplied workstation.
        let workstation_id = "POS-RUST".to_string();

        let cash_session_id = cash_session::open_cash_session(
            &pool,
            "rust-integration-token",
            1,
            &workstation_id,
            Decimal::ZERO,
        )
        .await
        .expect("opening a cash session should succeed");
        assert!(cash_session_id > 0);

        // Receive enough stock first so the sale below has something to
        // sell (this integration test does not assume any specific
        // leftover balance from a previous run).
        stock_receipt::confirm_stock_receipt(
            &pool,
            "rust-integration-token",
            stock_receipt::StockReceiptRequest {
                request_id: unique_request_id(),
                warehouse_id: 1,
                variant_id: 1,
                quantity: Decimal::new(100_000, 3),
                unit_cost: Decimal::new(4000, 2),
                fiscal_period_id: 1,
                document_date: time::Date::from_calendar_date(2026, Month::January, 20).unwrap(),
            },
        )
        .await
        .expect("prerequisite stock receipt should post successfully");

        let request_id = unique_request_id();
        let sale_document_id = confirm_cash_sale(
            &pool,
            "rust-integration-token",
            CashSaleRequest {
                request_id: request_id.clone(),
                cash_session_id,
                warehouse_id: 1,
                fiscal_period_id: 1,
                document_date: time::Date::from_calendar_date(2026, Month::January, 20).unwrap(),
                lines: vec![CashSaleLineInput {
                    variant_id: 1,
                    quantity: Decimal::new(2_000, 3),
                    unit_price: Decimal::new(10000, 2),
                }],
            },
        )
        .await
        .expect("cash sale should post successfully");
        assert!(sale_document_id > 0);

        // Identical retry must return the same document, not double-post.
        let retry_document_id = confirm_cash_sale(
            &pool,
            "rust-integration-token",
            CashSaleRequest {
                request_id,
                cash_session_id,
                warehouse_id: 1,
                fiscal_period_id: 1,
                document_date: time::Date::from_calendar_date(2026, Month::January, 20).unwrap(),
                lines: vec![CashSaleLineInput {
                    variant_id: 1,
                    quantity: Decimal::new(2_000, 3),
                    unit_price: Decimal::new(10000, 2),
                }],
            },
        )
        .await
        .expect("identical retry should succeed");
        assert_eq!(sale_document_id, retry_document_id);

        // S4-002 replaces the Slice-1 caller-supplied total close with the
        // blind denomination lifecycle. This sale is exactly 200 DZD with a
        // zero opening float, so one 200 DZD denomination closes with zero
        // variance and no manager approval.
        cash_session::begin_cash_session_close(
            &pool,
            "rust-integration-token",
            cash_session_id,
        )
        .await
        .expect("beginning blind close should succeed");

        let denominations = cash_session::list_cash_denominations(
            &pool,
            "rust-integration-token",
        )
        .await
        .expect("denominations should load");
        assert!(denominations.iter().any(|d| d.code == "DZD_200"));

        let counts: Vec<DenominationCountInput> = denominations
            .into_iter()
            .map(|denomination| DenominationCountInput {
                denomination_id: denomination.id,
                quantity: if denomination.code == "DZD_200" { 1 } else { 0 },
            })
            .collect();

        let close_result = cash_session::submit_cash_session_count(
            &pool,
            "rust-integration-token",
            cash_session_id,
            &counts,
        )
        .await
        .expect("blind close should succeed");
        assert_eq!(close_result.cash_session_id, cash_session_id);
        assert_eq!(close_result.status, "CLOSED");
        assert!(!close_result.requires_manager_approval);

        // A closed session can no longer be inspected as "active".
        let still_active = cash_session::inspect_active_cash_session(
            &pool,
            "rust-integration-token",
            &workstation_id,
        )
        .await
        .expect("inspect should still succeed even though nothing is active");
        assert!(still_active.is_none());
    }

    fn unique_request_id() -> String {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        format!(
            "{:08x}-{:04x}-4{:03x}-8{:03x}-{:012x}",
            (nanos >> 32) as u32,
            (nanos >> 16) as u16,
            nanos as u16 & 0x0fff,
            (nanos >> 48) as u16 & 0x0fff,
            nanos & 0xffff_ffff_ffff
        )
    }
}
