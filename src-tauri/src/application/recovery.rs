use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use serde_json::Value as JsonValue;
use sqlx::{query_scalar, Connection, PgConnection, PgPool};

use crate::domain::recovery::{
    OperatorBackupValidationResult, OperatorRestoreVerificationResult, RestoreControlTotals,
    ValidateOperatorBackupRequest, VerifyOperatorBackupRestoreRequest,
};
use crate::error::AppError;
use crate::infrastructure::{backup_proof, restore_proof};

pub(crate) const BACKUP_ROOT_ENV: &str = "STOCKIHA_BACKUP_ROOT";
pub(crate) const RESTORE_ADMIN_URL_ENV: &str = "STOCKIHA_RESTORE_ADMIN_DATABASE_URL";

/// WS-H-2: report a missing recovery environment at startup, by name.
///
/// `run.bat` is the only launcher that exports the recovery environment.
/// Launching with a bare `npm run tauri dev` leaves `STOCKIHA_BACKUP_ROOT`
/// and `STOCKIHA_RESTORE_ADMIN_DATABASE_URL` unset, and the operator then
/// meets those gaps *later*, as "The application configuration is missing or
/// invalid" when creating a backup and "Restore verification is not
/// configured on this computer" when verifying a restore. Both read like a
/// broken feature; neither names the actual cause, and a real Windows
/// acceptance pass was lost to exactly that misreading.
///
/// This is the same rule already applied to `BACKUP_BUNDLE_OUTSIDE_ROOT`: a
/// misleading error costs more than a missing one. Reported once, at startup,
/// naming the variable and the fix. Never fatal — an operator who only needs
/// the non-recovery parts of the app must still be able to run it.
///
/// Mirrored to stderr for the same reason `startup_diagnostic` is: `tracing`
/// is installed in debug builds only, and this message must not be filtered
/// away in a release build.
pub(crate) fn startup_environment_diagnostic() {
    let missing: Vec<&str> = [BACKUP_ROOT_ENV, RESTORE_ADMIN_URL_ENV]
        .into_iter()
        .filter(|name| std::env::var_os(name).is_none_or(|value| value.is_empty()))
        .collect();

    if missing.is_empty() {
        return;
    }

    let detail = format!(
        "backup and recovery is not fully configured: {} not set. \
         Launch Stockiha through run.bat, which exports the recovery \
         environment; a bare `npm run tauri dev` does not. Until then, \
         creating a backup and verifying a restore will fail.",
        missing.join(" and ")
    );
    tracing::warn!("{detail}");
    eprintln!("[RECOVERY_STARTUP] {detail}");
}

/// WS-H-2: drop restore-drill databases stranded by a previous run.
///
/// A real Windows session left two 15 MB `stockiha_restore_proof_verify_*`
/// duplicates of the production database behind, because a PostgreSQL backend
/// crash killed the drill's maintenance connection before it could issue the
/// drop. No in-process guard can cover that case — by the time the connection
/// is gone there is nothing left to run cleanup on — so the sweep runs at
/// application start, when no drill of this process can be in flight.
///
/// Silent when the restore-admin connection is not configured: that is
/// already reported by [`startup_environment_diagnostic`], and repeating it
/// here would just add noise. Never fatal — a failed sweep must not stop the
/// application from starting.
pub(crate) async fn sweep_orphaned_restore_databases() {
    let Ok(raw_admin_url) = std::env::var(RESTORE_ADMIN_URL_ENV) else {
        return;
    };
    let Ok(parsed) = restore_proof::parse_admin_url(&raw_admin_url) else {
        tracing::warn!("restore drill sweep skipped: {RESTORE_ADMIN_URL_ENV} could not be parsed");
        return;
    };

    let options = restore_proof::admin_connect_options(&parsed);
    match restore_proof::sweep_orphaned_temp_databases(&options).await {
        Ok(dropped) if dropped.is_empty() => {
            tracing::info!("restore drill sweep: no leftover temporary databases");
        }
        Ok(dropped) => {
            let detail = format!(
                "restore drill sweep: dropped {} leftover temporary database(s): {}",
                dropped.len(),
                dropped.join(", ")
            );
            tracing::warn!("{detail}");
            eprintln!("[RESTORE_CLEANUP] {detail}");
        }
        Err(_) => {
            tracing::warn!(
                "restore drill sweep could not run (maintenance connection unavailable); \
                 any leftover temporary databases remain until the next start"
            );
        }
    }
}

#[derive(Deserialize)]
struct RecoveryAttemptEnvelope {
    attempt_id: i64,
    is_replay: bool,
    status: String,
    error_code: Option<String>,
    result: Option<JsonValue>,
    current_schema_version: String,
}

pub(crate) enum ValidationAttempt {
    Run {
        attempt_id: i64,
        request_id: String,
        bundle_path: PathBuf,
        bundle_identifier: String,
        current_schema_version: String,
    },
    Replay(OperatorBackupValidationResult),
}

pub(crate) enum RestoreVerificationAttempt {
    Run {
        attempt_id: i64,
        request_id: String,
        bundle_path: PathBuf,
        bundle_identifier: String,
        current_schema_version: String,
    },
    Replay(OperatorRestoreVerificationResult),
}

