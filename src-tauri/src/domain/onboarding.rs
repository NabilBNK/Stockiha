use serde::{Deserialize, Serialize};
use time::{Date, Month};

const REQUEST_ID_MIN_LEN: usize = 8;
const REQUEST_ID_MAX_LEN: usize = 128;
const PAPER_ID_MAX_LEN: usize = 128;
const DESCRIPTION_MAX_LEN: usize = 500;
const OPTIONAL_TEXT_MAX_LEN: usize = 500;
const FILENAME_MAX_LEN: usize = 255;
const MAX_TRANSACTION_ROWS_PER_REQUEST: usize = 10_000;
const MAX_BALANCE_ROWS_PER_REQUEST: usize = 5_000;

const TRANSACTION_TYPES: &[&str] = &[
    "SALE",
    "PURCHASE",
    "EXPENSE",
    "OTHER_INCOME",
    "CUSTOMER_REFUND",
    "SUPPLIER_REFUND",
    "LOAN_RECEIVED",
    "LOAN_REPAYMENT",
    "OWNER_CONTRIBUTION",
    "OWNER_WITHDRAWAL",
    "TAX_PAYMENT",
    "SALARY",
    "OTHER",
];

const PAYMENT_STATUSES: &[&str] = &["PAID", "UNPAID", "PARTIAL", "UNKNOWN"];
const REVIEW_STATUSES: &[&str] = &["READY", "NEEDS_REVIEW", "APPROVED", "REJECTED"];
const BALANCE_TYPES: &[&str] = &[
    "OPENING_CASH",
    "CLOSING_CASH",
    "OPENING_BANK",
    "CLOSING_BANK",
    "OPENING_INVENTORY_VALUE",
    "CLOSING_INVENTORY_VALUE",
    "CUSTOMER_RECEIVABLE",
    "SUPPLIER_PAYABLE",
    "LOAN_BALANCE",
    "TAX_PAYABLE",
    "OWNER_CAPITAL",
    "OTHER",
];

/// Maximum digits accepted in an exact-decimal amount string, so a hostile or
/// corrupt workbook cannot push an unbounded literal into PostgreSQL.
const DECIMAL_TEXT_MAX_LEN: usize = 30;

/// Validates that a value carried across the IPC boundary is an exact whole
/// decimal written as text (for example `"19880510"` or `"-4000"`).
///
/// Money and quantity are never deserialised into an `f64` or an `i64` here:
/// the exact characters read from the workbook are passed through to
/// PostgreSQL, which does the arithmetic in `numeric`/`bigint`.
fn validate_exact_whole_decimal(
    value: &Option<String>,
    field: &str,
    allow_negative: bool,
) -> Result<(), String> {
    let Some(raw) = value.as_deref() else {
        return Ok(());
    };
    let text = raw.trim();
    if text.is_empty() {
        return Err(format!("{field} must not be blank; omit it instead"));
    }
    if text.len() > DECIMAL_TEXT_MAX_LEN {
        return Err(format!(
            "{field} must be at most {DECIMAL_TEXT_MAX_LEN} characters"
        ));
    }
    let (sign, digits) = match text.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, text),
    };
    if sign && !allow_negative {
        return Err(format!("{field} must not be negative"));
    }
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return Err(format!(
            "{field} must be a whole DZD amount written in digits"
        ));
    }
    if digits.len() > 1 && digits.starts_with('0') {
        return Err(format!("{field} must not carry leading zeros"));
    }
    Ok(())
}

/// True when an exact-decimal string is greater than zero. Pure text
/// inspection: no numeric conversion takes place.
fn is_positive_decimal_text(value: &str) -> bool {
    let text = value.trim();
    !text.starts_with('-') && text.bytes().any(|b| b.is_ascii_digit() && b != b'0')
}

fn validate_request_id(request_id: &str) -> Result<(), String> {
    let request_id = request_id.trim();
    if !(REQUEST_ID_MIN_LEN..=REQUEST_ID_MAX_LEN).contains(&request_id.len()) {
        return Err(format!(
            "requestId length must be between {REQUEST_ID_MIN_LEN} and {REQUEST_ID_MAX_LEN} characters"
        ));
    }
    if request_id.chars().any(char::is_control) {
        return Err("requestId must not contain control characters".to_string());
    }
    Ok(())
}

