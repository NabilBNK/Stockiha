-- WS-A-4: per-role permission read.
--
-- `iam.set_role_permissions` replaces a role's grants wholesale: it deletes
-- every row for the role and reinserts the submitted set. That contract is
-- correct, but it is only safe for a caller that knows what the role currently
-- holds. No function exposed that, so the permission editor had nothing to load
-- and opened every checkbox unchecked regardless of stored state. Saving from
-- that state submits a set that omits everything the role already had, and the
-- wholesale replace then deletes it.
--
-- On ADMIN the loss was blocked by accident: the last-administrator guard added
-- in 20260822190000 refuses to strip MANAGE_USERS, so the save aborted and the
-- grants survived. Roles that do not hold MANAGE_USERS -- MANAGER and CASHIER --
-- had no such protection and would have lost every grant silently.
--
-- This function closes that gap by making current state readable. It is
-- additive: no existing function, table, grant, or row is modified.
SET ROLE stockiha_owner;

CREATE FUNCTION iam.list_role_permissions(
    p_token text,
    p_role_code text
)
RETURNS TABLE (
    code text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_role_id bigint;
BEGIN
    -- Same authorization as iam.set_role_permissions. Reading which permissions
    -- a role grants is role administration, not user administration, so it
    -- requires MANAGE_ROLES rather than MANAGE_USERS. A caller allowed to
    -- rewrite a role's grants is necessarily allowed to read them; this grants
    -- no capability that MANAGE_ROLES did not already imply.
    PERFORM iam.resolve_session_with_permission(p_token, 'MANAGE_ROLES');

    SELECT r.id INTO v_role_id
    FROM iam.roles r
    WHERE r.code = p_role_code;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'target role does not exist'
            USING ERRCODE = '55000';
    END IF;

    -- SUPER_ADMIN is readable even though it is not writable: the editor must
    -- be able to show what it holds. The write path keeps refusing it.
    RETURN QUERY
    SELECT p.code
    FROM iam.role_permissions rp
    JOIN iam.permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = v_role_id
    ORDER BY p.code;
END;
$$;

REVOKE ALL ON FUNCTION iam.list_role_permissions(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION iam.list_role_permissions(text, text) TO stockiha_runtime;

RESET ROLE;
