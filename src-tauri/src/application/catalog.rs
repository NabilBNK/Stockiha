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
    pub product_name: Option<String>,
    pub primary_barcode: Option<String>,
    pub attributes: Option<JsonValue>,
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
    let rows = sqlx::query_as::<
        _,
        (
            i64,
            i64,
            String,
            String,
            Option<String>,
            Option<String>,
            Option<JsonValue>,
            Decimal,
            bool,
            Decimal,
            Decimal,
        ),
    >(
        "SELECT \
            l.product_id, \
            l.variant_id, \
            l.sku, \
            catalog._effective_variant_name(l.variant_id) AS name, \
            l.name AS product_name, \
            (SELECT barcode FROM catalog.variant_barcodes vb WHERE vb.variant_id = l.variant_id ORDER BY is_primary DESC, id ASC LIMIT 1) AS primary_barcode, \
            ( \
                SELECT coalesce(jsonb_agg(jsonb_build_object('name', a.name, 'value', val.value)), '[]'::jsonb) \
                FROM catalog.variant_attribute_values vav \
                JOIN catalog.attribute_values val ON val.id = vav.attribute_value_id \
                JOIN catalog.attributes a ON a.id = val.attribute_id \
                WHERE vav.variant_id = l.variant_id \
            ) AS attributes, \
            l.sale_price, \
            l.is_active, \
            l.quantity_on_hand, \
            l.last_known_wac \
         FROM catalog.list_products($1, $2, NULL) l \
         WHERE ($3::text IS NULL \
            OR btrim($3::text) = '' \
            OR l.sku ILIKE '%' || btrim($3::text) || '%' \
            OR l.name ILIKE '%' || btrim($3::text) || '%' \
            OR catalog._effective_variant_name(l.variant_id) ILIKE '%' || btrim($3::text) || '%' \
            OR EXISTS (SELECT 1 FROM catalog.variant_barcodes vb WHERE vb.variant_id = l.variant_id AND vb.normalized_barcode ILIKE '%' || btrim($3::text) || '%') \
            OR EXISTS ( \
                SELECT 1 FROM catalog.variant_attribute_values vav \
                JOIN catalog.attribute_values val ON val.id = vav.attribute_value_id \
                WHERE vav.variant_id = l.variant_id AND val.value ILIKE '%' || btrim($3::text) || '%' \
            ) \
         ) \
         ORDER BY lower(l.name), lower(l.sku), l.variant_id",
    )
    .bind(session_token)
    .bind(warehouse_id)
    .bind(search)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::internal(e.to_string()))?;

    Ok(rows
        .into_iter()
        .map(
            |(
                product_id,
                variant_id,
                sku,
                name,
                product_name,
                primary_barcode,
                attributes,
                sale_price,
                is_active,
                qty,
                wac,
            )| {
                ProductListItem {
                    product_id,
                    variant_id,
                    sku,
                    name,
                    product_name,
                    primary_barcode,
                    attributes,
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
    pub unit_id: i64,
    pub unit_code: String,
    pub unit_name: String,
    pub is_active: bool,
    pub variant_count: i64,
    pub active_variant_count: i64,
}

pub(crate) struct ResolvedBarcode {
    pub variant_id: i64,
    pub product_id: i64,
    pub sku: String,
    pub name_override: Option<String>,
    pub effective_variant_name: String,
    pub primary_barcode: Option<String>,
    pub operational_identifier: String,
    pub identifier_type: String,
    pub product_name: String,
    pub sale_price: String,
    pub unit_id: i64,
    pub unit_code: String,
    pub unit_name: String,
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
    name_override: Option<&str>,
    sale_price: Decimal,
    is_active: bool,
) -> Result<(), AppError> {
    sqlx::query("SELECT catalog.update_variant($1, $2, $3, $4, $5)")
        .bind(session_token)
        .bind(variant_id)
        .bind(name_override)
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
    unit_id: i64,
    is_active: bool,
) -> Result<(), AppError> {
    sqlx::query("SELECT catalog.update_product($1, $2, $3, $4, $5)")
        .bind(session_token)
        .bind(product_id)
        .bind(name)
        .bind(unit_id)
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
    let row = sqlx::query_as::<
        _,
        (
            i64,
            i64,
            String,
            Option<String>,
            String,
            Option<String>,
            String,
            String,
            String,
            Decimal,
            i64,
            String,
            String,
            bool,
            bool,
        ),
    >(
        "SELECT variant_id, product_id, sku, name_override, effective_variant_name, \
         primary_barcode, operational_identifier, identifier_type, product_name, sale_price, \
         unit_id, unit_code, unit_name, variant_is_active, product_is_active \
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
            name_override,
            effective_variant_name,
            primary_barcode,
            operational_identifier,
            identifier_type,
            product_name,
            sale_price,
            unit_id,
            unit_code,
            unit_name,
            variant_is_active,
            product_is_active,
        )| {
            ResolvedBarcode {
                variant_id,
                product_id,
                sku,
                name_override,
                effective_variant_name,
                primary_barcode,
                operational_identifier,
                identifier_type,
                product_name,
                sale_price: sale_price.to_string(),
                unit_id,
                unit_code,
                unit_name,
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
    let rows = sqlx::query_as::<_, (i64, String, i64, String, String, bool, i64, i64)>(
        "SELECT product_id, name, unit_id, unit_code, unit_name, is_active, \
         variant_count, active_variant_count \
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
            |(
                product_id,
                name,
                unit_id,
                unit_code,
                unit_name,
                is_active,
                variant_count,
                active_variant_count,
            )| CatalogProduct {
                product_id,
                name,
                unit_id,
                unit_code,
                unit_name,
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

// ---------------------------------------------------------------------------
// WS-D-2 — reference-data lifecycle, quick_create_product, list_products_v2,
// and the widened update_product/update_variant overloads (D-1 deliverable).
//
// Every catalogue decision (identifier derivation, search, pagination,
// usage-count computation, permission checks) is made by the SQL function;
// this layer only binds typed parameters and maps sqlx::Error. See
// ws-d-skill.md sections 2.1-2.4 for the overload/casting rules this file
// follows throughout.
// ---------------------------------------------------------------------------

pub(crate) struct ReferenceItem {
    pub id: i64,
    pub name: String,
    pub is_active: bool,
    pub usage_count: i64,
}

pub(crate) struct AttributeValueItem {
    pub id: i64,
    pub attribute_id: i64,
    pub attribute_name: String,
    pub value: String,
    pub is_active: bool,
    pub usage_count: i64,
}

pub(crate) struct UnitLifecycleItem {
    pub id: i64,
    pub code: String,
    pub name: String,
    pub is_active: bool,
    pub usage_count: i64,
}

pub(crate) struct QuickCreatedProduct {
    pub product_id: i64,
    pub variant_id: i64,
}

/// One row of `catalog.list_products_v2` — all 20 returned columns. Field
/// order and names mirror the SQL `RETURNS TABLE` exactly (ws-d-skill.md
/// section 2.4); `#[derive(FromRow)]` maps by column name, not position, so
/// this is not sensitive to the SELECT list's column order.
#[derive(sqlx::FromRow)]
pub(crate) struct ProductListRowV2 {
    pub product_id: i64,
    pub variant_id: i64,
    pub sku: String,
    pub product_name: String,
    pub variant_name: String,
    pub primary_barcode: Option<String>,
    pub display_identifier: String,
    pub identifier_type: String,
    pub sale_price: Decimal,
    pub minimum_stock: Decimal,
    pub is_active: bool,
    pub product_is_active: bool,
    pub category_id: Option<i64>,
    pub category_name: Option<String>,
    pub quantity_on_hand: Decimal,
    pub last_known_wac: Decimal,
    pub attributes: JsonValue,
    pub total_count: i64,
}

pub(crate) struct ProductListItemV2 {
    pub product_id: i64,
    pub variant_id: i64,
    pub sku: String,
    pub product_name: String,
    pub variant_name: String,
    pub primary_barcode: Option<String>,
    pub display_identifier: String,
    pub identifier_type: String,
    pub sale_price: String,
    pub minimum_stock: String,
    pub is_active: bool,
    pub product_is_active: bool,
    pub category_id: Option<i64>,
    pub category_name: Option<String>,
    pub quantity_on_hand: String,
    pub last_known_wac: String,
    pub attributes: JsonValue,
    pub total_count: i64,
}

impl From<ProductListRowV2> for ProductListItemV2 {
    fn from(row: ProductListRowV2) -> Self {
        ProductListItemV2 {
            product_id: row.product_id,
            variant_id: row.variant_id,
            sku: row.sku,
            product_name: row.product_name,
            variant_name: row.variant_name,
            primary_barcode: row.primary_barcode,
            display_identifier: row.display_identifier,
            identifier_type: row.identifier_type,
            sale_price: row.sale_price.to_string(),
            minimum_stock: row.minimum_stock.to_string(),
            is_active: row.is_active,
            product_is_active: row.product_is_active,
            category_id: row.category_id,
            category_name: row.category_name,
            quantity_on_hand: row.quantity_on_hand.to_string(),
            last_known_wac: row.last_known_wac.to_string(),
            attributes: row.attributes,
            total_count: row.total_count,
        }
    }
}

// --------------------------------------------------------------- categories

pub(crate) async fn list_categories(
    pool: &PgPool,
    session_token: &str,
) -> Result<Vec<ReferenceItem>, AppError> {
    let rows = sqlx::query_as::<_, (i64, String, bool, i64)>(
        "SELECT id, name, is_active, usage_count FROM catalog.list_categories($1::text)",
    )
    .bind(session_token)
    .fetch_all(pool)
    .await
    .map_err(AppError::from_posting_error)?;
    Ok(rows
        .into_iter()
        .map(|(id, name, is_active, usage_count)| ReferenceItem {
            id,
            name,
            is_active,
            usage_count,
        })
        .collect())
}

pub(crate) async fn create_category(
    pool: &PgPool,
    session_token: &str,
    name: &str,
) -> Result<i64, AppError> {
    let (id,) = sqlx::query_as::<_, (i64,)>("SELECT catalog.create_category($1::text, $2::text)")
        .bind(session_token)
        .bind(name)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;
    Ok(id)
}

pub(crate) async fn rename_category(
    pool: &PgPool,
    session_token: &str,
    category_id: i64,
    name: &str,
) -> Result<(), AppError> {
    sqlx::query("SELECT catalog.rename_category($1::text, $2::bigint, $3::text)")
        .bind(session_token)
        .bind(category_id)
        .bind(name)
        .execute(pool)
        .await
        .map_err(AppError::from_posting_error)?;
    Ok(())
}

pub(crate) async fn set_category_active(
    pool: &PgPool,
    session_token: &str,
    category_id: i64,
    is_active: bool,
) -> Result<(), AppError> {
    sqlx::query("SELECT catalog.set_category_active($1::text, $2::bigint, $3::boolean)")
        .bind(session_token)
        .bind(category_id)
        .bind(is_active)
        .execute(pool)
        .await
        .map_err(AppError::from_posting_error)?;
    Ok(())
}

pub(crate) async fn delete_category(
    pool: &PgPool,
    session_token: &str,
    category_id: i64,
) -> Result<(), AppError> {
    sqlx::query("SELECT catalog.delete_category($1::text, $2::bigint)")
        .bind(session_token)
        .bind(category_id)
        .execute(pool)
        .await
        .map_err(AppError::from_posting_error)?;
    Ok(())
}

// --------------------------------------------------------------- attributes

pub(crate) async fn list_attributes_v2(
    pool: &PgPool,
    session_token: &str,
) -> Result<Vec<ReferenceItem>, AppError> {
    let rows = sqlx::query_as::<_, (i64, String, bool, i64)>(
        "SELECT id, name, is_active, usage_count FROM catalog.list_attributes_v2($1::text)",
    )
    .bind(session_token)
    .fetch_all(pool)
    .await
    .map_err(AppError::from_posting_error)?;
    Ok(rows
        .into_iter()
        .map(|(id, name, is_active, usage_count)| ReferenceItem {
            id,
            name,
            is_active,
            usage_count,
        })
        .collect())
}

pub(crate) async fn rename_attribute(
    pool: &PgPool,
    session_token: &str,
    attribute_id: i64,
    name: &str,
) -> Result<(), AppError> {
    sqlx::query("SELECT catalog.rename_attribute($1::text, $2::bigint, $3::text)")
        .bind(session_token)
        .bind(attribute_id)
        .bind(name)
        .execute(pool)
        .await
        .map_err(AppError::from_posting_error)?;
    Ok(())
}

pub(crate) async fn set_attribute_active(
    pool: &PgPool,
    session_token: &str,
    attribute_id: i64,
    is_active: bool,
) -> Result<(), AppError> {
    sqlx::query("SELECT catalog.set_attribute_active($1::text, $2::bigint, $3::boolean)")
        .bind(session_token)
        .bind(attribute_id)
        .bind(is_active)
        .execute(pool)
        .await
        .map_err(AppError::from_posting_error)?;
    Ok(())
}

pub(crate) async fn delete_attribute(
    pool: &PgPool,
    session_token: &str,
    attribute_id: i64,
) -> Result<(), AppError> {
    sqlx::query("SELECT catalog.delete_attribute($1::text, $2::bigint)")
        .bind(session_token)
        .bind(attribute_id)
        .execute(pool)
        .await
        .map_err(AppError::from_posting_error)?;
    Ok(())
}

// --------------------------------------------------------- attribute values

pub(crate) async fn list_attribute_values(
    pool: &PgPool,
    session_token: &str,
) -> Result<Vec<AttributeValueItem>, AppError> {
    let rows = sqlx::query_as::<_, (i64, i64, String, String, bool, i64)>(
        "SELECT id, attribute_id, attribute_name, value, is_active, usage_count \
         FROM catalog.list_attribute_values($1::text)",
    )
    .bind(session_token)
    .fetch_all(pool)
    .await
    .map_err(AppError::from_posting_error)?;
    Ok(rows
        .into_iter()
        .map(
            |(id, attribute_id, attribute_name, value, is_active, usage_count)| {
                AttributeValueItem {
                    id,
                    attribute_id,
                    attribute_name,
                    value,
                    is_active,
                    usage_count,
                }
            },
        )
        .collect())
}

pub(crate) async fn rename_attribute_value(
    pool: &PgPool,
    session_token: &str,
    attribute_value_id: i64,
    value: &str,
) -> Result<(), AppError> {
    sqlx::query("SELECT catalog.rename_attribute_value($1::text, $2::bigint, $3::text)")
        .bind(session_token)
        .bind(attribute_value_id)
        .bind(value)
        .execute(pool)
        .await
        .map_err(AppError::from_posting_error)?;
    Ok(())
}

pub(crate) async fn set_attribute_value_active(
    pool: &PgPool,
    session_token: &str,
    attribute_value_id: i64,
    is_active: bool,
) -> Result<(), AppError> {
    sqlx::query("SELECT catalog.set_attribute_value_active($1::text, $2::bigint, $3::boolean)")
        .bind(session_token)
        .bind(attribute_value_id)
        .bind(is_active)
        .execute(pool)
        .await
        .map_err(AppError::from_posting_error)?;
    Ok(())
}

pub(crate) async fn delete_attribute_value(
    pool: &PgPool,
    session_token: &str,
    attribute_value_id: i64,
) -> Result<(), AppError> {
    sqlx::query("SELECT catalog.delete_attribute_value($1::text, $2::bigint)")
        .bind(session_token)
        .bind(attribute_value_id)
        .execute(pool)
        .await
        .map_err(AppError::from_posting_error)?;
    Ok(())
}

// -------------------------------------------------------------------- units

pub(crate) async fn list_units_v2(
    pool: &PgPool,
    session_token: &str,
) -> Result<Vec<UnitLifecycleItem>, AppError> {
    let rows = sqlx::query_as::<_, (i64, String, String, bool, i64)>(
        "SELECT id, code, name, is_active, usage_count FROM catalog.list_units_v2($1::text)",
    )
    .bind(session_token)
    .fetch_all(pool)
    .await
    .map_err(AppError::from_posting_error)?;
    Ok(rows
        .into_iter()
        .map(
            |(id, code, name, is_active, usage_count)| UnitLifecycleItem {
                id,
                code,
                name,
                is_active,
                usage_count,
            },
        )
        .collect())
}

pub(crate) async fn rename_unit(
    pool: &PgPool,
    session_token: &str,
    unit_id: i64,
    code: &str,
    name: &str,
) -> Result<(), AppError> {
    sqlx::query("SELECT catalog.rename_unit($1::text, $2::bigint, $3::text, $4::text)")
        .bind(session_token)
        .bind(unit_id)
        .bind(code)
        .bind(name)
        .execute(pool)
        .await
        .map_err(AppError::from_posting_error)?;
    Ok(())
}

pub(crate) async fn set_unit_active(
    pool: &PgPool,
    session_token: &str,
    unit_id: i64,
    is_active: bool,
) -> Result<(), AppError> {
    sqlx::query("SELECT catalog.set_unit_active($1::text, $2::bigint, $3::boolean)")
        .bind(session_token)
        .bind(unit_id)
        .bind(is_active)
        .execute(pool)
        .await
        .map_err(AppError::from_posting_error)?;
    Ok(())
}

pub(crate) async fn delete_unit(
    pool: &PgPool,
    session_token: &str,
    unit_id: i64,
) -> Result<(), AppError> {
    sqlx::query("SELECT catalog.delete_unit($1::text, $2::bigint)")
        .bind(session_token)
        .bind(unit_id)
        .execute(pool)
        .await
        .map_err(AppError::from_posting_error)?;
    Ok(())
}

// ------------------------------------------------------------- product surface

/// `catalog.quick_create_product` — every parameter bound explicitly (never a
/// SQL DEFAULT relied on from Rust, ws-d-skill.md section 2.3).
#[allow(clippy::too_many_arguments)]
pub(crate) async fn quick_create_product(
    pool: &PgPool,
    session_token: &str,
    name: &str,
    unit_id: i64,
    sale_price: Decimal,
    category_id: Option<i64>,
    barcode: Option<&str>,
    minimum_stock: Decimal,
    is_active: bool,
) -> Result<QuickCreatedProduct, AppError> {
    let (product_id, variant_id) = sqlx::query_as::<_, (i64, i64)>(
        "SELECT product_id, variant_id FROM catalog.quick_create_product( \
            $1::text, $2::text, $3::bigint, $4::numeric, $5::bigint, \
            $6::text, $7::numeric, $8::boolean)",
    )
    .bind(session_token)
    .bind(name)
    .bind(unit_id)
    .bind(sale_price)
    .bind(category_id)
    .bind(barcode)
    .bind(minimum_stock)
    .bind(is_active)
    .fetch_one(pool)
    .await
    .map_err(AppError::from_posting_error)?;
    Ok(QuickCreatedProduct {
        product_id,
        variant_id,
    })
}

/// `catalog.list_products_v2` — the 8-parameter, 20-column paginated product
/// list. Every parameter bound explicitly; the server clamps `p_limit` to
/// 100 itself (ws-d-skill.md section 2.3) so this layer does not repeat that
/// clamp.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn list_products_v2(
    pool: &PgPool,
    session_token: &str,
    warehouse_id: i64,
    search: Option<&str>,
    category_id: Option<i64>,
    include_inactive: bool,
    limit: i32,
    offset: i32,
) -> Result<Vec<ProductListItemV2>, AppError> {
    let rows = sqlx::query_as::<_, ProductListRowV2>(
        "SELECT product_id, variant_id, sku, product_name, variant_name, primary_barcode, \
                display_identifier, identifier_type, sale_price, minimum_stock, is_active, \
                product_is_active, category_id, category_name, \
                quantity_on_hand, last_known_wac, attributes, total_count \
         FROM catalog.list_products_v2( \
                $1::text, $2::bigint, $3::text, $4::bigint, \
                $5::boolean, $6::integer, $7::integer)",
    )
    .bind(session_token)
    .bind(warehouse_id)
    .bind(search)
    .bind(category_id)
    .bind(include_inactive)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
    .map_err(AppError::from_posting_error)?;
    Ok(rows.into_iter().map(ProductListItemV2::from).collect())
}

/// `catalog.update_product` — the **6-argument** overload (adds
/// `p_category_id`). Named distinctly from the pre-existing `update_product`
/// (5-argument overload) since Rust has no function overloading; every
/// argument carries an explicit SQL cast because two other live overloads of
/// this same PostgreSQL function exist (ws-d-skill.md section 2.1/2.2).
#[allow(clippy::too_many_arguments)]
pub(crate) async fn update_product_v2(
    pool: &PgPool,
    session_token: &str,
    product_id: i64,
    name: &str,
    unit_id: i64,
    is_active: bool,
    category_id: Option<i64>,
) -> Result<(), AppError> {
    sqlx::query(
        "SELECT catalog.update_product( \
            $1::text, $2::bigint, $3::text, $4::bigint, $5::boolean, $6::bigint)",
    )
    .bind(session_token)
    .bind(product_id)
    .bind(name)
    .bind(unit_id)
    .bind(is_active)
    .bind(category_id)
    .execute(pool)
    .await
    .map_err(AppError::from_posting_error)?;
    Ok(())
}

/// `catalog.update_variant` — the **6-argument** overload (adds
/// `p_minimum_stock`). Named distinctly from the pre-existing
/// `update_variant` (5-argument overload); every argument carries an
/// explicit SQL cast because a second live overload of this same
/// PostgreSQL function exists (ws-d-skill.md section 2.1/2.2).
pub(crate) async fn update_variant_v2(
    pool: &PgPool,
    session_token: &str,
    variant_id: i64,
    name_override: Option<&str>,
    sale_price: Decimal,
    is_active: bool,
    minimum_stock: Decimal,
) -> Result<(), AppError> {
    sqlx::query(
        "SELECT catalog.update_variant( \
            $1::text, $2::bigint, $3::text, $4::numeric, $5::boolean, $6::numeric)",
    )
    .bind(session_token)
    .bind(variant_id)
    .bind(name_override)
    .bind(sale_price)
    .bind(is_active)
    .bind(minimum_stock)
    .execute(pool)
    .await
    .map_err(AppError::from_posting_error)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::test_fixtures::{
        fixture_warehouse_id, root_admin_session, unique_suffix,
    };

    // Genuine, opt-in Rust-to-PostgreSQL integration tests, following the same
    // pattern as `application::stock_receipt::tests`: `#[ignore]`d by default,
    // requires `STOCKIHA_TEST_DATABASE_URL`, refuses a database not ending in
    // `_test`. Fixtures are seeded through the sanctioned SECURITY DEFINER
    // paths only (via `test_fixtures::root_admin_session` + this module's own
    // create_category/create_unit), never by inserting rows directly —
    // `stockiha_runtime` cannot do that anyway.
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

    async fn seed_unit(pool: &PgPool, token: &str, suffix: u128) -> i64 {
        create_unit(
            pool,
            token,
            &format!("U{suffix}"),
            &format!("Unit {suffix}"),
        )
        .await
        .expect("creating a fixture unit must succeed")
    }

    /// A fixed-format pseudo-UUID string, unique per test run, for the one
    /// call site here (`StockReceiptRequest::request_id`) that requires a
    /// `uuid` value rather than free text.
    fn uuid_like_string(suffix: u128) -> String {
        format!(
            "{:08x}-{:04x}-4{:03x}-8{:03x}-{:012x}",
            (suffix >> 32) as u32,
            (suffix >> 16) as u16,
            suffix as u16 & 0x0fff,
            (suffix >> 48) as u16 & 0x0fff,
            suffix & 0xffff_ffff_ffff
        )
    }

    /// The ws-d-skill.md section 9 worked example, executed through this
    /// module (the new Rust layer the Tauri commands wrap), not directly in
    /// psql. Covers: `search => '50%'` escaping (exactly one row, not a
    /// wildcard match), `display_identifier`/`identifier_type` preferring
    /// barcode over SKU and falling back to SKU when there is none,
    /// `resolve_barcode` returning no match (not a fuzzy fallback) for an
    /// unknown barcode, the `minimum_stock = 0` "never low stock" meaning,
    /// and `total_count` reflecting the full matching set rather than the
    /// page size.
    #[tokio::test]
    #[ignore = "requires a live PostgreSQL server and STOCKIHA_TEST_DATABASE_URL"]
    async fn worked_example_from_skill_section_9() {
        let pool = sqlx::PgPool::connect(&require_test_pool_url())
            .await
            .expect("failed to connect to the integration test database");
        let (_, token) = root_admin_session(&pool).await;
        let warehouse_id = fixture_warehouse_id(&pool).await;
        let suffix = unique_suffix();
        let unit_id = seed_unit(&pool, &token, suffix).await;

        let cotton_shirt_name = format!("50% cotton shirt {suffix}");
        let plain_tee_name = format!("Plain tee {suffix}");
        let cotton_socks_name = format!("Cotton socks {suffix}");
        let barcode_1 = format!("6130000000017{suffix}");
        let barcode_3 = format!("6130000000024{suffix}");
        let unknown_barcode = format!("6130000000099{suffix}");

        // #1 — barcode + min stock 5.
        let product_1 = quick_create_product(
            &pool,
            &token,
            &cotton_shirt_name,
            unit_id,
            Decimal::new(100, 0),
            None,
            Some(&barcode_1),
            Decimal::new(5, 0),
            true,
        )
        .await
        .expect("product 1 should be created");

        // #2 — no barcode, min stock 0.
        quick_create_product(
            &pool,
            &token,
            &plain_tee_name,
            unit_id,
            Decimal::new(100, 0),
            None,
            None,
            Decimal::ZERO,
            true,
        )
        .await
        .expect("product 2 should be created");

        // #3 — barcode, min stock 0.
        quick_create_product(
            &pool,
            &token,
            &cotton_socks_name,
            unit_id,
            Decimal::new(100, 0),
            None,
            Some(&barcode_3),
            Decimal::ZERO,
            true,
        )
        .await
        .expect("product 3 should be created");

        // Put product 1's variant at quantity 5 in the fixture warehouse,
        // through the same posting path the app uses (WS-B's territory —
        // this test only reads the resulting quantity_on_hand back).
        let fiscal_period_id =
            crate::application::test_fixtures::fixture_fiscal_period_id(&pool).await;
        crate::application::stock_receipt::confirm_stock_receipt(
            &pool,
            &token,
            crate::application::stock_receipt::StockReceiptRequest {
                request_id: uuid_like_string(suffix),
                warehouse_id,
                variant_id: product_1.variant_id,
                quantity: Decimal::new(5, 0),
                unit_cost: Decimal::new(100, 0),
                fiscal_period_id,
                document_date: time::Date::from_calendar_date(2026, time::Month::January, 20)
                    .unwrap(),
            },
        )
        .await
        .expect("stock receipt for product 1 should post");

        // `search => '50%'` must match the literal product name, not act as
        // an ILIKE wildcard — exactly one row.
        let escaped_search = list_products_v2(
            &pool,
            &token,
            warehouse_id,
            Some("50%"),
            None,
            false,
            100,
            0,
        )
        .await
        .expect("list_products_v2 with '50%' should succeed")
        .into_iter()
        .filter(|i| i.product_name.contains(&suffix.to_string()))
        .collect::<Vec<_>>();
        assert_eq!(
            escaped_search.len(),
            1,
            "'50%' must match exactly the '50% cotton shirt' product, not act as a wildcard"
        );
        let row_1 = &escaped_search[0];
        assert_eq!(row_1.product_id, product_1.product_id);
        assert_eq!(row_1.display_identifier, barcode_1);
        assert_eq!(row_1.identifier_type, "BARCODE");
        assert_eq!(row_1.minimum_stock, "5");
        assert_eq!(row_1.quantity_on_hand, "5.000");

        // Barcode search resolves the same single row.
        let by_barcode = list_products_v2(
            &pool,
            &token,
            warehouse_id,
            Some(barcode_1.as_str()),
            None,
            false,
            100,
            0,
        )
        .await
        .expect("list_products_v2 by barcode should succeed");
        assert_eq!(by_barcode.len(), 1);
        assert_eq!(by_barcode[0].product_id, product_1.product_id);

        // An unknown barcode resolves to no match — never a fuzzy fallback.
        let unresolved = resolve_barcode(&pool, &token, &unknown_barcode)
            .await
            .expect("resolve_barcode should succeed even with no match");
        assert!(unresolved.is_none());

        // Product 2 (no barcode) falls back to its SKU as the display
        // identifier.
        let plain_tee_rows = list_products_v2(
            &pool,
            &token,
            warehouse_id,
            Some(plain_tee_name.as_str()),
            None,
            false,
            100,
            0,
        )
        .await
        .expect("list_products_v2 for product 2 should succeed");
        assert_eq!(plain_tee_rows.len(), 1);
        assert_eq!(plain_tee_rows[0].identifier_type, "SKU");
        assert_eq!(plain_tee_rows[0].primary_barcode, None);
        assert_eq!(plain_tee_rows[0].minimum_stock, "0");

        // total_count reflects the full matching set, not the page size:
        // request page size 1 against a search matching only product 1's own
        // fixture row and its total_count must still read 1.
        let single_page = list_products_v2(
            &pool,
            &token,
            warehouse_id,
            Some(cotton_shirt_name.as_str()),
            None,
            false,
            1,
            0,
        )
        .await
        .expect("list_products_v2 with limit=1 should succeed");
        assert_eq!(single_page.len(), 1);
        assert_eq!(single_page[0].total_count, 1);
    }

    /// Covers: the `update_product`/`update_variant` **widened overload**
    /// call sites (ws-d-skill.md section 2.1), and decimal round-tripping as
    /// strings end to end through `quick_create_product` ->
    /// `update_product_v2`/`update_variant_v2` -> `list_products_v2`
    /// (ws-d-skill.md section 6 — never f32/f64/JS number on a money or
    /// quantity path).
    #[tokio::test]
    #[ignore = "requires a live PostgreSQL server and STOCKIHA_TEST_DATABASE_URL"]
    async fn update_overloads_round_trip_decimals_as_strings() {
        let pool = sqlx::PgPool::connect(&require_test_pool_url())
            .await
            .expect("failed to connect to the integration test database");
        let (_, token) = root_admin_session(&pool).await;
        let warehouse_id = fixture_warehouse_id(&pool).await;
        let suffix = unique_suffix();
        let unit_id = seed_unit(&pool, &token, suffix).await;

        let category_id = create_category(&pool, &token, &format!("WSD2 Cat {suffix}"))
            .await
            .expect("creating a fixture category must succeed");

        let created = quick_create_product(
            &pool,
            &token,
            &format!("WSD2 Widget {suffix}"),
            unit_id,
            Decimal::new(12345, 2),
            None,
            None,
            Decimal::ZERO,
            true,
        )
        .await
        .expect("quick_create_product should succeed");

        let renamed = format!("WSD2 Widget {suffix} renamed");

        // catalog.update_product — the 6-argument overload call site.
        update_product_v2(
            &pool,
            &token,
            created.product_id,
            &renamed,
            unit_id,
            true,
            Some(category_id),
        )
        .await
        .expect("update_product (6-arg overload) should succeed");

        // catalog.update_variant — the 6-argument overload call site.
        update_variant_v2(
            &pool,
            &token,
            created.variant_id,
            None,
            Decimal::new(19999, 2),
            true,
            Decimal::new(5, 0),
        )
        .await
        .expect("update_variant (6-arg overload) should succeed");

        let items = list_products_v2(
            &pool,
            &token,
            warehouse_id,
            Some(renamed.as_str()),
            None,
            false,
            100,
            0,
        )
        .await
        .expect("list_products_v2 should succeed");

        let item = items
            .into_iter()
            .find(|i| i.variant_id == created.variant_id)
            .expect("the updated variant must appear in the search results");

        assert_eq!(item.sale_price, "199.99");
        assert_eq!(item.minimum_stock, "5");
        assert_eq!(item.category_id, Some(category_id));
        assert_eq!(item.product_name, renamed);
    }

    /// Covers: a `delete_*` reference-data function refusing to delete while
    /// `usage_count > 0`, surfaced as `AppError::PreconditionFailed` — a
    /// distinct, translatable outcome rather than a generic internal error
    /// (ws-d-skill.md section 3, "reference-data deletion is blocked while
    /// in use").
    #[tokio::test]
    #[ignore = "requires a live PostgreSQL server and STOCKIHA_TEST_DATABASE_URL"]
    async fn delete_category_is_blocked_while_a_product_still_uses_it() {
        let pool = sqlx::PgPool::connect(&require_test_pool_url())
            .await
            .expect("failed to connect to the integration test database");
        let (_, token) = root_admin_session(&pool).await;
        let suffix = unique_suffix();
        let unit_id = seed_unit(&pool, &token, suffix).await;

        let category_id = create_category(&pool, &token, &format!("WSD2 Blocked Cat {suffix}"))
            .await
            .expect("creating a fixture category must succeed");

        quick_create_product(
            &pool,
            &token,
            &format!("WSD2 Anchored Widget {suffix}"),
            unit_id,
            Decimal::new(100, 0),
            Some(category_id),
            None,
            Decimal::ZERO,
            true,
        )
        .await
        .expect("quick_create_product should succeed");

        match delete_category(&pool, &token, category_id).await {
            Err(AppError::PreconditionFailed { .. }) => {}
            other => panic!("expected PreconditionFailed (usage_count > 0), got: {other:?}"),
        }
    }
}
