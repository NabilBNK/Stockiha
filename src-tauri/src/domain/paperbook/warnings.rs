//! Warnings calculation for Paper Book workbook (computed only when zero errors exist).
//! Brief §6.7 & §16.1 item 5, 6.

use std::collections::HashMap;
use time::Date;

use super::{ManualSignature, PaperBookIssue, ParsedTransaction, TransactionType};

/// Format an Algerian date as DD/MM/YYYY for messages.
fn format_date(d: Date) -> String {
    format!("{:02}/{:02}/{}", d.day(), d.month() as u8, d.year())
}

/// Calculate non-blocking warnings for a successfully parsed list of transactions.
pub fn compute_warnings(
    txns: &[ParsedTransaction],
    manual_signatures: &[ManualSignature],
    active_batch_count: Option<usize>,
    active_batch_date: Option<&str>,
) -> Vec<PaperBookIssue> {
    let mut warnings = Vec::new();

    // 1. File-level warning: W_FEWER_THAN_CURRENT
    if let (Some(current_count), Some(current_date)) = (active_batch_count, active_batch_date) {
        if txns.len() < current_count {
            let mut params = HashMap::new();
            params.insert("file_count".to_string(), txns.len().to_string());
            params.insert("current_count".to_string(), current_count.to_string());
            params.insert("current_date".to_string(), current_date.to_string());
            warnings.push(PaperBookIssue {
                row: None,
                txn_no: None,
                column: None,
                code: "W_FEWER_THAN_CURRENT".to_string(),
                params,
            });
        }
    }

    // 2. Price grouping for W_PRICE_UNUSUAL
    // Group lines by (type, product_key, brand_key, details_key)
    type GroupKey = (TransactionType, String, Option<String>, Option<String>);
    let mut price_groups: HashMap<GroupKey, Vec<i64>> = HashMap::new();

    for txn in txns {
        for line in &txn.lines {
            if let (Some(prod_key), Some(unit_price)) = (&line.product_key, line.unit_price) {
                let key = (
                    txn.txn_type,
                    prod_key.clone(),
                    line.brand_key.clone(),
                    line.details_key.clone(),
                );
                price_groups.entry(key).or_default().push(unit_price);
            }
        }
    }

    // Calculate median for groups with >= 3 lines
    // Median is represented as (2 * median) to allow exact integer math without floating point
    let mut group_double_medians: HashMap<GroupKey, i64> = HashMap::new();
    for (key, mut prices) in price_groups {
        if prices.len() >= 3 {
            prices.sort_unstable();
            let n = prices.len();
            let double_median = if n % 2 == 1 {
                prices[n / 2] * 2
            } else {
                prices[n / 2 - 1] + prices[n / 2]
            };
            group_double_medians.insert(key, double_median);
        }
    }

    // Iterate through transactions in row order
    for (i, txn) in txns.iter().enumerate() {
        let first_row = txn.excel_first_row;
        let txn_no = txn.excel_txn_no.clone();

        // 3. W_DATE_OUT_OF_ORDER (first row)
        // Compare with prev and next transaction in row order
        let date = txn.date;
        let prev_date = if i > 0 { Some(txns[i - 1].date) } else { None };
        let next_date = if i + 1 < txns.len() {
            Some(txns[i + 1].date)
        } else {
            None
        };

        let is_out_of_order = match (prev_date, next_date) {
            (Some(prev), Some(next)) => {
                let prev_diff = (date - prev).whole_days();
                let next_diff = (date - next).whole_days();
                // Earlier than all neighbours by > 7 days
                (prev_diff < -7 && next_diff < -7)
                // Or later than all neighbours by > 7 days
                || (prev_diff > 7 && next_diff > 7)
            }
            (Some(prev), None) => {
                let diff = (date - prev).whole_days();
                diff.abs() > 7
            }
            (None, Some(next)) => {
                let diff = (date - next).whole_days();
                diff.abs() > 7
            }
            (None, None) => false,
        };

        if is_out_of_order {
            let mut params = HashMap::new();
            params.insert("date".to_string(), format_date(date));
            if let Some(prev) = prev_date {
                params.insert("prev".to_string(), format_date(prev));
            }
            if let Some(next) = next_date {
                params.insert("next".to_string(), format_date(next));
            }
            warnings.push(PaperBookIssue {
                row: Some(first_row),
                txn_no: txn_no.clone(),
                column: Some("B".to_string()),
                code: "W_DATE_OUT_OF_ORDER".to_string(),
                params,
            });
        }

        // 4. Line-level warnings (sorted by line's excel_row)
        for line in &txn.lines {
            let line_row = line.excel_row;

            // W_PRICE_UNUSUAL
            if let (Some(prod_key), Some(unit_price)) = (&line.product_key, line.unit_price) {
                let key = (
                    txn.txn_type,
                    prod_key.clone(),
                    line.brand_key.clone(),
                    line.details_key.clone(),
                );
                if let Some(&double_median) = group_double_medians.get(&key) {
                    if double_median > 0 {
                        // Warn when |price − median| × 100 > 25 × median
                        // Scaled by 2: |2 * price - 2 * median| * 100 > 25 * (2 * median)
                        let diff_double = (2 * unit_price - double_median).abs();
                        if diff_double * 100 > 25 * double_median {
                            let mut params = HashMap::new();
                            params.insert("price".to_string(), unit_price.to_string());
                            let median_display = if double_median % 2 == 0 {
                                (double_median / 2).to_string()
                            } else {
                                format!("{}.5", double_median / 2)
                            };
                            params.insert("median".to_string(), median_display);

                            // Format name: product / brand / details
                            let mut name_parts = Vec::new();
                            if let Some(p) = &line.product_raw {
                                name_parts.push(p.as_str());
                            }
                            if let Some(b) = &line.brand_raw {
                                name_parts.push(b.as_str());
                            }
                            if let Some(d) = &line.details_raw {
                                name_parts.push(d.as_str());
                            }
                            params.insert("name".to_string(), name_parts.join(" / "));

                            warnings.push(PaperBookIssue {
                                row: Some(line_row),
                                txn_no: txn_no.clone(),
                                column: Some("J".to_string()),
                                code: "W_PRICE_UNUSUAL".to_string(),
                                params,
                            });
                        }
                    }
                }
            }

            // W_LINE_ONLY_AMOUNT: Sell or Buy line with I and J both blank (only K)
            if (txn.txn_type == TransactionType::Sell || txn.txn_type == TransactionType::Buy)
                && line.quantity.is_none()
                && line.unit_price.is_none()
            {
                warnings.push(PaperBookIssue {
                    row: Some(line_row),
                    txn_no: txn_no.clone(),
                    column: Some("K".to_string()),
                    code: "W_LINE_ONLY_AMOUNT".to_string(),
                    params: HashMap::new(),
                });
            }

            // W_TOTAL_OVERRIDDEN
            if line.total_overridden {
                let mut params = HashMap::new();
                if let Some(qty) = line.quantity {
                    params.insert("qty".to_string(), qty.to_string());
                }
                if let Some(price) = line.unit_price {
                    params.insert("price".to_string(), price.to_string());
                    if let Some(qty) = line.quantity {
                        params.insert("computed".to_string(), (qty * price).to_string());
                    }
                }
                params.insert("written".to_string(), line.line_total.to_string());

                warnings.push(PaperBookIssue {
                    row: Some(line_row),
                    txn_no: txn_no.clone(),
                    column: Some("K".to_string()),
                    code: "W_TOTAL_OVERRIDDEN".to_string(),
                    params,
                });
            }
        }

        // 5. W_BENEFIT_ABOVE_TOTAL (first row): Sell benefit > transaction total
        if txn.txn_type == TransactionType::Sell {
            if let Some(benefit) = txn.benefit {
                if benefit > txn.total {
                    let mut params = HashMap::new();
                    params.insert("benefit".to_string(), benefit.to_string());
                    params.insert("total".to_string(), txn.total.to_string());
                    warnings.push(PaperBookIssue {
                        row: Some(first_row),
                        txn_no: txn_no.clone(),
                        column: Some("L".to_string()),
                        code: "W_BENEFIT_ABOVE_TOTAL".to_string(),
                        params,
                    });
                }
            }
        }

        // 6. W_DUPLICATE_IN_FILE: Same date, same type, same party key, and same ordered lines as an earlier txn
        for prev_txn in &txns[..i] {
            if prev_txn.date == txn.date
                && prev_txn.txn_type == txn.txn_type
                && prev_txn.party_key == txn.party_key
                && prev_txn.lines.len() == txn.lines.len()
            {
                let lines_match = prev_txn.lines.iter().zip(txn.lines.iter()).all(|(l1, l2)| {
                    l1.product_key == l2.product_key
                        && l1.brand_key == l2.brand_key
                        && l1.details_key == l2.details_key
                        && l1.quantity == l2.quantity
                        && l1.unit_price == l2.unit_price
                        && l1.line_total == l2.line_total
                });

                if lines_match {
                    let mut params = HashMap::new();
                    params.insert(
                        "other_row".to_string(),
                        prev_txn.excel_first_row.to_string(),
                    );
                    warnings.push(PaperBookIssue {
                        row: Some(first_row),
                        txn_no: txn_no.clone(),
                        column: Some("A".to_string()),
                        code: "W_DUPLICATE_IN_FILE".to_string(),
                        params,
                    });
                    break;
                }
            }
        }

        // 7. W_POSSIBLE_MANUAL_DUPLICATE: A manual txn in DB has same date, type and total
        for sig in manual_signatures {
            if sig.date == txn.date && sig.txn_type == txn.txn_type && sig.total == txn.total {
                let mut params = HashMap::new();
                params.insert("manual_id".to_string(), sig.id.to_string());
                warnings.push(PaperBookIssue {
                    row: Some(first_row),
                    txn_no: txn_no.clone(),
                    column: Some("A".to_string()),
                    code: "W_POSSIBLE_MANUAL_DUPLICATE".to_string(),
                    params,
                });
                break;
            }
        }
    }

    // Sort warnings by row (file-level row None first)
    warnings.sort_by_key(|w| w.row.unwrap_or(0));
    warnings
}
