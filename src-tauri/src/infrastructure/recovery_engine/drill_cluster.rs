//! A throwaway PostgreSQL cluster for the isolated restore test (plan
//! H4-03, ruling R6).
//!
//! `initdb` into a temporary folder next to the live data folder, started on
//! its own free port, using the same bundled binaries the live server uses.
//! It never touches the live server: role/database setup goes through
//! `embedded_setup`'s own first-run helpers (now `pub(crate)`, bodies
//! unchanged), targeting this cluster's own port. Every early return after
//! the marker file is written is safe by construction — `Drop` stops any
//! spawned child and removes the folder, so a partially-started drill never
//! leaks.

use std::path::PathBuf;
use std::time::Duration;

use sqlx::postgres::PgConnectOptions;
use zeroize::Zeroizing;

use super::errors::{codes, EngineError};
use super::mode::EmbeddedRecoveryContext;
use super::tools::RestoreTarget;
use crate::infrastructure::embedded_setup;
use crate::infrastructure::pg_process;

pub(crate) const DRILL_DIR_PREFIX: &str = "restore-drill-";
pub(crate) const DRILL_MARKER_FILE: &str = ".stockiha-drill";
pub(crate) const DRILL_PREFERRED_PORT: u16 = 55480;

const MIGRATOR_USERNAME: &str = "stockiha_migrator";
const DRILL_HOST: &str = "127.0.0.1";

/// How long to wait for the drill server to accept connections, and (on
/// stop) for a graceful shutdown before this struct's own two-stage
/// stop/remove cleanup gives up on that attempt.
const DRILL_READY_TIMEOUT: Duration = Duration::from_secs(30);
const DRILL_STOP_TIMEOUT: Duration = Duration::from_secs(10);

pub(crate) struct DrillCluster {
    pub root: PathBuf,
    pub data: PathBuf,
    pub bin_dir: PathBuf,
    pub port: u16,
    pub migrator_password: Zeroizing<String>,
    child: Option<std::process::Child>,
    stopped: bool,
}

impl DrillCluster {
    /// Provision and start a fresh, empty, role-ready cluster. `root` sits
    /// beside the live `pgdata` (never inside it), named with the process id
    /// and a unix timestamp so a crash leaves an unambiguous, sweepable
    /// artifact (see `sweep.rs`, H4-08).
    pub(crate) async fn start(
        ctx: &EmbeddedRecoveryContext,
        required_free_bytes: u64,
    ) -> Result<Self, EngineError> {
        let parent = ctx.pgdata.parent().ok_or_else(|| {
            EngineError::new(
                codes::DRILL_PATH_NOT_ASCII,
                "pgdata has no parent directory",
            )
        })?;

        let unix = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let pid = std::process::id();
        let root = parent.join(format!("{DRILL_DIR_PREFIX}{unix}-{pid}"));
        if !root.to_str().map(str::is_ascii).unwrap_or(false) {
            return Err(EngineError::new(
                codes::DRILL_PATH_NOT_ASCII,
                format!("{} is not ASCII", root.display()),
            ));
        }

        match pg_process::free_disk_space_bytes(parent) {
            Some(free) if free >= required_free_bytes => {}
            _ => {
                return Err(EngineError::new(
                    codes::DRILL_INSUFFICIENT_SPACE,
                    format!(
                        "need {required_free_bytes} bytes free on {}",
                        parent.display()
                    ),
                ));
            }
        }

        let data = root.join("data");
        std::fs::create_dir_all(&data).map_err(|e| {
            EngineError::new(
                codes::DRILL_INITDB_FAILED,
                format!("create {} ({e})", data.display()),
            )
        })?;
        std::fs::write(
            root.join(DRILL_MARKER_FILE),
            format!("pid={pid}\nstarted={unix}\n"),
        )
        .map_err(|e| {
            EngineError::new(
                codes::DRILL_INITDB_FAILED,
                format!("write marker in {} ({e})", root.display()),
            )
        })?;

        // From here on, every early return is safe: `Drop` sees
        // `stopped: true` (no child to stop) and removes `root`.
        let mut cluster = DrillCluster {
            root: root.clone(),
            data: data.clone(),
            bin_dir: ctx.bin_dir.clone(),
            port: 0,
            migrator_password: Zeroizing::new(String::new()),
            child: None,
            stopped: true,
        };

        let admin_password = embedded_setup::generate_password();
        embedded_setup::run_initdb(&cluster.bin_dir, &data, &admin_password)
            .map_err(|detail| EngineError::new(codes::DRILL_INITDB_FAILED, detail))?;

        let port = pg_process::find_free_port(DRILL_PREFERRED_PORT).ok_or_else(|| {
            EngineError::new(codes::DRILL_NO_FREE_PORT, "no free port near 55480")
        })?;
        embedded_setup::write_server_config(&data, port)
            .map_err(|detail| EngineError::new(codes::DRILL_INITDB_FAILED, detail))?;
        cluster.port = port;

        let child = pg_process::spawn_postgres(&cluster.bin_dir, &data).map_err(|e| {
            EngineError::new(codes::DRILL_SERVER_START_FAILED, format!("spawn ({e})"))
        })?;
        cluster.child = Some(child);
        pg_process::wait_until_ready(port, DRILL_READY_TIMEOUT)
            .await
            .map_err(|elapsed| {
                EngineError::new(
                    codes::DRILL_SERVER_START_FAILED,
                    format!("not ready after {elapsed:?}"),
                )
            })?;

        let role_passwords = embedded_setup::create_roles(port, admin_password.clone())
            .await
            .map_err(|detail| EngineError::new(codes::DRILL_ROLE_SETUP_FAILED, detail))?;
        let migrator_password = role_passwords.migrator.ok_or_else(|| {
            EngineError::new(
                codes::DRILL_ROLE_SETUP_FAILED,
                "no migrator password was generated",
            )
        })?;
        embedded_setup::create_database(port, admin_password)
            .await
            .map_err(|detail| EngineError::new(codes::DRILL_ROLE_SETUP_FAILED, detail))?;

        cluster.migrator_password = Zeroizing::new(migrator_password);
        // The server is up and role-ready: from now on `Drop` must stop it
        // before removing the folder.
        cluster.stopped = false;

        Ok(cluster)
    }

