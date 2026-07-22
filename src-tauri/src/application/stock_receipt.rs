//! Slice 1 MVP batch — application service wrapping
//! `inventory.confirm_stock_receipt`.
//!
//! Deliberately thin: all business logic (WAC calculation, movement
//! append, document numbering, validation) lives in the SQL posting
//! function. This layer's job is exactly the three things a Rust caller
//! must do that SQL cannot: build the canonical idempotency payload hash,
//! bind typed parameters, and translate the resulting `sqlx::Error` into a
//! typed [`AppError`].

use rust_decimal::Decimal;
use serde_json::json;
use sqlx::PgPool;
use time::Date;

use crate::domain::canonical_json::payload_hash;
use crate::error::AppError;

pub(crate) struct StockReceiptRequest {
    /// Client-generated request id (UUID text) — the same request replayed
    /// with the same fields returns the original result instead of
    /// double-posting.
    pub request_id: String,
    pub warehouse_id: i64,
    pub variant_id: i64,
    pub quantity: Decimal,
    pub unit_cost: Decimal,
    pub fiscal_period_id: i64,
    pub document_date: Date,
}

/// Returns the posted `core.business_documents.id`.
pub(crate) async fn confirm_stock_receipt(
    pool: &PgPool,
    session_token: &str,
    request: StockReceiptRequest,
) -> Result<i64, AppError> {
    let payload = json!({
        "warehouse_id": request.warehouse_id,
        "variant_id": request.variant_id,
        "quantity": request.quantity.to_string(),
        "unit_cost": request.unit_cost.to_string(),
        "fiscal_period_id": request.fiscal_period_id,
        "document_date": request.document_date.to_string(),
    });
    let hash = payload_hash(&payload);

    let document_id: i64 = sqlx::query_scalar(
        "SELECT inventory.confirm_stock_receipt(\
            $1, $2::uuid, $3, $4, $5, $6, $7, $8, $9\
         )",
    )
    .bind(session_token)
    .bind(&request.request_id)
    .bind(hash.as_slice())
    .bind(request.warehouse_id)
    .bind(request.variant_id)
    .bind(request.quantity)
    .bind(request.unit_cost)
    .bind(request.fiscal_period_id)
    .bind(request.document_date)
    .fetch_one(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    Ok(document_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::Month;

    // Genuine, opt-in Rust-to-PostgreSQL integration test, following the
    // exact `infrastructure::db` pattern: `#[ignore]`d by default, requires
    // `STOCKIHA_TEST_DATABASE_URL`, and refuses to run against a parsed
    // database name that does not end in `_test`. Deterministic fixtures
    // only (task requirement) — this test does NOT create its own
    // reference data (as `stockiha_runtime`, it cannot: that is exactly the
    // security model under test), so the target database must already have
    // these rows, created once via migrations + this fixed seed as
    // `stockiha_owner`:
    //
    //   INSERT INTO inventory.warehouses (code, name) VALUES ('WH1', 'Main Warehouse');
    //   INSERT INTO catalog.products (name) VALUES ('Widget');
    //   INSERT INTO catalog.product_variants (product_id, sku, sale_price) VALUES (1, 'SKU-001', 100.00);
    //   INSERT INTO finance.fiscal_periods (period_code, starts_on, ends_on) VALUES ('2026-01', '2026-01-01', '2026-01-31');
    //   INSERT INTO iam.users (username, password_hash, display_name) VALUES ('rustcashier', 'placeholder', 'Rust Test Cashier');
    //   INSERT INTO iam.user_roles (user_id, role_id) SELECT <that user's id>, id FROM iam.roles WHERE code IN ('CASHIER','MANAGER');
    //   INSERT INTO iam.application_sessions (token_hash, user_id, workstation_id, expires_at)
    //       VALUES (sha256('rust-integration-token'::bytea), <that user's id>, 'POS-RUST', now() + interval '1 hour');
    //
    //   $env:STOCKIHA_TEST_DATABASE_URL =
    //     "postgres://stockiha_runtime:<password>@localhost:5432/stockiha_rust_integration_test?sslmode=disable"
    //   cargo test -- --ignored
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
    async fn confirm_stock_receipt_posts_and_updates_wac() {
        let pool = sqlx::PgPool::connect(&require_test_pool_url())
            .await
            .expect("failed to connect to the integration test database");

        let request_id = uuid_like_string();
        let document_id = confirm_stock_receipt(
            &pool,
            "rust-integration-token",
            StockReceiptRequest {
                request_id: request_id.clone(),
                warehouse_id: 1,
                variant_id: 1,
                quantity: Decimal::new(50_000, 3),
                unit_cost: Decimal::new(4000, 2),
                fiscal_period_id: 1,
                document_date: time::Date::from_calendar_date(2026, Month::January, 20).unwrap(),
            },
        )
        .await
        .expect("stock receipt should post successfully");

        assert!(document_id > 0);

        // Identical retry (same request id, same fields) must return the
        // exact same document id, not post a second time.
        let retry_id = confirm_stock_receipt(
            &pool,
            "rust-integration-token",
            StockReceiptRequest {
                request_id,
                warehouse_id: 1,
                variant_id: 1,
                quantity: Decimal::new(50_000, 3),
                unit_cost: Decimal::new(4000, 2),
                fiscal_period_id: 1,
                document_date: time::Date::from_calendar_date(2026, Month::January, 20).unwrap(),
            },
        )
        .await
        .expect("identical retry should succeed");
        assert_eq!(document_id, retry_id);
    }

    /// A fixed-format pseudo-UUID string built from the current time, only
    /// for uniqueness across independent test runs against a persistent
    /// database — not a security-sensitive value, so `getrandom`/a real
    /// UUID crate is not needed here.
    fn uuid_like_string() -> String {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        format!(
            "{:08x}-{:04x}-4{:03x}-8{:03x}-{:012x}",
            (nanos >> 32) as u32,
            (nanos >> 16) as u16 & 0xffff,
            nanos as u16 & 0x0fff,
            (nanos >> 48) as u16 & 0x0fff,
            nanos & 0xffff_ffff_ffff
        )
    }
}
