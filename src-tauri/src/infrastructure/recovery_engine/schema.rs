//! Schema verdict of a backup against this binary (plan §5.4, ruling R4).
//!
//! The authoritative schema version of a running database is
//! `max(version)` of the successful rows in `public._sqlx_migrations`,
//! read through the migrator connection — **not** `operations.schema_state`,
//! which fourteen migrations forgot to bump and which every legacy backup
//! therefore mis-stamped. Compatibility is judged against the migration
//! list compiled into this binary.

use serde::Serialize;
use sqlx::{PgConnection, Row};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum SchemaVerdict {
    /// Equal to `embedded_latest_version()`.
    Same,
    /// Lower and present in the embedded list — restorable; the restore
    /// brings it forward with the normal migrator.
    Older,
    /// Higher than anything this binary knows — never restorable (would hit
    /// the WS-K-1 hard-stop screen).
    Newer,
    /// Unparsable, or lower but not a version this binary ever shipped.
    Unknown,
}

impl SchemaVerdict {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            SchemaVerdict::Same => "SAME",
            SchemaVerdict::Older => "OLDER",
            SchemaVerdict::Newer => "NEWER",
            SchemaVerdict::Unknown => "UNKNOWN",
        }
    }

    /// `SAME` or `OLDER` — the only two verdicts a restore may proceed on.
    pub(crate) fn is_restorable(self) -> bool {
        matches!(self, SchemaVerdict::Same | SchemaVerdict::Older)
    }
}

/// Pure classification. `embedded_versions` must be ascending (SQLx's own
/// contract for the compiled migrator); an empty list yields `Unknown`.
pub(crate) fn classify(bundle_version: &str, embedded_versions: &[i64]) -> SchemaVerdict {
    let Ok(version) = bundle_version.trim().parse::<i64>() else {
        return SchemaVerdict::Unknown;
    };
    let Some(latest) = embedded_versions.last().copied() else {
        return SchemaVerdict::Unknown;
    };
    if version == latest {
        SchemaVerdict::Same
    } else if version > latest {
        SchemaVerdict::Newer
    } else if embedded_versions.binary_search(&version).is_ok() {
        SchemaVerdict::Older
    } else {
        SchemaVerdict::Unknown
    }
}

/// `SELECT max(version) FROM public._sqlx_migrations WHERE success`.
/// A database with no applied migration at all is an error, not `0`: a
/// backup must never be stamped with a version that does not exist.
pub(crate) async fn applied_version(conn: &mut PgConnection) -> Result<i64, String> {
    let version: Option<i64> =
        sqlx::query_scalar("SELECT max(version) FROM public._sqlx_migrations WHERE success")
            .fetch_one(conn)
            .await
            .map_err(|e| format!("could not read the applied schema version ({e})"))?;
    version.ok_or_else(|| "no applied migrations".to_string())
}

/// Every successfully applied `(version, checksum)` pair, ascending. Used by
/// the isolated restore test (WS-H-4) to prove a restored history is
/// byte-identical to what this binary would have applied.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) async fn applied_history(
    conn: &mut PgConnection,
) -> Result<Vec<(i64, Vec<u8>)>, String> {
    let rows = sqlx::query(
        "SELECT version, checksum FROM public._sqlx_migrations WHERE success ORDER BY version",
    )
    .fetch_all(conn)
    .await
    .map_err(|e| format!("could not read the applied migration history ({e})"))?;
    rows.iter()
        .map(|row| {
            let version: i64 = row
                .try_get("version")
                .map_err(|e| format!("malformed migration history row ({e})"))?;
            let checksum: Vec<u8> = row
                .try_get("checksum")
                .map_err(|e| format!("malformed migration history row ({e})"))?;
            Ok((version, checksum))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const EMBEDDED: &[i64] = &[20260722125408, 20260803193000, 20260916100000];

    #[test]
    fn equal_to_latest_is_same() {
        assert_eq!(classify("20260916100000", EMBEDDED), SchemaVerdict::Same);
        assert_eq!(classify(" 20260916100000\n", EMBEDDED), SchemaVerdict::Same);
    }

    #[test]
    fn lower_and_known_is_older() {
        assert_eq!(classify("20260803193000", EMBEDDED), SchemaVerdict::Older);
    }

    #[test]
    fn higher_is_newer() {
        assert_eq!(classify("20270101000000", EMBEDDED), SchemaVerdict::Newer);
    }

    #[test]
    fn unknown_cases_never_panic() {
        assert_eq!(classify("0", EMBEDDED), SchemaVerdict::Unknown);
        assert_eq!(classify("", EMBEDDED), SchemaVerdict::Unknown);
        assert_eq!(classify("not-a-number", EMBEDDED), SchemaVerdict::Unknown);
        assert_eq!(classify("20260801000000", EMBEDDED), SchemaVerdict::Unknown);
        assert_eq!(classify("20260916100000", &[]), SchemaVerdict::Unknown);
    }

    #[test]
    fn verdict_serializes_screaming_snake_case() {
        assert_eq!(
            serde_json::to_string(&SchemaVerdict::Older).unwrap(),
            r#""OLDER""#
        );
        assert!(SchemaVerdict::Older.is_restorable());
        assert!(!SchemaVerdict::Newer.is_restorable());
        assert_eq!(SchemaVerdict::Unknown.as_str(), "UNKNOWN");
    }
}
