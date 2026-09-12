//! WS-K-1 — Per-installation database configuration file.
//!
//! Third in the connection-resolution precedence, after the environment
//! variable and before the developer-only `runtime.key` fallback (see
//! `db::database_state_from_precedence`). This is the mechanism a future
//! installer (WS-K-3) is expected to populate on a client machine that has no
//! environment variables and no `run.bat`.
//!
//! WS-K-1 shipped this module consumption-only: nothing here ever created,
//! wrote, or scaffolded the config file — WS-K-2/WS-K-3 wrote it from an
//! external installer script instead. WS-K-4 replaces that installer-driven
//! provisioning with first-run setup running inside the app itself (see
//! `infrastructure::embedded_setup`), so this module now also owns [`write`]
//! and [`remove`] — the app is the only writer there has ever been; nothing
//! external writes this file anymore.
//!
//! Security posture:
//! - Discrete fields (host/port/database/user/password), never a raw URL, so
//!   a password containing `@`, `:`, or `%` cannot corrupt a formatted
//!   connection string — [`PgConnectOptions`]'s typed builder is used
//!   directly, matching the same guarantee `db::ConnectionTarget` already
//!   gives the rest of this crate.
//! - The file's own on-disk permissions are checked (Windows only) and
//!   reported as a non-blocking [`ConfigWarning`] — see the module-level
//!   safety note on [`check_file_permissions`] for why this never blocks
//!   startup.
//! - The parsed password is held in a [`Zeroizing`] buffer for the lifetime
//!   of this function, matching the existing S0-005 credential-handling
//!   idiom (`infrastructure::credentials::SecretBytes`).

use std::path::Path;

use serde::Deserialize;
use sqlx::postgres::PgConnectOptions;
use zeroize::Zeroizing;

const CONFIG_FILE_NAME: &str = "database.json";

/// A non-blocking fact discovered while loading the config file. Never causes
/// the app to refuse to start — see [`check_file_permissions`].
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ConfigWarning {
    /// The file's Windows ACL grants read access to a broad group (Everyone,
    /// Authenticated Users, or BUILTIN\Users) rather than only the current
    /// user. Reported, never enforced: see the safety note below.
    InsecurePermissions,
}

/// Result of resolving `database.json` in the app-data directory.
pub enum LocalConfigOutcome {
    /// No file exists at the expected path (or it could not be read at all,
    /// e.g. genuinely absent, or unreadable for a reason distinct from an
    /// insecure-but-present ACL). Precedence falls through to the next
    /// source.
    Absent,
    /// The file exists and was read, but its contents are not valid JSON or
    /// are missing a required field.
    Invalid,
    /// The file was read and parsed successfully.
    ///
    /// `options` is boxed: `PgConnectOptions` is large relative to the other
    /// (unit) variants of this enum, and boxing it keeps `LocalConfigOutcome`
    /// itself cheap to move regardless of which variant is active.
    Loaded {
        options: Box<PgConnectOptions>,
        permission_warning: Option<ConfigWarning>,
    },
}

/// Discrete connection fields, deserialized from `database.json`.
///
/// Deliberately not a raw connection URL: an installer or a human hand-editing
/// this file cannot corrupt a URL through an unescaped `@`, `:`, or `%` in the
/// password if there is no URL for them to assemble in the first place.
#[derive(Deserialize, serde::Serialize)]
struct DatabaseConfigFile {
    host: String,
    port: u16,
    database: String,
    user: String,
    password: String,
}

/// Write `database.json`, creating `app_data_dir` if needed.
///
/// WS-K-4: called only once, at the end of first-run setup, after every
/// prior step (roles, database, migrations) has already succeeded — see
/// `embedded_setup::run_setup`'s own ordering. Relies on `app_data_dir`
/// (a per-user profile folder) already carrying a reasonably tight NTFS ACL
/// by inheritance; this function does not additionally tighten the written
/// file's ACL itself. [`load`]'s existing advisory permission check still
/// runs on every read after this and would surface a warning (never
/// blocking — see its own module note) if that assumption ever fails to
/// hold on a given machine.
pub fn write(
    app_data_dir: &Path,
    host: &str,
    port: u16,
    database: &str,
    user: &str,
    password: &str,
) -> std::io::Result<()> {
    std::fs::create_dir_all(app_data_dir)?;
    let payload = DatabaseConfigFile {
        host: host.to_owned(),
        port,
        database: database.to_owned(),
        user: user.to_owned(),
        password: password.to_owned(),
    };
    let json = serde_json::to_string_pretty(&payload).map_err(std::io::Error::other)?;
    std::fs::write(app_data_dir.join(CONFIG_FILE_NAME), json)
}

