//! WS-K-7 — licence key string parsing and payload field validation
//! (plan §3.1, §3.3).
//!
//! [`parse_key`] only decodes and validates *shape*: the `STKL1.<payload>.
//! <sig>` envelope, the JSON payload inside it, and every field rule from
//! §3.1. It never checks the signature — that is [`super::signature::verify`],
//! deliberately kept separate so a caller can tell a malformed key (nothing
//! to check) apart from a well-formed-but-forged one (checked and rejected).

use base64::engine::general_purpose::{URL_SAFE, URL_SAFE_NO_PAD};
use base64::Engine as _;
use serde::Deserialize;

use super::machine;
use super::MAX_KEY_LENGTH;

/// The one fixed envelope prefix this format has ever had (plan §3.3).
const KEY_PREFIX: &str = "STKL1.";

/// The licence payload, deserialized directly from the signed JSON bytes.
/// Unknown extra fields are silently ignored (no `deny_unknown_fields`) —
/// forward compatibility per plan §3.1; the signature still covers them
/// because it is computed over the raw bytes, not this typed view.
#[derive(Debug, Clone, Deserialize)]
pub(crate) struct LicencePayload {
    pub v: i64,
    pub licence_id: String,
    pub licensee: String,
    pub machine_code: String,
    pub issued_on: String,
    pub expires_on: Option<String>,
    pub edition: String,
    #[serde(default)]
    #[allow(dead_code)]
    pub notes: Option<String>,
}

/// A licence key string successfully decoded into its three parts, with the
/// payload already field-validated. `payload_bytes` are the *exact* bytes
/// that were signed — never re-serialized — so signature verification in
/// `super::signature` can check them byte-for-byte.
#[derive(Debug)]
pub(crate) struct ParsedKey {
    pub payload_bytes: Vec<u8>,
    pub sig_file_bytes: Vec<u8>,
    pub payload: LicencePayload,
}

/// Every way a licence key string can fail to decode or validate. Each
/// variant has a stable [`KeyError::reason`] string used only in
/// `licence.log` (never shown to the operator, never containing the key
/// text itself) and classifies into the IPC error-code family via
/// [`KeyError::is_malformed`] (plan §5.9): an envelope that cannot even be
/// decoded is `LICENCE_MALFORMED`; one that decodes but fails content
/// validation is `LICENCE_INVALID` (grouped with a bad signature, which is
/// reported separately by `signature::verify`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum KeyError {
    BadPrefix,
    BadParts,
    BadBase64,
    BadJson,
    UnsupportedVersion,
    BadField(&'static str),
    TooLong,
}

impl KeyError {
    pub(crate) fn reason(&self) -> String {
        match self {
            KeyError::BadPrefix => "BAD_PREFIX".to_owned(),
            KeyError::BadParts => "BAD_PARTS".to_owned(),
            KeyError::BadBase64 => "BAD_BASE64".to_owned(),
            KeyError::BadJson => "BAD_JSON".to_owned(),
            KeyError::UnsupportedVersion => "UNSUPPORTED_VERSION".to_owned(),
            KeyError::BadField(name) => format!("BAD_FIELD:{name}"),
            KeyError::TooLong => "TOO_LONG".to_owned(),
        }
    }

    pub(crate) fn is_malformed(&self) -> bool {
        matches!(
            self,
            KeyError::BadPrefix
                | KeyError::BadParts
                | KeyError::BadBase64
                | KeyError::BadJson
                | KeyError::TooLong
        )
    }
}

/// Parse a licence key string end to end: strip whitespace, check length,
/// split the `STKL1.<payload>.<sig>` envelope, base64url-decode both parts,
/// deserialize the JSON payload, and validate every field (plan §3.1, §3.3).
/// Never checks the signature.
pub(crate) fn parse_key(text: &str) -> Result<ParsedKey, KeyError> {
    let stripped: String = text.chars().filter(|c| !c.is_whitespace()).collect();
    if stripped.len() > MAX_KEY_LENGTH {
        return Err(KeyError::TooLong);
    }
    let Some(rest) = stripped.strip_prefix(KEY_PREFIX) else {
        return Err(KeyError::BadPrefix);
    };

    let segments: Vec<&str> = rest.split('.').collect();
    if segments.len() != 2 || segments[0].is_empty() || segments[1].is_empty() {
        return Err(KeyError::BadParts);
    }

    let payload_bytes = decode_base64url(segments[0]).ok_or(KeyError::BadBase64)?;
    let sig_file_bytes = decode_base64url(segments[1]).ok_or(KeyError::BadBase64)?;

    let payload: LicencePayload =
        serde_json::from_slice(&payload_bytes).map_err(|_| KeyError::BadJson)?;
    validate_payload(&payload)?;

    Ok(ParsedKey {
        payload_bytes,
        sig_file_bytes,
        payload,
    })
}

