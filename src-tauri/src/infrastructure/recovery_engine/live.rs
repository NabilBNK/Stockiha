//! Live-restore primitives (plan H5-01) — everything `restore_flow.rs`
//! needs to actually replace the live database, plus the safety-net asset
//! swap. Every function here operates directly on the live server; callers
//! are responsible for ordering (safety backup first, always).

use std::path::{Path, PathBuf};
use std::time::Duration;

use sqlx::postgres::PgConnectOptions;
use sqlx::{Connection, PgConnection};

use super::errors::{codes, EngineError};
use super::mode::EmbeddedRecoveryContext;
use super::tools::{self, RestoreTarget};
use crate::domain::recovery::RestoreControlTotals;
use crate::infrastructure::local_config::MigratorConnectionInfo;
use crate::infrastructure::safe_upgrade;
use crate::infrastructure::schema_version::{self, SchemaCompatibility};

pub(crate) async fn migrator_connection(
    info: &MigratorConnectionInfo,
) -> Result<PgConnection, EngineError> {
    let options = PgConnectOptions::new()
        .host(&info.host)
        .port(info.port)
        .database(&info.database)
        .username(&info.username)
        .password(info.password.as_str());
    let mut conn = PgConnection::connect_with(&options).await.map_err(|e| {
        EngineError::new(
            codes::RESTORE_RESET_FAILED,
            format!("could not connect as migrator: {e}"),
        )
    })?;
    sqlx::raw_sql("SET lock_timeout = '30s'; SET statement_timeout = 0;")
        .execute(&mut conn)
        .await
        .map_err(|e| {
            EngineError::new(
                codes::RESTORE_RESET_FAILED,
                format!("could not set session timeouts: {e}"),
            )
        })?;
    Ok(conn)
}

pub(crate) async fn count_users(conn: &mut PgConnection) -> Result<i64, EngineError> {
    sqlx::query_scalar(
        "SELECT CASE WHEN to_regclass('iam.users') IS NULL THEN 0 \
         ELSE (SELECT count(*) FROM iam.users) END",
    )
    .fetch_one(conn)
    .await
    .map_err(|e| {
        EngineError::new(
            codes::RESTORE_RESET_FAILED,
            format!("could not count iam.users: {e}"),
        )
    })
}