/// Delete `database.json`. WS-K-4's one caller: setup's final verification
/// step, when a connection using exactly what was just written fails —
/// never leave credentials behind that are known not to work.
pub fn remove(app_data_dir: &Path) -> std::io::Result<()> {
    std::fs::remove_file(app_data_dir.join(CONFIG_FILE_NAME))
}

/// Load and parse `database.json` from `app_data_dir`, using the real
/// (Windows ACL) permission checker.
pub fn load(app_data_dir: &Path) -> LocalConfigOutcome {
    load_with_checker(app_data_dir, check_file_permissions)
}

/// Testable core: takes the permission checker as a parameter so unit tests
/// can simulate Secure/Insecure/Unknown without touching a real ACL.
fn load_with_checker(
    app_data_dir: &Path,
    checker: impl FnOnce(&Path) -> ConfigFilePermissionCheck,
) -> LocalConfigOutcome {
    let path = app_data_dir.join(CONFIG_FILE_NAME);

    let contents = match std::fs::read_to_string(&path) {
        Ok(contents) => contents,
        // Covers "does not exist" and every other read failure alike
        // (permission denied, not a regular file, etc.): precedence simply
        // falls through to the next source rather than guessing at intent.
        Err(_) => return LocalConfigOutcome::Absent,
    };

    let fields: DatabaseConfigFile = match serde_json::from_str(&contents) {
        Ok(fields) => fields,
        Err(_) => return LocalConfigOutcome::Invalid,
    };

    // Zeroized on drop; the copy sqlx retains internally in `PgConnectOptions`
    // is outside this crate's control, matching the same limitation already
    // accepted by the `runtime.key` fallback this module sits alongside.
    let password = Zeroizing::new(fields.password);

    let options = PgConnectOptions::new()
        .host(&fields.host)
        .port(fields.port)
        .database(&fields.database)
        .username(&fields.user)
        .password(password.as_str());

    let permission_warning = match checker(&path) {
        ConfigFilePermissionCheck::Insecure => Some(ConfigWarning::InsecurePermissions),
        ConfigFilePermissionCheck::Secure | ConfigFilePermissionCheck::Unknown => None,
    };

    LocalConfigOutcome::Loaded {
        options: Box::new(options),
        permission_warning,
    }
}

/// Outcome of inspecting the config file's on-disk permissions.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ConfigFilePermissionCheck {
    /// The ACL does not grant read access to a broad well-known group.
    Secure,
    /// The ACL grants read access to Everyone, Authenticated Users, or
    /// BUILTIN\Users.
    Insecure,
    /// The check could not be completed conclusively (non-Windows target,
    /// unsupported filesystem, unexpected ACL shape, any Win32 failure).
    Unknown,
}

// ——— Windows ACL check ———
//
// SAFETY / PRODUCT NOTE (WS-K-1 correction 1, owner-ruled):
//
// This check is advisory only and must fail open. The config file's ACL is
// set by a mechanism this task does not build (an installer, WS-K-3) on a
// Windows configuration this task cannot predict: domain-joined machines,
// redirected/OneDrive app-data, antivirus products that rewrite ACLs, and
// filesystems where `GetNamedSecurityInfoW` behaves unexpectedly. A false
// "insecure" reading that blocked startup would mean a shop cannot open the
// till over a filesystem quirk neither the Owner nor Stockiha controls — a
// disproportionate cost against the (real, but modest, single-user-desktop)
// risk this check defends against. So: any error, any unsupported shape, and
// any non-Windows target all resolve to `Unknown`, which the caller treats
// identically to `Secure` (no warning shown). Only a *positive, successfully
// read* grant to a well-known broad SID produces `Insecure`.
#[cfg(windows)]
fn check_file_permissions(path: &Path) -> ConfigFilePermissionCheck {
    windows_acl::check(path)
}

