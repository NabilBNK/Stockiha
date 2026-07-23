//! Slice 1 Frontend MVP batch — application service for catalog reads and
//! product creation. Creation is permission-gated in the SQL function
//! (`MANAGE_CATALOG`); listing requires only a valid session.
//!
//! Monetary/quantity/cost columns are carried to the frontend as exact
//! decimal **strings** (never JSON numbers), so no value ever round-trips
//! through IEEE-754 in the browser — consistent with the architecture's
//! "never floating point for money/quantity/WAC" rule.

use rust_decimal::Decimal;
use sqlx::PgPool;

use crate::error::AppError;

/// One catalog row for the products list / POS grid, with the selected
/// warehouse's on-hand quantity and WAC.
pub(crate) struct ProductListItem {
    pub product_id: i64,
    pub variant_id: i64,
    pub sku: String,
    pub name: String,
    pub sale_price: String,
    pub is_active: bool,
    pub quantity_on_hand: String,
    pub last_known_wac: String,
}

pub(crate) struct CreatedProduct {
    pub product_id: i64,
    pub variant_id: i64,
}

/// Creates a product and its default variant. `MANAGE_CATALOG` enforced in
/// the SQL function.
pub(crate) async fn create_product_with_variant(
    pool: &PgPool,
    session_token: &str,
    name: &str,
    sku: &str,
    sale_price: Decimal,
    is_active: bool,
) -> Result<CreatedProduct, AppError> {
    let row = sqlx::query_as::<_, (i64, i64)>(
        "SELECT product_id, variant_id \
         FROM catalog.create_product_with_variant($1, $2, $3, $4, $5)",
    )
    .bind(session_token)
    .bind(name)
    .bind(sku)
    .bind(sale_price)
    .bind(is_active)
    .fetch_one(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    Ok(CreatedProduct {
        product_id: row.0,
        variant_id: row.1,
    })
}

/// Lists active products/variants with the given warehouse's stock and WAC.
/// `search` is an optional case-insensitive name/SKU filter.
pub(crate) async fn list_products(
    pool: &PgPool,
    session_token: &str,
    warehouse_id: i64,
    search: Option<&str>,
) -> Result<Vec<ProductListItem>, AppError> {
    let rows = sqlx::query_as::<_, (i64, i64, String, String, Decimal, bool, Decimal, Decimal)>(
        "SELECT product_id, variant_id, sku, name, sale_price, is_active, \
         quantity_on_hand, last_known_wac FROM catalog.list_products($1, $2, $3)",
    )
    .bind(session_token)
    .bind(warehouse_id)
    .bind(search)
    .fetch_all(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    Ok(rows
        .into_iter()
        .map(
            |(product_id, variant_id, sku, name, sale_price, is_active, qty, wac)| {
                ProductListItem {
                    product_id,
                    variant_id,
                    sku,
                    name,
                    sale_price: sale_price.to_string(),
                    is_active,
                    quantity_on_hand: qty.to_string(),
                    last_known_wac: wac.to_string(),
                }
            },
        )
        .collect())
}