pub(crate) async fn begin_operator_backup_validation(
    pool: &PgPool,
    session_token: &str,
    request: ValidateOperatorBackupRequest,
) -> Result<ValidationAttempt, AppError> {
    request
        .validate()
        .map_err(|diagnostic| AppError::ValidationError { diagnostic })?;

    let (bundle_path, bundle_identifier) = selected_bundle_identity(&request.bundle_path)?;

    let value: JsonValue =
        query_scalar("SELECT operations.begin_recovery_attempt($1, $2, 'VALIDATE_BACKUP', $3)")
            .bind(session_token)
            .bind(request.request_id.trim())
            .bind(&bundle_identifier)
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    let envelope = parse_attempt_envelope(value)?;

    match envelope.status.as_str() {
        "SUCCEEDED" => {
            let result = envelope.result.ok_or_else(|| {
                AppError::internal("completed recovery attempt has no result metadata")
            })?;
            let parsed: OperatorBackupValidationResult =
                serde_json::from_value(result).map_err(|error| {
                    AppError::internal(format!(
                        "failed to parse completed backup validation result: {error}"
                    ))
                })?;
            if parsed.request_id != request.request_id.trim()
                || parsed.bundle_identifier != bundle_identifier
            {
                return Err(AppError::internal(
                    "completed backup validation result does not match its request",
                ));
            }
            Ok(ValidationAttempt::Replay(parsed))
        }
        "FAILED" => Err(AppError::BackupValidationFailed {
            diagnostic: envelope
                .error_code
                .unwrap_or_else(|| "BACKUP_VALIDATION_FAILED".to_string()),
        }),
        "STARTED" => Ok(ValidationAttempt::Run {
            attempt_id: envelope.attempt_id,
            request_id: request.request_id.trim().to_string(),
            bundle_path,
            bundle_identifier,
            current_schema_version: envelope.current_schema_version,
        }),
        other => Err(AppError::internal(format!(
            "unknown recovery attempt status: {other}"
        ))),
    }
}

pub(crate) async fn begin_operator_restore_verification(
    pool: &PgPool,
    session_token: &str,
    request: VerifyOperatorBackupRestoreRequest,
) -> Result<RestoreVerificationAttempt, AppError> {
    request
        .validate()
        .map_err(|diagnostic| AppError::ValidationError { diagnostic })?;

    let (bundle_path, bundle_identifier) = selected_bundle_identity(&request.bundle_path)?;

    let value: JsonValue =
        query_scalar("SELECT operations.begin_restore_verification_attempt($1, $2, $3)")
            .bind(session_token)
            .bind(request.request_id.trim())
            .bind(&bundle_identifier)
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    let envelope = parse_attempt_envelope(value)?;

    match envelope.status.as_str() {
        "SUCCEEDED" => {
            let result = envelope.result.ok_or_else(|| {
                AppError::internal("completed restore verification has no result metadata")
            })?;
            let parsed: OperatorRestoreVerificationResult = serde_json::from_value(result)
                .map_err(|error| {
                    AppError::internal(format!(
                        "failed to parse completed restore verification result: {error}"
                    ))
                })?;
            if parsed.request_id != request.request_id.trim()
                || parsed.bundle_identifier != bundle_identifier
            {
                return Err(AppError::internal(
                    "completed restore verification result does not match its request",
                ));
            }
            Ok(RestoreVerificationAttempt::Replay(parsed))
        }
        "FAILED" => Err(AppError::BackupValidationFailed {
            diagnostic: envelope
                .error_code
                .unwrap_or_else(|| "RESTORE_VERIFICATION_FAILED".to_string()),
        }),
        "STARTED" => Ok(RestoreVerificationAttempt::Run {
            attempt_id: envelope.attempt_id,
            request_id: request.request_id.trim().to_string(),
            bundle_path,
            bundle_identifier,
            current_schema_version: envelope.current_schema_version,
        }),
        other => Err(AppError::internal(format!(
            "unknown restore verification status: {other}"
        ))),
    }
}

fn parse_attempt_envelope(value: JsonValue) -> Result<RecoveryAttemptEnvelope, AppError> {
    serde_json::from_value(value).map_err(|error| {
        AppError::internal(format!(
            "failed to parse recovery attempt envelope: {error}"
        ))
    })
}

fn selected_bundle_identity(bundle_path: &str) -> Result<(PathBuf, String), AppError> {
    let bundle_path = PathBuf::from(bundle_path.trim());
    let bundle_identifier = bundle_path
        .file_name()
        .and_then(OsStr::to_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::ValidationError {
            diagnostic: "backup bundle path has no safe final directory name".to_string(),
        })?
        .to_string();

    if !is_canonical_bundle_identifier(&bundle_identifier) {
        return Err(AppError::ValidationError {
            diagnostic: "backup bundle identifier does not match the Stockiha format".to_string(),
        });
    }

    Ok((bundle_path, bundle_identifier))
}

