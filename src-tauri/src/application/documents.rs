//! Document application services: posted-document reads, durable job status,
//! and S4 customer PDF generation. Financial posting remains entirely in the
//! database; generation only consumes immutable posted snapshots.

use std::path::Path;

use rust_decimal::Decimal;
use serde_json::Value;
use sqlx::PgPool;
use time::{Date, OffsetDateTime};

use crate::error::AppError;
use crate::infrastructure::customer_pdf;

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

pub(crate) struct PrintableDocument {
    pub document_id: i64,
    pub document_type: String,
    pub document_number: Option<String>,
    pub document_date: String,
    pub posted_at: Option<String>,
    pub generation_status: Option<String>,
    pub generated_file_ref: Option<String>,
    pub print_status: Option<String>,
}

pub(crate) struct GeneratedCustomerDocument {
    pub document_id: i64,
    pub document_number: String,
    pub generated_file_ref: String,
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
                posted_at: posted_at.map(format_timestamp),
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

pub(crate) async fn list_printable_documents(
    pool: &PgPool,
    session_token: &str,
    limit: i32,
) -> Result<Vec<PrintableDocument>, AppError> {
    let rows = sqlx::query_as::<
        _,
        (
            i64,
            String,
            Option<String>,
            Date,
            Option<OffsetDateTime>,
            Option<String>,
            Option<String>,
            Option<String>,
        ),
    >(
        "SELECT document_id, document_type, document_number, document_date, posted_at, \
         generation_status, generated_file_ref, print_status \
         FROM documents.list_printable_documents($1, $2)",
    )
    .bind(session_token)
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    Ok(rows
        .into_iter()
        .map(
            |(
                document_id,
                document_type,
                document_number,
                document_date,
                posted_at,
                generation_status,
                generated_file_ref,
                print_status,
            )| PrintableDocument {
                document_id,
                document_type,
                document_number,
                document_date: document_date.to_string(),
                posted_at: posted_at.map(format_timestamp),
                generation_status,
                generated_file_ref,
                print_status,
            },
        )
        .collect())
}

pub(crate) async fn get_customer_document_payload(
    pool: &PgPool,
    session_token: &str,
    document_id: i64,
) -> Result<Value, AppError> {
    sqlx::query_scalar::<_, Value>("SELECT receivables.get_customer_document_payload($1, $2)")
        .bind(session_token)
        .bind(document_id)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)
}

pub(crate) async fn generate_customer_document_pdf(
    pool: &PgPool,
    session_token: &str,
    document_id: i64,
    app_data_dir: &Path,
) -> Result<GeneratedCustomerDocument, AppError> {
    // Fetching the immutable payload is also the VIEW_CUSTOMERS authorization
    // boundary. No mutable customer-master data participates in rendering.
    let payload = get_customer_document_payload(pool, session_token, document_id).await?;
    let document_number = payload
        .get("document_number")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AppError::internal("posted customer document has no official number"))?
        .to_string();

    let existing = sqlx::query_as::<_, (i64, String, Option<String>)>(
        "SELECT id, status, generated_file_ref \
         FROM documents.generation_jobs \
         WHERE business_document_id = $1 \
           AND document_kind IN ('CREDIT_SALE_INVOICE_PDF', 'CUSTOMER_PAYMENT_RECEIPT_PDF') \
         ORDER BY id DESC LIMIT 1",
    )
    .bind(document_id)
    .fetch_optional(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    if let Some((_job_id, status, Some(file_ref))) = existing.as_ref() {
        if status == "COMPLETED" {
            return Ok(GeneratedCustomerDocument {
                document_id,
                document_number,
                generated_file_ref: file_ref.clone(),
            });
        }
    }

    let job_id = sqlx::query_scalar::<_, Option<i64>>(
        "SELECT documents.claim_customer_generation_job($1, $2, $3, $4)",
    )
    .bind(session_token)
    .bind(document_id)
    .bind("tauri-customer-pdf")
    .bind(120_i32)
    .fetch_one(pool)
    .await
    .map_err(AppError::from_posting_error)?
    .ok_or_else(|| AppError::PreconditionFailed {
        diagnostic: "customer document generation job is not currently claimable".to_string(),
    })?;

    sqlx::query("SELECT documents.start_generation($1)")
        .bind(job_id)
        .execute(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    let rendered = match customer_pdf::render_customer_document(&payload) {
        Ok(rendered) => rendered,
        Err(err) => {
            let diagnostic = err.diagnostic();
            let code = err.to_string();
            let retryable = err.is_retryable();
            let _ = complete_generation_failure(pool, job_id, !retryable, &code).await;
            return Err(AppError::internal(diagnostic));
        }
    };

    let relative_ref = format!("generated/customer-documents/customer-{document_id}.pdf");
    let destination = app_data_dir
        .join("generated")
        .join("customer-documents")
        .join(format!("customer-{document_id}.pdf"));

    if let Err(err) = customer_pdf::write_pdf_atomic(&destination, &rendered.bytes) {
        let diagnostic = err.diagnostic();
        let code = err.to_string();
        let retryable = err.is_retryable();
        let _ = complete_generation_failure(pool, job_id, !retryable, &code).await;
        return Err(AppError::internal(diagnostic));
    }

    sqlx::query("SELECT documents.complete_generation_job($1, true, false, $2, NULL, NULL)")
        .bind(job_id)
        .bind(&relative_ref)
        .execute(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    Ok(GeneratedCustomerDocument {
        document_id,
        document_number: rendered.document_number,
        generated_file_ref: relative_ref,
    })
}

pub(crate) async fn enqueue_customer_reprint(
    pool: &PgPool,
    session_token: &str,
    document_id: i64,
    idempotency_key: &str,
) -> Result<i64, AppError> {
    sqlx::query_scalar::<_, i64>("SELECT documents.enqueue_customer_reprint($1, $2, $3)")
        .bind(session_token)
        .bind(document_id)
        .bind(idempotency_key)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)
}

async fn complete_generation_failure(
    pool: &PgPool,
    job_id: i64,
    permanent: bool,
    code: &str,
) -> Result<(), AppError> {
    sqlx::query("SELECT documents.complete_generation_job($1, false, $2, NULL, $3, NULL)")
        .bind(job_id)
        .bind(permanent)
        .bind(code)
        .execute(pool)
        .await
        .map_err(AppError::from_posting_error)?;
    Ok(())
}

fn format_timestamp(value: OffsetDateTime) -> String {
    value
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}
