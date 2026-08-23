-- WS-A: IAM administration hardening.
--
-- Forward-only corrections to the user & role administration surface installed by
-- 20260821210000_iam_user_and_role_administration.sql. Four confirmed defects:
--
--   1. PRIVILEGE ESCALATION — iam.create_user accepted any role code, including
--      SUPER_ADMIN. iam.assign_user_role refuses to grant SUPER_ADMIN unless the
--      actor already holds it, but create_user had no equivalent guard, so any
--      MANAGE_USERS holder could mint a SUPER_ADMIN account and bypass the
--      hierarchy entirely.
--
--   2. LAST-ADMINISTRATOR LOCKOUT — neither iam.set_user_active nor
--      iam.assign_user_role checked whether the operation removed the final
--      active MANAGE_USERS holder. set_user_active only rejected *self*
--      deactivation, and assign_user_role had no self-check at all, so a lone
--      administrator could demote itself to CASHIER (or two administrators could
--      deactivate each other) and permanently strand the installation:
--      core.bootstrap_first_admin refuses to run once iam.users is non-empty, and
--      there is no offline password/role recovery path.
--
--   3. DUPLICATED USER ROWS — iam.list_users joined iam.user_roles without
--      aggregating, so a user holding N roles appeared N times. iam.user_roles is
--      a junction table with no uniqueness on user_id, so this is reachable.
--      Roles are now aggregated into arrays; one row per user.
--
--   4. UNTYPED EXCEPTIONS — every RAISE in the original migration omitted
--      ERRCODE, landing on the default P0001. The Rust IPC boundary classifies by
--      SQLSTATE, so it had to fall back to substring-matching the database
--      message. Every exception below now carries an explicit SQLSTATE (55000,
--      which the boundary maps to PRECONDITION_FAILED), matching the classes the
--      rest of the schema already uses and removing the string-matching fallback.
--
-- The "final active administrator" predicate is deliberately expressed over the
-- MANAGE_USERS *permission* rather than over a role code: a custom role created
-- through iam.create_role + iam.set_role_permissions can also hold MANAGE_USERS,
-- and such a holder must count as an administrator for lockout purposes.

SET ROLE stockiha_owner;

-- ---------------------------------------------------------------------------
-- Helper: does any ACTIVE user other than the excluded one hold MANAGE_USERS?
-- ---------------------------------------------------------------------------
CREATE FUNCTION iam.another_active_user_administrator_exists(p_excluded_user_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM iam.users u
        JOIN iam.user_roles ur ON ur.user_id = u.id
        JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
        JOIN iam.permissions p ON p.id = rp.permission_id
        WHERE u.is_active
          AND u.id <> p_excluded_user_id
          AND p.code = 'MANAGE_USERS'
    );
$$;