#[cfg(not(windows))]
fn check_file_permissions(_path: &Path) -> ConfigFilePermissionCheck {
    ConfigFilePermissionCheck::Unknown
}

#[cfg(windows)]
mod windows_acl {
    use super::ConfigFilePermissionCheck;
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;
    use std::ptr::null_mut;

    use windows_sys::Win32::Foundation::{LocalFree, ERROR_SUCCESS, HLOCAL};
    use windows_sys::Win32::Security::Authorization::{GetNamedSecurityInfoW, SE_FILE_OBJECT};
    use windows_sys::Win32::Security::{
        AclSizeInformation, CreateWellKnownSid, EqualSid, GetAce, GetAclInformation, IsValidAcl,
        WinAuthenticatedUserSid, WinBuiltinUsersSid, WinWorldSid, ACCESS_ALLOWED_ACE, ACL,
        ACL_SIZE_INFORMATION, DACL_SECURITY_INFORMATION, PSID, WELL_KNOWN_SID_TYPE,
    };

    /// Maximum SID buffer size Win32 documents (`SECURITY_MAX_SID_SIZE`).
    const MAX_SID_SIZE: usize = 68;

    /// Bounded, best-effort ACL inspection. Never panics: every fallible step
    /// maps to `Unknown` rather than `unwrap`/`expect`. Frees every Win32
    /// allocation on every exit path.
    pub(super) fn check(path: &Path) -> ConfigFilePermissionCheck {
        // catch_unwind is defense in depth only: the body below is written to
        // never panic (no unwrap/expect/index-out-of-bounds), but a check
        // this security-sensitive must not be allowed to take startup down
        // with it even if that discipline is ever violated by a future edit.
        std::panic::catch_unwind(|| check_inner(path)).unwrap_or(ConfigFilePermissionCheck::Unknown)
    }

    fn check_inner(path: &Path) -> ConfigFilePermissionCheck {
        let wide: Vec<u16> = path
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        let mut dacl: *mut ACL = null_mut();
        let mut security_descriptor: HLOCAL = null_mut();

        // SAFETY: `wide` is a valid, NUL-terminated UTF-16 buffer that outlives
        // the call. All other out-parameters are local, properly sized, and
        // the returned security descriptor is freed via `LocalFree` below on
        // every path once this function is done reading through `dacl`
        // (`dacl` points into the same allocation).
        let status = unsafe {
            GetNamedSecurityInfoW(
                wide.as_ptr(),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION,
                null_mut(),
                null_mut(),
                &mut dacl,
                null_mut(),
                &mut security_descriptor as *mut HLOCAL,
            )
        };

        if status != ERROR_SUCCESS || security_descriptor.is_null() {
            return ConfigFilePermissionCheck::Unknown;
        }

        let result = inspect_dacl(dacl);

        // SAFETY: `security_descriptor` is the exact pointer `LocalFree`
        // expects to release; freed exactly once, after every read of `dacl`
        // (which lives inside this allocation) has completed.
        unsafe {
            LocalFree(security_descriptor);
        }

        result
    }