fn canonical_selected_bundle(
    bundle_path: &Path,
    bundle_identifier: &str,
    canonical_root: &Path,
) -> Result<PathBuf, AppError> {
    let selected_metadata =
        fs::symlink_metadata(bundle_path).map_err(|_| AppError::BackupValidationFailed {
            diagnostic: "BACKUP_PROOF_BUNDLE_LAYOUT_INVALID".to_string(),
        })?;
    if is_symlink_or_reparse(&selected_metadata) || !selected_metadata.is_dir() {
        return Err(AppError::BackupValidationFailed {
            diagnostic: "BACKUP_PROOF_REJECTED_SYMLINK_INPUT".to_string(),
        });
    }

    let canonical_bundle =
        bundle_path
            .canonicalize()
            .map_err(|_| AppError::BackupValidationFailed {
                diagnostic: "BACKUP_PROOF_BUNDLE_LAYOUT_INVALID".to_string(),
            })?;
    let canonical_metadata =
        fs::symlink_metadata(&canonical_bundle).map_err(|_| AppError::BackupValidationFailed {
            diagnostic: "BACKUP_PROOF_BUNDLE_LAYOUT_INVALID".to_string(),
        })?;
    if is_symlink_or_reparse(&canonical_metadata) || !canonical_metadata.is_dir() {
        return Err(AppError::BackupValidationFailed {
            diagnostic: "BACKUP_PROOF_REJECTED_SYMLINK_INPUT".to_string(),
        });
    }

    if canonical_bundle.parent() != Some(canonical_root) {
        return Err(AppError::BackupBundleOutsideRoot {
            diagnostic: "backup bundle is outside the configured root".to_string(),
        });
    }
    if canonical_bundle.file_name().and_then(OsStr::to_str) != Some(bundle_identifier) {
        return Err(AppError::ValidationError {
            diagnostic: "canonical backup bundle identifier changed during path resolution"
                .to_string(),
        });
    }

    Ok(canonical_bundle)
}

pub(crate) fn validate_operator_backup_files(
    request_id: String,
    bundle_path: PathBuf,
    bundle_identifier: String,
    current_schema_version: String,
    canonical_root: PathBuf,
) -> Result<OperatorBackupValidationResult, AppError> {
    let canonical_bundle =
        canonical_selected_bundle(&bundle_path, &bundle_identifier, &canonical_root)?;
    let validated = backup_proof::validate_bundle(&canonical_bundle).map_err(|error| {
        AppError::BackupValidationFailed {
            diagnostic: error.to_string(),
        }
    })?;
    let (file_count, total_bytes) = canonical_bundle_stats(&canonical_bundle)?;

    Ok(OperatorBackupValidationResult {
        request_id,
        created_at_label: bundle_identifier
            .strip_prefix(backup_proof::BUNDLE_NAME_PREFIX)
            .unwrap_or_default()
            .to_string(),
        bundle_identifier,
        application_compatible: validated.application_version == env!("CARGO_PKG_VERSION"),
        schema_compatible: validated.schema_version == current_schema_version,
        postgres_compatible: validated.postgres_major_version
            == backup_proof::REQUIRED_PG_MAJOR_VERSION,
        application_version: validated.application_version,
        schema_version: validated.schema_version,
        postgres_major_version: validated.postgres_major_version,
        integrity_valid: true,
        file_count,
        total_bytes,
    })
}

