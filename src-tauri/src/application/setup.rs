//! Slice 1 Frontend MVP batch — application service for first-run setup:
//! the unauthenticated setup-status read and the one-time first-admin
//! bootstrap. The bootstrap hashes the raw password with the existing
//! Argon2 implementation ([`super::auth::hash_password`]) and passes only
//! the hash string to the database; the raw password never reaches SQL.

use sqlx::PgPool;
use time::Date;

use crate::application::auth;
use crate::error::AppError;

/// Safe routing booleans returned by `core.get_setup_status()`. Nothing
/// here is sensitive; it is read before any login exists.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct SetupStatus {
    pub initialized: bool,
    pub administrator_exists: bool,
    pub warehouse_exists: bool,
    pub open_fiscal_period_exists: bool,
    pub workstation_configured: bool,
}

/// Reads installation setup status. Unauthenticated by design (there is no
/// session before the first admin exists).
pub(crate) async fn get_setup_status(pool: &PgPool) -> Result<SetupStatus, AppError> {
    let row = sqlx::query_as::<_, (bool, bool, bool, bool, bool)>(
        "SELECT initialized, administrator_exists, warehouse_exists, \
         open_fiscal_period_exists, workstation_configured FROM core.get_setup_status()",
    )
    .fetch_one(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    Ok(SetupStatus {
        initialized: row.0,
        administrator_exists: row.1,
        warehouse_exists: row.2,
        open_fiscal_period_exists: row.3,
        workstation_configured: row.4,
    })
}

/// Inputs for the one-time first-admin bootstrap. `password` is the raw
/// plaintext; it is hashed here and never stored, logged, or returned.
pub(crate) struct BootstrapRequest {
    pub username: String,
    pub password: String,
    pub display_name: String,
    pub workstation_id: String,
    pub warehouse_code: String,
    pub warehouse_name: String,
    pub period_code: String,
    pub period_starts_on: Date,
    pub period_ends_on: Date,
}

/// Runs the guarded first-admin bootstrap. Returns the new administrator's
/// user id. Fails (safely) if setup is already complete or any user exists;
/// the database function enforces the advisory-lock + recheck guarantee.
pub(crate) async fn bootstrap_first_admin(
    pool: &PgPool,
    request: BootstrapRequest,
) -> Result<i64, AppError> {
    // Hash in Rust with the shared Argon2 implementation; only the hash
    // string is sent to the database.
    let password_hash = auth::hash_password(&request.password)?;

    let user_id: i64 =
        sqlx::query_scalar("SELECT core.bootstrap_first_admin($1, $2, $3, $4, $5, $6, $7, $8, $9)")
            .bind(&request.username)
            .bind(&password_hash)
            .bind(&request.display_name)
            .bind(&request.workstation_id)
            .bind(&request.warehouse_code)
            .bind(&request.warehouse_name)
            .bind(&request.period_code)
            .bind(request.period_starts_on)
            .bind(request.period_ends_on)
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    Ok(user_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::{auth, catalog, dashboard, documents, fiscal, warehouse};
    use rust_decimal::Decimal;
    use time::Month;

    // Genuine, opt-in Rust->PostgreSQL integration test for the whole new
    // Frontend-MVP command surface. `#[ignore]`d by default; requires
    // `STOCKIHA_TEST_DATABASE_URL` pointing at a FRESHLY MIGRATED,
    // NOT-yet-bootstrapped database whose name ends in `_test` (the runtime
    // role's URL). It drives the exact flow the frontend performs, proving
    // every new sqlx decoding matches its SQL function's columns.
    fn require_test_pool_url() -> String {
        let url = std::env::var("STOCKIHA_TEST_DATABASE_URL")
            .expect("STOCKIHA_TEST_DATABASE_URL must be set to run this integration test");
        let options: sqlx::postgres::PgConnectOptions = url
            .parse()
            .expect("STOCKIHA_TEST_DATABASE_URL must be a valid PostgreSQL URL");
        assert!(
            options
                .get_database()
                .unwrap_or_default()
                .ends_with("_test"),
            "refusing to run against a database not ending in `_test`"
        );
        url
    }

    fn day(y: i32, m: Month, d: u8) -> time::Date {
        time::Date::from_calendar_date(y, m, d).unwrap()
    }

    #[tokio::test]
    #[ignore = "requires a freshly migrated, un-bootstrapped STOCKIHA_TEST_DATABASE_URL"]
    async fn full_setup_and_query_flow() {
        let pool = sqlx::PgPool::connect(&require_test_pool_url())
            .await
            .expect("connect");

        // 1. Before setup: nothing initialized.
        let before = get_setup_status(&pool).await.unwrap();
        assert!(!before.initialized && !before.administrator_exists);

        // 2. Bootstrap the first admin (hashes the password internally).
        let admin_id = bootstrap_first_admin(
            &pool,
            BootstrapRequest {
                username: "admin".into(),
                password: "admin-pass-123".into(),
                display_name: "Administrator".into(),
                workstation_id: "POS-1".into(),
                warehouse_code: "WH1".into(),
                warehouse_name: "Main".into(),
                period_code: "2026".into(),
                period_starts_on: day(2026, Month::January, 1),
                period_ends_on: day(2026, Month::December, 31),
            },
        )
        .await
        .expect("bootstrap");
        assert!(admin_id > 0);

        // 3. After setup: everything present.
        let after = get_setup_status(&pool).await.unwrap();
        assert!(
            after.initialized
                && after.administrator_exists
                && after.warehouse_exists
                && after.open_fiscal_period_exists
                && after.workstation_configured
        );

        // 4. The admin logs in through the real auth path.
        let login = auth::login(&pool, "admin", "admin-pass-123", "POS-1")
            .await
            .expect("login");
        let token = login.session_token;

        // 5. Warehouses list (bootstrap created one).
        let warehouses = warehouse::list_warehouses(&pool, &token).await.unwrap();
        assert_eq!(warehouses.len(), 1);
        let warehouse_id = warehouses[0].id;

        // 6. Open fiscal period is retrievable.
        let period = fiscal::get_open_fiscal_period(&pool, &token)
            .await
            .unwrap()
            .expect("an open period exists after bootstrap");

        // 7. Create a product + variant, then list it with stock/WAC.
        let created = catalog::create_product_with_variant(
            &pool,
            &token,
            "Widget",
            "SKU-1",
            Decimal::new(10000, 2),
            true,
        )
        .await
        .expect("create product");
        let products = catalog::list_products(&pool, &token, warehouse_id, None)
            .await
            .unwrap();
        assert_eq!(products.len(), 1);
        assert_eq!(products[0].variant_id, created.variant_id);
        assert_eq!(products[0].sale_price, "100.00");
        assert_eq!(products[0].quantity_on_hand, "0");

        // 8. Dashboard summary decodes.
        let dash = dashboard::get_dashboard_summary(&pool, &token, "POS-1")
            .await
            .unwrap();
        assert_eq!(dash.product_count, 1);
        assert_eq!(dash.variant_count, 1);
        assert!(dash.active_cash_session_id.is_none());

        // 9. Full posting chain, then receipt retrieval decodes.
        let request_id = login_like_uuid();
        crate::application::stock_receipt::confirm_stock_receipt(
            &pool,
            &token,
            crate::application::stock_receipt::StockReceiptRequest {
                request_id,
                warehouse_id,
                variant_id: created.variant_id,
                quantity: Decimal::new(20000, 3),
                unit_cost: Decimal::new(4000, 2),
                fiscal_period_id: period.id,
                document_date: day(2026, Month::January, 15),
            },
        )
        .await
        .expect("stock receipt");

        let session_id = crate::application::cash_session::open_cash_session(
            &pool,
            &token,
            warehouse_id,
            "POS-1",
            Decimal::ZERO,
        )
        .await
        .expect("open session");

        let sale_doc = crate::application::cash_sale::confirm_cash_sale(
            &pool,
            &token,
            crate::application::cash_sale::CashSaleRequest {
                request_id: login_like_uuid(),
                cash_session_id: session_id,
                warehouse_id,
                fiscal_period_id: period.id,
                document_date: day(2026, Month::January, 15),
                lines: vec![crate::application::cash_sale::CashSaleLineInput {
                    variant_id: created.variant_id,
                    quantity: Decimal::new(2000, 3),
                    unit_price: Decimal::new(10000, 2),
                }],
            },
        )
        .await
        .expect("cash sale");

        let receipt = documents::get_sale_document(&pool, &token, sale_doc)
            .await
            .unwrap()
            .expect("receipt exists");
        assert_eq!(receipt.status, "POSTED");
        assert!(receipt.document_number.is_some());
        assert_eq!(receipt.total_amount, "200.00");

        let lines = documents::list_sale_lines(&pool, &token, sale_doc)
            .await
            .unwrap();
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].line_total, "200.00");

        let jobs = documents::list_document_jobs(&pool, &token, sale_doc)
            .await
            .unwrap();
        // Generation + print + drawer = 3 jobs enqueued by the sale.
        assert_eq!(jobs.len(), 3);
    }

    fn login_like_uuid() -> String {
        let n = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        format!(
            "{:08x}-{:04x}-4{:03x}-8{:03x}-{:012x}",
            (n >> 32) as u32,
            (n >> 16) as u16 & 0xffff,
            n as u16 & 0x0fff,
            (n >> 48) as u16 & 0x0fff,
            n & 0xffff_ffff_ffff
        )
    }
}
