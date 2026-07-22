//! Slice 1 MVP batch — thin Tauri command for confirming a cash sale.

use rust_decimal::Decimal;
use serde::Deserialize;
use tauri::State;

use crate::application::cash_sale::{CashSaleLineInput, CashSaleRequest};
use crate::application::{self, cash_sale};
use crate::error::IpcError;
use crate::infrastructure::db::{self, DatabaseState};

/// Wire-shape input for one sale line. A separate type from
/// [`CashSaleLineInput`] (which only needs `Serialize`, to build the SQL
/// `jsonb` payload) because this one needs `Deserialize` from the IPC
/// boundary instead — keeping the two directions' derives independent
/// avoids coupling the wire format to the SQL-payload format by accident.
#[derive(Deserialize)]
pub(crate) struct CashSaleLineRequest {
    pub variant_id: i64,
    pub quantity: Decimal,
    pub unit_price: Decimal,
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn confirm_cash_sale(
    state: State<'_, DatabaseState>,
    session_token: String,
    request_id: String,
    cash_session_id: i64,
    warehouse_id: i64,
    fiscal_period_id: i64,
    document_date: String,
    lines: Vec<CashSaleLineRequest>,
) -> Result<i64, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    let document_date = application::parse_iso_date(&document_date).map_err(IpcError::from)?;

    let lines = lines
        .into_iter()
        .map(|line| CashSaleLineInput {
            variant_id: line.variant_id,
            quantity: line.quantity,
            unit_price: line.unit_price,
        })
        .collect();

    cash_sale::confirm_cash_sale(
        pool,
        &session_token,
        CashSaleRequest {
            request_id,
            cash_session_id,
            warehouse_id,
            fiscal_period_id,
            document_date,
            lines,
        },
    )
    .await
    .map_err(IpcError::from)
}
