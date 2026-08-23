-- WS-A-3: Frontend User Management (Role Metadata)
SET ROLE stockiha_owner;

CREATE FUNCTION iam.list_roles(p_token text)
RETURNS TABLE (
    code text,
    name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    -- Authenticate and Authorize
    -- Require MANAGE_USERS so we can list roles for assignment
    PERFORM iam.resolve_session_with_permission(p_token, 'MANAGE_USERS');

    RETURN QUERY
    SELECT r.code, r.name
    FROM iam.roles r
    ORDER BY r.code;
END;
$$;

REVOKE ALL ON FUNCTION iam.list_roles FROM PUBLIC;
GRANT EXECUTE ON FUNCTION iam.list_roles TO stockiha_runtime;

RESET ROLE;
