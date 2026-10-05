//! WS-N-1: Dashboard Data & Insights calculation engine application service.
//! Session-validated reads over `core.dashboard_*` functions with typed DTOs.

use rust_decimal::Decimal;
use serde::Serialize;
use sqlx::{FromRow, PgPool};
use time::{Date, Month, PrimitiveDateTime, Time};

use crate::error::AppError;

// ============================================================================
// Formatting & parsing helpers
// ============================================================================

pub(crate) fn format_hms(t: Time) -> String {
    format!("{:02}:{:02}:{:02}", t.hour(), t.minute(), t.second())
}

pub(crate) fn format_iso_datetime(dt: PrimitiveDateTime) -> String {
    format!(
        "{}T{:02}:{:02}:{:02}",
        dt.date(),
        dt.hour(),
        dt.minute(),
        dt.second()
    )
}

pub(crate) fn parse_iso_date(s: &str) -> Result<Date, AppError> {
    if s.len() != 10 {
        return Err(AppError::ValidationError {
            diagnostic: format!("DASHBOARD_DATE_INVALID: {s}"),
        });
    }
    let bytes = s.as_bytes();
    if bytes[4] != b'-' || bytes[7] != b'-' {
        return Err(AppError::ValidationError {
            diagnostic: format!("DASHBOARD_DATE_INVALID: {s}"),
        });
    }
    let year: i32 = s[0..4].parse().map_err(|_| AppError::ValidationError {
        diagnostic: format!("DASHBOARD_DATE_INVALID: {s}"),
    })?;
    let month_u8: u8 = s[5..7].parse().map_err(|_| AppError::ValidationError {
        diagnostic: format!("DASHBOARD_DATE_INVALID: {s}"),
    })?;
    let day: u8 = s[8..10].parse().map_err(|_| AppError::ValidationError {
        diagnostic: format!("DASHBOARD_DATE_INVALID: {s}"),
    })?;

    let month = Month::try_from(month_u8).map_err(|_| AppError::ValidationError {
        diagnostic: format!("DASHBOARD_DATE_INVALID: {s}"),
    })?;

    Date::from_calendar_date(year, month, day).map_err(|_| AppError::ValidationError {
        diagnostic: format!("DASHBOARD_DATE_INVALID: {s}"),
    })
}

pub(crate) fn parse_hms(s: &str) -> Result<Time, AppError> {
    if s.len() != 8 {
        return Err(AppError::ValidationError {
            diagnostic: format!("DASHBOARD_TIME_INVALID: {s}"),
        });
    }
    let bytes = s.as_bytes();
    if bytes[2] != b':' || bytes[5] != b':' {
        return Err(AppError::ValidationError {
            diagnostic: format!("DASHBOARD_TIME_INVALID: {s}"),
        });
    }
    let hour: u8 = s[0..2].parse().map_err(|_| AppError::ValidationError {
        diagnostic: format!("DASHBOARD_TIME_INVALID: {s}"),
    })?;
    let minute: u8 = s[3..5].parse().map_err(|_| AppError::ValidationError {
        diagnostic: format!("DASHBOARD_TIME_INVALID: {s}"),
    })?;
    let second: u8 = s[6..8].parse().map_err(|_| AppError::ValidationError {
        diagnostic: format!("DASHBOARD_TIME_INVALID: {s}"),
    })?;

    Time::from_hms(hour, minute, second).map_err(|_| AppError::ValidationError {
        diagnostic: format!("DASHBOARD_TIME_INVALID: {s}"),
    })
}

pub(crate) fn parse_period(s: &str) -> Result<&'static str, AppError> {
    match s {
        "today" => Ok("today"),
        "week" => Ok("week"),
        "month" => Ok("month"),
        "year" => Ok("year"),
        "custom" => Ok("custom"),
        _ => Err(AppError::ValidationError {
            diagnostic: format!("DASHBOARD_PERIOD_INVALID: {s}"),
        }),
    }
}

pub(crate) fn parse_bucket(s: &str) -> Result<&'static str, AppError> {
    match s {
        "HOUR" => Ok("HOUR"),
        "DAY" => Ok("DAY"),
        "MONTH" => Ok("MONTH"),
        _ => Err(AppError::ValidationError {
            diagnostic: format!("DASHBOARD_BUCKET_INVALID: {s}"),
        }),
    }
}

