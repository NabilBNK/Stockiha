//! Thin Tauri commands for posted documents, durable generation/print state,
//! and S4 customer PDF generation.

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use crate::application::documents;
use crate::error::{AppError, IpcError};
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

#[derive(Serialize)]
pub(crate) struct PrintableDocumentResponse {
    pub document_id: i64,
    pub document_type: String,
    pub document_number: Option<String>,
    pub document_date: String,
    pub posted_at: Option<String>,
    pub generation_status: Option<String>,
    pub generated_file_ref: Option<String>,
    pub print_status: Option<String>,
}

#[derive(Serialize)]
pub(crate) struct GeneratedCustomerDocumentResponse {
    pub document_id: i64,
    pub document_number: String,
    pub generated_file_ref: String,
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

#[tauri::command]
pub(crate) async fn list_printable_documents(
    state: State<'_, DatabaseState>,
    session_token: String,
    limit: Option<i32>,
) -> Result<Vec<PrintableDocumentResponse>, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    documents::list_printable_documents(pool, &session_token, limit.unwrap_or(100))
        .await
        .map(|items| {
            items
                .into_iter()
                .map(|d| PrintableDocumentResponse {
                    document_id: d.document_id,
                    document_type: d.document_type,
                    document_number: d.document_number,
                    document_date: d.document_date,
                    posted_at: d.posted_at,
                    generation_status: d.generation_status,
                    generated_file_ref: d.generated_file_ref,
                    print_status: d.print_status,
                })
                .collect()
        })
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn list_business_documents(
    state: State<'_, DatabaseState>,
    session_token: String,
    limit: Option<i32>,
    offset: Option<i32>,
    document_type: Option<String>,
) -> Result<Value, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    documents::list_business_documents(
        pool,
        &session_token,
        limit.unwrap_or(100),
        offset.unwrap_or(0),
        document_type,
    )
    .await
    .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn get_customer_document_payload(
    state: State<'_, DatabaseState>,
    session_token: String,
    document_id: i64,
) -> Result<Value, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    documents::get_customer_document_payload(pool, &session_token, document_id)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn generate_customer_document_pdf(
    app: AppHandle,
    state: State<'_, DatabaseState>,
    session_token: String,
    document_id: i64,
) -> Result<GeneratedCustomerDocumentResponse, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| IpcError::from(AppError::internal(err.to_string())))?;

    documents::generate_customer_document_pdf(pool, &session_token, document_id, &app_data_dir)
        .await
        .map(|generated| GeneratedCustomerDocumentResponse {
            document_id: generated.document_id,
            document_number: generated.document_number,
            generated_file_ref: generated.generated_file_ref,
        })
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn enqueue_customer_reprint(
    state: State<'_, DatabaseState>,
    session_token: String,
    document_id: i64,
    idempotency_key: String,
) -> Result<i64, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    documents::enqueue_customer_reprint(pool, &session_token, document_id, &idempotency_key)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn get_business_document_detail(
    state: State<'_, DatabaseState>,
    session_token: String,
    document_id: i64,
) -> Result<Value, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    documents::get_business_document_detail(pool, &session_token, document_id)
        .await
        .map_err(IpcError::from)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub(crate) async fn get_business_document_reports(
    state: State<'_, DatabaseState>,
    session_token: String,
    date_from: Option<String>,
    date_to: Option<String>,
    document_type: Option<String>,
    status: Option<String>,
    search: Option<String>,
    has_journal: Option<bool>,
    limit: Option<i32>,
    offset: Option<i32>,
) -> Result<Value, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    let parse_date = |s: &str| -> Result<time::Date, AppError> {
        if let Ok(d) = time::Date::parse(s, &time::format_description::well_known::Rfc3339) {
            return Ok(d);
        }
        let parts: Vec<&str> = s.split('T').next().unwrap_or(s).split('-').collect();
        if parts.len() == 3 {
            if let (Ok(y), Ok(m), Ok(d)) = (
                parts[0].parse::<i32>(),
                parts[1].parse::<u8>(),
                parts[2].parse::<u8>(),
            ) {
                if let Ok(month) = time::Month::try_from(m) {
                    if let Ok(date) = time::Date::from_calendar_date(y, month, d) {
                        return Ok(date);
                    }
                }
            }
        }
        Err(AppError::internal(format!("invalid date format: {}", s)))
    };

    let df = date_from
        .as_deref()
        .map(parse_date)
        .transpose()
        .map_err(IpcError::from)?;
    let dt = date_to
        .as_deref()
        .map(parse_date)
        .transpose()
        .map_err(IpcError::from)?;

    documents::get_business_document_reports(
        pool,
        &session_token,
        documents::BusinessDocumentReportFilter {
            date_from: df,
            date_to: dt,
            document_type: document_type.as_deref(),
            status: status.as_deref(),
            search: search.as_deref(),
            has_journal,
            limit,
            offset,
        },
    )
    .await
    .map_err(IpcError::from)
}
