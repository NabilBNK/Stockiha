//! WS-K-6 — the forced/optional update policy, fetched separately from
//! `tauri-plugin-updater`'s own signed, versioned manifest.
//!
//! # Why a second file
//!
//! Tauri's updater manifest format (`latest.json`) has no field for "is this
//! update mandatory" — and more importantly, its `signature` field covers
//! the downloaded *installer*, not the manifest JSON itself, so the manifest
//! is not something a compromised or careless edit to it could use to
//! smuggle unsigned code onto a machine; only a real Ed25519/minisign
//! signature over the actual installer bytes ever lets an update install.
//! That gave two honest choices: add an extra field to `latest.json` and
//! hope `tauri-plugin-updater`'s own deserializer tolerates unknown fields
//! (true today, but an internal implementation detail of a dependency we do
//! not control, not a contract), or fetch a second, tiny, deliberately
//! separate file. The second is what this module does — the Owner edits one
//! small JSON file on the host (`update-policy.json`) to flip a release
//! between optional and forced, no rebuild, no new signature, and no
//! dependence on how a third-party crate happens to parse JSON today.
//!
//! # Fail-safe, not fail-open, in the specific sense that matters here
//!
//! Every failure mode — no internet, the file is missing, the JSON is
//! malformed, the request times out — resolves to [`UpdateMode::Optional`].
//! An update the app cannot reach is never treated as more urgent than one
//! it can; the one thing this must never do is turn a fetch failure into an
//! accidental forced prompt. This mirrors the fail-open posture
//! `schema_version`'s own module doc describes for a different reason (an
//! inconclusive check must never escalate), applied here to a different
//! axis (urgency, not blocking).
//!
//! # No secret, no CSP change
//!
//! This performs its own HTTPS GET entirely in Rust (`reqwest`), the same
//! way `tauri-plugin-updater` performs its manifest fetch entirely in Rust —
//! neither ever goes through the webview's own `fetch`, so `tauri.conf.
//! json`'s strict CSP (`connect-src 'self' ipc: ...`) needs no loosening for
//! either. The policy file itself carries no secret and requires no
//! authentication; it is served publicly from the same host as the
//! installer, exactly as the installer must be (the app cannot hold a
//! credential to present to a private bucket).

use serde::{Deserialize, Serialize};
use std::time::Duration;

/// How urgently a newer version should be presented. Mirrors the `mode`
/// field of `update-policy.json` exactly; an unrecognized string value (a
/// typo in the file, or a future value this build predates) falls back to
/// [`UpdateMode::Optional`] via `#[serde(other)]` — the same fail-safe
/// direction as every other failure this module handles, rather than
/// rejecting the whole fetch over one bad field.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UpdateMode {
    Optional,
    Forced,
    #[serde(other)]
    UnknownDefaultsToOptional,
}

impl UpdateMode {
    fn normalized(self) -> UpdateMode {
        match self {
            UpdateMode::UnknownDefaultsToOptional => UpdateMode::Optional,
            other => other,
        }
    }
}

#[derive(Deserialize)]
struct PolicyFile {
    mode: UpdateMode,
}

/// What the frontend actually needs: whether the fetch itself succeeded
/// (shown nowhere to the operator — this is diagnostic only, e.g. for a
/// developer checking why a forced release did not appear forced) and the
/// resolved mode, always present and always safe to act on directly.
#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePolicyResult {
    pub mode: UpdateMode,
    pub fetched: bool,
}

const FETCH_TIMEOUT: Duration = Duration::from_secs(10);

/// Fetch and parse `update-policy.json` from `url`. Infallible by design —
/// every failure resolves to `{ mode: Optional, fetched: false }` rather
/// than propagating an error the caller would have to decide how to treat;
/// see the module doc comment for why "could not determine" and "explicitly
/// optional" must produce the identical, safe outcome here.
pub async fn fetch_update_policy(url: &str) -> UpdatePolicyResult {
    let client = match reqwest::Client::builder().timeout(FETCH_TIMEOUT).build() {
        Ok(client) => client,
        Err(_) => {
            return UpdatePolicyResult {
                mode: UpdateMode::Optional,
                fetched: false,
            }
        }
    };

    let outcome = client.get(url).send().await;
    let mode = match outcome {
        Ok(response) if response.status().is_success() => {
            match response.json::<PolicyFile>().await {
                Ok(file) => Some(file.mode.normalized()),
                Err(_) => None,
            }
        }
        _ => None,
    };

    match mode {
        Some(mode) => UpdatePolicyResult {
            mode,
            fetched: true,
        },
        None => UpdatePolicyResult {
            mode: UpdateMode::Optional,
            fetched: false,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn forced_and_optional_round_trip() {
        let forced: PolicyFile = serde_json::from_str(r#"{"mode":"forced"}"#).unwrap();
        assert_eq!(forced.mode.normalized(), UpdateMode::Forced);

        let optional: PolicyFile = serde_json::from_str(r#"{"mode":"optional"}"#).unwrap();
        assert_eq!(optional.mode.normalized(), UpdateMode::Optional);
    }

    /// The fail-safe contract's core promise: an unrecognized mode string
    /// (a typo, or a future value this build predates) must normalize to
    /// `Optional`, never to `Forced` — an unknown value must never be
    /// treated as MORE urgent than a known one.
    #[test]
    fn unrecognized_mode_value_defaults_to_optional_not_forced() {
        let weird: PolicyFile = serde_json::from_str(r#"{"mode":"URGENT!!"}"#).unwrap();
        assert_eq!(weird.mode.normalized(), UpdateMode::Optional);
    }

    #[test]
    fn malformed_json_is_not_a_panic() {
        let result: Result<PolicyFile, _> = serde_json::from_str("{ this is not json");
        assert!(result.is_err());
    }

    #[test]
    fn missing_mode_field_is_not_a_panic() {
        let result: Result<PolicyFile, _> = serde_json::from_str(r#"{"other_field": true}"#);
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn unreachable_host_resolves_to_optional_not_fetched() {
        // Port 1 on loopback: nothing listens there, so this fails fast
        // (connection refused) rather than waiting out the real timeout —
        // proving the "could not fetch" path without a slow test.
        let result = fetch_update_policy("http://127.0.0.1:1/update-policy.json").await;
        assert_eq!(result.mode, UpdateMode::Optional);
        assert!(!result.fetched);
    }

    #[tokio::test]
    async fn malformed_url_resolves_to_optional_not_fetched_rather_than_panicking() {
        let result = fetch_update_policy("not a url at all").await;
        assert_eq!(result.mode, UpdateMode::Optional);
        assert!(!result.fetched);
    }
}
