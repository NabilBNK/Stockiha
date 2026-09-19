-- WS-H-3: embedded backup & recovery foundation (used by WS-H-3..WS-H-6).
-- Fully idempotent by design: the WS-K-5 safe-upgrade integration fixture
-- re-applies the newest migration after deleting its bookkeeping row.
SET ROLE stockiha_owner;

-- 1. Permission vocabulary: add RESTORE_BACKUP_LIVE (guarded).
DO $$
DECLARE v_existing_check text;
BEGIN
    SELECT pg_get_expr(c.conbin, c.conrelid) INTO v_existing_check
    FROM pg_constraint c
    WHERE c.conrelid = 'iam.permissions'::regclass
      AND c.conname = 'permissions_code_valid' AND c.contype = 'c';
    IF v_existing_check IS NULL THEN
        RAISE EXCEPTION 'expected iam.permissions constraint permissions_code_valid is missing';
    END IF;
    IF position('RESTORE_BACKUP_LIVE' in v_existing_check) = 0 THEN
        ALTER TABLE iam.permissions DROP CONSTRAINT permissions_code_valid;
        EXECUTE format(
            'ALTER TABLE iam.permissions ADD CONSTRAINT permissions_code_valid CHECK ((%s) OR code = %L)',
            v_existing_check, 'RESTORE_BACKUP_LIVE');
    END IF;
END;
$$;

INSERT INTO iam.permissions (code, name)
VALUES ('RESTORE_BACKUP_LIVE', 'Replace live data with a backup')
ON CONFLICT (code) DO NOTHING;

INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM iam.roles r CROSS JOIN iam.permissions p
WHERE r.code IN ('ADMIN', 'SUPER_ADMIN') AND p.code = 'RESTORE_BACKUP_LIVE'
ON CONFLICT DO NOTHING;

-- 2. Operation vocabulary.
ALTER TABLE operations.recovery_attempts
    DROP CONSTRAINT IF EXISTS recovery_attempts_operation_valid;
ALTER TABLE operations.recovery_attempts
    ADD CONSTRAINT recovery_attempts_operation_valid CHECK (
        operation_code IN ('CREATE_BACKUP','VALIDATE_BACKUP','VERIFY_RESTORE','AUTO_BACKUP','RESTORE_LIVE'));

CREATE UNIQUE INDEX IF NOT EXISTS recovery_attempts_any_create_bundle_unique
    ON operations.recovery_attempts (bundle_identifier)
    WHERE operation_code IN ('CREATE_BACKUP', 'AUTO_BACKUP');

-- 3. Restore event log (no FKs: users differ between backup and replaced data).
CREATE TABLE IF NOT EXISTS operations.restore_events (
    id                        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    occurred_at               timestamptz NOT NULL DEFAULT now(),
    restore_mode              text NOT NULL CHECK (restore_mode IN ('LIVE','FRESH_INSTALL')),
    bundle_identifier         text NOT NULL CHECK (length(bundle_identifier) BETWEEN 1 AND 255),
    backup_kind               text NOT NULL,
    bundle_schema_version     text NOT NULL,
    restored_schema_version   text NOT NULL,
    migrated_forward          boolean NOT NULL,
    actor_username            text,
    workstation_id            text,
    safety_bundle_identifier  text
);
REVOKE ALL ON operations.restore_events FROM PUBLIC;
REVOKE ALL ON operations.restore_events FROM stockiha_runtime;
GRANT SELECT ON operations.restore_events TO stockiha_backup;

