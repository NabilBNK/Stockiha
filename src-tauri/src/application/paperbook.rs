//! Application service for WS-P-1 Paper Book operations.
//! Brief §11.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};
use sqlx::{query_as, query_scalar, FromRow, PgPool};
use std::collections::HashSet;
use std::path::Path;
use time::Date;

use crate::domain::paperbook::reader::inspect_and_load_workbook;
use crate::domain::paperbook::suggest::should_suggest_pair;
use crate::domain::paperbook::validate::parse_and_validate_workbook;
use crate::domain::paperbook::{ManualSignature, PaperBookIssue, TransactionType};
use crate::error::AppError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaperBookSettingsDto {
    pub go_live_date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaperBookCurrentImportDto {
    pub batch_id: Option<i64>,
    pub file_name: Option<String>,
    pub file_sha256: Option<String>,
    pub imported_at: Option<String>,
    pub txn_count: Option<i32>,
    pub line_count: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaperBookPreviewSummaryDto {
    pub transactions: usize,
    pub sell: usize,
    pub buy: usize,
    pub expense: usize,
    pub lines: usize,
    pub date_min: Option<String>,
    pub date_max: Option<String>,
    pub sell_total: String,
    pub buy_total: String,
    pub expense_total: String,
    pub sell_benefit_total: String,
    pub sells_with_benefit: usize,
    pub sell_total_with_benefit: String,
    pub sell_not_paid_total: String,
    pub buy_not_paid_total: String,
    pub expense_not_paid_total: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaperBookPreviewDto {
    pub file_name: String,
    pub file_sha256: String,
    pub sheet_name: String,
    pub same_as_current: bool,
    pub current_import: Option<PaperBookCurrentImportDto>,
    pub manual_count: i64,
    pub summary: Option<PaperBookPreviewSummaryDto>,
    pub errors: Vec<PaperBookIssue>,
    pub error_total: usize,
    pub warnings: Vec<PaperBookIssue>,
    pub warning_total: usize,
    pub can_import: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaperBookImportResultDto {
    pub batch_id: i64,
    pub txn_count: i32,
    pub line_count: i32,
    pub replaced_txn_count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaperBookTxnRowDto {
    pub id: i64,
    pub source: String,
    pub batch_id: Option<i64>,
    pub excel_first_row: Option<i32>,
    pub excel_txn_no: Option<String>,
    pub txn_date: String,
    pub txn_type: String,
    pub is_paid: bool,
    pub party_raw: Option<String>,
    pub party_label: Option<String>,
    pub what_label: Option<String>,
    pub benefit: Option<String>,
    pub page_no: Option<String>,
    pub note: Option<String>,
    pub total: String,
    pub line_count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaperBookListResponse {
    pub txns: Vec<PaperBookTxnRowDto>,
    pub total_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaperBookTotalsDto {
    pub txn_count: i64,
    pub sell_total: String,
    pub buy_total: String,
    pub expense_total: String,
    pub benefit_total: String,
    pub not_paid_total: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaperBookLineDto {
    pub id: i64,
    pub line_no: i32,
    pub excel_row: Option<i32>,
    pub product_raw: Option<String>,
    pub product_label: Option<String>,
    pub brand_raw: Option<String>,
    pub brand_label: Option<String>,
    pub details_raw: Option<String>,
    pub details_label: Option<String>,
    pub quantity: Option<String>,
    pub unit_price: Option<String>,
    pub line_total: String,
    pub total_overridden: bool,
    pub page_no: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaperBookTxnDetailDto {
    pub txn: PaperBookTxnRowDto,
    pub lines: Vec<PaperBookLineDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaperBookNameRowDto {
    pub raw_key: String,
    pub raw_label: String,
    pub usage_count: i64,
    pub effective_key: String,
    pub effective_label: String,
    pub is_mapped: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaperBookNamesResponse {
    pub names: Vec<PaperBookNameRowDto>,
    pub total_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaperBookSuggestionDto {
    pub field: String,
    pub key_a: String,
    pub label_a: String,
    pub usage_a: i64,
    pub key_b: String,
    pub label_b: String,
    pub usage_b: i64,
}

// ----------------------------------------------------------------------------
// Service implementation
// ----------------------------------------------------------------------------

pub async fn get_settings(
    pool: &PgPool,
    session_token: &str,
) -> Result<PaperBookSettingsDto, AppError> {
    #[derive(FromRow)]
    struct Row {
        go_live_date: Option<Date>,
    }

    let row = query_as::<_, Row>("SELECT * FROM paperbook.get_settings($1)")
        .bind(session_token)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    Ok(PaperBookSettingsDto {
        go_live_date: row.go_live_date.map(|d| d.to_string()),
    })
}

pub async fn set_go_live_date(
    pool: &PgPool,
    session_token: &str,
    date_str: &str,
) -> Result<PaperBookSettingsDto, AppError> {
    let parts: Vec<&str> = date_str.split('-').collect();
    if parts.len() != 3 {
        return Err(AppError::ValidationError {
            diagnostic: "Date must be YYYY-MM-DD".to_string(),
        });
    }
    let year: i32 = parts[0].parse().map_err(|_| AppError::ValidationError {
        diagnostic: "Invalid year".to_string(),
    })?;
    let month_num: u8 = parts[1].parse().map_err(|_| AppError::ValidationError {
        diagnostic: "Invalid month".to_string(),
    })?;
    let day: u8 = parts[2].parse().map_err(|_| AppError::ValidationError {
        diagnostic: "Invalid day".to_string(),
    })?;
    let month = time::Month::try_from(month_num).map_err(|_| AppError::ValidationError {
        diagnostic: "Invalid month".to_string(),
    })?;
    let parsed_date =
        Date::from_calendar_date(year, month, day).map_err(|_| AppError::ValidationError {
            diagnostic: "Invalid calendar date".to_string(),
        })?;

    #[derive(FromRow)]
    struct Row {
        go_live_date: Date,
    }

    let row = query_as::<_, Row>("SELECT * FROM paperbook.set_go_live_date($1, $2)")
        .bind(session_token)
        .bind(parsed_date)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    Ok(PaperBookSettingsDto {
        go_live_date: Some(row.go_live_date.to_string()),
    })
}

#[derive(FromRow)]
struct StatusRow {
    batch_id: Option<i64>,
    file_name: Option<String>,
    file_sha256: Option<String>,
    imported_at: Option<time::OffsetDateTime>,
    txn_count: Option<i32>,
    line_count: Option<i32>,
    manual_count: i64,
}

#[derive(FromRow)]
struct ManualSigRow {
    id: i64,
    txn_date: Date,
    txn_type: String,
    total: sqlx::types::Decimal,
}

pub async fn preview_import(
    pool: &PgPool,
    session_token: &str,
    file_path_str: &str,
) -> Result<PaperBookPreviewDto, AppError> {
    let path = Path::new(file_path_str);
    let inspected = match inspect_and_load_workbook(path) {
        Ok(ins) => ins,
        Err(issues) => {
            let error_count = issues.len();
            return Ok(PaperBookPreviewDto {
                file_name: path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string(),
                file_sha256: String::new(),
                sheet_name: String::new(),
                same_as_current: false,
                current_import: None,
                manual_count: 0,
                summary: None,
                errors: issues,
                error_total: error_count,
                warnings: Vec::new(),
                warning_total: 0,
                can_import: false,
            });
        }
    };

    let settings = get_settings(pool, session_token).await?;
    let go_live_date = settings.go_live_date.and_then(|s| {
        let parts: Vec<&str> = s.split('-').collect();
        if parts.len() == 3 {
            let y: i32 = parts[0].parse().ok()?;
            let m: u8 = parts[1].parse().ok()?;
            let d: u8 = parts[2].parse().ok()?;
            let month = time::Month::try_from(m).ok()?;
            Date::from_calendar_date(y, month, d).ok()
        } else {
            None
        }
    });

    // Fetch current import status
    let status = query_as::<_, StatusRow>("SELECT * FROM paperbook.import_status($1)")
        .bind(session_token)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    // Fetch manual signatures
    let sig_rows = query_as::<_, ManualSigRow>("SELECT * FROM paperbook.manual_signatures($1)")
        .bind(session_token)
        .fetch_all(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    let manual_signatures: Vec<ManualSignature> = sig_rows
        .into_iter()
        .map(|r| {
            let txn_type = match r.txn_type.as_str() {
                "sell" => TransactionType::Sell,
                "buy" => TransactionType::Buy,
                _ => TransactionType::Expense,
            };
            ManualSignature {
                id: r.id,
                date: r.txn_date,
                txn_type,
                total: r.total.to_string().parse().unwrap_or(0),
            }
        })
        .collect();

    let same_as_current = status.file_sha256.as_deref() == Some(&inspected.file_sha256);

    let active_batch_count = status.txn_count.map(|c| c as usize);
    let active_batch_date_str = status.imported_at.map(|t| t.date().to_string());

    let today = (time::OffsetDateTime::now_utc()).date();

    let parse_res = parse_and_validate_workbook(
        inspected,
        go_live_date,
        today,
        &manual_signatures,
        active_batch_count,
        active_batch_date_str.as_deref(),
    );

    let current_import = if status.batch_id.is_some() {
        Some(PaperBookCurrentImportDto {
            batch_id: status.batch_id,
            file_name: status.file_name,
            file_sha256: status.file_sha256,
            imported_at: status.imported_at.map(|t| t.to_string()),
            txn_count: status.txn_count,
            line_count: status.line_count,
        })
    } else {
        None
    };

    match parse_res {
        Ok(wb) => {
            let summary_dto = PaperBookPreviewSummaryDto {
                transactions: wb.summary.transactions,
                sell: wb.summary.sell,
                buy: wb.summary.buy,
                expense: wb.summary.expense,
                lines: wb.summary.lines,
                date_min: wb.summary.date_min,
                date_max: wb.summary.date_max,
                sell_total: wb.summary.sell_total.to_string(),
                buy_total: wb.summary.buy_total.to_string(),
                expense_total: wb.summary.expense_total.to_string(),
                sell_benefit_total: wb.summary.sell_benefit_total.to_string(),
                sells_with_benefit: wb.summary.sells_with_benefit,
                sell_total_with_benefit: wb.summary.sell_total_with_benefit.to_string(),
                sell_not_paid_total: wb.summary.sell_not_paid_total.to_string(),
                buy_not_paid_total: wb.summary.buy_not_paid_total.to_string(),
                expense_not_paid_total: wb.summary.expense_not_paid_total.to_string(),
            };

            let warning_total = wb.warnings.len();
            let can_import = !same_as_current;

            Ok(PaperBookPreviewDto {
                file_name: wb.file_name,
                file_sha256: wb.file_sha256,
                sheet_name: wb.sheet_name,
                same_as_current,
                current_import,
                manual_count: status.manual_count,
                summary: Some(summary_dto),
                errors: Vec::new(),
                error_total: 0,
                warnings: wb.warnings,
                warning_total,
                can_import,
            })
        }
        Err(issues) => {
            let error_total = issues.len();
            Ok(PaperBookPreviewDto {
                file_name: path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string(),
                file_sha256: String::new(),
                sheet_name: String::new(),
                same_as_current,
                current_import,
                manual_count: status.manual_count,
                summary: None,
                errors: issues,
                error_total,
                warnings: Vec::new(),
                warning_total: 0,
                can_import: false,
            })
        }
    }
}

pub async fn commit_import(
    pool: &PgPool,
    session_token: &str,
    file_path_str: &str,
    expected_sha256: &str,
    warnings_acknowledged: bool,
) -> Result<PaperBookImportResultDto, AppError> {
    let path = Path::new(file_path_str);
    let inspected =
        inspect_and_load_workbook(path).map_err(|issues| AppError::ValidationError {
            diagnostic: format!("Workbook inspection failed with {} issues", issues.len()),
        })?;

    if inspected.file_sha256 != expected_sha256 {
        return Err(AppError::ValidationError {
            diagnostic: "E_FILE_CHANGED".to_string(),
        });
    }

    let settings = get_settings(pool, session_token).await?;
    let go_live_date = settings.go_live_date.and_then(|s| {
        let parts: Vec<&str> = s.split('-').collect();
        if parts.len() == 3 {
            let y: i32 = parts[0].parse().ok()?;
            let m: u8 = parts[1].parse().ok()?;
            let d: u8 = parts[2].parse().ok()?;
            let month = time::Month::try_from(m).ok()?;
            Date::from_calendar_date(y, month, d).ok()
        } else {
            None
        }
    });

    let status = query_as::<_, StatusRow>("SELECT * FROM paperbook.import_status($1)")
        .bind(session_token)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    let sig_rows = query_as::<_, ManualSigRow>("SELECT * FROM paperbook.manual_signatures($1)")
        .bind(session_token)
        .fetch_all(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    let manual_signatures: Vec<ManualSignature> = sig_rows
        .into_iter()
        .map(|r| {
            let txn_type = match r.txn_type.as_str() {
                "sell" => TransactionType::Sell,
                "buy" => TransactionType::Buy,
                _ => TransactionType::Expense,
            };
            ManualSignature {
                id: r.id,
                date: r.txn_date,
                txn_type,
                total: r.total.to_string().parse().unwrap_or(0),
            }
        })
        .collect();

    let active_batch_count = status.txn_count.map(|c| c as usize);
    let active_batch_date_str = status.imported_at.map(|t| t.date().to_string());
    let today = (time::OffsetDateTime::now_utc()).date();

    let wb = parse_and_validate_workbook(
        inspected,
        go_live_date,
        today,
        &manual_signatures,
        active_batch_count,
        active_batch_date_str.as_deref(),
    )
    .map_err(|issues| AppError::ValidationError {
        diagnostic: format!("Validation failed with {} errors", issues.len()),
    })?;

    if !wb.warnings.is_empty() && !warnings_acknowledged {
        return Err(AppError::ValidationError {
            diagnostic: "E_WARNINGS_NOT_ACKNOWLEDGED".to_string(),
        });
    }

    // Convert transactions to JSONB payload with money and quantities as strings
    let txns_json: Vec<JsonValue> = wb
        .transactions
        .iter()
        .map(|t| {
            let lines_json: Vec<JsonValue> = t
                .lines
                .iter()
                .map(|l| {
                    json!({
                        "excel_row": l.excel_row,
                        "product": l.product_raw,
                        "brand": l.brand_raw,
                        "details": l.details_raw,
                        "qty": l.quantity.map(|q| q.to_string()),
                        "unit_price": l.unit_price.map(|p| p.to_string()),
                        "line_total": l.line_total.to_string(),
                        "total_overridden": l.total_overridden,
                        "page": l.page_no,
                    })
                })
                .collect();

            json!({
                "excel_first_row": t.excel_first_row,
                "excel_txn_no": t.excel_txn_no,
                "date": t.date.to_string(),
                "type": t.txn_type.to_string(),
                "paid": t.is_paid,
                "party": t.party_raw,
                "benefit": t.benefit.map(|b| b.to_string()),
                "page": t.page_no,
                "note": t.note,
                "lines": lines_json,
            })
        })
        .collect();

    #[derive(FromRow)]
    struct ReplaceRow {
        batch_id: i64,
        txn_count: i32,
        line_count: i32,
        replaced_txn_count: i32,
    }

    let row =
        query_as::<_, ReplaceRow>("SELECT * FROM paperbook.import_replace($1, $2, $3, $4, $5, $6)")
            .bind(session_token)
            .bind(&wb.file_name)
            .bind(&wb.file_sha256)
            .bind(&wb.sheet_name)
            .bind(wb.warnings.len() as i32)
            .bind(json!(txns_json))
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    Ok(PaperBookImportResultDto {
        batch_id: row.batch_id,
        txn_count: row.txn_count,
        line_count: row.line_count,
        replaced_txn_count: row.replaced_txn_count,
    })
}

#[derive(FromRow)]
struct TxnDbRow {
    id: i64,
    source: String,
    batch_id: Option<i64>,
    excel_first_row: Option<i32>,
    excel_txn_no: Option<String>,
    txn_date: Date,
    txn_type: String,
    is_paid: bool,
    party_raw: Option<String>,
    party_label: Option<String>,
    what_label: Option<String>,
    benefit: Option<sqlx::types::Decimal>,
    page_no: Option<String>,
    note: Option<String>,
    total: sqlx::types::Decimal,
    line_count: i32,
    total_count: i64,
}

#[allow(clippy::too_many_arguments)]
pub async fn list_txns(
    pool: &PgPool,
    session_token: &str,
    from: Option<Date>,
    to: Option<Date>,
    txn_type: Option<&str>,
    paid: Option<&str>,
    source: Option<&str>,
    search: Option<&str>,
    sort: Option<&str>,
    limit: Option<i32>,
    offset: Option<i32>,
) -> Result<PaperBookListResponse, AppError> {
    let sort_clean = match sort {
        Some("oldest") | Some("date_asc") => "oldest",
        _ => "newest",
    };
    let paid_clean = match paid {
        Some("paid") | Some("true") => Some("paid"),
        Some("not_paid") | Some("false") => Some("not_paid"),
        _ => None,
    };

    let rows = query_as::<_, TxnDbRow>(
        "SELECT * FROM paperbook.list_txns($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
    )
    .bind(session_token)
    .bind(from)
    .bind(to)
    .bind(txn_type)
    .bind(paid_clean)
    .bind(source)
    .bind(search)
    .bind(sort_clean)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    let total_count = rows.first().map(|r| r.total_count).unwrap_or(0);
    let txns = rows
        .into_iter()
        .map(|r| PaperBookTxnRowDto {
            id: r.id,
            source: r.source,
            batch_id: r.batch_id,
            excel_first_row: r.excel_first_row,
            excel_txn_no: r.excel_txn_no,
            txn_date: r.txn_date.to_string(),
            txn_type: r.txn_type,
            is_paid: r.is_paid,
            party_raw: r.party_raw,
            party_label: r.party_label,
            what_label: r.what_label,
            benefit: r.benefit.map(|b| b.to_string()),
            page_no: r.page_no,
            note: r.note,
            total: r.total.to_string(),
            line_count: r.line_count,
        })
        .collect();

    Ok(PaperBookListResponse { txns, total_count })
}

#[derive(FromRow)]
struct TotalsDbRow {
    txn_count: i64,
    sell_total: sqlx::types::Decimal,
    buy_total: sqlx::types::Decimal,
    expense_total: sqlx::types::Decimal,
    benefit_total: sqlx::types::Decimal,
    not_paid_total: sqlx::types::Decimal,
}

#[allow(clippy::too_many_arguments)]
pub async fn list_totals(
    pool: &PgPool,
    session_token: &str,
    from: Option<Date>,
    to: Option<Date>,
    txn_type: Option<&str>,
    paid: Option<&str>,
    source: Option<&str>,
    search: Option<&str>,
) -> Result<PaperBookTotalsDto, AppError> {
    let paid_clean = match paid {
        Some("paid") | Some("true") => Some("paid"),
        Some("not_paid") | Some("false") => Some("not_paid"),
        _ => None,
    };

    let row = query_as::<_, TotalsDbRow>(
        "SELECT * FROM paperbook.list_totals($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(session_token)
    .bind(from)
    .bind(to)
    .bind(txn_type)
    .bind(paid_clean)
    .bind(source)
    .bind(search)
    .fetch_one(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    Ok(PaperBookTotalsDto {
        txn_count: row.txn_count,
        sell_total: row.sell_total.to_string(),
        buy_total: row.buy_total.to_string(),
        expense_total: row.expense_total.to_string(),
        benefit_total: row.benefit_total.to_string(),
        not_paid_total: row.not_paid_total.to_string(),
    })
}

#[derive(FromRow)]
struct GetTxnDbRow {
    id: i64,
    source: String,
    batch_id: Option<i64>,
    excel_first_row: Option<i32>,
    excel_txn_no: Option<String>,
    txn_date: Date,
    txn_type: String,
    is_paid: bool,
    party_raw: Option<String>,
    party_label: Option<String>,
    benefit: Option<sqlx::types::Decimal>,
    page_no: Option<String>,
    note: Option<String>,
    total: sqlx::types::Decimal,
}

#[derive(FromRow)]
struct GetLineDbRow {
    id: i64,
    line_no: i32,
    excel_row: Option<i32>,
    product_raw: Option<String>,
    product_label: Option<String>,
    brand_raw: Option<String>,
    brand_label: Option<String>,
    details_raw: Option<String>,
    details_label: Option<String>,
    quantity: Option<sqlx::types::Decimal>,
    unit_price: Option<sqlx::types::Decimal>,
    line_total: sqlx::types::Decimal,
    total_overridden: bool,
    page_no: Option<String>,
}

pub async fn get_txn(
    pool: &PgPool,
    session_token: &str,
    id: i64,
) -> Result<PaperBookTxnDetailDto, AppError> {
    let txn_row = query_as::<_, GetTxnDbRow>("SELECT * FROM paperbook.get_txn($1, $2)")
        .bind(session_token)
        .bind(id)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    let line_rows = query_as::<_, GetLineDbRow>("SELECT * FROM paperbook.get_txn_lines($1, $2)")
        .bind(session_token)
        .bind(id)
        .fetch_all(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    let lines: Vec<PaperBookLineDto> = line_rows
        .into_iter()
        .map(|l| PaperBookLineDto {
            id: l.id,
            line_no: l.line_no,
            excel_row: l.excel_row,
            product_raw: l.product_raw,
            product_label: l.product_label,
            brand_raw: l.brand_raw,
            brand_label: l.brand_label,
            details_raw: l.details_raw,
            details_label: l.details_label,
            quantity: l.quantity.map(|q| q.to_string()),
            unit_price: l.unit_price.map(|p| p.to_string()),
            line_total: l.line_total.to_string(),
            total_overridden: l.total_overridden,
            page_no: l.page_no,
        })
        .collect();

    let txn = PaperBookTxnRowDto {
        id: txn_row.id,
        source: txn_row.source,
        batch_id: txn_row.batch_id,
        excel_first_row: txn_row.excel_first_row,
        excel_txn_no: txn_row.excel_txn_no,
        txn_date: txn_row.txn_date.to_string(),
        txn_type: txn_row.txn_type,
        is_paid: txn_row.is_paid,
        party_raw: txn_row.party_raw,
        party_label: txn_row.party_label,
        what_label: None,
        benefit: txn_row.benefit.map(|b| b.to_string()),
        page_no: txn_row.page_no,
        note: txn_row.note,
        total: txn_row.total.to_string(),
        line_count: lines.len() as i32,
    };

    Ok(PaperBookTxnDetailDto { txn, lines })
}

pub async fn create_manual(
    pool: &PgPool,
    session_token: &str,
    payload: JsonValue,
) -> Result<i64, AppError> {
    let id: i64 = query_scalar("SELECT paperbook.create_manual($1, $2)")
        .bind(session_token)
        .bind(payload)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    Ok(id)
}

pub async fn update_manual(
    pool: &PgPool,
    session_token: &str,
    id: i64,
    payload: JsonValue,
) -> Result<i64, AppError> {
    let res_id: i64 = query_scalar("SELECT paperbook.update_manual($1, $2, $3)")
        .bind(session_token)
        .bind(id)
        .bind(payload)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    Ok(res_id)
}

pub async fn delete_manual(pool: &PgPool, session_token: &str, id: i64) -> Result<(), AppError> {
    sqlx::query("SELECT paperbook.delete_manual($1, $2)")
        .bind(session_token)
        .bind(id)
        .execute(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    Ok(())
}

pub async fn autocomplete(
    pool: &PgPool,
    session_token: &str,
    field: &str,
    text: &str,
    limit: Option<i32>,
) -> Result<Vec<String>, AppError> {
    #[derive(FromRow)]
    struct Row {
        label: String,
    }

    let rows = query_as::<_, Row>("SELECT * FROM paperbook.autocomplete($1, $2, $3, $4)")
        .bind(session_token)
        .bind(field)
        .bind(text)
        .bind(limit)
        .fetch_all(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    Ok(rows.into_iter().map(|r| r.label).collect())
}

#[derive(FromRow)]
struct NameDbRow {
    raw_key: String,
    raw_label: String,
    usage_count: i64,
    effective_key: String,
    effective_label: String,
    is_mapped: bool,
    total_count: i64,
}

pub async fn list_names(
    pool: &PgPool,
    session_token: &str,
    field: &str,
    search: Option<&str>,
    limit: Option<i32>,
    offset: Option<i32>,
) -> Result<PaperBookNamesResponse, AppError> {
    let rows = query_as::<_, NameDbRow>("SELECT * FROM paperbook.list_names($1, $2, $3, $4, $5)")
        .bind(session_token)
        .bind(field)
        .bind(search)
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    let total_count = rows.first().map(|r| r.total_count).unwrap_or(0);
    let names = rows
        .into_iter()
        .map(|r| PaperBookNameRowDto {
            raw_key: r.raw_key,
            raw_label: r.raw_label,
            usage_count: r.usage_count,
            effective_key: r.effective_key,
            effective_label: r.effective_label,
            is_mapped: r.is_mapped,
        })
        .collect();

    Ok(PaperBookNamesResponse { names, total_count })
}

#[derive(FromRow)]
struct KeyDbRow {
    effective_key: String,
    label: String,
    usage_count: i64,
}

#[derive(FromRow)]
struct DismissedDbRow {
    key_a: String,
    key_b: String,
}

pub async fn name_suggestions(
    pool: &PgPool,
    session_token: &str,
    field: &str,
) -> Result<Vec<PaperBookSuggestionDto>, AppError> {
    let key_rows = query_as::<_, KeyDbRow>("SELECT * FROM paperbook.list_effective_keys($1, $2)")
        .bind(session_token)
        .bind(field)
        .fetch_all(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    let dismissed_rows =
        query_as::<_, DismissedDbRow>("SELECT * FROM paperbook.list_dismissed($1, $2)")
            .bind(session_token)
            .bind(field)
            .fetch_all(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    let dismissed_set: HashSet<(String, String)> = dismissed_rows
        .into_iter()
        .map(|r| (r.key_a, r.key_b))
        .collect();

    let mut suggestions = Vec::new();
    let n = key_rows.len();

    for i in 0..n {
        for j in (i + 1)..n {
            let row_a = &key_rows[i];
            let row_b = &key_rows[j];

            let (k_min, k_max) = if row_a.effective_key < row_b.effective_key {
                (&row_a.effective_key, &row_b.effective_key)
            } else {
                (&row_b.effective_key, &row_a.effective_key)
            };

            if dismissed_set.contains(&(k_min.clone(), k_max.clone())) {
                continue;
            }

            if should_suggest_pair(&row_a.effective_key, &row_b.effective_key) {
                suggestions.push(PaperBookSuggestionDto {
                    field: field.to_string(),
                    key_a: row_a.effective_key.clone(),
                    label_a: row_a.label.clone(),
                    usage_a: row_a.usage_count,
                    key_b: row_b.effective_key.clone(),
                    label_b: row_b.label.clone(),
                    usage_b: row_b.usage_count,
                });
            }
        }
    }

    Ok(suggestions)
}

pub async fn set_name_map(
    pool: &PgPool,
    session_token: &str,
    field: &str,
    raw_key: &str,
    label: &str,
) -> Result<(), AppError> {
    sqlx::query("SELECT paperbook.set_name_map($1, $2, $3, $4)")
        .bind(session_token)
        .bind(field)
        .bind(raw_key)
        .bind(label)
        .execute(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    Ok(())
}

pub async fn remove_name_map(
    pool: &PgPool,
    session_token: &str,
    field: &str,
    raw_key: &str,
) -> Result<(), AppError> {
    sqlx::query("SELECT paperbook.remove_name_map($1, $2, $3)")
        .bind(session_token)
        .bind(field)
        .bind(raw_key)
        .execute(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    Ok(())
}

pub async fn dismiss_suggestion(
    pool: &PgPool,
    session_token: &str,
    field: &str,
    key_a: &str,
    key_b: &str,
) -> Result<(), AppError> {
    sqlx::query("SELECT paperbook.dismiss_suggestion($1, $2, $3, $4)")
        .bind(session_token)
        .bind(field)
        .bind(key_a)
        .bind(key_b)
        .execute(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    Ok(())
}

// ----------------------------------------------------------------------------
// WS-P-2: Financial Analytics & Reporting DTOs and Queries
// ----------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaperBookAnalyticsSummaryDto {
    pub sell_total: String,
    pub buy_total: String,
    pub expense_total: String,
    pub benefit_total: String,
    pub net_profit: String,
    pub margin_rate: String,
    pub unpaid_sell_total: String,
    pub unpaid_buy_total: String,
    pub sell_count: i32,
    pub buy_count: i32,
    pub expense_count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaperBookMonthlyPointDto {
    pub year_month: String,
    pub month_date: String,
    pub sell_total: String,
    pub buy_total: String,
    pub expense_total: String,
    pub benefit_total: String,
    pub net_profit: String,
    pub unpaid_sell_total: String,
    pub txn_count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaperBookTopProductDto {
    pub product_label: String,
    pub total_qty: String,
    pub total_revenue: String,
    pub txn_count: i32,
    pub avg_price: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaperBookTopPartyDto {
    pub party_label: String,
    pub total_amount: String,
    pub unpaid_amount: String,
    pub txn_count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaperBookTopBrandDto {
    pub brand_label: String,
    pub total_qty: String,
    pub total_revenue: String,
    pub txn_count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaperBookExpenseCategoryDto {
    pub category_label: String,
    pub total_amount: String,
    pub txn_count: i32,
    pub percent_of_total: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaperBookAnalyticsPayloadDto {
    pub summary: PaperBookAnalyticsSummaryDto,
    pub monthly: Vec<PaperBookMonthlyPointDto>,
    pub top_products: Vec<PaperBookTopProductDto>,
    pub top_customers: Vec<PaperBookTopPartyDto>,
    pub top_suppliers: Vec<PaperBookTopPartyDto>,
    pub top_brands: Vec<PaperBookTopBrandDto>,
    pub expenses: Vec<PaperBookExpenseCategoryDto>,
}

#[derive(FromRow)]
struct AnalyticsSummaryDbRow {
    sell_total: sqlx::types::Decimal,
    buy_total: sqlx::types::Decimal,
    expense_total: sqlx::types::Decimal,
    benefit_total: sqlx::types::Decimal,
    net_profit: sqlx::types::Decimal,
    margin_rate: sqlx::types::Decimal,
    unpaid_sell_total: sqlx::types::Decimal,
    unpaid_buy_total: sqlx::types::Decimal,
    sell_count: i32,
    buy_count: i32,
    expense_count: i32,
}

#[derive(FromRow)]
struct MonthlyDbRow {
    year_month: String,
    month_date: Date,
    sell_total: sqlx::types::Decimal,
    buy_total: sqlx::types::Decimal,
    expense_total: sqlx::types::Decimal,
    benefit_total: sqlx::types::Decimal,
    net_profit: sqlx::types::Decimal,
    unpaid_sell_total: sqlx::types::Decimal,
    txn_count: i32,
}

#[derive(FromRow)]
struct TopProductDbRow {
    product_label: String,
    total_qty: sqlx::types::Decimal,
    total_revenue: sqlx::types::Decimal,
    txn_count: i32,
    avg_price: sqlx::types::Decimal,
}

#[derive(FromRow)]
struct TopCustomerDbRow {
    customer_label: String,
    total_spent: sqlx::types::Decimal,
    unpaid_amount: sqlx::types::Decimal,
    order_count: i32,
}

#[derive(FromRow)]
struct TopSupplierDbRow {
    supplier_label: String,
    total_bought: sqlx::types::Decimal,
    unpaid_amount: sqlx::types::Decimal,
    txn_count: i32,
}

#[derive(FromRow)]
struct TopBrandDbRow {
    brand_label: String,
    total_qty: sqlx::types::Decimal,
    total_revenue: sqlx::types::Decimal,
    txn_count: i32,
}

#[derive(FromRow)]
struct ExpenseDbRow {
    category_label: String,
    total_amount: sqlx::types::Decimal,
    txn_count: i32,
    percent_of_total: sqlx::types::Decimal,
}

pub async fn get_analytics_report(
    pool: &PgPool,
    session_token: &str,
    from: Option<Date>,
    to: Option<Date>,
) -> Result<PaperBookAnalyticsPayloadDto, AppError> {
    // 1. Summary
    let sum_row = query_as::<_, AnalyticsSummaryDbRow>(
        "SELECT * FROM paperbook.get_analytics_summary($1, $2, $3)",
    )
    .bind(session_token)
    .bind(from)
    .bind(to)
    .fetch_one(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    let summary = PaperBookAnalyticsSummaryDto {
        sell_total: sum_row.sell_total.to_string(),
        buy_total: sum_row.buy_total.to_string(),
        expense_total: sum_row.expense_total.to_string(),
        benefit_total: sum_row.benefit_total.to_string(),
        net_profit: sum_row.net_profit.to_string(),
        margin_rate: sum_row.margin_rate.to_string(),
        unpaid_sell_total: sum_row.unpaid_sell_total.to_string(),
        unpaid_buy_total: sum_row.unpaid_buy_total.to_string(),
        sell_count: sum_row.sell_count,
        buy_count: sum_row.buy_count,
        expense_count: sum_row.expense_count,
    };

    // 2. Monthly timeline
    let monthly_rows =
        query_as::<_, MonthlyDbRow>("SELECT * FROM paperbook.get_analytics_monthly($1, $2, $3)")
            .bind(session_token)
            .bind(from)
            .bind(to)
            .fetch_all(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    let monthly = monthly_rows
        .into_iter()
        .map(|r| PaperBookMonthlyPointDto {
            year_month: r.year_month,
            month_date: r.month_date.to_string(),
            sell_total: r.sell_total.to_string(),
            buy_total: r.buy_total.to_string(),
            expense_total: r.expense_total.to_string(),
            benefit_total: r.benefit_total.to_string(),
            net_profit: r.net_profit.to_string(),
            unpaid_sell_total: r.unpaid_sell_total.to_string(),
            txn_count: r.txn_count,
        })
        .collect();

    // 3. Top Products
    let prod_rows = query_as::<_, TopProductDbRow>(
        "SELECT * FROM paperbook.get_analytics_top_products($1, $2, $3, 10)",
    )
    .bind(session_token)
    .bind(from)
    .bind(to)
    .fetch_all(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    let top_products = prod_rows
        .into_iter()
        .map(|r| PaperBookTopProductDto {
            product_label: r.product_label,
            total_qty: r.total_qty.to_string(),
            total_revenue: r.total_revenue.to_string(),
            txn_count: r.txn_count,
            avg_price: r.avg_price.to_string(),
        })
        .collect();

    // 4. Top Customers
    let cust_rows = query_as::<_, TopCustomerDbRow>(
        "SELECT * FROM paperbook.get_analytics_top_customers($1, $2, $3, 10)",
    )
    .bind(session_token)
    .bind(from)
    .bind(to)
    .fetch_all(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    let top_customers = cust_rows
        .into_iter()
        .map(|r| PaperBookTopPartyDto {
            party_label: r.customer_label,
            total_amount: r.total_spent.to_string(),
            unpaid_amount: r.unpaid_amount.to_string(),
            txn_count: r.order_count,
        })
        .collect();

    // 5. Top Suppliers
    let supp_rows = query_as::<_, TopSupplierDbRow>(
        "SELECT * FROM paperbook.get_analytics_top_suppliers($1, $2, $3, 10)",
    )
    .bind(session_token)
    .bind(from)
    .bind(to)
    .fetch_all(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    let top_suppliers = supp_rows
        .into_iter()
        .map(|r| PaperBookTopPartyDto {
            party_label: r.supplier_label,
            total_amount: r.total_bought.to_string(),
            unpaid_amount: r.unpaid_amount.to_string(),
            txn_count: r.txn_count,
        })
        .collect();

    // 6. Top Brands
    let brand_rows = query_as::<_, TopBrandDbRow>(
        "SELECT * FROM paperbook.get_analytics_top_brands($1, $2, $3, 10)",
    )
    .bind(session_token)
    .bind(from)
    .bind(to)
    .fetch_all(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    let top_brands = brand_rows
        .into_iter()
        .map(|r| PaperBookTopBrandDto {
            brand_label: r.brand_label,
            total_qty: r.total_qty.to_string(),
            total_revenue: r.total_revenue.to_string(),
            txn_count: r.txn_count,
        })
        .collect();

    // 7. Expense breakdown
    let exp_rows =
        query_as::<_, ExpenseDbRow>("SELECT * FROM paperbook.get_analytics_expenses($1, $2, $3)")
            .bind(session_token)
            .bind(from)
            .bind(to)
            .fetch_all(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    let expenses = exp_rows
        .into_iter()
        .map(|r| PaperBookExpenseCategoryDto {
            category_label: r.category_label,
            total_amount: r.total_amount.to_string(),
            txn_count: r.txn_count,
            percent_of_total: r.percent_of_total.to_string(),
        })
        .collect();

    Ok(PaperBookAnalyticsPayloadDto {
        summary,
        monthly,
        top_products,
        top_customers,
        top_suppliers,
        top_brands,
        expenses,
    })
}
