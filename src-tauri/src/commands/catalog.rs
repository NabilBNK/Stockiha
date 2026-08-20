//! Slice 1 + S2-001 Frontend MVP batch — thin Tauri commands for catalog reads
//! and product/variant management.

use rust_decimal::Decimal;
use serde::Serialize;
use serde_json::Value as JsonValue;
use tauri::State;

use crate::application::catalog;
use crate::error::IpcError;
use crate::infrastructure::db::{self, DatabaseState};

// ---------------------------------------------------------------------------
// Slice-1 types (unchanged)
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub(crate) struct CreatedProductResponse {
    pub product_id: i64,
    pub variant_id: i64,
}

#[derive(Serialize)]
pub(crate) struct ProductListItemResponse {
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

#[tauri::command]
pub(crate) async fn create_product(
    state: State<'_, DatabaseState>,
    session_token: String,
    name: String,
    sku: String,
    sale_price: Decimal,
    is_active: bool,
) -> Result<CreatedProductResponse, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    catalog::create_product_with_variant(pool, &session_token, &name, &sku, sale_price, is_active)
        .await
        .map(|c| CreatedProductResponse {
            product_id: c.product_id,
            variant_id: c.variant_id,
        })
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn list_products(
    state: State<'_, DatabaseState>,
    session_token: String,
    warehouse_id: i64,
    search: Option<String>,
) -> Result<Vec<ProductListItemResponse>, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    catalog::list_products(pool, &session_token, warehouse_id, search.as_deref())
        .await
        .map(|items| {
            items
                .into_iter()
                .map(|i| ProductListItemResponse {
                    product_id: i.product_id,
                    variant_id: i.variant_id,
                    sku: i.sku,
                    name: i.name,
                    product_name: i.product_name,
                    primary_barcode: i.primary_barcode,
                    attributes: i.attributes,
                    sale_price: i.sale_price,
                    is_active: i.is_active,
                    quantity_on_hand: i.quantity_on_hand,
                    last_known_wac: i.last_known_wac,
                })
                .collect()
        })
        .map_err(IpcError::from)
}

// ---------------------------------------------------------------------------
// S2-001 response types
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub(crate) struct CreatedProductWithVariants {
    pub product_id: i64,
    pub variant_ids: Vec<i64>,
}

#[derive(Serialize)]
pub(crate) struct AttributeListItemResponse {
    pub attribute_id: i64,
    pub name: String,
    pub attribute_values: serde_json::Value,
}

#[derive(Serialize)]
pub(crate) struct UnitResponse {
    pub id: i64,
    pub code: String,
    pub name: String,
}

#[derive(Serialize)]
pub(crate) struct CatalogProductResponse {
    pub product_id: i64,
    pub name: String,
    pub unit_id: i64,
    pub unit_code: String,
    pub unit_name: String,
    pub is_active: bool,
    pub variant_count: i64,
    pub active_variant_count: i64,
}