REVOKE ALL ON FUNCTION iam.another_active_user_administrator_exists(bigint) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 1. iam.create_user — add the SUPER_ADMIN hierarchy guard, typed exceptions.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION iam.create_user(
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
    v_role_id bigint;
    v_new_user_id bigint;
    v_actor_has_super boolean;
BEGIN
    SELECT user_id INTO v_actor_user_id
    FROM iam.resolve_session_with_permission(p_token, 'MANAGE_USERS');

    IF p_username IS NULL OR btrim(p_username) = '' THEN
        RAISE EXCEPTION 'username cannot be empty' USING ERRCODE = '55000';
    END IF;

    IF p_password_hash IS NULL OR p_password_hash = '' THEN
        RAISE EXCEPTION 'password hash cannot be empty' USING ERRCODE = '55000';
    END IF;

    SELECT id INTO v_role_id FROM iam.roles WHERE code = p_role_code;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'unknown role code: %', p_role_code USING ERRCODE = '55000';
    END IF;

    -- Same hierarchy rule iam.assign_user_role enforces: SUPER_ADMIN is only
    -- grantable by a SUPER_ADMIN. Without this, creation was an escalation path.
    IF p_role_code = 'SUPER_ADMIN' THEN
        SELECT EXISTS (
            SELECT 1
            FROM iam.user_roles ur
            JOIN iam.roles r ON r.id = ur.role_id
            WHERE ur.user_id = v_actor_user_id AND r.code = 'SUPER_ADMIN'
        ) INTO v_actor_has_super;

        IF NOT v_actor_has_super THEN
            RAISE EXCEPTION 'only a SUPER_ADMIN can assign the SUPER_ADMIN role'
                USING ERRCODE = '55000';
        END IF;
    END IF;

    BEGIN
        INSERT INTO iam.users (username, password_hash, display_name)
        VALUES (btrim(p_username), p_password_hash, p_display_name)
        RETURNING id INTO v_new_user_id;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'username already exists' USING ERRCODE = '55000';
    END;

    INSERT INTO iam.user_roles (user_id, role_id)
    VALUES (v_new_user_id, v_role_id);

    RETURN v_new_user_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. iam.list_users — one row per user; roles aggregated.
--    The return type changes, so the old function must be dropped first.
-- ---------------------------------------------------------------------------
DROP FUNCTION iam.list_users(text);

CREATE FUNCTION iam.list_users(p_token text)
RETURNS TABLE (
    user_id bigint,
    username text,
    display_name text,
    is_active boolean,
    role_codes text[],
    role_names text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM iam.resolve_session_with_permission(p_token, 'MANAGE_USERS');

    RETURN QUERY
    SELECT
        u.id,
        u.username,
        u.display_name,
        u.is_active,
        COALESCE(array_agg(r.code ORDER BY r.code) FILTER (WHERE r.code IS NOT NULL),
                 ARRAY[]::text[]),
        COALESCE(array_agg(r.name ORDER BY r.code) FILTER (WHERE r.name IS NOT NULL),
                 ARRAY[]::text[])
    FROM iam.users u
    LEFT JOIN iam.user_roles ur ON ur.user_id = u.id
    LEFT JOIN iam.roles r ON r.id = ur.role_id
    GROUP BY u.id, u.username, u.display_name, u.is_active
    ORDER BY u.username, u.id;
END;
$$;

REVOKE ALL ON FUNCTION iam.list_users(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION iam.list_users(text) TO stockiha_runtime;

-- ---------------------------------------------------------------------------
-- 3. iam.set_user_active — last-administrator guard, typed exceptions.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION iam.set_user_active(
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
    v_target_is_admin boolean;
BEGIN
    SELECT user_id INTO v_actor_user_id
    FROM iam.resolve_session_with_permission(p_token, 'MANAGE_USERS');

    IF p_target_user_id = v_actor_user_id AND NOT p_is_active THEN
        RAISE EXCEPTION 'cannot deactivate own user account' USING ERRCODE = '55000';
    END IF;

    -- Lock the target so a concurrent set_user_active / assign_user_role on the
    -- other administrator cannot interleave between the check and the write.
    PERFORM 1 FROM iam.users WHERE id = p_target_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'target user does not exist' USING ERRCODE = '55000';
    END IF;

    -- Defence in depth. With the self-deactivation rule above in force this
    -- branch is currently unreachable: the caller is by definition an active
    -- MANAGE_USERS holder, so if the caller is not the target then another
    -- administrator demonstrably remains. It is kept because relaxing the
    -- self-deactivation rule would otherwise silently reintroduce the lockout.
    IF NOT p_is_active THEN
        SELECT EXISTS (
            SELECT 1
            FROM iam.user_roles ur
            JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
            JOIN iam.permissions p ON p.id = rp.permission_id
            WHERE ur.user_id = p_target_user_id AND p.code = 'MANAGE_USERS'
        ) INTO v_target_is_admin;

        IF v_target_is_admin
           AND NOT iam.another_active_user_administrator_exists(p_target_user_id)
        THEN
            RAISE EXCEPTION 'cannot deactivate the last active user administrator'
                USING ERRCODE = '55000';
        END IF;
    END IF;

    UPDATE iam.users
    SET is_active = p_is_active
    WHERE id = p_target_user_id;

    IF NOT p_is_active THEN
        UPDATE iam.application_sessions
        SET revoked_at = now()
        WHERE user_id = p_target_user_id
          AND revoked_at IS NULL
          AND expires_at > now();
    END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. iam.assign_user_role — last-administrator guard, typed exceptions.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION iam.assign_user_role(
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
    v_target_is_admin boolean;
    v_new_role_is_admin boolean;
    v_target_is_active boolean;
BEGIN
    SELECT user_id INTO v_actor_user_id
    FROM iam.resolve_session_with_permission(p_token, 'MANAGE_USERS');

    SELECT is_active INTO v_target_is_active
    FROM iam.users WHERE id = p_target_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'target user does not exist' USING ERRCODE = '55000';
    END IF;

    SELECT id INTO v_target_role_id FROM iam.roles WHERE code = p_role_code;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'unknown role code: %', p_role_code USING ERRCODE = '55000';
    END IF;

    IF p_role_code = 'SUPER_ADMIN' THEN
        SELECT EXISTS (
            SELECT 1
            FROM iam.user_roles ur
            JOIN iam.roles r ON r.id = ur.role_id
            WHERE ur.user_id = v_actor_user_id AND r.code = 'SUPER_ADMIN'
        ) INTO v_actor_has_super;

        IF NOT v_actor_has_super THEN
            RAISE EXCEPTION 'only a SUPER_ADMIN can assign the SUPER_ADMIN role'
                USING ERRCODE = '55000';
        END IF;
    END IF;

    -- Reassignment replaces every role the target holds. If that strips
    -- MANAGE_USERS from the final active administrator, the installation
    -- becomes unrecoverable, so refuse.
    SELECT EXISTS (
        SELECT 1
        FROM iam.user_roles ur
        JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
        JOIN iam.permissions p ON p.id = rp.permission_id
        WHERE ur.user_id = p_target_user_id AND p.code = 'MANAGE_USERS'
    ) INTO v_target_is_admin;

    SELECT EXISTS (
        SELECT 1
        FROM iam.role_permissions rp
        JOIN iam.permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = v_target_role_id AND p.code = 'MANAGE_USERS'
    ) INTO v_new_role_is_admin;

    IF v_target_is_active
       AND v_target_is_admin
       AND NOT v_new_role_is_admin
       AND NOT iam.another_active_user_administrator_exists(p_target_user_id)
    THEN
        RAISE EXCEPTION 'cannot remove user administration from the last active user administrator'
            USING ERRCODE = '55000';
    END IF;

    DELETE FROM iam.user_roles WHERE user_id = p_target_user_id;
    INSERT INTO iam.user_roles (user_id, role_id) VALUES (p_target_user_id, v_target_role_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. iam.create_role — typed exceptions.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION iam.create_role(
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
    PERFORM iam.resolve_session_with_permission(p_token, 'MANAGE_ROLES');

    IF p_role_code IS NULL OR NOT (p_role_code ~ '^[A-Z][A-Z0-9_]*$') THEN
        RAISE EXCEPTION 'malformed role code' USING ERRCODE = '55000';
    END IF;

    IF p_role_name IS NULL OR btrim(p_role_name) = '' THEN
        RAISE EXCEPTION 'role name cannot be empty' USING ERRCODE = '55000';
    END IF;

    BEGIN
        INSERT INTO iam.roles (code, name)
        VALUES (p_role_code, btrim(p_role_name))
        RETURNING id INTO v_new_role_id;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'role code already exists' USING ERRCODE = '55000';
    END;

    RETURN v_new_role_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. iam.set_role_permissions — typed exceptions; refuse to strip MANAGE_USERS
--    from a role while that would strand the last active administrator.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION iam.set_role_permissions(
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
    v_role_grants_manage_users boolean;
    v_new_grants_manage_users boolean;
    v_administrator_survives boolean;
BEGIN
    PERFORM iam.resolve_session_with_permission(p_token, 'MANAGE_ROLES');

    SELECT id INTO v_target_role_id FROM iam.roles WHERE code = p_role_code FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'target role does not exist' USING ERRCODE = '55000';
    END IF;

    IF p_role_code = 'SUPER_ADMIN' THEN
        RAISE EXCEPTION 'cannot modify permissions of SUPER_ADMIN role'
            USING ERRCODE = '55000';
    END IF;

    IF p_permission_codes IS NOT NULL THEN
        FOREACH v_code IN ARRAY p_permission_codes LOOP
            SELECT id INTO v_permission_id FROM iam.permissions WHERE code = v_code;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'unknown permission code: %', v_code USING ERRCODE = '55000';
            END IF;
            v_permission_ids := array_append(v_permission_ids, v_permission_id);
        END LOOP;
    END IF;

    v_new_grants_manage_users :=
        p_permission_codes IS NOT NULL AND 'MANAGE_USERS' = ANY (p_permission_codes);

    SELECT EXISTS (
        SELECT 1
        FROM iam.role_permissions rp
        JOIN iam.permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = v_target_role_id AND p.code = 'MANAGE_USERS'
    ) INTO v_role_grants_manage_users;

    -- Revoking MANAGE_USERS from a role can strand every administrator at once,
    -- so the survivor test must be evaluated against the post-change state:
    -- would any active user still reach MANAGE_USERS through some *other* role?
    IF v_role_grants_manage_users AND NOT v_new_grants_manage_users THEN
        SELECT EXISTS (
            SELECT 1
            FROM iam.users u
            JOIN iam.user_roles ur ON ur.user_id = u.id
            JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
            JOIN iam.permissions p ON p.id = rp.permission_id
            WHERE u.is_active
              AND ur.role_id <> v_target_role_id
              AND p.code = 'MANAGE_USERS'
        ) INTO v_administrator_survives;

        IF NOT v_administrator_survives THEN
            RAISE EXCEPTION 'cannot revoke MANAGE_USERS from the last role that grants user administration'
                USING ERRCODE = '55000';
        END IF;
    END IF;

    DELETE FROM iam.role_permissions WHERE role_id = v_target_role_id;

    IF array_length(v_permission_ids, 1) > 0 THEN
        INSERT INTO iam.role_permissions (role_id, permission_id)
        SELECT v_target_role_id, pid
        FROM unnest(v_permission_ids) AS pid
        ON CONFLICT DO NOTHING;
    END IF;
END;
$$;

RESET ROLE;