/// base64url per plan §3.3: no padding preferred, padded accepted too.
fn decode_base64url(s: &str) -> Option<Vec<u8>> {
    URL_SAFE_NO_PAD
        .decode(s)
        .ok()
        .or_else(|| URL_SAFE.decode(s).ok())
}

fn validate_payload(payload: &LicencePayload) -> Result<(), KeyError> {
    if payload.v != 1 {
        return Err(KeyError::UnsupportedVersion);
    }

    if payload.licence_id.is_empty()
        || payload.licence_id.len() > 40
        || !payload
            .licence_id
            .bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'-')
    {
        return Err(KeyError::BadField("licence_id"));
    }

    let licensee_len = payload.licensee.trim().chars().count();
    if licensee_len == 0 || licensee_len > 120 {
        return Err(KeyError::BadField("licensee"));
    }

    if !is_valid_machine_code(&payload.machine_code) {
        return Err(KeyError::BadField("machine_code"));
    }

    let issued_on = parse_date(&payload.issued_on).ok_or(KeyError::BadField("issued_on"))?;
    if let Some(expires_on_str) = &payload.expires_on {
        let expires_on = parse_date(expires_on_str).ok_or(KeyError::BadField("expires_on"))?;
        if expires_on < issued_on {
            return Err(KeyError::BadField("expires_on"));
        }
    }

    if payload.edition != "STANDARD" {
        return Err(KeyError::BadField("edition"));
    }

    if let Some(notes) = &payload.notes {
        if notes.chars().count() > 200 {
            return Err(KeyError::BadField("notes"));
        }
    }

    Ok(())
}

/// `^STKH(-[0-9A-HJKMNP-TV-Z]{4}){4}$` — matches plan §3.1, using the same
/// Crockford alphabet `machine::compute_machine_code` encodes with.
fn is_valid_machine_code(code: &str) -> bool {
    let Some(rest) = code.strip_prefix("STKH") else {
        return false;
    };
    let groups: Vec<&str> = rest.split('-').collect();
    if groups.len() != 5 || !groups[0].is_empty() {
        return false;
    }
    groups[1..]
        .iter()
        .all(|g| g.len() == 4 && g.bytes().all(|b| machine::ALPHABET.contains(&b)))
}

