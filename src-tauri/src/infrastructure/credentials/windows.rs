//! S0-005 — Windows Credential Manager FFI (compiled on Windows only).
//!
//! Implements `write_secret` / `read_secret` / `delete_secret` over the Win32
//! generic-credential API using `windows-sys`. Only password bytes are stored,
//! under the fixed [`CredentialTarget`] names, with local-machine persistence.
//!
//! Invariants upheld here:
//! - Blobs are validated (non-empty, within [`MAX_SECRET_LEN`]) before any
//!   Win32 call.
//! - On every successful `CredReadW`, its allocated buffer is released with
//!   `CredFree` **exactly once**; the copied-out blob memory is zeroized first.
//! - `ERROR_NOT_FOUND` is mapped to [`CredentialError::NotFound`]; other Win32
//!   failures carry only the numeric status (never a secret or target).
//! - Read secrets are returned in a [`SecretBytes`] wrapper (redacted `Debug`).

use super::{validate_secret, CredentialError, CredentialTarget, SecretBytes, MAX_SECRET_LEN};
use core::ffi::c_void;
use core::ptr;
use zeroize::Zeroize;

use windows_sys::Win32::Foundation::{GetLastError, ERROR_NOT_FOUND, FILETIME};
use windows_sys::Win32::Security::Credentials::{
    CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE,
    CRED_TYPE_GENERIC,
};

/// Encode a target name as a NUL-terminated UTF-16 buffer for the `*W` APIs.
fn wide_nul(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(core::iter::once(0)).collect()
}

/// Write (create or overwrite) the password blob for `target`.
///
/// Rejects empty/oversized blobs before touching Win32. The caller retains
/// ownership of `secret`; `CredWriteW` copies it synchronously, so no extra
/// long-lived copy is made here.
pub(crate) fn write_secret(target: CredentialTarget, secret: &[u8]) -> Result<(), CredentialError> {
    validate_secret(secret)?;

    let mut target_wide = wide_nul(target.as_str());
    // Validated above: `secret.len() <= MAX_SECRET_LEN` fits in u32.
    debug_assert!(secret.len() <= MAX_SECRET_LEN);

    let credential = CREDENTIALW {
        Flags: 0,
        Type: CRED_TYPE_GENERIC,
        TargetName: target_wide.as_mut_ptr(),
        Comment: ptr::null_mut(),
        LastWritten: FILETIME {
            dwLowDateTime: 0,
            dwHighDateTime: 0,
        },
        CredentialBlobSize: secret.len() as u32,
        // CredWriteW does not mutate the blob; the cast to `*mut` is required by
        // the struct field type only.
        CredentialBlob: secret.as_ptr() as *mut u8,
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        AttributeCount: 0,
        Attributes: ptr::null_mut(),
        TargetAlias: ptr::null_mut(),
        UserName: ptr::null_mut(),
    };

    // SAFETY: `credential` is fully initialized; `TargetName` points at a
    // NUL-terminated buffer live for the call; the blob pointer/len are
    // consistent. `CredWriteW` reads (does not retain) both.
    let ok = unsafe { CredWriteW(&credential, 0) };
    if ok == 0 {
        return Err(last_os_error());
    }
    Ok(())
}

/// Read the password blob for `target`, returned in a [`SecretBytes`] wrapper.
///
/// Maps `ERROR_NOT_FOUND` to [`CredentialError::NotFound`]. On every successful
/// `CredReadW` the allocated record is freed with `CredFree` exactly once, and
/// the Win32-owned blob memory is zeroized before that free. A non-zero blob
/// size with a null blob pointer yields [`CredentialError::InvalidStoredCredential`].
pub(crate) fn read_secret(target: CredentialTarget) -> Result<SecretBytes, CredentialError> {
    let target_wide = wide_nul(target.as_str());
    let mut credential: *mut CREDENTIALW = ptr::null_mut();

    // SAFETY: `target_wide` is a live NUL-terminated buffer; `credential` is a
    // valid out-pointer. On success Win32 allocates `*credential`, which we
    // release with `CredFree` below on every path before returning.
    let ok = unsafe { CredReadW(target_wide.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential) };
    if ok == 0 {
        return Err(last_os_error());
    }

    // SAFETY: `CredReadW` succeeded, so `credential` points at a valid record.
    let cred_ref = unsafe { &*credential };
    let len = cred_ref.CredentialBlobSize as usize;
    let blob = cred_ref.CredentialBlob;

    // Compute the result while the record is still allocated, then free exactly
    // once below regardless of which branch we take.
    let result = if len == 0 {
        Ok(SecretBytes::from_vec(Vec::new()))
    } else if blob.is_null() {
        Err(CredentialError::InvalidStoredCredential)
    } else {
        let mut copied = vec![0u8; len];
        // SAFETY: the source has `len` valid bytes (per `CredentialBlobSize`);
        // `copied` has exactly `len` bytes; the regions do not overlap.
        unsafe { ptr::copy_nonoverlapping(blob, copied.as_mut_ptr(), len) };
        // Zero the Win32-owned blob memory before it is freed, so the released
        // heap block does not retain the password. SAFETY: `blob` points at
        // `len` valid, uniquely-referenced bytes still owned by the record.
        unsafe { core::slice::from_raw_parts_mut(blob, len).zeroize() };
        Ok(SecretBytes::from_vec(copied))
    };

    // SAFETY: `credential` was allocated by `CredReadW`; freed exactly once here
    // on every successful-read path.
    unsafe { CredFree(credential as *const c_void) };

    result
}

