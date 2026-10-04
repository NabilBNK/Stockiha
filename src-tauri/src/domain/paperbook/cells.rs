//! Cell parsing and type conversions for Paper Book Excel cells.
//! Brief §6.4 & §16.1 item 2, 3.

use calamine::Data;
use time::{Date, Month};

use super::normalize::clean_text;

pub const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

/// Parse a cell expected to be a whole number (Quantity, Unit Price, Line Total, Benefit).
pub fn parse_whole(cell: &Data) -> Result<Option<i64>, &'static str> {
    match cell {
        Data::Empty => Ok(None),
        Data::String(s) => {
            let cleaned = match clean_text(s) {
                Some(c) => c,
                None => return Ok(None),
            };

            // Remove U+0020, U+00A0, U+202F, U+2009
            let stripped: String = cleaned
                .chars()
                .filter(|c| !matches!(*c, ' ' | '\u{00A0}' | '\u{202F}' | '\u{2009}'))
                .collect();

            if stripped.is_empty() {
                return Ok(None);
            }

            // Check if matches ^-?[0-9]+$
            let bytes = stripped.as_bytes();
            let (is_negative, digits) = if bytes[0] == b'-' {
                (true, &bytes[1..])
            } else {
                (false, bytes)
            };

            if digits.is_empty() || !digits.iter().all(|b| b.is_ascii_digit()) {
                return Err("E_NUMBER_INVALID");
            }

            let parsed: i64 = stripped.parse().map_err(|_| "E_NUMBER_INVALID")?;
            if is_negative && parsed > 0 {
                return Err("E_NUMBER_INVALID");
            }
            Ok(Some(parsed))
        }
        Data::Int(i) => {
            if i.abs() > MAX_SAFE_INTEGER {
                Err("E_NUMBER_INVALID")
            } else {
                Ok(Some(*i))
            }
        }
        Data::Float(f) => {
            // WS-P-1: the only float in this workstream — converted at the boundary, see brief 6.4
            if !f.is_finite() {
                return Err("E_NUMBER_INVALID");
            }
            if f.fract() != 0.0 {
                return Err("E_NOT_WHOLE");
            }
            let val = *f as i64;
            if (val as f64) != *f || val.abs() > MAX_SAFE_INTEGER {
                return Err("E_NUMBER_INVALID");
            }
            Ok(Some(val))
        }
        Data::Error(_) => Err("E_CELL_ERROR"),
        Data::DateTime(_) | Data::DateTimeIso(_) | Data::DurationIso(_) | Data::Bool(_) => {
            Err("E_NUMBER_INVALID")
        }
    }
}

/// Convert an Excel serial day number to time::Date.
/// In Excel's 1900 date system, day 1 is 1900-01-01, but Excel incorrectly treats 1900 as a leap year.
/// Day 60 is 1900-02-29. For days >= 61, the day count is offset from 1899-12-30.
pub fn excel_serial_to_date(serial: f64) -> Option<Date> {
    if !serial.is_finite() || serial < 1.0 {
        return None;
    }
    let days = serial.floor() as i64;

    // Epoch reference: 1899-12-30
    let base = Date::from_calendar_date(1899, Month::December, 30).ok()?;
    let adjusted_days = if days < 60 {
        days
    } else if days == 60 {
        // Excel's imaginary leap day Feb 29 1900
        return Date::from_calendar_date(1900, Month::February, 28).ok();
    } else {
        days
    };

    base.checked_add(time::Duration::days(adjusted_days))
}

/// Parse a cell expected to be a date (column B).
pub fn parse_date(cell: &Data) -> Result<Option<Date>, &'static str> {
    match cell {
        Data::Empty => Ok(None),
        Data::String(s) => {
            let cleaned = match clean_text(s) {
                Some(c) => c,
                None => return Ok(None),
            };

            // Parse text date: must match ^\s*(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})\s*$
            // Read as day / month / year
            let parts: Vec<&str> = cleaned.split(['/', '.', '-']).collect();
            if parts.len() != 3 {
                return Err("E_DATE_INVALID");
            }

            let day: u8 = parts[0].trim().parse().map_err(|_| "E_DATE_INVALID")?;
            let month_num: u8 = parts[1].trim().parse().map_err(|_| "E_DATE_INVALID")?;
            let year: i32 = parts[2].trim().parse().map_err(|_| "E_DATE_INVALID")?;

            if year < 2000 {
                return Err("E_DATE_INVALID");
            }

            let month = Month::try_from(month_num).map_err(|_| "E_DATE_INVALID")?;
            let date = Date::from_calendar_date(year, month, day).map_err(|_| "E_DATE_INVALID")?;
            Ok(Some(date))
        }
        Data::DateTime(f) => {
            // Excel serial date number
            match excel_serial_to_date(f.as_f64()) {
                Some(d) if d.year() >= 2000 => Ok(Some(d)),
                Some(_) => Err("E_DATE_INVALID"),
                None => Err("E_DATE_INVALID"),
            }
        }
        Data::DateTimeIso(iso) => {
            // Handle ISO date format YYYY-MM-DD
            let prefix = if iso.len() >= 10 { &iso[0..10] } else { iso };
            let parts: Vec<&str> = prefix.split('-').collect();
            if parts.len() == 3 {
                let year: i32 = parts[0].parse().map_err(|_| "E_DATE_INVALID")?;
                let month_num: u8 = parts[1].parse().map_err(|_| "E_DATE_INVALID")?;
                let day: u8 = parts[2].parse().map_err(|_| "E_DATE_INVALID")?;
                if year < 2000 {
                    return Err("E_DATE_INVALID");
                }
                let month = Month::try_from(month_num).map_err(|_| "E_DATE_INVALID")?;
                let date =
                    Date::from_calendar_date(year, month, day).map_err(|_| "E_DATE_INVALID")?;
                Ok(Some(date))
            } else {
                Err("E_DATE_INVALID")
            }
        }
        Data::Error(_) => Err("E_CELL_ERROR"),
        Data::Float(_) | Data::Int(_) | Data::Bool(_) | Data::DurationIso(_) => {
            Err("E_DATE_INVALID")
        }
    }
}

