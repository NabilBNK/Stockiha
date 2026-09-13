-- WS-F-002: printing settings for the till receipt.
--
-- A single-row table (id is pinned to 1) holding whether receipts print, which
-- device they go to, the Windows printer name, the paper width in characters,
-- and the shop header/footer text that appears on the receipt.
--
-- Reading the settings needs only a valid session, because the till must know
-- whether to print. Writing them needs MANAGE_PRINTING_SETTINGS.
--
-- No money, no journal, no stock, no document is touched by this migration.

SET ROLE stockiha_owner;

-- =============================================================================
-- 1. Permission
-- =============================================================================

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

    IF v_existing_check NOT LIKE '%MANAGE_PRINTING_SETTINGS%' THEN
        ALTER TABLE iam.permissions DROP CONSTRAINT permissions_code_valid;
        EXECUTE format(
            'ALTER TABLE iam.permissions ADD CONSTRAINT permissions_code_valid CHECK ((%s) OR code = %L)',
            v_existing_check,
            'MANAGE_PRINTING_SETTINGS'
        );
    END IF;
END;
$$;

INSERT INTO iam.permissions (code, name) VALUES
    ('MANAGE_PRINTING_SETTINGS', 'Manage receipt printing settings')
ON CONFLICT (code) DO NOTHING;

INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM iam.roles role
CROSS JOIN iam.permissions permission
WHERE role.code IN ('MANAGER', 'ADMIN', 'SUPER_ADMIN')
  AND permission.code = 'MANAGE_PRINTING_SETTINGS'
ON CONFLICT DO NOTHING;

-- =============================================================================
-- 2. Settings table (exactly one row, forever)
-- =============================================================================

CREATE TABLE IF NOT EXISTS core.printing_settings (
    id                       smallint PRIMARY KEY DEFAULT 1,
    receipt_printing_enabled boolean NOT NULL DEFAULT true,
    receipt_target           text NOT NULL DEFAULT 'THERMAL',
    thermal_printer_name     text,
    thermal_columns          smallint NOT NULL DEFAULT 48,
    shop_name                text,
    shop_address             text,
    shop_phone               text,
    receipt_footer           text,
    updated_at               timestamptz NOT NULL DEFAULT now(),
    updated_by_user_id       bigint REFERENCES iam.users (id) ON DELETE SET NULL,
    CONSTRAINT printing_settings_single_row CHECK (id = 1),
    CONSTRAINT printing_settings_target_valid CHECK (receipt_target IN ('THERMAL', 'A4')),
    CONSTRAINT printing_settings_columns_valid CHECK (thermal_columns IN (32, 42, 48))
);

INSERT INTO core.printing_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 3. Read
-- =============================================================================

CREATE OR REPLACE FUNCTION core.get_printing_settings(p_session_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_result jsonb;
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);

    SELECT jsonb_build_object(
        'receipt_printing_enabled', settings.receipt_printing_enabled,
        'receipt_target', settings.receipt_target,
        'thermal_printer_name', settings.thermal_printer_name,
        'thermal_columns', settings.thermal_columns,
        'shop_name', settings.shop_name,
        'shop_address', settings.shop_address,
        'shop_phone', settings.shop_phone,
        'receipt_footer', settings.receipt_footer,
        'updated_at', settings.updated_at
    )
    INTO v_result
    FROM core.printing_settings settings
    WHERE settings.id = 1;

    RETURN v_result;
END;
$$;

-- =============================================================================
-- 4. Write
-- =============================================================================

CREATE OR REPLACE FUNCTION core.save_printing_settings(
    p_session_token text,
    p_receipt_printing_enabled boolean,
    p_receipt_target text,
    p_thermal_printer_name text,
    p_thermal_columns smallint,
    p_shop_name text,
    p_shop_address text,
    p_shop_phone text,
    p_receipt_footer text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
BEGIN
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_PRINTING_SETTINGS');

    IF p_receipt_target IS NULL OR p_receipt_target NOT IN ('THERMAL', 'A4') THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: receipt target must be THERMAL or A4'
            USING ERRCODE = '22023';
    END IF;

    IF p_thermal_columns IS NULL OR p_thermal_columns NOT IN (32, 42, 48) THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: thermal width must be 32, 42 or 48 characters'
            USING ERRCODE = '22023';
    END IF;

    IF p_receipt_printing_enabled
       AND p_receipt_target = 'THERMAL'
       AND nullif(btrim(coalesce(p_thermal_printer_name, '')), '') IS NULL THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: a thermal printer name is required when thermal printing is on'
            USING ERRCODE = '22023';
    END IF;

    UPDATE core.printing_settings
    SET receipt_printing_enabled = p_receipt_printing_enabled,
        receipt_target = p_receipt_target,
        thermal_printer_name = nullif(btrim(coalesce(p_thermal_printer_name, '')), ''),
        thermal_columns = p_thermal_columns,
        shop_name = nullif(btrim(coalesce(p_shop_name, '')), ''),
        shop_address = nullif(btrim(coalesce(p_shop_address, '')), ''),
        shop_phone = nullif(btrim(coalesce(p_shop_phone, '')), ''),
        receipt_footer = nullif(btrim(coalesce(p_receipt_footer, '')), ''),
        updated_at = now(),
        updated_by_user_id = v_user_id
    WHERE id = 1;

    RETURN core.get_printing_settings(p_session_token);
END;
$$;

-- =============================================================================
-- 5. Privileges
-- =============================================================================

REVOKE ALL ON core.printing_settings FROM PUBLIC;
GRANT SELECT ON core.printing_settings TO stockiha_runtime;

REVOKE ALL ON FUNCTION core.get_printing_settings(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION core.save_printing_settings(text, boolean, text, text, smallint, text, text, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION core.get_printing_settings(text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION core.save_printing_settings(text, boolean, text, text, smallint, text, text, text, text) TO stockiha_runtime;

RESET ROLE;
