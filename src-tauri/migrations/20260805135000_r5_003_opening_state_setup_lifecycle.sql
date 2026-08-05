-- R5-003 lifecycle correction: opening state is a one-time, optional,
-- administrator/CEO-controlled setup step rather than a permanent daily module.
SET ROLE stockiha_owner;

ALTER TABLE onboarding.feature_settings
    ADD COLUMN opening_state_setup_status text NOT NULL DEFAULT 'PENDING';

ALTER TABLE onboarding.feature_settings
    ADD CONSTRAINT feature_settings_opening_state_setup_status_valid
    CHECK (opening_state_setup_status IN ('PENDING', 'DEFERRED', 'DECLINED', 'COMPLETED'));

ALTER TABLE onboarding.feature_settings
    ADD CONSTRAINT feature_settings_completed_opening_state_disabled
    CHECK (NOT (
        opening_state_setup_status IN ('DECLINED', 'COMPLETED')
        AND opening_state_reconciliation_enabled
    ));

-- Existing databases that already contain an approved package are complete.
UPDATE onboarding.feature_settings
SET opening_state_setup_status = 'COMPLETED',
    opening_state_reconciliation_enabled = false,
    updated_at = now()
WHERE singleton
  AND EXISTS (
      SELECT 1
      FROM onboarding.opening_state_packages p
      WHERE p.status = 'APPROVED_FOR_APPLICATION'
  );

ALTER TABLE onboarding.opening_state_audit
    DROP CONSTRAINT opening_state_audit_action_valid;

ALTER TABLE onboarding.opening_state_audit
    ADD CONSTRAINT opening_state_audit_action_valid CHECK (action_code IN (
        'CREATED',
        'DATA_REPLACED',
        'VALIDATED',
        'APPROVED',
        'REJECTED',
        'SETTING_CHANGED',
        'SETUP_DEFERRED',
        'SETUP_DECLINED',
        'SETUP_COMPLETED'
    ));

-- Future CEO role support is automatic when such a role exists. ADMIN remains
-- the current concrete privileged role.
INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM iam.roles r
CROSS JOIN iam.permissions p
WHERE r.code IN ('ADMIN', 'CEO')
  AND p.code IN (
      'MANAGE_OPENING_STATE_RECONCILIATION',
      'REVIEW_OPENING_STATE_RECONCILIATION'
  )
ON CONFLICT DO NOTHING;

