-- WS-F-003 integration test: POS cash sale fixed discount, ledger posting (SCF 709),
-- cash movement amount, COGS isolation, permission gating, and idempotency.
\set ON_ERROR_STOP on

DO $$
DECLARE
    v_suffix text := floor(random() * 1000000000)::bigint::text;
    v_workstation text := 'WSF003-WKS-' || v_suffix;
    v_manager_username text := 'wsf003_mgr_' || v_suffix;
    v_cashier_username text := 'wsf003_csh_' || v_suffix;
    v_manager_token text := 'wsf003_mgr_tok_' || v_suffix;
    v_cashier_token text := 'wsf003_csh_tok_' || v_suffix;
    v_manager_id bigint;
    v_cashier_id bigint;
    v_warehouse_id bigint;
    v_period_id bigint;
    v_session_id bigint;
    v_product_id bigint;
    v_variant_id bigint;
    v_unit_id bigint;
    v_lines jsonb;
    v_doc_date date;
    v_req1 uuid := md5('wsf003-req1-' || v_suffix)::uuid;
    v_req2 uuid := md5('wsf003-req2-' || v_suffix)::uuid;
    v_req3 uuid := md5('wsf003-req3-' || v_suffix)::uuid;
    v_req4 uuid := md5('wsf003-req4-' || v_suffix)::uuid;
    v_doc1 bigint;
    v_doc2 bigint;
    v_doc_replay bigint;
    v_subtotal numeric(14,2);
    v_discount numeric(14,2);
    v_total numeric(14,2);
    v_movement_amount numeric(14,2);
    v_debits numeric(14,2);
    v_credits numeric(14,2);
    v_scf53_debit numeric(14,2);
    v_scf709_debit numeric(14,2);
    v_scf70_credit numeric(14,2);
    v_cogs_debit numeric(14,2);
    v_count bigint;
    v_err_caught boolean;
    v_caps jsonb;
