-- Pre-WS-B: SuperAdmin bootstrap correction.
--
-- Forward-only corrections to functions installed by
-- 20260722200001_core_system_state_and_bootstrap.sql and
-- 20260822190000_iam_admin_safety_hardening.sql. Two confirmed defects:
--
--   1. WRONG BOOTSTRAP ROLE — core.bootstrap_first_admin predates
--      20260821210000_iam_user_and_role_administration.sql, which introduced
--      the SUPER_ADMIN role as the permanent, un-lockable installation owner
--      sitting above ADMIN in the hierarchy (only a SUPER_ADMIN may grant
--      SUPER_ADMIN — see iam.create_user / iam.assign_user_role). Bootstrap
--      was never updated afterward and still assigns the first account the
--      ordinary ADMIN role by fixed code. core.get_setup_status() has the
--      same fixed-code dependency for its `administrator_exists` signal.
--
--   2. NO SUPER_ADMIN-SPECIFIC LOCKOUT GUARD — the last-administrator guards
--      added in 20260822190000 are expressed over the MANAGE_USERS
--      *permission*, not a role code, so they stop the installation from
--      losing user-administration capability entirely. But they do not stop
--      the *last active SUPER_ADMIN* from being deactivated or reassigned
--      away from SUPER_ADMIN while an ordinary ADMIN (who also holds
--      MANAGE_USERS) remains active. Because only an existing SUPER_ADMIN
--      can ever grant SUPER_ADMIN again (iam.create_user /
--      iam.assign_user_role hierarchy check), reaching zero SUPER_ADMIN
--      holders is permanent and unrecoverable through the application. This
--      migration adds a symmetric, role-code-specific guard for SUPER_ADMIN
--      alongside the existing permission-based guard.

SET ROLE stockiha_owner;