    /// A null DACL means "no restrictions — everyone has full access", which
    /// is unambiguously the insecure case and does not require walking any
    /// ACEs.
    fn inspect_dacl(dacl: *mut ACL) -> ConfigFilePermissionCheck {
        if dacl.is_null() {
            return ConfigFilePermissionCheck::Insecure;
        }

        // SAFETY: `dacl` was just returned by `GetNamedSecurityInfoW` with a
        // success status, so it points at a valid ACL structure for the
        // duration of this call.
        if unsafe { IsValidAcl(dacl) } == 0 {
            return ConfigFilePermissionCheck::Unknown;
        }

        let mut size_info: ACL_SIZE_INFORMATION = unsafe { std::mem::zeroed() };
        // SAFETY: `dacl` is valid (checked above); `size_info` is correctly
        // sized and its class tag matches the struct being requested.
        let ok = unsafe {
            GetAclInformation(
                dacl,
                &mut size_info as *mut _ as *mut core::ffi::c_void,
                std::mem::size_of::<ACL_SIZE_INFORMATION>() as u32,
                AclSizeInformation,
            )
        };
        if ok == 0 {
            return ConfigFilePermissionCheck::Unknown;
        }

        let broad_sids = match broad_well_known_sids() {
            Some(sids) => sids,
            None => return ConfigFilePermissionCheck::Unknown,
        };

        for index in 0..size_info.AceCount {
            let mut ace_ptr: *mut core::ffi::c_void = null_mut();
            // SAFETY: `dacl` is valid; `index` is within `0..AceCount` as
            // reported by the ACL itself.
            let ok = unsafe { GetAce(dacl, index, &mut ace_ptr) };
            if ok == 0 || ace_ptr.is_null() {
                continue;
            }

            // Every ACE type Stockiha's config file could plausibly carry
            // (allow, and the allow-object variant some filesystems use)
            // begins with the same `ACE_HEADER` followed by an access mask
            // and then a `SID` — `ACCESS_ALLOWED_ACE` models that shared
            // prefix layout, which is all that is read here.
            let ace = ace_ptr as *const ACCESS_ALLOWED_ACE;
            // SAFETY: `ace_ptr` was just returned by `GetAce` for this exact
            // `dacl`/`index`, non-null, and `ACCESS_ALLOWED_ACE`'s fields
            // read here (`Header`, the start of `SidStart`) are present in
            // every ACE type this loop can encounter.
            let ace_type = unsafe { (*ace).Header.AceType };
            // 0 = ACCESS_ALLOWED_ACE_TYPE. Only allow-ACEs can grant access;
            // deny/audit ACEs are not a disclosure risk and are skipped.
            if ace_type != 0 {
                continue;
            }
            let sid_ptr = unsafe { &(*ace).SidStart as *const u32 as PSID };

            for broad_sid in &broad_sids {
                // SAFETY: `sid_ptr` points at a SID embedded in a
                // Win32-validated ACE; `broad_sid` is a locally constructed,
                // valid SID buffer. `EqualSid` only reads both.
                let equal = unsafe { EqualSid(sid_ptr, broad_sid.as_ptr() as PSID) };
                if equal != 0 {
                    return ConfigFilePermissionCheck::Insecure;
                }
            }
        }

        ConfigFilePermissionCheck::Secure
    }