    pub(crate) fn restore_target(&self) -> RestoreTarget<'_> {
        RestoreTarget {
            host: DRILL_HOST,
            port: self.port,
            database: embedded_setup::DATABASE_NAME,
            username: MIGRATOR_USERNAME,
            password: self.migrator_password.as_str(),
        }
    }

    pub(crate) fn connect_options(&self) -> PgConnectOptions {
        PgConnectOptions::new()
            .host(DRILL_HOST)
            .port(self.port)
            .username(MIGRATOR_USERNAME)
            .password(self.migrator_password.as_str())
            .database(embedded_setup::DATABASE_NAME)
    }

    /// Stop this cluster's own server (`pg_ctl -D <data>`, which reads THIS
    /// cluster's own `postmaster.pid` — never the live server's). Escalates
    /// fast → immediate exactly like `pg_process::stop_postgres`.
    pub(crate) fn stop(&mut self) -> Result<(), EngineError> {
        if self.stopped {
            return Ok(());
        }
        let result = pg_process::stop_postgres(&self.bin_dir, &self.data, DRILL_STOP_TIMEOUT);
        if let Some(mut child) = self.child.take() {
            let _ = child.wait();
        }
        match result {
            Ok(_) => {
                self.stopped = true;
                Ok(())
            }
            Err(e) => Err(EngineError::new(
                codes::DRILL_SERVER_STOP_FAILED,
                format!("{e}"),
            )),
        }
    }

    /// Remove the whole drill folder, up to three tries a second apart (a
    /// file briefly held open by antivirus or a not-yet-released Windows
    /// handle is common right after a stop). Returns whether it is gone.
    pub(crate) fn remove_files(&self) -> bool {
        if !self.root.exists() {
            return true;
        }
        for attempt in 0..3 {
            if attempt > 0 {
                std::thread::sleep(Duration::from_secs(1));
            }
            if std::fs::remove_dir_all(&self.root).is_ok() || !self.root.exists() {
                return true;
            }
        }
        !self.root.exists()
    }
}

impl Drop for DrillCluster {
    fn drop(&mut self) {
        if !self.stopped {
            let _ = self.stop();
        }
        let _ = self.remove_files();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::local_config;
    use sqlx::{Connection, PgConnection};

    fn ctx(
        app_data_dir: &std::path::Path,
        bin_dir: PathBuf,
        pgdata: PathBuf,
    ) -> EmbeddedRecoveryContext {
        EmbeddedRecoveryContext {
            app_data_dir: app_data_dir.to_path_buf(),
            resource_dir: bin_dir
                .parent()
                .and_then(|p| p.parent())
                .and_then(|p| p.parent())
                .unwrap_or(&bin_dir)
                .to_path_buf(),
            bin_dir,
            pgdata,
            app_version: "0.5.0-test".to_string(),
        }
    }

    /// Windows-only real proof (plan H4-03 Verify): start a drill cluster
    /// beside a real live server, prove it is usable, stop and remove it,
    /// and confirm the live server was never touched.
    #[tokio::test]
    #[ignore = "spawns real, disposable PostgreSQL instances; run explicitly with -- --ignored"]
    async fn drill_cluster_starts_and_cleans_up_without_touching_the_live_server() {
        use crate::infrastructure::safe_upgrade::test_support;

        let app_data_dir = test_support::temp_app_data_dir_for_tests("drill-cluster");
        let (bin_dir, pgdata, live_port) =
            test_support::provision_fresh_instance(&app_data_dir, 58570).await;
        let context = ctx(&app_data_dir, bin_dir.clone(), pgdata.clone());

        let mut cluster = DrillCluster::start(&context, 500 * 1024 * 1024)
            .await
            .expect("drill cluster must start");
        assert_ne!(cluster.port, live_port);

        let mut conn = PgConnection::connect_with(&cluster.connect_options())
            .await
            .expect("must connect to the drill cluster as migrator");
        let one: i32 = sqlx::query_scalar("SELECT 1")
            .fetch_one(&mut conn)
            .await
            .unwrap();
        assert_eq!(one, 1);
        let _ = conn.close().await;

        cluster.stop().expect("drill cluster must stop cleanly");
        assert!(
            cluster.remove_files(),
            "drill folder must be removable after stop"
        );
        assert!(!cluster.root.exists());

        // The live server, provisioned first and never touched, must still
        // answer through its own migrator credential.
        let info = local_config::load_migrator_connection_info(&app_data_dir)
            .expect("live migrator credential must still be on file");
        assert_eq!(info.port, live_port);
        let live_options = sqlx::postgres::PgConnectOptions::new()
            .host("127.0.0.1")
            .port(live_port)
            .username(&info.username)
            .password(info.password.as_str())
            .database(&info.database);
        let live_conn = PgConnection::connect_with(&live_options)
            .await
            .expect("live server must still answer");
        let _ = live_conn.close().await;

        test_support::stop_server(&bin_dir, &pgdata);
        let _ = std::fs::remove_dir_all(&app_data_dir);
    }
}