pub(crate) async fn verify_operator_backup_restore_runtime(
    request_id: String,
    bundle_path: PathBuf,
    bundle_identifier: String,
    current_schema_version: String,
    canonical_root: PathBuf,
) -> Result<OperatorRestoreVerificationResult, AppError> {
    let canonical_bundle =
        canonical_selected_bundle(&bundle_path, &bundle_identifier, &canonical_root)?;
    let validated =
        restore_proof::preflight_bundle(&canonical_bundle).map_err(map_restore_error)?;

    if validated.application_version != env!("CARGO_PKG_VERSION")
        || validated.schema_version != current_schema_version
        || validated.postgres_major_version != backup_proof::REQUIRED_PG_MAJOR_VERSION
    {
        return Err(AppError::PreconditionFailed {
            diagnostic: "backup versions are not compatible with this Stockiha build".to_string(),
        });
    }

    let raw_admin_url =
        std::env::var(RESTORE_ADMIN_URL_ENV).map_err(|_| AppError::RestoreAdminNotConfigured {
            diagnostic: format!("{RESTORE_ADMIN_URL_ENV} is not configured"),
        })?;
    let parsed = restore_proof::parse_admin_url(&raw_admin_url).map_err(map_restore_error)?;
    let maintenance_options = restore_proof::admin_connect_options(&parsed);
    let mut maintenance = PgConnection::connect_with(&maintenance_options)
        .await
        .map_err(|_| AppError::database_unavailable("restore maintenance connection failed"))?;
    restore_proof::verify_maintenance_database(&mut maintenance)
        .await
        .map_err(map_restore_error)?;

    let temporary_database = restore_proof::generate_temp_db_name("verify");
    if let Err(original) =
        restore_proof::create_database(&mut maintenance, &temporary_database).await
    {
        let original = map_restore_error(original);
        let _ =
            restore_proof::drop_database_with_force(&mut maintenance, &temporary_database).await;
        return Err(original);
    }

    // WS-H-2: constructed on the very next line after `CREATE DATABASE`
    // succeeded, so there is no path between creation and the guard that can
    // strand the database. From here on, every early return, `?`, and panic
    // drops it — previously only the code below reaching its normal end did,
    // which is how a PostgreSQL backend crash left two 15 MB duplicates
    // behind. The guard connects afresh rather than reusing `maintenance`,
    // because in that crash the maintenance connection is exactly what died.
    let mut temp_db_guard =
        restore_proof::TempDbGuard::new(temporary_database.clone(), maintenance_options.clone());

    let operation_result = async {
        let executable = restore_proof::resolve_pg_restore_executable();
        let dump_path = validated.dump_path.clone();
        let host = parsed.host.clone();
        let port = parsed.port;
        let username = parsed.username.clone();
        let password = parsed.password.clone();
        let database = temporary_database.clone();

        let restore_result = tokio::task::spawn_blocking(move || {
            restore_proof::discover_and_validate_pg_restore(&executable)?;
            let target = restore_proof::PgRestoreTarget {
                host: &host,
                port,
                database: &database,
            };
            restore_proof::run_pg_restore(&executable, &target, &username, &password, &dump_path)
        })
        .await
        .map_err(|_| AppError::BackupValidationFailed {
            diagnostic: "RESTORE_VERIFICATION_WORKER_FAILED".to_string(),
        })?;
        restore_result.map_err(map_restore_error)?;

        let restored_options =
            restore_proof::admin_connect_options(&parsed).database(&temporary_database);
        let mut restored = PgConnection::connect_with(&restored_options)
            .await
            .map_err(|_| {
                AppError::database_unavailable("temporary restored database unavailable")
            })?;

        let (control_totals, journal_balanced) =
            collect_restore_control_totals(&mut restored).await?;
        restored
            .close()
            .await
            .map_err(|_| AppError::BackupValidationFailed {
                diagnostic: "RESTORE_VERIFICATION_CONNECTION_CLOSE_FAILED".to_string(),
            })?;

        Ok::<_, AppError>((control_totals, journal_balanced))
    }
    .await;

    let cleanup_result =
        restore_proof::drop_database_with_force(&mut maintenance, &temporary_database).await;
    if cleanup_result.is_ok() {
        // The explicit path removed it, so the guard need not schedule a
        // second attempt. If it failed, the guard is deliberately left armed.
        temp_db_guard.mark_cleaned();
    }

    let (control_totals, journal_balanced) = match operation_result {
        Err(original) => {
            // A cleanup failure must never mask the real error. It is safe to
            // discard here precisely because the guard above is still armed
            // whenever `cleanup_result` is `Err`.
            let _ = cleanup_result;
            return Err(original);
        }
        Ok(result) => {
            cleanup_result.map_err(map_restore_error)?;
            result
        }
    };

    Ok(OperatorRestoreVerificationResult {
        request_id,
        bundle_identifier,
        schema_version: validated.schema_version,
        postgres_major_version: validated.postgres_major_version,
        temporary_database_cleaned: true,
        journal_balanced,
        control_totals,
    })
}

