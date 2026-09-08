//! WS-K-1 — Read-only schema-version comparison.
//!
//! Compares the newest migration *embedded in this binary* against the newest
//! migration *actually applied* to the connected database. [`MIGRATOR`] is
//! used for its own metadata (the list of migrations compiled in via
//! `sqlx::migrate!()`) here — [`check_schema_compatibility`] never calls
//! `.run()`, matching K1-4's ruling that automatic migration-on-every-startup
//! is not implemented.
//!
//! WS-K-3 adds the one, narrow exception: [`run_all_migrations`], reachable
//! only via the installer's own `--provision-migrate` CLI entry point
//! (`infrastructure::provision_cli`), a one-time first-install action, never
//! a normal app-launch behavior. It reuses this exact same `MIGRATOR`
//! instance rather than a second, separately-versioned copy — the migrator
//! that provisions a client's database is therefore byte-identical to the
//! one already compiled into the app it is provisioning for.
//!
//! `_sqlx_migrations` is SQLx's own bookkeeping table — the same one
//! `scripts/run-sqlx-migrations.ps1` and every `sqlx migrate run` invocation
//! already write to. Reading it introduces no new schema and no new
//! ownership/grant surface (`stockiha_runtime` is granted read-only `SELECT`
//! on it by
//! `migrations/20260910090000_ws_k_001_grant_sqlx_migrations_select_runtime.sql`).
//!
//! WS-K-1.2 hotfix — **this check must fail open.** A first production run
//! surfaced exactly the failure mode this note now exists to prevent: the
//! runtime role had never been granted `SELECT` on `_sqlx_migrations`
//! (fixed by the grant migration above), and the query failure that
//! produced was — before this hotfix — reported as an internal error that
//! blocked startup on a database that was otherwise completely healthy and
//! connected. The advisory-check philosophy already applied to
//! `local_config`'s Windows ACL check applies identically here: an inability
//! to *determine* the schema version is not evidence that the version is
//! wrong, and must never be treated as one of the two conditions
//! ([`SchemaCompatibility::OlderThanBinary`] /
//! [`SchemaCompatibility::NewerThanBinary`]) that are allowed to change
//! startup behavior. [`check_schema_compatibility`] is therefore infallible:
//! every query failure except one (see [`latest_applied_version`]'s own doc
//! comment for the one deliberate exception) resolves to
//! [`SchemaCompatibility::Unknown`], logged once at `WARN`, never surfaced
//! as a blocking state.

use serde::Serialize;
use sqlx::{migrate::Migrator, PgConnection, Row};

/// The migrations compiled into this binary at build time.
static MIGRATOR: Migrator = sqlx::migrate!("./migrations");

/// Run every pending migration against `conn`, using the exact same
/// embedded [`MIGRATOR`] [`check_schema_compatibility`] reads metadata from.
///
/// WS-K-3: the only caller is `infrastructure::provision_cli::run`, itself
/// reachable only via the installer-only `--provision-migrate` CLI flag —
/// never part of normal app startup. Delegates entirely to SQLx's own
/// `Migrator::run`, which already provides per-file transactions,
/// checksum verification of already-applied migrations, and
/// `_sqlx_migrations` bookkeeping; this function adds no logic of its own
/// beyond exposing that call to the one legitimate caller.
pub async fn run_all_migrations(
    conn: &mut PgConnection,
) -> Result<(), sqlx::migrate::MigrateError> {
    MIGRATOR.run(conn).await
}

/// Outcome of comparing embedded vs. applied migration versions.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SchemaCompatibility {
    /// The database has applied every migration this binary expects (and no
    /// more that this binary doesn't know about).
    UpToDate,
    /// The database is behind: migrations exist in this binary that have not
    /// been applied yet. Safe to keep running against already-applied
    /// functionality; features touching the missing migrations may fail.
    OlderThanBinary { applied: i64, latest: i64 },
    /// The database is ahead: it has applied a migration this binary does
    /// not know about. This means an older build is running against a newer
    /// database — refuse to proceed rather than operate on schema it cannot
    /// understand.
    NewerThanBinary { applied: i64, latest: i64 },
    /// The version could not be determined — a permission error, an
    /// unexpected query failure, a timeout, or any other reason. Deliberately
    /// *not* a claim about the schema either way: callers treat this
    /// identically to [`Self::UpToDate`] (proceed), never as a block. See
    /// the module-level fail-open note.
    Unknown,
}

/// Pure comparison, unit-testable without any database connection.
fn compare(embedded_latest: i64, applied_latest: Option<i64>) -> SchemaCompatibility {
    let applied = applied_latest.unwrap_or(0);
    if applied == embedded_latest {
        SchemaCompatibility::UpToDate
    } else if applied < embedded_latest {
        SchemaCompatibility::OlderThanBinary {
            applied,
            latest: embedded_latest,
        }
    } else {
        SchemaCompatibility::NewerThanBinary {
            applied,
            latest: embedded_latest,
        }
    }
}

