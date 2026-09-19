//! EMBEDDED-mode bundle creation (plan H3-07).
//!
//! Preflight (binaries, `pg_dump` major 18, migrator credential, real
//! schema version, free space) → stage directory inside the destination →
//! `backup_proof::create_backup_bundle` with a migrator-authenticated
//! `pg_dump` taken **with** privileges → format 2 metadata → full
//! validation while still staged → rename into place → validate again.
//! Every step is logged to `recovery.log` under operation `BACKUP`; the
//! staging directory is removed on every exit path by a drop guard.

use std::cell::RefCell;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use sqlx::postgres::PgConnectOptions;
use sqlx::{Connection, PgConnection};

use super::bundle::{self, BackupKind, BundleMetadata, BundleSummary};
use super::errors::{codes, EngineError};
use super::log;
use super::mode::EmbeddedRecoveryContext;
use super::schema;
use super::tools;
use crate::application::recovery_creation::{collect_backup_inputs, parse_bundle_identifier_time};
use crate::infrastructure::backup_proof::{self, BackupProofError};
use crate::infrastructure::local_config::{self, MigratorConnectionInfo};
use crate::infrastructure::pg_process;

const LOG_OPERATION: &str = "BACKUP";

/// Free space required on the destination volume: twice the live database
/// size (the dump plus the same order of margin `safe_upgrade` uses) plus a
/// fixed 50 MB for metadata, assets and filesystem overhead.
const FREE_SPACE_FIXED_MARGIN_BYTES: u64 = 50 * 1024 * 1024;

pub(crate) struct CreateBundleInput<'a> {
    pub ctx: &'a EmbeddedRecoveryContext,
    /// Resolved, real directory (see `destination::resolve`).
    pub destination: &'a Path,
    /// Canonical `GestStock-Backup-YYYYMMDD-HHMMSS`, from the audit envelope.
    pub bundle_name: &'a str,
    pub kind: BackupKind,
    /// e.g. the attempt id — makes the staging folder name unique.
    pub stage_tag: &'a str,
}

pub(crate) struct CreatedBundle {
    pub path: PathBuf,
    pub summary: BundleSummary,
}

/// Same seven lines as `safe_upgrade::connect_options`; the migrator's
/// session role is already `stockiha_owner` for this database.
pub(crate) fn migrator_connect_options(info: &MigratorConnectionInfo) -> PgConnectOptions {
    PgConnectOptions::new()
        .host(&info.host)
        .port(info.port)
        .username(&info.username)
        .password(info.password.as_str())
        .database(&info.database)
}

struct StageGuard(PathBuf);

impl Drop for StageGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

