//! Pure text normalisation rules for WS-P-1 Paper Book.
//!
//! Must produce byte-identical results to SQL functions:
//! `paperbook.clean_text` and `paperbook.normalize_key`.

/// Clean raw text by replacing non-standard whitespace, collapsing multiple spaces,
/// and trimming ends. Preserves original case. Empty string returns `None`.
pub fn clean_text(input: &str) -> Option<String> {
    if input.is_empty() {
        return None;
    }

    let mut out = String::with_capacity(input.len());
    let mut in_space_run = false;

    for ch in input.chars() {
        let is_space_char = matches!(
            ch,
            ' ' | '\u{00A0}' | '\u{202F}' | '\u{2009}' | '\t' | '\n' | '\r'
        );

        if is_space_char {
            if !in_space_run {
                out.push(' ');
                in_space_run = true;
            }
        } else {
            out.push(ch);
            in_space_run = false;
        }
    }

    let trimmed = out.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Normalise a raw text key: apply clean_text whitespace rules, ASCII-only lowercase
/// ('A'..='Z' -> 'a'..='z'), keeping all other characters (accents, Arabic, digits) unchanged.
/// Empty string returns `None`.
pub fn normalize_key(input: &str) -> Option<String> {
    let cleaned = clean_text(input)?;
    let mut out = String::with_capacity(cleaned.len());
    for ch in cleaned.chars() {
        if ch.is_ascii_uppercase() {
            out.push(ch.to_ascii_lowercase());
        } else {
            out.push(ch);
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_clean_text() {
        assert_eq!(clean_text(""), None);
        assert_eq!(clean_text("   "), None);
        assert_eq!(
            clean_text("  hello   world  "),
            Some("hello world".to_string())
        );
        assert_eq!(
            clean_text("pillow\u{00A0}cover"),
            Some("pillow cover".to_string())
        );
        assert_eq!(
            clean_text("pillow\u{202F}cover"),
            Some("pillow cover".to_string())
        );
        assert_eq!(
            clean_text("pillow\u{2009}cover"),
            Some("pillow cover".to_string())
        );
        assert_eq!(
            clean_text("pillow\tcover\r\n"),
            Some("pillow cover".to_string())
        );
        assert_eq!(clean_text("ÉTÉ"), Some("ÉTÉ".to_string()));
        assert_eq!(clean_text("غطاء وسادة"), Some("غطاء وسادة".to_string()));
    }

    #[test]
    fn test_normalize_key() {
        assert_eq!(normalize_key(""), None);
        assert_eq!(normalize_key("   "), None);
        assert_eq!(
            normalize_key("  Hello   World  "),
            Some("hello world".to_string())
        );
        assert_eq!(
            normalize_key("pillow\u{00A0}cover "),
            Some("pillow cover".to_string())
        );
        assert_eq!(normalize_key("ALPHA"), Some("alpha".to_string()));
        assert_eq!(normalize_key("ÉTÉ"), Some("ÉtÉ".to_string())); // ASCII 'T' lowercased, accented 'É' preserved
        assert_eq!(normalize_key("AK home"), Some("ak home".to_string()));
        assert_eq!(normalize_key("123"), Some("123".to_string()));
        assert_eq!(normalize_key("غطاء وسادة"), Some("غطاء وسادة".to_string()));
    }
}
