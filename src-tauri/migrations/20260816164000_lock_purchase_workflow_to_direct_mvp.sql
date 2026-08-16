-- Lock the MVP purchasing policy to Direct Purchase.
--
-- The previous migration introduced a future-facing persisted policy and an
-- administrator mutation function. The advanced Purchase Order workflow is not
-- an active MVP policy, so runtime users must not be able to switch new
-- transactions into that unfinished mode. Historical Purchase Orders and their
-- posting functions remain intact for future work and audit compatibility.

SET ROLE stockiha_owner;

INSERT INTO core.system_settings (setting_key, setting_value, updated_at)
VALUES ('purchase_workflow_mode', 'DIRECT_PURCHASE', now())
ON CONFLICT (setting_key) DO UPDATE
SET setting_value = 'DIRECT_PURCHASE',
    updated_at = EXCLUDED.updated_at;

-- Preserve the compatibility flag consumed by the existing single-entry
-- purchase contract, but force it to the Direct Purchase meaning for MVP.
INSERT INTO core.system_settings (setting_key, setting_value, updated_at)
VALUES ('simplified_purchase_entry', 'true', now())
ON CONFLICT (setting_key) DO UPDATE
SET setting_value = 'true',
    updated_at = EXCLUDED.updated_at;

-- Keep the read contract available for compatibility, but make the returned
-- mode authoritative and non-selectable during MVP.
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
BEGIN
    SELECT user_id
    INTO v_user_id
    FROM iam.resolve_session(p_session_token);

    RETURN jsonb_build_object(
        'mode', 'DIRECT_PURCHASE',
        'direct_purchase_enabled', true,
        'can_manage', false
    );
END;
$$;

-- Retain the function signature so stale clients fail explicitly instead of
-- encountering a missing-function error, but do not permit policy mutation.
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
BEGIN
    SELECT user_id
    INTO v_user_id
    FROM iam.resolve_session(p_session_token);

    RAISE EXCEPTION 'PRECONDITION_FAILED: Direct Purchase is the only active purchasing workflow in the MVP'
        USING ERRCODE = '55000';
END;
$$;

REVOKE ALL ON FUNCTION procurement.get_purchase_workflow_policy(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION procurement.update_purchase_workflow_policy(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION procurement.get_purchase_workflow_policy(text) TO stockiha_runtime;
REVOKE EXECUTE ON FUNCTION procurement.update_purchase_workflow_policy(text,text) FROM stockiha_runtime;

UPDATE operations.schema_state
SET migration_version = 20260816164000,
    updated_at = now()
WHERE singleton;

RESET ROLE;
