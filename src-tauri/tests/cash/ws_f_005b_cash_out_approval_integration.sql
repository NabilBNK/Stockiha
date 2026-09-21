-- WS-F-005b Integration Test: manager approval for cash-out, custom-reason
-- description requirement, note length limit, SUPER_ADMIN permission grants,
-- cash.get_capabilities, schema state, and migration idempotency.
\set ON_ERROR_STOP on

DO $$
DECLARE
    v_suffix text := floor(random() * 1000000000)::bigint::text;
    v_workstation text := 'WSF005B-WKS-' || v_suffix;
    v_workstation2 text := 'WSF005B-WKS2-' || v_suffix;
    v_cashier_username text := 'wsf005b_cashier_' || v_suffix;
    v_cashier2_username text := 'wsf005b_cashier2_' || v_suffix;
    v_manager_username text := 'wsf005b_manager_' || v_suffix;
    v_manager2_username text := 'wsf005b_manager2_' || v_suffix;
    v_admin_username text := 'wsf005b_admin_' || v_suffix;
    v_super_admin_username text := 'wsf005b_super_' || v_suffix;
    v_cashier_token text := 'wsf005b_cashier_token_' || v_suffix;
    v_cashier2_token text := 'wsf005b_cashier2_token_' || v_suffix;
    v_manager_token text := 'wsf005b_manager_token_' || v_suffix;
    v_manager2_token text := 'wsf005b_manager2_token_' || v_suffix;
    v_admin_token text := 'wsf005b_admin_token_' || v_suffix;
    v_super_admin_token text := 'wsf005b_super_token_' || v_suffix;
    v_cashier_id bigint;
    v_cashier2_id bigint;
    v_manager_id bigint;
    v_manager2_id bigint;
    v_admin_id bigint;
    v_super_admin_id bigint;
    v_warehouse_id bigint;
    v_period_id bigint;
    v_session1 bigint;
    v_session2 bigint;
    v_res jsonb;
    v_journal_id bigint;
    v_line_count bigint;
    v_debit_match bigint;
    v_credit_match bigint;
    v_sum_debit numeric;
    v_sum_credit numeric;
    v_approved_by bigint;
    v_blocked boolean;
    v_movement_count bigint;
    v_schema_version bigint;
