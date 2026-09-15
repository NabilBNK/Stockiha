//! WS-K-6 — proof that a tampered update cannot install.
//!
//! The single most important security property of the whole
//! internet-delivered-update chain is that a file the app did not itself
//! produce a valid signature for is refused, unconditionally. This is
//! `tauri-plugin-updater`'s own responsibility, not this crate's — but that
//! plugin's `UpdaterBuilder::new` is `pub(crate)` and requires a live
//! `&AppHandle`, so it cannot be exercised headlessly from an external
//! test. What *can* be tested directly, and is exactly what that plugin
//! calls internally (confirmed by reading its source — `updater.rs`'s
//! `verify_signature` function, reproduced step for step below, down to the
//! double base64 layer and `allow_legacy: true`), is the `minisign-verify`
//! crate itself, using a real Ed25519/minisign keypair — not a hand-rolled
//! stand-in for one.
//!
//! # Fixture provenance
//!
//! Generated once, offline, via the real Tauri CLI (`tauri signer
//! generate` / `tauri signer sign`) against a disposable, throwaway keypair
//! made ONLY for this test — never the Owner's real update-signing key,
//! which never appears in this repository at all (see
//! `WS-K-6-SIGNING-KEYS.md`). The payload, public key, and signature
//! below are that real tool's real output, copied verbatim; nothing here is
//! synthesized or approximated.

use base64::Engine;

const FIXTURE_PAYLOAD: &[u8] = b"WS-K-6 test fixture payload - not a real installer\n";

const FIXTURE_PUBLIC_KEY_B64: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDMxQTI3NjZERjcyNjQxMDcKUldRSFFTYjNiWGFpTWZqeGJob1plVWw3bEozWmwwZDM1dllzdVlLWDNLOVF2eVhzSkg0b2Nrd1YK";

const FIXTURE_VALID_SIGNATURE_B64: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVRSFFTYjNiWGFpTVZJbGZybjg0VGdldTNjOWsxa0Erb0tuZjIzd3FzL1RqVzNrRW5GSDkwTGQzcWpCbTRwamRhYXJISk1yTmFtUFZ2cUtyRWg5bFE0emVvT2pUMjVUWGdRPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzg5NDUwMTIxCWZpbGU6Zml4dHVyZS1wYXlsb2FkLmJpbgoyWnVTVVhNamY3ZnArTUc4Q3EzK05TWlE4U3FzdW9QOUhvT08yc2JacytLUHlFaC85a2RZN2lhOXBWTGY3RDRhSkdhdXZDMzNRR0N4NzFVTFN4aElBQT09Cg==";

/// The REAL public key configured in `tauri.conf.json`'s
/// `plugins.updater.pubkey` for this application — copied verbatim from
/// that file. Used only as "a different, real, legitimate key" in the
/// wrong-key test below; the fixture above was never signed with it, and
/// the private half of this one is not, and must never be, in this
/// repository (see `WS-K-6-SIGNING-KEYS.md`).
const APP_REAL_PUBLIC_KEY_B64: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEQ3N0I1MUM0NzU3MjBBMjAKUldRZ0NuSjF4RkY3MTNRTjRmdlRHcTVZckN6ZjlkYml6a2c5UFpQVTJqWGw0L3JQQ29WZG9jRU0K";

/// Reverses one layer of base64: `tauri.conf.json`'s `pubkey` and a
/// manifest's `signature` field are both base64 of the *plain multi-line
/// minisign text* — one layer of encoding beyond what `PublicKey::decode`/
/// `Signature::decode` expect directly. Named after, and copied step for
/// step from, `tauri-plugin-updater`'s own private `base64_to_string`
/// helper in `updater.rs`.
fn base64_to_string(b64: &str) -> String {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .expect("fixture value must be valid base64 - it is real tauri-cli output");
    String::from_utf8(bytes).expect("decoded value must be UTF-8")
}

fn decode(
    pubkey_b64: &str,
    signature_b64: &str,
) -> (minisign_verify::PublicKey, minisign_verify::Signature) {
    let key = minisign_verify::PublicKey::decode(&base64_to_string(pubkey_b64))
        .expect("fixture public key must decode - it is real tauri-cli output");
    let sig = minisign_verify::Signature::decode(&base64_to_string(signature_b64))
        .expect("fixture signature must decode - it is real tauri-cli output");
    (key, sig)
}

