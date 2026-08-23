-- WS-A-1: Database Layer for User & Role Administration
SET ROLE stockiha_owner;

-- 1. Extend the permissions vocabulary
DO $$
DECLARE
    v_existing_check text;
BEGIN
    SELECT pg_get_expr(c.conbin, c.conrelid)
    INTO v_existing_check
    FROM pg_constraint c
    WHERE c.conrelid = 'iam.permissions'::regclass
      AND c.conname = 'permissions_code_valid'
      AND c.contype = 'c';

    IF v_existing_check IS NULL THEN
        RAISE EXCEPTION 'expected iam.permissions constraint permissions_code_valid is missing';
    END IF;

    ALTER TABLE iam.permissions DROP CONSTRAINT permissions_code_valid;
    EXECUTE format(
        'ALTER TABLE iam.permissions ADD CONSTRAINT permissions_code_valid CHECK ((%s) OR code IN (%L, %L))',
        v_existing_check,
        'MANAGE_USERS',
        'MANAGE_ROLES'
    );
END;
$$;

-- Seed the new permissions
INSERT INTO iam.permissions (code, name) VALUES
    ('MANAGE_USERS', 'Create, deactivate, and reassign the role of application users'),
    ('MANAGE_ROLES', 'Create custom roles and configure their permission sets')
ON CONFLICT (code) DO NOTHING;

-- Seed SUPER_ADMIN role
INSERT INTO iam.roles (code, name) VALUES
    ('SUPER_ADMIN', 'Super Administrator')
ON CONFLICT (code) DO NOTHING;

-- Grant SUPER_ADMIN every permission currently present in iam.permissions
INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM iam.roles r
CROSS JOIN iam.permissions p
WHERE r.code = 'SUPER_ADMIN'
ON CONFLICT DO NOTHING;

-- Grant MANAGE_USERS and MANAGE_ROLES to ADMIN
INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM iam.roles r
CROSS JOIN iam.permissions p
WHERE r.code = 'ADMIN'
  AND p.code IN ('MANAGE_USERS', 'MANAGE_ROLES')
ON CONFLICT DO NOTHING;