BEGIN
    RAISE NOTICE '=== Running WS-F-005b cash-out approval integration suite ===';

    -- Open fiscal period covering today
    SELECT id INTO v_period_id
    FROM finance.fiscal_periods
    WHERE status = 'OPEN' AND CURRENT_DATE BETWEEN starts_on AND ends_on
    LIMIT 1;

    IF v_period_id IS NULL THEN
        INSERT INTO finance.fiscal_periods (period_code, starts_on, ends_on, status)
        VALUES ('TESTB-' || v_suffix, date_trunc('year', CURRENT_DATE)::date, (date_trunc('year', CURRENT_DATE) + interval '1 year' - interval '1 day')::date, 'OPEN')
        RETURNING id INTO v_period_id;
    END IF;

    -- Setup users & application sessions
    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES (v_cashier_username, 'WSF005B Cashier One', 'hashed_pass')
    RETURNING id INTO v_cashier_id;

    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES (v_cashier2_username, 'WSF005B Cashier Two', 'hashed_pass')
    RETURNING id INTO v_cashier2_id;

    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES (v_manager_username, 'WSF005B Manager', 'hashed_pass')
    RETURNING id INTO v_manager_id;

    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES (v_manager2_username, 'WSF005B Manager Two', 'hashed_pass')
    RETURNING id INTO v_manager2_id;

    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES (v_admin_username, 'WSF005B Admin', 'hashed_pass')
    RETURNING id INTO v_admin_id;

    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES (v_super_admin_username, 'WSF005B Super Admin', 'hashed_pass')
    RETURNING id INTO v_super_admin_id;

    INSERT INTO iam.user_roles (user_id, role_id) SELECT v_cashier_id, id FROM iam.roles WHERE code = 'CASHIER';
    INSERT INTO iam.user_roles (user_id, role_id) SELECT v_cashier2_id, id FROM iam.roles WHERE code = 'CASHIER';
    INSERT INTO iam.user_roles (user_id, role_id) SELECT v_manager_id, id FROM iam.roles WHERE code = 'MANAGER';
    INSERT INTO iam.user_roles (user_id, role_id) SELECT v_manager2_id, id FROM iam.roles WHERE code = 'MANAGER';
    INSERT INTO iam.user_roles (user_id, role_id) SELECT v_admin_id, id FROM iam.roles WHERE code = 'ADMIN';
    INSERT INTO iam.user_roles (user_id, role_id) SELECT v_super_admin_id, id FROM iam.roles WHERE code = 'SUPER_ADMIN';

    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at) VALUES
        (v_cashier_id, v_workstation, sha256(v_cashier_token::bytea), now() + interval '2 hours'),
        (v_cashier2_id, v_workstation, sha256(v_cashier2_token::bytea), now() + interval '2 hours'),
        (v_manager_id, v_workstation, sha256(v_manager_token::bytea), now() + interval '2 hours'),
        (v_manager2_id, v_workstation2, sha256(v_manager2_token::bytea), now() + interval '2 hours'),
        (v_admin_id, v_workstation, sha256(v_admin_token::bytea), now() + interval '2 hours'),
        (v_super_admin_id, v_workstation, sha256(v_super_admin_token::bytea), now() + interval '2 hours');

    INSERT INTO inventory.warehouses (code, name)
    VALUES ('WH-WSF005B-' || v_suffix, 'WS-F-005b Warehouse')
    RETURNING id INTO v_warehouse_id;

    -- =========================================================================
    -- 1. Cashier CASH_OUT with a NULL approver is refused (42501), no row written.
    -- =========================================================================
    v_session1 := sales.open_cash_session(v_cashier_token, v_warehouse_id, v_workstation, 2000.00);

    v_blocked := false;
    BEGIN
        PERFORM cash.record_cash_movement(v_cashier_token, v_session1, 'CASH_OUT', 500.00, 'EXPENSE', 'Delivery payment', NULL);
    EXCEPTION WHEN SQLSTATE '42501' THEN
        v_blocked := true;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'Assertion failed (1): cashier cash-out without approver was allowed';
    END IF;

    SELECT count(*) INTO v_movement_count FROM cash.movements WHERE cash_session_id = v_session1;
    IF v_movement_count <> 0 THEN
        RAISE EXCEPTION 'Assertion failed (1): a movement row was written despite the refusal';
    END IF;

    -- =========================================================================
    -- 2. Cashier CASH_OUT with a same-workstation manager approver succeeds.
    -- =========================================================================
    v_res := cash.record_cash_movement(v_cashier_token, v_session1, 'CASH_OUT', 500.00, 'EXPENSE', 'Delivery payment', v_manager_token);

    SELECT approved_by_user_id, journal_document_id
    INTO v_approved_by, v_journal_id
    FROM cash.movements
    WHERE id = (v_res->>'movement_id')::bigint;

    IF v_approved_by <> v_manager_id THEN
        RAISE EXCEPTION 'Assertion failed (2): approved_by_user_id is not the manager: %', v_approved_by;
    END IF;

    SELECT count(*),
           sum(CASE WHEN jl.account_code = 'CASH_TRANSIT' AND jl.debit = 500.00 AND jl.credit = 0 THEN 1 ELSE 0 END),
           sum(CASE WHEN jl.account_code = 'CASH_DESK' AND jl.debit = 0 AND jl.credit = 500.00 THEN 1 ELSE 0 END),
           sum(jl.debit), sum(jl.credit)
    INTO v_line_count, v_debit_match, v_credit_match, v_sum_debit, v_sum_credit
    FROM finance.journal_lines jl
    WHERE jl.document_id = v_journal_id;

    IF v_line_count <> 2 OR v_debit_match <> 1 OR v_credit_match <> 1 OR v_sum_debit <> v_sum_credit THEN
        RAISE EXCEPTION 'Assertion failed (2): approved cash-out journal not balanced or wrong accounts';
    END IF;

    -- =========================================================================
    -- 3. Cashier CASH_OUT with an approver token belonging to another cashier is refused.
    -- =========================================================================
    v_blocked := false;
    BEGIN
        PERFORM cash.record_cash_movement(v_cashier_token, v_session1, 'CASH_OUT', 100.00, 'EXPENSE', 'Bad approver', v_cashier2_token);
    EXCEPTION WHEN SQLSTATE '42501' THEN
        v_blocked := true;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'Assertion failed (3): a cashier approver token was accepted';
    END IF;

    -- =========================================================================
    -- 4. Cashier CASH_OUT whose approver is a manager on a different workstation is refused.
    -- =========================================================================
    v_blocked := false;
    BEGIN
        PERFORM cash.record_cash_movement(v_cashier_token, v_session1, 'CASH_OUT', 100.00, 'EXPENSE', 'Cross workstation', v_manager2_token);
    EXCEPTION WHEN SQLSTATE '42501' THEN
        v_blocked := true;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'Assertion failed (4): a different-workstation manager approver was accepted';
    END IF;

    -- =========================================================================
    -- 5. A manager who owns the open session records a CASH_OUT with a NULL approver.
    -- Opened on the second workstation, which has no live session yet.
    -- =========================================================================
    v_session2 := sales.open_cash_session(v_manager2_token, v_warehouse_id, v_workstation2, 1000.00);
    v_res := cash.record_cash_movement(v_manager2_token, v_session2, 'CASH_OUT', 200.00, 'EXPENSE', 'Manager self approval', NULL);

    SELECT approved_by_user_id INTO v_approved_by
    FROM cash.movements
    WHERE id = (v_res->>'movement_id')::bigint;

    IF v_approved_by <> v_manager2_id THEN
        RAISE EXCEPTION 'Assertion failed (5): manager self-approval id mismatch: %', v_approved_by;
    END IF;

    -- =========================================================================
    -- 6. A cashier CASH_IN with a NULL approver succeeds; approved_by_user_id is NULL.
    -- =========================================================================
    v_res := cash.record_cash_movement(v_cashier_token, v_session1, 'CASH_IN', 50.00, 'CHANGE_FLOAT', 'Extra coin', NULL);

    SELECT approved_by_user_id INTO v_approved_by
    FROM cash.movements
    WHERE id = (v_res->>'movement_id')::bigint;

    IF v_approved_by IS NOT NULL THEN
        RAISE EXCEPTION 'Assertion failed (6): cash-in unexpectedly recorded an approver';
    END IF;

    -- =========================================================================
    -- 7. Reason OTHER with a NULL note is refused; all-spaces note is refused; a real note succeeds.
    -- =========================================================================
    v_blocked := false;
    BEGIN
        PERFORM cash.record_cash_movement(v_cashier_token, v_session1, 'CASH_IN', 10.00, 'OTHER', NULL, NULL);
    EXCEPTION WHEN SQLSTATE '22023' THEN v_blocked := true;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'Assertion failed (7a): custom reason with NULL note was allowed';
    END IF;

    v_blocked := false;
    BEGIN
        PERFORM cash.record_cash_movement(v_cashier_token, v_session1, 'CASH_IN', 10.00, 'OTHER', '   ', NULL);
    EXCEPTION WHEN SQLSTATE '22023' THEN v_blocked := true;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'Assertion failed (7b): custom reason with all-spaces note was allowed';
    END IF;

    v_res := cash.record_cash_movement(v_cashier_token, v_session1, 'CASH_IN', 10.00, 'OTHER', 'Found in the till drawer', NULL);
    IF (v_res->>'reason_code') <> 'OTHER' THEN
        RAISE EXCEPTION 'Assertion failed (7c): custom reason with a real note was refused';
    END IF;

    -- =========================================================================
    -- 8. A 201-character note is refused; a 200-character note succeeds.
    -- =========================================================================
    v_blocked := false;
    BEGIN
        PERFORM cash.record_cash_movement(v_cashier_token, v_session1, 'CASH_IN', 5.00, 'CORRECTION', repeat('x', 201), NULL);
    EXCEPTION WHEN SQLSTATE '22023' THEN v_blocked := true;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'Assertion failed (8a): a 201-character note was allowed';
    END IF;

    v_res := cash.record_cash_movement(v_cashier_token, v_session1, 'CASH_IN', 5.00, 'CORRECTION', repeat('x', 200), NULL);
    IF (v_res->>'movement_id') IS NULL THEN
        RAISE EXCEPTION 'Assertion failed (8b): a 200-character note was refused';
    END IF;

    -- =========================================================================
    -- 9. The old 6-argument function no longer exists.
    -- =========================================================================
    IF to_regprocedure('cash.record_cash_movement(text,bigint,text,numeric,text,text)') IS NOT NULL THEN
        RAISE EXCEPTION 'Assertion failed (9): the 6-argument record_cash_movement still exists';
    END IF;

    -- =========================================================================
    -- 10. cash.get_capabilities: false for a cashier, true for manager/admin/super admin.
    -- =========================================================================
    IF (cash.get_capabilities(v_cashier_token)->>'can_approve_cash_out')::boolean IS NOT FALSE THEN
        RAISE EXCEPTION 'Assertion failed (10a): cashier unexpectedly can approve cash-out';
    END IF;
    IF (cash.get_capabilities(v_manager_token)->>'can_approve_cash_out')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'Assertion failed (10b): manager cannot approve cash-out';
    END IF;
    IF (cash.get_capabilities(v_admin_token)->>'can_approve_cash_out')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'Assertion failed (10c): admin cannot approve cash-out';
    END IF;
    IF (cash.get_capabilities(v_super_admin_token)->>'can_approve_cash_out')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'Assertion failed (10d): super admin cannot approve cash-out';
    END IF;

    -- =========================================================================
    -- 11. SUPER_ADMIN holds RECORD_CASH_MOVEMENT, MANAGE_CASH_POLICY and APPROVE_CASH_OUT.
    -- =========================================================================
    IF NOT EXISTS (
        SELECT 1
        FROM iam.roles r
        JOIN iam.role_permissions rp ON rp.role_id = r.id
        JOIN iam.permissions p ON p.id = rp.permission_id
        WHERE r.code = 'SUPER_ADMIN' AND p.code = 'RECORD_CASH_MOVEMENT'
    ) THEN
        RAISE EXCEPTION 'Assertion failed (11a): SUPER_ADMIN lacks RECORD_CASH_MOVEMENT';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM iam.roles r
        JOIN iam.role_permissions rp ON rp.role_id = r.id
        JOIN iam.permissions p ON p.id = rp.permission_id
        WHERE r.code = 'SUPER_ADMIN' AND p.code = 'MANAGE_CASH_POLICY'
    ) THEN
        RAISE EXCEPTION 'Assertion failed (11b): SUPER_ADMIN lacks MANAGE_CASH_POLICY';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM iam.roles r
        JOIN iam.role_permissions rp ON rp.role_id = r.id
        JOIN iam.permissions p ON p.id = rp.permission_id
        WHERE r.code = 'SUPER_ADMIN' AND p.code = 'APPROVE_CASH_OUT'
    ) THEN
        RAISE EXCEPTION 'Assertion failed (11c): SUPER_ADMIN lacks APPROVE_CASH_OUT';
    END IF;

    -- =========================================================================
    -- 12. operations.schema_state.migration_version = 20260921090000.
    -- =========================================================================
    SELECT migration_version INTO v_schema_version FROM operations.schema_state WHERE singleton;
    IF v_schema_version <> 20260921090000 THEN
        RAISE EXCEPTION 'Assertion failed (12): schema_state.migration_version is % instead of 20260921090000', v_schema_version;
    END IF;

    RAISE NOTICE '=== WS-F-005b integration suite completed successfully ===';
END;
$$;

-- =============================================================================
-- 13. Re-applying the migration file a second time raises no error.
-- =============================================================================
\i src-tauri/migrations/20260921090000_ws_f_005b_cash_out_approval.sql
