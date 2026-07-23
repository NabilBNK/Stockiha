//! Slice 1 Frontend MVP batch — thin Tauri commands for the posted-receipt
//! view: sale document header, lines, and job statuses.

use serde::Serialize;
use tauri::State;

use crate::application::documents;
use crate::error::IpcError;
use crate::infrastructure::db::{self, DatabaseState};

#[derive(Serialize)]
pub(crate) struct SaleDocumentResponse {
    pub document_id: i64,
    pub document_type: String,
    pub status: String,
    pub document_number: Option<String>,
    pub document_date: String,
    pub posted_at: Option<String>,
    pub subtotal: String,
    pub total_amount: String,
}

#[derive(Serialize)]
pub(crate) struct SaleLineResponse {
    pub line_number: i32,
    pub variant_sku_snapshot: String,
    pub variant_name_snapshot: String,
    pub quantity: String,
    pub unit_price: String,
    pub line_total: String,
}

#[derive(Serialize)]
pub(crate) struct DocumentJobResponse {
    pub job_kind: String,
    pub id: i64,
    pub status: String,
    pub attempt_count: i32,
}

#[tauri::command]
pub(crate) async fn get_sale_document(
    state: State<'_, DatabaseState>,
    session_token: String,
    document_id: i64,
) -> Result<Option<SaleDocumentResponse>, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    documents::get_sale_document(pool, &session_token, document_id)
        .await
        .map(|maybe| {
            maybe.map(|d| SaleDocumentResponse {
                document_id: d.document_id,
                document_type: d.document_type,
                status: d.status,
                document_number: d.document_number,
                document_date: d.document_date,
                posted_at: d.posted_at,
                subtotal: d.subtotal,
                total_amount: d.total_amount,
            })
        })
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn list_sale_lines(
    state: State<'_, DatabaseState>,
    session_token: String,
    document_id: i64,
) -> Result<Vec<SaleLineResponse>, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    documents::list_sale_lines(pool, &session_token, document_id)
        .await
        .map(|items| {
            items
                .into_iter()
                .map(|l| SaleLineResponse {
                    line_number: l.line_number,
                    variant_sku_snapshot: l.variant_sku_snapshot,
                    variant_name_snapshot: l.variant_name_snapshot,
                    quantity: l.quantity,
                    unit_price: l.unit_price,
                    line_total: l.line_total,
                })
                .collect()
        })
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn list_document_jobs(
    state: State<'_, DatabaseState>,
    session_token: String,
    document_id: i64,
) -> Result<Vec<DocumentJobResponse>, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    documents::list_document_jobs(pool, &session_token, document_id)
        .await
        .map(|items| {
            items
                .into_iter()
                .map(|j| DocumentJobResponse {
                    job_kind: j.job_kind,
                    id: j.id,
                    status: j.status,
                    attempt_count: j.attempt_count,
                })
                .collect()
        })
        .map_err(IpcError::from)
}