fn validate_optional_text(
    value: &Option<String>,
    field: &str,
    max_len: usize,
) -> Result<(), String> {
    if let Some(value) = value {
        let value = value.trim();
        if value.is_empty() || value.len() > max_len || value.chars().any(char::is_control) {
            return Err(format!(
                "{field} is empty, too long, or contains control characters"
            ));
        }
    }
    Ok(())
}

pub(crate) fn parse_iso_date(value: &str, field: &str) -> Result<Date, String> {
    let parts: Vec<&str> = value.trim().split('-').collect();
    if parts.len() != 3 {
        return Err(format!("{field} must use YYYY-MM-DD"));
    }

    let year: i32 = parts[0]
        .parse()
        .map_err(|_| format!("{field} has an invalid year"))?;
    let month_number: u8 = parts[1]
        .parse()
        .map_err(|_| format!("{field} has an invalid month"))?;
    let day: u8 = parts[2]
        .parse()
        .map_err(|_| format!("{field} has an invalid day"))?;
    let month =
        Month::try_from(month_number).map_err(|_| format!("{field} has an invalid month"))?;

    Date::from_calendar_date(year, month, day)
        .map_err(|_| format!("{field} is not a valid calendar date"))
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateHistoricalFinanceSettingRequest {
    pub(crate) enabled: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoricalFinanceSettingResult {
    pub(crate) enabled: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateInventoryCorrectionsSettingRequest {
    pub(crate) enabled: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InventoryCorrectionsSettingResult {
    pub(crate) enabled: bool,
    pub(crate) can_update: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateHistoricalFinanceBatchRequest {
    pub(crate) request_id: String,
    pub(crate) source_type: String,
    pub(crate) original_filename: Option<String>,
}

impl CreateHistoricalFinanceBatchRequest {
    pub(crate) fn validate(&self) -> Result<(), String> {
        validate_request_id(&self.request_id)?;

        let source_type = self.source_type.trim().to_ascii_uppercase();
        if !matches!(source_type.as_str(), "EXCEL" | "MANUAL") {
            return Err("sourceType must be EXCEL or MANUAL".to_string());
        }

        match (source_type.as_str(), self.original_filename.as_ref()) {
            ("EXCEL", Some(filename)) => {
                let filename = filename.trim();
                if filename.is_empty()
                    || filename.len() > FILENAME_MAX_LEN
                    || filename.chars().any(char::is_control)
                    || filename.contains('/')
                    || filename.contains('\\')
                    || !filename.to_ascii_lowercase().ends_with(".xlsx")
                {
                    return Err("originalFilename must be a safe .xlsx filename".to_string());
                }
            }
            ("EXCEL", None) => {
                return Err("Excel batches require originalFilename".to_string());
            }
            ("MANUAL", Some(_)) => {
                return Err("Manual batches must not include originalFilename".to_string());
            }
            ("MANUAL", None) => {}
            _ => unreachable!(),
        }

        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoricalFinanceBatchResult {
    pub(crate) batch_id: i64,
    pub(crate) status: String,
    pub(crate) is_replay: bool,
    pub(crate) source_type: String,
    pub(crate) original_filename: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoricalFinanceRowInput {
    pub(crate) source_row_number: i32,
    pub(crate) paper_id: String,
    pub(crate) transaction_date: String,
    pub(crate) transaction_type: String,
    pub(crate) description_or_category: String,
    pub(crate) net_amount_dzd: i64,
    pub(crate) payment_status: String,
    pub(crate) amount_paid_dzd: Option<i64>,
    pub(crate) expense_category: Option<String>,
    pub(crate) supplier_fournisseur: Option<String>,
    pub(crate) customer_client: Option<String>,
    pub(crate) notes: Option<String>,
    pub(crate) review_status: String,
}

impl HistoricalFinanceRowInput {
    fn validate(&self) -> Result<(), String> {
        if self.source_row_number < 2 {
            return Err("sourceRowNumber must be at least 2".to_string());
        }

        let paper_id = self.paper_id.trim();
        if paper_id.is_empty()
            || paper_id.len() > PAPER_ID_MAX_LEN
            || paper_id.chars().any(char::is_control)
        {
            return Err("paperId is empty, too long, or contains control characters".to_string());
        }

        parse_iso_date(&self.transaction_date, "transactionDate")?;

        let transaction_type = self.transaction_type.trim().to_ascii_uppercase();
        if !TRANSACTION_TYPES.contains(&transaction_type.as_str()) {
            return Err("transactionType is unsupported".to_string());
        }

        let description = self.description_or_category.trim();
        if description.is_empty()
            || description.len() > DESCRIPTION_MAX_LEN
            || description.chars().any(char::is_control)
        {
            return Err(
                "descriptionOrCategory is empty, too long, or contains control characters"
                    .to_string(),
            );
        }

        if self.net_amount_dzd <= 0 {
            return Err("netAmountDzd must be greater than zero".to_string());
        }
        if self.amount_paid_dzd.is_some_and(|value| value < 0) {
            return Err("amountPaidDzd must not be negative".to_string());
        }

        let payment_status = self.payment_status.trim().to_ascii_uppercase();
        if !PAYMENT_STATUSES.contains(&payment_status.as_str()) {
            return Err("paymentStatus is unsupported".to_string());
        }

        let review_status = self.review_status.trim().to_ascii_uppercase();
        if !REVIEW_STATUSES.contains(&review_status.as_str()) {
            return Err("reviewStatus is unsupported".to_string());
        }

        validate_optional_text(
            &self.expense_category,
            "expenseCategory",
            OPTIONAL_TEXT_MAX_LEN,
        )?;
        validate_optional_text(
            &self.supplier_fournisseur,
            "supplierFournisseur",
            OPTIONAL_TEXT_MAX_LEN,
        )?;
        validate_optional_text(
            &self.customer_client,
            "customerClient",
            OPTIONAL_TEXT_MAX_LEN,
        )?;
        validate_optional_text(&self.notes, "notes", OPTIONAL_TEXT_MAX_LEN)?;

        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoricalFinanceBalanceInput {
    pub(crate) source_row_number: i32,
    pub(crate) balance_date: String,
    pub(crate) balance_type: String,
    pub(crate) amount_dzd: i64,
    pub(crate) supplier_fournisseur: Option<String>,
    pub(crate) customer_client: Option<String>,
    pub(crate) notes: Option<String>,
    pub(crate) review_status: String,
}

impl HistoricalFinanceBalanceInput {
    fn validate(&self) -> Result<(), String> {
        if self.source_row_number < 2 {
            return Err("balance sourceRowNumber must be at least 2".to_string());
        }

        parse_iso_date(&self.balance_date, "balanceDate")?;

        let balance_type = self.balance_type.trim().to_ascii_uppercase();
        if !BALANCE_TYPES.contains(&balance_type.as_str()) {
            return Err("balanceType is unsupported".to_string());
        }
        if self.amount_dzd < 0 {
            return Err("balance amountDzd must not be negative".to_string());
        }

        let review_status = self.review_status.trim().to_ascii_uppercase();
        if !REVIEW_STATUSES.contains(&review_status.as_str()) {
            return Err("balance reviewStatus is unsupported".to_string());
        }

        validate_optional_text(
            &self.supplier_fournisseur,
            "supplierFournisseur",
            OPTIONAL_TEXT_MAX_LEN,
        )?;
        validate_optional_text(
            &self.customer_client,
            "customerClient",
            OPTIONAL_TEXT_MAX_LEN,
        )?;
        validate_optional_text(&self.notes, "notes", OPTIONAL_TEXT_MAX_LEN)?;

        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReplaceHistoricalFinanceBatchDataRequest {
    pub(crate) batch_id: i64,
    pub(crate) rows: Vec<HistoricalFinanceRowInput>,
    pub(crate) balances: Vec<HistoricalFinanceBalanceInput>,
}

impl ReplaceHistoricalFinanceBatchDataRequest {
    pub(crate) fn validate(&self) -> Result<(), String> {
        if self.batch_id <= 0 {
            return Err("batchId must be positive".to_string());
        }
        if self.rows.len() > MAX_TRANSACTION_ROWS_PER_REQUEST {
            return Err(format!(
                "A request may contain at most {MAX_TRANSACTION_ROWS_PER_REQUEST} transaction rows"
            ));
        }
        if self.balances.len() > MAX_BALANCE_ROWS_PER_REQUEST {
            return Err(format!(
                "A request may contain at most {MAX_BALANCE_ROWS_PER_REQUEST} balance rows"
            ));
        }

        for (index, row) in self.rows.iter().enumerate() {
            row.validate()
                .map_err(|error| format!("rows[{index}]: {error}"))?;
        }
        for (index, balance) in self.balances.iter().enumerate() {
            balance
                .validate()
                .map_err(|error| format!("balances[{index}]: {error}"))?;
        }

        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoricalFinanceBatchDataResult {
    pub(crate) batch_id: i64,
    pub(crate) status: String,
    pub(crate) transaction_row_count: i64,
    pub(crate) balance_row_count: i64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoricalFinanceBatchIdRequest {
    pub(crate) batch_id: i64,
}

impl HistoricalFinanceBatchIdRequest {
    pub(crate) fn validate(&self) -> Result<(), String> {
        if self.batch_id <= 0 {
            return Err("batchId must be positive".to_string());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoricalFinanceValidationResult {
    pub(crate) batch_id: i64,
    pub(crate) status: String,
    pub(crate) row_count: i64,
    pub(crate) invalid_row_count: i64,
    pub(crate) total_sales_dzd: i64,
    pub(crate) total_purchases_dzd: i64,
    pub(crate) total_expenses_dzd: i64,
    pub(crate) total_other_income_dzd: i64,
    pub(crate) total_customer_refunds_dzd: i64,
    pub(crate) total_supplier_refunds_dzd: i64,
    pub(crate) preliminary_result_before_inventory_dzd: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoricalFinanceApprovalResult {
    pub(crate) batch_id: i64,
    pub(crate) status: String,
    pub(crate) is_replay: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoricalFinanceSummaryRequest {
    pub(crate) date_from: String,
    pub(crate) date_to: String,
}

impl HistoricalFinanceSummaryRequest {
    pub(crate) fn validate(&self) -> Result<(), String> {
        let from = parse_iso_date(&self.date_from, "dateFrom")?;
        let to = parse_iso_date(&self.date_to, "dateTo")?;
        if from > to {
            return Err("dateFrom must not be after dateTo".to_string());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoricalFinanceSummaryResult {
    pub(crate) date_from: String,
    pub(crate) date_to: String,
    pub(crate) sales_dzd: i64,
    pub(crate) purchases_dzd: i64,
    pub(crate) expenses_dzd: i64,
    pub(crate) other_income_dzd: i64,
    pub(crate) customer_refunds_dzd: i64,
    pub(crate) supplier_refunds_dzd: i64,
    pub(crate) preliminary_result_before_inventory_dzd: i64,
    pub(crate) opening_inventory_dzd: Option<i64>,
    pub(crate) closing_inventory_dzd: Option<i64>,
    pub(crate) inventory_data_complete: bool,
    pub(crate) estimated_profit_loss_dzd: Option<i64>,
    pub(crate) profit_calculation_status: String,
}

// --- R0-002 Paper-Book Domain Types ---

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateHistoricalTradeBatchRequest {
    pub(crate) request_id: String,
    pub(crate) original_filename: String,
    pub(crate) content_hash: Option<String>,
    pub(crate) import_profile: Option<String>,
}

impl CreateHistoricalTradeBatchRequest {
    pub(crate) fn validate(&self) -> Result<(), String> {
        validate_request_id(&self.request_id)?;
        let filename = self.original_filename.trim();
        if filename.is_empty()
            || filename.len() > FILENAME_MAX_LEN
            || filename.chars().any(char::is_control)
            || filename.contains('/')
            || filename.contains('\\')
            || !filename.to_ascii_lowercase().ends_with(".xlsx")
        {
            return Err("originalFilename must be a safe .xlsx filename".to_string());
        }
        if let Some(profile) = &self.import_profile {
            let profile = profile.trim().to_ascii_uppercase();
            if !matches!(profile.as_str(), "PAPER_BOOK_V1" | "PAPER_BOOK_V2") {
                return Err("importProfile must be PAPER_BOOK_V1 or PAPER_BOOK_V2".to_string());
            }
        }
        if let Some(hash) = &self.content_hash {
            let hash = hash.trim();
            if !hash.is_empty()
                && (hash.len() != 64 || hash.chars().any(|c| !c.is_ascii_hexdigit()))
            {
                return Err("contentHash must be a valid SHA-256 hex string".to_string());
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoricalTradeBatchResult {
    pub(crate) batch_id: i64,
    pub(crate) status: String,
    pub(crate) is_replay: bool,
    pub(crate) import_profile: String,
    pub(crate) original_filename: String,
    pub(crate) content_hash: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoricalTradeLineInput {
    pub(crate) source_row_number: i32,
    pub(crate) line_sequence: i32,
    pub(crate) product_name: Option<String>,
    pub(crate) brand: Option<String>,
    pub(crate) custom_details: Option<String>,
    pub(crate) party_company: Option<String>,
    /// Exact decimal string, signed. `None` means the paper left it blank.
    pub(crate) manual_benefit_dzd: Option<String>,
    /// Exact decimal string. `None` means the paper left it blank.
    pub(crate) quantity: Option<String>,
    /// Exact decimal string. `None` means the paper left it blank.
    pub(crate) unit_price_dzd: Option<String>,
    /// Exact decimal string taken from column K. `None` means column K is empty.
    pub(crate) manual_line_total_dzd: Option<String>,
}

impl HistoricalTradeLineInput {
    fn validate(&self) -> Result<(), String> {
        if self.source_row_number < 2 {
            return Err("sourceRowNumber must be at least 2".to_string());
        }
        if self.line_sequence < 1 {
            return Err("lineSequence must be at least 1".to_string());
        }
        validate_exact_whole_decimal(&self.unit_price_dzd, "unitPriceDzd", false)?;
        validate_exact_whole_decimal(&self.quantity, "quantity", false)?;
        validate_exact_whole_decimal(&self.manual_line_total_dzd, "manualLineTotalDzd", false)?;
        validate_exact_whole_decimal(&self.manual_benefit_dzd, "manualBenefitDzd", true)?;

        if let Some(qty) = self.quantity.as_deref() {
            if !is_positive_decimal_text(qty) {
                return Err("quantity must be positive".to_string());
            }
        }
        if self.quantity.is_none()
            && self.unit_price_dzd.is_none()
            && self.manual_line_total_dzd.is_none()
        {
            return Err("line must have quantity/unit price or manualLineTotalDzd".to_string());
        }
        validate_optional_text(&self.product_name, "productName", OPTIONAL_TEXT_MAX_LEN)?;
        validate_optional_text(&self.brand, "brand", OPTIONAL_TEXT_MAX_LEN)?;
        validate_optional_text(&self.custom_details, "customDetails", OPTIONAL_TEXT_MAX_LEN)?;
        validate_optional_text(&self.party_company, "partyCompany", OPTIONAL_TEXT_MAX_LEN)?;
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoricalTradeTransactionInput {
    pub(crate) source_transaction_sequence: i32,
    pub(crate) source_first_excel_row: i32,
    pub(crate) source_excel_txn_ref: Option<String>,
    pub(crate) transaction_date: String,
    pub(crate) transaction_type: String,
    pub(crate) payment_status: String,
    pub(crate) party_company: Option<String>,
    /// Exact decimal string, signed. `None` means the benefit is unknown, which
    /// is not the same as a recorded zero.
    pub(crate) manual_benefit_dzd: Option<String>,
    /// Exact whole-number string. `None` means no page number was written.
    pub(crate) page_number: Option<String>,
    pub(crate) lines: Vec<HistoricalTradeLineInput>,
}

impl HistoricalTradeTransactionInput {
    fn validate(&self) -> Result<(), String> {
        if self.source_transaction_sequence < 1 {
            return Err("sourceTransactionSequence must be at least 1".to_string());
        }
        if self.source_first_excel_row < 2 {
            return Err("sourceFirstExcelRow must be at least 2".to_string());
        }
        parse_iso_date(&self.transaction_date, "transactionDate")?;

        let txn_type = self.transaction_type.trim().to_ascii_uppercase();
        if !matches!(txn_type.as_str(), "SALE" | "PURCHASE" | "EXPENSE") {
            return Err("transactionType must be SALE, PURCHASE, or EXPENSE".to_string());
        }

        if txn_type != "SALE" && self.manual_benefit_dzd.is_some() {
            return Err("manualBenefitDzd is only allowed for SALE transactions".to_string());
        }
        validate_exact_whole_decimal(&self.manual_benefit_dzd, "manualBenefitDzd", true)?;
        validate_exact_whole_decimal(&self.page_number, "pageNumber", false)?;

        let payment = self.payment_status.trim().to_ascii_uppercase();
        if !matches!(payment.as_str(), "PAID" | "UNPAID") {
            return Err("paymentStatus must be PAID or UNPAID".to_string());
        }

        if let Some(page) = self.page_number.as_deref() {
            if !is_positive_decimal_text(page) {
                return Err("pageNumber must be positive".to_string());
            }
        }

        if self.lines.is_empty() {
            return Err("transaction must contain at least one line".to_string());
        }

        validate_optional_text(&self.party_company, "partyCompany", OPTIONAL_TEXT_MAX_LEN)?;

        for (idx, line) in self.lines.iter().enumerate() {
            line.validate()
                .map_err(|err| format!("lines[{idx}]: {err}"))?;
        }

        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReplaceHistoricalTradeBatchDataRequest {
    pub(crate) batch_id: i64,
    pub(crate) transactions: Vec<HistoricalTradeTransactionInput>,
}

impl ReplaceHistoricalTradeBatchDataRequest {
    pub(crate) fn validate(&self) -> Result<(), String> {
        if self.batch_id <= 0 {
            return Err("batchId must be positive".to_string());
        }
        if self.transactions.len() > MAX_TRANSACTION_ROWS_PER_REQUEST {
            return Err(format!(
                "A request may contain at most {MAX_TRANSACTION_ROWS_PER_REQUEST} transactions"
            ));
        }

        for (idx, txn) in self.transactions.iter().enumerate() {
            txn.validate()
                .map_err(|err| format!("transactions[{idx}]: {err}"))?;
        }

        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoricalTradeBatchDataResult {
    pub(crate) batch_id: i64,
    pub(crate) status: String,
    pub(crate) transaction_count: i64,
    pub(crate) line_count: i64,
    pub(crate) unmatched_product_count: i64,
    pub(crate) override_count: i64,
    pub(crate) missing_qty_count: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoricalTradeValidationResult {
    pub(crate) batch_id: i64,
    pub(crate) status: String,
    pub(crate) transaction_count: i64,
    pub(crate) line_count: i64,
    pub(crate) invalid_row_count: i64,
    pub(crate) total_sales_dzd: i64,
    pub(crate) total_purchases_dzd: i64,
    pub(crate) paid_sales_dzd: i64,
    pub(crate) unpaid_sales_dzd: i64,
    pub(crate) paid_purchases_dzd: i64,
    pub(crate) unpaid_purchases_dzd: i64,
    pub(crate) unmatched_product_count: i64,
    pub(crate) override_count: i64,
    pub(crate) missing_qty_count: i64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoricalTradeAnalyticsRequest {
    pub(crate) date_from: String,
    pub(crate) date_to: String,
}

impl HistoricalTradeAnalyticsRequest {
    pub(crate) fn validate(&self) -> Result<(), String> {
        let from = parse_iso_date(&self.date_from, "dateFrom")?;
        let to = parse_iso_date(&self.date_to, "dateTo")?;
        if from > to {
            return Err("dateFrom must not be after dateTo".to_string());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_row() -> HistoricalFinanceRowInput {
        HistoricalFinanceRowInput {
            source_row_number: 2,
            paper_id: "PAPER-000001".to_string(),
            transaction_date: "2025-01-10".to_string(),
            transaction_type: "SALE".to_string(),
            description_or_category: "Historical sale".to_string(),
            net_amount_dzd: 100_000,
            payment_status: "PAID".to_string(),
            amount_paid_dzd: Some(100_000),
            expense_category: None,
            supplier_fournisseur: None,
            customer_client: Some("Customer A".to_string()),
            notes: None,
            review_status: "READY".to_string(),
        }
    }

    #[test]
    fn accepts_minimal_excel_batch_request() {
        let request = CreateHistoricalFinanceBatchRequest {
            request_id: "historical-20260804-001".to_string(),
            source_type: "EXCEL".to_string(),
            original_filename: Some("historical.xlsx".to_string()),
        };
        assert!(request.validate().is_ok());
    }

    #[test]
    fn rejects_excel_path_instead_of_filename() {
        let request = CreateHistoricalFinanceBatchRequest {
            request_id: "historical-20260804-001".to_string(),
            source_type: "EXCEL".to_string(),
            original_filename: Some(r"C:\private\historical.xlsx".to_string()),
        };
        assert!(request.validate().is_err());
    }

    #[test]
    fn rejects_invalid_calendar_date() {
        let mut row = valid_row();
        row.transaction_date = "2025-02-30".to_string();
        assert!(row.validate().is_err());
    }

    #[test]
    fn rejects_nonpositive_finance_amount() {
        let mut row = valid_row();
        row.net_amount_dzd = 0;
        assert!(row.validate().is_err());
    }

    #[test]
    fn accepts_valid_summary_period() {
        assert!(HistoricalFinanceSummaryRequest {
            date_from: "2025-01-01".to_string(),
            date_to: "2026-06-30".to_string(),
        }
        .validate()
        .is_ok());
    }

    #[test]
    fn parses_inventory_corrections_policy_capability() {
        let result: InventoryCorrectionsSettingResult = serde_json::from_value(serde_json::json!({
            "enabled": true,
            "canUpdate": false,
        }))
        .unwrap();

        assert!(result.enabled);
        assert!(!result.can_update);
    }
    #[test]
    fn accepts_exact_decimal_strings_and_rejects_floats_or_junk() {
        // Money and quantity cross the IPC boundary as exact decimal text.
        assert!(
            validate_exact_whole_decimal(&Some("19880510".to_string()), "total", false).is_ok()
        );
        assert!(validate_exact_whole_decimal(&Some("0".to_string()), "benefit", true).is_ok());
        assert!(validate_exact_whole_decimal(&Some("-4000".to_string()), "benefit", true).is_ok());
        assert!(validate_exact_whole_decimal(&None, "benefit", true).is_ok());

        assert!(validate_exact_whole_decimal(&Some("-4000".to_string()), "total", false).is_err());
        assert!(validate_exact_whole_decimal(&Some("4000.5".to_string()), "total", false).is_err());
        assert!(validate_exact_whole_decimal(&Some("1e5".to_string()), "total", false).is_err());
        assert!(validate_exact_whole_decimal(&Some("007".to_string()), "total", false).is_err());
        assert!(validate_exact_whole_decimal(&Some("".to_string()), "total", false).is_err());
        assert!(validate_exact_whole_decimal(&Some("1".repeat(31)), "total", false).is_err());
    }

    #[test]
    fn recognises_a_positive_amount_without_numeric_conversion() {
        assert!(is_positive_decimal_text("12"));
        assert!(is_positive_decimal_text("100800"));
        assert!(!is_positive_decimal_text("0"));
        assert!(!is_positive_decimal_text("000"));
        assert!(!is_positive_decimal_text("-5"));
    }

    #[test]
    fn rejects_a_trade_line_whose_quantity_is_not_a_whole_positive_amount() {
        let line = HistoricalTradeLineInput {
            source_row_number: 3,
            line_sequence: 1,
            product_name: Some("couette".to_string()),
            brand: None,
            custom_details: Some("1.6".to_string()),
            party_company: None,
            manual_benefit_dzd: None,
            quantity: Some("0".to_string()),
            unit_price_dzd: Some("9200".to_string()),
            manual_line_total_dzd: Some("110400".to_string()),
        };
        assert!(line.validate().is_err());

        let ok = HistoricalTradeLineInput {
            quantity: Some("12".to_string()),
            ..line
        };
        assert!(ok.validate().is_ok());
    }
}