-- ---------------------------------------------------------------------------
-- 1. core.bootstrap_first_admin — assign SUPER_ADMIN, not ADMIN, to the
--    first account created during first-time setup.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION core.bootstrap_first_admin(
    p_username text,
    p_password_hash text,
    p_display_name text,
    p_workstation_id text,
    p_warehouse_code text,
    p_warehouse_name text,
    p_period_code text,
    p_period_starts_on date,
    p_period_ends_on date
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_super_admin_role_id bigint;
    v_warehouse_id bigint;
BEGIN
    -- (1) Serialize concurrent bootstrap attempts. Fixed 64-bit key derived
    -- from the ASCII of "STOCKBST".
    PERFORM pg_advisory_xact_lock(0x53544f434b425354);

    -- (2)/(3) Re-check under the lock. Either signal means setup is done.
    IF (SELECT initialized FROM core.system_state WHERE id = 1)
       OR EXISTS (SELECT 1 FROM iam.users)
    THEN
        RAISE EXCEPTION 'system is already initialized' USING ERRCODE = '55000';
    END IF;

    IF p_period_ends_on < p_period_starts_on THEN
        RAISE EXCEPTION 'fiscal period end must not precede its start' USING ERRCODE = '22023';
    END IF;

    -- (4) Create the first administrator.
    INSERT INTO iam.users (username, password_hash, display_name)
        VALUES (p_username, p_password_hash, p_display_name)
        RETURNING id INTO v_user_id;

    -- (5) Assign the SUPER_ADMIN role by fixed code — never a caller-supplied
    -- id. SUPER_ADMIN is the permanent, un-lockable installation owner; see
    -- 20260821210000_iam_user_and_role_administration.sql.
    SELECT id INTO v_super_admin_role_id FROM iam.roles WHERE code = 'SUPER_ADMIN';
    INSERT INTO iam.user_roles (user_id, role_id) VALUES (v_user_id, v_super_admin_role_id);

    -- Default warehouse.
    INSERT INTO inventory.warehouses (code, name)
        VALUES (p_warehouse_code, p_warehouse_name)
        RETURNING id INTO v_warehouse_id;

    -- Initial open fiscal period.
    INSERT INTO finance.fiscal_periods (period_code, starts_on, ends_on, status)
        VALUES (p_period_code, p_period_starts_on, p_period_ends_on, 'OPEN');

    -- Workstation + default warehouse + initialized marker.
    UPDATE core.system_state
        SET initialized = true,
            initialized_at = now(),
            workstation_id = p_workstation_id,
            default_warehouse_id = v_warehouse_id
        WHERE id = 1;

    RETURN v_user_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. core.get_setup_status — the `administrator_exists` signal must look for
--    the role bootstrap now actually assigns.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION core.get_setup_status()
RETURNS TABLE (
    initialized             boolean,
    administrator_exists    boolean,
    warehouse_exists        boolean,
    open_fiscal_period_exists boolean,
    workstation_configured  boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    RETURN QUERY
    SELECT
        s.initialized,
        EXISTS (
            SELECT 1 FROM iam.user_roles ur
            JOIN iam.roles r ON r.id = ur.role_id
            WHERE r.code = 'SUPER_ADMIN'
        ),
        EXISTS (SELECT 1 FROM inventory.warehouses),
        EXISTS (SELECT 1 FROM finance.fiscal_periods WHERE status = 'OPEN'),
        (s.workstation_id IS NOT NULL)
    FROM core.system_state s
    WHERE s.id = 1;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. iam.another_active_super_admin_exists — SUPER_ADMIN analogue of
--    iam.another_active_user_administrator_exists, keyed on the role code
--    rather than the MANAGE_USERS permission, so the guard below holds even
--    when an ordinary ADMIN also carries MANAGE_USERS.
-- ---------------------------------------------------------------------------
CREATE FUNCTION iam.another_active_super_admin_exists(p_excluded_user_id bigint)
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
        JOIN iam.roles r ON r.id = ur.role_id
        WHERE u.is_active
          AND u.id <> p_excluded_user_id
          AND r.code = 'SUPER_ADMIN'
    );
$$;

REVOKE ALL ON FUNCTION iam.another_active_super_admin_exists(bigint) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 4. iam.set_user_active — add the SUPER_ADMIN-specific lockout guard
--    alongside the existing MANAGE_USERS guard.
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
    v_target_is_super_admin boolean;
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

    -- SUPER_ADMIN-specific guard (Pre-WS-B): the permanent installation owner
    -- must never reach zero holders, even while another role (e.g. ADMIN)
    -- still grants MANAGE_USERS and would otherwise satisfy the check below.
    IF NOT p_is_active THEN
        SELECT EXISTS (
            SELECT 1
            FROM iam.user_roles ur
            JOIN iam.roles r ON r.id = ur.role_id
            WHERE ur.user_id = p_target_user_id AND r.code = 'SUPER_ADMIN'
        ) INTO v_target_is_super_admin;

        IF v_target_is_super_admin
           AND NOT iam.another_active_super_admin_exists(p_target_user_id)
        THEN
            RAISE EXCEPTION 'cannot deactivate the last active SUPER_ADMIN'
                USING ERRCODE = '55000';
        END IF;
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
-- 5. iam.assign_user_role — add the SUPER_ADMIN-specific lockout guard
--    alongside the existing MANAGE_USERS guard.
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
    v_target_is_super_admin boolean;
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

    -- SUPER_ADMIN-specific guard (Pre-WS-B): reassignment away from
    -- SUPER_ADMIN must never strip the last active holder, even while another
    -- role (e.g. ADMIN) still grants MANAGE_USERS and would otherwise satisfy
    -- the check below.
    IF v_target_is_active AND p_role_code <> 'SUPER_ADMIN' THEN
        SELECT EXISTS (
            SELECT 1
            FROM iam.user_roles ur
            JOIN iam.roles r ON r.id = ur.role_id
            WHERE ur.user_id = p_target_user_id AND r.code = 'SUPER_ADMIN'
        ) INTO v_target_is_super_admin;

        IF v_target_is_super_admin
           AND NOT iam.another_active_super_admin_exists(p_target_user_id)
        THEN
            RAISE EXCEPTION 'cannot remove the SUPER_ADMIN role from the last active SUPER_ADMIN'
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

RESET ROLE;