async fn collect_restore_control_totals(
    connection: &mut PgConnection,
) -> Result<(RestoreControlTotals, bool), AppError> {
    async fn count(connection: &mut PgConnection, sql: &str) -> Result<i64, AppError> {
        query_scalar(sql)
            .fetch_one(&mut *connection)
            .await
            .map_err(|_| AppError::BackupValidationFailed {
                diagnostic: "RESTORE_VERIFICATION_RECONCILIATION_FAILED".to_string(),
            })
    }

    let schema_count = count(
        connection,
        "SELECT count(*)::bigint FROM information_schema.schemata WHERE schema_name NOT LIKE 'pg_%' AND schema_name <> 'information_schema'",
    )
    .await?;
    let table_count = count(
        connection,
        "SELECT count(*)::bigint FROM information_schema.tables WHERE table_schema NOT LIKE 'pg_%' AND table_schema <> 'information_schema' AND table_type = 'BASE TABLE'",
    )
    .await?;
    let user_count = count(connection, "SELECT count(*)::bigint FROM iam.users").await?;
    let product_count = count(connection, "SELECT count(*)::bigint FROM catalog.products").await?;
    let customer_count = count(
        connection,
        "SELECT count(*)::bigint FROM receivables.customers",
    )
    .await?;
    let supplier_count = count(
        connection,
        "SELECT count(*)::bigint FROM procurement.suppliers",
    )
    .await?;
    let inventory_position_count = count(
        connection,
        "SELECT count(*)::bigint FROM inventory.positions",
    )
    .await?;
    let inventory_movement_count = count(
        connection,
        "SELECT count(*)::bigint FROM inventory.movements",
    )
    .await?;
    let cash_sale_count =
        count(connection, "SELECT count(*)::bigint FROM sales.cash_sales").await?;
    let journal_count = count(
        connection,
        "SELECT count(*)::bigint FROM finance.journal_entries",
    )
    .await?;
    let opening_state_application_count = count(
        connection,
        "SELECT count(*)::bigint FROM onboarding.opening_state_applications WHERE status = 'APPLIED'",
    )
    .await?;

    let (journal_debit_total, journal_credit_total, journal_balanced): (String, String, bool) =
        sqlx::query_as(
            "SELECT COALESCE(sum(debit), 0)::text, COALESCE(sum(credit), 0)::text, COALESCE(sum(debit), 0) = COALESCE(sum(credit), 0) FROM finance.journal_lines",
        )
        .fetch_one(&mut *connection)
        .await
        .map_err(|_| AppError::BackupValidationFailed {
            diagnostic: "RESTORE_VERIFICATION_RECONCILIATION_FAILED".to_string(),
        })?;

    let customer_exposure_total: String = query_scalar(
        "SELECT COALESCE(sum(exposure_amount), 0)::text FROM receivables.customer_credit_state",
    )
    .fetch_one(&mut *connection)
    .await
    .map_err(|_| AppError::BackupValidationFailed {
        diagnostic: "RESTORE_VERIFICATION_RECONCILIATION_FAILED".to_string(),
    })?;

    let supplier_outstanding_total: String = query_scalar(
        "SELECT COALESCE(sum(outstanding_amount), 0)::text FROM procurement.supplier_liabilities",
    )
    .fetch_one(&mut *connection)
    .await
    .map_err(|_| AppError::BackupValidationFailed {
        diagnostic: "RESTORE_VERIFICATION_RECONCILIATION_FAILED".to_string(),
    })?;

    Ok((
        RestoreControlTotals {
            schema_count,
            table_count,
            user_count,
            product_count,
            customer_count,
            supplier_count,
            inventory_position_count,
            inventory_movement_count,
            cash_sale_count,
            journal_count,
            journal_debit_total,
            journal_credit_total,
            customer_exposure_total,
            supplier_outstanding_total,
            opening_state_application_count,
        },
        journal_balanced,
    ))
}

fn map_restore_error(error: restore_proof::RestoreProofError) -> AppError {
    AppError::BackupValidationFailed {
        diagnostic: error.to_string(),
    }
}

pub(crate) async fn complete_operator_backup_validation_success(
    pool: &PgPool,
    session_token: &str,
    attempt_id: i64,
    result: &OperatorBackupValidationResult,
) -> Result<(), AppError> {
    let result_json = serde_json::to_value(result).map_err(|error| {
        AppError::internal(format!(
            "failed to serialize backup validation result: {error}"
        ))
    })?;

    let _: JsonValue =
        query_scalar("SELECT operations.complete_recovery_attempt($1, $2, true, NULL, $3)")
            .bind(session_token)
            .bind(attempt_id)
            .bind(result_json)
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    Ok(())
}

pub(crate) async fn complete_operator_backup_validation_failure(
    pool: &PgPool,
    session_token: &str,
    attempt_id: i64,
    error: &AppError,
) -> Result<(), AppError> {
    let stable_code = stable_error_code(error);
    let _: JsonValue =
        query_scalar("SELECT operations.complete_recovery_attempt($1, $2, false, $3, NULL)")
            .bind(session_token)
            .bind(attempt_id)
            .bind(stable_code)
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    Ok(())
}

