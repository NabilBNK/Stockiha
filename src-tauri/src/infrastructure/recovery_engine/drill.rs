//! The isolated restore test (plan H4-04, ruling R6) — restores a bundle
//! into a throwaway cluster, proves the migration history is genuine, brings
//! it forward if older, and reconciles totals. Never touches the live
//! server: every step below operates exclusively on `DrillCluster`'s own
//! connection/port.

use sqlx::{Connection, PgConnection};

use super::bundle::BundleSummary;
use super::drill_cluster::DrillCluster;
use super::errors::{codes, EngineError};
use super::mode::EmbeddedRecoveryContext;
use super::schema::{self, SchemaVerdict};
use super::tools;
use crate::application::recovery::collect_restore_control_totals;
use crate::domain::recovery::RestoreControlTotals;
use crate::infrastructure::schema_version::{self, SchemaCompatibility};

/// Free space required beside the live data folder: four times the dump
/// size (restore working space plus WAL) plus a fixed 200 MB margin.
const DRILL_SPACE_MULTIPLIER: u64 = 4;
const DRILL_SPACE_FIXED_MARGIN_BYTES: u64 = 200 * 1024 * 1024;

#[derive(Debug)]
pub(crate) struct DrillReport {
    pub verdict: SchemaVerdict,
    pub migrated_forward: bool,
    pub totals: RestoreControlTotals,
    pub journal_balanced: bool,
    pub server_stopped: bool,
    pub cleanup_pending: bool,
}