pub(crate) async fn create_bundle(
    input: CreateBundleInput<'_>,
) -> Result<CreatedBundle, EngineError> {
    let ctx = input.ctx;
    let app_data_dir = ctx.app_data_dir.clone();
    let step = |line: String| log::append(&app_data_dir, LOG_OPERATION, &line);
    let fail = |error: EngineError| {
        log::append(
            &app_data_dir,
            LOG_OPERATION,
            &format!("FAILED: {} - {}", error.code, error.log_detail),
        );
        error
    };

    step(format!(
        "START: {} kind={} destination={}",
        input.bundle_name,
        input.kind.as_str(),
        input.destination.display()
    ));

    // 1. Bundled binaries.
    pg_process::preflight_backup_binaries(&ctx.bin_dir).map_err(|detail| {
        fail(EngineError::new(
            codes::BACKUP_PREFLIGHT_BINARIES_MISSING,
            detail,
        ))
    })?;

    // 2. pg_dump version (major 18).
    let (pg_version_string, _major) =
        tools::pg_tool_version(&ctx.bin_dir, tools::PG_DUMP_EXE).map_err(&fail)?;

    // 3. Migrator credential.
    let info = local_config::load_migrator_connection_info(&ctx.app_data_dir).ok_or_else(|| {
        fail(EngineError::new(
            codes::BACKUP_SCHEMA_VERSION_UNREADABLE,
            "migrator credential missing",
        ))
    })?;

    // 4. Real schema version + database size, through one short-lived
    //    migrator connection that is closed before pg_dump runs.
    let (applied_version, db_size) = read_schema_version_and_size(&info).await.map_err(&fail)?;
    step(format!(
        "PREFLIGHT: DONE - schema={applied_version} db_size={db_size} pg=\"{pg_version_string}\""
    ));

    // 5. Free space on the destination volume.
    let required = db_size
        .saturating_mul(2)
        .saturating_add(FREE_SPACE_FIXED_MARGIN_BYTES);
    match pg_process::free_disk_space_bytes(input.destination) {
        Some(free) if free >= required => {}
        Some(free) => {
            return Err(fail(EngineError::new(
                codes::BACKUP_INSUFFICIENT_SPACE,
                format!(
                    "need {required} bytes free on {}, have {free}",
                    input.destination.display()
                ),
            )));
        }
        None => {
            return Err(fail(EngineError::new(
                codes::BACKUP_INSUFFICIENT_SPACE,
                format!(
                    "free space on {} could not be determined",
                    input.destination.display()
                ),
            )));
        }
    }

    // 6. Final path must not exist.
    let final_path = input.destination.join(input.bundle_name);
    if final_path.exists() {
        return Err(fail(EngineError::new(
            codes::BACKUP_IDENTIFIER_COLLISION,
            format!("{} already exists", final_path.display()),
        )));
    }

    // 7. Stage root inside the destination (same volume as the final path,
    //    so the publish step is a rename).
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let stage_root = input.destination.join(format!(
        ".{}.staging-{}-{nanos}",
        input.bundle_name, input.stage_tag
    ));
    std::fs::create_dir(&stage_root).map_err(|e| {
        fail(EngineError::new(
            codes::BACKUP_STAGE_FAILED,
            format!("create {} ({e})", stage_root.display()),
        ))
    })?;
    let _stage_guard = StageGuard(stage_root.clone());

    // 8. Bundle time from the canonical name.
    let bundle_time = parse_bundle_identifier_time(input.bundle_name).map_err(|_| {
        fail(EngineError::new(
            codes::BACKUP_STAGE_FAILED,
            format!("'{}' is not a canonical bundle name", input.bundle_name),
        ))
    })?;

    // 9. Asset inputs.
    let inputs = collect_backup_inputs(&ctx.app_data_dir).map_err(|error| {
        fail(EngineError::new(
            codes::BACKUP_ASSET_COPY_FAILED,
            format!("asset collection failed ({error:?})"),
        ))
    })?;

    // 10. Dump + assemble, on the blocking pool. The real `EngineError` from
    //     `run_pg_dump` is captured beside the closure so its code and
    //     stderr detail survive `backup_proof`'s own opaque error type.
    let bin_dir = ctx.bin_dir.clone();
    let stage_for_task = stage_root.clone();
    let pg_version_for_task = pg_version_string.clone();
    let expected_name = input.bundle_name.to_string();
    let staged = tokio::task::spawn_blocking(move || {
        let dump_error: RefCell<Option<EngineError>> = RefCell::new(None);
        let result = backup_proof::create_backup_bundle(
            &stage_for_task,
            bundle_time,
            &pg_version_for_task,
            &inputs,
            |out| {
                tools::run_pg_dump(&bin_dir, &info, out).map_err(|error| {
                    *dump_error.borrow_mut() = Some(error);
                    BackupProofError::PgDumpFailed(None)
                })
            },
        );
        drop(info);
        match result {
            Ok(path) => {
                if path.file_name().and_then(|n| n.to_str()) != Some(expected_name.as_str()) {
                    return Err(EngineError::new(
                        codes::BACKUP_STAGE_FAILED,
                        format!(
                            "staged folder {} does not match {expected_name}",
                            path.display()
                        ),
                    ));
                }
                Ok(path)
            }
            Err(error) => Err(dump_error.into_inner().unwrap_or_else(|| {
                EngineError::new(
                    codes::BACKUP_STAGE_FAILED,
                    format!("bundle assembly failed: {error}"),
                )
            })),
        }
    })
    .await
    .map_err(|_| {
        fail(EngineError::new(
            codes::BACKUP_STAGE_FAILED,
            "backup worker panicked",
        ))
    })?
    .map_err(&fail)?;
    step("DUMP: DONE".to_string());

    // 11. Format 2 metadata.
    let applied_text = applied_version.to_string();
    bundle::finalize_bundle_metadata(
        &staged,
        &BundleMetadata {
            schema_version: &applied_text,
            app_version: &ctx.app_version,
            kind: input.kind,
        },
    )
    .map_err(&fail)?;

    // 12. Validate while still staged.
    let staged_summary = inspect_after_create(&staged).map_err(&fail)?;
    if staged_summary.validated.schema_version != applied_text {
        return Err(fail(EngineError::new(
            codes::BACKUP_VALIDATION_AFTER_CREATE_FAILED,
            "staged schema version does not match the applied version",
        )));
    }

    // 13. Publish.
    if final_path.exists() {
        return Err(fail(EngineError::new(
            codes::BACKUP_IDENTIFIER_COLLISION,
            format!("{} appeared during staging", final_path.display()),
        )));
    }
    std::fs::rename(&staged, &final_path).map_err(|e| {
        fail(EngineError::new(
            codes::BACKUP_PUBLISH_FAILED,
            format!("rename to {} failed ({e})", final_path.display()),
        ))
    })?;

    // 14. Validate the published bundle.
    let summary = inspect_after_create(&final_path).map_err(&fail)?;
    step(format!(
        "SUCCEEDED: {} files={} bytes={} verdict={}",
        final_path.display(),
        summary.file_count,
        summary.total_bytes,
        summary.verdict.as_str()
    ));
    Ok(CreatedBundle {
        path: final_path,
        summary,
    })
}