CREATE FUNCTION onboarding.get_opening_state_onboarding_status(
    p_session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_status text;
    v_enabled boolean;
    v_has_approved boolean;
BEGIN
    PERFORM 1
    FROM iam.resolve_session_with_permission(
        p_session_token,
        'MANAGE_OPENING_STATE_RECONCILIATION'
    );

    SELECT opening_state_setup_status,
           opening_state_reconciliation_enabled
    INTO v_status, v_enabled
    FROM onboarding.feature_settings
    WHERE singleton;

    SELECT EXISTS (
        SELECT 1
        FROM onboarding.opening_state_packages p
        WHERE p.status = 'APPROVED_FOR_APPLICATION'
    ) INTO v_has_approved;

    RETURN jsonb_build_object(
        'status', v_status,
        'enabled', v_enabled,
        'hasApprovedPackage', v_has_approved,
        'showDeferredAccess', (
            v_status IN ('PENDING', 'DEFERRED')
            AND v_enabled
            AND NOT v_has_approved
        )
    );
END;
$$;

CREATE FUNCTION onboarding.set_opening_state_onboarding_choice(
    p_session_token text,
    p_choice text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_actor_id bigint;
    v_workstation_id text;
    v_current_status text;
    v_choice text;
    v_has_approved boolean;
    v_is_replay boolean;
BEGIN
    SELECT user_id, workstation_id
    INTO v_actor_id, v_workstation_id
    FROM iam.resolve_session_with_permission(
        p_session_token,
        'MANAGE_OPENING_STATE_RECONCILIATION'
    );

    v_choice := upper(btrim(COALESCE(p_choice, '')));
    IF v_choice NOT IN ('DEFERRED', 'DECLINED') THEN
        RAISE EXCEPTION 'opening-state setup choice must be DEFERRED or DECLINED'
            USING ERRCODE = '22023';
    END IF;

    SELECT opening_state_setup_status
    INTO v_current_status
    FROM onboarding.feature_settings
    WHERE singleton
    FOR UPDATE;

    SELECT EXISTS (
        SELECT 1
        FROM onboarding.opening_state_packages p
        WHERE p.status = 'APPROVED_FOR_APPLICATION'
    ) INTO v_has_approved;

    IF v_has_approved OR v_current_status = 'COMPLETED' THEN
        RAISE EXCEPTION 'opening state is already completed'
            USING ERRCODE = '55000';
    END IF;

    IF v_current_status = 'DECLINED' AND v_choice <> 'DECLINED' THEN
        RAISE EXCEPTION 'opening-state setup was declined'
            USING ERRCODE = '55000';
    END IF;

    v_is_replay := v_current_status = v_choice;

    IF NOT v_is_replay THEN
        UPDATE onboarding.feature_settings
        SET opening_state_setup_status = v_choice,
            opening_state_reconciliation_enabled = (v_choice = 'DEFERRED'),
            updated_by = v_actor_id,
            updated_at = now()
        WHERE singleton;

        INSERT INTO onboarding.opening_state_audit (
            package_id,
            action_code,
            actor_id,
            workstation_id,
            from_status,
            to_status,
            reason
        ) VALUES (
            NULL,
            CASE v_choice
                WHEN 'DEFERRED' THEN 'SETUP_DEFERRED'
                ELSE 'SETUP_DECLINED'
            END,
            v_actor_id,
            v_workstation_id,
            v_current_status,
            v_choice,
            CASE v_choice
                WHEN 'DEFERRED' THEN 'Opening state postponed during initial setup'
                ELSE 'Opening state explicitly declined during setup'
            END
        );
    END IF;

    RETURN jsonb_build_object(
        'status', v_choice,
        'enabled', (v_choice = 'DEFERRED'),
        'hasApprovedPackage', false,
        'showDeferredAccess', (v_choice = 'DEFERRED'),
        'isReplay', v_is_replay
    );
END;
$$;

CREATE FUNCTION onboarding.mark_opening_state_setup_completed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_previous_status text;
BEGIN
    IF NEW.status = 'APPROVED_FOR_APPLICATION'
       AND OLD.status IS DISTINCT FROM NEW.status THEN
        SELECT opening_state_setup_status
        INTO v_previous_status
        FROM onboarding.feature_settings
        WHERE singleton
        FOR UPDATE;

        UPDATE onboarding.feature_settings
        SET opening_state_setup_status = 'COMPLETED',
            opening_state_reconciliation_enabled = false,
            updated_by = NEW.approved_by,
            updated_at = now()
        WHERE singleton;

        INSERT INTO onboarding.opening_state_audit (
            package_id,
            action_code,
            actor_id,
            workstation_id,
            from_status,
            to_status,
            reason
        ) VALUES (
            NEW.id,
            'SETUP_COMPLETED',
            NEW.approved_by,
            NEW.workstation_id,
            v_previous_status,
            'COMPLETED',
            'Approved opening-state package completed the one-time setup step'
        );
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER opening_state_packages_complete_setup
    AFTER UPDATE OF status ON onboarding.opening_state_packages
    FOR EACH ROW
    EXECUTE FUNCTION onboarding.mark_opening_state_setup_completed();

REVOKE ALL ON FUNCTION onboarding.get_opening_state_onboarding_status(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION onboarding.set_opening_state_onboarding_choice(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION onboarding.mark_opening_state_setup_completed() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION onboarding.get_opening_state_onboarding_status(text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION onboarding.set_opening_state_onboarding_choice(text, text) TO stockiha_runtime;

UPDATE operations.schema_state
SET migration_version = 20260805135000,
    updated_at = now()
WHERE singleton;

RESET ROLE;
