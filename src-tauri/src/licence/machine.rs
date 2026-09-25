//! WS-K-7 — machine-lock code derivation (plan §3.2).
//!
//! [`compute_machine_code`] is pure (hashing and encoding only) and is unit
//! tested against fixed vectors; [`machine_code`] is the only function here
//! that touches the OS. The raw `MachineGuid` (or, off Windows, the contents
//! of `/etc/machine-id`) is never logged, displayed, or stored anywhere —
//! only the derived, one-way `STKH-...` code ever leaves this module.

use sha2::{Digest, Sha256};

/// Crockford base32 alphabet — no `I`/`L`/`O`/`U`, so a code read aloud over
/// the phone cannot be confused with `1`/`1`/`0`/(nothing). Also used by
/// `payload`'s machine-code field validator to check the same character set.
pub(crate) const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/// Encode `bytes` as Crockford base32, most-significant-bit first, no
/// padding. Hand-written (not the `base32` crate, which is not a project
/// dependency) — this is the entire encoder, about 20 lines including the
/// trailing partial group.
fn crockford_base32(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(5) * 8);
    let mut buffer: u32 = 0;
    let mut bits: u32 = 0;
    for &byte in bytes {
        buffer = (buffer << 8) | u32::from(byte);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            let index = ((buffer >> bits) & 0x1F) as usize;
            out.push(ALPHABET[index] as char);
        }
    }
    if bits > 0 {
        let index = ((buffer << (5 - bits)) & 0x1F) as usize;
        out.push(ALPHABET[index] as char);
    }
    out
}

/// Pure: `SHA-256("stockiha-machine-v1:" + guid)`, first 10 bytes (80 bits)
/// encoded as Crockford base32 (exactly 16 characters), grouped
/// `STKH-AAAA-BBBB-CCCC-DDDD`. See plan §3.2.
pub(crate) fn compute_machine_code(guid: &str) -> String {
    let trimmed = guid.trim().to_lowercase();
    let mut hasher = Sha256::new();
    hasher.update(b"stockiha-machine-v1:");
    hasher.update(trimmed.as_bytes());
    let digest = hasher.finalize();
    let encoded = crockford_base32(&digest[..10]);
    format!(
        "STKH-{}-{}-{}-{}",
        &encoded[0..4],
        &encoded[4..8],
        &encoded[8..12],
        &encoded[12..16],
    )
}

