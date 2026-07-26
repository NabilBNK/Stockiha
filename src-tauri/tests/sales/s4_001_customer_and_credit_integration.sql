-- S4-001 Integration Test Suite
-- Tests: customer creation, manual liability insertion, customer payment posting,
--        liability reduction, exposure cache update, and journal balance.
--
-- Run against stockiha_test database after applying all migrations.

\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
    v_token         text := 'test-s4001-token-' || gen_random_uuid();
    v_token_hash    bytea;
    v_user_id       bigint;
    v_period_id     bigint;
    v_customer_id   bigint;
    v_liability_id  bigint;
    v_result        jsonb;
    v_doc_id        bigint;
    v_remaining     numeric;
    v_exposure      numeric;
    v_debit_sum     numeric;
    v_credit_sum    numeric;
    v_fiscal_year   integer;
BEGIN
    v_token_hash := sha256(v_token::bytea);
    v_fiscal_year := extract(year FROM CURRENT_DATE)::integer;

    -- Resolve existing user and open period
    SELECT u.id INTO STRICT v_user_id FROM iam.users u WHERE u.is_active LIMIT 1;
    SELECT fp.id INTO STRICT v_period_id
    FROM finance.fiscal_periods fp WHERE fp.status = 'OPEN' LIMIT 1;

    -- Create test session (workstation_id is text in this schema)
    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_user_id, 'TEST-WS-S4001', v_token_hash, now() + interval '1 hour');

    -- Give user ADMIN role if not already present
    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_user_id, r.id FROM iam.roles r WHERE r.code = 'ADMIN'
    ON CONFLICT DO NOTHING;

    -- ── Test 1: Create customer ──────────────────────────────────────────────
    v_result := sales.create_customer(
        v_token, 'CUST-TEST-001', 'Test Client SARL', 'Ali', '+213555123456',
        'ali@test.dz', '123 Algiers Street', 'NIF-12345',
        50000.00, 30
    );
    ASSERT v_result->>'code' = 'CUST-TEST-001', 'Customer code mismatch';
    v_customer_id := (v_result->>'id')::bigint;
    RAISE NOTICE 'Test 1 PASS: Customer created id=%', v_customer_id;

    -- ── Test 2: list_customers returns new customer ──────────────────────────
    v_result := sales.list_customers(v_token, FALSE);
    ASSERT jsonb_array_length(v_result) > 0, 'list_customers returned empty array';
    RAISE NOTICE 'Test 2 PASS: list_customers returned % rows', jsonb_array_length(v_result);

    -- ── Test 3: Insert synthetic liability ────────────────────────────────────
    INSERT INTO core.business_documents
        (document_type, status, document_date, fiscal_period_id, fiscal_year,
         sequence_number, document_number, posted_at)
    VALUES ('CASH_SALE', 'POSTED', CURRENT_DATE, v_period_id, v_fiscal_year,
            9999990, 'TEST-SALE-S4001-' || v_customer_id, now())
    RETURNING id INTO v_doc_id;

    INSERT INTO sales.customer_liabilities
        (customer_id, document_id, original_amount, remaining_amount, due_date, status)
    VALUES (v_customer_id, v_doc_id, 10000.00, 10000.00, CURRENT_DATE + 30, 'OPEN')
    RETURNING id INTO v_liability_id;

    -- Set exposure to match
    UPDATE sales.customer_credit_states
    SET exposure_amount = 10000.00, last_recalculated_at = now()
    WHERE customer_id = v_customer_id;

    RAISE NOTICE 'Test 3 PASS: Synthetic liability inserted id=%', v_liability_id;

    -- ── Test 4: Post customer payment of 4000.00 ─────────────────────────────
    v_result := sales.post_customer_payment(
        v_token,
        gen_random_uuid(),
        v_customer_id,
        v_liability_id,
        4000.00,
        'CASH',
        v_period_id,
        CURRENT_DATE,
        'Test partial payment'
    );
    ASSERT v_result->>'document_number' LIKE 'CP-%',
           format('Document number not CP-formatted: %s', v_result->>'document_number');
    v_doc_id := (v_result->>'document_id')::bigint;
    RAISE NOTICE 'Test 4 PASS: Payment posted doc=%', v_result->>'document_number';

    -- ── Test 5: Liability remaining_amount reduced ───────────────────────────
    SELECT cl.remaining_amount INTO v_remaining
    FROM sales.customer_liabilities cl WHERE cl.id = v_liability_id;
    ASSERT v_remaining = 6000.00,
           format('Expected remaining=6000, got %s', v_remaining);
    RAISE NOTICE 'Test 5 PASS: Liability remaining=% (expected 6000)', v_remaining;

    -- ── Test 6: Liability status is PARTIALLY_PAID ───────────────────────────
    ASSERT (SELECT status FROM sales.customer_liabilities WHERE id = v_liability_id) = 'PARTIALLY_PAID',
           'Expected status PARTIALLY_PAID';
    RAISE NOTICE 'Test 6 PASS: Liability status=PARTIALLY_PAID';

    -- ── Test 7: Exposure cache reduced ───────────────────────────────────────
    SELECT cs.exposure_amount INTO v_exposure
    FROM sales.customer_credit_states cs WHERE cs.customer_id = v_customer_id;
    ASSERT v_exposure = 6000.00,
           format('Expected exposure=6000, got %s', v_exposure);
    RAISE NOTICE 'Test 7 PASS: Exposure=% (expected 6000)', v_exposure;

    -- ── Test 8: Journal balances (Debit = Credit) ────────────────────────────
    SELECT SUM(jl.debit), SUM(jl.credit)
    INTO v_debit_sum, v_credit_sum
    FROM finance.journal_lines jl
    WHERE jl.document_id = (v_result->>'journal_document_id')::bigint;
    ASSERT v_debit_sum = v_credit_sum AND v_debit_sum = 4000.00,
           format('Journal imbalance: debit=%s credit=%s', v_debit_sum, v_credit_sum);
    RAISE NOTICE 'Test 8 PASS: Journal balanced debit=% credit=%', v_debit_sum, v_credit_sum;

    -- ── Test 9: Full payment marks liability PAID ─────────────────────────────
    v_result := sales.post_customer_payment(
        v_token,
        gen_random_uuid(),
        v_customer_id,
        v_liability_id,
        6000.00,
        'BANK_TRANSFER',
        v_period_id,
        CURRENT_DATE,
        'Test full settlement'
    );
    ASSERT (SELECT status FROM sales.customer_liabilities WHERE id = v_liability_id) = 'PAID',
           'Expected status PAID after full payment';
    ASSERT (SELECT remaining_amount FROM sales.customer_liabilities WHERE id = v_liability_id) = 0,
           'Expected remaining_amount=0 after full payment';
    RAISE NOTICE 'Test 9 PASS: Liability fully settled, status=PAID';

    -- ── Test 10: Overpayment rejected ────────────────────────────────────────
    BEGIN
        v_result := sales.post_customer_payment(
            v_token, gen_random_uuid(), v_customer_id, v_liability_id,
            100.00, 'CASH', v_period_id, CURRENT_DATE, NULL
        );
        ASSERT FALSE, 'Overpayment should have been rejected';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Test 10 PASS: Overpayment correctly rejected: %', SQLERRM;
    END;

    RAISE NOTICE '=== ALL S4-001 ASSERTIONS PASSED ===';
END;
$$;

ROLLBACK;
