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

/// Serializes the line array to the `jsonb` shape `sales.confirm_cash_sale`
/// expects and derives the canonical idempotency hash over the whole request.
///
/// Split out so that anything issuing the posting call over a connection this
/// module does not own (the concurrency regression test drives two explicit
/// transactions) derives the payload the same way production does, rather than
/// rebuilding it and drifting.
fn canonical_cash_sale_payload(
    request: &CashSaleRequest,
) -> Result<(serde_json::Value, [u8; 32]), AppError> {
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

    Ok((lines_json, hash))
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
    let (lines_json, hash) = canonical_cash_sale_payload(&request)?;

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
    use crate::application::{cash_session, catalog, stock_receipt, test_fixtures};
    use crate::domain::cash_session::DenominationCountInput;
    use time::Month;

    // `STOCKIHA_TEST_DATABASE_URL` handling, including the `_test` suffix
    // guard, lives in `crate::application::test_fixtures`. See
    // `super::super::stock_receipt::tests` for the out-of-band fixture
    // requirements the older test below still depends on.
    use test_fixtures::require_test_pool_url;

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
        cash_session::begin_cash_session_close(&pool, "rust-integration-token", cash_session_id)
            .await
            .expect("beginning blind close should succeed");

        let denominations = cash_session::list_cash_denominations(&pool, "rust-integration-token")
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

    /// WS-F / F-POS-001 — two concurrent cash sales must not both consume the
    /// same last unit of stock.
    ///
    /// The reproduction is deterministic rather than racy. Transaction A posts
    /// its sale and is deliberately held open, so it still holds the lock the
    /// posting function takes over the touched `inventory.positions` rows.
    /// Transaction B then posts an identical sale on a second connection and
    /// necessarily blocks; the test waits for that block to appear in
    /// `pg_stat_activity` rather than sleeping a guessed interval, commits A,
    /// and only then inspects B's outcome.
    ///
    /// That ordering is what makes the assertion discriminating:
    ///
    /// * With the `FOR UPDATE` from
    ///   `20260823090000_sales_cash_sale_position_lock.sql`, B blocks *before*
    ///   reading the quantity. When A commits, B acquires the lock and its
    ///   subsequent read — a new statement, so a new READ COMMITTED snapshot —
    ///   sees `quantity_on_hand = 0` and raises `insufficient stock`.
    /// * Without it, B's unlocked read returns the last committed quantity (1),
    ///   B passes the sufficiency check, and B blocks later on the `UPDATE`.
    ///   When A commits, B's `UPDATE` re-evaluates only its `WHERE` clause and
    ///   writes the value B computed from the stale read. Both sales succeed
    ///   and one unit is sold twice.
    ///
    /// So "exactly one succeeds" fails loudly if the lock is ever removed.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    #[ignore = "requires a live PostgreSQL server and STOCKIHA_TEST_DATABASE_URL"]
    async fn concurrent_cash_sales_cannot_oversell_the_last_unit() {
        use sqlx::Connection;

        let url = test_fixtures::require_test_pool_url();
        let pool = sqlx::PgPool::connect(&url)
            .await
            .expect("failed to connect to the integration test database");

        // ---- fixtures, all through sanctioned paths -----------------------
        let (_admin_id, token) = test_fixtures::root_admin_session(&pool).await;
        let warehouse_id = test_fixtures::fixture_warehouse_id(&pool).await;
        let fiscal_period_id = test_fixtures::fixture_fiscal_period_id(&pool).await;
        let cash_session_id =
            test_fixtures::fixture_cash_session_id(&pool, &token, warehouse_id).await;
        let document_date = time::Date::from_calendar_date(2026, Month::June, 15).unwrap();

        // A variant of its own, so nothing else in the database can perturb the
        // balance this test reasons about.
        let suffix = test_fixtures::unique_suffix();
        let created = catalog::create_product_with_variant(
            &pool,
            &token,
            &format!("Oversell Probe {suffix}"),
            &format!("OVERSELL-{suffix}"),
            Decimal::new(15_000, 2),
            true,
        )
        .await
        .expect("creating the probe product must succeed");
        let variant_id = created.variant_id;

        // Exactly one unit on hand — the contested unit.
        stock_receipt::confirm_stock_receipt(
            &pool,
            &token,
            stock_receipt::StockReceiptRequest {
                request_id: unique_request_id(),
                warehouse_id,
                variant_id,
                quantity: Decimal::ONE,
                unit_cost: Decimal::new(10_000, 2),
                fiscal_period_id,
                document_date,
            },
        )
        .await
        .expect("receiving the single unit must succeed");

        let on_hand: Decimal = sqlx::query_scalar(
            "SELECT quantity_on_hand FROM inventory.positions \
             WHERE warehouse_id = $1 AND variant_id = $2",
        )
        .bind(warehouse_id)
        .bind(variant_id)
        .fetch_one(&pool)
        .await
        .expect("the probe position must exist");
        assert_eq!(on_hand, Decimal::ONE, "the fixture must start at exactly 1");

        // ---- both sales ask for the same single unit ----------------------
        let sale_request = |request_id: String| CashSaleRequest {
            request_id,
            cash_session_id,
            warehouse_id,
            fiscal_period_id,
            document_date,
            lines: vec![CashSaleLineInput {
                variant_id,
                quantity: Decimal::ONE,
                unit_price: Decimal::new(15_000, 2),
            }],
        };

        const POST_SQL: &str = "SELECT sales.confirm_cash_sale(\
                                    $1, $2::uuid, $3, $4, $5, $6, $7, $8\
                                )";

        // Transaction A: post, then hold the transaction open.
        let request_a = sale_request(unique_request_id());
        let (lines_a, hash_a) =
            canonical_cash_sale_payload(&request_a).expect("payload must serialize");
        let mut conn_a = sqlx::PgConnection::connect(&url)
            .await
            .expect("connection A must open");
        sqlx::query("BEGIN").execute(&mut conn_a).await.unwrap();
        let document_a: i64 = sqlx::query_scalar(POST_SQL)
            .bind(&token)
            .bind(&request_a.request_id)
            .bind(hash_a.as_slice())
            .bind(request_a.cash_session_id)
            .bind(request_a.warehouse_id)
            .bind(request_a.fiscal_period_id)
            .bind(request_a.document_date)
            .bind(&lines_a)
            .fetch_one(&mut conn_a)
            .await
            .expect("the first sale must succeed");
        assert!(document_a > 0);

        // Transaction B: same unit, concurrently, on its own connection.
        let url_b = url.clone();
        let token_b = token.clone();
        let request_b = sale_request(unique_request_id());
        let request_b_id = request_b.request_id.clone();
        let (lines_b, hash_b) =
            canonical_cash_sale_payload(&request_b).expect("payload must serialize");
        let handle = tokio::spawn(async move {
            let mut conn_b = sqlx::PgConnection::connect(&url_b)
                .await
                .expect("connection B must open");
            sqlx::query("BEGIN").execute(&mut conn_b).await.unwrap();
            let outcome: Result<i64, sqlx::Error> = sqlx::query_scalar(POST_SQL)
                .bind(&token_b)
                .bind(&request_b.request_id)
                .bind(hash_b.as_slice())
                .bind(request_b.cash_session_id)
                .bind(request_b.warehouse_id)
                .bind(request_b.fiscal_period_id)
                .bind(request_b.document_date)
                .bind(&lines_b)
                .fetch_one(&mut conn_b)
                .await;
            let closing = if outcome.is_ok() {
                "COMMIT"
            } else {
                "ROLLBACK"
            };
            sqlx::query(closing).execute(&mut conn_b).await.unwrap();
            outcome
        });

        // Wait for B to actually be blocked on a lock rather than guessing.
        let mut blocked = false;
        for _ in 0..200 {
            let waiting: i64 = sqlx::query_scalar(
                "SELECT count(*) FROM pg_stat_activity \
                 WHERE datname = current_database() \
                   AND wait_event_type = 'Lock' \
                   AND pid <> pg_backend_pid()",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            if waiting > 0 {
                blocked = true;
                break;
            }
            // `tokio`'s timer feature is not enabled for this crate's tests, so
            // the pause is taken on the server instead of in the runtime.
            sqlx::query("SELECT pg_sleep(0.05)")
                .execute(&pool)
                .await
                .unwrap();
        }
        assert!(
            blocked,
            "the second sale never blocked — the posting function is not \
             serializing access to the contested stock position at all"
        );

        // Release A. B now proceeds against the post-sale balance.
        sqlx::query("COMMIT").execute(&mut conn_a).await.unwrap();
        conn_a.close().await.unwrap();

        let outcome_b = handle.await.expect("task B must not panic");

        // ---- exactly one sale, and it is A --------------------------------
        let error_b = outcome_b.expect_err(
            "the second sale must be rejected; if it succeeded, one unit of \
             stock was sold twice",
        );
        let message = error_b.to_string();
        assert!(
            message.contains("insufficient stock"),
            "expected an insufficient-stock rejection, got: {message}"
        );
        assert_eq!(
            error_b
                .as_database_error()
                .and_then(|db| db.code().map(|code| code.into_owned()))
                .as_deref(),
            Some("55000"),
            "the rejection must keep its precondition SQLSTATE"
        );

        // ---- the ledger agrees -------------------------------------------
        let final_qty: Decimal = sqlx::query_scalar(
            "SELECT quantity_on_hand FROM inventory.positions \
             WHERE warehouse_id = $1 AND variant_id = $2",
        )
        .bind(warehouse_id)
        .bind(variant_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(final_qty, Decimal::ZERO, "the single unit is now gone");

        let issues: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM inventory.movements \
             WHERE warehouse_id = $1 AND variant_id = $2 AND movement_type = 'ISSUE'",
        )
        .bind(warehouse_id)
        .bind(variant_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            issues, 1,
            "exactly one ISSUE movement may exist for the contested unit"
        );

        let sale_lines: i64 =
            sqlx::query_scalar("SELECT count(*) FROM sales.cash_sale_lines WHERE variant_id = $1")
                .bind(variant_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            sale_lines, 1,
            "only the winning sale may have posted a line"
        );

        // The rejected transaction must leave nothing behind at all.
        let orphans: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM core.request_idempotency WHERE request_id = $1::uuid",
        )
        .bind(&request_b_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            orphans, 0,
            "the rolled-back sale must not leave an idempotency reservation"
        );
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
