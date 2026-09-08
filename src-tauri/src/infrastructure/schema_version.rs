//! WS-K-1 — Read-only schema-version comparison.
//!
//! Compares the newest migration *embedded in this binary* against the newest
//! migration *actually applied* to the connected database. Never runs a
//! migration: [`MIGRATOR`] is used only for its own metadata (the list of
//! migrations compiled in via `sqlx::migrate!()`), never for `.run()`. That
//! keeps this module strictly read-only, matching K1-4's ruling that WS-K-1
//! does not implement automatic migration.
//!
//! `_sqlx_migrations` is SQLx's own bookkeeping table — the same one
//! `scripts/run-sqlx-migrations.ps1` and every `sqlx migrate run` invocation
//! already write to. Reading it introduces no new schema and no new
//! ownership/grant surface.

use serde::Serialize;
use sqlx::{migrate::Migrator, PgConnection, Row};

use crate::error::AppError;

/// The migrations compiled into this binary at build time. Read-only use
/// only: this module never calls [`Migrator::run`].
static MIGRATOR: Migrator = sqlx::migrate!("./migrations");

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

/// Query the newest *successfully applied* migration version.
///
/// `success = true` matters: a row with `success = false` records a migration
/// that started and failed, which must never be counted as applied — doing so
/// would report a database as compatible when it is actually left mid-way
/// through a broken migration.
///
/// `_sqlx_migrations` itself not existing (SQLSTATE `42P01`, undefined_table)
/// is treated as "zero migrations applied" rather than a query failure: a
/// reachable PostgreSQL database with no migration history at all is exactly
/// the K1-3 "connected, but the database or schema is missing" case, and it
/// is reported through the same [`SchemaCompatibility::OlderThanBinary`]
/// path (with `applied: 0`) rather than a separate mechanism — the caller
/// distinguishes "never set up" from "behind" by checking `applied == 0`.
async fn latest_applied_version(conn: &mut PgConnection) -> Result<Option<i64>, sqlx::Error> {
    let result =
        sqlx::query("SELECT MAX(version) AS version FROM _sqlx_migrations WHERE success = true")
            .fetch_one(conn)
            .await;

    match result {
        Ok(row) => Ok(row.try_get::<Option<i64>, _>("version")?),
        Err(sqlx::Error::Database(ref db_err)) if db_err.code().as_deref() == Some("42P01") => {
            Ok(None)
        }
        Err(other) => Err(other),
    }
}

/// Full schema-compatibility check against a live connection.
///
/// Read-only: one `SELECT MAX(...)` against SQLx's own bookkeeping table.
/// Never writes, never runs a migration. A query failure for any reason
/// *other* than the bookkeeping table simply not existing yet (see
/// [`latest_applied_version`]) is reported as a
/// [`AppError::database_unavailable`] diagnostic — deliberately not
/// panicking and not silently treated as "up to date".
pub async fn check_schema_compatibility(
    conn: &mut PgConnection,
) -> Result<SchemaCompatibility, AppError> {
    let applied = latest_applied_version(conn).await.map_err(|_sqlx_error| {
        AppError::database_unavailable(
            "could not read the applied migration history (_sqlx_migrations)",
        )
    })?;
    Ok(compare(embedded_latest_version(), applied))
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