/// `true` everywhere below: `tauri-plugin-updater`'s own `verify_signature`
/// calls `public_key.verify(data, &signature, true)` — matched exactly
/// here, since the point of this file is testing the real mechanism, not a
/// stricter one of this test's own invention.
const ALLOW_LEGACY: bool = true;

/// The baseline: an untampered payload, its real signature, and the
/// matching public key verify successfully. Without this passing, none of
/// the rejection tests below would mean anything (they could be "failing"
/// for an unrelated reason, like a malformed fixture).
#[test]
fn a_genuine_signature_over_the_genuine_payload_verifies() {
    let (key, sig) = decode(FIXTURE_PUBLIC_KEY_B64, FIXTURE_VALID_SIGNATURE_B64);
    key.verify(FIXTURE_PAYLOAD, &sig, ALLOW_LEGACY)
        .expect("a real signature over the exact payload it was made for must verify");
}

/// The core proof this file exists for: change one byte of the "installer"
/// (simulating a tampered download, a corrupted transfer, or a
/// man-in-the-middle substitution) and the same, otherwise-valid signature
/// must be rejected.
#[test]
fn a_tampered_payload_is_rejected_even_with_the_genuine_signature() {
    let (key, sig) = decode(FIXTURE_PUBLIC_KEY_B64, FIXTURE_VALID_SIGNATURE_B64);
    let mut tampered = FIXTURE_PAYLOAD.to_vec();
    let last = tampered.len() - 1;
    tampered[last] ^= 0xFF;
    let result = key.verify(&tampered, &sig, ALLOW_LEGACY);
    assert!(
        result.is_err(),
        "a single-byte-tampered payload must never verify against the original signature"
    );
}

/// A corrupted or forged signature over the genuine, untouched payload must
/// also be rejected — covers the case where an attacker leaves the
/// installer alone but substitutes a different signature blob.
#[test]
fn a_corrupted_signature_is_rejected_even_over_the_genuine_payload() {
    let (key, _valid_sig) = decode(FIXTURE_PUBLIC_KEY_B64, FIXTURE_VALID_SIGNATURE_B64);

    // Corrupt one byte inside the decoded multi-line minisign text's first
    // base64 line (the actual signature bytes), not the fixed comment
    // lines, so it still *decodes* as a structurally valid signature - the
    // interesting case is a corrupt signature that parses, not one that
    // fails to parse at all.
    let plain = base64_to_string(FIXTURE_VALID_SIGNATURE_B64);
    let mut lines: Vec<String> = plain.lines().map(str::to_owned).collect();
    let sig_line = lines[1].chars().collect::<Vec<char>>();
    let mid = sig_line.len() / 2;
    let mut corrupted_line = sig_line.clone();
    corrupted_line[mid] = if corrupted_line[mid] == 'A' { 'B' } else { 'A' };
    lines[1] = corrupted_line.into_iter().collect();
    let corrupted_plain = lines.join("\n") + "\n";

    // `Err` here is also an acceptable outcome: the corruption broke the
    // encoding itself, refused even earlier than signature math - still
    // proves the tampered artifact cannot install.
    if let Ok(sig) = minisign_verify::Signature::decode(&corrupted_plain) {
        let result = key.verify(FIXTURE_PAYLOAD, &sig, ALLOW_LEGACY);
        assert!(
            result.is_err(),
            "a corrupted signature must never verify, even if it still decodes"
        );
    }
}

/// The wrong public key — a real, differently-generated Ed25519/minisign
/// key (this application's own real, deployed public key, not a fake one) —
/// must never validate a signature made by a different private key. Proves
/// key material genuinely matters, not just "some signature is present".
#[test]
fn a_signature_from_a_different_key_is_rejected_by_the_apps_real_public_key() {
    let key = minisign_verify::PublicKey::decode(&base64_to_string(APP_REAL_PUBLIC_KEY_B64))
        .expect("the app's real configured public key must decode");
    let sig = minisign_verify::Signature::decode(&base64_to_string(FIXTURE_VALID_SIGNATURE_B64))
        .expect("fixture signature must decode");
    let result = key.verify(FIXTURE_PAYLOAD, &sig, ALLOW_LEGACY);
    assert!(
        result.is_err(),
        "a signature made by one key must never verify against a different, unrelated public key"
    );
}
