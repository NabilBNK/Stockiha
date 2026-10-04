//! Tests asserting the four paper book fixture files against expected.json.
//! Brief §15 & §16.1.

use std::path::PathBuf;
use stockiha_lib::domain::paperbook::reader::inspect_and_load_workbook;
use stockiha_lib::domain::paperbook::validate::parse_and_validate_workbook;
use time::{Date, Month};

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("paperbook")
}

#[test]
fn test_history_valid_against_expected() {
    let dir = fixtures_dir();
    let file_path = dir.join("history_valid.xlsx");
    let inspected = inspect_and_load_workbook(&file_path).expect("history_valid.xlsx must load");

    assert_eq!(inspected.sheet_name, "Transactions");

    let go_live = Date::from_calendar_date(2026, Month::March, 1).unwrap();
    let today = Date::from_calendar_date(2026, Month::September, 27).unwrap();

    let parsed = parse_and_validate_workbook(inspected, Some(go_live), today, &[], None, None)
        .expect("history_valid.xlsx must have 0 errors");

    let s = &parsed.summary;
    assert_eq!(s.transactions, 19);
    assert_eq!(s.sell, 7);
    assert_eq!(s.buy, 9);
    assert_eq!(s.expense, 3);
    assert_eq!(s.lines, 30);
    assert_eq!(s.date_min.as_deref(), Some("2025-05-03"));
    assert_eq!(s.date_max.as_deref(), Some("2025-06-12"));
    assert_eq!(s.sell_total, 236_000);
    assert_eq!(s.buy_total, 1_189_900);
    assert_eq!(s.expense_total, 24_500);
    assert_eq!(s.sell_benefit_total, 46_500);
    assert_eq!(s.sells_with_benefit, 6);
    assert_eq!(s.sell_total_with_benefit, 194_000);
    assert_eq!(s.sell_not_paid_total, 132_000);
    assert_eq!(s.buy_not_paid_total, 0);
    assert_eq!(s.expense_not_paid_total, 18_500);

    // Assert exactly 6 warnings in order:
    // row 11: W_PRICE_UNUSUAL
    // row 17: W_DATE_OUT_OF_ORDER
    // row 20: W_LINE_ONLY_AMOUNT
    // row 26: W_TOTAL_OVERRIDDEN
    // row 28: W_BENEFIT_ABOVE_TOTAL
    // row 30: W_DUPLICATE_IN_FILE
    let warnings = &parsed.warnings;
    assert_eq!(
        warnings.len(),
        6,
        "Expected exactly 6 warnings, got: {:?}",
        warnings
    );

    assert_eq!(warnings[0].row, Some(11));
    assert_eq!(warnings[0].code, "W_PRICE_UNUSUAL");

    assert_eq!(warnings[1].row, Some(17));
    assert_eq!(warnings[1].code, "W_DATE_OUT_OF_ORDER");

    assert_eq!(warnings[2].row, Some(20));
    assert_eq!(warnings[2].code, "W_LINE_ONLY_AMOUNT");

    assert_eq!(warnings[3].row, Some(26));
    assert_eq!(warnings[3].code, "W_TOTAL_OVERRIDDEN");

    assert_eq!(warnings[4].row, Some(28));
    assert_eq!(warnings[4].code, "W_BENEFIT_ABOVE_TOTAL");

    assert_eq!(warnings[5].row, Some(30));
    assert_eq!(warnings[5].code, "W_DUPLICATE_IN_FILE");
}

