-- S4-003 Integration Test — central drawer policy, full customer payment
-- refund reversal, authorization binding, idempotency, and handover safety.
\set ON_ERROR_STOP on

DO $$
DECLARE
    v_suffix text := floor(random() * 1000000000)::bigint::text;
    v_cashier_a_name text := 's4003_cashier_a_' || v_suffix;
    v_cashier_b_name text := 's4003_cashier_b_' || v_suffix;
    v_manager_name text := 's4003_manager_' || v_suffix;
    v_cashier_a_token text := 's4003_cashier_a_token_' || v_suffix;
    v_cashier_b_token text := 's4003_cashier_b_token_' || v_suffix;
    v_manager_token text := 's4003_manager_token_' || v_suffix;
    v_workstation text := 'S4003-WKS-' || v_suffix;
    v_cashier_a_id bigint;
    v_cashier_b_id bigint;
    v_manager_id bigint;
    v_period_id bigint;
    v_period_start date;
    v_period_end date;
    v_doc_date date;
    v_unit_id bigint;
    v_warehouse_id bigint;
    v_product_id bigint;
    v_variant_id bigint;
    v_customer_id bigint;
    v_credit jsonb;
    v_credit_doc bigint;
    v_invoice_ledger bigint;
    v_cash_session_id bigint;
    v_payment_1 jsonb;
    v_payment_2 jsonb;
    v_payment_3 jsonb;
    v_payment_4 jsonb;
    v_payment_1_doc bigint;
    v_payment_2_doc bigint;
    v_payment_3_doc bigint;
    v_payment_4_doc bigint;
    v_auth_1 uuid := md5('s4003-auth-1-' || v_suffix)::uuid;
    v_auth_3 uuid := md5('s4003-auth-3-' || v_suffix)::uuid;
    v_auth_4_old uuid := md5('s4003-auth-4-old-' || v_suffix)::uuid;
    v_auth_4_new uuid := md5('s4003-auth-4-new-' || v_suffix)::uuid;
    v_refund_req_1 uuid := md5('s4003-refund-1-' || v_suffix)::uuid;
    v_refund_req_3 uuid := md5('s4003-refund-3-' || v_suffix)::uuid;
    v_refund_req_4 uuid := md5('s4003-refund-4-' || v_suffix)::uuid;
    v_refund_1 jsonb;
    v_refund_1_retry jsonb;
    v_refund_3 jsonb;
    v_refund_4 jsonb;
    v_refund_1_doc bigint;
    v_refund_3_doc bigint;
    v_refund_4_doc bigint;
    v_count bigint;
    v_exposure numeric(14,2);
    v_remaining numeric(14,2);
    v_manager_policy_blocked boolean := false;
    v_duplicate_refund_blocked boolean := false;
    v_old_cashier_blocked boolean := false;
    v_new_cashier_old_auth_blocked boolean := false;
