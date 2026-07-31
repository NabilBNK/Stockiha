-- S4-002 integration: blind counts, variance approval, suspension, handover,
-- lifecycle privacy, ownership, and immutability.
\set ON_ERROR_STOP on

DO $$
DECLARE
    v_suffix text := floor(random() * 1000000000)::bigint::text;
    v_workstation text := 'S4002-WKS-' || v_suffix;
    v_cashier1_username text := 's4002_cashier1_' || v_suffix;
    v_cashier2_username text := 's4002_cashier2_' || v_suffix;
    v_manager_username text := 's4002_manager_' || v_suffix;
    v_cashier1_token text := 's4002_cashier1_token_' || v_suffix;
    v_cashier2_token text := 's4002_cashier2_token_' || v_suffix;
    v_manager_token text := 's4002_manager_token_' || v_suffix;
    v_cashier1_id bigint;
    v_cashier2_id bigint;
    v_manager_id bigint;
    v_warehouse_id bigint;
    v_session_id bigint;
    v_second_session_id bigint;
    v_attempt_id bigint;
    v_result jsonb;
    v_counts jsonb;
    v_status text;
    v_expected numeric;
    v_counted numeric;
    v_variance numeric;
    v_current_cashier bigint;
    v_count bigint;
    v_blocked boolean;
