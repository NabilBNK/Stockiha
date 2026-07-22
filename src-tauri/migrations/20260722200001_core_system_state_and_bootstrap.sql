-- Slice 1 Frontend MVP batch: first-run system state + one-time first-admin
-- bootstrap, plus the two catalog/warehouse management permissions the new
-- create commands need.
--
-- Bootstrap security design (per the approved ruling): a single-row
-- `core.system_state` marker, an unauthenticated read-only
-- `core.get_setup_status()` for routing, and a heavily-guarded
-- `core.bootstrap_first_admin(...)` that can succeed only once (advisory
-- lock + empty-users recheck + initialized-marker recheck), creates the
-- first administrator + role assignment + workstation + default warehouse +
-- initial open fiscal period atomically, never accepts caller-supplied
-- role/permission ids, and is permanently inert afterward. The raw password
-- never reaches the database — Rust hashes it with the existing Argon2
-- implementation and passes only the hash string.
SET ROLE stockiha_owner;

-- Extend the fixed permission vocabulary (migration 408) with the two
-- management permissions product/warehouse creation require. The old CHECK
-- is a closed IN-list, so it is dropped and re-added widened rather than
-- mutated in place.
ALTER TABLE iam.permissions DROP CONSTRAINT permissions_code_valid;
ALTER TABLE iam.permissions ADD CONSTRAINT permissions_code_valid CHECK (
    code IN (
        'POST_STOCK_RECEIPT',
        'POST_CASH_SALE',
        'OPEN_CASH_SESSION',
        'CLOSE_CASH_SESSION',
        'MANAGE_CATALOG',
        'MANAGE_WAREHOUSES'
    )
);

INSERT INTO iam.permissions (code, name) VALUES
    ('MANAGE_CATALOG', 'Create and manage products and variants'),
    ('MANAGE_WAREHOUSES', 'Create and manage warehouses');

-- ADMIN gets every permission (including the two just added); MANAGER also
-- manages catalog + warehouses for the MVP. CASHIER is unchanged.
INSERT INTO iam.role_permissions (role_id, permission_id)
    SELECT r.id, p.id FROM iam.roles r, iam.permissions p
    WHERE r.code = 'ADMIN' AND p.code IN ('MANAGE_CATALOG', 'MANAGE_WAREHOUSES');
INSERT INTO iam.role_permissions (role_id, permission_id)
    SELECT r.id, p.id FROM iam.roles r, iam.permissions p
    WHERE r.code = 'MANAGER' AND p.code IN ('MANAGE_CATALOG', 'MANAGE_WAREHOUSES');

-- Singleton installation-state marker. The `id = 1` CHECK plus the primary
-- key make a second row impossible.
CREATE TABLE core.system_state (
    id                    smallint PRIMARY KEY DEFAULT 1,
    initialized           boolean NOT NULL DEFAULT false,
    initialized_at        timestamptz,
    workstation_id        text,
    default_warehouse_id  bigint REFERENCES inventory.warehouses (id),
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT system_state_singleton CHECK (id = 1),
    CONSTRAINT system_state_initialized_iff_marked CHECK (
        (initialized = false AND initialized_at IS NULL)
        OR (initialized = true AND initialized_at IS NOT NULL)
    )
);

INSERT INTO core.system_state (id, initialized) VALUES (1, false);

CREATE TRIGGER system_state_set_updated_at
    BEFORE UPDATE ON core.system_state
    FOR EACH ROW
    EXECUTE FUNCTION core.set_updated_at();

-- Unauthenticated, read-only routing status. Returns only booleans safe to
-- expose before login — never configuration, hashes, credentials, counts of
-- sensitive data, or SQL detail. Fixed search_path; every reference
-- schema-qualified.
CREATE FUNCTION core.get_setup_status()
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
            WHERE r.code = 'ADMIN'
        ),
        EXISTS (SELECT 1 FROM inventory.warehouses),
        EXISTS (SELECT 1 FROM finance.fiscal_periods WHERE status = 'OPEN'),
        (s.workstation_id IS NOT NULL)
    FROM core.system_state s
    WHERE s.id = 1;
END;
$$;

-- One-time first-administrator bootstrap. Callable by the runtime role with
-- NO session (there is no user yet), but succeeds at most once, ever.
--
-- Safety (per the approved ruling):
--  1. `pg_advisory_xact_lock` on a fixed key serializes concurrent attempts.
--  2. After acquiring the lock, re-reads the initialized marker AND the user
--     count — so a racing second caller that waited on the lock sees the
--     first caller's committed state and is rejected.
--  3. Rejects if already initialized or any user exists.
--  4. Creates admin + ADMIN-role assignment + workstation + default
--     warehouse + initial open fiscal period + marker, atomically.
--  5. Role id is looked up by fixed code; the caller never supplies role or
--     permission ids or a privilege set.
--  6. Password is pre-hashed by Rust (Argon2); only the hash string is
--     accepted here. The raw password never reaches SQL.
CREATE FUNCTION core.bootstrap_first_admin(
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
    v_admin_role_id bigint;
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

    -- (5) Assign the ADMIN role by fixed code — never a caller-supplied id.
    SELECT id INTO v_admin_role_id FROM iam.roles WHERE code = 'ADMIN';
    INSERT INTO iam.user_roles (user_id, role_id) VALUES (v_user_id, v_admin_role_id);

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

REVOKE ALL ON core.system_state FROM PUBLIC;
REVOKE ALL ON FUNCTION core.get_setup_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION core.bootstrap_first_admin(text, text, text, text, text, text, text, date, date) FROM PUBLIC;

-- Runtime may read the marker and call the two bootstrap-related functions.
-- It still cannot write `core.system_state` directly (no INSERT/UPDATE grant)
-- — only `bootstrap_first_admin` (SECURITY DEFINER, owner) writes it.
GRANT SELECT ON core.system_state TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION core.get_setup_status() TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION core.bootstrap_first_admin(text, text, text, text, text, text, text, date, date) TO stockiha_runtime;

RESET ROLE;