pub(crate) async fn wait_for_no_other_sessions(
    conn: &mut PgConnection,
    timeout: Duration,
) -> Result<(), EngineError> {
    let deadline = std::time::Instant::now() + timeout;
    loop {
        // `backend_type` is redacted (NULL) for another backend's row under
        // a non-`pg_read_all_stats` role — even a same-named role's own
        // *other* connections, discovered while writing H5-07's busy-
        // database test. `datname` is not redacted, and every background
        // worker (checkpointer, walwriter, autovacuum, …) reports `NULL`
        // there rather than this database's name, so filtering on it alone
        // already counts exactly the other real client connections.
        let others: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM pg_stat_activity \
             WHERE datname = current_database() AND pid <> pg_backend_pid()",
        )
        .fetch_one(&mut *conn)
        .await
        .map_err(|e| {
            EngineError::new(
                codes::RESTORE_DATABASE_BUSY,
                format!("could not read pg_stat_activity: {e}"),
            )
        })?;
        if others == 0 {
            return Ok(());
        }
        if std::time::Instant::now() >= deadline {
            return Err(EngineError::new(
                codes::RESTORE_DATABASE_BUSY,
                format!("{others} other client session(s) still connected after {timeout:?}"),
            ));
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}

pub(crate) async fn replace_database(
    ctx: &EmbeddedRecoveryContext,
    info: &MigratorConnectionInfo,
    dump: &Path,
    with_privileges: bool,
) -> Result<(), EngineError> {
    let mut conn = migrator_connection(info).await?;
    safe_upgrade::reset_all_schemas(&mut conn)
        .await
        .map_err(|e| EngineError::new(codes::RESTORE_RESET_FAILED, e))?;
    let _ = conn.close().await;

    let bin_dir = ctx.bin_dir.clone();
    let target_host = info.host.clone();
    let target_port = info.port;
    let target_database = info.database.clone();
    let target_username = info.username.clone();
    let target_password = info.password.as_str().to_string();
    let dump_path = dump.to_path_buf();
    tokio::task::spawn_blocking(move || {
        let target = RestoreTarget {
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
            codes::RESTORE_PG_RESTORE_FAILED,
        )
    })
    .await
    .map_err(|_| EngineError::new(codes::RESTORE_PG_RESTORE_FAILED, "restore worker panicked"))??;
    Ok(())
}

pub(crate) async fn bring_schema_forward(
    info: &MigratorConnectionInfo,
) -> Result<bool, EngineError> {
    let mut conn = migrator_connection(info).await?;
    let verdict = schema_version::check_schema_compatibility(&mut conn).await;
    let migrated = match verdict {
        SchemaCompatibility::OlderThanBinary { .. } => {
            schema_version::run_all_migrations(&mut conn)
                .await
                .map_err(|e| {
                    EngineError::new(codes::RESTORE_FORWARD_MIGRATION_FAILED, format!("{e}"))
                })?;
            true
        }
        SchemaCompatibility::UpToDate => false,
        other => {
            return Err(EngineError::new(
                codes::RESTORE_VERIFY_SCHEMA_FAILED,
                format!("unexpected schema state after restore: {other:?}"),
            ));
        }
    };
    let _ = conn.close().await;
    Ok(migrated)
}

pub(crate) async fn verify_restored(
    info: &MigratorConnectionInfo,
    expected: &RestoreControlTotals,
) -> Result<(), EngineError> {
    let mut conn = migrator_connection(info).await?;
    let verdict = schema_version::check_schema_compatibility(&mut conn).await;
    if verdict != SchemaCompatibility::UpToDate {
        return Err(EngineError::new(
            codes::RESTORE_VERIFY_SCHEMA_FAILED,
            format!("schema is {verdict:?} after restore, expected UpToDate"),
        ));
    }
    let (totals, journal_balanced) =
        crate::application::recovery::collect_restore_control_totals(&mut conn)
            .await
            .map_err(|e| {
                EngineError::new(codes::RESTORE_VERIFY_TOTALS_MISMATCH, format!("{e:?}"))
            })?;
    let _ = conn.close().await;
    if !journal_balanced {
        return Err(EngineError::new(
            codes::RESTORE_JOURNALS_UNBALANCED,
            "restored journals do not balance to zero",
        ));
    }
    if &totals != expected {
        return Err(EngineError::new(
            codes::RESTORE_VERIFY_TOTALS_MISMATCH,
            format!(
                "restored totals do not match the isolated test: expected {expected:?}, got {totals:?}"
            ),
        ));
    }
    Ok(())
}

/// The live asset directories a restore swaps in the backup's copies for,
/// paired with their corresponding flat file name inside the bundle.
const ASSET_TARGETS: [(&str, &str); 3] = [
    ("attachments", "attachments"),
    ("generated/customer-documents", "generated-documents"),
    ("company-assets", "company-assets"),
];

pub(crate) struct AssetSwap {
    previous_root: PathBuf,
    moved: Vec<(PathBuf, PathBuf)>,
}

pub(crate) fn swap_in_assets(
    app_data_dir: &Path,
    bundle_dir: &Path,
) -> Result<AssetSwap, EngineError> {
    let previous_root = app_data_dir.join(format!("recovery-asset-previous-{}", unix_now_secs()));
    let mut swap = AssetSwap {
        previous_root: previous_root.clone(),
        moved: Vec::new(),
    };

    let result: Result<(), EngineError> = (|| {
        for (live_relative, bundle_name) in ASSET_TARGETS {
            let live_path = app_data_dir.join(live_relative);
            if live_path.exists() {
                let saved_path = previous_root.join(live_relative);
                if let Some(parent) = saved_path.parent() {
                    std::fs::create_dir_all(parent).map_err(|e| {
                        EngineError::new(
                            codes::RESTORE_ASSET_COPY_FAILED,
                            format!("could not stage {}: {e}", saved_path.display()),
                        )
                    })?;
                }
                std::fs::rename(&live_path, &saved_path).map_err(|e| {
                    EngineError::new(
                        codes::RESTORE_ASSET_COPY_FAILED,
                        format!("could not move {} aside: {e}", live_path.display()),
                    )
                })?;
                swap.moved.push((saved_path, live_path.clone()));
            }

            std::fs::create_dir_all(&live_path).map_err(|e| {
                EngineError::new(
                    codes::RESTORE_ASSET_COPY_FAILED,
                    format!("could not create {}: {e}", live_path.display()),
                )
            })?;
            let bundle_asset_dir = bundle_dir.join(bundle_name);
            if bundle_asset_dir.is_dir() {
                for entry in std::fs::read_dir(&bundle_asset_dir).map_err(|e| {
                    EngineError::new(
                        codes::RESTORE_ASSET_COPY_FAILED,
                        format!("could not read {}: {e}", bundle_asset_dir.display()),
                    )
                })? {
                    let entry = entry.map_err(|e| {
                        EngineError::new(codes::RESTORE_ASSET_COPY_FAILED, format!("{e}"))
                    })?;
                    let path = entry.path();
                    if path.is_file() {
                        let target = live_path.join(entry.file_name());
                        std::fs::copy(&path, &target).map_err(|e| {
                            EngineError::new(
                                codes::RESTORE_ASSET_COPY_FAILED,
                                format!("could not copy {}: {e}", path.display()),
                            )
                        })?;
                    }
                }
            }
        }
        Ok(())
    })();

    match result {
        Ok(()) => Ok(swap),
        Err(error) => {
            restore_previous_assets(&swap, app_data_dir);
            Err(error)
        }
    }
}

pub(crate) fn restore_previous_assets(swap: &AssetSwap, _app_data_dir: &Path) -> bool {
    let mut all_ok = true;
    for (saved_path, live_path) in &swap.moved {
        let _ = std::fs::remove_dir_all(live_path);
        if std::fs::rename(saved_path, live_path).is_err() {
            all_ok = false;
        }
    }
    all_ok
}

pub(crate) fn discard_previous_assets(swap: &AssetSwap) {
    let _ = std::fs::remove_dir_all(&swap.previous_root);
}

fn unix_now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub(crate) struct RestoreEventRow {
    pub restore_mode: &'static str,
    pub bundle_identifier: String,
    pub backup_kind: String,
    pub bundle_schema_version: String,
    pub restored_schema_version: String,
    pub migrated_forward: bool,
    pub actor_username: Option<String>,
    pub workstation_id: Option<String>,
    pub safety_bundle_identifier: Option<String>,
}

/// Non-fatal by design (plan R16): the data has already been restored and
/// verified by the time this runs, so a logging failure here must never
/// turn a successful restore into a reported failure. Runs as the migrator,
/// `SET ROLE stockiha_owner` (the table is owned by `stockiha_owner` and
/// `stockiha_migrator` is already provisioned to assume that role, exactly
/// like every migration file).
pub(crate) async fn record_restore_event(
    info: &MigratorConnectionInfo,
    event: &RestoreEventRow,
) -> Result<(), EngineError> {
    let mut conn = migrator_connection(info).await?;
    sqlx::raw_sql("SET ROLE stockiha_owner")
        .execute(&mut conn)
        .await
        .map_err(|e| EngineError::new(codes::RESTORE_RESET_FAILED, format!("{e}")))?;
    sqlx::query(
        "INSERT INTO operations.restore_events \
         (restore_mode, bundle_identifier, backup_kind, bundle_schema_version, \
          restored_schema_version, migrated_forward, actor_username, workstation_id, \
          safety_bundle_identifier) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(event.restore_mode)
    .bind(&event.bundle_identifier)
    .bind(&event.backup_kind)
    .bind(&event.bundle_schema_version)
    .bind(&event.restored_schema_version)
    .bind(event.migrated_forward)
    .bind(&event.actor_username)
    .bind(&event.workstation_id)
    .bind(&event.safety_bundle_identifier)
    .execute(&mut conn)
    .await
    .map_err(|e| EngineError::new(codes::RESTORE_RESET_FAILED, format!("{e}")))?;
    let _ = conn.close().await;
    Ok(())
}

/// Fault injection points for the H5-07 ignored tests (plan H5-02). No
/// production caller ever constructs a non-default value: there is no IPC
/// field or code path that could set one from a Tauri command.
#[derive(Default, Clone, Copy)]
pub(crate) struct RestoreFaults {
    pub fail_after_replace: bool,
    pub fail_verify: bool,
    pub fail_rollback: bool,
}
