//! Slice 1 + S2-001 Frontend MVP batch — application service for catalog reads
//! and product creation.

use rust_decimal::Decimal;
use serde_json::Value as JsonValue;
use sqlx::PgPool;

use crate::error::AppError;

// ---------------------------------------------------------------------------
// Slice-1 types (unchanged)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// S2-001 response types
// ---------------------------------------------------------------------------

pub(crate) struct CreatedProductWithVariants {
    pub product_id: i64,
    pub variant_ids: Vec<i64>,
}

pub(crate) struct AttributeListItem {
    pub attribute_id: i64,
    pub name: String,
    pub attribute_values: JsonValue,
}

pub(crate) struct UnitItem {
    pub id: i64,
    pub code: String,
    pub name: String,
}

pub(crate) struct CatalogProduct {
    pub product_id: i64,
    pub name: String,
    pub is_active: bool,
    pub variant_count: i64,
    pub active_variant_count: i64,
}

pub(crate) struct ResolvedBarcode {
    pub variant_id: i64,
    pub product_id: i64,
    pub sku: String,
    pub product_name: String,
    pub sale_price: String,
    pub base_unit_id: i64,
    pub variant_is_active: bool,
    pub product_is_active: bool,
}

// ---------------------------------------------------------------------------
// S2-001 write commands
// ---------------------------------------------------------------------------

