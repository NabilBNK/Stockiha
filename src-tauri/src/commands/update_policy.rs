//! WS-K-6 — thin Tauri command exposing the forced/optional update policy.
//!
//! Owns no logic beyond resolving the fixed policy URL and delegating to
//! `infrastructure::update_policy::fetch_update_policy`, which is already
//! infallible by design. Kept as its own command (not folded into the
//! updater plugin's own `check` call) because it fetches a different file
//! from a different concern — see that module's doc comment.

use crate::infrastructure::update_policy::{self, UpdatePolicyResult};

/// Where `update-policy.json` lives. Same host/bucket as the installer and
/// `latest.json` (see `tauri.conf.json`'s `plugins.updater.endpoints`) — a
/// sibling file, not a versioned one, so the Owner edits this one file to
/// change any release's urgency without touching the signed manifest at
/// all. **Placeholder**: replace the domain here (and in `tauri.conf.json`)
/// with the Owner's real subdomain before the first real release — see
/// `WS-K-6-RELEASE-PROCESS.md`.
const UPDATE_POLICY_URL: &str =
    "https://updates.PLACEHOLDER-REPLACE-WITH-YOUR-DOMAIN.com/update-policy.json";

#[tauri::command]
pub(crate) async fn get_update_policy() -> UpdatePolicyResult {
    update_policy::fetch_update_policy(UPDATE_POLICY_URL).await
}