fn inspect_after_create(dir: &Path) -> Result<BundleSummary, EngineError> {
    bundle::inspect_bundle(dir, true).map_err(|error| {
        EngineError::new(
            codes::BACKUP_VALIDATION_AFTER_CREATE_FAILED,
            format!("{}: {}", error.code, error.log_detail),
        )
    })
}

async fn read_schema_version_and_size(
    info: &MigratorConnectionInfo,
) -> Result<(i64, u64), EngineError> {
    let mut conn = PgConnection::connect_with(&migrator_connect_options(info))
        .await
        .map_err(|e| {
            EngineError::new(
                codes::BACKUP_SCHEMA_VERSION_UNREADABLE,
                format!("migrator connection failed ({e})"),
            )
        })?;
    let applied = schema::applied_version(&mut conn)
        .await
        .map_err(|detail| EngineError::new(codes::BACKUP_SCHEMA_VERSION_UNREADABLE, detail))?;
    let size: i64 = sqlx::query_scalar("SELECT pg_database_size(current_database())")
        .fetch_one(&mut conn)
        .await
        .map_err(|e| {
            EngineError::new(
                codes::BACKUP_SCHEMA_VERSION_UNREADABLE,
                format!("could not determine the database size ({e})"),
            )
        })?;
    let _ = conn.close().await;
    Ok((applied, size.max(0) as u64))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Windows-only real proof (plan H3-07 Verify): provision a fresh
    /// embedded instance with the WS-K-5 test support, create a bundle, and
    /// check every format 2 property including that the dump carries ACLs.
    #[tokio::test]
    #[ignore = "spawns a real, disposable PostgreSQL instance; run explicitly with -- --ignored"]
    async fn creates_format_2_bundle_with_privileges() {
        use crate::infrastructure::safe_upgrade::test_support;
        use std::process::{Command, Stdio};

        // Short label on purpose: the staged dump path nests two temp levels
        // under the destination and `pg_dump` (a plain Win32 program) cannot
        // open paths beyond MAX_PATH (260); the long default label pushed it
        // to 267 characters.
        let app_data_dir = test_support::temp_app_data_dir_for_tests("re");
        let (bin_dir, pgdata, _port) =
            test_support::provision_fresh_instance(&app_data_dir, 58560).await;
        let resource_dir = test_support::bundled_resource_dir_for_tests();
        let ctx = EmbeddedRecoveryContext {
            app_data_dir: app_data_dir.clone(),
            resource_dir: dunce::simplified(&resource_dir).to_path_buf(),
            bin_dir: bin_dir.clone(),
            pgdata: pgdata.clone(),
            app_version: "0.5.0-test".to_string(),
        };

        // Seed a row so the dump is not trivially empty.
        {
            let info = local_config::load_migrator_connection_info(&app_data_dir).unwrap();
            let mut conn = PgConnection::connect_with(&migrator_connect_options(&info))
                .await
                .unwrap();
            test_support::seed_row_and_count(&mut conn).await;
            let _ = conn.close().await;
        }

        let destination = app_data_dir.join("operator-backups");
        std::fs::create_dir_all(&destination).unwrap();
        let name = backup_proof::bundle_directory_name(time::OffsetDateTime::now_utc());
        let created = create_bundle(CreateBundleInput {
            ctx: &ctx,
            destination: &destination,
            bundle_name: &name,
            kind: BackupKind::Manual,
            stage_tag: "test",
        })
        .await;
        test_support::stop_server(&bin_dir, &pgdata);
        let created =
            created.unwrap_or_else(|e| panic!("create_bundle failed: {e} - {}", e.log_detail));

        assert_eq!(created.path, destination.join(&name));
        assert_eq!(created.summary.validated.bundle_format_version, 2);
        assert!(created.summary.validated.dump_includes_privileges);
        assert_eq!(created.summary.backup_kind(), "MANUAL");
        assert_eq!(
            created.summary.validated.schema_version,
            crate::infrastructure::schema_version::embedded_latest_version().to_string()
        );
        assert!(created.summary.restorable);
        assert!(backup_proof::validate_bundle(&created.path).is_ok());
        assert!(
            !std::fs::read_dir(&destination).unwrap().any(|e| e
                .unwrap()
                .file_name()
                .to_string_lossy()
                .contains(".staging-")),
            "no staging folder may remain"
        );
        assert!(app_data_dir.join(log::LOG_FILE_NAME).is_file());

        // The archive must contain ACL entries (privileges kept).
        let mut command = Command::new(bin_dir.join(tools::PG_RESTORE_EXE));
        pg_process::hide_console_window(&mut command);
        let output = command
            .arg("--list")
            .arg(created.path.join(backup_proof::DUMP_FILENAME))
            .stdin(Stdio::null())
            .output()
            .unwrap();
        assert!(output.status.success());
        let listing = String::from_utf8_lossy(&output.stdout);
        assert!(listing.contains("ACL"), "dump must carry GRANTs: {listing}");

        let _ = std::fs::remove_dir_all(&app_data_dir);
    }
}
