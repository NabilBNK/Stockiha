-- WS-H-3 embedded recovery foundation: permissions, capabilities, automatic
-- backup attempt ownership, RESTORE_LIVE authorization, backup status, the
-- any-create-bundle unique index, restore_events privileges, schema_state,
-- and migration idempotency.
-- Runs inside the transaction owned by run_current_sql_suites.sh.
\set ON_ERROR_STOP on

DO $$
DECLARE
    v_admin_id bigint;
    v_cashier_id bigint;
    v_other_cashier_id bigint;
    v_admin_token text := 'ws_h_003_admin_token';
    v_cashier_token text := 'ws_h_003_cashier_token';
    v_other_cashier_token text := 'ws_h_003_other_cashier_token';
    v_caps jsonb;
    v_started jsonb;
    v_replay jsonb;
    v_completed jsonb;
    v_status jsonb;
    v_attempt_id bigint;
    v_denied boolean := false;
    v_conflict boolean := false;
BEGIN
    -- Fixture users, roles and sessions -----------------------------------
    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES ('ws_h_003_admin', 'WS-H-3 Admin', 'hash')
    RETURNING id INTO v_admin_id;
    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_admin_id, id FROM iam.roles WHERE code = 'ADMIN';
    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_admin_id, 'WS-H-3-ADMIN-WKS', sha256(v_admin_token::bytea), now() + interval '1 hour');

    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES ('ws_h_003_cashier', 'WS-H-3 Cashier', 'hash')
    RETURNING id INTO v_cashier_id;
    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_cashier_id, id FROM iam.roles WHERE code = 'CASHIER';
    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_cashier_id, 'WS-H-3-CASHIER-WKS', sha256(v_cashier_token::bytea), now() + interval '1 hour');

    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES ('ws_h_003_other_cashier', 'WS-H-3 Other Cashier', 'hash')
    RETURNING id INTO v_other_cashier_id;
    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_other_cashier_id, id FROM iam.roles WHERE code = 'CASHIER';
    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_other_cashier_id, 'WS-H-3-OTHER-WKS', sha256(v_other_cashier_token::bytea), now() + interval '1 hour');

    -- 1. Permission vocabulary ----------------------------------------------
    ASSERT EXISTS (
        SELECT 1
        FROM iam.user_roles ur
        JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
        JOIN iam.permissions p ON p.id = rp.permission_id
        WHERE ur.user_id = v_admin_id
          AND p.code = 'RESTORE_BACKUP_LIVE'
    ), 'ADMIN must receive RESTORE_BACKUP_LIVE';

    ASSERT NOT EXISTS (
        SELECT 1
        FROM iam.user_roles ur
        JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
        JOIN iam.permissions p ON p.id = rp.permission_id
        WHERE ur.user_id = v_cashier_id
          AND p.code = 'RESTORE_BACKUP_LIVE'
    ), 'CASHIER must not receive RESTORE_BACKUP_LIVE';

    -- 2. Capabilities per role -----------------------------------------------
    v_caps := operations.get_recovery_capabilities(v_admin_token);
    ASSERT (v_caps ->> 'can_create_backup')::boolean, 'Admin can create backups';
    ASSERT (v_caps ->> 'can_validate_backup')::boolean, 'Admin can validate backups';
    ASSERT (v_caps ->> 'can_verify_restore')::boolean, 'Admin can test restores';
    ASSERT (v_caps ->> 'can_restore_live')::boolean, 'Admin can restore live';

    v_caps := operations.get_recovery_capabilities(v_cashier_token);
    ASSERT NOT (v_caps ->> 'can_create_backup')::boolean, 'Cashier cannot create backups';
    ASSERT NOT (v_caps ->> 'can_validate_backup')::boolean, 'Cashier cannot validate backups';
    ASSERT NOT (v_caps ->> 'can_verify_restore')::boolean, 'Cashier cannot test restores';
    ASSERT NOT (v_caps ->> 'can_restore_live')::boolean, 'Cashier cannot restore live';

    -- 3. Automatic backup attempts need only a valid session --------------
    v_started := operations.begin_automatic_backup_attempt(
        v_cashier_token,
        'ws-h-003-auto-0001',
        'GestStock-Backup-20260916-100000'
    );
    v_attempt_id := (v_started ->> 'attempt_id')::bigint;
    ASSERT v_started ->> 'status' = 'STARTED', 'Cashier must be able to begin an automatic backup';
    ASSERT NOT (v_started ->> 'is_replay')::boolean, 'First automatic attempt is not a replay';
    ASSERT v_started ->> 'bundle_identifier' = 'GestStock-Backup-20260916-100000',
        'Automatic attempt must echo the bundle identifier';
    ASSERT EXISTS (
        SELECT 1 FROM operations.recovery_attempts
        WHERE id = v_attempt_id AND operation_code = 'AUTO_BACKUP' AND actor_id = v_cashier_id
    ), 'Automatic attempt row must be recorded as AUTO_BACKUP for the cashier';

    v_replay := operations.begin_automatic_backup_attempt(
        v_cashier_token,
        'ws-h-003-auto-0001',
        'GestStock-Backup-20260916-100001'
    );
    ASSERT (v_replay ->> 'attempt_id')::bigint = v_attempt_id, 'Replay must reuse the attempt';
    ASSERT (v_replay ->> 'is_replay')::boolean, 'Replay must be marked is_replay';
    ASSERT v_replay ->> 'bundle_identifier' = 'GestStock-Backup-20260916-100000',
        'Replay must return the original bundle identifier';

    -- Another user must not complete it.
    v_denied := false;
    BEGIN
        PERFORM operations.complete_automatic_backup_attempt(
            v_other_cashier_token, v_attempt_id, false, 'BACKUP_PG_DUMP_FAILED', NULL
        );
    EXCEPTION WHEN insufficient_privilege THEN
        v_denied := true;
    END;
    ASSERT v_denied, 'Another user must not complete a cashier''s automatic attempt (42501)';

    -- The owner completes it successfully.
    v_completed := operations.complete_automatic_backup_attempt(
        v_cashier_token, v_attempt_id, true, NULL,
        jsonb_build_object('requestId', 'ws-h-003-auto-0001',
                           'bundleIdentifier', 'GestStock-Backup-20260916-100000')
    );
    ASSERT v_completed ->> 'status' = 'SUCCEEDED', 'Owner must complete their own automatic attempt';

    -- 4. get_backup_status sees the AUTO_BACKUP success ----------------------
    v_status := operations.get_backup_status(v_cashier_token);
    ASSERT v_status ? 'last_success_at', 'Status must carry last_success_at';
    ASSERT (v_status ->> 'last_success_at') IS NOT NULL,
        'Status must report the automatic backup success time';
    ASSERT v_status ->> 'last_success_bundle' = 'GestStock-Backup-20260916-100000',
        'Status must name the last successful bundle';
    ASSERT (v_status -> 'last_restore_at') = 'null'::jsonb,
        'No restore has happened yet';

    -- 5. Unique bundle identifier across CREATE_BACKUP and AUTO_BACKUP -------
    v_conflict := false;
    BEGIN
        PERFORM operations.begin_recovery_attempt(
            v_admin_token, 'ws-h-003-create-dup', 'CREATE_BACKUP',
            'GestStock-Backup-20260916-100000'
        );
    EXCEPTION WHEN unique_violation THEN
        v_conflict := true;
    END;
    ASSERT v_conflict, 'A CREATE_BACKUP with an AUTO_BACKUP''s bundle identifier must raise 23505';

    -- 6. RESTORE_LIVE authorization -----------------------------------------
    v_denied := false;
    BEGIN
        PERFORM operations.begin_recovery_attempt(
            v_cashier_token, 'ws-h-003-restore-cashier', 'RESTORE_LIVE',
            'GestStock-Backup-20260916-100000'
        );
    EXCEPTION WHEN insufficient_privilege THEN
        v_denied := true;
    END;
    ASSERT v_denied, 'Cashier must not begin a RESTORE_LIVE attempt (42501)';

    v_started := operations.begin_recovery_attempt(
        v_admin_token, 'ws-h-003-restore-admin', 'RESTORE_LIVE',
        'GestStock-Backup-20260916-100000'
    );
    ASSERT v_started ->> 'status' = 'STARTED', 'Admin must begin a RESTORE_LIVE attempt';
    v_attempt_id := (v_started ->> 'attempt_id')::bigint;
    v_completed := operations.complete_recovery_attempt(
        v_admin_token, v_attempt_id, false, 'RESTORE_DATABASE_BUSY', NULL
    );
    ASSERT v_completed ->> 'status' = 'FAILED', 'Admin must complete their RESTORE_LIVE attempt';
    ASSERT v_completed ->> 'error_code' = 'RESTORE_DATABASE_BUSY', 'Failure code must be stored';

    -- A failed RESTORE_LIVE must not affect the backup status line.
    v_status := operations.get_backup_status(v_admin_token);
    ASSERT (v_status -> 'last_failure_at') = 'null'::jsonb,
        'RESTORE_LIVE failures are not backup failures';

    -- 7. restore_events privileges -----------------------------------------
    ASSERT NOT has_table_privilege('stockiha_runtime', 'operations.restore_events', 'SELECT'),
        'Runtime must not read restore_events';
    ASSERT has_table_privilege('stockiha_backup', 'operations.restore_events', 'SELECT'),
        'Backup role must read restore_events';
    v_denied := false;
    BEGIN
        SET LOCAL ROLE stockiha_runtime;
        PERFORM 1 FROM operations.restore_events;
    EXCEPTION WHEN insufficient_privilege THEN
        v_denied := true;
    END;
    RESET ROLE;
    ASSERT v_denied, 'Runtime SELECT on restore_events must raise insufficient_privilege';

    -- 8. Schema state ----------------------------------------------------------
    ASSERT (SELECT migration_version FROM operations.schema_state WHERE singleton) >= 20260916100000,
        'schema_state must be stamped with the WS-H-3 migration version';
END;
$$;

-- 9. Idempotency: the migration must be safe to run twice (the WS-K-5
--    safe-upgrade fixture re-applies the newest migration).
\i src-tauri/migrations/20260916100000_ws_h_003_recovery_embedded_foundation.sql

DO $$
BEGIN
    ASSERT (SELECT count(*) FROM iam.permissions WHERE code = 'RESTORE_BACKUP_LIVE') = 1,
        'Re-running the migration must not duplicate the permission';
    ASSERT (SELECT count(*) FROM pg_constraint
            WHERE conrelid = 'iam.permissions'::regclass AND conname = 'permissions_code_valid') = 1,
        'Re-running the migration must keep exactly one permission CHECK';
    ASSERT (SELECT migration_version FROM operations.schema_state WHERE singleton) >= 20260916100000,
        'schema_state must still be the WS-H-3 version after a re-run';
END;
$$;
