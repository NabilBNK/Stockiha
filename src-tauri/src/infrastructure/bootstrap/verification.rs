//! S0-004 — Catalog verification for PostgreSQL system roles and memberships.
//!
//! Inspects `pg_roles` and `pg_auth_members` directly to assert role attributes
//! and membership graphs.

use super::roles::{ROLE_BACKUP, ROLE_MIGRATOR, ROLE_OWNER, ROLE_RUNTIME};
use super::BootstrapError;
use sqlx::{PgConnection, Row};

/// Remove this temporary allowance when a genuine production consumer reads or constructs this item.
#[cfg_attr(not(test), allow(dead_code))]
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct RoleAttributePosture {
    pub rolname: String,
    pub rolcanlogin: bool,
    pub rolinherit: bool,
    pub rolsuper: bool,
    pub rolcreatedb: bool,
    pub rolcreaterole: bool,
    pub rolreplication: bool,
    pub rolbypassrls: bool,
}

/// Remove this temporary allowance when a genuine production consumer reads or constructs this item.
#[cfg_attr(not(test), allow(dead_code))]
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct RoleMembershipRecord {
    pub member_role: String,
    pub granted_role: String,
    pub admin_option: bool,
    pub inherit_option: bool,
    pub set_option: bool,
}

/// Verify that all four application roles exist in `pg_roles` and match their exact posture requirements.
///
/// Remove this temporary allowance when a genuine production consumer reads or constructs this item.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) async fn verify_role_attributes(
    conn: &mut PgConnection,
) -> Result<Vec<RoleAttributePosture>, BootstrapError> {
    let rows = sqlx::query(
        r#"
        SELECT rolname, rolcanlogin, rolinherit, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
        FROM pg_roles
        WHERE rolname IN ('stockiha_owner', 'stockiha_migrator', 'stockiha_runtime', 'stockiha_backup')
        ORDER BY rolname;
        "#,
    )
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| BootstrapError::Database(format!("failed to query pg_roles: {e}")))?;

    let mut postures = Vec::new();
    for row in rows {
        let posture = RoleAttributePosture {
            rolname: row.get("rolname"),
            rolcanlogin: row.get("rolcanlogin"),
            rolinherit: row.get("rolinherit"),
            rolsuper: row.get("rolsuper"),
            rolcreatedb: row.get("rolcreatedb"),
            rolcreaterole: row.get("rolcreaterole"),
            rolreplication: row.get("rolreplication"),
            rolbypassrls: row.get("rolbypassrls"),
        };
        postures.push(posture);
    }

    if postures.len() != 4 {
        return Err(BootstrapError::VerificationFailure(format!(
            "expected 4 stockiha roles in pg_roles, found {}",
            postures.len()
        )));
    }

    for p in &postures {
        if p.rolsuper
            || p.rolcreatedb
            || p.rolcreaterole
            || p.rolreplication
            || p.rolbypassrls
            || p.rolinherit
        {
            return Err(BootstrapError::VerificationFailure(format!(
                "role {} has forbidden privileges enabled: super={}, createdb={}, createrole={}, replication={}, bypassrls={}, inherit={}",
                p.rolname, p.rolsuper, p.rolcreatedb, p.rolcreaterole, p.rolreplication, p.rolbypassrls, p.rolinherit
            )));
        }

        if p.rolname == ROLE_OWNER && p.rolcanlogin {
            return Err(BootstrapError::VerificationFailure(
                "stockiha_owner must have NOLOGIN (rolcanlogin = false)".to_string(),
            ));
        }

        if (p.rolname == ROLE_MIGRATOR || p.rolname == ROLE_RUNTIME || p.rolname == ROLE_BACKUP)
            && !p.rolcanlogin
        {
            return Err(BootstrapError::VerificationFailure(format!(
                "role {} must have LOGIN (rolcanlogin = true)",
                p.rolname
            )));
        }
    }

    Ok(postures)
}

/// Verify the outgoing membership graph in `pg_auth_members`.
///
/// Rules:
/// - `stockiha_owner`: 0 outgoing memberships
/// - `stockiha_migrator`: exactly 1 outgoing membership to `stockiha_owner` with `admin_option = false`, `inherit_option = false`, `set_option = true`
/// - `stockiha_runtime`: 0 outgoing memberships
/// - `stockiha_backup`: 0 outgoing memberships
///
/// Remove this temporary allowance when a genuine production consumer reads or constructs this item.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) async fn verify_role_memberships(
    conn: &mut PgConnection,
) -> Result<Vec<RoleMembershipRecord>, BootstrapError> {
    let rows = sqlx::query(
        r#"
        SELECT 
            m.rolname AS member_role,
            g.rolname AS granted_role,
            am.admin_option,
            am.inherit_option,
            am.set_option
        FROM pg_auth_members am
        JOIN pg_roles m ON am.member = m.oid
        JOIN pg_roles g ON am.roleid = g.oid
        WHERE m.rolname IN ('stockiha_owner', 'stockiha_migrator', 'stockiha_runtime', 'stockiha_backup')
        ORDER BY m.rolname, g.rolname;
        "#,
    )
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| BootstrapError::Database(format!("failed to query pg_auth_members: {e}")))?;

    let mut memberships = Vec::new();
    for row in rows {
        memberships.push(RoleMembershipRecord {
            member_role: row.get("member_role"),
            granted_role: row.get("granted_role"),
            admin_option: row.get("admin_option"),
            inherit_option: row.get("inherit_option"),
            set_option: row.get("set_option"),
        });
    }

    // Assert exact membership count and options
    if memberships.len() != 1 {
        return Err(BootstrapError::VerificationFailure(format!(
            "expected exactly 1 role membership record across stockiha roles, found {}",
            memberships.len()
        )));
    }

    let m = &memberships[0];
    if m.member_role != ROLE_MIGRATOR || m.granted_role != ROLE_OWNER {
        return Err(BootstrapError::VerificationFailure(format!(
            "expected member_role={} granted_role={}, found member_role={} granted_role={}",
            ROLE_MIGRATOR, ROLE_OWNER, m.member_role, m.granted_role
        )));
    }

    if m.admin_option || m.inherit_option || !m.set_option {
        return Err(BootstrapError::VerificationFailure(format!(
            "stockiha_migrator membership options invalid: admin={}, inherit={}, set={} (expected admin=f, inherit=f, set=t)",
            m.admin_option, m.inherit_option, m.set_option
        )));
    }

    Ok(memberships)
}
