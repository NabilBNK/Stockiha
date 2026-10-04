//! Workbook parsing and validation into domain transactions.
//! Brief §6.5, §6.6, §6.7.

use calamine::{Data, Range};
use std::collections::HashMap;
use time::Date;

use super::cells::{parse_date, parse_text, parse_whole};
use super::normalize::{clean_text, normalize_key};
use super::reader::InspectedWorkbook;
use super::warnings::compute_warnings;
use super::{
    ImportSummary, ManualSignature, PaperBookIssue, ParsedLine, ParsedTransaction, ParsedWorkbook,
    TransactionType,
};

fn is_cell_blank(cell: &Data) -> bool {
    match cell {
        Data::Empty => true,
        Data::String(s) => clean_text(s).is_none(),
        _ => false,
    }
}

fn is_cell_zero(cell: &Data) -> bool {
    match cell {
        Data::Int(0) => true,
        Data::Float(f) => *f == 0.0,
        Data::String(s) => clean_text(s).as_deref() == Some("0"),
        _ => false,
    }
}

fn has_line_data(row: &[Data]) -> bool {
    // any of F(5), G(6), H(7), I(8), J(9) is non-blank, or K(10) is non-blank and != 0
    let f_non_blank = row.get(5).map(|c| !is_cell_blank(c)).unwrap_or(false);
    let g_non_blank = row.get(6).map(|c| !is_cell_blank(c)).unwrap_or(false);
    let h_non_blank = row.get(7).map(|c| !is_cell_blank(c)).unwrap_or(false);
    let i_non_blank = row.get(8).map(|c| !is_cell_blank(c)).unwrap_or(false);
    let j_non_blank = row.get(9).map(|c| !is_cell_blank(c)).unwrap_or(false);

    let k_has_value = row
        .get(10)
        .map(|c| !is_cell_blank(c) && !is_cell_zero(c))
        .unwrap_or(false);

    f_non_blank || g_non_blank || h_non_blank || i_non_blank || j_non_blank || k_has_value
}

fn is_empty_row(row: &[Data]) -> bool {
    // C(2), B(1), D(3), E(4), L(11), M(12) blank AND no line data
    let b_blank = row.get(1).map(is_cell_blank).unwrap_or(true);
    let c_blank = row.get(2).map(is_cell_blank).unwrap_or(true);
    let d_blank = row.get(3).map(is_cell_blank).unwrap_or(true);
    let e_blank = row.get(4).map(is_cell_blank).unwrap_or(true);
    let l_blank = row.get(11).map(is_cell_blank).unwrap_or(true);
    let m_blank = row.get(12).map(is_cell_blank).unwrap_or(true);

    b_blank && c_blank && d_blank && e_blank && l_blank && m_blank && !has_line_data(row)
}

struct PendingTxn {
    excel_first_row: usize,
    excel_txn_no: Option<String>,
    date: Option<Date>,
    txn_type: Option<TransactionType>,
    is_paid: Option<bool>,
    party_raw: Option<String>,
    party_key: Option<String>,
    benefit: Option<i64>,
    first_row_page: Option<String>,
    lines: Vec<ParsedLine>,
    had_line_error: bool,
    attempted_lines: usize,
}