/// `catalog.create_product_with_variants` — returns jsonb `{product_id, variant_ids}`.
pub(crate) async fn create_product_with_variants(
    pool: &PgPool,
    session_token: &str,
    name: &str,
    unit_id: i64,
    is_active: bool,
    variants: JsonValue,
) -> Result<CreatedProductWithVariants, AppError> {
    let (json,) = sqlx::query_as::<_, (JsonValue,)>(
        "SELECT catalog.create_product_with_variants($1, $2, $3, $4, $5)",
    )
    .bind(session_token)
    .bind(name)
    .bind(unit_id)
    .bind(is_active)
    .bind(variants)
    .fetch_one(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    let product_id = json
        .get("product_id")
        .and_then(|v| v.as_i64())
        .ok_or_else(|| {
            AppError::internal("missing product_id in create_product_with_variants response")
        })?;

    let variant_ids = json
        .get("variant_ids")
        .and_then(|v| v.as_array())
        .ok_or_else(|| {
            AppError::internal("missing variant_ids in create_product_with_variants response")
        })?
        .iter()
        .map(|v| {
            v.as_i64().ok_or_else(|| {
                AppError::internal(
                    "non-integer variant_id in create_product_with_variants response",
                )
            })
        })
        .collect::<Result<Vec<i64>, AppError>>()?;

    Ok(CreatedProductWithVariants {
        product_id,
        variant_ids,
    })
}

/// `catalog.add_variant` — returns new variant_id (bigint).
pub(crate) async fn add_variant(
    pool: &PgPool,
    session_token: &str,
    product_id: i64,
    variant: JsonValue,
) -> Result<i64, AppError> {
    let (id,) = sqlx::query_as::<_, (i64,)>("SELECT catalog.add_variant($1, $2, $3)")
        .bind(session_token)
        .bind(product_id)
        .bind(variant)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;
    Ok(id)
}

/// `catalog.update_variant` — void.
pub(crate) async fn update_variant(
    pool: &PgPool,
    session_token: &str,
    variant_id: i64,
    sku: &str,
    sale_price: Decimal,
    is_active: bool,
) -> Result<(), AppError> {
    sqlx::query("SELECT catalog.update_variant($1, $2, $3, $4, $5)")
        .bind(session_token)
        .bind(variant_id)
        .bind(sku)
        .bind(sale_price)
        .bind(is_active)
        .execute(pool)
        .await
        .map_err(AppError::from_posting_error)?;
    Ok(())
}

/// `catalog.set_variant_active` — void.
pub(crate) async fn set_variant_active(
    pool: &PgPool,
    session_token: &str,
    variant_id: i64,
    is_active: bool,
) -> Result<(), AppError> {
    sqlx::query("SELECT catalog.set_variant_active($1, $2, $3)")
        .bind(session_token)
        .bind(variant_id)
        .bind(is_active)
        .execute(pool)
        .await
        .map_err(AppError::from_posting_error)?;
    Ok(())
}

/// `catalog.update_product` — void.
pub(crate) async fn update_product(
    pool: &PgPool,
    session_token: &str,
    product_id: i64,
    name: &str,
    is_active: bool,
) -> Result<(), AppError> {
    sqlx::query("SELECT catalog.update_product($1, $2, $3, $4)")
        .bind(session_token)
        .bind(product_id)
        .bind(name)
        .bind(is_active)
        .execute(pool)
        .await
        .map_err(AppError::from_posting_error)?;
    Ok(())
}

/// `catalog.create_attribute` — get-or-create, returns attribute_id.
pub(crate) async fn create_attribute(
    pool: &PgPool,
    session_token: &str,
    name: &str,
) -> Result<i64, AppError> {
    let (id,) = sqlx::query_as::<_, (i64,)>("SELECT catalog.create_attribute($1, $2)")
        .bind(session_token)
        .bind(name)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;
    Ok(id)
}

/// `catalog.add_attribute_value` — get-or-create, returns attribute_value_id.
pub(crate) async fn add_attribute_value(
    pool: &PgPool,
    session_token: &str,
    attribute_id: i64,
    value: &str,
) -> Result<i64, AppError> {
    let (id,) = sqlx::query_as::<_, (i64,)>("SELECT catalog.add_attribute_value($1, $2, $3)")
        .bind(session_token)
        .bind(attribute_id)
        .bind(value)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;
    Ok(id)
}

/// `catalog.list_attributes` — returns rows with jsonb attribute_values column.
pub(crate) async fn list_attributes(
    pool: &PgPool,
    session_token: &str,
) -> Result<Vec<AttributeListItem>, AppError> {
    let rows = sqlx::query_as::<_, (i64, String, JsonValue)>(
        "SELECT attribute_id, name, attribute_values FROM catalog.list_attributes($1)",
    )
    .bind(session_token)
    .fetch_all(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    Ok(rows
        .into_iter()
        .map(|(attribute_id, name, attribute_values)| AttributeListItem {
            attribute_id,
            name,
            attribute_values,
        })
        .collect())
}

/// `catalog.create_unit` — get-or-create, returns unit_id.
pub(crate) async fn create_unit(
    pool: &PgPool,
    session_token: &str,
    code: &str,
    name: &str,
) -> Result<i64, AppError> {
    let (id,) = sqlx::query_as::<_, (i64,)>("SELECT catalog.create_unit($1, $2, $3)")
        .bind(session_token)
        .bind(code)
        .bind(name)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;
    Ok(id)
}

/// `catalog.list_units` — returns rows (id, code, name).
pub(crate) async fn list_units(
    pool: &PgPool,
    session_token: &str,
) -> Result<Vec<UnitItem>, AppError> {
    let rows = sqlx::query_as::<_, (i64, String, String)>(
        "SELECT id, code, name FROM catalog.list_units($1)",
    )
    .bind(session_token)
    .fetch_all(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    Ok(rows
        .into_iter()
        .map(|(id, code, name)| UnitItem { id, code, name })
        .collect())
}

/// `catalog.set_variant_attributes` — void; binds bigint[] for attr value ids.
pub(crate) async fn set_variant_attributes(
    pool: &PgPool,
    session_token: &str,
    variant_id: i64,
    attribute_value_ids: Vec<i64>,
) -> Result<(), AppError> {
    sqlx::query("SELECT catalog.set_variant_attributes($1, $2, $3)")
        .bind(session_token)
        .bind(variant_id)
        .bind(&attribute_value_ids[..])
        .execute(pool)
        .await
        .map_err(AppError::from_posting_error)?;
    Ok(())
}

/// `catalog.add_variant_barcode` — returns barcode_id.
pub(crate) async fn add_variant_barcode(
    pool: &PgPool,
    session_token: &str,
    variant_id: i64,
    barcode: &str,
) -> Result<i64, AppError> {
    let (id,) = sqlx::query_as::<_, (i64,)>("SELECT catalog.add_variant_barcode($1, $2, $3)")
        .bind(session_token)
        .bind(variant_id)
        .bind(barcode)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;
    Ok(id)
}

/// `catalog.remove_variant_barcode` — void.
pub(crate) async fn remove_variant_barcode(
    pool: &PgPool,
    session_token: &str,
    barcode_id: i64,
) -> Result<(), AppError> {
    sqlx::query("SELECT catalog.remove_variant_barcode($1, $2)")
        .bind(session_token)
        .bind(barcode_id)
        .execute(pool)
        .await
        .map_err(AppError::from_posting_error)?;
    Ok(())
}

/// `catalog.add_variant_alt_unit` — returns variant_unit_id.
pub(crate) async fn add_variant_alt_unit(
    pool: &PgPool,
    session_token: &str,
    variant_id: i64,
    unit_id: i64,
    conversion_factor: Decimal,
) -> Result<i64, AppError> {
    let (id,) = sqlx::query_as::<_, (i64,)>("SELECT catalog.add_variant_alt_unit($1, $2, $3, $4)")
        .bind(session_token)
        .bind(variant_id)
        .bind(unit_id)
        .bind(conversion_factor)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;
    Ok(id)
}

/// `catalog.remove_variant_alt_unit` — void.
pub(crate) async fn remove_variant_alt_unit(
    pool: &PgPool,
    session_token: &str,
    variant_unit_id: i64,
) -> Result<(), AppError> {
    sqlx::query("SELECT catalog.remove_variant_alt_unit($1, $2)")
        .bind(session_token)
        .bind(variant_unit_id)
        .execute(pool)
        .await
        .map_err(AppError::from_posting_error)?;
    Ok(())
}

/// `catalog.set_variant_base_unit` — void.
pub(crate) async fn set_variant_base_unit(
    pool: &PgPool,
    session_token: &str,
    variant_id: i64,
    unit_id: i64,
) -> Result<(), AppError> {
    sqlx::query("SELECT catalog.set_variant_base_unit($1, $2, $3)")
        .bind(session_token)
        .bind(variant_id)
        .bind(unit_id)
        .execute(pool)
        .await
        .map_err(AppError::from_posting_error)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// S2-001 read queries
// ---------------------------------------------------------------------------

/// `catalog.resolve_barcode` — 0 or 1 row.
pub(crate) async fn resolve_barcode(
    pool: &PgPool,
    session_token: &str,
    barcode: &str,
) -> Result<Option<ResolvedBarcode>, AppError> {
    let row = sqlx::query_as::<_, (i64, i64, String, String, Decimal, i64, bool, bool)>(
        "SELECT variant_id, product_id, sku, product_name, sale_price, \
         base_unit_id, variant_is_active, product_is_active \
         FROM catalog.resolve_barcode($1, $2)",
    )
    .bind(session_token)
    .bind(barcode)
    .fetch_optional(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    Ok(row.map(
        |(
            variant_id,
            product_id,
            sku,
            product_name,
            sale_price,
            base_unit_id,
            variant_is_active,
            product_is_active,
        )| {
            ResolvedBarcode {
                variant_id,
                product_id,
                sku,
                product_name,
                sale_price: sale_price.to_string(),
                base_unit_id,
                variant_is_active,
                product_is_active,
            }
        },
    ))
}

/// `catalog.list_catalog_products` — search may be None (all products).
pub(crate) async fn list_catalog_products(
    pool: &PgPool,
    session_token: &str,
    search: Option<&str>,
) -> Result<Vec<CatalogProduct>, AppError> {
    let rows = sqlx::query_as::<_, (i64, String, bool, i64, i64)>(
        "SELECT product_id, name, is_active, variant_count, active_variant_count \
         FROM catalog.list_catalog_products($1, $2)",
    )
    .bind(session_token)
    .bind(search)
    .fetch_all(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    Ok(rows
        .into_iter()
        .map(
            |(product_id, name, is_active, variant_count, active_variant_count)| CatalogProduct {
                product_id,
                name,
                is_active,
                variant_count,
                active_variant_count,
            },
        )
        .collect())
}

/// `catalog.get_product_detail` — returns opaque jsonb (passed straight to frontend).
pub(crate) async fn get_product_detail(
    pool: &PgPool,
    session_token: &str,
    product_id: i64,
) -> Result<JsonValue, AppError> {
    let (json,) = sqlx::query_as::<_, (JsonValue,)>("SELECT catalog.get_product_detail($1, $2)")
        .bind(session_token)
        .bind(product_id)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;
    Ok(json)
}