/// Parse text cell (columns C, D, E, F, G, H, M).
pub fn parse_text(cell: &Data) -> Result<Option<String>, &'static str> {
    match cell {
        Data::Empty => Ok(None),
        Data::String(s) => Ok(clean_text(s)),
        Data::Int(i) => Ok(Some(i.to_string())),
        Data::Float(f) => {
            if !f.is_finite() {
                return Err("E_CELL_ERROR");
            }
            if f.fract() == 0.0 {
                Ok(Some((*f as i64).to_string()))
            } else {
                Ok(Some(f.to_string()))
            }
        }
        Data::DateTime(f) => match excel_serial_to_date(f.as_f64()) {
            Some(d) => Ok(Some(d.to_string())),
            None => Ok(None),
        },
        Data::DateTimeIso(s) => {
            let prefix = if s.len() >= 10 { &s[0..10] } else { s };
            Ok(Some(prefix.to_string()))
        }
        Data::DurationIso(s) => Ok(Some(s.clone())),
        Data::Bool(b) => Ok(Some(if *b {
            "TRUE".to_string()
        } else {
            "FALSE".to_string()
        })),
        Data::Error(_) => Err("E_CELL_ERROR"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_whole_fixtures_from_brief_16_1_item_2() {
        assert_eq!(parse_whole(&Data::Int(12)), Ok(Some(12)));
        assert_eq!(parse_whole(&Data::Float(12.0)), Ok(Some(12)));
        assert_eq!(parse_whole(&Data::Float(2.5)), Err("E_NOT_WHOLE"));
        assert_eq!(parse_whole(&Data::String("9 200".into())), Ok(Some(9200)));
        assert_eq!(
            parse_whole(&Data::String("9\u{00A0}200".into())),
            Ok(Some(9200))
        );
        assert_eq!(
            parse_whole(&Data::String("9\u{202F}200".into())),
            Ok(Some(9200))
        );
        assert_eq!(parse_whole(&Data::String("-500".into())), Ok(Some(-500)));
        assert_eq!(
            parse_whole(&Data::String("1,050".into())),
            Err("E_NUMBER_INVALID")
        );
        assert_eq!(
            parse_whole(&Data::String("1.050".into())),
            Err("E_NUMBER_INVALID")
        );
        assert_eq!(
            parse_whole(&Data::String("abc".into())),
            Err("E_NUMBER_INVALID")
        );
        assert_eq!(
            parse_whole(&Data::String("5 000,50".into())),
            Err("E_NUMBER_INVALID")
        );
        assert_eq!(parse_whole(&Data::Empty), Ok(None));
        assert_eq!(parse_whole(&Data::String("  ".into())), Ok(None));
    }

    #[test]
    fn test_parse_date_fixtures_from_brief_16_1_item_3() {
        let expected = Date::from_calendar_date(2025, Month::May, 13).unwrap();
        assert_eq!(
            parse_date(&Data::String("13/05/2025".into())),
            Ok(Some(expected))
        );
        assert_eq!(
            parse_date(&Data::String("13-05-2025".into())),
            Ok(Some(expected))
        );
        assert_eq!(
            parse_date(&Data::String("13.05.2025".into())),
            Ok(Some(expected))
        );

        let expected_short = Date::from_calendar_date(2025, Month::May, 3).unwrap();
        assert_eq!(
            parse_date(&Data::String("3/5/2025".into())),
            Ok(Some(expected_short))
        );

        assert_eq!(
            parse_date(&Data::String("15/052025".into())),
            Err("E_DATE_INVALID")
        );
        assert_eq!(
            parse_date(&Data::String("31/02/2025".into())),
            Err("E_DATE_INVALID")
        );
        assert_eq!(
            parse_date(&Data::String("13/05/25".into())),
            Err("E_DATE_INVALID")
        ); // 2 digit year
        assert_eq!(
            parse_date(&Data::String("05/13/2025".into())),
            Err("E_DATE_INVALID")
        ); // month 13
    }
}
