-- WS-F-004 Integration Test — customer credit limit warning, over-limit posting,
-- overdue block retention, override consumption, ledger, journal, and idempotency.
\set ON_ERROR_STOP on

DO $$
DECLARE
    v_suffix text := floor(random() * 1000000000)::bigint::text;
    v_username text := 'wsf004_admin_' || v_suffix;
    v_session_token text := 'wsf004_token_' || v_suffix;
    v_user_id bigint;
    v_period_id bigint;
    v_period_start date;
    v_period_end date;
    v_doc_date date;
    v_warehouse_id bigint;
    v_product_id bigint;
    v_variant_id bigint;
    v_unit_id bigint;
    v_customer_json jsonb;
    v_customer_id bigint;
    v_inactive_customer_id bigint;
    v_nocredit_customer_id bigint;
    v_overdue_customer_id bigint;
    v_lines jsonb;
    v_req1 uuid := md5('wsf004-r1-' || v_suffix)::uuid;
    v_req2 uuid := md5('wsf004-r2-' || v_suffix)::uuid;
    v_req_inactive uuid := md5('wsf004-inactive-' || v_suffix)::uuid;
    v_req_nocredit uuid := md5('wsf004-nocredit-' || v_suffix)::uuid;
    v_req_overdue uuid := md5('wsf004-overdue-' || v_suffix)::uuid;
    v_override uuid := md5('wsf004-override-' || v_suffix)::uuid;
    v_result1 jsonb;
    v_result2 jsonb;
    v_retry jsonb;
    v_result_overdue jsonb;
    v_doc1 bigint;
    v_doc2 bigint;
    v_doc_overdue bigint;
    v_journal_id bigint;
    v_over_limit_stored boolean;
    v_journal_debits numeric(14,2);
    v_journal_credits numeric(14,2);
    v_ledger_entry_count bigint;
    v_err_caught boolean := false;
    v_err_msg text;
