-- R6-002: CEO/administrator-controlled restore-verification feature toggle.
-- Default ON. Disabling blocks new temporary restore drills while preserving
-- immutable historical results and audit evidence.
SET ROLE stockiha_owner;

CREATE TABLE operations.recovery_settings (
    singleton                    boolean PRIMARY KEY DEFAULT true,
    restore_verification_enabled boolean NOT NULL DEFAULT true,
    updated_by                   bigint REFERENCES iam.users(id) ON DELETE RESTRICT,
    updated_at                   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT recovery_settings_singleton CHECK (singleton)
);

INSERT INTO operations.recovery_settings (singleton, restore_verification_enabled)
VALUES (true, true)
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE operations.recovery_setting_audit (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    setting_code   text NOT NULL,
    previous_value boolean NOT NULL,
    new_value      boolean NOT NULL,
    actor_id       bigint NOT NULL REFERENCES iam.users(id) ON DELETE RESTRICT,
    workstation_id text NOT NULL,
    occurred_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT recovery_setting_audit_code_valid CHECK (
        setting_code = 'RESTORE_VERIFICATION_ENABLED'
    ),
    CONSTRAINT recovery_setting_audit_workstation_not_blank CHECK (
        btrim(workstation_id) <> ''
    )
);

CREATE FUNCTION operations.get_restore_verification_setting(
    p_session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_enabled boolean;
BEGIN
    PERFORM 1
    FROM iam.resolve_session_with_permission(p_session_token, 'VERIFY_BACKUP_RESTORE');

    SELECT restore_verification_enabled
    INTO v_enabled
    FROM operations.recovery_settings
    WHERE singleton;

    RETURN jsonb_build_object('enabled', v_enabled);
END;
$$;

CREATE FUNCTION operations.update_restore_verification_setting(
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
    v_previous boolean;
BEGIN
    SELECT user_id, workstation_id
    INTO v_actor_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'VERIFY_BACKUP_RESTORE');

    SELECT restore_verification_enabled
    INTO v_previous
    FROM operations.recovery_settings
    WHERE singleton
    FOR UPDATE;

    UPDATE operations.recovery_settings
    SET restore_verification_enabled = p_enabled,
        updated_by = v_actor_id,
        updated_at = now()
    WHERE singleton;

    IF v_previous IS DISTINCT FROM p_enabled THEN
        INSERT INTO operations.recovery_setting_audit (
            setting_code,
            previous_value,
            new_value,
            actor_id,
            workstation_id
        ) VALUES (
            'RESTORE_VERIFICATION_ENABLED',
            v_previous,
            p_enabled,
            v_actor_id,
            v_workstation_id
        );
    END IF;

    RETURN jsonb_build_object('enabled', p_enabled);
END;
$$;

CREATE FUNCTION operations.enforce_restore_verification_enabled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_enabled boolean;
BEGIN
    IF NEW.operation_code <> 'VERIFY_RESTORE' THEN
        RETURN NEW;
    END IF;

    SELECT restore_verification_enabled
    INTO v_enabled
    FROM operations.recovery_settings
    WHERE singleton;

    IF NOT COALESCE(v_enabled, false) THEN
        RAISE EXCEPTION 'restore verification is disabled by policy'
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER recovery_attempts_restore_setting_guard
    BEFORE INSERT ON operations.recovery_attempts
    FOR EACH ROW
    EXECUTE FUNCTION operations.enforce_restore_verification_enabled();

REVOKE ALL ON TABLE operations.recovery_settings, operations.recovery_setting_audit FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.get_restore_verification_setting(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.update_restore_verification_setting(text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.enforce_restore_verification_enabled() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION operations.get_restore_verification_setting(text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION operations.update_restore_verification_setting(text, boolean) TO stockiha_runtime;

GRANT SELECT ON operations.recovery_settings, operations.recovery_setting_audit TO stockiha_backup;

UPDATE operations.schema_state
SET migration_version = 20260805151000,
    updated_at = now()
WHERE singleton;

RESET ROLE;
