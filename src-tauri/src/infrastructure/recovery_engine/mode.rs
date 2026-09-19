//! Recovery mode resolver (plan §5.1, ruling R1).
//!
//! Pure and unit-testable: the caller supplies the env var value, the two
//! directories and a "is a migrator credential on file" probe; production
//! passes the real `local_config::load_migrator_connection_info(dir).is_some()`.
//! The precedence mirrors `db::database_state_from_precedence`, so a backup
//! always targets the same database the app is connected to.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::infrastructure::pg_process;

/// Everything an EMBEDDED-mode operation needs to know about this
/// installation. Deliberately does **not** hold the migrator password: each
/// operation loads it when needed and drops it (`Zeroizing`) afterwards.
#[derive(Clone, Debug)]
pub(crate) struct EmbeddedRecoveryContext {
    pub app_data_dir: PathBuf,
    /// `dunce`-simplified; used only for destination containment checks.
    pub resource_dir: PathBuf,
    /// `pg_process::bundled_bin_dir(&resource_dir)`.
    pub bin_dir: PathBuf,
    /// `pg_process::resolve_pgdata_dir(&app_data_dir)` — the live cluster.
    pub pgdata: PathBuf,
    /// `app.package_info().version` — informational only (ruling R5).
    pub app_version: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum UnavailableReason {
    AppDataUnavailable,
    ResourceDirUnavailable,
    NoMigratorCredential,
}

pub(crate) enum RecoveryMode {
    Embedded(EmbeddedRecoveryContext),
    External,
    Unavailable(UnavailableReason),
}

impl RecoveryMode {
    /// The wire name used by `get_recovery_mode` / `get_recovery_capabilities`.
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            RecoveryMode::Embedded(_) => "EMBEDDED",
            RecoveryMode::External => "EXTERNAL",
            RecoveryMode::Unavailable(_) => "UNAVAILABLE",
        }
    }
}

/// Decide the mode. Exact order (plan §5.1):
/// 1. env var set and not blank → `External` (even with a migrator on file —
///    the developer cluster wins, see edge case E-29);
/// 2. no app data dir → `Unavailable(AppDataUnavailable)`;
/// 3. no resource dir → `Unavailable(ResourceDirUnavailable)`;
/// 4. no loadable migrator credential → `Unavailable(NoMigratorCredential)`;
/// 5. otherwise `Embedded`.
pub(crate) fn resolve_from(
    env_database_url: Option<&str>,
    app_data_dir: Option<PathBuf>,
    resource_dir: Option<PathBuf>,
    migrator_present: impl Fn(&Path) -> bool,
    app_version: String,
) -> RecoveryMode {
    if let Some(url) = env_database_url {
        if !url.trim().is_empty() {
            return RecoveryMode::External;
        }
    }
    let Some(app_data_dir) = app_data_dir else {
        return RecoveryMode::Unavailable(UnavailableReason::AppDataUnavailable);
    };
    let Some(resource_dir) = resource_dir else {
        return RecoveryMode::Unavailable(UnavailableReason::ResourceDirUnavailable);
    };
    if !migrator_present(&app_data_dir) {
        return RecoveryMode::Unavailable(UnavailableReason::NoMigratorCredential);
    }
    let resource_dir = dunce::simplified(&resource_dir).to_path_buf();
    let bin_dir = pg_process::bundled_bin_dir(&resource_dir);
    let pgdata = pg_process::resolve_pgdata_dir(&app_data_dir);
    RecoveryMode::Embedded(EmbeddedRecoveryContext {
        app_data_dir,
        resource_dir,
        bin_dir,
        pgdata,
        app_version,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn present(_: &Path) -> bool {
        true
    }

    fn absent(_: &Path) -> bool {
        false
    }

    fn dirs() -> (Option<PathBuf>, Option<PathBuf>) {
        (
            Some(PathBuf::from("/app-data")),
            Some(PathBuf::from("/resources")),
        )
    }

    #[test]
    fn env_var_wins_even_when_a_migrator_credential_is_present() {
        let (app, res) = dirs();
        let mode = resolve_from(
            Some("postgres://dev@localhost/db"),
            app,
            res,
            present,
            "0.5.0".into(),
        );
        assert!(matches!(mode, RecoveryMode::External));
    }

    #[test]
    fn a_blank_env_var_counts_as_unset() {
        let (app, res) = dirs();
        let mode = resolve_from(Some("  "), app, res, present, "0.5.0".into());
        assert!(matches!(mode, RecoveryMode::Embedded(_)));
    }

    #[test]
    fn missing_app_data_dir_is_unavailable() {
        let (_, res) = dirs();
        let mode = resolve_from(None, None, res, present, "0.5.0".into());
        assert!(matches!(
            mode,
            RecoveryMode::Unavailable(UnavailableReason::AppDataUnavailable)
        ));
    }

    #[test]
    fn missing_resource_dir_is_unavailable() {
        let (app, _) = dirs();
        let mode = resolve_from(None, app, None, present, "0.5.0".into());
        assert!(matches!(
            mode,
            RecoveryMode::Unavailable(UnavailableReason::ResourceDirUnavailable)
        ));
    }

    #[test]
    fn missing_migrator_credential_is_unavailable() {
        let (app, res) = dirs();
        let mode = resolve_from(None, app, res, absent, "0.5.0".into());
        assert!(matches!(
            mode,
            RecoveryMode::Unavailable(UnavailableReason::NoMigratorCredential)
        ));
    }

    #[test]
    fn embedded_context_points_at_the_bundled_bin_dir_and_live_pgdata() {
        let (app, res) = dirs();
        let mode = resolve_from(None, app, res, present, "0.5.0".into());
        let RecoveryMode::Embedded(ctx) = mode else {
            panic!("expected Embedded");
        };
        assert!(ctx
            .bin_dir
            .ends_with(Path::new("postgres").join("win64").join("bin")));
        assert_eq!(ctx.app_version, "0.5.0");
        assert!(ctx.pgdata.ends_with("pgdata"));
        assert_eq!(ctx.app_data_dir, PathBuf::from("/app-data"));
    }

    #[test]
    fn unavailable_reason_serializes_screaming_snake_case() {
        assert_eq!(
            serde_json::to_string(&UnavailableReason::NoMigratorCredential).unwrap(),
            r#""NO_MIGRATOR_CREDENTIAL""#
        );
    }
}