pub(crate) async fn complete_operator_restore_verification_success(
    pool: &PgPool,
    session_token: &str,
    attempt_id: i64,
    result: &OperatorRestoreVerificationResult,
) -> Result<(), AppError> {
    let result_json = serde_json::to_value(result).map_err(|error| {
        AppError::internal(format!(
            "failed to serialize restore verification result: {error}"
        ))
    })?;

    let _: JsonValue = query_scalar(
        "SELECT operations.complete_restore_verification_attempt($1, $2, true, NULL, $3)",
    )
    .bind(session_token)
    .bind(attempt_id)
    .bind(result_json)
    .fetch_one(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    Ok(())
}

pub(crate) async fn complete_operator_restore_verification_failure(
    pool: &PgPool,
    session_token: &str,
    attempt_id: i64,
    error: &AppError,
) -> Result<(), AppError> {
    let stable_code = stable_error_code(error);
    let _: JsonValue = query_scalar(
        "SELECT operations.complete_restore_verification_attempt($1, $2, false, $3, NULL)",
    )
    .bind(session_token)
    .bind(attempt_id)
    .bind(stable_code)
    .fetch_one(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    Ok(())
}

pub(crate) fn stable_error_code(error: &AppError) -> &'static str {
    match error {
        AppError::Internal(_) => "INTERNAL_ERROR",
        AppError::DatabaseConfiguration { .. } => "CONFIGURATION_ERROR",
        AppError::DatabaseUnavailable { .. } => "DATABASE_UNAVAILABLE",
        AppError::SessionInvalid { .. } => "SESSION_INVALID",
        AppError::PermissionDenied { .. } => "PERMISSION_DENIED",
        AppError::ValidationError { .. } => "VALIDATION_ERROR",
        AppError::PreconditionFailed { .. } => "PRECONDITION_FAILED",
        AppError::BackupCreationFailed { .. } => "BACKUP_CREATION_FAILED",
        AppError::BackupValidationFailed { .. } => "BACKUP_VALIDATION_FAILED",
        AppError::IdempotencyConflict { .. } => "IDEMPOTENCY_CONFLICT",
        AppError::ImmutableRecord { .. } => "IMMUTABLE_RECORD",
        AppError::UnsafeZeroStockValuation { .. } => "UNSAFE_ZERO_STOCK_VALUATION",
        AppError::CreditPolicyBlocked { .. } => "CREDIT_POLICY_BLOCKED",
        AppError::InsufficientStock { .. } => "INSUFFICIENT_STOCK",
        AppError::CorrectionsDisabled { .. } => "CORRECTIONS_DISABLED",
        AppError::RestoreAdminNotConfigured { .. } => "RESTORE_ADMIN_NOT_CONFIGURED",
        AppError::BackupDestinationInsideDataDirectory { .. } => {
            "BACKUP_DESTINATION_INSIDE_DATA_DIRECTORY"
        }
        AppError::BackupDestinationCreateFailed { .. } => "BACKUP_DESTINATION_CREATE_FAILED",
        AppError::BackupBundleOutsideRoot { .. } => "BACKUP_BUNDLE_OUTSIDE_ROOT",
        AppError::RecoveryOperationInProgress { .. } => "RECOVERY_OPERATION_IN_PROGRESS",
    }
}

fn is_canonical_bundle_identifier(value: &str) -> bool {
    let Some(timestamp) = value.strip_prefix(backup_proof::BUNDLE_NAME_PREFIX) else {
        return false;
    };
    let bytes = timestamp.as_bytes();
    bytes.len() == 15
        && bytes[8] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| index == 8 || byte.is_ascii_digit())
}

fn canonical_bundle_stats(bundle_root: &Path) -> Result<(u64, u64), AppError> {
    let mut file_count = 0u64;
    let mut total_bytes = 0u64;

    for file_name in [
        backup_proof::DUMP_FILENAME,
        backup_proof::MANIFEST_FILENAME,
        backup_proof::CHECKSUMS_FILENAME,
        backup_proof::SCHEMA_VERSION_FILENAME,
        backup_proof::APPLICATION_VERSION_FILENAME,
        backup_proof::POSTGRES_VERSION_FILENAME,
    ] {
        add_regular_file_stats(
            &bundle_root.join(file_name),
            &mut file_count,
            &mut total_bytes,
        )?;
    }

    for directory in [
        backup_proof::ATTACHMENTS_DIR,
        backup_proof::GENERATED_DOCUMENTS_DIR,
        backup_proof::COMPANY_ASSETS_DIR,
    ] {
        let directory_path = bundle_root.join(directory);
        for entry in fs::read_dir(directory_path).map_err(|_| AppError::BackupValidationFailed {
            diagnostic: "BACKUP_PROOF_BUNDLE_LAYOUT_INVALID".to_string(),
        })? {
            let path = entry
                .map_err(|_| AppError::BackupValidationFailed {
                    diagnostic: "BACKUP_PROOF_IO".to_string(),
                })?
                .path();
            add_regular_file_stats(&path, &mut file_count, &mut total_bytes)?;
        }
    }

    Ok((file_count, total_bytes))
}

fn add_regular_file_stats(
    path: &Path,
    file_count: &mut u64,
    total_bytes: &mut u64,
) -> Result<(), AppError> {
    let metadata = fs::symlink_metadata(path).map_err(|_| AppError::BackupValidationFailed {
        diagnostic: "BACKUP_PROOF_BUNDLE_LAYOUT_INVALID".to_string(),
    })?;
    if is_symlink_or_reparse(&metadata) || !metadata.is_file() {
        return Err(AppError::BackupValidationFailed {
            diagnostic: "BACKUP_PROOF_REJECTED_SYMLINK_INPUT".to_string(),
        });
    }
    *file_count = file_count.saturating_add(1);
    *total_bytes = total_bytes.saturating_add(metadata.len());
    Ok(())
}

