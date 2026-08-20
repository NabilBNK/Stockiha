//! R8-D inventory read-side application service.
//!
//! PostgreSQL remains authoritative for permissions and inventory values.
//! This layer only binds typed parameters and converts exact decimals to
//! strings for IPC.

use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sqlx::{query_as, query_scalar, PgPool};

use crate::error::AppError;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct InventoryCapabilities {
    pub can_manage_catalog: bool,
    pub can_post_stock_receipt: bool,
    pub can_view_inventory: bool,
    pub can_manage_inventory: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub(crate) struct InventorySnapshotItem {
    pub product_id: i64,
    pub variant_id: i64,
    pub variant_name: String,
    pub product_name: String,
    pub primary_barcode: Option<String>,
    pub sku: String,
    pub base_unit_code: String,
    pub product_is_active: bool,
    pub variant_is_active: bool,
    pub quantity_on_hand: String,
    pub last_known_wac: String,
    pub total_value: String,
}

pub(crate) async fn get_capabilities(
    pool: &PgPool,
    session_token: &str,
) -> Result<InventoryCapabilities, AppError> {
    let value: JsonValue = query_scalar("SELECT inventory.get_capabilities($1)")
        .bind(session_token)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    serde_json::from_value(value).map_err(|error| {
        AppError::internal(format!("failed to parse inventory capabilities: {error}"))
    })
}

pub(crate) async fn list_inventory_snapshot(
    pool: &PgPool,
    session_token: &str,
    warehouse_id: i64,
    search: Option<&str>,
    include_inactive: bool,
) -> Result<Vec<InventorySnapshotItem>, AppError> {
    if warehouse_id <= 0 {
        return Err(AppError::ValidationError {
            diagnostic: "warehouse_id must be positive".to_string(),
        });
    }

    let rows = query_as::<
        _,
        (
            i64,
            i64,
            String,
            String,
            Option<String>,
            String,
            String,
            bool,
            bool,
            Decimal,
            Decimal,
            Decimal,
        ),
    >(
        "SELECT \
            l.product_id, \
            l.variant_id, \
            catalog._effective_variant_name(l.variant_id) AS variant_name, \
            l.product_name, \
            (SELECT barcode FROM catalog.variant_barcodes vb WHERE vb.variant_id = l.variant_id ORDER BY is_primary DESC, id ASC LIMIT 1) AS primary_barcode, \
            l.sku, \
            l.base_unit_code, \
            l.product_is_active, \
            l.variant_is_active, \
            l.quantity_on_hand, \
            l.last_known_wac, \
            l.total_value \
         FROM inventory.list_inventory_snapshot($1, $2, NULL, $4) l \
         WHERE ($3::text IS NULL \
            OR btrim($3::text) = '' \
            OR l.sku ILIKE '%' || btrim($3::text) || '%' \
            OR l.product_name ILIKE '%' || btrim($3::text) || '%' \
            OR catalog._effective_variant_name(l.variant_id) ILIKE '%' || btrim($3::text) || '%' \
            OR EXISTS (SELECT 1 FROM catalog.variant_barcodes vb WHERE vb.variant_id = l.variant_id AND vb.normalized_barcode ILIKE '%' || btrim($3::text) || '%') \
            OR EXISTS ( \
                SELECT 1 FROM catalog.variant_attribute_values vav \
                JOIN catalog.attribute_values val ON val.id = vav.attribute_value_id \
                WHERE vav.variant_id = l.variant_id AND val.value ILIKE '%' || btrim($3::text) || '%' \
            ) \
         ) \
         ORDER BY lower(l.product_name), lower(l.sku), l.variant_id",
    )
    .bind(session_token)
    .bind(warehouse_id)
    .bind(search)
    .bind(include_inactive)
    .fetch_all(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    Ok(rows
        .into_iter()
        .map(
            |(
                product_id,
                variant_id,
                variant_name,
                product_name,
                primary_barcode,
                sku,
                base_unit_code,
                product_is_active,
                variant_is_active,
                quantity_on_hand,
                last_known_wac,
                total_value,
            )| InventorySnapshotItem {
                product_id,
                variant_id,
                variant_name,
                product_name,
                primary_barcode,
                sku,
                base_unit_code,
                product_is_active,
                variant_is_active,
                quantity_on_hand: quantity_on_hand.to_string(),
                last_known_wac: last_known_wac.to_string(),
                total_value: total_value.to_string(),
            },
        )
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capability_payload_is_closed_and_typed() {
        let capabilities: InventoryCapabilities = serde_json::from_value(serde_json::json!({
            "can_manage_catalog": true,
            "can_post_stock_receipt": true,
            "can_view_inventory": true,
            "can_manage_inventory": true
        }))
        .unwrap();

        assert!(capabilities.can_manage_catalog);
        assert!(capabilities.can_view_inventory);
    }
}