/// The newest migration version compiled into this binary.
///
/// `MIGRATOR.migrations` is sorted ascending by version at compile time
/// (SQLx's own contract for `sqlx::migrate!()`), so the last entry is the
/// newest. Panics only if the binary were built with zero migrations, which
/// cannot happen against this repository's `migrations/` directory.
fn embedded_latest_version() -> i64 {
    MIGRATOR
        .migrations
        .last()
        .expect("at least one migration is embedded")
        .version
}

/// Outcome of the raw `_sqlx_migrations` read, before comparison.
enum AppliedVersionQuery {
    /// The query succeeded; `_sqlx_migrations` may still have zero rows.
    Applied(Option<i64>),
    /// The table does not exist yet (SQLSTATE `42P01`, undefined_table) —
    /// see [`latest_applied_version`]'s doc comment. Deliberately distinct
    /// from [`Self::Unreadable`]: this is real, positive evidence ("nothing
    /// has ever been applied"), not an inability to find out.
    NeverMigrated,
    /// The query failed for any other reason (permission denied, connection
    /// drop, timeout, an unexpected row shape, ...). The one and only
    /// producer of [`SchemaCompatibility::Unknown`].
    Unreadable(sqlx::Error),
}

/// Query the newest *successfully applied* migration version.
///
/// `success = true` matters: a row with `success = false` records a migration
/// that started and failed, which must never be counted as applied — doing so
/// would report a database as compatible when it is actually left mid-way
/// through a broken migration.
///
/// `_sqlx_migrations` itself not existing (SQLSTATE `42P01`, undefined_table)
/// is treated as "zero migrations applied" rather than an unreadable result:
/// a reachable PostgreSQL database with no migration history at all is
/// exactly the K1-3 "connected, but the database or schema is missing" case
/// — real, positive information, not an inability to determine an answer —
/// and it is reported through the same [`SchemaCompatibility::OlderThanBinary`]
/// path (with `applied: 0`) rather than folded into
/// [`SchemaCompatibility::Unknown`]. Every *other* query failure (most
/// notably `permission denied`, WS-K-1.2's own trigger — see the module-level
/// note) genuinely cannot distinguish "up to date" from "badly out of date",
/// and becomes [`AppliedVersionQuery::Unreadable`].
async fn latest_applied_version(conn: &mut PgConnection) -> AppliedVersionQuery {
    let result =
        sqlx::query("SELECT MAX(version) AS version FROM _sqlx_migrations WHERE success = true")
            .fetch_one(conn)
            .await;

    match result {
        Ok(row) => match row.try_get::<Option<i64>, _>("version") {
            Ok(version) => AppliedVersionQuery::Applied(version),
            Err(err) => AppliedVersionQuery::Unreadable(err),
        },
        Err(sqlx::Error::Database(ref db_err)) if db_err.code().as_deref() == Some("42P01") => {
            AppliedVersionQuery::NeverMigrated
        }
        Err(other) => AppliedVersionQuery::Unreadable(other),
    }
}

/// Full schema-compatibility check against a live connection.
///
/// Read-only: one `SELECT MAX(...)` against SQLx's own bookkeeping table.
/// Never writes, never runs a migration. **Infallible by design** (WS-K-1.2
/// hotfix): any query failure other than the deliberate
/// "table does not exist yet" case resolves to
/// [`SchemaCompatibility::Unknown`] rather than propagating an error that
/// could block startup — see the module-level note. Logged once at `WARN`
/// with the redacted SQLx error class so an unexpected failure is still
/// diagnosable without ever surfacing as a blocking UI state.
pub async fn check_schema_compatibility(conn: &mut PgConnection) -> SchemaCompatibility {
    resolve(latest_applied_version(conn).await)
}

