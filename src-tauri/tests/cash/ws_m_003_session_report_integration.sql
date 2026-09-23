-- WS-M-003 Integration Test: end-of-day cash session report.
-- Runs inside the transaction owned by run_current_sql_suites.sh.
\set ON_ERROR_STOP on

DO $$
DECLARE
    v_suffix text := floor(random() * 1000000000)::bigint::text;
    v_workstation text := 'WSM003-WKS-' || v_suffix;
    v_admin_username text := 'wsm003_admin_' || v_suffix;
    v_admin_token text := 'wsm003_admin_token_' || v_suffix;
    v_admin_id bigint;
    v_warehouse_id bigint;
    v_period_id bigint;
    v_doc_date date;
    v_unit_id bigint;
    v_product_id bigint;
    v_variant_id bigint;
    v_lines jsonb;
    v_counts jsonb;

    v_session1 bigint;
    v_doc_sale1 bigint;
    v_doc_sale2 bigint;
    v_void_res jsonb;

    v_customer_json jsonb;
    v_customer_id bigint;
    v_credit_result jsonb;
    v_credit_doc bigint;
    v_invoice_entry_id bigint;

    v_report jsonb;
    v_res jsonb;
    v_blocked boolean;
BEGIN
    RAISE NOTICE '=== Running WS-M-003 session report integration suite ===';

    -- Open fiscal period covering today.
    SELECT id INTO v_period_id
    FROM finance.fiscal_periods
    WHERE status = 'OPEN' AND CURRENT_DATE BETWEEN starts_on AND ends_on
    LIMIT 1;
    IF v_period_id IS NULL THEN
        INSERT INTO finance.fiscal_periods (period_code, starts_on, ends_on, status)
        VALUES ('TESTM3-' || v_suffix, date_trunc('year', CURRENT_DATE)::date, (date_trunc('year', CURRENT_DATE) + interval '1 year' - interval '1 day')::date, 'OPEN')
        RETURNING id INTO v_period_id;
    END IF;
    v_doc_date := CURRENT_DATE;

    -- Fixture user: ADMIN + MANAGER so it can open/close the session, record
    -- cash movements, approve its own cash-out, confirm sales, and post
    -- customer payments -- this suite is about the report, not permissions.
    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES (v_admin_username, 'WSM003 Admin', 'hashed_pass')
    RETURNING id INTO v_admin_id;
    INSERT INTO iam.user_roles (user_id, role_id) SELECT v_admin_id, id FROM iam.roles WHERE code = 'ADMIN';
    INSERT INTO iam.user_roles (user_id, role_id) SELECT v_admin_id, id FROM iam.roles WHERE code = 'MANAGER';
    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_admin_id, v_workstation, sha256(v_admin_token::bytea), now() + interval '2 hours');

    INSERT INTO inventory.warehouses (code, name)
    VALUES ('WH-WSM003-' || v_suffix, 'WS-M-003 Warehouse')
    RETURNING id INTO v_warehouse_id;

    SELECT id INTO v_unit_id FROM catalog.units WHERE normalized_code = 'UNIT' LIMIT 1;
    IF v_unit_id IS NULL THEN
        SELECT id INTO v_unit_id FROM catalog.units LIMIT 1;
    END IF;

    INSERT INTO catalog.products (name, is_active)
    VALUES ('WSM003 Item ' || v_suffix, true)
    RETURNING id INTO v_product_id;
    INSERT INTO catalog.product_variants (product_id, base_unit_id, sku, sale_price, is_active)
    VALUES (v_product_id, v_unit_id, 'SKU-WSM003-' || v_suffix, 500.00, true)
    RETURNING id INTO v_variant_id;
    INSERT INTO inventory.positions (warehouse_id, variant_id, quantity_on_hand, total_value, last_known_wac)
    VALUES (v_warehouse_id, v_variant_id, 500.000, 50000.0000, 100.000000);

    -- =========================================================================
    -- Build the session: float 2000, two cash sales (1000 + 300), one of them
    -- voided, one credit sale (800), a cash-in (200), a cash-out (150), and a
    -- customer payment (200) against the credit invoice.
    -- =========================================================================
    v_session1 := sales.open_cash_session(v_admin_token, v_warehouse_id, v_workstation, 2000.00);

    v_lines := jsonb_build_array(jsonb_build_object('variant_id', v_variant_id, 'quantity', 2.000, 'unit_price', 500.00));
    v_doc_sale1 := sales.confirm_cash_sale(
        v_admin_token, md5('wsm003-sale1-' || v_suffix)::uuid,
        sha256(convert_to(v_lines::text || ':0.00', 'UTF8')),
        v_session1, v_warehouse_id, v_period_id, v_doc_date, v_lines, 0.00
    );

    v_lines := jsonb_build_array(jsonb_build_object('variant_id', v_variant_id, 'quantity', 1.000, 'unit_price', 300.00));
    v_doc_sale2 := sales.confirm_cash_sale(
        v_admin_token, md5('wsm003-sale2-' || v_suffix)::uuid,
        sha256(convert_to(v_lines::text || ':0.00', 'UTF8')),
        v_session1, v_warehouse_id, v_period_id, v_doc_date, v_lines, 0.00
    );

    v_void_res := sales.void_sale(v_admin_token, v_doc_sale2, 'WRONG_ITEM', NULL);

    v_customer_json := receivables.create_customer(
        v_admin_token, 'CUS-WSM003-' || v_suffix, 'WSM003 Customer',
        NULL, NULL, NULL, NULL, NULL, true, 5000.00, 30, 60
    );
    v_customer_id := (v_customer_json ->> 'id')::bigint;

    v_lines := jsonb_build_array(jsonb_build_object('variant_id', v_variant_id, 'quantity', 2.000, 'unit_price', 400.00));
    v_credit_result := sales.confirm_credit_sale(
        v_admin_token, md5('wsm003-credit-' || v_suffix)::uuid,
        sha256(convert_to(v_lines::text, 'UTF8')),
        v_customer_id, v_warehouse_id, v_period_id, v_doc_date, v_lines, NULL
    );
    v_credit_doc := (v_credit_result ->> 'document_id')::bigint;

    SELECT id INTO v_invoice_entry_id
    FROM receivables.customer_ledger_entries
    WHERE document_id = v_credit_doc AND entry_type = 'CREDIT_INVOICE';

    PERFORM receivables.post_customer_payment(
        v_admin_token, md5('wsm003-payment-' || v_suffix)::uuid, v_customer_id, 200.00, 'CASH', v_session1,
        v_period_id, v_doc_date,
        jsonb_build_array(jsonb_build_object('invoice_ledger_entry_id', v_invoice_entry_id, 'amount', '200.00')),
        'WS-M-003 partial payment'
    );

    PERFORM cash.record_cash_movement(v_admin_token, v_session1, 'CASH_IN', 200.00, 'CHANGE_FLOAT', NULL, NULL);
    PERFORM cash.record_cash_movement(v_admin_token, v_session1, 'CASH_OUT', 150.00, 'EXPENSE', 'WS-M-003 expense', NULL);

    -- =========================================================================
    -- 1. Every figure, session still OPEN: expected computed live, counted and
    --    variance both null.
    -- =========================================================================
    v_report := cash.get_session_report(v_admin_token, v_session1);

    IF (v_report -> 'session' ->> 'status') <> 'OPEN' THEN
        RAISE EXCEPTION 'Assertion failed (1a): session status is not OPEN: %', v_report -> 'session';
    END IF;
    IF (v_report -> 'session' ->> 'workstation_id') <> v_workstation THEN
        RAISE EXCEPTION 'Assertion failed (1b): workstation_id mismatch';
    END IF;
    IF (v_report -> 'session' ->> 'opening_float')::numeric <> 2000.00 THEN
        RAISE EXCEPTION 'Assertion failed (1c): opening_float mismatch: %', v_report -> 'session';
    END IF;

    IF (v_report -> 'sales' ->> 'cash_count')::int <> 2
       OR (v_report -> 'sales' ->> 'cash_total')::numeric <> 1300.00 THEN
        RAISE EXCEPTION 'Assertion failed (2a): cash sales mismatch: %', v_report -> 'sales';
    END IF;
    IF (v_report -> 'sales' ->> 'credit_count')::int <> 1
       OR (v_report -> 'sales' ->> 'credit_total')::numeric <> 800.00 THEN
        RAISE EXCEPTION 'Assertion failed (2b): credit sales mismatch: %', v_report -> 'sales';
    END IF;
    IF (v_report -> 'sales' ->> 'void_count')::int <> 1
       OR (v_report -> 'sales' ->> 'void_total')::numeric <> 300.00 THEN
        RAISE EXCEPTION 'Assertion failed (2c): void mismatch: %', v_report -> 'sales';
    END IF;

    IF (v_report -> 'movements' ->> 'cash_in_total')::numeric <> 200.00
       OR (v_report -> 'movements' ->> 'cash_out_total')::numeric <> 150.00 THEN
        RAISE EXCEPTION 'Assertion failed (3a): movement totals mismatch: %', v_report -> 'movements';
    END IF;
    IF jsonb_array_length(v_report -> 'movements' -> 'rows') <> 2 THEN
        RAISE EXCEPTION 'Assertion failed (3b): expected 2 movement rows, got %', v_report -> 'movements' -> 'rows';
    END IF;

    IF (v_report -> 'customer' ->> 'payments_total')::numeric <> 200.00
       OR (v_report -> 'customer' ->> 'refunds_total')::numeric <> 0.00 THEN
        RAISE EXCEPTION 'Assertion failed (4): customer totals mismatch: %', v_report -> 'customer';
    END IF;

    -- expected = 2000 + 1000 + 300 - 300 (void) + 200 (cash-in) - 150 (cash-out) + 200 (customer payment) = 3250.00
    IF (v_report -> 'cash' ->> 'expected')::numeric <> 3250.00 THEN
        RAISE EXCEPTION 'Assertion failed (5a): expected cash mismatch: %', v_report -> 'cash';
    END IF;
    IF (v_report -> 'cash' ->> 'counted') IS NOT NULL OR (v_report -> 'cash' ->> 'variance') IS NOT NULL THEN
        RAISE EXCEPTION 'Assertion failed (5b): counted/variance must be null while OPEN: %', v_report -> 'cash';
    END IF;

    -- =========================================================================
    -- 6. Close the session with an exact count (3250.00) -- no variance, no
    --    manager approval -- then confirm counted/variance are populated.
    -- =========================================================================
    PERFORM sales.begin_cash_session_close(v_admin_token, v_session1);

    SELECT jsonb_agg(
        jsonb_build_object(
            'denomination_id', id,
            'quantity', CASE
                WHEN code = 'DZD_1000' THEN 3
                WHEN code = 'DZD_200' THEN 1
                WHEN code = 'DZD_50' THEN 1
                ELSE 0
            END
        ) ORDER BY display_order
    )
    INTO v_counts
    FROM cash.denominations
    WHERE is_active;

    v_res := cash.submit_cash_session_count(v_admin_token, v_session1, v_counts);
    IF v_res ->> 'status' <> 'CLOSED' THEN
        RAISE EXCEPTION 'Assertion failed (6a): session did not close cleanly: %', v_res;
    END IF;

    v_report := cash.get_session_report(v_admin_token, v_session1);
    IF (v_report -> 'session' ->> 'status') <> 'CLOSED' THEN
        RAISE EXCEPTION 'Assertion failed (6b): session status is not CLOSED: %', v_report -> 'session';
    END IF;
    IF (v_report -> 'cash' ->> 'expected')::numeric <> 3250.00
       OR (v_report -> 'cash' ->> 'counted')::numeric <> 3250.00
       OR (v_report -> 'cash' ->> 'variance')::numeric <> 0.00 THEN
        RAISE EXCEPTION 'Assertion failed (6c): closed cash figures mismatch: %', v_report -> 'cash';
    END IF;
    IF (v_report -> 'cash' ->> 'variance_approved_by') IS NOT NULL THEN
        RAISE EXCEPTION 'Assertion failed (6d): no manager approval was needed, variance_approved_by must be null';
    END IF;
    IF (v_report -> 'session' ->> 'closed_by') IS NULL THEN
        RAISE EXCEPTION 'Assertion failed (6e): closed_by must be set once CLOSED';
    END IF;

    -- =========================================================================
    -- 7. An unknown session id is rejected.
    -- =========================================================================
    v_blocked := false;
    BEGIN
        PERFORM cash.get_session_report(v_admin_token, -1);
    EXCEPTION WHEN SQLSTATE '22023' THEN
        v_blocked := true;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'Assertion failed (7): an unknown session id must be rejected with 22023';
    END IF;

    -- =========================================================================
    -- 8. schema_state.
    -- =========================================================================
    IF (SELECT migration_version FROM operations.schema_state WHERE singleton) < 20260925090000 THEN
        RAISE EXCEPTION 'Assertion failed (8): schema_state.migration_version mismatch';
    END IF;

    RAISE NOTICE '=== WS-M-003 session report integration suite completed successfully ===';
END;
$$;

-- =============================================================================
-- 9. Re-applying the migration file a second time raises no error.
-- =============================================================================
\i src-tauri/migrations/20260925090000_ws_m_003_session_report.sql
