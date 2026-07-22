//! Slice 1 MVP batch — thin Tauri command for the emergency/opening stock
//! receipt.
//!
//! Frontend note (Batch B / not implemented in this batch): `quantity` and
//! `unit_cost` are `rust_decimal::Decimal` on the wire, which (with this
//! crate's `rust_decimal` `serde` feature) serializes as a JSON string, not
//! a JSON number — required to avoid ever round-tripping money/quantity
//! through IEEE-754 `f64`, matching final-architecture.md section 3.D-ter.
//! The frontend must send `"12.500"`, not `12.5`.

use rust_decimal::Decimal;
use tauri::State;

use crate::application::{self, stock_receipt};
use crate::error::IpcError;
use crate::infrastructure::db::{self, DatabaseState};

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn post_stock_receipt(
    state: State<'_, DatabaseState>,
    session_token: String,
    request_id: String,
    warehouse_id: i64,
    variant_id: i64,
    quantity: Decimal,
    unit_cost: Decimal,
    fiscal_period_id: i64,
    document_date: String,
) -> Result<i64, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    let document_date = application::parse_iso_date(&document_date).map_err(IpcError::from)?;

    stock_receipt::confirm_stock_receipt(
        pool,
        &session_token,
        stock_receipt::StockReceiptRequest {
            request_id,
            warehouse_id,
            variant_id,
            quantity,
            unit_cost,
            fiscal_period_id,
            document_date,
        },
    )
    .await
    .map_err(IpcError::from)
}