#[cfg(windows)]
fn is_symlink_or_reparse(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    metadata.file_type().is_symlink()
        || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
fn is_symlink_or_reparse(metadata: &fs::Metadata) -> bool {
    metadata.file_type().is_symlink()
}

// ---------------------------------------------------------------------------
// WS-H-1 (G3): configurable backup destination setting.
// ---------------------------------------------------------------------------

pub(crate) async fn get_backup_destination(
    pool: &PgPool,
    session_token: &str,
) -> Result<crate::domain::recovery::BackupDestinationSetting, AppError> {
    let value: JsonValue = query_scalar("SELECT operations.get_backup_destination_setting($1)")
        .bind(session_token)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;
    let path = value
        .get("path")
        .and_then(JsonValue::as_str)
        .map(str::to_string);
    Ok(crate::domain::recovery::BackupDestinationSetting { path })
}

pub(crate) async fn update_backup_destination(
    pool: &PgPool,
    session_token: &str,
    path: &str,
) -> Result<crate::domain::recovery::UpdateBackupDestinationResult, AppError> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(AppError::ValidationError {
            diagnostic: "backup destination path is empty".to_string(),
        });
    }

    let data_dir = fetch_pg_data_directory().await?;
    let candidate_path = Path::new(trimmed);
    let canonical_candidate = canonicalize_best_effort(candidate_path);
    let canonical_data_dir = data_dir.canonicalize().unwrap_or(data_dir);
    if canonical_candidate == canonical_data_dir
        || canonical_candidate.starts_with(&canonical_data_dir)
    {
        return Err(AppError::BackupDestinationInsideDataDirectory {
            diagnostic: "BACKUP_DESTINATION_INSIDE_DATA_DIRECTORY".to_string(),
        });
    }
    let same_drive_warning = match (
        drive_letter(&canonical_candidate),
        drive_letter(&canonical_data_dir),
    ) {
        (Some(candidate_drive), Some(data_drive)) => candidate_drive == data_drive,
        _ => false,
    };

    let value: JsonValue =
        query_scalar("SELECT operations.update_backup_destination_setting($1, $2)")
            .bind(session_token)
            .bind(trimmed)
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;
    let saved_path = value
        .get("path")
        .and_then(JsonValue::as_str)
        .map(str::to_string);

    Ok(crate::domain::recovery::UpdateBackupDestinationResult {
        path: saved_path,
        same_drive_warning,
    })
}

/// Opens a short-lived connection through the same restore-admin
/// configuration G2 already requires (a real PostgreSQL superuser, never one
/// of the four Stockiha app roles), reads `data_directory`, and closes the
/// connection. Read-only: `SHOW`/`current_setting` only, never a write.
async fn fetch_pg_data_directory() -> Result<PathBuf, AppError> {
    let raw_admin_url =
        std::env::var(RESTORE_ADMIN_URL_ENV).map_err(|_| AppError::RestoreAdminNotConfigured {
            diagnostic: format!("{RESTORE_ADMIN_URL_ENV} is not configured"),
        })?;
    let parsed = restore_proof::parse_admin_url(&raw_admin_url).map_err(map_restore_error)?;
    let options = restore_proof::admin_connect_options(&parsed);
    let mut conn = PgConnection::connect_with(&options)
        .await
        .map_err(|_| AppError::database_unavailable("restore-admin connection failed"))?;
    let data_directory: String = query_scalar("SELECT current_setting('data_directory')")
        .fetch_one(&mut conn)
        .await
        .map_err(|_| AppError::BackupDestinationCreateFailed {
            diagnostic: "DATA_DIRECTORY_QUERY_FAILED".to_string(),
        })?;
    let _ = conn.close().await;
    Ok(PathBuf::from(data_directory))
}

/// Canonicalize `path`, falling back to canonicalizing the nearest existing
/// ancestor when `path` itself does not exist yet (a not-yet-created backup
/// destination candidate). Never fails: an unresolvable path is returned
/// as-is, which simply makes the containment/same-drive comparisons using it
/// a syntactic (not symlink-resistant) best effort.
fn canonicalize_best_effort(path: &Path) -> PathBuf {
    if let Ok(canonical) = path.canonicalize() {
        return canonical;
    }
    let mut trailing: Vec<std::ffi::OsString> = Vec::new();
    let mut ancestor = path.to_path_buf();
    loop {
        let Some(file_name) = ancestor.file_name() else {
            break;
        };
        trailing.push(file_name.to_os_string());
        if !ancestor.pop() {
            break;
        }
        if let Ok(canonical_ancestor) = ancestor.canonicalize() {
            let mut resolved = canonical_ancestor;
            for component in trailing.into_iter().rev() {
                resolved.push(component);
            }
            return resolved;
        }
    }
    path.to_path_buf()
}

#[cfg(windows)]
fn drive_letter(path: &Path) -> Option<char> {
    use std::path::{Component, Prefix};
    match path.components().next() {
        Some(Component::Prefix(prefix)) => match prefix.kind() {
            Prefix::Disk(letter) | Prefix::VerbatimDisk(letter) => {
                Some((letter as char).to_ascii_uppercase())
            }
            _ => None,
        },
        _ => None,
    }
}

