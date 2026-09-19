//! WS-K-6 — thin Tauri command exposing the forced/optional update policy.
//!
//! Owns no logic beyond resolving the fixed policy URL and delegating to
//! `infrastructure::update_policy::fetch_update_policy`, which is already
//! infallible by design. Kept as its own command (not folded into the
//! updater plugin's own `check` call) because it fetches a different file
//! from a different concern — see that module's doc comment.

use crate::infrastructure::update_policy::{self, UpdatePolicyResult};

/// Where `update-policy.json` lives: the same public, source-free
/// `Stockiha-releases` repository as the installer and `latest.json` (see
/// `tauri.conf.json`'s `plugins.updater.endpoints`), fetched as a raw file
/// rather than a release asset — a sibling file, not a versioned one, so
/// the Owner edits this one file (a plain commit to that repository) to
/// change any release's urgency without touching the signed manifest at
/// all.
const UPDATE_POLICY_URL: &str =
    "https://raw.githubusercontent.com/NabilBNK/Stockiha-releases/main/update-policy.json";

#[tauri::command]
pub(crate) async fn get_update_policy() -> UpdatePolicyResult {
    update_policy::fetch_update_policy(UPDATE_POLICY_URL).await
}
