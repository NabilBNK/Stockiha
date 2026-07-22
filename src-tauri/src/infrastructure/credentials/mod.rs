//! S0-005 — Windows Credential Manager proof.
//!
//! Crate-private storage of **password bytes only** in the current Windows
//! user's Credential Manager (generic credentials, local-machine persistence).
//! This module deliberately stores nothing but the secret blob: no PostgreSQL
//! URLs, owner/superuser credentials, hostnames, ports, or database
//! configuration ever pass through here.
//!
//! Layering:
//! - This file holds the **platform-independent** contract: the fixed set of
//!   allowed credential targets ([`CredentialTarget`]), blob validation, and
//!   the redacted error type ([`CredentialError`]). It compiles and is unit
//!   tested on every platform.
//! - [`windows`] holds the Win32 FFI (`CredWriteW`/`CredReadW`/`CredDeleteW`)
//!   and is compiled only on Windows. The live round-trip test lives there.
//!
//! Security posture:
//! - Target names are a closed enum — arbitrary target strings are impossible
//!   by construction.
//! - Secret buffers are zeroized: `read_secret` returns a [`SecretBytes`]
//!   wrapper whose `Debug` is redacted and whose contents are never exposed.
//! - Empty and oversized blobs are rejected before any Win32 call.
//! - [`CredentialError`] carries no secret or target text; its `Debug`/
//!   `Display` are redacted to fixed category strings.
//! - Secrets and target values are never logged.

use core::fmt;
use zeroize::Zeroizing;

// The Win32 operations `write_secret` / `read_secret` / `delete_secret` live in
// this submodule.
#[cfg(windows)]
pub(crate) mod windows;

// S0-009 is the first real consumer: it reads the `stockiha_backup` password
// to authenticate `pg_dump` without ever putting it in argv or a connection
// URL. `write_secret`/`delete_secret` still have no consumer, so they stay
// reachable only via `windows::` and are not re-exported here.
#[cfg(windows)]
pub(crate) use windows::read_secret;

/// Maximum secret blob size accepted for a write, in bytes.
///
/// Matches the Win32 `CRED_MAX_CREDENTIAL_BLOB_SIZE` limit (5 × 512). Larger
/// blobs are rejected before any Win32 call rather than failing opaquely
/// inside `CredWriteW`.
pub(crate) const MAX_SECRET_LEN: usize = 5 * 512;

/// A zeroizing container for secret bytes read from the credential store.
///
/// Wraps `Zeroizing<Vec<u8>>` so the buffer is wiped on drop, and hides the
/// contents entirely: `Debug` is a fixed redacted string, and there is no
/// `Display`, `Serialize`, or `Clone`. Internal callers read the bytes through
/// [`AsRef<[u8]>`] only.
pub(crate) struct SecretBytes(Zeroizing<Vec<u8>>);

impl SecretBytes {
    /// Wrap owned bytes; the buffer is zeroized when the `SecretBytes` drops.
    pub(crate) fn from_vec(bytes: Vec<u8>) -> Self {
        Self(Zeroizing::new(bytes))
    }
}

impl AsRef<[u8]> for SecretBytes {
    fn as_ref(&self) -> &[u8] {
        &self.0
    }
}

impl fmt::Debug for SecretBytes {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // Never render the contents — not even the length.
        f.write_str("SecretBytes(<redacted>)")
    }
}

/// The fixed, closed set of credential targets Stockiha may address.
///
/// Encoding the targets as an enum makes arbitrary target names unrepresentable
/// — callers cannot pass a free-form string. Each maps to a stable Credential
/// Manager target name.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum CredentialTarget {
    /// `stockiha_runtime` role password.
    Runtime,
    /// `stockiha_migrator` role password.
    Migrator,
    /// `stockiha_backup` role password.
    Backup,
    /// Dedicated target used only by the S0-005 proof's live round-trip test.
    #[cfg(test)]
    TestCredential,
}

impl CredentialTarget {
    /// The stable Credential Manager target name for this credential.
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            CredentialTarget::Runtime => "Stockiha/PostgreSQL/runtime/password",
            CredentialTarget::Migrator => "Stockiha/PostgreSQL/migrator/password",
            CredentialTarget::Backup => "Stockiha/PostgreSQL/backup/password",
            #[cfg(test)]
            CredentialTarget::TestCredential => "Stockiha/S0-005/TestCredential",
        }
    }
}

/// Errors from credential storage operations.
///
/// Carries no secret bytes and no target string. `Debug` and `Display` are
/// hand-written to emit only fixed, non-sensitive category text; any numeric
/// detail (e.g. an OS status) stays inspectable by trusted in-crate code via
/// pattern matching but is never rendered.
pub(crate) enum CredentialError {
    /// The secret blob was empty.
    EmptySecret,
    /// The secret blob exceeded [`MAX_SECRET_LEN`].
    SecretTooLarge,
    /// No credential exists for the target (maps `ERROR_NOT_FOUND`).
    NotFound,
    /// `CredReadW` reported a non-zero blob size but a null blob pointer — a
    /// malformed stored record. Carries no detail.
    #[cfg(windows)]
    InvalidStoredCredential,
    /// A Win32 credential API failed with the contained status code. The code
    /// is a Windows error number (not sensitive) but is never rendered by
    /// `Debug`/`Display`; trusted code may read it by matching.
    #[cfg(windows)]
    Os(u32),
}