/// Delete the credential for `target`. Maps `ERROR_NOT_FOUND` to
/// [`CredentialError::NotFound`].
pub(crate) fn delete_secret(target: CredentialTarget) -> Result<(), CredentialError> {
    let target_wide = wide_nul(target.as_str());

    // SAFETY: `target_wide` is a live NUL-terminated buffer.
    let ok = unsafe { CredDeleteW(target_wide.as_ptr(), CRED_TYPE_GENERIC, 0) };
    if ok == 0 {
        return Err(last_os_error());
    }
    Ok(())
}

/// Translate the current thread's last Win32 error into a [`CredentialError`],
/// mapping `ERROR_NOT_FOUND` specially.
fn last_os_error() -> CredentialError {
    // SAFETY: `GetLastError` is always safe to call.
    let code = unsafe { GetLastError() };
    if code == ERROR_NOT_FOUND {
        CredentialError::NotFound
    } else {
        CredentialError::Os(code)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn os_error_exposes_code_to_trusted_code_but_redacts_rendering() {
        // Trusted in-crate code can read the Win32 status by matching...
        match CredentialError::Os(1234) {
            CredentialError::Os(code) => assert_eq!(code, 1234),
            _ => panic!("expected CredentialError::Os"),
        }
        // ...but Debug/Display never render it.
        assert_eq!(
            format!("{:?}", CredentialError::Os(1234)),
            "CredentialError::Os(<redacted>)"
        );
        assert_eq!(
            format!("{}", CredentialError::Os(1234)),
            "credential store operation failed"
        );
    }
}

#[cfg(test)]
mod live_tests {
    use super::*;

    /// Deletes the test credential on drop so the live target is cleaned up
    /// even if an assertion panics mid-test.
    struct TestCredentialCleanup;

    impl Drop for TestCredentialCleanup {
        fn drop(&mut self) {
            // Ignore the result: absence (NotFound) is an acceptable end state.
            let _ = delete_secret(CredentialTarget::TestCredential);
        }
    }

    /// Full write/read/overwrite/delete round-trip against the real Windows
    /// Credential Manager. Gated behind both `#[ignore]` and an explicit
    /// environment opt-in so it never runs unattended.
    #[test]
    #[ignore = "requires Windows and STOCKIHA_ALLOW_WINDOWS_CREDENTIAL_TEST=YES"]
    fn live_round_trip() {
        // Explicit opt-in is mandatory: when this ignored test is run without
        // the environment flag it must FAIL (not silently skip), so an
        // accidental `--ignored` run surfaces the missing precondition.
        assert_eq!(
            std::env::var("STOCKIHA_ALLOW_WINDOWS_CREDENTIAL_TEST").as_deref(),
            Ok("YES"),
            "live credential test requires STOCKIHA_ALLOW_WINDOWS_CREDENTIAL_TEST=YES"
        );

        let target = CredentialTarget::TestCredential;
        let _cleanup = TestCredentialCleanup;

        let secret_a = SecretBytes::from_vec(b"s0-005-secret-A".to_vec());
        let secret_b = SecretBytes::from_vec(b"s0-005-secret-B-overwrite".to_vec());

        // 1. Start from a clean slate (absence is fine).
        match delete_secret(target) {
            Ok(()) | Err(CredentialError::NotFound) => {}
            Err(other) => panic!("pre-clean failed: {other}"),
        }

        // 2 + 3. Write A, read A back.
        write_secret(target, secret_a.as_ref()).expect("write A must succeed");
        let read_a = read_secret(target).expect("read A must succeed");
        assert_eq!(
            read_a.as_ref(),
            secret_a.as_ref(),
            "read A must equal written A"
        );

        // 4 + 5. Overwrite with B, read B back.
        write_secret(target, secret_b.as_ref()).expect("overwrite with B must succeed");
        let read_b = read_secret(target).expect("read B must succeed");
        assert_eq!(
            read_b.as_ref(),
            secret_b.as_ref(),
            "read B must equal written B"
        );

        // 6. Delete.
        delete_secret(target).expect("delete must succeed");

        // 7. Confirm the credential is gone.
        assert!(
            matches!(read_secret(target), Err(CredentialError::NotFound)),
            "read after delete must be NotFound"
        );

        // 8. Explicit cleanup is also handled by `_cleanup` on drop.
    }
}