    /// Construct the well-known SIDs this check refuses: Everyone,
    /// Authenticated Users, and BUILTIN\Users. Returns `None` (→ `Unknown`)
    /// if any well-known SID cannot be constructed on this system.
    fn broad_well_known_sids() -> Option<[[u8; MAX_SID_SIZE]; 3]> {
        let kinds: [WELL_KNOWN_SID_TYPE; 3] =
            [WinWorldSid, WinAuthenticatedUserSid, WinBuiltinUsersSid];
        let mut out = [[0u8; MAX_SID_SIZE]; 3];
        for (slot, kind) in out.iter_mut().zip(kinds.iter()) {
            let mut size: u32 = MAX_SID_SIZE as u32;
            // SAFETY: `slot` is a correctly sized local buffer; `size` is set
            // to its exact capacity beforehand, matching Win32's contract.
            let ok = unsafe {
                CreateWellKnownSid(*kind, null_mut(), slot.as_mut_ptr() as PSID, &mut size)
            };
            if ok == 0 {
                return None;
            }
        }
        Some(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SENTINEL_PASSWORD: &str = "DO_NOT_EXPOSE_DIAGNOSTIC";

    fn write_fixture(dir: &Path, contents: &str) {
        std::fs::write(dir.join(CONFIG_FILE_NAME), contents).expect("write fixture");
    }

    #[test]
    fn missing_file_is_absent() {
        let dir = std::env::temp_dir().join(format!("sk-local-config-{}", uuid_ish()));
        std::fs::create_dir_all(&dir).unwrap();
        let outcome = load_with_checker(&dir, |_| ConfigFilePermissionCheck::Secure);
        assert!(matches!(outcome, LocalConfigOutcome::Absent));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn malformed_json_is_invalid() {
        let dir = std::env::temp_dir().join(format!("sk-local-config-{}", uuid_ish()));
        std::fs::create_dir_all(&dir).unwrap();
        write_fixture(&dir, "{ this is not valid json");
        let outcome = load_with_checker(&dir, |_| ConfigFilePermissionCheck::Secure);
        assert!(matches!(outcome, LocalConfigOutcome::Invalid));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_field_is_invalid() {
        let dir = std::env::temp_dir().join(format!("sk-local-config-{}", uuid_ish()));
        std::fs::create_dir_all(&dir).unwrap();
        write_fixture(
            &dir,
            r#"{"host":"127.0.0.1","port":5432,"database":"stockiha"}"#,
        );
        let outcome = load_with_checker(&dir, |_| ConfigFilePermissionCheck::Secure);
        assert!(matches!(outcome, LocalConfigOutcome::Invalid));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn valid_file_loads_discrete_fields_into_options() {
        let dir = std::env::temp_dir().join(format!("sk-local-config-{}", uuid_ish()));
        std::fs::create_dir_all(&dir).unwrap();
        write_fixture(
            &dir,
            &format!(
                r#"{{"host":"127.0.0.1","port":5432,"database":"stockiha_shop","user":"stockiha_runtime","password":"{SENTINEL_PASSWORD}"}}"#
            ),
        );
        let outcome = load_with_checker(&dir, |_| ConfigFilePermissionCheck::Secure);
        match outcome {
            LocalConfigOutcome::Loaded {
                options,
                permission_warning,
            } => {
                assert_eq!(options.get_host(), "127.0.0.1");
                assert_eq!(options.get_port(), 5432);
                assert_eq!(options.get_database(), Some("stockiha_shop"));
                assert_eq!(permission_warning, None);
            }
            _ => panic!("expected Loaded"),
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn insecure_permission_check_surfaces_as_warning_not_a_failure() {
        let dir = std::env::temp_dir().join(format!("sk-local-config-{}", uuid_ish()));
        std::fs::create_dir_all(&dir).unwrap();
        write_fixture(
            &dir,
            r#"{"host":"127.0.0.1","port":5432,"database":"stockiha_shop","user":"stockiha_runtime","password":"x"}"#,
        );
        let outcome = load_with_checker(&dir, |_| ConfigFilePermissionCheck::Insecure);
        match outcome {
            LocalConfigOutcome::Loaded {
                permission_warning, ..
            } => {
                assert_eq!(permission_warning, Some(ConfigWarning::InsecurePermissions));
            }
            _ => panic!("expected Loaded even when permissions are insecure — must not block"),
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn unknown_permission_check_never_surfaces_a_warning() {
        let dir = std::env::temp_dir().join(format!("sk-local-config-{}", uuid_ish()));
        std::fs::create_dir_all(&dir).unwrap();
        write_fixture(
            &dir,
            r#"{"host":"127.0.0.1","port":5432,"database":"stockiha_shop","user":"stockiha_runtime","password":"x"}"#,
        );
        let outcome = load_with_checker(&dir, |_| ConfigFilePermissionCheck::Unknown);
        match outcome {
            LocalConfigOutcome::Loaded {
                permission_warning, ..
            } => {
                // Fail-open: an inconclusive check must never be treated as
                // insecure.
                assert_eq!(permission_warning, None);
            }
            _ => panic!("expected Loaded"),
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// No proper diagnostic ever carries the password: the only place it is
    /// held is the local `Zeroizing<String>`, which is never rendered by any
    /// `Debug`/`Display`/`Serialize` impl in this module.
    #[test]
    fn config_warning_serialization_never_carries_a_password() {
        let json = serde_json::to_string(&ConfigWarning::InsecurePermissions).unwrap();
        assert_eq!(json, r#""INSECURE_PERMISSIONS""#);
        assert!(!json.contains(SENTINEL_PASSWORD));
    }

    // A tiny process-unique suffix so parallel test threads never collide on
    // the same scratch directory; not a real UUID, just unique enough.
    fn uuid_ish() -> String {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        format!("{}-{}", std::process::id(), n)
    }
}