/// Parse a plain `YYYY-MM-DD` string into a `time::Date`, by hand — matches
/// this crate's existing convention (see `Cargo.toml`'s `time` dependency
/// comment) rather than adding date-format-string parsing.
pub(crate) fn parse_date(s: &str) -> Option<time::Date> {
    let bytes = s.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return None;
    }
    let year: i32 = s.get(0..4)?.parse().ok()?;
    let month: u8 = s.get(5..7)?.parse().ok()?;
    let day: u8 = s.get(8..10)?.parse().ok()?;
    let month = time::Month::try_from(month).ok()?;
    time::Date::from_calendar_date(year, month, day).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    const VALID_MACHINE_CODE: &str = "STKH-TEST-0000-0000-0001";

    fn valid_payload_json() -> serde_json::Value {
        serde_json::json!({
            "v": 1,
            "licence_id": "L-20260926-0001",
            "licensee": "Boutique El Nour",
            "machine_code": VALID_MACHINE_CODE,
            "issued_on": "2026-09-26",
            "expires_on": "2027-09-26",
            "edition": "STANDARD",
            "notes": ""
        })
    }

    fn build_key(payload_json: &serde_json::Value) -> String {
        let payload_bytes = serde_json::to_vec(payload_json).unwrap();
        let payload_b64 = URL_SAFE_NO_PAD.encode(payload_bytes);
        // The signature part is never checked by `parse_key`; any non-empty
        // base64url content stands in for it here.
        let sig_b64 = URL_SAFE_NO_PAD.encode(b"not-a-real-signature");
        format!("{KEY_PREFIX}{payload_b64}.{sig_b64}")
    }

    #[test]
    fn valid_key_parses_and_validates() {
        let key = build_key(&valid_payload_json());
        let parsed = parse_key(&key).expect("valid key must parse");
        assert_eq!(parsed.payload.licence_id, "L-20260926-0001");
        assert_eq!(parsed.payload.machine_code, VALID_MACHINE_CODE);
    }

    #[test]
    fn whitespace_and_newlines_inside_the_key_are_ignored() {
        let key = build_key(&valid_payload_json());
        let mangled: String = key
            .chars()
            .enumerate()
            .map(|(i, c)| {
                if i % 7 == 0 {
                    format!(" {c}\n\t")
                } else {
                    c.to_string()
                }
            })
            .collect();
        assert!(parse_key(&mangled).is_ok());
    }

    #[test]
    fn missing_prefix_is_rejected() {
        let key = build_key(&valid_payload_json());
        let broken = key.replacen("STKL1.", "STKX1.", 1);
        assert_eq!(parse_key(&broken).unwrap_err(), KeyError::BadPrefix);
    }

    #[test]
    fn wrong_part_count_is_rejected() {
        let key = build_key(&valid_payload_json());
        let extra_dot = format!("{key}.extra");
        assert_eq!(parse_key(&extra_dot).unwrap_err(), KeyError::BadParts);

        // Remove only the payload/signature separator (the *last* dot) —
        // the first dot belongs to the fixed `STKL1.` prefix itself and
        // removing it instead would produce `BadPrefix`, not `BadParts`.
        let last_dot = key.rfind('.').expect("built key must contain a dot");
        let no_dot = format!("{}{}", &key[..last_dot], &key[last_dot + 1..]);
        assert_eq!(parse_key(&no_dot).unwrap_err(), KeyError::BadParts);
    }

    #[test]
    fn bad_base64_is_rejected() {
        let broken = format!("{KEY_PREFIX}not-valid-base64!!!.also-not-valid!!!");
        assert_eq!(parse_key(&broken).unwrap_err(), KeyError::BadBase64);
    }

    #[test]
    fn bad_json_is_rejected() {
        let payload_b64 = URL_SAFE_NO_PAD.encode(b"{ not json");
        let sig_b64 = URL_SAFE_NO_PAD.encode(b"sig");
        let key = format!("{KEY_PREFIX}{payload_b64}.{sig_b64}");
        assert_eq!(parse_key(&key).unwrap_err(), KeyError::BadJson);
    }

    #[test]
    fn unsupported_version_is_rejected() {
        let mut payload = valid_payload_json();
        payload["v"] = serde_json::json!(2);
        let key = build_key(&payload);
        assert_eq!(parse_key(&key).unwrap_err(), KeyError::UnsupportedVersion);
    }

    #[test]
    fn empty_licensee_is_rejected() {
        let mut payload = valid_payload_json();
        payload["licensee"] = serde_json::json!("   ");
        let key = build_key(&payload);
        assert_eq!(parse_key(&key).unwrap_err(), KeyError::BadField("licensee"));
    }

    #[test]
    fn licence_id_over_40_characters_is_rejected() {
        let mut payload = valid_payload_json();
        payload["licence_id"] = serde_json::json!("A".repeat(41));
        let key = build_key(&payload);
        assert_eq!(
            parse_key(&key).unwrap_err(),
            KeyError::BadField("licence_id")
        );
    }

    #[test]
    fn expires_before_issued_is_rejected() {
        let mut payload = valid_payload_json();
        payload["issued_on"] = serde_json::json!("2026-09-26");
        payload["expires_on"] = serde_json::json!("2026-09-25");
        let key = build_key(&payload);
        assert_eq!(
            parse_key(&key).unwrap_err(),
            KeyError::BadField("expires_on")
        );
    }

    #[test]
    fn non_standard_edition_is_rejected() {
        let mut payload = valid_payload_json();
        payload["edition"] = serde_json::json!("PRO");
        let key = build_key(&payload);
        assert_eq!(parse_key(&key).unwrap_err(), KeyError::BadField("edition"));
    }

    #[test]
    fn over_long_key_is_rejected() {
        let mut payload = valid_payload_json();
        payload["notes"] = serde_json::json!("x".repeat(MAX_KEY_LENGTH));
        let key = build_key(&payload);
        assert_eq!(parse_key(&key).unwrap_err(), KeyError::TooLong);
    }

    #[test]
    fn unknown_extra_fields_are_accepted() {
        let mut payload = valid_payload_json();
        payload["future_field"] = serde_json::json!("something new");
        let key = build_key(&payload);
        assert!(parse_key(&key).is_ok());
    }

    #[test]
    fn permanent_licence_has_no_expiry() {
        let mut payload = valid_payload_json();
        payload["expires_on"] = serde_json::Value::Null;
        let key = build_key(&payload);
        let parsed = parse_key(&key).expect("permanent licence must parse");
        assert!(parsed.payload.expires_on.is_none());
    }

    #[test]
    fn malformed_vs_invalid_classification() {
        assert!(KeyError::BadPrefix.is_malformed());
        assert!(KeyError::BadParts.is_malformed());
        assert!(KeyError::BadBase64.is_malformed());
        assert!(KeyError::BadJson.is_malformed());
        assert!(KeyError::TooLong.is_malformed());
        assert!(!KeyError::UnsupportedVersion.is_malformed());
        assert!(!KeyError::BadField("licence_id").is_malformed());
    }
}