BEGIN
    RAISE NOTICE '=== Running WS-F-004 credit limit warning integration suite ===';

    -- 1. Setup administrative user & session
    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES (v_username, 'WSF004 Admin', 'hashed_pass')
    RETURNING id INTO v_user_id;

    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_user_id, r.id FROM iam.roles r WHERE r.code = 'ADMIN';

    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_user_id, 'TEST-WKS-WSF004-' || v_suffix, sha256(v_session_token::bytea), now() + interval '2 hours');

    -- Open fiscal period
    SELECT id, starts_on, ends_on
    INTO v_period_id, v_period_start, v_period_end
    FROM finance.fiscal_periods
    WHERE status = 'OPEN'
    ORDER BY starts_on DESC
    LIMIT 1;

    IF v_period_id IS NULL THEN
        RAISE EXCEPTION 'WS-F-004 integration test requires one OPEN fiscal period';
    END IF;

    v_doc_date := greatest(v_period_start, least((now() AT TIME ZONE 'Africa/Algiers')::date, v_period_end));

    -- Unit, warehouse, product & variant with ample stock
    SELECT id INTO v_unit_id FROM catalog.units WHERE normalized_code = 'UNIT' LIMIT 1;
    IF v_unit_id IS NULL THEN
        RAISE EXCEPTION 'WS-F-004 integration test requires canonical UNIT catalog unit';
    END IF;

    INSERT INTO inventory.warehouses (code, name)
    VALUES ('WH-WSF004-' || v_suffix, 'WSF004 Warehouse')
    RETURNING id INTO v_warehouse_id;

    INSERT INTO catalog.products (name, is_active)
    VALUES ('WSF004 Item ' || v_suffix, true)
    RETURNING id INTO v_product_id;

    INSERT INTO catalog.product_variants (
        product_id, base_unit_id, sku, sale_price, is_active
    ) VALUES (
        v_product_id, v_unit_id, 'SKU-WSF004-' || v_suffix, 600.00, true
    ) RETURNING id INTO v_variant_id;

    INSERT INTO inventory.positions (
        warehouse_id, variant_id, quantity_on_hand, total_value, last_known_wac
    ) VALUES (
        v_warehouse_id, v_variant_id, 50.000, 5000.0000, 100.000000
    );

    v_lines := jsonb_build_array(
        jsonb_build_object(
            'variant_id', v_variant_id,
            'quantity', '1',
            'unit_price', '600.00'
        )
    );

    -- Customer with limit 1,000.00, 30-day terms, 60-day overdue window
    v_customer_json := receivables.create_customer(
        v_session_token,
        'CUS-WSF004-' || v_suffix,
        'WSF004 Regular Customer',
        NULL, NULL, NULL, NULL, NULL,
        true, 1000.00, 30, 60
    );
    v_customer_id := (v_customer_json ->> 'id')::bigint;

    -- =========================================================================
    -- Requirement 1: Credit sale of 600 within 1,000 limit -> over_limit is false
    -- =========================================================================
    v_result1 := sales.confirm_credit_sale(
        v_session_token, v_req1,
        v_customer_id, v_warehouse_id, v_period_id, v_doc_date,
        v_lines, NULL
    );
    v_doc1 := (v_result1 ->> 'document_id')::bigint;

    IF (v_result1 ->> 'total_amount')::numeric <> 600.00 THEN
        RAISE EXCEPTION 'Req 1 failed: first sale total is not 600.00';
    END IF;
    IF (v_result1 ->> 'exposure_amount')::numeric <> 600.00 THEN
        RAISE EXCEPTION 'Req 1 failed: first sale exposure is not 600.00';
    END IF;
    IF (v_result1 ->> 'available_credit')::numeric <> 400.00 THEN
        RAISE EXCEPTION 'Req 1 failed: first sale available_credit is not 400.00';
    END IF;
    IF (v_result1 ->> 'over_limit')::boolean IS NOT FALSE THEN
        RAISE EXCEPTION 'Req 1 failed: returned over_limit is not false';
    END IF;

    SELECT over_limit_at_posting INTO v_over_limit_stored
    FROM sales.credit_sales WHERE document_id = v_doc1;
    IF v_over_limit_stored IS NOT FALSE THEN
        RAISE EXCEPTION 'Req 1 failed: stored over_limit_at_posting is not false';
    END IF;

    -- =========================================================================
    -- Requirement 2: Second sale of 600 (exposure becomes 1,200 > 1,000)
    -- Posts successfully with NO override token; over_limit is true
    -- =========================================================================
    v_result2 := sales.confirm_credit_sale(
        v_session_token, v_req2,
        v_customer_id, v_warehouse_id, v_period_id, v_doc_date,
        v_lines, NULL
    );
    v_doc2 := (v_result2 ->> 'document_id')::bigint;

    IF (v_result2 ->> 'total_amount')::numeric <> 600.00 THEN
        RAISE EXCEPTION 'Req 2 failed: second sale total is not 600.00';
    END IF;
    IF (v_result2 ->> 'over_limit')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'Req 2 failed: returned over_limit is not true for over-limit sale';
    END IF;

    SELECT over_limit_at_posting INTO v_over_limit_stored
    FROM sales.credit_sales WHERE document_id = v_doc2;
    IF v_over_limit_stored IS NOT TRUE THEN
        RAISE EXCEPTION 'Req 2 failed: stored over_limit_at_posting is not true';
    END IF;

    -- =========================================================================
    -- Requirement 3: After two sales, exposure is 1,200 and available_credit is -200.00
    -- =========================================================================
    IF (v_result2 ->> 'exposure_amount')::numeric <> 1200.00 THEN
        RAISE EXCEPTION 'Req 3 failed: exposure_amount expected 1200.00, got %', (v_result2 ->> 'exposure_amount');
    END IF;
    IF (v_result2 ->> 'available_credit')::numeric <> -200.00 THEN
        RAISE EXCEPTION 'Req 3 failed: available_credit expected -200.00, got %', (v_result2 ->> 'available_credit');
    END IF;

    -- =========================================================================
    -- Requirement 4: Balanced journal for the over-limit sale (AR Dr 600, Rev Cr 600)
    -- =========================================================================
    v_journal_id := (v_result2 ->> 'journal_document_id')::bigint;
    IF v_journal_id IS NULL THEN
        RAISE EXCEPTION 'Req 4 failed: over-limit sale has no journal document id';
    END IF;

    SELECT sum(debit), sum(credit)
    INTO v_journal_debits, v_journal_credits
    FROM finance.journal_lines
    WHERE document_id = v_journal_id;

    IF v_journal_debits <> v_journal_credits THEN
        RAISE EXCEPTION 'Req 4 failed: over-limit sale journal is unbalanced (% vs %)', v_journal_debits, v_journal_credits;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM finance.journal_lines
        WHERE document_id = v_journal_id AND account_code = 'ACCOUNTS_RECEIVABLE' AND debit = 600.00
    ) THEN
        RAISE EXCEPTION 'Req 4 failed: missing ACCOUNTS_RECEIVABLE debit 600.00';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM finance.journal_lines
        WHERE document_id = v_journal_id AND account_code = 'SALES_REVENUE' AND credit = 600.00
    ) THEN
        RAISE EXCEPTION 'Req 4 failed: missing SALES_REVENUE credit 600.00';
    END IF;

    -- =========================================================================
    -- Requirement 5: Customer ledger gained CREDIT_INVOICE of 600.00
    -- =========================================================================
    SELECT count(*) INTO v_ledger_entry_count
    FROM receivables.customer_ledger_entries
    WHERE customer_id = v_customer_id
      AND document_id = v_doc2
      AND entry_type = 'CREDIT_INVOICE'
      AND amount_delta = 600.00;

    IF v_ledger_entry_count <> 1 THEN
        RAISE EXCEPTION 'Req 5 failed: customer_ledger_entries missing CREDIT_INVOICE for over-limit sale';
    END IF;

    -- =========================================================================
    -- Requirement 6: Inactive customer is still refused
    -- =========================================================================
    INSERT INTO receivables.customers (
        code, name, is_active, credit_enabled, credit_limit, payment_terms_days, max_overdue_days
    ) VALUES (
        'CUS-INACT-' || v_suffix, 'Inactive Customer', false, true, 5000.00, 30, 60
    ) RETURNING id INTO v_inactive_customer_id;

    v_err_caught := false;
    BEGIN
        PERFORM sales.confirm_credit_sale(
            v_session_token, v_req_inactive,
            v_inactive_customer_id, v_warehouse_id, v_period_id, v_doc_date,
            v_lines, NULL
        );
    EXCEPTION WHEN SQLSTATE '55000' THEN
        GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT;
        IF v_err_msg LIKE '%customer is inactive%' THEN
            v_err_caught := true;
        END IF;
    END;

    IF NOT v_err_caught THEN
        RAISE EXCEPTION 'Req 6 failed: inactive customer was not refused with expected message';
    END IF;

    -- =========================================================================
    -- Requirement 7: Customer with credit_enabled = false is still refused
    -- =========================================================================
    INSERT INTO receivables.customers (
        code, name, is_active, credit_enabled, credit_limit, payment_terms_days, max_overdue_days
    ) VALUES (
        'CUS-NOCRED-' || v_suffix, 'No Credit Customer', true, false, 0.00, 0, NULL
    ) RETURNING id INTO v_nocredit_customer_id;

    v_err_caught := false;
    BEGIN
        PERFORM sales.confirm_credit_sale(
            v_session_token, v_req_nocredit,
            v_nocredit_customer_id, v_warehouse_id, v_period_id, v_doc_date,
            v_lines, NULL
        );
    EXCEPTION WHEN SQLSTATE '55000' THEN
        GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT;
        IF v_err_msg LIKE '%customer is not enabled for credit sales%' THEN
            v_err_caught := true;
        END IF;
    END;

    IF NOT v_err_caught THEN
        RAISE EXCEPTION 'Req 7 failed: customer with credit disabled was not refused';
    END IF;

    -- =========================================================================
    -- Requirement 8: Overdue customer without override is refused with overdue message
    -- =========================================================================
    INSERT INTO receivables.customers (
        code, name, is_active, credit_enabled, credit_limit, payment_terms_days, max_overdue_days
    ) VALUES (
        'CUS-OVERDUE-' || v_suffix, 'Overdue Customer', true, true, 5000.00, 30, 10
    ) RETURNING id INTO v_overdue_customer_id;

    -- Oldest open due date 20 days ago, exceeding max_overdue_days (10)
    UPDATE receivables.customer_credit_state
    SET exposure_amount = 500.00,
        oldest_open_due_date = (now() AT TIME ZONE 'Africa/Algiers')::date - 20
    WHERE customer_id = v_overdue_customer_id;

    v_err_caught := false;
    BEGIN
        PERFORM sales.confirm_credit_sale(
            v_session_token, v_req_overdue,
            v_overdue_customer_id, v_warehouse_id, v_period_id, v_doc_date,
            v_lines, NULL
        );
    EXCEPTION WHEN SQLSTATE '55000' THEN
        GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT;
        IF v_err_msg LIKE '%customer has an overdue invoice beyond the allowed window%' THEN
            v_err_caught := true;
        END IF;
    END;

    IF NOT v_err_caught THEN
        RAISE EXCEPTION 'Req 8 failed: overdue customer without override was not refused with overdue message, got: %', v_err_msg;
    END IF;

    -- =========================================================================
    -- Requirement 9: Overdue sale SUCCEEDS with valid override token and consumes it
    -- =========================================================================
    PERFORM receivables.authorize_credit_override(
        v_session_token, v_override,
        v_overdue_customer_id, v_warehouse_id, v_period_id, v_doc_date, v_lines,
        'Authorized overdue invoice credit sale by manager', 15
    );

    v_result_overdue := sales.confirm_credit_sale(
        v_session_token, v_req_overdue,
        v_overdue_customer_id, v_warehouse_id, v_period_id, v_doc_date,
        v_lines, v_override
    );
    v_doc_overdue := (v_result_overdue ->> 'document_id')::bigint;

    IF v_doc_overdue IS NULL THEN
        RAISE EXCEPTION 'Req 9 failed: overdue sale with override did not return document_id';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM receivables.credit_override_tokens
        WHERE id = v_override AND consumed_at IS NOT NULL AND consumed_document_id = v_doc_overdue
    ) THEN
        RAISE EXCEPTION 'Req 9 failed: override token was not consumed by the posted sale';
    END IF;

    -- =========================================================================
    -- Requirement 10: Idempotent replay of over-limit sale returns same doc & over_limit
    -- =========================================================================
    v_retry := sales.confirm_credit_sale(
        v_session_token, v_req2,
        v_customer_id, v_warehouse_id, v_period_id, v_doc_date,
        v_lines, NULL
    );

    IF (v_retry ->> 'document_id')::bigint <> v_doc2 THEN
        RAISE EXCEPTION 'Req 10 failed: idempotent retry did not return same document id';
    END IF;
    IF (v_retry ->> 'over_limit')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'Req 10 failed: idempotent retry did not return over_limit = true';
    END IF;
    IF (v_retry ->> 'total_amount')::numeric <> 600.00 THEN
        RAISE EXCEPTION 'Req 10 failed: idempotent retry total_amount mismatch';
    END IF;

    RAISE NOTICE '=== WS-F-004 credit limit warning suite PASSED (10/10) ===';
END $$;
