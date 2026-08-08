use rust_decimal::Decimal;
use serde::Deserialize;
use tauri::State;

use crate::application;
use crate::application::credit_sale::{
    self, AuthorizeCreditOverrideRequest, ConfirmCreditSaleRequest, CreditSaleDraft,
    CreditSaleLineInput, CreditSaleResult,
};
use crate::error::IpcError;
use crate::infrastructure::db::{self, DatabaseState};

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct CreditSaleLineRequest {
    pub variant_id: i64,
    pub quantity: Decimal,
    pub unit_price: Decimal,
}

fn map_lines(lines: Vec<CreditSaleLineRequest>) -> Vec<CreditSaleLineInput> {
    lines
        .into_iter()
        .map(|line| CreditSaleLineInput {
            variant_id: line.variant_id,
            quantity: line.quantity,
            unit_price: line.unit_price,
        })
        .collect()
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn confirm_credit_sale(
    state: State<'_, DatabaseState>,
    session_token: String,
    request_id: String,
    customer_id: i64,
    warehouse_id: i64,
    fiscal_period_id: i64,
    document_date: String,
    lines: Vec<CreditSaleLineRequest>,
    override_token: Option<String>,
) -> Result<CreditSaleResult, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    let document_date = application::parse_iso_date(&document_date).map_err(IpcError::from)?;

    credit_sale::confirm_credit_sale(
        pool,
        &session_token,
        ConfirmCreditSaleRequest {
            request_id,
            draft: CreditSaleDraft {
                customer_id,
                warehouse_id,
                fiscal_period_id,
                document_date,
                lines: map_lines(lines),
            },
            override_token,
        },
    )
    .await
    .map_err(IpcError::from)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn authorize_credit_override(
    state: State<'_, DatabaseState>,
    session_token: String,
    token_id: String,
    customer_id: i64,
    warehouse_id: i64,
    fiscal_period_id: i64,
    document_date: String,
    lines: Vec<CreditSaleLineRequest>,
    reason: String,
    ttl_minutes: i32,
) -> Result<String, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    let document_date = application::parse_iso_date(&document_date).map_err(IpcError::from)?;

    credit_sale::authorize_credit_override(
        pool,
        &session_token,
        AuthorizeCreditOverrideRequest {
            token_id,
            draft: CreditSaleDraft {
                customer_id,
                warehouse_id,
                fiscal_period_id,
                document_date,
                lines: map_lines(lines),
            },
            reason,
            ttl_minutes,
        },
    )
    .await
    .map_err(IpcError::from)
}