-- 4. begin_recovery_attempt: body verbatim from
--    20260803193000_r6_001_recovery_authorization_audit.sql; only the
--    operation -> permission CASE gains RESTORE_LIVE. The replay-conflict
--    condition already binds every non-CREATE operation to its bundle.
CREATE OR REPLACE FUNCTION operations.begin_recovery_attempt(
    p_session_token text,
    p_request_id text,
    p_operation_code text,
    p_bundle_identifier text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_permission_code text;
    v_actor_id bigint;
    v_workstation_id text;
    v_existing operations.recovery_attempts%ROWTYPE;
    v_attempt_id bigint;
    v_schema_version text;
BEGIN
    IF p_request_id IS NULL OR length(btrim(p_request_id)) NOT BETWEEN 8 AND 128 THEN
        RAISE EXCEPTION 'invalid recovery request id' USING ERRCODE = '22023';
    END IF;
    IF p_bundle_identifier IS NULL
       OR btrim(p_bundle_identifier) = ''
       OR length(p_bundle_identifier) > 255 THEN
        RAISE EXCEPTION 'invalid recovery bundle identifier' USING ERRCODE = '22023';
    END IF;

    v_permission_code := CASE p_operation_code
        WHEN 'CREATE_BACKUP' THEN 'CREATE_BACKUP_BUNDLE'
        WHEN 'VALIDATE_BACKUP' THEN 'VALIDATE_BACKUP_BUNDLE'
        WHEN 'RESTORE_LIVE' THEN 'RESTORE_BACKUP_LIVE'
        ELSE NULL
    END;
    IF v_permission_code IS NULL THEN
        RAISE EXCEPTION 'invalid recovery operation' USING ERRCODE = '22023';
    END IF;

    SELECT user_id, workstation_id
    INTO v_actor_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, v_permission_code);

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
        -- Validation is bound to the caller-selected existing bundle. Creation
        -- is different: a retry may calculate a new clock-based candidate,
        -- but it must resume the original database-owned bundle identifier.
        IF v_existing.actor_id <> v_actor_id
           OR v_existing.operation_code <> p_operation_code
           OR (
               v_existing.operation_code <> 'CREATE_BACKUP'
               AND v_existing.bundle_identifier <> btrim(p_bundle_identifier)
           ) THEN
            RAISE EXCEPTION 'recovery request id conflicts with an existing request'
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
        p_operation_code,
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

-- 5. complete_recovery_attempt: body verbatim from R6-001; CASE extended
--    identically.
CREATE OR REPLACE FUNCTION operations.complete_recovery_attempt(
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
    v_permission_code text;
    v_actor_id bigint;
    v_workstation_id text;
BEGIN
    SELECT *
    INTO v_existing
    FROM operations.recovery_attempts
    WHERE id = p_attempt_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'unknown recovery attempt' USING ERRCODE = '22023';
    END IF;

    v_permission_code := CASE v_existing.operation_code
        WHEN 'CREATE_BACKUP' THEN 'CREATE_BACKUP_BUNDLE'
        WHEN 'VALIDATE_BACKUP' THEN 'VALIDATE_BACKUP_BUNDLE'
        WHEN 'RESTORE_LIVE' THEN 'RESTORE_BACKUP_LIVE'
        ELSE NULL
    END;

    SELECT user_id, workstation_id
    INTO v_actor_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, v_permission_code);

    IF v_existing.actor_id <> v_actor_id
       OR v_existing.workstation_id <> v_workstation_id THEN
        RAISE EXCEPTION 'recovery attempt belongs to another actor or workstation'
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
            RAISE EXCEPTION 'successful recovery completion requires result metadata only'
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
            RAISE EXCEPTION 'failed recovery completion requires one stable error code'
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

