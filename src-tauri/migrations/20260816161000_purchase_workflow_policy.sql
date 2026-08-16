-- Persisted purchasing workflow policy.
-- DIRECT_PURCHASE is the default operator workflow. PURCHASE_ORDER enables the
-- advanced order -> receipt -> invoice process for new purchases. Historical
-- documents are never rewritten when this setting changes.

SET ROLE stockiha_owner;

INSERT INTO core.system_settings (setting_key, setting_value, updated_at)
VALUES (
    'purchase_workflow_mode',
    CASE
        WHEN lower(core.get_setting('simplified_purchase_entry', 'true')) = 'true'
            THEN 'DIRECT_PURCHASE'
        ELSE 'PURCHASE_ORDER'
    END,
    now()
)
ON CONFLICT (setting_key) DO NOTHING;

CREATE OR REPLACE FUNCTION procurement.get_purchase_workflow_policy(
    p_session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_can_manage boolean;
    v_mode text;
BEGIN
    SELECT user_id
    INTO v_user_id
    FROM iam.resolve_session(p_session_token);

    SELECT EXISTS (
        SELECT 1
        FROM iam.user_roles user_role
        JOIN iam.roles role ON role.id = user_role.role_id
        WHERE user_role.user_id = v_user_id
          AND role.code = 'ADMIN'
    )
    INTO v_can_manage;

    SELECT setting_value
    INTO v_mode
    FROM core.system_settings
    WHERE setting_key = 'purchase_workflow_mode';

    v_mode := COALESCE(v_mode, 'DIRECT_PURCHASE');
    IF v_mode NOT IN ('DIRECT_PURCHASE', 'PURCHASE_ORDER') THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Invalid persisted purchase workflow mode %', v_mode
            USING ERRCODE = '55000';
    END IF;

    RETURN jsonb_build_object(
        'mode', v_mode,
        'direct_purchase_enabled', v_mode = 'DIRECT_PURCHASE',
        'can_manage', v_can_manage
    );
END;
$$;

CREATE OR REPLACE FUNCTION procurement.update_purchase_workflow_policy(
    p_session_token text,
    p_mode text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_is_admin boolean;
    v_mode text := upper(btrim(COALESCE(p_mode, '')));
BEGIN
    SELECT user_id
    INTO v_user_id
    FROM iam.resolve_session(p_session_token);

    SELECT EXISTS (
        SELECT 1
        FROM iam.user_roles user_role
        JOIN iam.roles role ON role.id = user_role.role_id
        WHERE user_role.user_id = v_user_id
          AND role.code = 'ADMIN'
    )
    INTO v_is_admin;

    IF NOT v_is_admin THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: Only an administrator can change the purchasing workflow policy'
            USING ERRCODE = '42501';
    END IF;

    IF v_mode NOT IN ('DIRECT_PURCHASE', 'PURCHASE_ORDER') THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Purchase workflow must be DIRECT_PURCHASE or PURCHASE_ORDER'
            USING ERRCODE = '22023';
    END IF;

    INSERT INTO core.system_settings (setting_key, setting_value, updated_at)
    VALUES ('purchase_workflow_mode', v_mode, now())
    ON CONFLICT (setting_key) DO UPDATE
        SET setting_value = EXCLUDED.setting_value,
            updated_at = EXCLUDED.updated_at;

    -- Keep the pre-existing compatibility flag synchronized because the
    -- direct-purchase posting function and older clients still read it.
    INSERT INTO core.system_settings (setting_key, setting_value, updated_at)
    VALUES (
        'simplified_purchase_entry',
        CASE WHEN v_mode = 'DIRECT_PURCHASE' THEN 'true' ELSE 'false' END,
        now()
    )
    ON CONFLICT (setting_key) DO UPDATE
        SET setting_value = EXCLUDED.setting_value,
            updated_at = EXCLUDED.updated_at;

    RETURN procurement.get_purchase_workflow_policy(p_session_token);
END;
$$;

REVOKE ALL ON FUNCTION procurement.get_purchase_workflow_policy(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION procurement.update_purchase_workflow_policy(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION procurement.get_purchase_workflow_policy(text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION procurement.update_purchase_workflow_policy(text,text) TO stockiha_runtime;

UPDATE operations.schema_state
SET migration_version = 20260816161000,
    updated_at = now()
WHERE singleton;

RESET ROLE;