pub fn parse_and_validate_workbook(
    inspected: InspectedWorkbook,
    go_live_date: Option<Date>,
    today: Date,
    manual_signatures: &[ManualSignature],
    active_batch_count: Option<usize>,
    active_batch_date: Option<&str>,
) -> Result<ParsedWorkbook, Vec<PaperBookIssue>> {
    let mut errors: Vec<PaperBookIssue> = Vec::new();

    // Optional go-live cutoff (if set)

    let range: &Range<Data> = &inspected.range;
    let (row_count, col_count) = range.get_size();

    let mut completed_txns: Vec<ParsedTransaction> = Vec::new();
    let mut current_txn: Option<PendingTxn> = None;

    let finish_pending = |pending: PendingTxn,
                          errors: &mut Vec<PaperBookIssue>,
                          completed: &mut Vec<ParsedTransaction>| {
        let first_row = pending.excel_first_row;
        let txn_no = pending.excel_txn_no.clone();

        if pending.attempted_lines == 0 {
            errors.push(PaperBookIssue {
                row: Some(first_row),
                txn_no: txn_no.clone(),
                column: Some("K".to_string()),
                code: "E_TXN_NO_LINES".to_string(),
                params: HashMap::new(),
            });
            return;
        }

        // If lines had no error, compute total
        if !pending.had_line_error && !pending.lines.is_empty() {
            let total: i64 = pending.lines.iter().map(|l| l.line_total).sum();
            if total == 0 {
                errors.push(PaperBookIssue {
                    row: Some(first_row),
                    txn_no: txn_no.clone(),
                    column: Some("K".to_string()),
                    code: "E_TXN_TOTAL_ZERO".to_string(),
                    params: HashMap::new(),
                });
                return;
            }

            // Resolve page_no: M of first row if non-blank, else first non-blank M among lines
            let page_no = pending
                .first_row_page
                .clone()
                .or_else(|| pending.lines.iter().find_map(|l| l.page_no.clone()));

            if let (Some(date), Some(txn_type), Some(is_paid)) =
                (pending.date, pending.txn_type, pending.is_paid)
            {
                completed.push(ParsedTransaction {
                    excel_first_row: first_row,
                    excel_txn_no: txn_no,
                    date,
                    txn_type,
                    is_paid,
                    party_raw: pending.party_raw,
                    party_key: pending.party_key,
                    benefit: pending.benefit,
                    page_no,
                    note: None,
                    total,
                    lines: pending.lines,
                });
            }
        }
    };

    // Iterate through sheet rows: index 1..row_count (Excel rows 2..=row_count)
    for row_idx in 1..row_count {
        let excel_row = row_idx + 1; // 1-based Excel row number
        let row_cells: Vec<Data> = (0..col_count)
            .map(|c| {
                range
                    .get_value((row_idx as u32, c as u32))
                    .cloned()
                    .unwrap_or(Data::Empty)
            })
            .collect();

        // 1. Skip completely empty rows silently
        if is_empty_row(&row_cells) {
            continue;
        }

        let cell_a = row_cells.first().unwrap_or(&Data::Empty);
        let cell_b = row_cells.get(1).unwrap_or(&Data::Empty);
        let cell_c = row_cells.get(2).unwrap_or(&Data::Empty);
        let cell_d = row_cells.get(3).unwrap_or(&Data::Empty);
        let cell_e = row_cells.get(4).unwrap_or(&Data::Empty);
        let cell_f = row_cells.get(5).unwrap_or(&Data::Empty);
        let cell_g = row_cells.get(6).unwrap_or(&Data::Empty);
        let cell_h = row_cells.get(7).unwrap_or(&Data::Empty);
        let cell_i = row_cells.get(8).unwrap_or(&Data::Empty);
        let cell_j = row_cells.get(9).unwrap_or(&Data::Empty);
        let cell_k = row_cells.get(10).unwrap_or(&Data::Empty);
        let cell_l = row_cells.get(11).unwrap_or(&Data::Empty);
        let cell_m = row_cells.get(12).unwrap_or(&Data::Empty);

        let row_has_line = has_line_data(&row_cells);

        // Check if C is non-blank (opens new transaction)
        if !is_cell_blank(cell_c) {
            // Close previous transaction if any
            if let Some(prev) = current_txn.take() {
                finish_pending(prev, &mut errors, &mut completed_txns);
            }

            // Read Column A for display
            let excel_txn_no = match cell_a {
                Data::String(s) if s.starts_with("TX-") => clean_text(s),
                _ => None,
            };

            // Read Type (C)
            let raw_type_text = parse_text(cell_c).unwrap_or(None).unwrap_or_default();
            let norm_type = normalize_key(&raw_type_text);
            let txn_type = match norm_type.as_deref() {
                Some("sell") => Some(TransactionType::Sell),
                Some("buy") => Some(TransactionType::Buy),
                Some("expense") => Some(TransactionType::Expense),
                _ => {
                    errors.push(PaperBookIssue {
                        row: Some(excel_row),
                        txn_no: excel_txn_no.clone(),
                        column: Some("C".to_string()),
                        code: "E_TYPE_INVALID".to_string(),
                        params: HashMap::new(),
                    });
                    None
                }
            };

            // Read Date (B)
            let date = if is_cell_blank(cell_b) {
                errors.push(PaperBookIssue {
                    row: Some(excel_row),
                    txn_no: excel_txn_no.clone(),
                    column: Some("B".to_string()),
                    code: "E_DATE_MISSING".to_string(),
                    params: HashMap::new(),
                });
                None
            } else {
                match parse_date(cell_b) {
                    Ok(Some(d)) => {
                        if d > today {
                            errors.push(PaperBookIssue {
                                row: Some(excel_row),
                                txn_no: excel_txn_no.clone(),
                                column: Some("B".to_string()),
                                code: "E_DATE_IN_FUTURE".to_string(),
                                params: HashMap::new(),
                            });
                            None
                        } else if let Some(go_live) = go_live_date {
                            if d >= go_live {
                                let mut params = HashMap::new();
                                params.insert("go_live".to_string(), go_live.to_string());
                                errors.push(PaperBookIssue {
                                    row: Some(excel_row),
                                    txn_no: excel_txn_no.clone(),
                                    column: Some("B".to_string()),
                                    code: "E_DATE_AFTER_GO_LIVE".to_string(),
                                    params,
                                });
                                None
                            } else {
                                Some(d)
                            }
                        } else {
                            Some(d)
                        }
                    }
                    _ => {
                        errors.push(PaperBookIssue {
                            row: Some(excel_row),
                            txn_no: excel_txn_no.clone(),
                            column: Some("B".to_string()),
                            code: "E_DATE_INVALID".to_string(),
                            params: HashMap::new(),
                        });
                        None
                    }
                }
            };

            // Read Paid (D)
            let is_paid = if is_cell_blank(cell_d) {
                errors.push(PaperBookIssue {
                    row: Some(excel_row),
                    txn_no: excel_txn_no.clone(),
                    column: Some("D".to_string()),
                    code: "E_PAID_MISSING".to_string(),
                    params: HashMap::new(),
                });
                None
            } else {
                let raw_paid = parse_text(cell_d).unwrap_or(None).unwrap_or_default();
                match normalize_key(&raw_paid).as_deref() {
                    Some("paid") => Some(true),
                    Some("not paid") => Some(false),
                    _ => {
                        errors.push(PaperBookIssue {
                            row: Some(excel_row),
                            txn_no: excel_txn_no.clone(),
                            column: Some("D".to_string()),
                            code: "E_PAID_INVALID".to_string(),
                            params: HashMap::new(),
                        });
                        None
                    }
                }
            };

            // Read Party (E)
            let party_raw = if matches!(cell_e, Data::Error(_)) {
                errors.push(PaperBookIssue {
                    row: Some(excel_row),
                    txn_no: excel_txn_no.clone(),
                    column: Some("E".to_string()),
                    code: "E_CELL_ERROR".to_string(),
                    params: HashMap::new(),
                });
                None
            } else {
                parse_text(cell_e).unwrap_or(None)
            };
            let party_key = party_raw.as_deref().and_then(normalize_key);

            // Read Benefit (L)
            let benefit = if let Some(t) = txn_type {
                if !is_cell_blank(cell_l) {
                    if t != TransactionType::Sell {
                        errors.push(PaperBookIssue {
                            row: Some(excel_row),
                            txn_no: excel_txn_no.clone(),
                            column: Some("L".to_string()),
                            code: "E_BENEFIT_NOT_SELL".to_string(),
                            params: HashMap::new(),
                        });
                        None
                    } else {
                        match parse_whole(cell_l) {
                            Ok(b) => b,
                            Err(code) => {
                                errors.push(PaperBookIssue {
                                    row: Some(excel_row),
                                    txn_no: excel_txn_no.clone(),
                                    column: Some("L".to_string()),
                                    code: code.to_string(),
                                    params: HashMap::new(),
                                });
                                None
                            }
                        }
                    }
                } else {
                    None
                }
            } else {
                None
            };

            // Read Page (M)
            let first_row_page = if matches!(cell_m, Data::Error(_)) {
                errors.push(PaperBookIssue {
                    row: Some(excel_row),
                    txn_no: excel_txn_no.clone(),
                    column: Some("M".to_string()),
                    code: "E_CELL_ERROR".to_string(),
                    params: HashMap::new(),
                });
                None
            } else {
                parse_text(cell_m).unwrap_or(None)
            };

            current_txn = Some(PendingTxn {
                excel_first_row: excel_row,
                excel_txn_no: excel_txn_no.clone(),
                date,
                txn_type,
                is_paid,
                party_raw,
                party_key,
                benefit,
                first_row_page,
                lines: Vec::new(),
                had_line_error: false,
                attempted_lines: 0,
            });
        } else {
            // C is blank: continuation row
            if current_txn.is_none() {
                errors.push(PaperBookIssue {
                    row: Some(excel_row),
                    txn_no: None,
                    column: Some("C".to_string()),
                    code: "E_ORPHAN_LINE".to_string(),
                    params: HashMap::new(),
                });
                continue;
            }

            let pending = current_txn.as_ref().unwrap();
            let txn_no = pending.excel_txn_no.clone();

            // Continuation check: Date (B)
            if !is_cell_blank(cell_b) {
                let differs = match parse_date(cell_b) {
                    Ok(Some(d)) => Some(d) != pending.date,
                    _ => true,
                };
                if differs {
                    errors.push(PaperBookIssue {
                        row: Some(excel_row),
                        txn_no: txn_no.clone(),
                        column: Some("B".to_string()),
                        code: "E_CONTINUATION_DATE_DIFFERS".to_string(),
                        params: HashMap::new(),
                    });
                }
            }

            // Continuation check: Paid (D)
            if !is_cell_blank(cell_d) {
                let differs = match parse_text(cell_d)
                    .unwrap_or(None)
                    .as_deref()
                    .and_then(normalize_key)
                {
                    Some(ref p) if p == "paid" => pending.is_paid != Some(true),
                    Some(ref p) if p == "not paid" => pending.is_paid != Some(false),
                    _ => true,
                };
                if differs {
                    let mut params = HashMap::new();
                    let found_val = parse_text(cell_d).unwrap_or(None).unwrap_or_default();
                    let expected_val = match pending.is_paid {
                        Some(true) => "Paid",
                        Some(false) => "Not Paid",
                        None => "",
                    };
                    params.insert("found".to_string(), found_val);
                    params.insert("expected".to_string(), expected_val.to_string());
                    errors.push(PaperBookIssue {
                        row: Some(excel_row),
                        txn_no: txn_no.clone(),
                        column: Some("D".to_string()),
                        code: "E_CONTINUATION_PAID_DIFFERS".to_string(),
                        params,
                    });
                }
            }

            // Continuation check: Party (E)
            if !is_cell_blank(cell_e) {
                let differs = match parse_text(cell_e)
                    .unwrap_or(None)
                    .as_deref()
                    .and_then(normalize_key)
                {
                    Some(ref k) => pending.party_key.as_deref() != Some(k.as_str()),
                    None => true,
                };
                if differs {
                    let mut params = HashMap::new();
                    let found_val = parse_text(cell_e).unwrap_or(None).unwrap_or_default();
                    let expected_val = pending.party_raw.clone().unwrap_or_default();
                    params.insert("found".to_string(), found_val);
                    params.insert("expected".to_string(), expected_val);
                    errors.push(PaperBookIssue {
                        row: Some(excel_row),
                        txn_no: txn_no.clone(),
                        column: Some("E".to_string()),
                        code: "E_CONTINUATION_PARTY_DIFFERS".to_string(),
                        params,
                    });
                }
            }

            // Continuation check: Benefit (L)
            if !is_cell_blank(cell_l) {
                errors.push(PaperBookIssue {
                    row: Some(excel_row),
                    txn_no: txn_no.clone(),
                    column: Some("L".to_string()),
                    code: "E_BENEFIT_NOT_FIRST_ROW".to_string(),
                    params: HashMap::new(),
                });
            }
        }

        // If this row has line data, add a line to current transaction
        if row_has_line {
            if let Some(pending) = current_txn.as_mut() {
                pending.attempted_lines += 1;
                let txn_no = pending.excel_txn_no.clone();

                // Line level checks in strict order:
                // Stop at first failure for that line
                let mut line_error = false;

                // 1. I (quantity)
                let quantity = if !is_cell_blank(cell_i) {
                    match parse_whole(cell_i) {
                        Ok(Some(q)) if q < 1 => {
                            errors.push(PaperBookIssue {
                                row: Some(excel_row),
                                txn_no: txn_no.clone(),
                                column: Some("I".to_string()),
                                code: "E_QTY_NOT_POSITIVE".to_string(),
                                params: HashMap::new(),
                            });
                            line_error = true;
                            None
                        }
                        Ok(q) => q,
                        Err(code) => {
                            errors.push(PaperBookIssue {
                                row: Some(excel_row),
                                txn_no: txn_no.clone(),
                                column: Some("I".to_string()),
                                code: code.to_string(),
                                params: HashMap::new(),
                            });
                            line_error = true;
                            None
                        }
                    }
                } else {
                    None
                };

                // 2. J (unit price)
                let unit_price = if !line_error && !is_cell_blank(cell_j) {
                    match parse_whole(cell_j) {
                        Ok(Some(p)) if p < 0 => {
                            errors.push(PaperBookIssue {
                                row: Some(excel_row),
                                txn_no: txn_no.clone(),
                                column: Some("J".to_string()),
                                code: "E_AMOUNT_NEGATIVE".to_string(),
                                params: HashMap::new(),
                            });
                            line_error = true;
                            None
                        }
                        Ok(p) => p,
                        Err(code) => {
                            errors.push(PaperBookIssue {
                                row: Some(excel_row),
                                txn_no: txn_no.clone(),
                                column: Some("J".to_string()),
                                code: code.to_string(),
                                params: HashMap::new(),
                            });
                            line_error = true;
                            None
                        }
                    }
                } else {
                    None
                };

                // 3. K (line total)
                let parsed_k = if !line_error && !is_cell_blank(cell_k) {
                    match parse_whole(cell_k) {
                        Ok(Some(t)) if t < 0 => {
                            errors.push(PaperBookIssue {
                                row: Some(excel_row),
                                txn_no: txn_no.clone(),
                                column: Some("K".to_string()),
                                code: "E_AMOUNT_NEGATIVE".to_string(),
                                params: HashMap::new(),
                            });
                            line_error = true;
                            None
                        }
                        Ok(t) => t,
                        Err(code) => {
                            errors.push(PaperBookIssue {
                                row: Some(excel_row),
                                txn_no: txn_no.clone(),
                                column: Some("K".to_string()),
                                code: code.to_string(),
                                params: HashMap::new(),
                            });
                            line_error = true;
                            None
                        }
                    }
                } else {
                    None
                };

                // 4. Amount calculation
                let (line_total, total_overridden) = if !line_error {
                    if let Some(k_val) = parsed_k {
                        let overridden = match (quantity, unit_price) {
                            (Some(q), Some(p)) => k_val != q * p,
                            _ => false,
                        };
                        (Some(k_val), overridden)
                    } else if let (Some(q), Some(p)) = (quantity, unit_price) {
                        (Some(q * p), false)
                    } else {
                        errors.push(PaperBookIssue {
                            row: Some(excel_row),
                            txn_no: txn_no.clone(),
                            column: Some("K".to_string()),
                            code: "E_LINE_AMOUNT_MISSING".to_string(),
                            params: HashMap::new(),
                        });
                        line_error = true;
                        (None, false)
                    }
                } else {
                    (None, false)
                };

                // Check text cell errors on line
                for (col_letter, cell) in
                    [("F", cell_f), ("G", cell_g), ("H", cell_h), ("M", cell_m)]
                {
                    if matches!(cell, Data::Error(_)) {
                        errors.push(PaperBookIssue {
                            row: Some(excel_row),
                            txn_no: txn_no.clone(),
                            column: Some(col_letter.to_string()),
                            code: "E_CELL_ERROR".to_string(),
                            params: HashMap::new(),
                        });
                        line_error = true;
                    }
                }

                if line_error {
                    pending.had_line_error = true;
                } else if let Some(tot) = line_total {
                    let product_raw = parse_text(cell_f).unwrap_or(None);
                    let product_key = product_raw.as_deref().and_then(normalize_key);

                    let brand_raw = parse_text(cell_g).unwrap_or(None);
                    let brand_key = brand_raw.as_deref().and_then(normalize_key);

                    let details_raw = parse_text(cell_h).unwrap_or(None);
                    let details_key = details_raw.as_deref().and_then(normalize_key);

                    let page_no = parse_text(cell_m).unwrap_or(None);

                    let line_no = pending.lines.len() + 1;
                    pending.lines.push(ParsedLine {
                        excel_row,
                        line_no,
                        product_raw,
                        product_key,
                        brand_raw,
                        brand_key,
                        details_raw,
                        details_key,
                        quantity,
                        unit_price,
                        line_total: tot,
                        total_overridden,
                        page_no,
                    });
                }
            }
        }
    }

    // Finish final transaction if any
    if let Some(pending) = current_txn.take() {
        finish_pending(pending, &mut errors, &mut completed_txns);
    }

    if errors.is_empty() && completed_txns.is_empty() {
        errors.push(PaperBookIssue {
            row: None,
            txn_no: None,
            column: None,
            code: "E_NO_TRANSACTIONS".to_string(),
            params: HashMap::new(),
        });
    }

    // If any error exists, import is blocked and NO warnings are computed
    if !errors.is_empty() {
        return Err(errors);
    }

    // Compute warnings only when zero errors
    let warnings = compute_warnings(
        &completed_txns,
        manual_signatures,
        active_batch_count,
        active_batch_date,
    );

    // Build summary
    let mut sell_count = 0;
    let mut buy_count = 0;
    let mut expense_count = 0;
    let mut line_count = 0;
    let mut date_min: Option<Date> = None;
    let mut date_max: Option<Date> = None;
    let mut sell_total: i64 = 0;
    let mut buy_total: i64 = 0;
    let mut expense_total: i64 = 0;
    let mut sell_benefit_total: i64 = 0;
    let mut sells_with_benefit: usize = 0;
    let mut sell_total_with_benefit: i64 = 0;
    let mut sell_not_paid_total: i64 = 0;
    let mut buy_not_paid_total: i64 = 0;
    let mut expense_not_paid_total: i64 = 0;

    for txn in &completed_txns {
        date_min = Some(match date_min {
            Some(m) => m.min(txn.date),
            None => txn.date,
        });
        date_max = Some(match date_max {
            Some(m) => m.max(txn.date),
            None => txn.date,
        });
        line_count += txn.lines.len();

        match txn.txn_type {
            TransactionType::Sell => {
                sell_count += 1;
                sell_total += txn.total;
                if let Some(b) = txn.benefit {
                    sell_benefit_total += b;
                    sells_with_benefit += 1;
                    sell_total_with_benefit += txn.total;
                }
                if !txn.is_paid {
                    sell_not_paid_total += txn.total;
                }
            }
            TransactionType::Buy => {
                buy_count += 1;
                buy_total += txn.total;
                if !txn.is_paid {
                    buy_not_paid_total += txn.total;
                }
            }
            TransactionType::Expense => {
                expense_count += 1;
                expense_total += txn.total;
                if !txn.is_paid {
                    expense_not_paid_total += txn.total;
                }
            }
        }
    }

    let summary = ImportSummary {
        transactions: completed_txns.len(),
        sell: sell_count,
        buy: buy_count,
        expense: expense_count,
        lines: line_count,
        date_min: date_min.map(|d| d.to_string()),
        date_max: date_max.map(|d| d.to_string()),
        sell_total,
        buy_total,
        expense_total,
        sell_benefit_total,
        sells_with_benefit,
        sell_total_with_benefit,
        sell_not_paid_total,
        buy_not_paid_total,
        expense_not_paid_total,
    };

    Ok(ParsedWorkbook {
        file_name: inspected.file_name,
        file_sha256: inspected.file_sha256,
        sheet_name: inspected.sheet_name,
        transactions: completed_txns,
        summary,
        errors,
        warnings,
    })
}