BEGIN
    RAISE NOTICE '=== Running S4-003 drawer/refund integration suite ===';

    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES (v_cashier_a_name, 'S4003 Cashier A', 'hashed_pass')
    RETURNING id INTO v_cashier_a_id;
    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES (v_cashier_b_name, 'S4003 Cashier B', 'hashed_pass')
    RETURNING id INTO v_cashier_b_id;
    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES (v_manager_name, 'S4003 Manager', 'hashed_pass')
    RETURNING id INTO v_manager_id;

    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_cashier_a_id, id FROM iam.roles WHERE code = 'ADMIN';
    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_cashier_b_id, id FROM iam.roles WHERE code = 'ADMIN';
    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_manager_id, id FROM iam.roles WHERE code = 'MANAGER';

    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES
        (v_cashier_a_id, v_workstation, sha256(v_cashier_a_token::bytea), now() + interval '2 hours'),
        (v_cashier_b_id, v_workstation, sha256(v_cashier_b_token::bytea), now() + interval '2 hours'),
        (v_manager_id, v_workstation, sha256(v_manager_token::bytea), now() + interval '2 hours');

    SELECT id, starts_on, ends_on
    INTO v_period_id, v_period_start, v_period_end
    FROM finance.fiscal_periods
    WHERE status = 'OPEN'
    ORDER BY starts_on DESC
    LIMIT 1;
    IF v_period_id IS NULL THEN
        RAISE EXCEPTION 'S4-003 integration requires an OPEN fiscal period';
    END IF;
    v_doc_date := greatest(
        v_period_start,
        least((now() AT TIME ZONE 'Africa/Algiers')::date, v_period_end)
    );

    SELECT id INTO v_unit_id
    FROM catalog.units
    WHERE normalized_code = 'UNIT'
    LIMIT 1;
    IF v_unit_id IS NULL THEN
        RAISE EXCEPTION 'S4-003 integration requires UNIT';
    END IF;

    INSERT INTO inventory.warehouses (code, name)
    VALUES ('WH-S4003-' || v_suffix, 'S4-003 Warehouse')
    RETURNING id INTO v_warehouse_id;
    INSERT INTO catalog.products (name, is_active)
    VALUES ('S4-003 Product ' || v_suffix, true)
    RETURNING id INTO v_product_id;
    INSERT INTO catalog.product_variants (
        product_id, base_unit_id, sku, sale_price, is_active
    ) VALUES (
        v_product_id, v_unit_id, 'SKU-S4003-' || v_suffix, 100.00, true
    ) RETURNING id INTO v_variant_id;
    INSERT INTO inventory.positions (
        warehouse_id, variant_id, quantity_on_hand, total_value, last_known_wac
    ) VALUES (
        v_warehouse_id, v_variant_id, 20.000, 1200.0000, 60.000000
    );

    v_customer_id := (receivables.create_customer(
        v_cashier_a_token,
        NULL,
        'S4-003 Refund Customer',
        NULL, NULL, NULL, NULL, NULL,
        true,
        2000.00,
        30,
        60
    )->>'id')::bigint;

    v_credit := sales.confirm_credit_sale(
        v_cashier_a_token,
        md5('s4003-credit-' || v_suffix)::uuid,
        v_customer_id,
        v_warehouse_id,
        v_period_id,
        v_doc_date,
        jsonb_build_array(jsonb_build_object(
            'variant_id', v_variant_id,
            'quantity', '10',
            'unit_price', '100.00'
        )),
        NULL
    );
    v_credit_doc := (v_credit->>'document_id')::bigint;

    SELECT id INTO v_invoice_ledger
    FROM receivables.customer_ledger_entries
    WHERE customer_id = v_customer_id
      AND document_id = v_credit_doc
      AND entry_type = 'CREDIT_INVOICE';

    v_cash_session_id := sales.open_cash_session(
        v_cashier_a_token,
        v_warehouse_id,
        v_workstation,
        500.00
    );

    SELECT count(*) INTO v_count
    FROM cash.drawer_operation_policy
    WHERE is_enabled;
    IF v_count <> 7 THEN
        RAISE EXCEPTION 'Assertion failed: expected seven default-enabled drawer policies, got %', v_count;
    END IF;

    BEGIN
        PERFORM cash.update_drawer_operation_policy(
            v_manager_token,
            'CASH_SALE',
            false
        );
    EXCEPTION WHEN SQLSTATE '42501' THEN
        v_manager_policy_blocked := true;
    END;
    IF NOT v_manager_policy_blocked THEN
        RAISE EXCEPTION 'Assertion failed: non-admin manager changed drawer policy';
    END IF;

    -- Payment 1: enabled policy creates exactly one traceable drawer job.
    v_payment_1 := receivables.post_customer_payment(
        v_cashier_a_token,
        md5('s4003-payment-1-' || v_suffix)::uuid,
        v_customer_id,
        100.00,
        'CASH',
        v_cash_session_id,
        v_period_id,
        v_doc_date,
        jsonb_build_array(jsonb_build_object(
            'invoice_ledger_entry_id', v_invoice_ledger,
            'amount', '100.00'
        )),
        'First cash collection'
    );
    v_payment_1_doc := (v_payment_1->>'document_id')::bigint;

    SELECT count(*) INTO v_count
    FROM cash.drawer_jobs j
    JOIN cash.movements m ON m.id = j.cash_movement_id
    WHERE j.business_document_id = v_payment_1_doc
      AND j.operation_code = 'CUSTOMER_CASH_PAYMENT'
      AND m.movement_type = 'CUSTOMER_PAYMENT'
      AND m.amount = 100.00;
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'Assertion failed: enabled customer cash payment did not create one traceable drawer job';
    END IF;

    -- Payment 2: disabling the toggle suppresses only the physical pulse.
    PERFORM cash.update_drawer_operation_policy(
        v_cashier_a_token,
        'CUSTOMER_CASH_PAYMENT',
        false
    );
    v_payment_2 := receivables.post_customer_payment(
        v_cashier_a_token,
        md5('s4003-payment-2-' || v_suffix)::uuid,
        v_customer_id,
        50.00,
        'CASH',
        v_cash_session_id,
        v_period_id,
        v_doc_date,
        jsonb_build_array(jsonb_build_object(
            'invoice_ledger_entry_id', v_invoice_ledger,
            'amount', '50.00'
        )),
        'Drawer toggle disabled'
    );
    v_payment_2_doc := (v_payment_2->>'document_id')::bigint;

    SELECT count(*) INTO v_count
    FROM cash.movements
    WHERE business_document_id = v_payment_2_doc
      AND movement_type = 'CUSTOMER_PAYMENT'
      AND amount = 50.00;
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'Assertion failed: disabled drawer toggle changed financial cash movement';
    END IF;
    SELECT count(*) INTO v_count
    FROM cash.drawer_jobs
    WHERE business_document_id = v_payment_2_doc;
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'Assertion failed: disabled drawer toggle still created a pulse job';
    END IF;
    PERFORM cash.update_drawer_operation_policy(
        v_cashier_a_token,
        'CUSTOMER_CASH_PAYMENT',
        true
    );

    -- Payment 3 is non-cash and must never touch the cash ledger or drawer.
    v_payment_3 := receivables.post_customer_payment(
        v_cashier_a_token,
        md5('s4003-payment-3-' || v_suffix)::uuid,
        v_customer_id,
        80.00,
        'BANK_TRANSFER',
        NULL,
        v_period_id,
        v_doc_date,
        jsonb_build_array(jsonb_build_object(
            'invoice_ledger_entry_id', v_invoice_ledger,
            'amount', '80.00'
        )),
        'Bank collection'
    );
    v_payment_3_doc := (v_payment_3->>'document_id')::bigint;
    SELECT count(*) INTO v_count
    FROM cash.movements
    WHERE business_document_id = v_payment_3_doc;
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'Assertion failed: bank customer payment created a cash movement';
    END IF;
    SELECT count(*) INTO v_count
    FROM cash.drawer_jobs
    WHERE business_document_id = v_payment_3_doc;
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'Assertion failed: bank customer payment created a drawer job';
    END IF;

    -- Cash refund 1: manager authorization, negative movement, one drawer job,
    -- append-only exposure/allocation reversal, and idempotent retry.
    PERFORM receivables.authorize_customer_payment_refund(
        v_manager_token,
        v_auth_1,
        v_payment_1_doc,
        'CASH',
        v_cash_session_id,
        'Duplicate cash collection',
        15
    );
    v_refund_1 := receivables.post_customer_refund(
        v_cashier_a_token,
        v_refund_req_1,
        v_auth_1,
        v_period_id,
        v_doc_date,
        'Refund first payment'
    );
    v_refund_1_doc := (v_refund_1->>'document_id')::bigint;

    SELECT count(*) INTO v_count
    FROM cash.movements
    WHERE business_document_id = v_refund_1_doc
      AND cash_session_id = v_cash_session_id
      AND movement_type = 'CUSTOMER_REFUND'
      AND amount = -100.00;
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'Assertion failed: cash refund negative movement missing';
    END IF;
    SELECT count(*) INTO v_count
    FROM cash.drawer_jobs j
    JOIN cash.movements m ON m.id = j.cash_movement_id
    WHERE j.business_document_id = v_refund_1_doc
      AND j.operation_code = 'CUSTOMER_CASH_REFUND'
      AND m.amount = -100.00;
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'Assertion failed: cash refund drawer job missing or untraceable';
    END IF;

    SELECT exposure_amount INTO v_exposure
    FROM receivables.customer_credit_state
    WHERE customer_id = v_customer_id;
    IF v_exposure <> 870.00 THEN
        RAISE EXCEPTION 'Assertion failed: exposure after first refund expected 870, got %', v_exposure;
    END IF;

    SELECT amount_delta - receivables.net_invoice_allocated_amount(id)
    INTO v_remaining
    FROM receivables.customer_ledger_entries
    WHERE id = v_invoice_ledger;
    IF v_remaining <> 870.00 THEN
        RAISE EXCEPTION 'Assertion failed: invoice remaining after first refund expected 870, got %', v_remaining;
    END IF;

    v_refund_1_retry := receivables.post_customer_refund(
        v_cashier_a_token,
        v_refund_req_1,
        v_auth_1,
        v_period_id,
        v_doc_date,
        'Refund first payment'
    );
    IF (v_refund_1_retry->>'document_id')::bigint <> v_refund_1_doc THEN
        RAISE EXCEPTION 'Assertion failed: refund retry returned another document';
    END IF;
    SELECT count(*) INTO v_count
    FROM cash.movements
    WHERE business_document_id = v_refund_1_doc;
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'Assertion failed: refund retry duplicated cash movement';
    END IF;
    SELECT count(*) INTO v_count
    FROM cash.drawer_jobs
    WHERE business_document_id = v_refund_1_doc;
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'Assertion failed: refund retry duplicated drawer job';
    END IF;

    BEGIN
        PERFORM receivables.authorize_customer_payment_refund(
            v_manager_token,
            md5('s4003-duplicate-auth-' || v_suffix)::uuid,
            v_payment_1_doc,
            'CASH',
            v_cash_session_id,
            'Second refund attempt',
            15
        );
    EXCEPTION WHEN SQLSTATE '55000' THEN
        v_duplicate_refund_blocked := true;
    END;
    IF NOT v_duplicate_refund_blocked THEN
        RAISE EXCEPTION 'Assertion failed: already refunded payment was authorized again';
    END IF;

    -- Bank refund restores exposure without a drawer/cash side effect.
    PERFORM receivables.authorize_customer_payment_refund(
        v_manager_token,
        v_auth_3,
        v_payment_3_doc,
        'BANK_TRANSFER',
        NULL,
        'Reverse bank collection',
        15
    );
    v_refund_3 := receivables.post_customer_refund(
        v_cashier_a_token,
        v_refund_req_3,
        v_auth_3,
        v_period_id,
        v_doc_date,
        'Bank refund'
    );
    v_refund_3_doc := (v_refund_3->>'document_id')::bigint;
    SELECT count(*) INTO v_count
    FROM cash.movements
    WHERE business_document_id = v_refund_3_doc;
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'Assertion failed: bank refund created a cash movement';
    END IF;
    SELECT count(*) INTO v_count
    FROM cash.drawer_jobs
    WHERE business_document_id = v_refund_3_doc;
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'Assertion failed: bank refund created a drawer job';
    END IF;

    -- Payment 4 proves a handover invalidates the old cashier-bound approval.
    v_payment_4 := receivables.post_customer_payment(
        v_cashier_a_token,
        md5('s4003-payment-4-' || v_suffix)::uuid,
        v_customer_id,
        60.00,
        'CASH',
        v_cash_session_id,
        v_period_id,
        v_doc_date,
        jsonb_build_array(jsonb_build_object(
            'invoice_ledger_entry_id', v_invoice_ledger,
            'amount', '60.00'
        )),
        'Handover refund binding'
    );
    v_payment_4_doc := (v_payment_4->>'document_id')::bigint;

    PERFORM receivables.authorize_customer_payment_refund(
        v_manager_token,
        v_auth_4_old,
        v_payment_4_doc,
        'CASH',
        v_cash_session_id,
        'Authorize before handover',
        15
    );
    PERFORM sales.suspend_cash_session(
        v_cashier_a_token,
        v_cash_session_id,
        'Shift handover'
    );
    PERFORM sales.handover_cash_session(
        v_manager_token,
        v_cash_session_id,
        v_cashier_b_name,
        'Shift change'
    );
    PERFORM sales.resume_cash_session(v_cashier_b_token, v_cash_session_id);

    BEGIN
        PERFORM receivables.post_customer_refund(
            v_cashier_a_token,
            md5('s4003-old-cashier-fail-' || v_suffix)::uuid,
            v_auth_4_old,
            v_period_id,
            v_doc_date,
            NULL
        );
    EXCEPTION WHEN SQLSTATE '42501' THEN
        v_old_cashier_blocked := true;
    END;
    IF NOT v_old_cashier_blocked THEN
        RAISE EXCEPTION 'Assertion failed: old cashier posted refund after handover';
    END IF;

    BEGIN
        PERFORM receivables.post_customer_refund(
            v_cashier_b_token,
            md5('s4003-new-cashier-old-auth-fail-' || v_suffix)::uuid,
            v_auth_4_old,
            v_period_id,
            v_doc_date,
            NULL
        );
    EXCEPTION WHEN SQLSTATE '42501' THEN
        v_new_cashier_old_auth_blocked := true;
    END;
    IF NOT v_new_cashier_old_auth_blocked THEN
        RAISE EXCEPTION 'Assertion failed: new cashier reused old cashier-bound refund authorization';
    END IF;

    SELECT count(*) INTO v_count
    FROM receivables.customer_payment_refunds
    WHERE source_payment_document_id = v_payment_4_doc;
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'Assertion failed: rejected handover refund created a financial document';
    END IF;

    PERFORM receivables.authorize_customer_payment_refund(
        v_manager_token,
        v_auth_4_new,
        v_payment_4_doc,
        'CASH',
        v_cash_session_id,
        'Authorize current cashier after handover',
        15
    );
    v_refund_4 := receivables.post_customer_refund(
        v_cashier_b_token,
        v_refund_req_4,
        v_auth_4_new,
        v_period_id,
        v_doc_date,
        'Current cashier refund'
    );
    v_refund_4_doc := (v_refund_4->>'document_id')::bigint;

    SELECT count(*) INTO v_count
    FROM cash.movements
    WHERE business_document_id = v_refund_4_doc
      AND movement_type = 'CUSTOMER_REFUND'
      AND amount = -60.00;
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'Assertion failed: new cashier refund movement missing';
    END IF;
    SELECT count(*) INTO v_count
    FROM cash.drawer_jobs
    WHERE business_document_id = v_refund_4_doc
      AND operation_code = 'CUSTOMER_CASH_REFUND';
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'Assertion failed: new cashier refund drawer job missing';
    END IF;

    SELECT exposure_amount INTO v_exposure
    FROM receivables.customer_credit_state
    WHERE customer_id = v_customer_id;
    IF v_exposure <> 950.00 THEN
        RAISE EXCEPTION 'Assertion failed: final exposure expected 950, got %', v_exposure;
    END IF;

    SELECT count(*) INTO v_count
    FROM (
        SELECT jl.document_id
        FROM receivables.customer_payment_refunds r
        JOIN finance.journal_lines jl ON jl.document_id = r.journal_document_id
        WHERE r.customer_id = v_customer_id
        GROUP BY jl.document_id
        HAVING sum(jl.debit) <> sum(jl.credit)
    ) bad;
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'Assertion failed: customer refund journal is unbalanced';
    END IF;

    RAISE NOTICE 'PASSED: S4-003 central drawer policy, toggles, customer cash/bank refunds, idempotency, and handover binding';
END;
$$;
