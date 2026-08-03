-- R6-001 recovery authorization/audit regression.
-- Runs inside the transaction owned by run_current_sql_suites.sh.
\set ON_ERROR_STOP on

DO $$
DECLARE
    v_admin_id bigint;
    v_cashier_id bigint;
    v_other_admin_id bigint;
    v_admin_token text := 'r6_001_admin_token';
    v_cashier_token text := 'r6_001_cashier_token';
    v_other_admin_token text := 'r6_001_other_admin_token';
    v_started jsonb;
    v_replay jsonb;
    v_completed jsonb;
    v_failed jsonb;
    v_attempt_id bigint;
    v_failed_attempt_id bigint;
    v_denied boolean := false;
    v_conflict boolean := false;
    v_result jsonb := jsonb_build_object(
        'requestId', 'r6-validate-0001',
        'bundleIdentifier', 'GestStock-Backup-20260803-195700',
        'createdAtLabel', '20260803-195700',
        'applicationVersion', '0.1.0',
        'schemaVersion', '20260803193000',
        'postgresMajorVersion', 18,
        'integrityValid', true,
        'applicationCompatible', true,
        'schemaCompatible', true,
        'postgresCompatible', true,
        'fileCount', 7,
        'totalBytes', 2048
    );
BEGIN
    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES ('r6_001_admin', 'R6 Admin', 'hash')
    RETURNING id INTO v_admin_id;
    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_admin_id, id FROM iam.roles WHERE code = 'ADMIN';
    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_admin_id, 'R6-WKS', sha256(v_admin_token::bytea), now() + interval '1 hour');

    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES ('r6_001_cashier', 'R6 Cashier', 'hash')
    RETURNING id INTO v_cashier_id;
    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_cashier_id, id FROM iam.roles WHERE code = 'CASHIER';
    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_cashier_id, 'R6-CASHIER-WKS', sha256(v_cashier_token::bytea), now() + interval '1 hour');

    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES ('r6_001_other_admin', 'R6 Other Admin', 'hash')
    RETURNING id INTO v_other_admin_id;
    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_other_admin_id, id FROM iam.roles WHERE code = 'ADMIN';
    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (
        v_other_admin_id,
        'R6-OTHER-WKS',
        sha256(v_other_admin_token::bytea),
        now() + interval '1 hour'
    );

    ASSERT EXISTS (
        SELECT 1
        FROM iam.user_roles ur
        JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
        JOIN iam.permissions p ON p.id = rp.permission_id
        WHERE ur.user_id = v_admin_id
          AND p.code IN ('CREATE_BACKUP_BUNDLE', 'VALIDATE_BACKUP_BUNDLE')
        GROUP BY ur.user_id
        HAVING count(*) = 2
    ), 'ADMIN must receive both recovery permissions';

    ASSERT NOT EXISTS (
        SELECT 1
        FROM iam.user_roles ur
        JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
        JOIN iam.permissions p ON p.id = rp.permission_id
        WHERE ur.user_id = v_cashier_id
          AND p.code IN ('CREATE_BACKUP_BUNDLE', 'VALIDATE_BACKUP_BUNDLE')
    ), 'CASHIER must not receive recovery permissions';

    BEGIN
        PERFORM operations.begin_recovery_attempt(
            v_cashier_token,
            'r6-validate-cashier-denied',
            'VALIDATE_BACKUP',
            'GestStock-Backup-20260803-195700'
        );
    EXCEPTION WHEN insufficient_privilege THEN
        v_denied := true;
    END;
    ASSERT v_denied, 'Cashier must not begin backup validation';

    v_started := operations.begin_recovery_attempt(
        v_admin_token,
        'r6-validate-0001',
        'VALIDATE_BACKUP',
        'GestStock-Backup-20260803-195700'
    );
    v_attempt_id := (v_started ->> 'attempt_id')::bigint;

    ASSERT v_started ->> 'status' = 'STARTED', 'First request must start';
    ASSERT (v_started ->> 'is_replay')::boolean = false, 'First request is not a replay';
    ASSERT v_started ->> 'current_schema_version' = '20260803193000',
        'Recovery schema version must be database-authoritative';

    v_replay := operations.begin_recovery_attempt(
        v_admin_token,
        'r6-validate-0001',
        'VALIDATE_BACKUP',
        'GestStock-Backup-20260803-195700'
    );
    ASSERT (v_replay ->> 'attempt_id')::bigint = v_attempt_id,
        'Same request must reuse the same audit row';
    ASSERT (v_replay ->> 'is_replay')::boolean,
        'Repeated matching request must be marked as replay';

    BEGIN
        PERFORM operations.begin_recovery_attempt(
            v_admin_token,
            'r6-validate-0001',
            'VALIDATE_BACKUP',
            'GestStock-Backup-20260803-200000'
        );
    EXCEPTION WHEN unique_violation THEN
        v_conflict := true;
    END;
    ASSERT v_conflict, 'Same request id with different bundle must conflict';

    v_completed := operations.complete_recovery_attempt(
        v_admin_token,
        v_attempt_id,
        true,
        NULL,
        v_result
    );
    ASSERT v_completed ->> 'status' = 'SUCCEEDED', 'Successful validation must complete';
    ASSERT v_completed -> 'result' = v_result, 'Safe result metadata must be retained';

    v_replay := operations.begin_recovery_attempt(
        v_admin_token,
        'r6-validate-0001',
        'VALIDATE_BACKUP',
        'GestStock-Backup-20260803-195700'
    );
    ASSERT v_replay ->> 'status' = 'SUCCEEDED', 'Completed request must replay success';
    ASSERT v_replay -> 'result' = v_result, 'Replay must return the original safe result';

    v_started := operations.begin_recovery_attempt(
        v_admin_token,
        'r6-validate-0002',
        'VALIDATE_BACKUP',
        'GestStock-Backup-20260803-200000'
    );
    v_failed_attempt_id := (v_started ->> 'attempt_id')::bigint;

    v_denied := false;
    BEGIN
        PERFORM operations.complete_recovery_attempt(
            v_other_admin_token,
            v_failed_attempt_id,
            false,
            'BACKUP_VALIDATION_FAILED',
            NULL
        );
    EXCEPTION WHEN insufficient_privilege THEN
        v_denied := true;
    END;
    ASSERT v_denied, 'Another administrator cannot complete a different actor attempt';

    v_failed := operations.complete_recovery_attempt(
        v_admin_token,
        v_failed_attempt_id,
        false,
        'BACKUP_VALIDATION_FAILED',
        NULL
    );
    ASSERT v_failed ->> 'status' = 'FAILED', 'Failed validation must complete as failed';
    ASSERT v_failed ->> 'error_code' = 'BACKUP_VALIDATION_FAILED',
        'Failure audit stores only a stable code';
    ASSERT v_failed -> 'result' IS NULL OR v_failed -> 'result' = 'null'::jsonb,
        'Failed audit must not retain result or diagnostic payload';

    ASSERT NOT has_table_privilege(
        'stockiha_runtime',
        'operations.recovery_attempts',
        'SELECT'
    ), 'Runtime must not read recovery audit rows directly';
    ASSERT NOT has_table_privilege(
        'stockiha_runtime',
        'operations.recovery_attempts',
        'INSERT,UPDATE,DELETE'
    ), 'Runtime must not mutate recovery audit rows directly';
    ASSERT NOT has_table_privilege(
        'stockiha_runtime',
        'operations.schema_state',
        'SELECT'
    ), 'Runtime must not read schema metadata directly';
    ASSERT has_function_privilege(
        'stockiha_runtime',
        'operations.begin_recovery_attempt(text,text,text,text)',
        'EXECUTE'
    ), 'Runtime must execute the guarded begin function';
    ASSERT has_function_privilege(
        'stockiha_runtime',
        'operations.complete_recovery_attempt(text,bigint,boolean,text,jsonb)',
        'EXECUTE'
    ), 'Runtime must execute the guarded completion function';
END;
$$;
