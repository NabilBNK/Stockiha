//! Name clean-up suggestions using Levenshtein distance and digit-run matching.
//! Brief §6.8 & §16.1 item 7.

/// Extract consecutive runs of ASCII digits as vector of strings.
pub fn extract_digit_runs(s: &str) -> Vec<String> {
    let mut runs = Vec::new();
    let mut current = String::new();
    for ch in s.chars() {
        if ch.is_ascii_digit() {
            current.push(ch);
        } else if !current.is_empty() {
            runs.push(std::mem::take(&mut current));
        }
    }
    if !current.is_empty() {
        runs.push(current);
    }
    runs
}

/// Compute Levenshtein distance on Unicode characters using two-row dynamic programming.
pub fn levenshtein_distance(a: &str, b: &str) -> usize {
    let a_chars: Vec<char> = a.chars().collect();
    let b_chars: Vec<char> = b.chars().collect();

    let m = a_chars.len();
    let n = b_chars.len();

    if m == 0 {
        return n;
    }
    if n == 0 {
        return m;
    }

    let mut prev = (0..=n).collect::<Vec<usize>>();
    let mut curr = vec![0; n + 1];

    for i in 1..=m {
        curr[0] = i;
        for j in 1..=n {
            let cost = if a_chars[i - 1] == b_chars[j - 1] {
                0
            } else {
                1
            };
            curr[j] = (prev[j] + 1) // deletion
                .min(curr[j - 1] + 1) // insertion
                .min(prev[j - 1] + cost); // substitution
        }
        prev.clone_from_slice(&curr);
    }

    prev[n]
}

/// Check if two normalised effective keys should be suggested as possible duplicates.
pub fn should_suggest_pair(key_a: &str, key_b: &str) -> bool {
    if key_a == key_b {
        return false;
    }

    // 1. Their sequences of digit runs must be identical
    if extract_digit_runs(key_a) != extract_digit_runs(key_b) {
        return false;
    }

    let len_a = key_a.chars().count();
    let len_b = key_b.chars().count();
    let min_len = len_a.min(len_b);

    // 2. Shorter key must have at least 4 characters
    if min_len < 4 {
        return false;
    }

    // 3. Levenshtein distance <= 1 for 4-7 chars, <= 2 for 8+ chars
    let max_allowed_dist = if min_len <= 7 { 1 } else { 2 };

    // Early exit if length difference exceeds allowed distance
    if len_a.abs_diff(len_b) > max_allowed_dist {
        return false;
    }

    let dist = levenshtein_distance(key_a, key_b);
    dist <= max_allowed_dist
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_digit_runs() {
        assert_eq!(extract_digit_runs("1p"), vec!["1"]);
        assert_eq!(extract_digit_runs("2p"), vec!["2"]);
        assert_eq!(extract_digit_runs("0,9"), vec!["0", "9"]);
        assert_eq!(extract_digit_runs("0,90"), vec!["0", "90"]);
        assert_eq!(extract_digit_runs("pillow cover"), Vec::<String>::new());
    }

    #[test]
    fn test_levenshtein_distance() {
        assert_eq!(levenshtein_distance("", ""), 0);
        assert_eq!(levenshtein_distance("kitten", "sitting"), 3);
        assert_eq!(levenshtein_distance("pillow cover", "pillow couver"), 1);
        assert_eq!(levenshtein_distance("rolored", "colored"), 1);
        assert_eq!(levenshtein_distance("istanbul 1p", "iatanbul 1p"), 1);
    }

    #[test]
    fn test_suggest_cases_from_brief_16_1_item_7() {
        // Pairs that must NEVER be suggested:
        assert!(!should_suggest_pair("1p", "2p"));
        assert!(!should_suggest_pair("240", "260"));
        assert!(!should_suggest_pair("0,9", "0,90"));
        assert!(!should_suggest_pair(
            "blanc polister 240",
            "blanc polister 260"
        ));
        assert!(!should_suggest_pair("polister", "polinare"));

        // Pairs that MUST be suggested:
        assert!(should_suggest_pair("iatanbul 1p", "istanbul 1p"));
        assert!(should_suggest_pair("rolored", "colored"));
        assert!(should_suggest_pair("pillow couver", "pillow cover"));
    }
}