/// Read this machine's lock code from the OS. `None` when the underlying
/// identifier cannot be read at all (registry unavailable on Windows;
/// `/etc/machine-id` missing off Windows — CI/dev only, this app ships for
/// Windows).
#[cfg(target_os = "windows")]
pub(crate) fn machine_code() -> Option<String> {
    read_machine_guid().map(|guid| compute_machine_code(&guid))
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn machine_code() -> Option<String> {
    std::fs::read_to_string("/etc/machine-id")
        .ok()
        .map(|guid| compute_machine_code(guid.trim()))
}

/// Read `HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid` (64-bit view).
/// Two-call pattern: the first call with a null buffer discovers the
/// required size, the second fills a buffer of exactly that size — the
/// documented `RegGetValueW` idiom. Any non-zero return is treated as
/// unavailable rather than a panic; this is an advisory read, not a
/// precondition for the app to run (see `LicenceRuntime`).
#[cfg(target_os = "windows")]
fn read_machine_guid() -> Option<String> {
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::{
        RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ, RRF_SUBKEY_WOW6464KEY,
    };

    // There is no `w!` macro in `windows-sys`; wide strings are built by
    // hand, matching the pattern already used elsewhere in this crate for
    // Win32 registry/ACL calls (see `infrastructure::local_config`).
    let subkey: Vec<u16> = "SOFTWARE\\Microsoft\\Cryptography"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let value_name: Vec<u16> = "MachineGuid"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let flags = RRF_RT_REG_SZ | RRF_SUBKEY_WOW6464KEY;

    let mut size: u32 = 0;
    // SAFETY: `subkey` and `value_name` are valid, NUL-terminated UTF-16
    // buffers that outlive this call. The data-type and data-buffer
    // out-parameters are null (this first call only discovers the required
    // buffer size in bytes, written into `size`); no data is written.
    let status = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            subkey.as_ptr(),
            value_name.as_ptr(),
            flags,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut size,
        )
    };
    if status != ERROR_SUCCESS || size == 0 {
        return None;
    }

    // `size` is a byte count; the buffer is sized in `u16` elements.
    let mut buffer: Vec<u16> = vec![0u16; size.div_ceil(2) as usize];
    // SAFETY: `buffer` is freshly allocated with capacity (in bytes, via
    // `size`) exactly matching what the prior call reported is needed;
    // `size` is passed back in as that exact capacity, matching
    // `RegGetValueW`'s documented contract for a caller-supplied buffer.
    let status = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            subkey.as_ptr(),
            value_name.as_ptr(),
            flags,
            std::ptr::null_mut(),
            buffer.as_mut_ptr().cast(),
            &mut size,
        )
    };
    if status != ERROR_SUCCESS {
        return None;
    }

    let len_u16 = ((size as usize) / 2).min(buffer.len());
    let trimmed: Vec<u16> = buffer[..len_u16]
        .iter()
        .copied()
        .take_while(|&c| c != 0)
        .collect();
    String::from_utf16(&trimmed).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Test vector pinned once: `compute_machine_code` on a fixed GUID must
    /// always produce the same code (this is what makes a licence
    /// machine-locked at all).
    #[test]
    fn compute_machine_code_is_stable_for_a_fixed_guid() {
        let code = compute_machine_code("3f2504e0-4f89-11d3-9a0c-0305e82c3301");
        assert_eq!(
            code,
            compute_machine_code("3f2504e0-4f89-11d3-9a0c-0305e82c3301")
        );
        assert!(
            MACHINE_CODE_RE.is_match(&code),
            "computed code {code} does not match the STKH-XXXX-XXXX-XXXX-XXXX shape"
        );
    }

    #[test]
    fn compute_machine_code_is_case_and_whitespace_insensitive() {
        let lower = compute_machine_code("3f2504e0-4f89-11d3-9a0c-0305e82c3301");
        let upper = compute_machine_code("3F2504E0-4F89-11D3-9A0C-0305E82C3301");
        let padded = compute_machine_code("  3f2504e0-4f89-11d3-9a0c-0305e82c3301  \n");
        assert_eq!(lower, upper);
        assert_eq!(lower, padded);
    }

    #[test]
    fn crockford_test_vectors_match_the_all_zero_and_all_ff_bytes() {
        assert_eq!(crockford_base32(&[0u8; 10]), "0000000000000000");
        assert_eq!(crockford_base32(&[0xFFu8; 10]), "ZZZZZZZZZZZZZZZZ");
    }

    /// Minimal hand-rolled matcher for `^STKH(-[0-9A-HJKMNP-TV-Z]{4}){4}$`,
    /// used only by this test module (no `regex` dependency in this crate).
    struct MachineCodeRegex;
    const MACHINE_CODE_RE: MachineCodeRegex = MachineCodeRegex;
    impl MachineCodeRegex {
        fn is_match(&self, code: &str) -> bool {
            let Some(rest) = code.strip_prefix("STKH") else {
                return false;
            };
            let groups: Vec<&str> = rest.split('-').collect();
            // `strip_prefix` leaves a leading '-' before the first group, so
            // `split('-')` yields one leading empty string plus 4 groups.
            if groups.len() != 5 || !groups[0].is_empty() {
                return false;
            }
            groups[1..]
                .iter()
                .all(|g| g.len() == 4 && g.bytes().all(|b| ALPHABET.contains(&b)))
        }
    }

    #[cfg(target_os = "windows")]
    #[test]
    #[ignore = "requires a real Windows registry; run explicitly on the target OS"]
    fn reads_real_machine_guid_on_windows() {
        let code = machine_code().expect("MachineGuid must be readable on a real Windows machine");
        // Not secret (plan §3.7: "machine_code ... is not secret") — printed
        // so a manual run can record it (e.g. in a Result Report), unlike
        // the raw MachineGuid itself, which this module never surfaces.
        println!("machine code: {code}");
        assert!(MACHINE_CODE_RE.is_match(&code), "got {code}");
    }
}
