//! S0-004 — Database role definitions and fixed DDL statements.
//!
//! Role posture requirements:
//! - `stockiha_owner`: NOLOGIN, NOINHERIT, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS
//! - `stockiha_migrator`: LOGIN, NOINHERIT, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS
//! - `stockiha_runtime`: LOGIN, NOINHERIT, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS
//! - `stockiha_backup`: LOGIN, NOINHERIT, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS
//!
//! Membership requirements:
//! - `stockiha_migrator` -> `stockiha_owner` (WITH ADMIN FALSE, INHERIT FALSE, SET TRUE)
//! - `stockiha_runtime` and `stockiha_backup` have NO memberships in `stockiha_owner` or any other role.

pub(crate) const ROLE_OWNER: &str = "stockiha_owner";
pub(crate) const ROLE_MIGRATOR: &str = "stockiha_migrator";
pub(crate) const ROLE_RUNTIME: &str = "stockiha_runtime";
pub(crate) const ROLE_BACKUP: &str = "stockiha_backup";

/// Fixed 64-bit advisory lock key to prevent concurrent role bootstrap collisions.
/// Remove this temporary allowance when a genuine production consumer reads or constructs this item.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) const BOOTSTRAP_ADVISORY_LOCK_ID: i64 = 0x53544f434b494841;

/// Fixed, literal DDL statements for idempotent role creation.
/// Remove this temporary allowance when a genuine production consumer reads or constructs this item.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) const SQL_CREATE_ROLES_IF_NOT_EXISTS: &str = r#"
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stockiha_owner') THEN
        CREATE ROLE stockiha_owner;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stockiha_migrator') THEN
        CREATE ROLE stockiha_migrator;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stockiha_runtime') THEN
        CREATE ROLE stockiha_runtime;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stockiha_backup') THEN
        CREATE ROLE stockiha_backup;
    END IF;
END $$;
"#;

/// Fixed DDL for strict role attribute enforcement.
/// Remove this temporary allowance when a genuine production consumer reads or constructs this item.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) const SQL_ENFORCE_ROLE_ATTRIBUTES: &str = r#"
ALTER ROLE stockiha_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE stockiha_migrator LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE stockiha_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE stockiha_backup LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
"#;

/// Fixed DDL for strict role membership enforcement.
/// Remove this temporary allowance when a genuine production consumer reads or constructs this item.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) const SQL_ENFORCE_MEMBERSHIPS: &str = r#"
GRANT stockiha_owner TO stockiha_migrator WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn role_name_constants_are_stable_and_exact() {
        assert_eq!(ROLE_OWNER, "stockiha_owner");
        assert_eq!(ROLE_MIGRATOR, "stockiha_migrator");
        assert_eq!(ROLE_RUNTIME, "stockiha_runtime");
        assert_eq!(ROLE_BACKUP, "stockiha_backup");
    }

    #[test]
    fn ddl_statements_contain_no_dynamic_placeholders() {
        assert!(!SQL_CREATE_ROLES_IF_NOT_EXISTS.contains("%"));
        assert!(!SQL_ENFORCE_ROLE_ATTRIBUTES.contains("%"));
        assert!(!SQL_ENFORCE_MEMBERSHIPS.contains("%"));
    }
}