impl fmt::Debug for CredentialError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // Fixed, payload-free text. Never prints a secret, target, or dynamic
        // value — so accidental `{:?}` logging cannot leak anything sensitive.
        let text = match self {
            CredentialError::EmptySecret => "CredentialError::EmptySecret",
            CredentialError::SecretTooLarge => "CredentialError::SecretTooLarge",
            CredentialError::NotFound => "CredentialError::NotFound",
            #[cfg(windows)]
            CredentialError::InvalidStoredCredential => "CredentialError::InvalidStoredCredential",
            #[cfg(windows)]
            CredentialError::Os(_) => "CredentialError::Os(<redacted>)",
        };
        f.write_str(text)
    }
}

impl fmt::Display for CredentialError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let text = match self {
            CredentialError::EmptySecret => "secret must not be empty",
            CredentialError::SecretTooLarge => "secret exceeds the maximum size",
            CredentialError::NotFound => "credential not found",
            #[cfg(windows)]
            CredentialError::InvalidStoredCredential => "stored credential is invalid",
            #[cfg(windows)]
            CredentialError::Os(_) => "credential store operation failed",
        };
        f.write_str(text)
    }
}

impl std::error::Error for CredentialError {}

/// Validate a secret blob before any platform call: reject empty and oversized
/// blobs. Platform-independent so it is unit-tested everywhere.
pub(crate) fn validate_secret(secret: &[u8]) -> Result<(), CredentialError> {
    if secret.is_empty() {
        return Err(CredentialError::EmptySecret);
    }
    if secret.len() > MAX_SECRET_LEN {
        return Err(CredentialError::SecretTooLarge);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn target_names_are_the_fixed_expected_strings() {
        assert_eq!(
            CredentialTarget::Runtime.as_str(),
            "Stockiha/PostgreSQL/runtime/password"
        );
        assert_eq!(
            CredentialTarget::Migrator.as_str(),
            "Stockiha/PostgreSQL/migrator/password"
        );
        assert_eq!(
            CredentialTarget::Backup.as_str(),
            "Stockiha/PostgreSQL/backup/password"
        );
        assert_eq!(
            CredentialTarget::TestCredential.as_str(),
            "Stockiha/S0-005/TestCredential"
        );
    }

    #[test]
    fn secret_bytes_debug_is_redacted_and_hides_contents() {
        const SENTINEL: &str = "DO_NOT_EXPOSE_DIAGNOSTIC";
        let secret = SecretBytes::from_vec(SENTINEL.as_bytes().to_vec());
        let debug = format!("{secret:?}");
        assert_eq!(debug, "SecretBytes(<redacted>)");
        assert!(
            !debug.contains(SENTINEL),
            "SecretBytes Debug must never contain the secret contents"
        );
        // Internal byte access remains available for trusted callers.
        assert_eq!(secret.as_ref(), SENTINEL.as_bytes());
    }

    #[test]
    fn validate_secret_rejects_empty() {
        assert!(matches!(
            validate_secret(&[]),
            Err(CredentialError::EmptySecret)
        ));
    }

    #[test]
    fn validate_secret_rejects_oversized() {
        let too_big = vec![0u8; MAX_SECRET_LEN + 1];
        assert!(matches!(
            validate_secret(&too_big),
            Err(CredentialError::SecretTooLarge)
        ));
    }

    #[test]
    fn validate_secret_accepts_one_byte_and_exact_max() {
        assert!(validate_secret(&[0x42]).is_ok());
        let exact = vec![0u8; MAX_SECRET_LEN];
        assert!(validate_secret(&exact).is_ok());
    }

    #[test]
    fn debug_and_display_are_redacted_fixed_text() {
        // Neither representation carries dynamic content, so nothing sensitive
        // (secret bytes or target names) can ever appear in logs/panics.
        let cases: [(CredentialError, &str, &str); 3] = [
            (
                CredentialError::EmptySecret,
                "CredentialError::EmptySecret",
                "secret must not be empty",
            ),
            (
                CredentialError::SecretTooLarge,
                "CredentialError::SecretTooLarge",
                "secret exceeds the maximum size",
            ),
            (
                CredentialError::NotFound,
                "CredentialError::NotFound",
                "credential not found",
            ),
        ];
        for (err, expected_debug, expected_display) in cases {
            assert_eq!(format!("{err:?}"), expected_debug);
            assert_eq!(format!("{err}"), expected_display);
        }
    }
}
