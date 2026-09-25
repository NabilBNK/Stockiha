//! WS-K-7 — Ed25519/minisign signature verification (plan §3.4).
//!
//! Mirrors `tauri-plugin-updater`'s own verification step for step (see
//! `tests/update_signature_verification.rs`, which proves that mechanism
//! against the real plugin), using the same `minisign-verify` crate — now
//! promoted to a runtime dependency for this purpose (see `Cargo.toml`'s
//! WS-K-7 comment). This module only ever verifies, never signs: the
//! private licence-signing key never exists inside this application.

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;

/// Any failure at any step of verification — bad key encoding, bad
/// signature encoding, or a signature that genuinely does not match. No
/// variant carries detail: the caller (evaluator/runtime) maps this
/// uniformly to `LICENCE_INVALID` (plan §3.4), and nothing here is ever
/// logged beyond the fact that verification failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct BadSignature;

/// Verify `payload_bytes` against `sig_file_bytes` (the raw bytes of the
/// `.sig` file `tauri signer sign` writes) using `public_key_text` (the
/// contents of a `.key.pub` file — itself base64-encoded, plan §3.4).
pub(crate) fn verify(
    public_key_text: &str,
    payload_bytes: &[u8],
    sig_file_bytes: &[u8],
) -> Result<(), BadSignature> {
    let pk_bytes = STANDARD
        .decode(public_key_text.trim())
        .map_err(|_| BadSignature)?;
    let pk_text = String::from_utf8(pk_bytes).map_err(|_| BadSignature)?;
    let public_key = minisign_verify::PublicKey::decode(&pk_text).map_err(|_| BadSignature)?;

    let sig_file_text = std::str::from_utf8(sig_file_bytes).map_err(|_| BadSignature)?;
    let sig_bytes = STANDARD
        .decode(sig_file_text.trim())
        .map_err(|_| BadSignature)?;
    let sig_text = String::from_utf8(sig_bytes).map_err(|_| BadSignature)?;
    let signature = minisign_verify::Signature::decode(&sig_text).map_err(|_| BadSignature)?;

    // `true` = accept prehashed, matching `tauri-plugin-updater`'s own
    // `verify_signature` call exactly (see
    // `tests/update_signature_verification.rs`'s `ALLOW_LEGACY` constant).
    public_key
        .verify(payload_bytes, &signature, true)
        .map_err(|_| BadSignature)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Reuses the exact real-tool-generated fixtures already proven against
    // the live `minisign-verify` crate in
    // `tests/update_signature_verification.rs`, so this module's own tests
    // need no new fixture generation — only the wiring in `verify` above is
    // under test here.
    const FIXTURE_PAYLOAD: &[u8] = b"WS-K-6 test fixture payload - not a real installer\n";
    const FIXTURE_PUBLIC_KEY_B64: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDMxQTI3NjZERjcyNjQxMDcKUldRSFFTYjNiWGFpTWZqeGJob1plVWw3bEozWmwwZDM1dllzdVlLWDNLOVF2eVhzSkg0b2Nrd1YK";
    const FIXTURE_VALID_SIGNATURE_B64: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVRSFFTYjNiWGFpTVZJbGZybjg0VGdldTNjOWsxa0Erb0tuZjIzd3FzL1RqVzNrRW5GSDkwTGQzcWpCbTRwamRhYXJISk1yTmFtUFZ2cUtyRWg5bFE0emVvT2pUMjVUWGdRPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzg5NDUwMTIxCWZpbGU6Zml4dHVyZS1wYXlsb2FkLmJpbgoyWnVTVVhNamY3ZnArTUc4Q3EzK05TWlE4U3FzdW9QOUhvT08yc2JacytLUHlFaC85a2RZN2lhOXBWTGY3RDRhSkdhdXZDMzNRR0N4NzFVTFN4aElBQT09Cg==";
    const APP_REAL_PUBLIC_KEY_B64: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEQ3N0I1MUM0NzU3MjBBMjAKUldRZ0NuSjF4RkY3MTNRTjRmdlRHcTVZckN6ZjlkYml6a2c5UFpQVTJqWGw0L3JQQ29WZG9jRU0K";

    #[test]
    fn genuine_payload_and_signature_verify_against_the_matching_key() {
        verify(
            FIXTURE_PUBLIC_KEY_B64,
            FIXTURE_PAYLOAD,
            FIXTURE_VALID_SIGNATURE_B64.as_bytes(),
        )
        .expect("a real signature over the exact payload it was made for must verify");
    }

    #[test]
    fn tampered_payload_fails() {
        let mut tampered = FIXTURE_PAYLOAD.to_vec();
        tampered[0] ^= 0xFF;
        assert!(verify(
            FIXTURE_PUBLIC_KEY_B64,
            &tampered,
            FIXTURE_VALID_SIGNATURE_B64.as_bytes()
        )
        .is_err());
    }

    #[test]
    fn valid_signature_checked_against_a_different_public_key_fails() {
        assert!(verify(
            APP_REAL_PUBLIC_KEY_B64,
            FIXTURE_PAYLOAD,
            FIXTURE_VALID_SIGNATURE_B64.as_bytes()
        )
        .is_err());
    }

    #[test]
    fn garbage_public_key_text_fails_cleanly_rather_than_panicking() {
        assert!(verify(
            "not base64 at all",
            FIXTURE_PAYLOAD,
            FIXTURE_VALID_SIGNATURE_B64.as_bytes()
        )
        .is_err());
    }

    #[test]
    fn garbage_signature_bytes_fail_cleanly_rather_than_panicking() {
        assert!(verify(
            FIXTURE_PUBLIC_KEY_B64,
            FIXTURE_PAYLOAD,
            b"not a signature file"
        )
        .is_err());
    }
}