#[derive(Serialize)]
pub(crate) struct ResolvedBarcodeResponse {
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
// S2-001 commands — writes
// ---------------------------------------------------------------------------

#[tauri::command]
pub(crate) async fn create_product_with_variants(
    state: State<'_, DatabaseState>,
    session_token: String,
    name: String,
    unit_id: i64,
    is_active: bool,
    variants: serde_json::Value,
) -> Result<CreatedProductWithVariants, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    catalog::create_product_with_variants(pool, &session_token, &name, unit_id, is_active, variants)
        .await
        .map(|c| CreatedProductWithVariants {
            product_id: c.product_id,
            variant_ids: c.variant_ids,
        })
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn add_variant(
    state: State<'_, DatabaseState>,
    session_token: String,
    product_id: i64,
    variant: serde_json::Value,
) -> Result<i64, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    catalog::add_variant(pool, &session_token, product_id, variant)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn update_variant(
    state: State<'_, DatabaseState>,
    session_token: String,
    variant_id: i64,
    name_override: Option<String>,
    sale_price: Decimal,
    is_active: bool,
) -> Result<(), IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    catalog::update_variant(
        pool,
        &session_token,
        variant_id,
        name_override.as_deref(),
        sale_price,
        is_active,
    )
    .await
    .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn set_variant_active(
    state: State<'_, DatabaseState>,
    session_token: String,
    variant_id: i64,
    is_active: bool,
) -> Result<(), IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    catalog::set_variant_active(pool, &session_token, variant_id, is_active)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn update_product(
    state: State<'_, DatabaseState>,
    session_token: String,
    product_id: i64,
    name: String,
    unit_id: i64,
    is_active: bool,
) -> Result<(), IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    catalog::update_product(pool, &session_token, product_id, &name, unit_id, is_active)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn create_attribute(
    state: State<'_, DatabaseState>,
    session_token: String,
    name: String,
) -> Result<i64, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    catalog::create_attribute(pool, &session_token, &name)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn add_attribute_value(
    state: State<'_, DatabaseState>,
    session_token: String,
    attribute_id: i64,
    value: String,
) -> Result<i64, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    catalog::add_attribute_value(pool, &session_token, attribute_id, &value)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn create_unit(
    state: State<'_, DatabaseState>,
    session_token: String,
    code: String,
    name: String,
) -> Result<i64, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    catalog::create_unit(pool, &session_token, &code, &name)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn set_variant_attributes(
    state: State<'_, DatabaseState>,
    session_token: String,
    variant_id: i64,
    attribute_value_ids: Vec<i64>,
) -> Result<(), IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    catalog::set_variant_attributes(pool, &session_token, variant_id, attribute_value_ids)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn add_variant_barcode(
    state: State<'_, DatabaseState>,
    session_token: String,
    variant_id: i64,
    barcode: String,
) -> Result<i64, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    catalog::add_variant_barcode(pool, &session_token, variant_id, &barcode)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn remove_variant_barcode(
    state: State<'_, DatabaseState>,
    session_token: String,
    barcode_id: i64,
) -> Result<(), IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    catalog::remove_variant_barcode(pool, &session_token, barcode_id)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn add_variant_alt_unit(
    state: State<'_, DatabaseState>,
    session_token: String,
    variant_id: i64,
    unit_id: i64,
    conversion_factor: Decimal,
) -> Result<i64, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    catalog::add_variant_alt_unit(pool, &session_token, variant_id, unit_id, conversion_factor)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn remove_variant_alt_unit(
    state: State<'_, DatabaseState>,
    session_token: String,
    variant_unit_id: i64,
) -> Result<(), IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    catalog::remove_variant_alt_unit(pool, &session_token, variant_unit_id)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn set_variant_base_unit(
    state: State<'_, DatabaseState>,
    session_token: String,
    variant_id: i64,
    unit_id: i64,
) -> Result<(), IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    catalog::set_variant_base_unit(pool, &session_token, variant_id, unit_id)
        .await
        .map_err(IpcError::from)
}

// ---------------------------------------------------------------------------
// S2-001 commands — reads
// ---------------------------------------------------------------------------

#[tauri::command]
pub(crate) async fn list_attributes(
    state: State<'_, DatabaseState>,
    session_token: String,
) -> Result<Vec<AttributeListItemResponse>, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    catalog::list_attributes(pool, &session_token)
        .await
        .map(|items| {
            items
                .into_iter()
                .map(|i| AttributeListItemResponse {
                    attribute_id: i.attribute_id,
                    name: i.name,
                    attribute_values: i.attribute_values,
                })
                .collect()
        })
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn list_units(
    state: State<'_, DatabaseState>,
    session_token: String,
) -> Result<Vec<UnitResponse>, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    catalog::list_units(pool, &session_token)
        .await
        .map(|items| {
            items
                .into_iter()
                .map(|i| UnitResponse {
                    id: i.id,
                    code: i.code,
                    name: i.name,
                })
                .collect()
        })
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn resolve_barcode(
    state: State<'_, DatabaseState>,
    session_token: String,
    barcode: String,
) -> Result<Option<ResolvedBarcodeResponse>, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    catalog::resolve_barcode(pool, &session_token, &barcode)
        .await
        .map(|opt| {
            opt.map(|r| ResolvedBarcodeResponse {
                variant_id: r.variant_id,
                product_id: r.product_id,
                sku: r.sku,
                name_override: r.name_override,
                effective_variant_name: r.effective_variant_name,
                primary_barcode: r.primary_barcode,
                operational_identifier: r.operational_identifier,
                identifier_type: r.identifier_type,
                product_name: r.product_name,
                sale_price: r.sale_price,
                unit_id: r.unit_id,
                unit_code: r.unit_code,
                unit_name: r.unit_name,
                variant_is_active: r.variant_is_active,
                product_is_active: r.product_is_active,
            })
        })
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn list_catalog_products(
    state: State<'_, DatabaseState>,
    session_token: String,
    search: Option<String>,
) -> Result<Vec<CatalogProductResponse>, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    catalog::list_catalog_products(pool, &session_token, search.as_deref())
        .await
        .map(|items| {
            items
                .into_iter()
                .map(|i| CatalogProductResponse {
                    product_id: i.product_id,
                    name: i.name,
                    unit_id: i.unit_id,
                    unit_code: i.unit_code,
                    unit_name: i.unit_name,
                    is_active: i.is_active,
                    variant_count: i.variant_count,
                    active_variant_count: i.active_variant_count,
                })
                .collect()
        })
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn get_product_detail(
    state: State<'_, DatabaseState>,
    session_token: String,
    product_id: i64,
) -> Result<serde_json::Value, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    catalog::get_product_detail(pool, &session_token, product_id)
        .await
        .map_err(IpcError::from)
}
