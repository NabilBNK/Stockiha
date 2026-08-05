-- R6-002 restore-verification authorization and replay regression.
-- Runs inside the transaction owned by run_current_sql_suites.sh.
\set ON_ERROR_STOP on

DO $$
DECLARE
    v_admin_id bigint;
    v_cashier_id bigint;
    v_other_admin_id bigint;
    v_admin_token text := 'r6_002_admin_token';
    v_cashier_token text := 'r6_002_cashier_token';
    v_other_admin_token text := 'r6_002_other_admin_token';
    v_started jsonb;
    v_replay jsonb;
    v_completed jsonb;
    v_attempt_id bigint;
    v_denied boolean := false;
    v_conflict boolean := false;
    v_result jsonb;
BEGIN
    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES ('r6_002_admin', 'R6 Restore Admin', 'hash')
    RETURNING id INTO v_admin_id;
    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_admin_id, id FROM iam.roles WHERE code = 'ADMIN';
    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_admin_id, 'R6-RESTORE-WKS', sha256(v_admin_token::bytea), now() + interval '1 hour');

    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES ('r6_002_cashier', 'R6 Restore Cashier', 'hash')
    RETURNING id INTO v_cashier_id;
    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_cashier_id, id FROM iam.roles WHERE code = 'CASHIER';
    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_cashier_id, 'R6-RESTORE-CASHIER-WKS', sha256(v_cashier_token::bytea), now() + interval '1 hour');

    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES ('r6_002_other_admin', 'R6 Restore Other Admin', 'hash')
    RETURNING id INTO v_other_admin_id;
    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_other_admin_id, id FROM iam.roles WHERE code = 'ADMIN';
    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_other_admin_id, 'R6-RESTORE-OTHER-WKS', sha256(v_other_admin_token::bytea), now() + interval '1 hour');

    ASSERT EXISTS (
        SELECT 1
        FROM iam.user_roles ur
        JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
        JOIN iam.permissions p ON p.id = rp.permission_id
        WHERE ur.user_id = v_admin_id
          AND p.code = 'VERIFY_BACKUP_RESTORE'
    ), 'ADMIN must receive VERIFY_BACKUP_RESTORE';

    ASSERT NOT EXISTS (
        SELECT 1
        FROM iam.user_roles ur
        JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
        JOIN iam.permissions p ON p.id = rp.permission_id
        WHERE ur.user_id = v_cashier_id
          AND p.code = 'VERIFY_BACKUP_RESTORE'
    ), 'CASHIER must not receive VERIFY_BACKUP_RESTORE';

    BEGIN
        PERFORM operations.begin_restore_verification_attempt(
            v_cashier_token,
            'r6-restore-cashier-denied',
            'GestStock-Backup-20260805-150500'
        );
    EXCEPTION WHEN insufficient_privilege THEN
        v_denied := true;
    END;
    ASSERT v_denied, 'Cashier must not begin a restore verification';

    v_started := operations.begin_restore_verification_attempt(
        v_admin_token,
        'r6-restore-0001',
        'GestStock-Backup-20260805-150500'
    );
    v_attempt_id := (v_started ->> 'attempt_id')::bigint;

    ASSERT v_started ->> 'status' = 'STARTED', 'First restore verification must start';
    ASSERT NOT (v_started ->> 'is_replay')::boolean, 'First restore verification is not replay';
    ASSERT v_started ->> 'current_schema_version' = '20260805150500',
        'Restore verification must expose the current database schema version';

    v_replay := operations.begin_restore_verification_attempt(
        v_admin_token,
        'r6-restore-0001',
        'GestStock-Backup-20260805-150500'
    );
    ASSERT (v_replay ->> 'attempt_id')::bigint = v_attempt_id,
        'Matching retry must reuse the same attempt';
    ASSERT (v_replay ->> 'is_replay')::boolean,
        'Matching retry must be marked replay';

    BEGIN
        PERFORM operations.begin_restore_verification_attempt(
            v_admin_token,
            'r6-restore-0001',
            'GestStock-Backup-20260805-150501'
        );
    EXCEPTION WHEN unique_violation THEN
        v_conflict := true;
    END;
    ASSERT v_conflict, 'Same request id with another bundle must conflict';

    v_denied := false;
    BEGIN
        PERFORM operations.complete_restore_verification_attempt(
            v_other_admin_token,
            v_attempt_id,
            false,
            'BACKUP_VALIDATION_FAILED',
            NULL
        );
    EXCEPTION WHEN insufficient_privilege THEN
        v_denied := true;
    END;
    ASSERT v_denied, 'Another administrator cannot complete the attempt';

    v_result := jsonb_build_object(
        'requestId', 'r6-restore-0001',
        'bundleIdentifier', 'GestStock-Backup-20260805-150500',
        'schemaVersion', '20260805150500',
        'postgresMajorVersion', 18,
        'temporaryDatabaseCleaned', true,
        'journalBalanced', true,
        'controlTotals', jsonb_build_object(
            'schemaCount', 12,
            'tableCount', 42,
            'userCount', 1,
            'productCount', 0,
            'customerCount', 0,
            'supplierCount', 0,
            'inventoryPositionCount', 0,
            'inventoryMovementCount', 0,
            'cashSaleCount', 0,
            'journalCount', 0,
            'journalDebitTotal', '0',
            'journalCreditTotal', '0',
            'customerExposureTotal', '0',
            'supplierOutstandingTotal', '0',
            'openingStateApplicationCount', 0
        )
    );

    v_completed := operations.complete_restore_verification_attempt(
        v_admin_token,
        v_attempt_id,
        true,
        NULL,
        v_result
    );
    ASSERT v_completed ->> 'status' = 'SUCCEEDED',
        'Successful restore verification must complete';
    ASSERT v_completed -> 'result' = v_result,
        'Only the safe restore verification result must be retained';

    v_replay := operations.begin_restore_verification_attempt(
        v_admin_token,
        'r6-restore-0001',
        'GestStock-Backup-20260805-150500'
    );
    ASSERT v_replay ->> 'status' = 'SUCCEEDED',
        'Completed restore verification must replay success';
    ASSERT v_replay -> 'result' = v_result,
        'Replay must return the original safe result';

    ASSERT has_function_privilege(
        'stockiha_runtime',
        'operations.begin_restore_verification_attempt(text,text,text)',
        'EXECUTE'
    ), 'Runtime must execute the guarded restore-verification begin function';
    ASSERT has_function_privilege(
        'stockiha_runtime',
        'operations.complete_restore_verification_attempt(text,bigint,boolean,text,jsonb)',
        'EXECUTE'
    ), 'Runtime must execute the guarded restore-verification completion function';
    ASSERT NOT has_table_privilege(
        'stockiha_runtime',
        'operations.recovery_attempts',
        'SELECT,INSERT,UPDATE,DELETE'
    ), 'Runtime must not access recovery audit rows directly';
    ASSERT has_table_privilege(
        'stockiha_backup',
        'operations.recovery_attempts',
        'SELECT'
    ), 'Backup role must include restore-verification audit in a backup';
    ASSERT NOT has_table_privilege(
        'stockiha_backup',
        'operations.recovery_attempts',
        'INSERT,UPDATE,DELETE'
    ), 'Backup role must remain read-only';
END;
$$;
