//! Slice 1 Frontend MVP batch — application service for the posted-receipt
//! view: the sale document header, its lines, and its generation/print/
//! drawer job statuses. Header/lines are gated on `POST_CASH_SALE`; the job
//! list requires a valid session. Money/quantity are exact decimal strings.

use rust_decimal::Decimal;
use sqlx::PgPool;
use time::{Date, OffsetDateTime};

use crate::error::AppError;

pub(crate) struct SaleDocument {
    pub document_id: i64,
    pub document_type: String,
    pub status: String,
    pub document_number: Option<String>,
    pub document_date: String,
    pub posted_at: Option<String>,
    pub subtotal: String,
    pub total_amount: String,
}

pub(crate) struct SaleLine {
    pub line_number: i32,
    pub variant_sku_snapshot: String,
    pub variant_name_snapshot: String,
    pub quantity: String,
    pub unit_price: String,
    pub line_total: String,
}

pub(crate) struct DocumentJob {
    pub job_kind: String,
    pub id: i64,
    pub status: String,
    pub attempt_count: i32,
}

pub(crate) async fn get_sale_document(
    pool: &PgPool,
    session_token: &str,
    document_id: i64,
) -> Result<Option<SaleDocument>, AppError> {
    let row = sqlx::query_as::<
        _,
        (
            i64,
            String,
            String,
            Option<String>,
            Date,
            Option<OffsetDateTime>,
            Decimal,
            Decimal,
        ),
    >(
        "SELECT document_id, document_type, status, document_number, document_date, \
         posted_at, subtotal, total_amount FROM sales.get_sale_document($1, $2)",
    )
    .bind(session_token)
    .bind(document_id)
    .fetch_optional(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    Ok(row.map(
        |(document_id, document_type, status, number, date, posted_at, subtotal, total)| {
            SaleDocument {
                document_id,
                document_type,
                status,
                document_number: number,
                document_date: date.to_string(),
                posted_at: posted_at.map(|t| {
                    t.format(&time::format_description::well_known::Rfc3339)
                        .unwrap_or_default()
                }),
                subtotal: subtotal.to_string(),
                total_amount: total.to_string(),
            }
        },
    ))
}

pub(crate) async fn list_sale_lines(
    pool: &PgPool,
    session_token: &str,
    document_id: i64,
) -> Result<Vec<SaleLine>, AppError> {
    let rows = sqlx::query_as::<_, (i32, String, String, Decimal, Decimal, Decimal)>(
        "SELECT line_number, variant_sku_snapshot, variant_name_snapshot, quantity, \
         unit_price, line_total FROM sales.list_sale_lines($1, $2)",
    )
    .bind(session_token)
    .bind(document_id)
    .fetch_all(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    Ok(rows
        .into_iter()
        .map(|(line_number, sku, name, qty, price, total)| SaleLine {
            line_number,
            variant_sku_snapshot: sku,
            variant_name_snapshot: name,
            quantity: qty.to_string(),
            unit_price: price.to_string(),
            line_total: total.to_string(),
        })
        .collect())
}

pub(crate) async fn list_document_jobs(
    pool: &PgPool,
    session_token: &str,
    document_id: i64,
) -> Result<Vec<DocumentJob>, AppError> {
    let rows = sqlx::query_as::<_, (String, i64, String, i32)>(
        "SELECT job_kind, id, status, attempt_count \
         FROM documents.list_document_jobs($1, $2)",
    )
    .bind(session_token)
    .bind(document_id)
    .fetch_all(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    Ok(rows
        .into_iter()
        .map(|(job_kind, id, status, attempt_count)| DocumentJob {
            job_kind,
            id,
            status,
            attempt_count,
        })
        .collect())
}