#[test]
fn test_history_errors_against_expected() {
    let dir = fixtures_dir();
    let file_path = dir.join("history_errors.xlsx");
    let inspected = inspect_and_load_workbook(&file_path).expect("history_errors.xlsx must open");

    let go_live = Date::from_calendar_date(2026, Month::March, 1).unwrap();
    let today = Date::from_calendar_date(2026, Month::September, 27).unwrap();

    let err = parse_and_validate_workbook(inspected, Some(go_live), today, &[], None, None)
        .expect_err("history_errors.xlsx must fail validation");

    let expected_triples = [
        (2, "C", "E_ORPHAN_LINE"),
        (3, "B", "E_DATE_INVALID"),
        (4, "B", "E_DATE_MISSING"),
        (5, "C", "E_TYPE_INVALID"),
        (6, "D", "E_PAID_MISSING"),
        (7, "D", "E_PAID_INVALID"),
        (8, "L", "E_BENEFIT_NOT_SELL"),
        (10, "L", "E_BENEFIT_NOT_FIRST_ROW"),
        (11, "K", "E_LINE_AMOUNT_MISSING"),
        (12, "I", "E_NOT_WHOLE"),
        (13, "I", "E_QTY_NOT_POSITIVE"),
        (14, "J", "E_NUMBER_INVALID"),
        (15, "K", "E_CELL_ERROR"),
        (16, "K", "E_AMOUNT_NEGATIVE"),
        (18, "B", "E_CONTINUATION_DATE_DIFFERS"),
        (20, "E", "E_CONTINUATION_PARTY_DIFFERS"),
        (22, "D", "E_CONTINUATION_PAID_DIFFERS"),
        (23, "B", "E_DATE_AFTER_GO_LIVE"),
        (24, "B", "E_DATE_IN_FUTURE"),
        (25, "B", "E_DATE_MISSING"),
        (25, "D", "E_PAID_MISSING"),
        (25, "K", "E_TXN_NO_LINES"),
        (26, "K", "E_LINE_AMOUNT_MISSING"),
        (27, "I", "E_QTY_NOT_POSITIVE"),
        (28, "L", "E_NUMBER_INVALID"),
    ];

    assert_eq!(
        err.len(),
        expected_triples.len(),
        "Expected exactly 25 errors, got: {:?}",
        err
    );

    for (i, &(exp_row, exp_col, exp_code)) in expected_triples.iter().enumerate() {
        let actual = &err[i];
        assert_eq!(actual.row, Some(exp_row), "Error {i} row mismatch");
        assert_eq!(
            actual.column.as_deref(),
            Some(exp_col),
            "Error {i} col mismatch"
        );
        assert_eq!(actual.code, exp_code, "Error {i} code mismatch");
    }
}

#[test]
fn test_history_bad_layout_against_expected() {
    let dir = fixtures_dir();
    let file_path = dir.join("history_bad_layout.xlsx");
    let err = inspect_and_load_workbook(&file_path)
        .expect_err("history_bad_layout.xlsx must fail header check");

    assert_eq!(err.len(), 1);
    assert_eq!(err[0].row, Some(1));
    assert_eq!(err[0].column.as_deref(), Some("L"));
    assert_eq!(err[0].code, "E_LAYOUT");
    assert_eq!(
        err[0].params.get("expected").map(String::as_str),
        Some("Benefit (Sell Only)")
    );
    assert_eq!(
        err[0].params.get("found").map(String::as_str),
        Some("Profit")
    );
}

#[test]
fn test_history_big_20k_against_expected() {
    let dir = fixtures_dir();
    let file_path = dir.join("history_big_20k.xlsx");

    let t0 = std::time::Instant::now();
    let inspected = inspect_and_load_workbook(&file_path).expect("history_big_20k.xlsx must open");

    let go_live = Date::from_calendar_date(2026, Month::March, 1).unwrap();
    let today = Date::from_calendar_date(2026, Month::September, 27).unwrap();

    let parsed = parse_and_validate_workbook(inspected, Some(go_live), today, &[], None, None)
        .expect("history_big_20k.xlsx must have 0 errors");

    let elapsed = t0.elapsed();
    println!("history_big_20k parse & validate took {:?}", elapsed);
    let max_allowed = if cfg!(debug_assertions) { 15 } else { 5 };
    assert!(
        elapsed.as_secs() < max_allowed,
        "Preview of 20k rows must be under {:?}s, took {:?}",
        max_allowed,
        elapsed
    );

    let s = &parsed.summary;
    assert_eq!(s.transactions, 7_052);
    assert_eq!(s.sell, 3_893);
    assert_eq!(s.buy, 2_453);
    assert_eq!(s.expense, 706);
    assert_eq!(s.lines, 20_001);
    assert_eq!(s.sell_total, 1_498_132_000);
    assert_eq!(s.buy_total, 673_691_350);
    assert_eq!(s.expense_total, 5_264_500);
    assert_eq!(s.sell_benefit_total, 299_626_400);
    assert_eq!(s.date_max.as_deref(), Some("2025-10-16"));
}
