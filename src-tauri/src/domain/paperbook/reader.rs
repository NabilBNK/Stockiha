//! Workbook reader and sheet header matching for Paper Book.
//! Brief §6.1, §6.2.

use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::Path;

use calamine::{open_workbook_auto, Data, Range, Reader};
use sha2::{Digest, Sha256};

use super::normalize::clean_text;
use super::PaperBookIssue;

pub const MAX_FILE_SIZE_BYTES: u64 = 25 * 1024 * 1024; // 25 MB

pub const EXPECTED_HEADERS: [&str; 13] = [
    "Txn No. (Auto)",
    "Date",
    "Type",
    "Paid",
    "Party / Company (Optional)",
    "Product Name (Optional)",
    "Brand (Optional)",
    "Custom Details (Optional)",
    "Quantity",
    "Unit Price",
    "Line Total",
    "Benefit (Sell Only)",
    "Page No. (Optional)",
];

pub const COLUMN_LETTERS: [&str; 13] = [
    "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
];

/// Normalise a header string for case- and whitespace-insensitive comparison:
/// whitespace (including newlines) collapsed to a single space, trimmed, ASCII lowercase.
pub fn normalize_header(s: &str) -> String {
    let mut out = String::new();
    let mut in_space = false;
    for ch in s.chars() {
        if ch.is_whitespace() || ch == '\u{00A0}' || ch == '\u{202F}' || ch == '\u{2009}' {
            if !in_space {
                out.push(' ');
                in_space = true;
            }
        } else {
            out.push(ch.to_ascii_lowercase());
            in_space = false;
        }
    }
    out.trim().to_string()
}

#[derive(Debug, Clone)]
pub struct InspectedWorkbook {
    pub file_name: String,
    pub file_sha256: String,
    pub sheet_name: String,
    pub range: Range<Data>,
}

/// Read the file, verify format/size, hash with SHA-256, and find the matching sheet.
pub fn inspect_and_load_workbook(path: &Path) -> Result<InspectedWorkbook, Vec<PaperBookIssue>> {
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown.xlsx".to_string());

    // 1. Check extension is .xlsx (case-insensitive)
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    if ext != "xlsx" {
        return Err(vec![PaperBookIssue {
            row: None,
            txn_no: None,
            column: None,
            code: "E_FILE_TYPE".to_string(),
            params: HashMap::new(),
        }]);
    }

    // 2. Check file size
    let metadata = std::fs::metadata(path).map_err(|_| {
        vec![PaperBookIssue {
            row: None,
            txn_no: None,
            column: None,
            code: "E_FILE_UNREADABLE".to_string(),
            params: HashMap::new(),
        }]
    })?;

    if metadata.len() > MAX_FILE_SIZE_BYTES {
        return Err(vec![PaperBookIssue {
            row: None,
            txn_no: None,
            column: None,
            code: "E_FILE_TOO_BIG".to_string(),
            params: HashMap::new(),
        }]);
    }

    // 3. Compute SHA-256 hash
    let mut file = File::open(path).map_err(|_| {
        vec![PaperBookIssue {
            row: None,
            txn_no: None,
            column: None,
            code: "E_FILE_UNREADABLE".to_string(),
            params: HashMap::new(),
        }]
    })?;

    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(|_| {
            vec![PaperBookIssue {
                row: None,
                txn_no: None,
                column: None,
                code: "E_FILE_UNREADABLE".to_string(),
                params: HashMap::new(),
            }]
        })?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    let file_sha256 = format!("{:x}", hasher.finalize());

    // 4. Open workbook
    let mut workbook = open_workbook_auto(path).map_err(|_| {
        vec![PaperBookIssue {
            row: None,
            txn_no: None,
            column: None,
            code: "E_FILE_UNREADABLE".to_string(),
            params: HashMap::new(),
        }]
    })?;

    let sheet_names = workbook.sheet_names().to_vec();
    let norm_expected: Vec<String> = EXPECTED_HEADERS
        .iter()
        .map(|h| normalize_header(h))
        .collect();

    type PartialMatch = (String, Range<Data>, Vec<(usize, String)>);
    let mut full_matches: Vec<(String, Range<Data>)> = Vec::new();
    let mut partial_matches: Vec<PartialMatch> = Vec::new();

    for sheet_name in sheet_names {
        if let Ok(range) = workbook.worksheet_range(&sheet_name) {
            let row_count = range.get_size().0;
            let col_count = range.get_size().1;
            if row_count == 0 {
                continue;
            }

            // Extract row 1 headers
            let mut matches = 0;
            let mut mismatches: Vec<(usize, String)> = Vec::new();

            for (col_idx, expected_hdr) in norm_expected.iter().enumerate().take(13) {
                let cell_header = if col_idx < col_count {
                    range
                        .get_value((0, col_idx as u32))
                        .and_then(|d| match d {
                            Data::String(s) => clean_text(s),
                            _ => None,
                        })
                        .unwrap_or_default()
                } else {
                    String::new()
                };

                let norm_cell = normalize_header(&cell_header);
                if &norm_cell == expected_hdr {
                    matches += 1;
                } else {
                    mismatches.push((col_idx, cell_header));
                }
            }

            if matches == 13 {
                full_matches.push((sheet_name, range));
            } else if matches >= 6 {
                partial_matches.push((sheet_name, range, mismatches));
            }
        }
    }

    if full_matches.len() > 1 {
        let sheet_list = full_matches
            .into_iter()
            .map(|(s, _)| s)
            .collect::<Vec<_>>()
            .join(", ");
        let mut params = HashMap::new();
        params.insert("sheets".to_string(), sheet_list);
        return Err(vec![PaperBookIssue {
            row: None,
            txn_no: None,
            column: None,
            code: "E_SEVERAL_MATCHING_SHEETS".to_string(),
            params,
        }]);
    }

    if full_matches.len() == 1 {
        let (sheet_name, range) = full_matches.pop().unwrap();
        return Ok(InspectedWorkbook {
            file_name,
            file_sha256,
            sheet_name,
            range,
        });
    }

    // No full match
    if let Some((_sheet_name, _range, mismatches)) = partial_matches.into_iter().next() {
        let mut issues = Vec::new();
        for (col_idx, found_text) in mismatches {
            let col_letter = COLUMN_LETTERS[col_idx];
            let expected_text = EXPECTED_HEADERS[col_idx];
            let mut params = HashMap::new();
            params.insert("column".to_string(), col_letter.to_string());
            params.insert("expected".to_string(), expected_text.to_string());
            params.insert("found".to_string(), found_text);

            issues.push(PaperBookIssue {
                row: Some(1),
                txn_no: None,
                column: Some(col_letter.to_string()),
                code: "E_LAYOUT".to_string(),
                params,
            });
        }
        return Err(issues);
    }

    Err(vec![PaperBookIssue {
        row: None,
        txn_no: None,
        column: None,
        code: "E_NO_MATCHING_SHEET".to_string(),
        params: HashMap::new(),
    }])
}