BEGIN
    RAISE NOTICE '=== Running WS-F-003 sale discount integration suite ===';

    -- 1. Setup users: manager (has APPLY_SALE_DISCOUNT) and cashier (only CASHIER role, lacks APPLY_SALE_DISCOUNT)
    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES (v_manager_username, 'WSF003 Manager', 'hashed_pass')
    RETURNING id INTO v_manager_id;

    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES (v_cashier_username, 'WSF003 Cashier', 'hashed_pass')
    RETURNING id INTO v_cashier_id;

    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_manager_id, id FROM iam.roles WHERE code = 'MANAGER';

    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_cashier_id, id FROM iam.roles WHERE code = 'CASHIER';

    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES
        (v_manager_id, v_workstation, sha256(v_manager_token::bytea), now() + interval '2 hours'),
        (v_cashier_id, v_workstation, sha256(v_cashier_token::bytea), now() + interval '2 hours');

    -- Check capabilities
    v_caps := receivables.get_customer_capabilities(v_manager_token);
    IF NOT (v_caps->>'can_apply_sale_discount')::boolean THEN
        RAISE EXCEPTION 'Assertion failed: MANAGER should have can_apply_sale_discount = true';
    END IF;

    v_caps := receivables.get_customer_capabilities(v_cashier_token);
    IF (v_caps->>'can_apply_sale_discount')::boolean THEN
        RAISE EXCEPTION 'Assertion failed: CASHIER should have can_apply_sale_discount = false';
    END IF;

    -- Setup warehouse, fiscal period
    INSERT INTO inventory.warehouses (code, name, is_active)
    VALUES ('WH-WSF003-' || v_suffix, 'Warehouse WSF003', true)
    RETURNING id INTO v_warehouse_id;

    SELECT id, starts_on
    INTO v_period_id, v_doc_date
    FROM finance.fiscal_periods
    WHERE status = 'OPEN'
    ORDER BY starts_on DESC
    LIMIT 1;

    IF v_period_id IS NULL THEN
        RAISE EXCEPTION 'Assertion failed: OPEN fiscal period is required';
    END IF;

    -- Setup product & variant with stock
    SELECT id INTO v_unit_id
    FROM catalog.units
    LIMIT 1;

    INSERT INTO catalog.products (name, is_active)
    VALUES ('Product WSF003 ' || v_suffix, true)
    RETURNING id INTO v_product_id;

    INSERT INTO catalog.product_variants (
        product_id, base_unit_id, sku, sale_price, is_active
    ) VALUES (
        v_product_id, v_unit_id, 'SKU-WSF003-' || v_suffix, 5000.00, true
    ) RETURNING id INTO v_variant_id;

    -- Seed inventory position: 10 units at WAC 3000.00
    INSERT INTO inventory.positions (
        warehouse_id, variant_id, quantity_on_hand, total_value, last_known_wac
    ) VALUES (
        v_warehouse_id, v_variant_id, 10.000, 30000.0000, 3000.000000
    );

    -- Open cash session
    v_session_id := sales.open_cash_session(
        v_manager_token, v_warehouse_id, v_workstation, 1000.00
    );

    -- Lines JSON for 1 unit at 5000.00
    v_lines := jsonb_build_array(
        jsonb_build_object(
            'variant_id', v_variant_id,
            'quantity', 1.000,
            'unit_price', 5000.00
        )
    );

    -- TEST 1: Undiscounted cash sale (subtotal 5000.00, discount 0.00)
    v_doc1 := sales.confirm_cash_sale(
        v_manager_token,
        v_req1,
        sha256(convert_to(v_lines::text || ':0.00', 'UTF8')),
        v_session_id,
        v_warehouse_id,
        v_period_id,
        v_doc_date,
        v_lines,
        0.00
    );

    SELECT subtotal, discount_amount, total_amount
    INTO v_subtotal, v_discount, v_total
    FROM sales.cash_sales
    WHERE document_id = v_doc1;

    IF v_subtotal <> 5000.00 OR v_discount <> 0.00 OR v_total <> 5000.00 THEN
        RAISE EXCEPTION 'Assertion failed: undiscounted sale amounts mismatch: subtotal %, discount %, total %',
            v_subtotal, v_discount, v_total;
    END IF;

    -- Cash movement should be 5000.00
    SELECT amount INTO v_movement_amount
    FROM cash.movements
    WHERE cash_session_id = v_session_id AND business_document_id = v_doc1;

    IF v_movement_amount <> 5000.00 THEN
        RAISE EXCEPTION 'Assertion failed: undiscounted cash movement expected 5000.00, got %', v_movement_amount;
    END IF;

    -- TEST 2: Discounted cash sale (subtotal 5000.00, discount 200.00, net 4800.00)
    v_doc2 := sales.confirm_cash_sale(
        v_manager_token,
        v_req2,
        sha256(convert_to(v_lines::text || ':200.00', 'UTF8')),
        v_session_id,
        v_warehouse_id,
        v_period_id,
        v_doc_date,
        v_lines,
        200.00
    );

    SELECT subtotal, discount_amount, total_amount
    INTO v_subtotal, v_discount, v_total
    FROM sales.cash_sales
    WHERE document_id = v_doc2;

    IF v_subtotal <> 5000.00 OR v_discount <> 200.00 OR v_total <> 4800.00 THEN
        RAISE EXCEPTION 'Assertion failed: discounted sale amounts mismatch: subtotal %, discount %, total %',
            v_subtotal, v_discount, v_total;
    END IF;

    -- Cash movement should be net 4800.00
    SELECT amount INTO v_movement_amount
    FROM cash.movements
    WHERE cash_session_id = v_session_id AND business_document_id = v_doc2;

    IF v_movement_amount <> 4800.00 THEN
        RAISE EXCEPTION 'Assertion failed: discounted cash movement expected 4800.00, got %', v_movement_amount;
    END IF;

    -- Check Accounting Journal lines for v_doc2:
    -- Sum of Debits must equal sum of Credits
    SELECT coalesce(sum(debit), 0), coalesce(sum(credit), 0)
    INTO v_debits, v_credits
    FROM finance.journal_lines jl
    JOIN finance.journal_entries je ON je.document_id = jl.document_id
    WHERE je.source_id = v_doc2 AND je.source_type = 'CASH_SALE';

    IF v_debits <> v_credits THEN
        RAISE EXCEPTION 'Assertion failed: journal unbalanced for discounted sale: debits %, credits %',
            v_debits, v_credits;
    END IF;

    -- Check 3 distinct revenue/cash lines:
    -- CASH_DESK has debit 4800.00
    SELECT coalesce(sum(debit), 0) INTO v_scf53_debit
    FROM finance.journal_lines jl
    JOIN finance.journal_entries je ON je.document_id = jl.document_id
    WHERE je.source_id = v_doc2 AND je.source_type = 'CASH_SALE' AND jl.account_code = 'CASH_DESK';

    IF v_scf53_debit <> 4800.00 THEN
        RAISE EXCEPTION 'Assertion failed: CASH_DESK debit expected 4800.00, got %', v_scf53_debit;
    END IF;

    -- SALES_DISCOUNT has debit 200.00
    SELECT coalesce(sum(debit), 0) INTO v_scf709_debit
    FROM finance.journal_lines jl
    JOIN finance.journal_entries je ON je.document_id = jl.document_id
    WHERE je.source_id = v_doc2 AND je.source_type = 'CASH_SALE' AND jl.account_code = 'SALES_DISCOUNT';

    IF v_scf709_debit <> 200.00 THEN
        RAISE EXCEPTION 'Assertion failed: SALES_DISCOUNT debit expected 200.00, got %', v_scf709_debit;
    END IF;

    -- SALES_REVENUE has credit 5000.00
    SELECT coalesce(sum(credit), 0) INTO v_scf70_credit
    FROM finance.journal_lines jl
    JOIN finance.journal_entries je ON je.document_id = jl.document_id
    WHERE je.source_id = v_doc2 AND je.source_type = 'CASH_SALE' AND jl.account_code = 'SALES_REVENUE';

    IF v_scf70_credit <> 5000.00 THEN
        RAISE EXCEPTION 'Assertion failed: SALES_REVENUE credit expected 5000.00, got %', v_scf70_credit;
    END IF;

    -- Verify COGS: COGS debit is 3000.00 (1 unit * WAC 3000.00)
    SELECT coalesce(sum(debit), 0) INTO v_cogs_debit
    FROM finance.journal_lines jl
    JOIN finance.journal_entries je ON je.document_id = jl.document_id
    WHERE je.source_id = v_doc2 AND je.source_type = 'CASH_SALE' AND jl.account_code = 'COGS';

    IF v_cogs_debit <> 3000.00 THEN
        RAISE EXCEPTION 'Assertion failed: COGS expected 3000.00, got %', v_cogs_debit;
    END IF;

    -- TEST 3: Idempotency replay with same request_id
    v_doc_replay := sales.confirm_cash_sale(
        v_manager_token,
        v_req2,
        sha256(convert_to(v_lines::text || ':200.00', 'UTF8')),
        v_session_id,
        v_warehouse_id,
        v_period_id,
        v_doc_date,
        v_lines,
        200.00
    );

    IF v_doc_replay <> v_doc2 THEN
        RAISE EXCEPTION 'Assertion failed: replay returned % instead of %', v_doc_replay, v_doc2;
    END IF;

    -- Verify no duplicate cash movement or drawer jobs
    SELECT count(*) INTO v_count
    FROM cash.movements
    WHERE cash_session_id = v_session_id AND business_document_id = v_doc2;

    IF v_count <> 1 THEN
        RAISE EXCEPTION 'Assertion failed: duplicate cash movements created on replay: count %', v_count;
    END IF;

    -- TEST 4: Validation rejections
    -- 4a: Negative discount
    v_err_caught := false;
    BEGIN
        PERFORM sales.confirm_cash_sale(
            v_manager_token,
            v_req3,
            sha256(convert_to(v_lines::text || ':-50.00', 'UTF8')),
            v_session_id,
            v_warehouse_id,
            v_period_id,
            v_doc_date,
            v_lines,
            -50.00
        );
    EXCEPTION WHEN OTHERS THEN
        v_err_caught := true;
    END;
    IF NOT v_err_caught THEN
        RAISE EXCEPTION 'Assertion failed: negative discount was not rejected';
    END IF;

    -- 4b: Discount exceeds subtotal (6000.00 > 5000.00)
    v_err_caught := false;
    BEGIN
        PERFORM sales.confirm_cash_sale(
            v_manager_token,
            v_req3,
            sha256(convert_to(v_lines::text || ':6000.00', 'UTF8')),
            v_session_id,
            v_warehouse_id,
            v_period_id,
            v_doc_date,
            v_lines,
            6000.00
        );
    EXCEPTION WHEN OTHERS THEN
        v_err_caught := true;
    END;
    IF NOT v_err_caught THEN
        RAISE EXCEPTION 'Assertion failed: excessive discount was not rejected';
    END IF;

    -- 4c: Cashier without permission trying to apply discount (200.00)
    v_err_caught := false;
    BEGIN
        PERFORM sales.confirm_cash_sale(
            v_cashier_token,
            v_req4,
            sha256(convert_to(v_lines::text || ':200.00', 'UTF8')),
            v_session_id,
            v_warehouse_id,
            v_period_id,
            v_doc_date,
            v_lines,
            200.00
        );
    EXCEPTION WHEN OTHERS THEN
        v_err_caught := true;
    END;
    IF NOT v_err_caught THEN
        RAISE EXCEPTION 'Assertion failed: cashier without permission applying discount was not rejected';
    END IF;

    RAISE NOTICE '=== WS-F-003 sale discount integration suite PASSED ===';
END $$;