-- 6. Automatic backups (DAILY / PRE_UPDATE) are system-initiated: any valid
--    session may begin one (`iam.resolve_session`, no permission), and only
--    the same actor may complete it. Same envelope as begin_recovery_attempt.
CREATE OR REPLACE FUNCTION operations.begin_automatic_backup_attempt(
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
        RAISE EXCEPTION 'invalid recovery request id' USING ERRCODE = '22023';
    END IF;
    IF p_bundle_identifier IS NULL
       OR btrim(p_bundle_identifier) = ''
       OR length(p_bundle_identifier) > 255 THEN
        RAISE EXCEPTION 'invalid recovery bundle identifier' USING ERRCODE = '22023';
    END IF;

    SELECT user_id, workstation_id
    INTO v_actor_id, v_workstation_id
    FROM iam.resolve_session(p_session_token);

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
           OR v_existing.operation_code <> 'AUTO_BACKUP' THEN
            RAISE EXCEPTION 'recovery request id conflicts with an existing request'
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
        'AUTO_BACKUP',
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

-- 7. Completion of an automatic backup attempt (same actor and workstation).
CREATE OR REPLACE FUNCTION operations.complete_automatic_backup_attempt(
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

    IF NOT FOUND OR v_existing.operation_code <> 'AUTO_BACKUP' THEN
        RAISE EXCEPTION 'unknown automatic backup attempt' USING ERRCODE = '22023';
    END IF;

    SELECT user_id, workstation_id
    INTO v_actor_id, v_workstation_id
    FROM iam.resolve_session(p_session_token);

    IF v_existing.actor_id <> v_actor_id
       OR v_existing.workstation_id <> v_workstation_id THEN
        RAISE EXCEPTION 'automatic backup attempt belongs to another actor or workstation'
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
            RAISE EXCEPTION 'successful automatic backup requires result metadata only'
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
            RAISE EXCEPTION 'failed automatic backup requires one stable error code'
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

-- 8. Backup status line (any valid session).
CREATE OR REPLACE FUNCTION operations.get_backup_status(p_session_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM iam.resolve_session(p_session_token);

    RETURN jsonb_build_object(
      'last_success_at', (SELECT max(completed_at) FROM operations.recovery_attempts
                          WHERE status = 'SUCCEEDED' AND operation_code IN ('CREATE_BACKUP','AUTO_BACKUP')),
      'last_success_bundle', (SELECT bundle_identifier FROM operations.recovery_attempts
                          WHERE status = 'SUCCEEDED' AND operation_code IN ('CREATE_BACKUP','AUTO_BACKUP')
                          ORDER BY completed_at DESC, id DESC LIMIT 1),
      'last_failure_at', (SELECT max(completed_at) FROM operations.recovery_attempts
                          WHERE status = 'FAILED' AND operation_code IN ('CREATE_BACKUP','AUTO_BACKUP')),
      'last_failure_code', (SELECT error_code FROM operations.recovery_attempts
                          WHERE status = 'FAILED' AND operation_code IN ('CREATE_BACKUP','AUTO_BACKUP')
                          ORDER BY completed_at DESC, id DESC LIMIT 1),
      'last_restore_at', (SELECT max(occurred_at) FROM operations.restore_events),
      'last_restore_bundle', (SELECT bundle_identifier FROM operations.restore_events
                          ORDER BY occurred_at DESC, id DESC LIMIT 1)
    );
END;
$$;

-- 9. Recovery capabilities (any valid session; same shape as
--    inventory.get_capabilities).
CREATE OR REPLACE FUNCTION operations.get_recovery_capabilities(p_session_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
BEGIN
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session(p_session_token);

    RETURN jsonb_build_object(
        'can_create_backup', EXISTS (
            SELECT 1
            FROM iam.user_roles ur
            JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
            JOIN iam.permissions permission ON permission.id = rp.permission_id
            WHERE ur.user_id = v_user_id
              AND permission.code = 'CREATE_BACKUP_BUNDLE'
        ),
        'can_validate_backup', EXISTS (
            SELECT 1
            FROM iam.user_roles ur
            JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
            JOIN iam.permissions permission ON permission.id = rp.permission_id
            WHERE ur.user_id = v_user_id
              AND permission.code = 'VALIDATE_BACKUP_BUNDLE'
        ),
        'can_verify_restore', EXISTS (
            SELECT 1
            FROM iam.user_roles ur
            JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
            JOIN iam.permissions permission ON permission.id = rp.permission_id
            WHERE ur.user_id = v_user_id
              AND permission.code = 'VERIFY_BACKUP_RESTORE'
        ),
        'can_restore_live', EXISTS (
            SELECT 1
            FROM iam.user_roles ur
            JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
            JOIN iam.permissions permission ON permission.id = rp.permission_id
            WHERE ur.user_id = v_user_id
              AND permission.code = 'RESTORE_BACKUP_LIVE'
        )
    );
END;
$$;

-- 10. Grants.
REVOKE ALL ON FUNCTION operations.begin_automatic_backup_attempt(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.complete_automatic_backup_attempt(text, bigint, boolean, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.get_backup_status(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.get_recovery_capabilities(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION operations.begin_automatic_backup_attempt(text, text, text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION operations.complete_automatic_backup_attempt(text, bigint, boolean, text, jsonb) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION operations.get_backup_status(text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION operations.get_recovery_capabilities(text) TO stockiha_runtime;
-- begin/complete_recovery_attempt keep their existing grants (CREATE OR REPLACE preserves them).

-- 11. Schema state.
UPDATE operations.schema_state SET migration_version = 20260916100000, updated_at = now() WHERE singleton;
RESET ROLE;