-- 5. iam.create_user
CREATE FUNCTION iam.create_user(
    p_token text,
    p_username text,
    p_password_hash text,
    p_display_name text,
    p_role_code text
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_actor_user_id bigint;
    v_actor_workstation_id text;
    v_role_id bigint;
    v_new_user_id bigint;
BEGIN
    -- Authenticate and Authorize
    SELECT user_id, workstation_id INTO v_actor_user_id, v_actor_workstation_id
    FROM iam.resolve_session_with_permission(p_token, 'MANAGE_USERS');

    -- Validate input
    IF btrim(p_username) = '' OR p_username IS NULL THEN
        RAISE EXCEPTION 'username cannot be empty';
    END IF;

    IF p_password_hash = '' OR p_password_hash IS NULL THEN
        RAISE EXCEPTION 'password hash cannot be empty';
    END IF;
    
    -- Verify role
    SELECT id INTO v_role_id FROM iam.roles WHERE code = p_role_code;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'unknown role code: %', p_role_code;
    END IF;

    -- Insert user
    BEGIN
        INSERT INTO iam.users (username, password_hash, display_name)
        VALUES (p_username, p_password_hash, p_display_name)
        RETURNING id INTO v_new_user_id;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'username already exists';
    END;

    -- Insert role assignment
    INSERT INTO iam.user_roles (user_id, role_id)
    VALUES (v_new_user_id, v_role_id);

    RETURN v_new_user_id;
END;
$$;

-- 6. iam.list_users
CREATE FUNCTION iam.list_users(p_token text)
RETURNS TABLE (
    user_id bigint,
    username text,
    display_name text,
    is_active boolean,
    role_code text,
    role_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    -- Authenticate and Authorize
    PERFORM iam.resolve_session_with_permission(p_token, 'MANAGE_USERS');

    RETURN QUERY
    SELECT 
        u.id, 
        u.username, 
        u.display_name, 
        u.is_active, 
        r.code, 
        r.name
    FROM iam.users u
    JOIN iam.user_roles ur ON u.id = ur.user_id
    JOIN iam.roles r ON ur.role_id = r.id
    ORDER BY u.username, u.id;
END;
$$;

-- 7. iam.set_user_active
CREATE FUNCTION iam.set_user_active(
    p_token text,
    p_target_user_id bigint,
    p_is_active boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_actor_user_id bigint;
BEGIN
    -- Authenticate and Authorize
    SELECT user_id INTO v_actor_user_id
    FROM iam.resolve_session_with_permission(p_token, 'MANAGE_USERS');

    -- Reject self-deactivation
    IF p_target_user_id = v_actor_user_id AND NOT p_is_active THEN
        RAISE EXCEPTION 'cannot deactivate own user account';
    END IF;

    -- Verify target user
    IF NOT EXISTS (SELECT 1 FROM iam.users WHERE id = p_target_user_id) THEN
        RAISE EXCEPTION 'target user does not exist';
    END IF;

    -- Update is_active
    UPDATE iam.users
    SET is_active = p_is_active
    WHERE id = p_target_user_id;

    -- If deactivating, revoke all live sessions
    IF NOT p_is_active THEN
        UPDATE iam.application_sessions
        SET revoked_at = now()
        WHERE user_id = p_target_user_id
          AND revoked_at IS NULL
          AND expires_at > now();
    END IF;
END;
$$;

-- 8. iam.assign_user_role
CREATE FUNCTION iam.assign_user_role(
    p_token text,
    p_target_user_id bigint,
    p_role_code text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_actor_user_id bigint;
    v_target_role_id bigint;
    v_actor_has_super boolean;
BEGIN
    -- Authenticate and Authorize
    SELECT user_id INTO v_actor_user_id
    FROM iam.resolve_session_with_permission(p_token, 'MANAGE_USERS');

    -- Verify target user
    IF NOT EXISTS (SELECT 1 FROM iam.users WHERE id = p_target_user_id) THEN
        RAISE EXCEPTION 'target user does not exist';
    END IF;

    -- Verify target role
    SELECT id INTO v_target_role_id FROM iam.roles WHERE code = p_role_code;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'unknown role code: %', p_role_code;
    END IF;

    -- Enforce SUPER_ADMIN privilege hierarchy rule
    IF p_role_code = 'SUPER_ADMIN' THEN
        SELECT EXISTS (
            SELECT 1
            FROM iam.user_roles ur
            JOIN iam.roles r ON ur.role_id = r.id
            WHERE ur.user_id = v_actor_user_id AND r.code = 'SUPER_ADMIN'
        ) INTO v_actor_has_super;

        IF NOT v_actor_has_super THEN
            RAISE EXCEPTION 'only a SUPER_ADMIN can assign the SUPER_ADMIN role';
        END IF;
    END IF;

    -- Reassign role
    DELETE FROM iam.user_roles WHERE user_id = p_target_user_id;
    INSERT INTO iam.user_roles (user_id, role_id) VALUES (p_target_user_id, v_target_role_id);
END;
$$;

-- 9. iam.create_role
CREATE FUNCTION iam.create_role(
    p_token text,
    p_role_code text,
    p_role_name text
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_new_role_id bigint;
BEGIN
    -- Authenticate and Authorize
    PERFORM iam.resolve_session_with_permission(p_token, 'MANAGE_ROLES');

    -- Validate input
    IF NOT (p_role_code ~ '^[A-Z][A-Z0-9_]*$') THEN
        RAISE EXCEPTION 'malformed role code';
    END IF;
    
    IF btrim(p_role_name) = '' OR p_role_name IS NULL THEN
        RAISE EXCEPTION 'role name cannot be empty';
    END IF;

    -- Insert role
    BEGIN
        INSERT INTO iam.roles (code, name)
        VALUES (p_role_code, p_role_name)
        RETURNING id INTO v_new_role_id;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'role code already exists';
    END;

    RETURN v_new_role_id;
END;
$$;

-- 10. iam.list_permissions
CREATE FUNCTION iam.list_permissions(p_token text)
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
    PERFORM iam.resolve_session_with_permission(p_token, 'MANAGE_ROLES');

    RETURN QUERY
    SELECT p.code, p.name
    FROM iam.permissions p
    ORDER BY p.code;
END;
$$;

-- 11. iam.set_role_permissions
CREATE FUNCTION iam.set_role_permissions(
    p_token text,
    p_role_code text,
    p_permission_codes text[]
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_target_role_id bigint;
    v_code text;
    v_permission_id bigint;
    v_permission_ids bigint[] := ARRAY[]::bigint[];
BEGIN
    -- Authenticate and Authorize
    PERFORM iam.resolve_session_with_permission(p_token, 'MANAGE_ROLES');

    -- Verify target role
    SELECT id INTO v_target_role_id FROM iam.roles WHERE code = p_role_code;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'target role does not exist';
    END IF;

    -- Reject SUPER_ADMIN
    IF p_role_code = 'SUPER_ADMIN' THEN
        RAISE EXCEPTION 'cannot modify permissions of SUPER_ADMIN role';
    END IF;

    -- Validate permissions
    IF p_permission_codes IS NOT NULL THEN
        FOREACH v_code IN ARRAY p_permission_codes LOOP
            SELECT id INTO v_permission_id FROM iam.permissions WHERE code = v_code;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'unknown permission code: %', v_code;
            END IF;
            v_permission_ids := array_append(v_permission_ids, v_permission_id);
        END LOOP;
    END IF;

    -- Modify permissions
    DELETE FROM iam.role_permissions WHERE role_id = v_target_role_id;
    
    IF array_length(v_permission_ids, 1) > 0 THEN
        INSERT INTO iam.role_permissions (role_id, permission_id)
        SELECT v_target_role_id, pid
        FROM unnest(v_permission_ids) AS pid
        ON CONFLICT DO NOTHING; -- in case of duplicate permissions in the array
    END IF;
END;
$$;

-- 12. PRIVILEGES

REVOKE ALL ON FUNCTION iam.create_user FROM PUBLIC;
REVOKE ALL ON FUNCTION iam.list_users FROM PUBLIC;
REVOKE ALL ON FUNCTION iam.set_user_active FROM PUBLIC;
REVOKE ALL ON FUNCTION iam.assign_user_role FROM PUBLIC;
REVOKE ALL ON FUNCTION iam.create_role FROM PUBLIC;
REVOKE ALL ON FUNCTION iam.list_permissions FROM PUBLIC;
REVOKE ALL ON FUNCTION iam.set_role_permissions FROM PUBLIC;

GRANT EXECUTE ON FUNCTION iam.create_user TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION iam.list_users TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION iam.set_user_active TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION iam.assign_user_role TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION iam.create_role TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION iam.list_permissions TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION iam.set_role_permissions TO stockiha_runtime;

-- stockiha_runtime does NOT get direct write access to iam.users, iam.user_roles, iam.roles, or iam.role_permissions
-- because these are owner-managed through the SECURITY DEFINER functions.
-- It already has SELECT on these from the original migration.
-- Application sessions write access was granted in the original migration for login.
-- Therefore, no additional table privileges need to be granted here.

RESET ROLE;