#[cfg(not(windows))]
fn drive_letter(_path: &Path) -> Option<char> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn accepts_only_canonical_stockiha_bundle_identifiers() {
        assert!(is_canonical_bundle_identifier(
            "GestStock-Backup-20260803-195700"
        ));
        assert!(!is_canonical_bundle_identifier("backup-20260803"));
        assert!(!is_canonical_bundle_identifier(
            "GestStock-Backup-2026-08-03"
        ));
        assert!(!is_canonical_bundle_identifier(
            "GestStock-Backup-20260803_195700"
        ));
    }

    #[test]
    fn new_ws_h_2_error_codes_are_stable_and_payload_free() {
        // Both codes exist so the operator is told what actually went wrong.
        // If either ever collapses back into PERMISSION_DENIED the misleading
        // message this task removed is back.
        let outside = AppError::BackupBundleOutsideRoot {
            diagnostic: "DO_NOT_EXPOSE".to_string(),
        };
        assert_eq!(stable_error_code(&outside), "BACKUP_BUNDLE_OUTSIDE_ROOT");
        assert!(!format!("{outside:?}").contains("DO_NOT_EXPOSE"));

        let busy = AppError::RecoveryOperationInProgress {
            diagnostic: "DO_NOT_EXPOSE".to_string(),
        };
        assert_eq!(stable_error_code(&busy), "RECOVERY_OPERATION_IN_PROGRESS");
        assert!(!format!("{busy:?}").contains("DO_NOT_EXPOSE"));
    }

    #[test]
    fn error_code_mapping_is_stable_and_payload_free() {
        let error = AppError::BackupValidationFailed {
            diagnostic: "DO_NOT_EXPOSE".to_string(),
        };
        assert_eq!(stable_error_code(&error), "BACKUP_VALIDATION_FAILED");
        assert!(!stable_error_code(&error).contains("DO_NOT_EXPOSE"));
    }

    #[test]
    fn validation_result_json_uses_only_safe_metadata() {
        let result = OperatorBackupValidationResult {
            request_id: "validate-20260803-001".to_string(),
            bundle_identifier: "GestStock-Backup-20260803-195700".to_string(),
            created_at_label: "20260803-195700".to_string(),
            application_version: "0.1.0".to_string(),
            schema_version: "20260803201500".to_string(),
            postgres_major_version: 18,
            integrity_valid: true,
            application_compatible: true,
            schema_compatible: true,
            postgres_compatible: true,
            file_count: 7,
            total_bytes: 2048,
        };
        let value = serde_json::to_value(&result).unwrap();
        assert_eq!(value["bundleIdentifier"], json!(result.bundle_identifier));
        assert!(value.get("bundlePath").is_none());
        assert!(value.get("databaseUrl").is_none());
        assert!(value.get("credential").is_none());
    }

    #[test]
    fn restore_result_json_hides_the_temporary_target() {
        let result = OperatorRestoreVerificationResult {
            request_id: "restore-20260805-001".to_string(),
            bundle_identifier: "GestStock-Backup-20260805-150500".to_string(),
            schema_version: "20260805150500".to_string(),
            postgres_major_version: 18,
            temporary_database_cleaned: true,
            journal_balanced: true,
            control_totals: RestoreControlTotals {
                schema_count: 12,
                table_count: 42,
                user_count: 1,
                product_count: 0,
                customer_count: 0,
                supplier_count: 0,
                inventory_position_count: 0,
                inventory_movement_count: 0,
                cash_sale_count: 0,
                journal_count: 0,
                journal_debit_total: "0".to_string(),
                journal_credit_total: "0".to_string(),
                customer_exposure_total: "0".to_string(),
                supplier_outstanding_total: "0".to_string(),
                opening_state_application_count: 0,
            },
        };
        let value = serde_json::to_value(result).unwrap();
        assert_eq!(value["temporaryDatabaseCleaned"], true);
        assert!(value.get("temporaryDatabaseName").is_none());
        assert!(value.get("databaseUrl").is_none());
        assert!(value.get("credential").is_none());
    }

    // ---- WS-H-1 (G3) live proof: acceptance criterion 9 ---------------------
    //
    // `update_backup_destination` performs the PostgreSQL-data-directory
    // containment check via `fetch_pg_data_directory` and returns
    // `Err(AppError::BackupDestinationInsideDataDirectory)` *before* it ever
    // uses `pool` or `session_token` to call the database function — so this
    // test can prove the real rejection against a real live PostgreSQL data
    // directory without needing a real authenticated session. Requires
    // `STOCKIHA_RESTORE_ADMIN_DATABASE_URL` and `STOCKIHA_DEV_DATABASE_URL`
    // (any reachable pool satisfies the unused-until-later `pool` parameter).
    #[tokio::test]
    #[ignore = "requires a live PostgreSQL 18 server, STOCKIHA_RESTORE_ADMIN_DATABASE_URL, and STOCKIHA_DEV_DATABASE_URL"]
    async fn update_backup_destination_rejects_the_real_pg_data_directory() {
        let dev_url = std::env::var("STOCKIHA_DEV_DATABASE_URL")
            .expect("STOCKIHA_DEV_DATABASE_URL must be set to run this live proof");
        let pool = PgPool::connect(&dev_url)
            .await
            .expect("STOCKIHA_DEV_DATABASE_URL must be reachable");

        let data_dir = fetch_pg_data_directory()
            .await
            .expect("STOCKIHA_RESTORE_ADMIN_DATABASE_URL must be reachable");
        let data_dir_str = data_dir.to_string_lossy().into_owned();

        let result =
            update_backup_destination(&pool, "unused-because-rejected-first", &data_dir_str).await;
        assert!(
            matches!(
                result,
                Err(AppError::BackupDestinationInsideDataDirectory { .. })
            ),
            "expected BackupDestinationInsideDataDirectory, got: {result:?}"
        );
    }
}
