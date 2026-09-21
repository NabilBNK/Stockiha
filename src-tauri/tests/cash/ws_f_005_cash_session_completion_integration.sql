-- WS-F-005 Integration Test: cash in/out during open session, 50 DA tolerance,
-- auto-close variance journal, manager approved variance journal, and append-only immutability.
\set ON_ERROR_STOP on

DO $$
DECLARE
    v_suffix text := floor(random() * 1000000000)::bigint::text;
    v_workstation text := 'WSF005-WKS-' || v_suffix;
    v_cashier_username text := 'wsf005_cashier_' || v_suffix;
    v_cashier2_username text := 'wsf005_cashier2_' || v_suffix;
    v_manager_username text := 'wsf005_manager_' || v_suffix;
    v_cashier_token text := 'wsf005_cashier_token_' || v_suffix;
    v_cashier2_token text := 'wsf005_cashier2_token_' || v_suffix;
    v_manager_token text := 'wsf005_manager_token_' || v_suffix;
    v_cashier_id bigint;
    v_cashier2_id bigint;
    v_manager_id bigint;
    v_warehouse_id bigint;
    v_period_id bigint;
    v_period_start date;
    v_period_end date;
    v_policy_threshold numeric;
    v_session1 bigint;
    v_session2 bigint;
    v_session3 bigint;
    v_session4 bigint;
    v_session5 bigint;
    v_res jsonb;
    v_counts jsonb;
    v_amount numeric;
    v_mov_type text;
    v_journal_id bigint;
    v_line_count bigint;
    v_debit_match bigint;
    v_credit_match bigint;
    v_sum_debit numeric;
    v_sum_credit numeric;
    v_attempt_id bigint;
    v_blocked boolean;