/// Pure dispatch from a raw query outcome to a verdict — separated from
/// [`check_schema_compatibility`] purely so it is unit-testable against
/// synthetic [`sqlx::Error`] values without a live connection.
fn resolve(query: AppliedVersionQuery) -> SchemaCompatibility {
    match query {
        AppliedVersionQuery::Applied(version) => compare(embedded_latest_version(), version),
        AppliedVersionQuery::NeverMigrated => compare(embedded_latest_version(), None),
        AppliedVersionQuery::Unreadable(err) => {
            // The error's `Display` may include a database-server-provided
            // message (e.g. "permission denied for table _sqlx_migrations")
            // but never a credential, URL, or connection string — SQLx
            // itself never places those in a query-execution error. Logged
            // once here, at the single point this condition is detected;
            // callers must not log it again on every read of the cached
            // result.
            tracing::warn!(
                error = %err,
                "schema version could not be determined; proceeding without a version verdict"
            );
            SchemaCompatibility::Unknown
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn equal_versions_are_up_to_date() {
        assert_eq!(compare(42, Some(42)), SchemaCompatibility::UpToDate);
    }

    #[test]
    fn applied_behind_binary_is_older_than_binary() {
        assert_eq!(
            compare(42, Some(10)),
            SchemaCompatibility::OlderThanBinary {
                applied: 10,
                latest: 42
            }
        );
    }

    #[test]
    fn no_applied_rows_is_older_than_binary_from_zero() {
        assert_eq!(
            compare(42, None),
            SchemaCompatibility::OlderThanBinary {
                applied: 0,
                latest: 42
            }
        );
    }

    #[test]
    fn applied_ahead_of_binary_is_newer_than_binary() {
        assert_eq!(
            compare(42, Some(99)),
            SchemaCompatibility::NewerThanBinary {
                applied: 99,
                latest: 42
            }
        );
    }

    // ——— WS-K-1.2 hotfix: fail-open dispatch ———

    #[test]
    fn applied_query_success_compares_normally() {
        assert_eq!(
            resolve(AppliedVersionQuery::Applied(
                Some(embedded_latest_version())
            )),
            SchemaCompatibility::UpToDate
        );
    }

    #[test]
    fn never_migrated_is_older_than_binary_from_zero_not_unknown() {
        // "The table doesn't exist" is real, positive information (K1-3's
        // "database is empty" state) — it must never collapse into Unknown
        // alongside genuine failures.
        assert_eq!(
            resolve(AppliedVersionQuery::NeverMigrated),
            SchemaCompatibility::OlderThanBinary {
                applied: 0,
                latest: embedded_latest_version()
            }
        );
    }

    /// Represents "query timeout": `PoolTimedOut` is a real, easily
    /// constructed `sqlx::Error` variant that carries no database-error
    /// detail, matching what a genuine timeout looks like from this layer's
    /// perspective.
    #[test]
    fn unreadable_timeout_resolves_to_unknown_not_a_block() {
        assert_eq!(
            resolve(AppliedVersionQuery::Unreadable(sqlx::Error::PoolTimedOut)),
            SchemaCompatibility::Unknown
        );
    }

    /// Represents "malformed result": the query succeeded but the expected
    /// column could not be read as expected.
    #[test]
    fn unreadable_malformed_result_resolves_to_unknown_not_a_block() {
        assert_eq!(
            resolve(AppliedVersionQuery::Unreadable(
                sqlx::Error::ColumnNotFound("version".to_owned())
            )),
            SchemaCompatibility::Unknown
        );
    }

    /// The regression this hotfix exists to prevent: a `permission denied`
    /// failure (the WS-K-1.2 trigger — `stockiha_runtime` lacked `SELECT` on
    /// `_sqlx_migrations`) must resolve to `Unknown`, never to a blocking
    /// state, regardless of which specific `sqlx::Error` shape carries it.
    /// `RowNotFound` stands in for "some other unreadable-shaped failure";
    /// the dispatch in `resolve` treats every non-`NeverMigrated` error
    /// identically, so this and the two tests above jointly prove the
    /// uniform fail-open path a real `permission denied` `Database` error
    /// would also take.
    #[test]
    fn unreadable_error_never_produces_a_blocking_verdict() {
        for err in [sqlx::Error::PoolTimedOut, sqlx::Error::RowNotFound] {
            let verdict = resolve(AppliedVersionQuery::Unreadable(err));
            assert_eq!(verdict, SchemaCompatibility::Unknown);
            assert!(!matches!(
                verdict,
                SchemaCompatibility::OlderThanBinary { .. }
                    | SchemaCompatibility::NewerThanBinary { .. }
            ));
        }
    }

    #[test]
    fn unknown_serializes_to_tagged_screaming_snake_case() {
        let json = serde_json::to_string(&SchemaCompatibility::Unknown).unwrap();
        assert_eq!(json, r#"{"status":"UNKNOWN"}"#);
    }

    #[test]
    fn serializes_to_tagged_screaming_snake_case() {
        let json = serde_json::to_string(&SchemaCompatibility::UpToDate).unwrap();
        assert_eq!(json, r#"{"status":"UP_TO_DATE"}"#);

        let json = serde_json::to_string(&SchemaCompatibility::OlderThanBinary {
            applied: 1,
            latest: 2,
        })
        .unwrap();
        assert_eq!(
            json,
            r#"{"status":"OLDER_THAN_BINARY","applied":1,"latest":2}"#
        );

        let json = serde_json::to_string(&SchemaCompatibility::NewerThanBinary {
            applied: 3,
            latest: 2,
        })
        .unwrap();
        assert_eq!(
            json,
            r#"{"status":"NEWER_THAN_BINARY","applied":3,"latest":2}"#
        );
    }

    /// The real repository must have at least one migration embedded, and its
    /// versions must be sorted ascending (SQLx's own contract) — proves
    /// [`embedded_latest_version`] actually reads the real migration set
    /// rather than an empty/stub one.
    #[test]
    fn embedded_migrator_has_at_least_one_migration() {
        assert!(!MIGRATOR.migrations.is_empty());
        let versions: Vec<i64> = MIGRATOR.migrations.iter().map(|m| m.version).collect();
        let mut sorted = versions.clone();
        sorted.sort_unstable();
        assert_eq!(
            versions, sorted,
            "migrations must be embedded in ascending version order"
        );
    }
}