/// Restore `summary`'s bundle into a fresh throwaway cluster, verify it,
/// and tear the cluster down. `summary` must already be the result of a
/// full `bundle::inspect_bundle` (validated, hashed, verdict computed).
pub(crate) async fn run_isolated_drill(
    ctx: &EmbeddedRecoveryContext,
    summary: &BundleSummary,
) -> Result<DrillReport, EngineError> {
    // 1. Refuse before starting any server: a NEWER or UNKNOWN schema can
    //    never be restored, and there is nothing useful the drill can prove.
    match summary.verdict {
        SchemaVerdict::Newer => {
            return Err(EngineError::new(
                codes::BACKUP_SCHEMA_NEWER_THAN_APP,
                format!(
                    "bundle schema {} is newer than this binary",
                    summary.validated.schema_version
                ),
            ));
        }
        SchemaVerdict::Unknown => {
            return Err(EngineError::new(
                codes::BACKUP_SCHEMA_UNKNOWN,
                format!(
                    "bundle schema {} is not recognized by this binary",
                    summary.validated.schema_version
                ),
            ));
        }
        SchemaVerdict::Same | SchemaVerdict::Older => {}
    }

    // 2. A fresh throwaway cluster.
    let dump_size = std::fs::metadata(&summary.validated.dump_path)
        .map(|m| m.len())
        .unwrap_or(0);
    let required = dump_size
        .saturating_mul(DRILL_SPACE_MULTIPLIER)
        .saturating_add(DRILL_SPACE_FIXED_MARGIN_BYTES);
    let mut cluster = DrillCluster::start(ctx, required).await?;

    // 3. Restore, with or without privileges depending on the bundle format.
    let with_privileges =
        summary.validated.bundle_format_version == 2 && summary.validated.dump_includes_privileges;
    let bin_dir = cluster.bin_dir.clone();
    let target_host = "127.0.0.1".to_string();
    let target_port = cluster.port;
    let target_database = crate::infrastructure::embedded_setup::DATABASE_NAME.to_string();
    let target_username = "stockiha_migrator".to_string();
    let target_password = cluster.migrator_password.as_str().to_string();
    let dump_path = summary.validated.dump_path.clone();
    tokio::task::spawn_blocking(move || {
        let target = tools::RestoreTarget {
            host: &target_host,
            port: target_port,
            database: &target_database,
            username: &target_username,
            password: &target_password,
        };
        tools::run_pg_restore(
            &bin_dir,
            &target,
            &dump_path,
            with_privileges,
            codes::DRILL_RESTORE_FAILED,
        )
    })
    .await
    .map_err(|_| EngineError::new(codes::DRILL_RESTORE_FAILED, "restore worker panicked"))??;

    // 4. Prove the restored migration history is genuine: every version
    //    present must be one this binary itself would have applied, with an
    //    identical checksum. A mismatch means a tampered or foreign build.
    let mut conn = PgConnection::connect_with(&cluster.connect_options())
        .await
        .map_err(|e| {
            EngineError::new(
                codes::DRILL_RESTORE_FAILED,
                format!("could not connect to the drill cluster after restore ({e})"),
            )
        })?;
    let restored_history = schema::applied_history(&mut conn)
        .await
        .map_err(|detail| EngineError::new(codes::DRILL_MIGRATION_HISTORY_MISMATCH, detail))?;
    let embedded_checksums = schema_version::embedded_checksums();
    for (version, checksum) in &restored_history {
        match embedded_checksums.iter().find(|(v, _)| v == version) {
            Some((_, expected)) if expected == checksum => {}
            _ => {
                return Err(EngineError::new(
                    codes::DRILL_MIGRATION_HISTORY_MISMATCH,
                    format!("restored migration {version} does not match this binary"),
                ));
            }
        }
    }

    // 5. Bring an older schema forward with the normal migrator, on the
    //    same connection (its session role is already `stockiha_owner`,
    //    set by `create_database`, exactly like production).
    let mut migrated_forward = false;
    if summary.verdict == SchemaVerdict::Older {
        schema_version::run_all_migrations(&mut conn)
            .await
            .map_err(|e| EngineError::new(codes::DRILL_FORWARD_MIGRATION_FAILED, format!("{e}")))?;
        if schema_version::check_schema_compatibility(&mut conn).await
            != SchemaCompatibility::UpToDate
        {
            return Err(EngineError::new(
                codes::DRILL_FORWARD_MIGRATION_FAILED,
                "schema is not UpToDate after forward migration",
            ));
        }
        migrated_forward = true;
    }

    // 6. Reconcile.
    let (totals, journal_balanced) = collect_restore_control_totals(&mut conn)
        .await
        .map_err(|e| EngineError::new(codes::DRILL_RECONCILIATION_FAILED, format!("{e:?}")))?;

    // 7. Close, stop, remove. A stop failure is a real failure of the drill
    //    itself; a lingering file after a successful stop is reported, not
    //    treated as an error (`cleanup_pending`).
    let _ = conn.close().await;
    cluster.stop()?;
    let cleanup_pending = !cluster.remove_files();

    Ok(DrillReport {
        verdict: summary.verdict,
        migrated_forward,
        totals,
        journal_balanced,
        server_stopped: true,
        cleanup_pending,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::backup_proof;
    use crate::infrastructure::local_config;
    use crate::infrastructure::recovery_engine::backup::{
        self as backup_engine, CreateBundleInput,
    };
    use crate::infrastructure::recovery_engine::bundle::{self, BackupKind};
    use crate::infrastructure::recovery_engine::destination::{self, DestinationPurpose};
    use sqlx::postgres::PgConnectOptions;

    fn ctx(
        app_data_dir: &std::path::Path,
        bin_dir: std::path::PathBuf,
        pgdata: std::path::PathBuf,
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

    fn live_migrator_options(app_data_dir: &std::path::Path, port: u16) -> PgConnectOptions {
        let info = local_config::load_migrator_connection_info(app_data_dir).unwrap();
        PgConnectOptions::new()
            .host("127.0.0.1")
            .port(port)
            .username(&info.username)
            .password(info.password.as_str())
            .database(&info.database)
    }

    /// Poll the live server every 300ms until `stop` is set, recording any
    /// failed connect-and-`SELECT 1` as a failure. Used to prove the live
    /// database stays answerable *during* a multi-second drill, not merely
    /// before and after it.
    fn spawn_live_poller(
        options: PgConnectOptions,
        stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
    ) -> tokio::task::JoinHandle<(u32, u32)> {
        tokio::spawn(async move {
            let mut polls = 0u32;
            let mut failures = 0u32;
            while !stop.load(std::sync::atomic::Ordering::Relaxed) {
                tokio::time::sleep(std::time::Duration::from_millis(300)).await;
                polls += 1;
                match PgConnection::connect_with(&options).await {
                    Ok(mut conn) => {
                        let ok: Result<i32, _> =
                            sqlx::query_scalar("SELECT 1").fetch_one(&mut conn).await;
                        if !matches!(ok, Ok(1)) {
                            failures += 1;
                        }
                        let _ = conn.close().await;
                    }
                    Err(_) => failures += 1,
                }
            }
            (polls, failures)
        })
    }

    async fn make_backup(
        ctx: &EmbeddedRecoveryContext,
        app_data_dir: &std::path::Path,
        name: &str,
        kind: BackupKind,
    ) -> bundle::BundleSummary {
        let destination = destination::resolve(None, ctx, DestinationPurpose::Manual).unwrap();
        let created = backup_engine::create_bundle(CreateBundleInput {
            ctx,
            destination: &destination.path,
            bundle_name: name,
            kind,
            stage_tag: "drill-test",
        })
        .await
        .unwrap_or_else(|e| panic!("create_bundle failed: {} - {}", e.code, e.log_detail));
        let _ = app_data_dir;
        created.summary
    }

    /// (a) plan Verify: a SAME-schema bundle drills successfully, is not
    /// migrated, its totals equal the source's own totals, and the drill
    /// folder is removed. The live server is untouched throughout.
    #[tokio::test]
    #[ignore = "spawns real, disposable PostgreSQL instances; run explicitly with -- --ignored"]
    async fn same_schema_bundle_drills_without_migrating() {
        use crate::infrastructure::safe_upgrade::test_support;

        let app_data_dir = test_support::temp_app_data_dir_for_tests("drill-same");
        let (bin_dir, pgdata, live_port) =
            test_support::provision_fresh_instance(&app_data_dir, 58580).await;
        let context = ctx(&app_data_dir, bin_dir.clone(), pgdata.clone());

        let seeded_count = {
            let mut conn =
                PgConnection::connect_with(&live_migrator_options(&app_data_dir, live_port))
                    .await
                    .unwrap();
            let count = test_support::seed_row_and_count(&mut conn).await;
            let _ = conn.close().await;
            count
        };

        let name = backup_proof::bundle_directory_name(time::OffsetDateTime::now_utc());
        let summary = make_backup(&context, &app_data_dir, &name, BackupKind::Manual).await;
        assert_eq!(summary.verdict, SchemaVerdict::Same);

        // WS-H-4 report requirement: prove (not just claim) that the live
        // database keeps answering *during* the drill, and record the
        // wall-clock duration the operator will actually wait through.
        let stop_polling = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let poller = spawn_live_poller(
            live_migrator_options(&app_data_dir, live_port),
            stop_polling.clone(),
        );

        let started = std::time::Instant::now();
        let report = run_isolated_drill(&context, &summary)
            .await
            .unwrap_or_else(|e| panic!("drill failed: {} - {}", e.code, e.log_detail));
        let elapsed = started.elapsed();
        println!("WS-H-4 timing: run_isolated_drill (SAME schema) took {elapsed:?}");

        stop_polling.store(true, std::sync::atomic::Ordering::Relaxed);
        let (polls, failures) = poller.await.unwrap();
        println!("WS-H-4: live server polled {polls} times during the drill, {failures} failures");
        assert!(
            polls >= 5,
            "the drill must run long enough to prove the live server stayed answerable, not just at the edges (polled {polls} times)"
        );
        assert_eq!(
            failures, 0,
            "the live server must answer every poll while the drill runs"
        );

        assert_eq!(report.verdict, SchemaVerdict::Same);
        assert!(!report.migrated_forward);
        assert!(report.server_stopped);
        assert!(!report.cleanup_pending);
        assert!(report.journal_balanced);
        assert_eq!(
            seeded_count, 1,
            "the marker row must be seeded exactly once before the backup is taken"
        );

        // No drill folder left behind.
        let parent = pgdata.parent().unwrap();
        assert!(
            std::fs::read_dir(parent)
                .unwrap()
                .filter_map(|e| e.ok())
                .all(|e| !e.file_name().to_string_lossy().starts_with(
                    crate::infrastructure::recovery_engine::drill_cluster::DRILL_DIR_PREFIX
                )),
            "no restore-drill-* folder may remain"
        );

        // The live server still answers.
        let live_conn =
            PgConnection::connect_with(&live_migrator_options(&app_data_dir, live_port))
                .await
                .expect("live server must still answer after the drill");
        let _ = live_conn.close().await;

        test_support::stop_server(&bin_dir, &pgdata);
        let _ = std::fs::remove_dir_all(&app_data_dir);
    }

    /// (c) plan Verify: a NEWER bundle is refused before any drill server is
    /// started, and no `restore-drill-*` folder is created.
    #[tokio::test]
    #[ignore = "spawns real, disposable PostgreSQL instances; run explicitly with -- --ignored"]
    async fn newer_bundle_is_refused_before_any_server_starts() {
        use crate::infrastructure::safe_upgrade::test_support;

        let app_data_dir = test_support::temp_app_data_dir_for_tests("drill-newer");
        let (bin_dir, pgdata, live_port) =
            test_support::provision_fresh_instance(&app_data_dir, 58590).await;
        let context = ctx(&app_data_dir, bin_dir.clone(), pgdata.clone());

        // Insert a fake newer migration row before dumping.
        {
            let mut conn =
                PgConnection::connect_with(&live_migrator_options(&app_data_dir, live_port))
                    .await
                    .unwrap();
            sqlx::query(
                "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time) \
                 VALUES (99999999999999, 'fake future migration', true, decode('00','hex'), 1)",
            )
            .execute(&mut conn)
            .await
            .unwrap();
            let _ = conn.close().await;
        }

        let name = backup_proof::bundle_directory_name(time::OffsetDateTime::now_utc());
        let summary = make_backup(&context, &app_data_dir, &name, BackupKind::Manual).await;
        assert_eq!(summary.verdict, SchemaVerdict::Newer);

        let error = run_isolated_drill(&context, &summary).await.unwrap_err();
        assert_eq!(error.code, codes::BACKUP_SCHEMA_NEWER_THAN_APP);

        let parent = pgdata.parent().unwrap();
        assert!(
            std::fs::read_dir(parent)
                .unwrap()
                .filter_map(|e| e.ok())
                .all(|e| !e.file_name().to_string_lossy().starts_with(
                    crate::infrastructure::recovery_engine::drill_cluster::DRILL_DIR_PREFIX
                )),
            "no restore-drill-* folder may be created for a refused NEWER bundle"
        );

        let live_conn =
            PgConnection::connect_with(&live_migrator_options(&app_data_dir, live_port))
                .await
                .expect("live server must still answer");
        let _ = live_conn.close().await;

        test_support::stop_server(&bin_dir, &pgdata);
        let _ = std::fs::remove_dir_all(&app_data_dir);
    }

    /// (b) plan Verify: an OLDER bundle (the newest migration's own
    /// bookkeeping row deleted before dumping — valid because the newest
    /// migration is idempotent) is restored and migrated forward to
    /// `UpToDate`.
    #[tokio::test]
    #[ignore = "spawns real, disposable PostgreSQL instances; run explicitly with -- --ignored"]
    async fn older_bundle_migrates_forward() {
        use crate::infrastructure::safe_upgrade::test_support;

        let app_data_dir = test_support::temp_app_data_dir_for_tests("drill-older");
        let (bin_dir, pgdata, live_port) =
            test_support::provision_fresh_instance(&app_data_dir, 58600).await;
        let context = ctx(&app_data_dir, bin_dir.clone(), pgdata.clone());

        {
            let mut conn =
                PgConnection::connect_with(&live_migrator_options(&app_data_dir, live_port))
                    .await
                    .unwrap();
            test_support::rewind_latest_migration(&mut conn).await;
            let _ = conn.close().await;
        }

        let name = backup_proof::bundle_directory_name(time::OffsetDateTime::now_utc());
        let summary = make_backup(&context, &app_data_dir, &name, BackupKind::Manual).await;
        assert_eq!(summary.verdict, SchemaVerdict::Older);

        let started = std::time::Instant::now();
        let report = run_isolated_drill(&context, &summary)
            .await
            .unwrap_or_else(|e| panic!("drill failed: {} - {}", e.code, e.log_detail));
        println!(
            "WS-H-4 timing: run_isolated_drill (OLDER schema, with forward migration) took {:?}",
            started.elapsed()
        );
        assert_eq!(report.verdict, SchemaVerdict::Older);
        assert!(report.migrated_forward);
        assert!(report.server_stopped);
        assert!(!report.cleanup_pending);
        assert!(report.journal_balanced);

        let parent = pgdata.parent().unwrap();
        assert!(
            std::fs::read_dir(parent)
                .unwrap()
                .filter_map(|e| e.ok())
                .all(|e| !e.file_name().to_string_lossy().starts_with(
                    crate::infrastructure::recovery_engine::drill_cluster::DRILL_DIR_PREFIX
                )),
            "no restore-drill-* folder may remain"
        );

        let live_conn =
            PgConnection::connect_with(&live_migrator_options(&app_data_dir, live_port))
                .await
                .expect("live server must still answer after the drill");
        let _ = live_conn.close().await;

        test_support::stop_server(&bin_dir, &pgdata);
        let _ = std::fs::remove_dir_all(&app_data_dir);
    }

    /// (d) plan Verify: a bundle whose migration history was tampered with
    /// (or is from a foreign build) fails with
    /// `DRILL_MIGRATION_HISTORY_MISMATCH`, and the drill folder is still
    /// removed (via `DrillCluster`'s own `Drop`, since the failure happens
    /// before this function's own explicit stop/remove step).
    #[tokio::test]
    #[ignore = "spawns real, disposable PostgreSQL instances; run explicitly with -- --ignored"]
    async fn tampered_migration_history_is_rejected() {
        use crate::infrastructure::safe_upgrade::test_support;

        let app_data_dir = test_support::temp_app_data_dir_for_tests("drill-tamper");
        let (bin_dir, pgdata, live_port) =
            test_support::provision_fresh_instance(&app_data_dir, 58610).await;
        let context = ctx(&app_data_dir, bin_dir.clone(), pgdata.clone());

        {
            let mut conn =
                PgConnection::connect_with(&live_migrator_options(&app_data_dir, live_port))
                    .await
                    .unwrap();
            test_support::corrupt_an_earlier_checksum(&mut conn).await;
            let _ = conn.close().await;
        }

        let name = backup_proof::bundle_directory_name(time::OffsetDateTime::now_utc());
        let summary = make_backup(&context, &app_data_dir, &name, BackupKind::Manual).await;
        assert_eq!(summary.verdict, SchemaVerdict::Same);

        let error = run_isolated_drill(&context, &summary).await.unwrap_err();
        assert_eq!(error.code, codes::DRILL_MIGRATION_HISTORY_MISMATCH);

        let parent = pgdata.parent().unwrap();
        assert!(
            std::fs::read_dir(parent)
                .unwrap()
                .filter_map(|e| e.ok())
                .all(|e| !e.file_name().to_string_lossy().starts_with(
                    crate::infrastructure::recovery_engine::drill_cluster::DRILL_DIR_PREFIX
                )),
            "the drill folder must be removed even on a history-mismatch failure"
        );

        let live_conn =
            PgConnection::connect_with(&live_migrator_options(&app_data_dir, live_port))
                .await
                .expect("live server must still answer");
        let _ = live_conn.close().await;

        test_support::stop_server(&bin_dir, &pgdata);
        let _ = std::fs::remove_dir_all(&app_data_dir);
    }
}