BEGIN
    RAISE NOTICE '=== Running WS-F-005 cash session completion integration suite ===';

    -- Open fiscal period covering today
    SELECT id, starts_on, ends_on
    INTO v_period_id, v_period_start, v_period_end
    FROM finance.fiscal_periods
    WHERE status = 'OPEN' AND CURRENT_DATE BETWEEN starts_on AND ends_on
    LIMIT 1;

    IF v_period_id IS NULL THEN
        SELECT id, starts_on, ends_on
        INTO v_period_id, v_period_start, v_period_end
        FROM finance.fiscal_periods
        WHERE CURRENT_DATE BETWEEN starts_on AND ends_on
        LIMIT 1;
        IF v_period_id IS NOT NULL THEN
            UPDATE finance.fiscal_periods SET status = 'OPEN' WHERE id = v_period_id;
        ELSE
            INSERT INTO finance.fiscal_periods (period_code, starts_on, ends_on, status)
            VALUES ('TEST-' || v_suffix, date_trunc('year', CURRENT_DATE)::date, (date_trunc('year', CURRENT_DATE) + interval '1 year' - interval '1 day')::date, 'OPEN')
            RETURNING id, starts_on, ends_on INTO v_period_id, v_period_start, v_period_end;
        END IF;
    END IF;

    -- Setup users & application sessions
    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES (v_cashier_username, 'WSF005 Cashier One', 'hashed_pass')
    RETURNING id INTO v_cashier_id;

    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES (v_cashier2_username, 'WSF005 Cashier Two', 'hashed_pass')
    RETURNING id INTO v_cashier2_id;

    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES (v_manager_username, 'WSF005 Manager', 'hashed_pass')
    RETURNING id INTO v_manager_id;

    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_cashier_id, id FROM iam.roles WHERE code = 'CASHIER';

    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_cashier2_id, id FROM iam.roles WHERE code = 'CASHIER';

    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_manager_id, id FROM iam.roles WHERE code = 'MANAGER';

    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at) VALUES
        (v_cashier_id, v_workstation, sha256(v_cashier_token::bytea), now() + interval '2 hours'),
        (v_cashier2_id, v_workstation, sha256(v_cashier2_token::bytea), now() + interval '2 hours'),
        (v_manager_id, v_workstation, sha256(v_manager_token::bytea), now() + interval '2 hours');

    INSERT INTO inventory.warehouses (code, name)
    VALUES ('WH-WSF005-' || v_suffix, 'WS-F-005 Cash Completion Warehouse')
    RETURNING id INTO v_warehouse_id;

    -- 13. Default tolerance after migration reads 50.00
    SELECT material_variance_threshold INTO v_policy_threshold
    FROM cash.session_policy WHERE id = 1;
    IF v_policy_threshold <> 50.00 THEN
        RAISE EXCEPTION 'Assertion failed (13): default tolerance is % instead of 50.00', v_policy_threshold;
    END IF;

    -- 1. Open a session with opening float of 2,000. Record cash-out of 500 for reason EXPENSE.
    v_session1 := sales.open_cash_session(v_cashier_token, v_warehouse_id, v_workstation, 2000.00);
    v_res := cash.record_cash_movement(v_cashier_token, v_session1, 'CASH_OUT', 500.00, 'EXPENSE', 'Delivery payment', v_manager_token);

    SELECT amount, movement_type, journal_document_id
    INTO v_amount, v_mov_type, v_journal_id
    FROM cash.movements
    WHERE id = (v_res->>'movement_id')::bigint;

    IF v_amount <> 500.00 OR v_mov_type <> 'CASH_OUT' THEN
        RAISE EXCEPTION 'Assertion failed (1): movement row incorrect: % %', v_amount, v_mov_type;
    END IF;

    -- 2. That cash-out posted a balanced journal debiting CASH_TRANSIT 500 and crediting CASH_DESK 500
    SELECT count(*),
           sum(CASE WHEN jl.account_code = 'CASH_TRANSIT' AND jl.debit = 500.00 AND jl.credit = 0 THEN 1 ELSE 0 END),
           sum(CASE WHEN jl.account_code = 'CASH_DESK' AND jl.debit = 0 AND jl.credit = 500.00 THEN 1 ELSE 0 END),
           sum(jl.debit),
           sum(jl.credit)
    INTO v_line_count, v_debit_match, v_credit_match, v_sum_debit, v_sum_credit
    FROM finance.journal_lines jl
    WHERE jl.document_id = v_journal_id;

    IF v_line_count <> 2 OR v_debit_match <> 1 OR v_credit_match <> 1 OR v_sum_debit <> v_sum_credit THEN
        RAISE EXCEPTION 'Assertion failed (2): cash-out journal not balanced or wrong accounts';
    END IF;

    -- 3. Record a cash-in of 300 for reason CHANGE_FLOAT. Journal debits CASH_DESK 300 and credits CASH_TRANSIT 300.
    v_res := cash.record_cash_movement(v_cashier_token, v_session1, 'CASH_IN', 300.00, 'CHANGE_FLOAT', 'Extra coin roll', NULL);
    v_journal_id := (v_res->>'journal_document_id')::bigint;

    SELECT count(*),
           sum(CASE WHEN jl.account_code = 'CASH_DESK' AND jl.debit = 300.00 AND jl.credit = 0 THEN 1 ELSE 0 END),
           sum(CASE WHEN jl.account_code = 'CASH_TRANSIT' AND jl.debit = 0 AND jl.credit = 300.00 THEN 1 ELSE 0 END),
           sum(jl.debit),
           sum(jl.credit)
    INTO v_line_count, v_debit_match, v_credit_match, v_sum_debit, v_sum_credit
    FROM finance.journal_lines jl
    WHERE jl.document_id = v_journal_id;

    IF v_line_count <> 2 OR v_debit_match <> 1 OR v_credit_match <> 1 OR v_sum_debit <> v_sum_credit THEN
        RAISE EXCEPTION 'Assertion failed (3): cash-in journal not balanced or wrong accounts';
    END IF;

    -- 4. Begin close and submit count equal to 1,800. Expected: 2000 - 500 + 300 = 1800, variance 0.00,
    -- closes with no manager approval and no variance journal.
    PERFORM sales.begin_cash_session_close(v_cashier_token, v_session1);

    SELECT jsonb_agg(
        jsonb_build_object(
            'denomination_id', id,
            'quantity', CASE
                WHEN code = 'DZD_1000' THEN 1
                WHEN code = 'DZD_500' THEN 1
                WHEN code = 'DZD_200' THEN 1
                WHEN code = 'DZD_100' THEN 1
                ELSE 0
            END
        ) ORDER BY display_order
    )
    INTO v_counts
    FROM cash.denominations
    WHERE is_active;

    v_res := cash.submit_cash_session_count(v_cashier_token, v_session1, v_counts);

    IF v_res->>'status' <> 'CLOSED'
       OR (v_res->>'expected_amount')::numeric <> 1800.00
       OR (v_res->>'counted_amount')::numeric <> 1800.00
       OR (v_res->>'variance_amount')::numeric <> 0.00
       OR (v_res->>'requires_manager_approval')::boolean THEN
        RAISE EXCEPTION 'Assertion failed (4): exact close failed: %', v_res;
    END IF;

    IF EXISTS (
        SELECT 1 FROM finance.journal_entries
        WHERE source_type = 'CASH_SESSION' AND source_id = v_session1
    ) THEN
        RAISE EXCEPTION 'Assertion failed (4): unexpected variance journal posted for zero variance';
    END IF;

    -- 5. Second session: opening float 1000, no sales, count 970. Variance -30.00 <= 50 tolerance.
    -- Auto-closes, journal debits CASH_VARIANCE 30, credits CASH_DESK 30.
    v_session2 := sales.open_cash_session(v_cashier_token, v_warehouse_id, v_workstation, 1000.00);
    PERFORM sales.begin_cash_session_close(v_cashier_token, v_session2);

    SELECT jsonb_agg(
        jsonb_build_object(
            'denomination_id', id,
            'quantity', CASE
                WHEN code = 'DZD_500' THEN 1
                WHEN code = 'DZD_200' THEN 2
                WHEN code = 'DZD_50' THEN 1
                WHEN code = 'DZD_20' THEN 1
                ELSE 0
            END
        ) ORDER BY display_order
    )
    INTO v_counts
    FROM cash.denominations
    WHERE is_active;

    v_res := cash.submit_cash_session_count(v_cashier_token, v_session2, v_counts);

    IF v_res->>'status' <> 'CLOSED'
       OR (v_res->>'expected_amount')::numeric <> 1000.00
       OR (v_res->>'counted_amount')::numeric <> 970.00
       OR (v_res->>'variance_amount')::numeric <> -30.00
       OR (v_res->>'requires_manager_approval')::boolean THEN
        RAISE EXCEPTION 'Assertion failed (5): auto-close within tolerance failed: %', v_res;
    END IF;

    SELECT je.document_id INTO v_journal_id
    FROM finance.journal_entries je
    WHERE je.source_type = 'CASH_SESSION' AND je.source_id = v_session2;

    IF v_journal_id IS NULL THEN
        RAISE EXCEPTION 'Assertion failed (5): no journal posted for shortfall';
    END IF;

    SELECT count(*),
           sum(CASE WHEN jl.account_code = 'CASH_VARIANCE' AND jl.debit = 30.00 AND jl.credit = 0 THEN 1 ELSE 0 END),
           sum(CASE WHEN jl.account_code = 'CASH_DESK' AND jl.debit = 0 AND jl.credit = 30.00 THEN 1 ELSE 0 END),
           sum(jl.debit),
           sum(jl.credit)
    INTO v_line_count, v_debit_match, v_credit_match, v_sum_debit, v_sum_credit
    FROM finance.journal_lines jl
    WHERE jl.document_id = v_journal_id;

    IF v_line_count <> 2 OR v_debit_match <> 1 OR v_credit_match <> 1 OR v_sum_debit <> v_sum_credit THEN
        RAISE EXCEPTION 'Assertion failed (5): shortfall journal incorrect or unbalanced';
    END IF;

    -- 6. Third session: variance -80.00 exceeds tolerance (50), leaves session PENDING_APPROVAL with no journal yet.
    v_session3 := sales.open_cash_session(v_cashier_token, v_warehouse_id, v_workstation, 1000.00);
    PERFORM sales.begin_cash_session_close(v_cashier_token, v_session3);

    SELECT jsonb_agg(
        jsonb_build_object(
            'denomination_id', id,
            'quantity', CASE
                WHEN code = 'DZD_500' THEN 1
                WHEN code = 'DZD_200' THEN 2
                WHEN code = 'DZD_20' THEN 1
                ELSE 0
            END
        ) ORDER BY display_order
    )
    INTO v_counts
    FROM cash.denominations
    WHERE is_active;

    v_res := cash.submit_cash_session_count(v_cashier_token, v_session3, v_counts);

    IF v_res->>'status' <> 'PENDING_APPROVAL'
       OR (v_res->>'variance_amount')::numeric <> -80.00
       OR NOT (v_res->>'requires_manager_approval')::boolean THEN
        RAISE EXCEPTION 'Assertion failed (6): variance beyond tolerance did not demand approval: %', v_res;
    END IF;

    IF EXISTS (
        SELECT 1 FROM finance.journal_entries
        WHERE source_type = 'CASH_SESSION' AND source_id = v_session3
    ) THEN
        RAISE EXCEPTION 'Assertion failed (6): journal posted before approval';
    END IF;

    -- 7. Approving that variance closes the session and posts journal debiting CASH_VARIANCE 80, crediting CASH_DESK 80.
    v_attempt_id := (v_res->>'close_attempt_id')::bigint;
    v_res := cash.approve_cash_session_variance(v_manager_token, v_session3, v_attempt_id, 'Approved missing cash');

    IF v_res->>'status' <> 'CLOSED' THEN
        RAISE EXCEPTION 'Assertion failed (7): manager approval did not close session: %', v_res;
    END IF;

    SELECT je.document_id INTO v_journal_id
    FROM finance.journal_entries je
    WHERE je.source_type = 'CASH_SESSION' AND je.source_id = v_session3;

    IF v_journal_id IS NULL THEN
        RAISE EXCEPTION 'Assertion failed (7): no journal posted after manager approval';
    END IF;

    SELECT count(*),
           sum(CASE WHEN jl.account_code = 'CASH_VARIANCE' AND jl.debit = 80.00 AND jl.credit = 0 THEN 1 ELSE 0 END),
           sum(CASE WHEN jl.account_code = 'CASH_DESK' AND jl.debit = 0 AND jl.credit = 80.00 THEN 1 ELSE 0 END),
           sum(jl.debit),
           sum(jl.credit)
    INTO v_line_count, v_debit_match, v_credit_match, v_sum_debit, v_sum_credit
    FROM finance.journal_lines jl
    WHERE jl.document_id = v_journal_id;

    IF v_line_count <> 2 OR v_debit_match <> 1 OR v_credit_match <> 1 OR v_sum_debit <> v_sum_credit THEN
        RAISE EXCEPTION 'Assertion failed (7): approved shortfall journal incorrect or unbalanced';
    END IF;

    -- 8. An overage posts the reverse: CASH_DESK debited, CASH_VARIANCE credited.
    v_session4 := sales.open_cash_session(v_cashier_token, v_warehouse_id, v_workstation, 1000.00);
    PERFORM sales.begin_cash_session_close(v_cashier_token, v_session4);

    SELECT jsonb_agg(
        jsonb_build_object(
            'denomination_id', id,
            'quantity', CASE
                WHEN code = 'DZD_1000' THEN 1
                WHEN code = 'DZD_20' THEN 1
                WHEN code = 'DZD_10' THEN 1
                ELSE 0
            END
        ) ORDER BY display_order
    )
    INTO v_counts
    FROM cash.denominations
    WHERE is_active;

    v_res := cash.submit_cash_session_count(v_cashier_token, v_session4, v_counts);

    IF v_res->>'status' <> 'CLOSED'
       OR (v_res->>'variance_amount')::numeric <> 30.00 THEN
        RAISE EXCEPTION 'Assertion failed (8): overage auto-close failed: %', v_res;
    END IF;

    SELECT je.document_id INTO v_journal_id
    FROM finance.journal_entries je
    WHERE je.source_type = 'CASH_SESSION' AND je.source_id = v_session4;

    SELECT count(*),
           sum(CASE WHEN jl.account_code = 'CASH_DESK' AND jl.debit = 30.00 AND jl.credit = 0 THEN 1 ELSE 0 END),
           sum(CASE WHEN jl.account_code = 'CASH_VARIANCE' AND jl.debit = 0 AND jl.credit = 30.00 THEN 1 ELSE 0 END),
           sum(jl.debit),
           sum(jl.credit)
    INTO v_line_count, v_debit_match, v_credit_match, v_sum_debit, v_sum_credit
    FROM finance.journal_lines jl
    WHERE jl.document_id = v_journal_id;

    IF v_line_count <> 2 OR v_debit_match <> 1 OR v_credit_match <> 1 OR v_sum_debit <> v_sum_credit THEN
        RAISE EXCEPTION 'Assertion failed (8): overage journal incorrect or unbalanced';
    END IF;

    -- 9. A cash movement is refused on a session that is not OPEN.
    v_blocked := false;
    BEGIN
        PERFORM cash.record_cash_movement(v_cashier_token, v_session4, 'CASH_OUT', 100.00, 'EXPENSE', 'Refused on closed', NULL);
    EXCEPTION WHEN SQLSTATE '55000' THEN
        v_blocked := true;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'Assertion failed (9): cash movement allowed on closed session';
    END IF;

    -- 10. A cash movement is refused for a user who is not the session's current cashier.
    v_session5 := sales.open_cash_session(v_cashier_token, v_warehouse_id, v_workstation, 1000.00);
    v_blocked := false;
    BEGIN
        PERFORM cash.record_cash_movement(v_cashier2_token, v_session5, 'CASH_OUT', 100.00, 'EXPENSE', 'Refused for other user', NULL);
    EXCEPTION WHEN SQLSTATE '42501' THEN
        v_blocked := true;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'Assertion failed (10): cash movement allowed for non-current cashier';
    END IF;

    -- 11. Movement with negative amount, zero amount, three-decimal amount, and unsupported reason each refused
    v_blocked := false;
    BEGIN
        PERFORM cash.record_cash_movement(v_cashier_token, v_session5, 'CASH_OUT', -50.00, 'EXPENSE', 'Negative', NULL);
    EXCEPTION WHEN SQLSTATE '22023' THEN v_blocked := true;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'Assertion failed (11a): negative amount allowed'; END IF;

    v_blocked := false;
    BEGIN
        PERFORM cash.record_cash_movement(v_cashier_token, v_session5, 'CASH_OUT', 0.00, 'EXPENSE', 'Zero', NULL);
    EXCEPTION WHEN SQLSTATE '22023' THEN v_blocked := true;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'Assertion failed (11b): zero amount allowed'; END IF;

    v_blocked := false;
    BEGIN
        PERFORM cash.record_cash_movement(v_cashier_token, v_session5, 'CASH_OUT', 12.345, 'EXPENSE', 'Three decimals', NULL);
    EXCEPTION WHEN SQLSTATE '22023' THEN v_blocked := true;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'Assertion failed (11c): three decimals allowed'; END IF;

    v_blocked := false;
    BEGIN
        PERFORM cash.record_cash_movement(v_cashier_token, v_session5, 'CASH_OUT', 50.00, 'UNSUPPORTED_REASON', 'Bad reason', NULL);
    EXCEPTION WHEN SQLSTATE '22023' THEN v_blocked := true;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'Assertion failed (11d): unsupported reason allowed'; END IF;

    IF EXISTS (SELECT 1 FROM cash.movements WHERE cash_session_id = v_session5) THEN
        RAISE EXCEPTION 'Assertion failed (11e): movement row written despite validation errors';
    END IF;

    -- 12. cash.movements is still append-only -- UPDATE on a movement row is refused
    v_blocked := false;
    BEGIN
        UPDATE cash.movements SET amount = 999.00 WHERE cash_session_id = v_session1;
    EXCEPTION WHEN OTHERS THEN
        v_blocked := true;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'Assertion failed (12): cash.movements allowed UPDATE mutation';
    END IF;

    -- 14. Every journal posted balances: total debits = total credits, no line has NULL account_id
    IF EXISTS (
        SELECT 1
        FROM finance.journal_lines jl
        WHERE jl.document_id IN (
            SELECT document_id FROM finance.journal_entries
            WHERE source_type IN ('CASH_MOVEMENT', 'CASH_SESSION')
        )
        AND jl.account_id IS NULL
    ) THEN
        RAISE EXCEPTION 'Assertion failed (14a): cash journal line has NULL account_id';
    END IF;

    IF EXISTS (
        SELECT jl.document_id
        FROM finance.journal_lines jl
        WHERE jl.document_id IN (
            SELECT document_id FROM finance.journal_entries
            WHERE source_type IN ('CASH_MOVEMENT', 'CASH_SESSION')
        )
        GROUP BY jl.document_id
        HAVING sum(jl.debit) <> sum(jl.credit)
    ) THEN
        RAISE EXCEPTION 'Assertion failed (14b): cash journal entries do not balance';
    END IF;

    -- Policy read/save
    v_res := cash.get_session_policy(v_cashier_token);
    IF (v_res->>'material_variance_threshold')::numeric <> 50.00 THEN
        RAISE EXCEPTION 'Assertion failed: get_session_policy returned %', v_res;
    END IF;

    v_res := cash.save_session_policy(v_manager_token, 75.00);
    IF (v_res->>'material_variance_threshold')::numeric <> 75.00 THEN
        RAISE EXCEPTION 'Assertion failed: save_session_policy returned %', v_res;
    END IF;

    PERFORM cash.save_session_policy(v_manager_token, 50.00);

    RAISE NOTICE '=== WS-F-005 integration suite completed successfully ===';
END;
$$;
