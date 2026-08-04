-- R0-001: audit the CEO/administrator historical-import toggle.
--
-- Setting changes have no batch, while every batch action must retain its
-- batch identifier. The audit table therefore permits NULL batch_id only for
-- SETTING_CHANGED and preserves the stricter requirement for every other
-- action.
SET ROLE stockiha_owner;

ALTER TABLE onboarding.historical_finance_audit
    ALTER COLUMN batch_id DROP NOT NULL;

ALTER TABLE onboarding.historical_finance_audit
    ADD CONSTRAINT historical_finance_audit_batch_consistent CHECK (
        (action_code = 'SETTING_CHANGED' AND batch_id IS NULL)
        OR
        (action_code <> 'SETTING_CHANGED' AND batch_id IS NOT NULL)
    );

CREATE OR REPLACE FUNCTION onboarding.update_historical_finance_setting(
    p_session_token text,
    p_enabled boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_actor_id bigint;
    v_workstation_id text;
    v_previous_enabled boolean;
BEGIN
    SELECT user_id, workstation_id
    INTO v_actor_id, v_workstation_id
    FROM iam.resolve_session_with_permission(
        p_session_token,
        'MANAGE_HISTORICAL_FINANCE_IMPORT'
    );

    SELECT historical_finance_import_enabled
    INTO v_previous_enabled
    FROM onboarding.feature_settings
    WHERE singleton
    FOR UPDATE;

    UPDATE onboarding.feature_settings
    SET historical_finance_import_enabled = p_enabled,
        updated_by = v_actor_id,
        updated_at = now()
    WHERE singleton;

    IF v_previous_enabled IS DISTINCT FROM p_enabled THEN
        INSERT INTO onboarding.historical_finance_audit (
            batch_id,
            action_code,
            actor_id,
            workstation_id,
            from_status,
            to_status
        ) VALUES (
            NULL,
            'SETTING_CHANGED',
            v_actor_id,
            v_workstation_id,
            v_previous_enabled::text,
            p_enabled::text
        );
    END IF;

    RETURN jsonb_build_object('enabled', p_enabled);
END;
$$;

UPDATE operations.schema_state
SET migration_version = 20260804190000,
    updated_at = now()
WHERE singleton;

RESET ROLE;
