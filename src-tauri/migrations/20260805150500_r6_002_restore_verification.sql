-- R6-002: administrator-only temporary restore verification.
--
-- This migration authorizes a recovery drill that restores one validated
-- Stockiha bundle into a generated throwaway PostgreSQL database, records a
-- redacted result, and requires the application to remove the temporary
-- database before reporting success. It does not authorize replacement of the
-- live database.
SET ROLE stockiha_owner;

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
        'ALTER TABLE iam.permissions ADD CONSTRAINT permissions_code_valid CHECK ((%s) OR code = %L)',
        v_existing_check,
        'VERIFY_BACKUP_RESTORE'
    );
END;
$$;

INSERT INTO iam.permissions (code, name)
VALUES ('VERIFY_BACKUP_RESTORE', 'Verify a backup through a temporary restore drill')
ON CONFLICT (code) DO NOTHING;

INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM iam.roles r
CROSS JOIN iam.permissions p
WHERE r.code IN ('ADMIN', 'CEO')
  AND p.code = 'VERIFY_BACKUP_RESTORE'
ON CONFLICT DO NOTHING;

ALTER TABLE operations.recovery_attempts
    DROP CONSTRAINT recovery_attempts_operation_valid;
ALTER TABLE operations.recovery_attempts
    ADD CONSTRAINT recovery_attempts_operation_valid CHECK (
        operation_code IN ('CREATE_BACKUP', 'VALIDATE_BACKUP', 'VERIFY_RESTORE')
    );

CREATE FUNCTION operations.begin_restore_verification_attempt(
    p_session_token text,
    p_request_id text,
    p_bundle_identifier text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_actor_id bigint;
    v_workstation_id text;
    v_existing operations.recovery_attempts%ROWTYPE;
    v_attempt_id bigint;
    v_schema_version text;
BEGIN
    IF p_request_id IS NULL OR length(btrim(p_request_id)) NOT BETWEEN 8 AND 128 THEN
        RAISE EXCEPTION 'invalid restore verification request id' USING ERRCODE = '22023';
    END IF;
    IF p_bundle_identifier IS NULL
       OR btrim(p_bundle_identifier) = ''
       OR length(p_bundle_identifier) > 255 THEN
        RAISE EXCEPTION 'invalid restore verification bundle identifier' USING ERRCODE = '22023';
    END IF;

    SELECT user_id, workstation_id
    INTO v_actor_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'VERIFY_BACKUP_RESTORE');

    SELECT migration_version::text
    INTO v_schema_version
    FROM operations.schema_state
    WHERE singleton;

    IF v_schema_version IS NULL THEN
        RAISE EXCEPTION 'recovery schema version is not configured'
            USING ERRCODE = '55000';
    END IF;

    SELECT *
    INTO v_existing
    FROM operations.recovery_attempts
    WHERE request_id = btrim(p_request_id);

    IF FOUND THEN
        IF v_existing.actor_id <> v_actor_id
           OR v_existing.operation_code <> 'VERIFY_RESTORE'
           OR v_existing.bundle_identifier <> btrim(p_bundle_identifier) THEN
            RAISE EXCEPTION 'restore verification request id conflicts with an existing request'
                USING ERRCODE = '23505';
        END IF;

        RETURN jsonb_build_object(
            'attempt_id', v_existing.id,
            'is_replay', true,
            'status', v_existing.status,
            'bundle_identifier', v_existing.bundle_identifier,
            'error_code', v_existing.error_code,
            'result', v_existing.result_json,
            'current_schema_version', v_schema_version
        );
    END IF;

    INSERT INTO operations.recovery_attempts (
        request_id,
        operation_code,
        actor_id,
        workstation_id,
        bundle_identifier
    ) VALUES (
        btrim(p_request_id),
        'VERIFY_RESTORE',
        v_actor_id,
        v_workstation_id,
        btrim(p_bundle_identifier)
    )
    RETURNING id INTO v_attempt_id;

    RETURN jsonb_build_object(
        'attempt_id', v_attempt_id,
        'is_replay', false,
        'status', 'STARTED',
        'bundle_identifier', btrim(p_bundle_identifier),
        'error_code', NULL,
        'result', NULL,
        'current_schema_version', v_schema_version
    );
END;
$$;

CREATE FUNCTION operations.complete_restore_verification_attempt(
    p_session_token text,
    p_attempt_id bigint,
    p_succeeded boolean,
    p_error_code text,
    p_result_json jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_existing operations.recovery_attempts%ROWTYPE;
    v_actor_id bigint;
    v_workstation_id text;
BEGIN
    SELECT *
    INTO v_existing
    FROM operations.recovery_attempts
    WHERE id = p_attempt_id
    FOR UPDATE;

    IF NOT FOUND OR v_existing.operation_code <> 'VERIFY_RESTORE' THEN
        RAISE EXCEPTION 'unknown restore verification attempt' USING ERRCODE = '22023';
    END IF;

    SELECT user_id, workstation_id
    INTO v_actor_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'VERIFY_BACKUP_RESTORE');

    IF v_existing.actor_id <> v_actor_id
       OR v_existing.workstation_id <> v_workstation_id THEN
        RAISE EXCEPTION 'restore verification attempt belongs to another actor or workstation'
            USING ERRCODE = '42501';
    END IF;

    IF v_existing.status <> 'STARTED' THEN
        RETURN jsonb_build_object(
            'attempt_id', v_existing.id,
            'status', v_existing.status,
            'error_code', v_existing.error_code,
            'result', v_existing.result_json
        );
    END IF;

    IF p_succeeded THEN
        IF p_error_code IS NOT NULL OR p_result_json IS NULL THEN
            RAISE EXCEPTION 'successful restore verification requires result metadata only'
                USING ERRCODE = '22023';
        END IF;

        UPDATE operations.recovery_attempts
        SET status = 'SUCCEEDED',
            result_json = p_result_json,
            completed_at = now()
        WHERE id = p_attempt_id;
    ELSE
        IF p_error_code IS NULL
           OR btrim(p_error_code) = ''
           OR length(p_error_code) > 128
           OR p_result_json IS NOT NULL THEN
            RAISE EXCEPTION 'failed restore verification requires one stable error code'
                USING ERRCODE = '22023';
        END IF;

        UPDATE operations.recovery_attempts
        SET status = 'FAILED',
            error_code = btrim(p_error_code),
            completed_at = now()
        WHERE id = p_attempt_id;
    END IF;

    SELECT *
    INTO v_existing
    FROM operations.recovery_attempts
    WHERE id = p_attempt_id;

    RETURN jsonb_build_object(
        'attempt_id', v_existing.id,
        'status', v_existing.status,
        'error_code', v_existing.error_code,
        'result', v_existing.result_json
    );
END;
$$;

REVOKE ALL ON FUNCTION operations.begin_restore_verification_attempt(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.complete_restore_verification_attempt(text, bigint, boolean, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION operations.begin_restore_verification_attempt(text, text, text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION operations.complete_restore_verification_attempt(text, bigint, boolean, text, jsonb) TO stockiha_runtime;

GRANT USAGE ON SCHEMA operations TO stockiha_backup;
GRANT SELECT ON operations.schema_state, operations.recovery_attempts TO stockiha_backup;

UPDATE operations.schema_state
SET migration_version = 20260805150500,
    updated_at = now()
WHERE singleton;

RESET ROLE;
