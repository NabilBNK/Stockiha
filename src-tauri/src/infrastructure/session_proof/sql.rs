//! S0-006 — Fixed, literal SQL for the SECURITY DEFINER / session-token proof.
//!
//! All statements use fixed identifiers — zero dynamic string construction. The
//! proof lives in a dedicated schema owned by `stockiha_owner`; the runtime role
//! receives only schema `USAGE` and `EXECUTE` on the resolver function, never any
//! privilege on the protected tables.

/// Proof schema name (fixed).
pub(crate) const PROOF_SCHEMA: &str = "s0_006_proof";
/// Proof resolver function name (fixed).
pub(crate) const PROOF_FUNCTION: &str = "resolve_session";
/// SQLSTATE raised for a missing / expired / revoked session
/// (`invalid_authorization_specification`).
pub(crate) const INVALID_SESSION_SQLSTATE: &str = "28000";

/// Drop the proof schema and every dependent object. Idempotent.
pub(crate) const SQL_TEARDOWN: &str = r#"
DROP SCHEMA IF EXISTS s0_006_proof CASCADE;
"#;

/// Create the proof objects, owned by `stockiha_owner`:
/// - `actors` and `app_sessions` protected tables,
/// - the `resolve_session` SECURITY DEFINER function with a fixed `search_path`.
///
/// `app_sessions` stores only `token_hash` (SHA-256 of the opaque token); the raw
/// token is never persisted. The function runs as its owner and validates the
/// token hash, expiry, and revocation, resolving an actor/workstation snapshot.
pub(crate) const SQL_CREATE_OBJECTS: &str = r#"
CREATE SCHEMA s0_006_proof AUTHORIZATION stockiha_owner;

SET ROLE stockiha_owner;

CREATE TABLE s0_006_proof.actors (
    user_id      text PRIMARY KEY,
    display_name text NOT NULL
);

CREATE TABLE s0_006_proof.app_sessions (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    token_hash     bytea NOT NULL UNIQUE,
    user_id        text NOT NULL REFERENCES s0_006_proof.actors(user_id),
    workstation_id text NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    expires_at     timestamptz NOT NULL,
    revoked_at     timestamptz
);

CREATE FUNCTION s0_006_proof.resolve_session(token text)
RETURNS TABLE (user_id text, workstation_id text, display_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, s0_006_proof
AS $$
DECLARE
    v_user text;
    v_ws   text;
    v_name text;
BEGIN
    SELECT s.user_id, s.workstation_id, a.display_name
      INTO v_user, v_ws, v_name
      FROM app_sessions s
      JOIN actors a ON a.user_id = s.user_id
     WHERE s.token_hash = sha256(token::bytea)
       AND s.revoked_at IS NULL
       AND s.expires_at > now();

    IF NOT FOUND THEN
        RAISE EXCEPTION 'invalid session' USING ERRCODE = '28000';
    END IF;

    RETURN QUERY SELECT v_user, v_ws, v_name;
END;
$$;

RESET ROLE;
"#;

/// Lock down access: no `PUBLIC` privileges anywhere; the runtime role gets only
/// schema `USAGE` and `EXECUTE` on the resolver — and nothing on the tables.
pub(crate) const SQL_APPLY_GRANTS: &str = r#"
REVOKE ALL ON SCHEMA s0_006_proof FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA s0_006_proof FROM PUBLIC;
REVOKE ALL ON FUNCTION s0_006_proof.resolve_session(text) FROM PUBLIC;

GRANT USAGE ON SCHEMA s0_006_proof TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION s0_006_proof.resolve_session(text) TO stockiha_runtime;
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifiers_are_stable() {
        assert_eq!(PROOF_SCHEMA, "s0_006_proof");
        assert_eq!(PROOF_FUNCTION, "resolve_session");
        assert_eq!(INVALID_SESSION_SQLSTATE, "28000");
    }

    #[test]
    fn create_objects_declares_security_definer_with_fixed_search_path() {
        assert!(SQL_CREATE_OBJECTS.contains("SECURITY DEFINER"));
        assert!(SQL_CREATE_OBJECTS.contains("SET search_path = pg_catalog, s0_006_proof"));
        // Objects are created under the owner role.
        assert!(SQL_CREATE_OBJECTS.contains("SET ROLE stockiha_owner"));
        assert!(SQL_CREATE_OBJECTS.contains("RESET ROLE"));
        // Only the token hash is ever stored — never a raw-token column.
        assert!(SQL_CREATE_OBJECTS.contains("token_hash"));
        assert!(SQL_CREATE_OBJECTS.contains("bytea NOT NULL"));
        assert!(SQL_CREATE_OBJECTS.contains("sha256(token::bytea)"));
        assert!(!SQL_CREATE_OBJECTS.to_lowercase().contains("token_plain"));
    }

    #[test]
    fn grants_revoke_public_and_grant_only_runtime() {
        assert!(SQL_APPLY_GRANTS
            .contains("REVOKE ALL ON FUNCTION s0_006_proof.resolve_session(text) FROM PUBLIC"));
        assert!(SQL_APPLY_GRANTS.contains(
            "GRANT EXECUTE ON FUNCTION s0_006_proof.resolve_session(text) TO stockiha_runtime"
        ));
        assert!(SQL_APPLY_GRANTS.contains("GRANT USAGE ON SCHEMA s0_006_proof TO stockiha_runtime"));
        // No privileges are granted to any other application role.
        assert!(!SQL_APPLY_GRANTS.contains("stockiha_backup"));
        assert!(!SQL_APPLY_GRANTS.contains("stockiha_migrator"));
    }

    #[test]
    fn statements_contain_no_format_placeholders() {
        for sql in [SQL_TEARDOWN, SQL_CREATE_OBJECTS, SQL_APPLY_GRANTS] {
            assert!(!sql.contains('%'), "no dynamic placeholders allowed");
        }
    }
}