pub(crate) fn parse_kind(s: &str) -> Result<&'static str, AppError> {
    match s {
        "low" => Ok("low"),
        "out" => Ok("out"),
        "dead" => Ok("dead"),
        _ => Err(AppError::ValidationError {
            diagnostic: format!("DASHBOARD_KIND_INVALID: {s}"),
        }),
    }
}

// ============================================================================
// DTOs & Row Structs
// ============================================================================

#[derive(Debug, Clone, FromRow)]
pub(crate) struct DashboardPeriodRow {
    pub cur_from: Date,
    pub cur_to: Date,
    pub prev_from: Date,
    pub prev_to: Date,
    pub cut_time: Option<Time>,
    pub bucket: String,
    pub today: Date,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct DashboardPeriodDto {
    pub cur_from: String,
    pub cur_to: String,
    pub prev_from: String,
    pub prev_to: String,
    pub cut_time: Option<String>,
    pub bucket: String,
    pub today: String,
}

#[derive(Debug, Clone, FromRow)]
pub(crate) struct DashboardMoneySummaryRow {
    pub sales: Decimal,
    pub prev_sales: Decimal,
    pub sales_change_kind: String,
    pub sales_change_pct: Option<Decimal>,
    pub profit: Decimal,
    pub prev_profit: Decimal,
    pub profit_change_kind: String,
    pub profit_change_pct: Option<Decimal>,
    pub margin_pct: Option<Decimal>,
    pub sale_count: i64,
    pub prev_sale_count: i64,
    pub count_change_kind: String,
    pub count_change_pct: Option<Decimal>,
    pub average_sale: Option<Decimal>,
    pub discount_total: Decimal,
    pub cash_sales: Decimal,
    pub credit_sales: Decimal,
    pub cash_in_drawer: Option<Decimal>,
    pub open_session_count: i64,
    pub receivables_total: Decimal,
    pub payables_total: Decimal,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct DashboardMoneySummaryDto {
    pub sales: String,
    pub prev_sales: String,
    pub sales_change_kind: String,
    pub sales_change_pct: Option<String>,
    pub profit: String,
    pub prev_profit: String,
    pub profit_change_kind: String,
    pub profit_change_pct: Option<String>,
    pub margin_pct: Option<String>,
    pub sale_count: i64,
    pub prev_sale_count: i64,
    pub count_change_kind: String,
    pub count_change_pct: Option<String>,
    pub average_sale: Option<String>,
    pub discount_total: String,
    pub cash_sales: String,
    pub credit_sales: String,
    pub cash_in_drawer: Option<String>,
    pub open_session_count: i64,
    pub receivables_total: String,
    pub payables_total: String,
}

#[derive(Debug, Clone, FromRow)]
pub(crate) struct DashboardStockSummaryRow {
    pub stock_value: Decimal,
    pub low_count: i64,
    pub out_count: i64,
    pub dead_count: i64,
    pub dead_value: Decimal,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct DashboardStockSummaryDto {
    pub stock_value: String,
    pub low_count: i64,
    pub out_count: i64,
    pub dead_count: i64,
    pub dead_value: String,
}

#[derive(Debug, Clone, FromRow)]
pub(crate) struct DashboardStockItemRow {
    pub variant_id: i64,
    pub product_id: i64,
    pub item_name: String,
    pub display_identifier: String,
    pub identifier_type: String,
    pub base_unit_name: String,
    pub quantity: Decimal,
    pub minimum_stock: Decimal,
    pub stock_value: Decimal,
    pub last_sold_on: Option<Date>,
    pub total_count: i64,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct DashboardStockItemDto {
    pub variant_id: i64,
    pub product_id: i64,
    pub item_name: String,
    pub display_identifier: String,
    pub identifier_type: String,
    pub base_unit_name: String,
    pub quantity: String,
    pub minimum_stock: String,
    pub stock_value: String,
    pub last_sold_on: Option<String>,
    pub total_count: i64,
}

#[derive(Debug, Clone, FromRow)]
pub(crate) struct DashboardTopItemRow {
    pub variant_id: i64,
    pub item_name: String,
    pub base_unit_name: String,
    pub quantity_sold: Decimal,
    pub sales_before_discount: Decimal,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct DashboardTopItemDto {
    pub variant_id: i64,
    pub item_name: String,
    pub base_unit_name: String,
    pub quantity_sold: String,
    pub sales_before_discount: String,
}

#[derive(Debug, Clone, FromRow)]
pub(crate) struct DashboardTopCustomerRow {
    pub customer_id: i64,
    pub customer_name: String,
    pub sale_count: i64,
    pub sales: Decimal,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct DashboardTopCustomerDto {
    pub customer_id: i64,
    pub customer_name: String,
    pub sale_count: i64,
    pub sales: String,
}

#[derive(Debug, Clone, FromRow)]
pub(crate) struct DashboardDebtorRow {
    pub customer_id: i64,
    pub customer_name: String,
    pub amount_owed: Decimal,
    pub oldest_open_on: Option<Date>,
    pub oldest_open_days: Option<i32>,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct DashboardDebtorDto {
    pub customer_id: i64,
    pub customer_name: String,
    pub amount_owed: String,
    pub oldest_open_on: Option<String>,
    pub oldest_open_days: Option<i32>,
}

#[derive(Debug, Clone, FromRow)]
pub(crate) struct DashboardLatestSaleRow {
    pub document_id: i64,
    pub document_number: String,
    pub posted_local: PrimitiveDateTime,
    pub sale_kind: String,
    pub customer_name: Option<String>,
    pub total: Decimal,
    pub is_voided: bool,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct DashboardLatestSaleDto {
    pub document_id: i64,
    pub document_number: String,
    pub posted_local: String,
    pub sale_kind: String,
    pub customer_name: Option<String>,
    pub total: String,
    pub is_voided: bool,
}

#[derive(Debug, Clone, FromRow)]
pub(crate) struct DashboardSeriesRow {
    pub bucket_start: PrimitiveDateTime,
    pub sales: Decimal,
    pub profit: Decimal,
    pub cash_sales: Decimal,
    pub credit_sales: Decimal,
    pub purchases: Decimal,
    pub sale_count: i64,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct DashboardSeriesRowDto {
    pub bucket_start: String,
    pub sales: String,
    pub profit: String,
    pub cash_sales: String,
    pub credit_sales: String,
    pub purchases: String,
    pub sale_count: i64,
}

#[derive(Debug, Clone, FromRow)]
pub(crate) struct DashboardCategoryRow {
    pub sort_order: i32,
    pub category_key: String,
    pub category_name: Option<String>,
    pub sales_before_discount: Decimal,
    pub share_pct: Option<Decimal>,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct DashboardCategoryRowDto {
    pub sort_order: i32,
    pub category_key: String,
    pub category_name: Option<String>,
    pub sales_before_discount: String,
    pub share_pct: Option<String>,
}

#[derive(Debug, Clone, FromRow)]
pub(crate) struct DashboardBusyCellRow {
    pub weekday: i32,
    pub hour: i32,
    pub sale_count: i64,
    pub sales: Decimal,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct DashboardBusyCellDto {
    pub weekday: i32,
    pub hour: i32,
    pub sale_count: i64,
    pub sales: String,
}

#[derive(Debug, Clone, FromRow)]
pub(crate) struct DashboardAgingRow {
    pub sort_order: i32,
    pub bucket: String,
    pub amount: Decimal,
    pub item_count: i64,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct DashboardAgingRowDto {
    pub sort_order: i32,
    pub bucket: String,
    pub amount: String,
    pub item_count: i64,
}

// ============================================================================
// Application Services
// ============================================================================

pub(crate) async fn get_period(
    pool: &PgPool,
    session_token: &str,
    period: &str,
    from: Option<Date>,
    to: Option<Date>,
) -> Result<DashboardPeriodDto, AppError> {
    let row = sqlx::query_as::<_, DashboardPeriodRow>(
        "SELECT cur_from, cur_to, prev_from, prev_to, cut_time, bucket, today \
         FROM core.dashboard_period($1::text, $2::text, $3::date, $4::date)",
    )
    .bind(session_token)
    .bind(period)
    .bind(from)
    .bind(to)
    .fetch_one(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    Ok(DashboardPeriodDto {
        cur_from: row.cur_from.to_string(),
        cur_to: row.cur_to.to_string(),
        prev_from: row.prev_from.to_string(),
        prev_to: row.prev_to.to_string(),
        cut_time: row.cut_time.map(format_hms),
        bucket: row.bucket,
        today: row.today.to_string(),
    })
}

pub(crate) async fn get_money_summary(
    pool: &PgPool,
    session_token: &str,
    cur_from: Date,
    cur_to: Date,
    prev_from: Date,
    prev_to: Date,
    cut_time: Option<Time>,
) -> Result<DashboardMoneySummaryDto, AppError> {
    let row = sqlx::query_as::<_, DashboardMoneySummaryRow>(
        "SELECT sales, prev_sales, sales_change_kind, sales_change_pct, \
                profit, prev_profit, profit_change_kind, profit_change_pct, \
                margin_pct, sale_count, prev_sale_count, count_change_kind, \
                count_change_pct, average_sale, discount_total, cash_sales, \
                credit_sales, cash_in_drawer, open_session_count, receivables_total, \
                payables_total \
         FROM core.dashboard_money_summary($1::text, $2::date, $3::date, $4::date, $5::date, $6::time)",
    )
    .bind(session_token)
    .bind(cur_from)
    .bind(cur_to)
    .bind(prev_from)
    .bind(prev_to)
    .bind(cut_time)
    .fetch_one(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    Ok(DashboardMoneySummaryDto {
        sales: row.sales.to_string(),
        prev_sales: row.prev_sales.to_string(),
        sales_change_kind: row.sales_change_kind,
        sales_change_pct: row.sales_change_pct.map(|d| d.to_string()),
        profit: row.profit.to_string(),
        prev_profit: row.prev_profit.to_string(),
        profit_change_kind: row.profit_change_kind,
        profit_change_pct: row.profit_change_pct.map(|d| d.to_string()),
        margin_pct: row.margin_pct.map(|d| d.to_string()),
        sale_count: row.sale_count,
        prev_sale_count: row.prev_sale_count,
        count_change_kind: row.count_change_kind,
        count_change_pct: row.count_change_pct.map(|d| d.to_string()),
        average_sale: row.average_sale.map(|d| d.to_string()),
        discount_total: row.discount_total.to_string(),
        cash_sales: row.cash_sales.to_string(),
        credit_sales: row.credit_sales.to_string(),
        cash_in_drawer: row.cash_in_drawer.map(|d| d.to_string()),
        open_session_count: row.open_session_count,
        receivables_total: row.receivables_total.to_string(),
        payables_total: row.payables_total.to_string(),
    })
}

pub(crate) async fn get_stock_summary(
    pool: &PgPool,
    session_token: &str,
    dead_days: i32,
) -> Result<DashboardStockSummaryDto, AppError> {
    let row = sqlx::query_as::<_, DashboardStockSummaryRow>(
        "SELECT stock_value, low_count, out_count, dead_count, dead_value \
         FROM core.dashboard_stock_summary($1::text, $2::integer)",
    )
    .bind(session_token)
    .bind(dead_days)
    .fetch_one(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    Ok(DashboardStockSummaryDto {
        stock_value: row.stock_value.to_string(),
        low_count: row.low_count,
        out_count: row.out_count,
        dead_count: row.dead_count,
        dead_value: row.dead_value.to_string(),
    })
}

pub(crate) async fn list_stock_items(
    pool: &PgPool,
    session_token: &str,
    kind: &str,
    dead_days: i32,
    limit: i32,
    offset: i32,
) -> Result<Vec<DashboardStockItemDto>, AppError> {
    let rows = sqlx::query_as::<_, DashboardStockItemRow>(
        "SELECT variant_id, product_id, item_name, display_identifier, identifier_type, \
                base_unit_name, quantity, minimum_stock, stock_value, last_sold_on, total_count \
         FROM core.dashboard_stock_items($1::text, $2::text, $3::integer, $4::integer, $5::integer)",
    )
    .bind(session_token)
    .bind(kind)
    .bind(dead_days)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    Ok(rows
        .into_iter()
        .map(|r| DashboardStockItemDto {
            variant_id: r.variant_id,
            product_id: r.product_id,
            item_name: r.item_name,
            display_identifier: r.display_identifier,
            identifier_type: r.identifier_type,
            base_unit_name: r.base_unit_name,
            quantity: r.quantity.to_string(),
            minimum_stock: r.minimum_stock.to_string(),
            stock_value: r.stock_value.to_string(),
            last_sold_on: r.last_sold_on.map(|d| d.to_string()),
            total_count: r.total_count,
        })
        .collect())
}

pub(crate) async fn list_top_items(
    pool: &PgPool,
    session_token: &str,
    from: Date,
    to: Date,
    limit: i32,
) -> Result<Vec<DashboardTopItemDto>, AppError> {
    let rows = sqlx::query_as::<_, DashboardTopItemRow>(
        "SELECT variant_id, item_name, base_unit_name, quantity_sold, sales_before_discount \
         FROM core.dashboard_top_items($1::text, $2::date, $3::date, $4::integer)",
    )
    .bind(session_token)
    .bind(from)
    .bind(to)
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    Ok(rows
        .into_iter()
        .map(|r| DashboardTopItemDto {
            variant_id: r.variant_id,
            item_name: r.item_name,
            base_unit_name: r.base_unit_name,
            quantity_sold: r.quantity_sold.to_string(),
            sales_before_discount: r.sales_before_discount.to_string(),
        })
        .collect())
}

pub(crate) async fn list_top_customers(
    pool: &PgPool,
    session_token: &str,
    from: Date,
    to: Date,
) -> Result<Vec<DashboardTopCustomerDto>, AppError> {
    let rows = sqlx::query_as::<_, DashboardTopCustomerRow>(
        "SELECT customer_id, customer_name, sale_count, sales \
         FROM core.dashboard_top_customers($1::text, $2::date, $3::date)",
    )
    .bind(session_token)
    .bind(from)
    .bind(to)
    .fetch_all(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    Ok(rows
        .into_iter()
        .map(|r| DashboardTopCustomerDto {
            customer_id: r.customer_id,
            customer_name: r.customer_name,
            sale_count: r.sale_count,
            sales: r.sales.to_string(),
        })
        .collect())
}

pub(crate) async fn list_top_debtors(
    pool: &PgPool,
    session_token: &str,
) -> Result<Vec<DashboardDebtorDto>, AppError> {
    let rows = sqlx::query_as::<_, DashboardDebtorRow>(
        "SELECT customer_id, customer_name, amount_owed, oldest_open_on, oldest_open_days \
         FROM core.dashboard_top_debtors($1::text)",
    )
    .bind(session_token)
    .fetch_all(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    Ok(rows
        .into_iter()
        .map(|r| DashboardDebtorDto {
            customer_id: r.customer_id,
            customer_name: r.customer_name,
            amount_owed: r.amount_owed.to_string(),
            oldest_open_on: r.oldest_open_on.map(|d| d.to_string()),
            oldest_open_days: r.oldest_open_days,
        })
        .collect())
}

pub(crate) async fn list_latest_sales(
    pool: &PgPool,
    session_token: &str,
) -> Result<Vec<DashboardLatestSaleDto>, AppError> {
    let rows = sqlx::query_as::<_, DashboardLatestSaleRow>(
        "SELECT document_id, document_number, posted_local, sale_kind, customer_name, total, is_voided \
         FROM core.dashboard_latest_sales($1::text)",
    )
    .bind(session_token)
    .fetch_all(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    Ok(rows
        .into_iter()
        .map(|r| DashboardLatestSaleDto {
            document_id: r.document_id,
            document_number: r.document_number,
            posted_local: format_iso_datetime(r.posted_local),
            sale_kind: r.sale_kind,
            customer_name: r.customer_name,
            total: r.total.to_string(),
            is_voided: r.is_voided,
        })
        .collect())
}

pub(crate) async fn get_sales_series(
    pool: &PgPool,
    session_token: &str,
    from: Date,
    to: Date,
    bucket: &str,
) -> Result<Vec<DashboardSeriesRowDto>, AppError> {
    let rows = sqlx::query_as::<_, DashboardSeriesRow>(
        "SELECT bucket_start, sales, profit, cash_sales, credit_sales, purchases, sale_count \
         FROM core.dashboard_sales_series($1::text, $2::date, $3::date, $4::text)",
    )
    .bind(session_token)
    .bind(from)
    .bind(to)
    .bind(bucket)
    .fetch_all(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    Ok(rows
        .into_iter()
        .map(|r| DashboardSeriesRowDto {
            bucket_start: format_iso_datetime(r.bucket_start),
            sales: r.sales.to_string(),
            profit: r.profit.to_string(),
            cash_sales: r.cash_sales.to_string(),
            credit_sales: r.credit_sales.to_string(),
            purchases: r.purchases.to_string(),
            sale_count: r.sale_count,
        })
        .collect())
}

pub(crate) async fn get_sales_by_category(
    pool: &PgPool,
    session_token: &str,
    from: Date,
    to: Date,
) -> Result<Vec<DashboardCategoryRowDto>, AppError> {
    let rows = sqlx::query_as::<_, DashboardCategoryRow>(
        "SELECT sort_order, category_key, category_name, sales_before_discount, share_pct \
         FROM core.dashboard_sales_by_category($1::text, $2::date, $3::date)",
    )
    .bind(session_token)
    .bind(from)
    .bind(to)
    .fetch_all(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    Ok(rows
        .into_iter()
        .map(|r| DashboardCategoryRowDto {
            sort_order: r.sort_order,
            category_key: r.category_key,
            category_name: r.category_name,
            sales_before_discount: r.sales_before_discount.to_string(),
            share_pct: r.share_pct.map(|d| d.to_string()),
        })
        .collect())
}

pub(crate) async fn get_busy_hours(
    pool: &PgPool,
    session_token: &str,
    from: Date,
    to: Date,
) -> Result<Vec<DashboardBusyCellDto>, AppError> {
    let rows = sqlx::query_as::<_, DashboardBusyCellRow>(
        "SELECT weekday, hour, sale_count, sales \
         FROM core.dashboard_busy_hours($1::text, $2::date, $3::date)",
    )
    .bind(session_token)
    .bind(from)
    .bind(to)
    .fetch_all(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    Ok(rows
        .into_iter()
        .map(|r| DashboardBusyCellDto {
            weekday: r.weekday,
            hour: r.hour,
            sale_count: r.sale_count,
            sales: r.sales.to_string(),
        })
        .collect())
}

pub(crate) async fn get_receivables_aging(
    pool: &PgPool,
    session_token: &str,
) -> Result<Vec<DashboardAgingRowDto>, AppError> {
    let rows = sqlx::query_as::<_, DashboardAgingRow>(
        "SELECT sort_order, bucket, amount, item_count \
         FROM core.dashboard_receivables_aging($1::text)",
    )
    .bind(session_token)
    .fetch_all(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    Ok(rows
        .into_iter()
        .map(|r| DashboardAgingRowDto {
            sort_order: r.sort_order,
            bucket: r.bucket,
            amount: r.amount.to_string(),
            item_count: r.item_count,
        })
        .collect())
}

// ============================================================================
// Unit Tests (T-R1 .. T-R4)
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn t_r1_parse_iso_date() {
        assert_eq!(
            parse_iso_date("2026-09-24").unwrap().to_string(),
            "2026-09-24"
        );
        assert!(parse_iso_date("2026-9-24").is_err());
        assert!(parse_iso_date("2026-02-30").is_err());
        assert!(parse_iso_date("24/09/2026").is_err());
        assert!(parse_iso_date("").is_err());
    }

    #[test]
    fn t_r2_parse_hms() {
        let t = parse_hms("12:00:00").unwrap();
        assert_eq!(t.hour(), 12);
        assert_eq!(t.minute(), 0);
        assert_eq!(t.second(), 0);
        assert!(parse_hms("12:00").is_err());
        assert!(parse_hms("25:00:00").is_err());
    }

    #[test]
    fn t_r3_time_formatting() {
        let t = Time::from_hms(9, 5, 3).unwrap();
        assert_eq!(format_hms(t), "09:05:03");

        let d = Date::from_calendar_date(2026, Month::September, 24).unwrap();
        let dt = PrimitiveDateTime::new(d, Time::from_hms(9, 0, 0).unwrap());
        assert_eq!(format_iso_datetime(dt), "2026-09-24T09:00:00");
    }

    #[test]
    fn t_r4_enums_parsing() {
        assert_eq!(parse_period("today").unwrap(), "today");
        assert_eq!(parse_period("week").unwrap(), "week");
        assert_eq!(parse_period("month").unwrap(), "month");
        assert_eq!(parse_period("year").unwrap(), "year");
        assert_eq!(parse_period("custom").unwrap(), "custom");
        assert!(parse_period("decade").is_err());

        assert_eq!(parse_bucket("HOUR").unwrap(), "HOUR");
        assert_eq!(parse_bucket("DAY").unwrap(), "DAY");
        assert_eq!(parse_bucket("MONTH").unwrap(), "MONTH");
        assert!(parse_bucket("WEEK").is_err());

        assert_eq!(parse_kind("low").unwrap(), "low");
        assert_eq!(parse_kind("out").unwrap(), "out");
        assert_eq!(parse_kind("dead").unwrap(), "dead");
        assert!(parse_kind("all").is_err());
    }
}
