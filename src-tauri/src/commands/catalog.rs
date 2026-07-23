//! Slice 1 Frontend MVP batch — thin Tauri commands for catalog reads and
//! product creation. `sale_price` crosses the wire as an exact decimal;
//! stock/WAC/price come back as decimal strings.

use rust_decimal::Decimal;
use serde::Serialize;
use tauri::State;

use crate::application::catalog;
use crate::error::IpcError;
use crate::infrastructure::db::{self, DatabaseState};

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
                    sale_price: i.sale_price,
                    is_active: i.is_active,
                    quantity_on_hand: i.quantity_on_hand,
                    last_known_wac: i.last_known_wac,
                })
                .collect()
        })
        .map_err(IpcError::from)
}