BEGIN
    RAISE NOTICE '=== Running S4-002 cashier lifecycle integration suite ===';

    -- Dedicated users/sessions on one workstation so manager escalation and
    -- handover are exercised without password/login concerns in SQL tests.
    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES (v_cashier1_username, 'S4002 Cashier One', 'hashed_pass')
    RETURNING id INTO v_cashier1_id;
    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES (v_cashier2_username, 'S4002 Cashier Two', 'hashed_pass')
    RETURNING id INTO v_cashier2_id;
    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES (v_manager_username, 'S4002 Manager', 'hashed_pass')
    RETURNING id INTO v_manager_id;

    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_cashier1_id, id FROM iam.roles WHERE code = 'CASHIER';
    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_cashier2_id, id FROM iam.roles WHERE code = 'CASHIER';
    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_manager_id, id FROM iam.roles WHERE code = 'MANAGER';

    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at) VALUES
        (v_cashier1_id, v_workstation, sha256(v_cashier1_token::bytea), now() + interval '2 hours'),
        (v_cashier2_id, v_workstation, sha256(v_cashier2_token::bytea), now() + interval '2 hours'),
        (v_manager_id, v_workstation, sha256(v_manager_token::bytea), now() + interval '2 hours');

    INSERT INTO inventory.warehouses (code, name)
    VALUES ('WH-S4002-' || v_suffix, 'S4-002 Cashier Lifecycle Warehouse')
    RETURNING id INTO v_warehouse_id;

    -- Runtime must not be able to bypass the blind workflow or inspect the
    -- raw cash ledger used to derive expected cash.
    IF has_function_privilege(
        'stockiha_runtime',
        'sales.close_cash_session(text,bigint,numeric)',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'Assertion failed: legacy total-only close remains executable by runtime';
    END IF;

    IF has_table_privilege('stockiha_runtime', 'cash.movements', 'SELECT') THEN
        RAISE EXCEPTION 'Assertion failed: runtime can read raw cash movements before blind count';
    END IF;

    -- --------------------------------------------------------------------
    -- Exact count: OPEN -> CLOSING -> CLOSED without manager approval.
    -- --------------------------------------------------------------------
    v_session_id := sales.open_cash_session(v_cashier1_token, v_warehouse_id, v_workstation, 1000.00);

    SELECT current_cashier_user_id INTO v_current_cashier
    FROM sales.cash_sessions WHERE id = v_session_id;
    IF v_current_cashier <> v_cashier1_id THEN
        RAISE EXCEPTION 'Assertion failed: opener did not become current cashier';
    END IF;

    PERFORM sales.begin_cash_session_close(v_cashier1_token, v_session_id);

    SELECT status INTO v_status FROM sales.cash_sessions WHERE id = v_session_id;
    IF v_status <> 'CLOSING' THEN
        RAISE EXCEPTION 'Assertion failed: begin close did not enter CLOSING';
    END IF;

    SELECT expected_amount
    INTO v_expected
    FROM sales.inspect_current_cash_session(v_cashier1_token, v_workstation);
    IF v_expected IS NOT NULL THEN
        RAISE EXCEPTION 'Assertion failed: expected cash leaked during blind CLOSING state';
    END IF;

    -- A CLOSING session is still live and blocks another session on the same register.
    v_blocked := false;
    BEGIN
        PERFORM sales.open_cash_session(v_cashier2_token, v_warehouse_id, v_workstation, 0);
    EXCEPTION WHEN SQLSTATE '55000' THEN
        v_blocked := true;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'Assertion failed: second live session opened on same workstation';
    END IF;

    SELECT jsonb_agg(
        jsonb_build_object(
            'denomination_id', id,
            'quantity', CASE WHEN code = 'DZD_1000' THEN 1 ELSE 0 END
        ) ORDER BY display_order
    )
    INTO v_counts
    FROM cash.denominations
    WHERE is_active;

    v_result := sales.submit_cash_session_count(v_cashier1_token, v_session_id, v_counts);
    IF v_result->>'status' <> 'CLOSED'
       OR (v_result->>'expected_amount')::numeric <> 1000.00
       OR (v_result->>'counted_amount')::numeric <> 1000.00
       OR (v_result->>'variance_amount')::numeric <> 0.00
       OR (v_result->>'requires_manager_approval')::boolean THEN
        RAISE EXCEPTION 'Assertion failed: exact blind count did not auto-close correctly: %', v_result;
    END IF;

    SELECT status, expected_amount, counted_amount, variance_amount
    INTO v_status, v_expected, v_counted, v_variance
    FROM sales.cash_sessions WHERE id = v_session_id;
    IF v_status <> 'CLOSED' OR v_expected <> 1000 OR v_counted <> 1000 OR v_variance <> 0 THEN
        RAISE EXCEPTION 'Assertion failed: closed session snapshot incorrect';
    END IF;

    SELECT count(*) INTO v_count
    FROM cash.session_close_count_lines l
    JOIN cash.session_close_attempts a ON a.id = l.close_attempt_id
    WHERE a.cash_session_id = v_session_id;
    IF v_count <> (SELECT count(*) FROM cash.denominations WHERE is_active) THEN
        RAISE EXCEPTION 'Assertion failed: close did not snapshot every active denomination';
    END IF;

    -- Audit rows are append-only.
    SELECT id INTO v_attempt_id
    FROM cash.session_close_attempts
    WHERE cash_session_id = v_session_id
    ORDER BY attempt_number DESC LIMIT 1;
    v_blocked := false;
    BEGIN
        UPDATE cash.session_close_attempts SET counted_amount = 1 WHERE id = v_attempt_id;
    EXCEPTION WHEN SQLSTATE '0A000' THEN
        v_blocked := true;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'Assertion failed: submitted close attempt was mutable';
    END IF;

    -- --------------------------------------------------------------------
    -- Material variance: cashier cannot approve; manager closes exact attempt.
    -- Threshold defaults to zero because architecture provides no business
    -- materiality amount, so any non-zero variance is material.
    -- --------------------------------------------------------------------
    v_session_id := sales.open_cash_session(v_cashier1_token, v_warehouse_id, v_workstation, 1000.00);
    PERFORM sales.begin_cash_session_close(v_cashier1_token, v_session_id);

    SELECT jsonb_agg(
        jsonb_build_object(
            'denomination_id', id,
            'quantity', CASE WHEN code = 'DZD_100' THEN 9 ELSE 0 END
        ) ORDER BY display_order
    )
    INTO v_counts
    FROM cash.denominations
    WHERE is_active;

    v_result := sales.submit_cash_session_count(v_cashier1_token, v_session_id, v_counts);
    v_attempt_id := (v_result->>'close_attempt_id')::bigint;
    IF v_result->>'status' <> 'PENDING_APPROVAL'
       OR (v_result->>'expected_amount')::numeric <> 1000
       OR (v_result->>'counted_amount')::numeric <> 900
       OR (v_result->>'variance_amount')::numeric <> -100
       OR NOT (v_result->>'requires_manager_approval')::boolean THEN
        RAISE EXCEPTION 'Assertion failed: material variance did not enter approval state: %', v_result;
    END IF;

    SELECT expected_amount, counted_amount, variance_amount
    INTO v_expected, v_counted, v_variance
    FROM sales.inspect_current_cash_session(v_cashier1_token, v_workstation);
    IF v_expected <> 1000 OR v_counted <> 900 OR v_variance <> -100 THEN
        RAISE EXCEPTION 'Assertion failed: post-submission variance summary not exposed correctly';
    END IF;

    v_blocked := false;
    BEGIN
        PERFORM sales.approve_cash_session_variance(
            v_cashier1_token, v_session_id, v_attempt_id, 'cashier must not self-authorize'
        );
    EXCEPTION WHEN SQLSTATE '42501' THEN
        v_blocked := true;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'Assertion failed: cashier approved material variance';
    END IF;

    v_result := sales.approve_cash_session_variance(
        v_manager_token, v_session_id, v_attempt_id, 'Verified physical variance'
    );
    IF v_result->>'status' <> 'CLOSED'
       OR (v_result->>'approved_by_user_id')::bigint <> v_manager_id THEN
        RAISE EXCEPTION 'Assertion failed: manager approval did not close exact attempt: %', v_result;
    END IF;

    SELECT count(*) INTO v_count
    FROM cash.session_close_approvals
    WHERE close_attempt_id = v_attempt_id
      AND approved_by_user_id = v_manager_id;
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'Assertion failed: manager approval audit row missing';
    END IF;

    v_blocked := false;
    BEGIN
        PERFORM sales.approve_cash_session_variance(
            v_manager_token, v_session_id, v_attempt_id, 'duplicate approval'
        );
    EXCEPTION WHEN SQLSTATE '55000' THEN
        v_blocked := true;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'Assertion failed: approval was reusable after close';
    END IF;

    -- --------------------------------------------------------------------
    -- Suspension and manager-controlled handover.
    -- --------------------------------------------------------------------
    v_session_id := sales.open_cash_session(v_cashier1_token, v_warehouse_id, v_workstation, 0);
    PERFORM sales.suspend_cash_session(v_cashier1_token, v_session_id, 'Shift handover preparation');

    SELECT status INTO v_status FROM sales.cash_sessions WHERE id = v_session_id;
    IF v_status <> 'SUSPENDED' THEN
        RAISE EXCEPTION 'Assertion failed: suspension did not change state';
    END IF;

    SELECT count(*) INTO v_count
    FROM sales.inspect_active_cash_session(v_cashier1_token, v_workstation);
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'Assertion failed: suspended session still appears cash-operational';
    END IF;

    v_blocked := false;
    BEGIN
        PERFORM sales.handover_cash_session(
            v_cashier1_token, v_session_id, v_cashier2_username, 'cashier cannot self-authorize handover'
        );
    EXCEPTION WHEN SQLSTATE '42501' THEN
        v_blocked := true;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'Assertion failed: cashier performed manager handover';
    END IF;

    PERFORM sales.handover_cash_session(
        v_manager_token, v_session_id, v_cashier2_username, 'Shift change'
    );

    SELECT status, current_cashier_user_id
    INTO v_status, v_current_cashier
    FROM sales.cash_sessions WHERE id = v_session_id;
    IF v_status <> 'SUSPENDED' OR v_current_cashier <> v_cashier2_id THEN
        RAISE EXCEPTION 'Assertion failed: handover did not preserve suspension and transfer ownership';
    END IF;

    -- Old cashier loses resume authority immediately.
    v_blocked := false;
    BEGIN
        PERFORM sales.resume_cash_session(v_cashier1_token, v_session_id);
    EXCEPTION WHEN SQLSTATE '42501' THEN
        v_blocked := true;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'Assertion failed: previous cashier resumed handed-over session';
    END IF;

    PERFORM sales.resume_cash_session(v_cashier2_token, v_session_id);
    SELECT status INTO v_status FROM sales.cash_sessions WHERE id = v_session_id;
    IF v_status <> 'OPEN' THEN
        RAISE EXCEPTION 'Assertion failed: new cashier could not explicitly resume handed-over session';
    END IF;

    SELECT count(*) INTO v_count
    FROM sales.inspect_active_cash_session(v_cashier2_token, v_workstation)
    WHERE id = v_session_id;
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'Assertion failed: new cashier does not own active session after resume';
    END IF;

    SELECT count(*) INTO v_count
    FROM sales.inspect_active_cash_session(v_cashier1_token, v_workstation);
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'Assertion failed: old cashier still sees handed-over session as active';
    END IF;

    -- Close final live fixture cleanly.
    PERFORM sales.begin_cash_session_close(v_cashier2_token, v_session_id);
    SELECT jsonb_agg(
        jsonb_build_object('denomination_id', id, 'quantity', 0)
        ORDER BY display_order
    ) INTO v_counts
    FROM cash.denominations WHERE is_active;
    v_result := sales.submit_cash_session_count(v_cashier2_token, v_session_id, v_counts);
    IF v_result->>'status' <> 'CLOSED' THEN
        RAISE EXCEPTION 'Assertion failed: handed-over session did not close with exact zero count';
    END IF;

    RAISE NOTICE '=== S4-002 cashier lifecycle integration suite PASSED ===';
END;
$$;
