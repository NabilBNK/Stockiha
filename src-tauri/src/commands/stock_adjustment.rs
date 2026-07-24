//! S2-002 thin Tauri commands for stock adjustments and their unit selector.

use rust_decimal::Decimal;
use serde::Serialize;
use tauri::State;

use crate::application::{self, stock_adjustment};
use crate::domain::stock::StockAdjustmentReason;
use crate::error::{AppError, IpcError};
use crate::infrastructure::db::{self, DatabaseState};

#[derive(Serialize)]
pub(crate) struct StockAdjustmentResponse {
    pub document_id: i64,
    pub document_number: String,
    pub movement_id: i64,
    pub journal_document_id: Option<i64>,
    pub journal_document_number: Option<String>,
    pub warehouse_id: i64,
    pub variant_id: i64,
    pub quantity_delta: String,
    pub inventory_value_delta: String,
    pub resulting_quantity_on_hand: String,
    pub resulting_total_value: String,
    pub reason_code: String,
}

#[derive(Serialize)]
pub(crate) struct StockAdjustmentUnitResponse {
    pub unit_id: i64,
    pub unit_code: String,
    pub unit_name: String,
    pub conversion_factor: String,
    pub is_base: bool,
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn confirm_stock_adjustment(
    state: State<'_, DatabaseState>,
    session_token: String,
    request_id: String,
    warehouse_id: i64,
    variant_id: i64,
    unit_id: i64,
    quantity_delta: Decimal,
    reason_code: String,
    note: Option<String>,
    fiscal_period_id: i64,
    document_date: String,
) -> Result<StockAdjustmentResponse, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    let document_date = application::parse_iso_date(&document_date).map_err(IpcError::from)?;
    let reason = StockAdjustmentReason::parse(&reason_code).map_err(|_| {
        IpcError::from(AppError::ValidationError {
            diagnostic: "invalid stock adjustment reason code".to_owned(),
        })
    })?;

    stock_adjustment::confirm_stock_adjustment(
        pool,
        &session_token,
        stock_adjustment::StockAdjustmentRequest {
            request_id,
            warehouse_id,
            variant_id,
            unit_id,
            quantity_delta,
            reason,
            note,
            fiscal_period_id,
            document_date,
        },
    )
    .await
    .map(|result| StockAdjustmentResponse {
        document_id: result.document_id,
        document_number: result.document_number,
        movement_id: result.movement_id,
        journal_document_id: result.journal_document_id,
        journal_document_number: result.journal_document_number,
        warehouse_id: result.warehouse_id,
        variant_id: result.variant_id,
        quantity_delta: result.quantity_delta,
        inventory_value_delta: result.inventory_value_delta,
        resulting_quantity_on_hand: result.resulting_quantity_on_hand,
        resulting_total_value: result.resulting_total_value,
        reason_code: result.reason_code,
    })
    .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn list_stock_adjustment_units(
    state: State<'_, DatabaseState>,
    session_token: String,
    variant_id: i64,
) -> Result<Vec<StockAdjustmentUnitResponse>, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    stock_adjustment::list_stock_adjustment_units(pool, &session_token, variant_id)
        .await
        .map(|units| {
            units
                .into_iter()
                .map(|unit| StockAdjustmentUnitResponse {
                    unit_id: unit.unit_id,
                    unit_code: unit.unit_code,
                    unit_name: unit.unit_name,
                    conversion_factor: unit.conversion_factor,
                    is_base: unit.is_base,
                })
                .collect()
        })
        .map_err(IpcError::from)
}
