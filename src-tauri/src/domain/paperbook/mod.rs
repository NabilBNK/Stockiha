//! WS-P-1 Paper Book Domain Module.
//! Pure Rust parsing, normalisation, validation, warnings, and suggestions.
//! Strictly isolated from live business tables.

pub mod cells;
pub mod normalize;
pub mod reader;
pub mod suggest;
pub mod validate;
pub mod warnings;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use time::Date;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TransactionType {
    Sell,
    Buy,
    Expense,
}

impl std::fmt::Display for TransactionType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Sell => write!(f, "sell"),
            Self::Buy => write!(f, "buy"),
            Self::Expense => write!(f, "expense"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PaperBookIssue {
    pub row: Option<usize>,
    pub txn_no: Option<String>,
    pub column: Option<String>,
    pub code: String,
    pub params: HashMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ParsedLine {
    pub excel_row: usize,
    pub line_no: usize,
    pub product_raw: Option<String>,
    pub product_key: Option<String>,
    pub brand_raw: Option<String>,
    pub brand_key: Option<String>,
    pub details_raw: Option<String>,
    pub details_key: Option<String>,
    pub quantity: Option<i64>,
    pub unit_price: Option<i64>,
    pub line_total: i64,
    pub total_overridden: bool,
    pub page_no: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ParsedTransaction {
    pub excel_first_row: usize,
    pub excel_txn_no: Option<String>,
    pub date: Date,
    pub txn_type: TransactionType,
    pub is_paid: bool,
    pub party_raw: Option<String>,
    pub party_key: Option<String>,
    pub benefit: Option<i64>,
    pub page_no: Option<String>,
    pub note: Option<String>,
    pub total: i64,
    pub lines: Vec<ParsedLine>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ManualSignature {
    pub id: i64,
    pub date: Date,
    pub txn_type: TransactionType,
    pub total: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ImportSummary {
    pub transactions: usize,
    pub sell: usize,
    pub buy: usize,
    pub expense: usize,
    pub lines: usize,
    pub date_min: Option<String>,
    pub date_max: Option<String>,
    pub sell_total: i64,
    pub buy_total: i64,
    pub expense_total: i64,
    pub sell_benefit_total: i64,
    pub sells_with_benefit: usize,
    pub sell_total_with_benefit: i64,
    pub sell_not_paid_total: i64,
    pub buy_not_paid_total: i64,
    pub expense_not_paid_total: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ParsedWorkbook {
    pub file_name: String,
    pub file_sha256: String,
    pub sheet_name: String,
    pub transactions: Vec<ParsedTransaction>,
    pub summary: ImportSummary,
    pub errors: Vec<PaperBookIssue>,
    pub warnings: Vec<PaperBookIssue>,
}
