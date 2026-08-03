-- R6-001: database-authoritative recovery permissions and immutable request audit.
--
-- This migration does not expose restore. It authorizes only backup creation
-- and read-only backup validation, and records safe operation metadata without
-- credentials, connection strings, unrestricted filesystem paths, or process
-- diagnostics.
SET ROLE stockiha_owner;

CREATE SCHEMA IF NOT EXISTS operations AUTHORIZATION stockiha_owner;
REVOKE ALL ON SCHEMA operations FROM PUBLIC;
GRANT USAGE ON SCHEMA operations TO stockiha_runtime;

-- Extend the closed permission vocabulary without reconstructing the complete
-- accumulated CHECK expression from older migrations.
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
        'ALTER TABLE iam.permissions ADD CONSTRAINT permissions_code_valid CHECK ((%s) OR code = ANY (ARRAY[%L,%L]::text[]))',
        v_existing_check,
        'CREATE_BACKUP_BUNDLE',
        'VALIDATE_BACKUP_BUNDLE'
    );
END;
$$;

INSERT INTO iam.permissions (code, name) VALUES
    ('CREATE_BACKUP_BUNDLE', 'Create an operator backup bundle'),
    ('VALIDATE_BACKUP_BUNDLE', 'Validate an operator backup bundle')
ON CONFLICT (code) DO NOTHING;

-- Recovery permissions are deliberately administrator-only in R6-001. The
-- future explicit CEO role may inherit them through a forward migration.
INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM iam.roles r
CROSS JOIN iam.permissions p
WHERE r.code = 'ADMIN'
  AND p.code IN ('CREATE_BACKUP_BUNDLE', 'VALIDATE_BACKUP_BUNDLE')
ON CONFLICT DO NOTHING;

-- SQL files are verified both through SQLx and by direct psql execution in CI.
-- Therefore recovery metadata must not depend on SQLx's private bookkeeping
-- table being present or readable. Every later forward migration that changes
-- the recoverable schema must update this singleton in the same transaction.
CREATE TABLE operations.schema_state (
    singleton          boolean PRIMARY KEY DEFAULT true,
    migration_version  bigint NOT NULL,
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT schema_state_singleton CHECK (singleton)
);

INSERT INTO operations.schema_state (singleton, migration_version)
VALUES (true, 20260803193000)
ON CONFLICT (singleton) DO UPDATE
SET migration_version = EXCLUDED.migration_version,
    updated_at = now();

REVOKE ALL ON operations.schema_state FROM PUBLIC;
REVOKE ALL ON operations.schema_state FROM stockiha_runtime;

CREATE TABLE operations.recovery_attempts (
    id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    request_id         text NOT NULL,
    operation_code     text NOT NULL,
    actor_id           bigint NOT NULL REFERENCES iam.users(id) ON DELETE RESTRICT,
    workstation_id     text NOT NULL,
    bundle_identifier  text NOT NULL,
    status             text NOT NULL DEFAULT 'STARTED',
    error_code         text,
    result_json        jsonb,
    started_at         timestamptz NOT NULL DEFAULT now(),
    completed_at       timestamptz,
    CONSTRAINT recovery_attempts_request_unique UNIQUE (request_id),
    CONSTRAINT recovery_attempts_request_not_blank CHECK (btrim(request_id) <> ''),
    CONSTRAINT recovery_attempts_request_length CHECK (length(request_id) BETWEEN 8 AND 128),
    CONSTRAINT recovery_attempts_operation_valid CHECK (
        operation_code IN ('CREATE_BACKUP', 'VALIDATE_BACKUP')
    ),
    CONSTRAINT recovery_attempts_workstation_not_blank CHECK (btrim(workstation_id) <> ''),
    CONSTRAINT recovery_attempts_bundle_not_blank CHECK (btrim(bundle_identifier) <> ''),
    CONSTRAINT recovery_attempts_bundle_length CHECK (length(bundle_identifier) <= 255),
    CONSTRAINT recovery_attempts_status_valid CHECK (
        status IN ('STARTED', 'SUCCEEDED', 'FAILED')
    ),
    CONSTRAINT recovery_attempts_completion_consistent CHECK (
        (status = 'STARTED' AND completed_at IS NULL AND error_code IS NULL AND result_json IS NULL)
        OR
        (status = 'SUCCEEDED' AND completed_at IS NOT NULL AND error_code IS NULL AND result_json IS NOT NULL)
        OR
        (status = 'FAILED' AND completed_at IS NOT NULL AND error_code IS NOT NULL AND result_json IS NULL)
    )
);

CREATE INDEX recovery_attempts_started_at_idx
    ON operations.recovery_attempts (started_at DESC);

REVOKE ALL ON operations.recovery_attempts FROM PUBLIC;
REVOKE ALL ON operations.recovery_attempts FROM stockiha_runtime;

CREATE FUNCTION operations.begin_recovery_attempt(
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
    WHERE request_id = p_request_id;

    IF FOUND THEN
        IF v_existing.actor_id <> v_actor_id
           OR v_existing.operation_code <> p_operation_code
           OR v_existing.bundle_identifier <> p_bundle_identifier THEN
            RAISE EXCEPTION 'recovery request id conflicts with an existing request'
                USING ERRCODE = '23505';
        END IF;

        RETURN jsonb_build_object(
            'attempt_id', v_existing.id,
            'is_replay', true,
            'status', v_existing.status,
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
        'error_code', NULL,
        'result', NULL,
        'current_schema_version', v_schema_version
    );
END;
$$;

CREATE FUNCTION operations.complete_recovery_attempt(
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

REVOKE ALL ON FUNCTION operations.begin_recovery_attempt(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.complete_recovery_attempt(text, bigint, boolean, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION operations.begin_recovery_attempt(text, text, text, text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION operations.complete_recovery_attempt(text, bigint, boolean, text, jsonb) TO stockiha_runtime;

RESET ROLE;
