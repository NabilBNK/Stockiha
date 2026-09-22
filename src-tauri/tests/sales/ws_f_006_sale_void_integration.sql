-- WS-F-006 Integration Test: cancelling a whole cash or credit sale (sale void).
-- A workstation can only hold one live cash session at a time, so this suite
-- opens and fully closes one session before opening the next.
\set ON_ERROR_STOP on

DO $$
DECLARE
    v_suffix text := floor(random() * 1000000000)::bigint::text;
    v_workstation text := 'WSF006-WKS-' || v_suffix;
    v_admin_username text := 'wsf006_admin_' || v_suffix;
    v_cashier_username text := 'wsf006_cashier_' || v_suffix;
    v_admin_token text := 'wsf006_admin_token_' || v_suffix;
    v_cashier_token text := 'wsf006_cashier_token_' || v_suffix;
    v_admin_id bigint;
    v_cashier_id bigint;
    v_warehouse_id bigint;
    v_period_id bigint;
    v_period_start date;
    v_period_end date;
    v_doc_date date;
    v_unit_id bigint;
    v_product_id bigint;
    v_variant_id bigint;
    v_small_product_id bigint;
    v_small_variant_id bigint;
    v_lines jsonb;
    v_counts jsonb;

    v_session1 bigint;
    v_session2 bigint;
    v_session3 bigint;
    v_session4 bigint;
    v_session5 bigint;

    v_doc1 bigint;
    v_doc3 bigint;
    v_doc4 bigint;
    v_doc_untouched bigint;
    v_doc_small bigint;
    v_doc_session3 bigint;
    v_doc_credit_earlier bigint;

    v_res jsonb;
    v_void_res jsonb;
    v_blocked boolean;

    v_qty_before numeric;
    v_value_before numeric;
    v_qty_after numeric;
    v_value_after numeric;

    v_journal1 bigint;
    v_void_journal1 bigint;
    v_journal3 bigint;
    v_void_journal3 bigint;

    v_movement_amount numeric;
    v_count bigint;

    v_customer1_json jsonb;
    v_customer1_id bigint;
    v_customer2_json jsonb;
    v_customer2_id bigint;
    v_credit_result jsonb;
    v_credit_doc bigint;
    v_invoice_entry_id bigint;
    v_exposure_before numeric;
    v_exposure_after numeric;
    v_payment_res jsonb;
    v_open_invoices jsonb;

    v_credit_doc_a bigint;
    v_credit_doc_b bigint;
    v_invoice_a bigint;
    v_invoice_b bigint;
    v_amount_b numeric;
BEGIN
    RAISE NOTICE '=== Running WS-F-006 sale void integration suite ===';

    -- Open fiscal period covering today.
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
            VALUES ('TESTF6-' || v_suffix, date_trunc('year', CURRENT_DATE)::date, (date_trunc('year', CURRENT_DATE) + interval '1 year' - interval '1 day')::date, 'OPEN')
            RETURNING id, starts_on, ends_on INTO v_period_id, v_period_start, v_period_end;
        END IF;
    END IF;
    v_doc_date := CURRENT_DATE;

    -- Users: an ADMIN (holds VOID_SALE) and a plain CASHIER (does not).
    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES (v_admin_username, 'WSF006 Admin', 'hashed_pass')
    RETURNING id INTO v_admin_id;

    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES (v_cashier_username, 'WSF006 Cashier', 'hashed_pass')
    RETURNING id INTO v_cashier_id;

    INSERT INTO iam.user_roles (user_id, role_id) SELECT v_admin_id, id FROM iam.roles WHERE code = 'ADMIN';
    INSERT INTO iam.user_roles (user_id, role_id) SELECT v_cashier_id, id FROM iam.roles WHERE code = 'CASHIER';

    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at) VALUES
        (v_admin_id, v_workstation, sha256(v_admin_token::bytea), now() + interval '2 hours'),
        (v_cashier_id, v_workstation, sha256(v_cashier_token::bytea), now() + interval '2 hours');

    INSERT INTO inventory.warehouses (code, name)
    VALUES ('WH-WSF006-' || v_suffix, 'WS-F-006 Warehouse')
    RETURNING id INTO v_warehouse_id;

    SELECT id INTO v_unit_id FROM catalog.units WHERE normalized_code = 'UNIT' LIMIT 1;
    IF v_unit_id IS NULL THEN
        SELECT id INTO v_unit_id FROM catalog.units LIMIT 1;
    END IF;

    -- Main product: ample stock for every non-emptying test.
    INSERT INTO catalog.products (name, is_active)
    VALUES ('WSF006 Item ' || v_suffix, true)
    RETURNING id INTO v_product_id;

    INSERT INTO catalog.product_variants (product_id, base_unit_id, sku, sale_price, is_active)
    VALUES (v_product_id, v_unit_id, 'SKU-WSF006-' || v_suffix, 500.00, true)
    RETURNING id INTO v_variant_id;

    INSERT INTO inventory.positions (warehouse_id, variant_id, quantity_on_hand, total_value, last_known_wac)
    VALUES (v_warehouse_id, v_variant_id, 500.000, 50000.0000, 100.000000);

    -- Small product: exactly enough stock to be fully emptied by one sale.
    INSERT INTO catalog.products (name, is_active)
    VALUES ('WSF006 Small Item ' || v_suffix, true)
    RETURNING id INTO v_small_product_id;

    INSERT INTO catalog.product_variants (product_id, base_unit_id, sku, sale_price, is_active)
    VALUES (v_small_product_id, v_unit_id, 'SKU-WSF006-SMALL-' || v_suffix, 50.00, true)
    RETURNING id INTO v_small_variant_id;

    INSERT INTO inventory.positions (warehouse_id, variant_id, quantity_on_hand, total_value, last_known_wac)
    VALUES (v_warehouse_id, v_small_variant_id, 5.000, 1000.0000, 200.000000);

    -- =========================================================================
    -- PHASE A -- session1 (float 2000): tests 1, 2, 3, 5, 6, 7, 9, 10, 12.
    -- =========================================================================
    v_session1 := sales.open_cash_session(v_admin_token, v_warehouse_id, v_workstation, 2000.00);

    -- 1. Cash sale void: 2 units at 500 (no discount), then void with WRONG_ITEM.
    v_lines := jsonb_build_array(jsonb_build_object('variant_id', v_variant_id, 'quantity', 2.000, 'unit_price', 500.00));
    v_doc1 := sales.confirm_cash_sale(
        v_admin_token, md5('wsf006-doc1-' || v_suffix)::uuid,
        sha256(convert_to(v_lines::text || ':0.00', 'UTF8')),
        v_session1, v_warehouse_id, v_period_id, v_doc_date, v_lines, 0.00
    );

    SELECT quantity_on_hand, total_value INTO v_qty_after, v_value_after
    FROM inventory.positions WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_id;
    v_qty_before := v_qty_after + 2.000;
    v_value_before := v_value_after + 200.0000;

    SELECT je.document_id INTO v_journal1
    FROM finance.journal_entries je WHERE je.source_type = 'CASH_SALE' AND je.source_id = v_doc1;

    v_void_res := sales.void_sale(v_admin_token, v_doc1, 'WRONG_ITEM', NULL);
    v_void_journal1 := (v_void_res->>'journal_document_id')::bigint;

    IF (SELECT status FROM core.business_documents WHERE id = v_doc1) <> 'REVERSED' THEN
        RAISE EXCEPTION 'Assertion failed (1): original sale is not REVERSED';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM core.business_documents
        WHERE id = (v_void_res->>'void_document_id')::bigint
          AND status = 'POSTED'
          AND document_number LIKE 'AN-%'
          AND reverses_document_id = v_doc1
    ) THEN
        RAISE EXCEPTION 'Assertion failed (1): void document is not correctly POSTED/numbered/linked: %', v_void_res;
    END IF;

    SELECT quantity_on_hand, total_value INTO v_qty_after, v_value_after
    FROM inventory.positions WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_id;
    IF v_qty_after <> v_qty_before OR v_value_after <> v_value_before THEN
        RAISE EXCEPTION 'Assertion failed (1): stock not restored exactly: qty % vs %, value % vs %',
            v_qty_after, v_qty_before, v_value_after, v_value_before;
    END IF;

    SELECT amount INTO v_movement_amount
    FROM cash.movements WHERE cash_session_id = v_session1 AND movement_type = 'SALE_VOID'
      AND business_document_id = (v_void_res->>'void_document_id')::bigint;
    IF v_movement_amount <> -1000.00 THEN
        RAISE EXCEPTION 'Assertion failed (1): SALE_VOID cash movement expected -1000.00, got %', v_movement_amount;
    END IF;

    IF EXISTS (
        SELECT account_code
        FROM (
            SELECT account_code, sum(debit) - sum(credit) AS net
            FROM finance.journal_lines
            WHERE document_id IN (v_journal1, v_void_journal1)
            GROUP BY account_code
        ) x
        WHERE x.net <> 0
    ) THEN
        RAISE EXCEPTION 'Assertion failed (1): sale + void journals do not net to zero per account';
    END IF;

    -- 2. The same sale voided again -> 55000, no second sale_voids row.
    v_blocked := false;
    BEGIN
        PERFORM sales.void_sale(v_admin_token, v_doc1, 'WRONG_ITEM', NULL);
    EXCEPTION WHEN SQLSTATE '55000' THEN v_blocked := true;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'Assertion failed (2): re-voiding an already cancelled sale was allowed';
    END IF;
    SELECT count(*) INTO v_count FROM sales.sale_voids WHERE original_document_id = v_doc1;
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'Assertion failed (2): sale_voids row count for doc1 is % instead of 1', v_count;
    END IF;

    -- 3. A discounted cash sale (subtotal 1000, discount 200) voided.
    v_lines := jsonb_build_array(jsonb_build_object('variant_id', v_variant_id, 'quantity', 2.000, 'unit_price', 500.00));
    v_doc3 := sales.confirm_cash_sale(
        v_admin_token, md5('wsf006-doc3-' || v_suffix)::uuid,
        sha256(convert_to(v_lines::text || ':200.00', 'UTF8')),
        v_session1, v_warehouse_id, v_period_id, v_doc_date, v_lines, 200.00
    );

    SELECT je.document_id INTO v_journal3
    FROM finance.journal_entries je WHERE je.source_type = 'CASH_SALE' AND je.source_id = v_doc3;

    v_void_res := sales.void_sale(v_admin_token, v_doc3, 'CUSTOMER_CHANGED_MIND', NULL);
    v_void_journal3 := (v_void_res->>'journal_document_id')::bigint;

    IF NOT EXISTS (
        SELECT 1 FROM finance.journal_lines
        WHERE document_id = v_void_journal3 AND account_code = 'SALES_DISCOUNT' AND credit = 200.00
    ) THEN
        RAISE EXCEPTION 'Assertion failed (3): void journal missing SALES_DISCOUNT credit of 200.00';
    END IF;

    SELECT amount INTO v_movement_amount
    FROM cash.movements WHERE cash_session_id = v_session1 AND movement_type = 'SALE_VOID'
      AND business_document_id = (v_void_res->>'void_document_id')::bigint;
    IF v_movement_amount <> -800.00 THEN
        RAISE EXCEPTION 'Assertion failed (3): SALE_VOID cash movement expected -800.00, got %', v_movement_amount;
    END IF;

    -- An extra sale in session1 that is never voided, for the list assertion (13).
    v_lines := jsonb_build_array(jsonb_build_object('variant_id', v_variant_id, 'quantity', 1.000, 'unit_price', 50.00));
    v_doc_untouched := sales.confirm_cash_sale(
        v_admin_token, md5('wsf006-untouched-' || v_suffix)::uuid,
        sha256(convert_to(v_lines::text || ':0.00', 'UTF8')),
        v_session1, v_warehouse_id, v_period_id, v_doc_date, v_lines, 0.00
    );

    -- 5. A sale that emptied the stock voided -> quantity/WAC restored.
    v_lines := jsonb_build_array(jsonb_build_object('variant_id', v_small_variant_id, 'quantity', 5.000, 'unit_price', 50.00));
    v_doc_small := sales.confirm_cash_sale(
        v_admin_token, md5('wsf006-small-' || v_suffix)::uuid,
        sha256(convert_to(v_lines::text || ':0.00', 'UTF8')),
        v_session1, v_warehouse_id, v_period_id, v_doc_date, v_lines, 0.00
    );

    IF (SELECT quantity_on_hand FROM inventory.positions WHERE warehouse_id = v_warehouse_id AND variant_id = v_small_variant_id) <> 0 THEN
        RAISE EXCEPTION 'Assertion failed (5): stock was not fully emptied by the sale as designed';
    END IF;

    PERFORM sales.void_sale(v_admin_token, v_doc_small, 'CASHIER_MISTAKE', NULL);

    SELECT quantity_on_hand, total_value INTO v_qty_after, v_value_after
    FROM inventory.positions WHERE warehouse_id = v_warehouse_id AND variant_id = v_small_variant_id;
    IF v_qty_after <> 5.000 OR v_value_after <> 1000.0000 THEN
        RAISE EXCEPTION 'Assertion failed (5): stock not restored: qty %, value %', v_qty_after, v_value_after;
    END IF;
    IF (SELECT last_known_wac FROM inventory.positions WHERE warehouse_id = v_warehouse_id AND variant_id = v_small_variant_id)
       <> round(v_value_after / v_qty_after, 6) THEN
        RAISE EXCEPTION 'Assertion failed (5): last_known_wac does not match total_value/quantity_on_hand';
    END IF;

    -- 6. Reason OTHER with a NULL note -> 22023. A 201-character note -> 22023.
    --    Reason FOO -> 22023. None of these creates a row.
    SELECT count(*) INTO v_count FROM sales.sale_voids;

    v_blocked := false;
    BEGIN
        PERFORM sales.void_sale(v_admin_token, v_doc1, 'OTHER', NULL);
    EXCEPTION WHEN SQLSTATE '22023' THEN v_blocked := true;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'Assertion failed (6a): custom reason with NULL note was allowed'; END IF;

    v_blocked := false;
    BEGIN
        PERFORM sales.void_sale(v_admin_token, v_doc1, 'WRONG_ITEM', repeat('x', 201));
    EXCEPTION WHEN SQLSTATE '22023' THEN v_blocked := true;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'Assertion failed (6b): a 201-character note was allowed'; END IF;

    v_blocked := false;
    BEGIN
        PERFORM sales.void_sale(v_admin_token, v_doc1, 'FOO', NULL);
    EXCEPTION WHEN SQLSTATE '22023' THEN v_blocked := true;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'Assertion failed (6c): reason FOO was allowed'; END IF;

    IF (SELECT count(*) FROM sales.sale_voids) <> v_count THEN
        RAISE EXCEPTION 'Assertion failed (6): a row was written despite validation failures';
    END IF;

    -- 7. Voiding a document that is a JOURNAL_ENTRY -> 22023.
    v_blocked := false;
    BEGIN
        PERFORM sales.void_sale(v_admin_token, v_journal1, 'WRONG_ITEM', NULL);
    EXCEPTION WHEN SQLSTATE '22023' THEN v_blocked := true;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'Assertion failed (7): voiding a JOURNAL_ENTRY document was allowed';
    END IF;

    -- 9. Unpaid credit sale void (customer with no other debt).
    v_customer1_json := receivables.create_customer(
        v_admin_token, 'CUS-WSF006-1-' || v_suffix, 'WSF006 Customer One',
        NULL, NULL, NULL, NULL, NULL, true, 5000.00, 30, 60
    );
    v_customer1_id := (v_customer1_json ->> 'id')::bigint;

    SELECT exposure_amount INTO v_exposure_before
    FROM receivables.customer_credit_state WHERE customer_id = v_customer1_id;

    v_lines := jsonb_build_array(jsonb_build_object('variant_id', v_variant_id, 'quantity', 2.000, 'unit_price', 400.00));
    v_credit_result := sales.confirm_credit_sale(
        v_admin_token, md5('wsf006-credit9-' || v_suffix)::uuid,
        sha256(convert_to(v_lines::text, 'UTF8')),
        v_customer1_id, v_warehouse_id, v_period_id, v_doc_date, v_lines, NULL
    );
    v_credit_doc := (v_credit_result ->> 'document_id')::bigint;

    SELECT id INTO v_invoice_entry_id
    FROM receivables.customer_ledger_entries
    WHERE document_id = v_credit_doc AND entry_type = 'CREDIT_INVOICE';

    v_void_res := sales.void_sale(v_admin_token, v_credit_doc, 'CUSTOMER_CHANGED_MIND', NULL);

    SELECT exposure_amount INTO v_exposure_after
    FROM receivables.customer_credit_state WHERE customer_id = v_customer1_id;
    IF v_exposure_after <> v_exposure_before THEN
        RAISE EXCEPTION 'Assertion failed (9): exposure did not return to its pre-sale value: % vs %',
            v_exposure_after, v_exposure_before;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM receivables.customer_ledger_entries
        WHERE customer_id = v_customer1_id AND entry_type = 'CREDIT_NOTE'
          AND amount_delta = -800.00 AND related_entry_id = v_invoice_entry_id
    ) THEN
        RAISE EXCEPTION 'Assertion failed (9): CREDIT_NOTE ledger entry missing or incorrect';
    END IF;

    IF receivables.net_invoice_allocated_amount(v_invoice_entry_id) <> 800.00 THEN
        RAISE EXCEPTION 'Assertion failed (9): net_invoice_allocated_amount is not the full invoice amount';
    END IF;

    IF (SELECT oldest_open_due_date FROM receivables.customer_credit_state WHERE customer_id = v_customer1_id) IS NOT NULL THEN
        RAISE EXCEPTION 'Assertion failed (9): oldest_open_due_date should be NULL after the only invoice closed';
    END IF;

    -- 10. Paid credit sale: a payment allocated to it -> void refused (55000).
    v_lines := jsonb_build_array(jsonb_build_object('variant_id', v_variant_id, 'quantity', 2.000, 'unit_price', 400.00));
    v_credit_result := sales.confirm_credit_sale(
        v_admin_token, md5('wsf006-credit10-' || v_suffix)::uuid,
        sha256(convert_to(v_lines::text, 'UTF8')),
        v_customer1_id, v_warehouse_id, v_period_id, v_doc_date, v_lines, NULL
    );
    v_credit_doc := (v_credit_result ->> 'document_id')::bigint;

    SELECT id INTO v_invoice_entry_id
    FROM receivables.customer_ledger_entries
    WHERE document_id = v_credit_doc AND entry_type = 'CREDIT_INVOICE';

    v_payment_res := receivables.post_customer_payment(
        v_admin_token, md5('wsf006-payment10-' || v_suffix)::uuid, v_customer1_id, 300.00, 'CASH', v_session1,
        v_period_id, v_doc_date,
        jsonb_build_array(jsonb_build_object('invoice_ledger_entry_id', v_invoice_entry_id, 'amount', '300.00')),
        'WS-F-006 partial payment'
    );

    -- Capture exposure AFTER the payment, right before the refused void attempt,
    -- so the assertion below proves the void made no further change.
    SELECT exposure_amount INTO v_exposure_before
    FROM receivables.customer_credit_state WHERE customer_id = v_customer1_id;

    v_blocked := false;
    BEGIN
        PERFORM sales.void_sale(v_admin_token, v_credit_doc, 'WRONG_PRICE', NULL);
    EXCEPTION WHEN SQLSTATE '55000' THEN v_blocked := true;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'Assertion failed (10): voiding a partly paid credit sale was allowed';
    END IF;

    SELECT exposure_amount INTO v_exposure_after
    FROM receivables.customer_credit_state WHERE customer_id = v_customer1_id;
    IF v_exposure_after <> v_exposure_before THEN
        RAISE EXCEPTION 'Assertion failed (10): exposure changed despite the refused void';
    END IF;

    -- 12. Payments skip cancelled invoices.
    v_customer2_json := receivables.create_customer(
        v_admin_token, 'CUS-WSF006-2-' || v_suffix, 'WSF006 Customer Two',
        NULL, NULL, NULL, NULL, NULL, true, 5000.00, 30, 60
    );
    v_customer2_id := (v_customer2_json ->> 'id')::bigint;

    v_lines := jsonb_build_array(jsonb_build_object('variant_id', v_variant_id, 'quantity', 1.000, 'unit_price', 250.00));
    v_credit_result := sales.confirm_credit_sale(
        v_admin_token, md5('wsf006-credit-a-' || v_suffix)::uuid,
        sha256(convert_to(v_lines::text, 'UTF8')),
        v_customer2_id, v_warehouse_id, v_period_id, v_doc_date, v_lines, NULL
    );
    v_credit_doc_a := (v_credit_result ->> 'document_id')::bigint;
    SELECT id INTO v_invoice_a
    FROM receivables.customer_ledger_entries WHERE document_id = v_credit_doc_a AND entry_type = 'CREDIT_INVOICE';

    v_lines := jsonb_build_array(jsonb_build_object('variant_id', v_variant_id, 'quantity', 1.000, 'unit_price', 350.00));
    v_credit_result := sales.confirm_credit_sale(
        v_admin_token, md5('wsf006-credit-b-' || v_suffix)::uuid,
        sha256(convert_to(v_lines::text, 'UTF8')),
        v_customer2_id, v_warehouse_id, v_period_id, v_doc_date, v_lines, NULL
    );
    v_credit_doc_b := (v_credit_result ->> 'document_id')::bigint;
    v_amount_b := (v_credit_result ->> 'total_amount')::numeric;
    SELECT id INTO v_invoice_b
    FROM receivables.customer_ledger_entries WHERE document_id = v_credit_doc_b AND entry_type = 'CREDIT_INVOICE';

    PERFORM sales.void_sale(v_admin_token, v_credit_doc_a, 'CUSTOMER_CHANGED_MIND', NULL);

    v_open_invoices := receivables.list_open_customer_invoices(v_admin_token, v_customer2_id);
    IF jsonb_array_length(v_open_invoices) <> 1
       OR (v_open_invoices -> 0 ->> 'invoice_ledger_entry_id')::bigint <> v_invoice_b THEN
        RAISE EXCEPTION 'Assertion failed (12): open invoices after voiding A should be exactly [B], got %', v_open_invoices;
    END IF;

    v_payment_res := receivables.post_customer_payment(
        v_admin_token, md5('wsf006-payment12-' || v_suffix)::uuid, v_customer2_id, v_amount_b, 'CASH', v_session1,
        v_period_id, v_doc_date,
        jsonb_build_array(jsonb_build_object('invoice_ledger_entry_id', v_invoice_b, 'amount', v_amount_b::text)),
        'WS-F-006 payment allocated to B'
    );
    IF receivables.net_invoice_allocated_amount(v_invoice_b) <> v_amount_b THEN
        RAISE EXCEPTION 'Assertion failed (12): payment was not fully allocated to invoice B';
    END IF;
    IF receivables.net_invoice_allocated_amount(v_invoice_a) <> 250.00 THEN
        RAISE EXCEPTION 'Assertion failed (12): payment leaked onto cancelled invoice A';
    END IF;

    -- Close session1 cleanly: 2000 (float) + 50 (untouched sale) + 300 (payment10)
    -- + 350 (payment12, v_amount_b) = 2700.00 expected, matched exactly.
    PERFORM sales.begin_cash_session_close(v_admin_token, v_session1);
    SELECT jsonb_agg(
        jsonb_build_object(
            'denomination_id', id,
            'quantity', CASE WHEN code = 'DZD_1000' THEN 2 WHEN code = 'DZD_500' THEN 1 WHEN code = 'DZD_200' THEN 1 ELSE 0 END
        ) ORDER BY display_order
    )
    INTO v_counts
    FROM cash.denominations
    WHERE is_active;
    v_res := sales.submit_cash_session_count(v_admin_token, v_session1, v_counts);
    IF v_res->>'status' <> 'CLOSED' OR (v_res->>'variance_amount')::numeric <> 0.00 THEN
        RAISE EXCEPTION 'Assertion failed: session1 setup close did not succeed with zero variance: %', v_res;
    END IF;

    -- =========================================================================
    -- PHASE B -- session2 (float 1000): test 4.
    -- =========================================================================
    v_session2 := sales.open_cash_session(v_admin_token, v_warehouse_id, v_workstation, 1000.00);

    v_lines := jsonb_build_array(jsonb_build_object('variant_id', v_variant_id, 'quantity', 1.000, 'unit_price', 300.00));
    v_doc4 := sales.confirm_cash_sale(
        v_admin_token, md5('wsf006-doc4-' || v_suffix)::uuid,
        sha256(convert_to(v_lines::text || ':0.00', 'UTF8')),
        v_session2, v_warehouse_id, v_period_id, v_doc_date, v_lines, 0.00
    );
    PERFORM sales.void_sale(v_admin_token, v_doc4, 'WRONG_PRICE', NULL);

    PERFORM sales.begin_cash_session_close(v_admin_token, v_session2);
    SELECT jsonb_agg(
        jsonb_build_object(
            'denomination_id', id,
            'quantity', CASE WHEN code = 'DZD_1000' THEN 1 ELSE 0 END
        ) ORDER BY display_order
    )
    INTO v_counts
    FROM cash.denominations
    WHERE is_active;
    v_res := sales.submit_cash_session_count(v_admin_token, v_session2, v_counts);
    IF (v_res->>'variance_amount')::numeric <> 0.00 OR v_res->>'status' <> 'CLOSED' THEN
        RAISE EXCEPTION 'Assertion failed (4): expected zero-variance auto-close, got %', v_res;
    END IF;

    -- =========================================================================
    -- PHASE C -- session3 (float 700): test 8 (closed session).
    -- =========================================================================
    v_session3 := sales.open_cash_session(v_admin_token, v_warehouse_id, v_workstation, 700.00);
    v_lines := jsonb_build_array(jsonb_build_object('variant_id', v_variant_id, 'quantity', 1.000, 'unit_price', 100.00));
    v_doc_session3 := sales.confirm_cash_sale(
        v_admin_token, md5('wsf006-session3-' || v_suffix)::uuid,
        sha256(convert_to(v_lines::text || ':0.00', 'UTF8')),
        v_session3, v_warehouse_id, v_period_id, v_doc_date, v_lines, 0.00
    );

    PERFORM sales.begin_cash_session_close(v_admin_token, v_session3);
    SELECT jsonb_agg(
        jsonb_build_object(
            'denomination_id', id,
            'quantity', CASE WHEN code = 'DZD_500' THEN 1 WHEN code = 'DZD_200' THEN 1 WHEN code = 'DZD_100' THEN 1 ELSE 0 END
        ) ORDER BY display_order
    )
    INTO v_counts
    FROM cash.denominations
    WHERE is_active;
    v_res := sales.submit_cash_session_count(v_admin_token, v_session3, v_counts);
    IF v_res->>'status' <> 'CLOSED' THEN
        RAISE EXCEPTION 'Assertion failed (8): setup close did not succeed: %', v_res;
    END IF;

    v_blocked := false;
    BEGIN
        PERFORM sales.void_sale(v_admin_token, v_doc_session3, 'WRONG_ITEM', NULL);
    EXCEPTION WHEN SQLSTATE '55000' THEN v_blocked := true;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'Assertion failed (8): voiding a sale from a now-closed session was allowed';
    END IF;

    -- =========================================================================
    -- PHASE D -- session4 (float 500): setup for test 11.
    -- =========================================================================
    v_session4 := sales.open_cash_session(v_admin_token, v_warehouse_id, v_workstation, 500.00);

    -- The whole suite runs inside one transaction, so now() is frozen and every
    -- row below would otherwise share one identical timestamp. sales.credit_sales
    -- is immutable once posted (its own trigger forbids UPDATE), so
    -- session4's opened_at is backdated instead, and session5's opened_at is
    -- forward-dated below, unambiguously bracketing the sale's real (frozen
    -- "now") timestamp -- proving the "session that was open when the sale was
    -- made" rule rather than merely "some session that happens to be open".
    UPDATE sales.cash_sessions SET opened_at = now() - interval '2 hours' WHERE id = v_session4;

    v_lines := jsonb_build_array(jsonb_build_object('variant_id', v_variant_id, 'quantity', 2.000, 'unit_price', 200.00));
    v_credit_result := sales.confirm_credit_sale(
        v_admin_token, md5('wsf006-credit11-' || v_suffix)::uuid,
        sha256(convert_to(v_lines::text, 'UTF8')),
        v_customer1_id, v_warehouse_id, v_period_id, v_doc_date, v_lines, NULL
    );
    v_doc_credit_earlier := (v_credit_result ->> 'document_id')::bigint;

    PERFORM sales.begin_cash_session_close(v_admin_token, v_session4);
    SELECT jsonb_agg(
        jsonb_build_object(
            'denomination_id', id,
            'quantity', CASE WHEN code = 'DZD_500' THEN 1 ELSE 0 END
        ) ORDER BY display_order
    )
    INTO v_counts
    FROM cash.denominations
    WHERE is_active;
    v_res := sales.submit_cash_session_count(v_admin_token, v_session4, v_counts);
    IF v_res->>'status' <> 'CLOSED' THEN
        RAISE EXCEPTION 'Assertion failed (11): setup close of session4 did not succeed: %', v_res;
    END IF;

    -- =========================================================================
    -- PHASE E -- session5 (float 500): test 11 check, test 13, test 14.
    -- =========================================================================
    v_session5 := sales.open_cash_session(v_admin_token, v_warehouse_id, v_workstation, 500.00);
    UPDATE sales.cash_sessions SET opened_at = now() + interval '1 hour' WHERE id = v_session5;

    -- 11. Credit sale from an earlier (now closed) session -> 55000.
    v_blocked := false;
    BEGIN
        PERFORM sales.void_sale(v_admin_token, v_doc_credit_earlier, 'WRONG_ITEM', NULL);
    EXCEPTION WHEN SQLSTATE '55000' THEN v_blocked := true;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'Assertion failed (11): voiding a credit sale from an already-closed originating session was allowed';
    END IF;

    -- 13. sales.list_session_sales returns the voided cash sale (REVERSED, AN- number)
    --     and a non-voided sale (POSTED), for session1.
    v_res := sales.list_session_sales(v_admin_token, v_session1);
    IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_res) row
        WHERE (row->>'document_id')::bigint = v_doc1
          AND row->>'status' = 'REVERSED'
          AND row->>'void_document_number' LIKE 'AN-%'
    ) THEN
        RAISE EXCEPTION 'Assertion failed (13): voided sale missing or malformed in list_session_sales: %', v_res;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_res) row
        WHERE (row->>'document_id')::bigint = v_doc_untouched
          AND row->>'status' = 'POSTED'
    ) THEN
        RAISE EXCEPTION 'Assertion failed (13): untouched posted sale missing from list_session_sales: %', v_res;
    END IF;

    -- 14. A user without VOID_SALE (a CASHIER) -> 42501.
    v_blocked := false;
    BEGIN
        PERFORM sales.void_sale(v_cashier_token, v_doc_untouched, 'WRONG_ITEM', NULL);
    EXCEPTION WHEN SQLSTATE '42501' THEN v_blocked := true;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'Assertion failed (14a): a cashier without VOID_SALE could call void_sale';
    END IF;

    v_blocked := false;
    BEGIN
        PERFORM sales.list_session_sales(v_cashier_token, v_session1);
    EXCEPTION WHEN SQLSTATE '42501' THEN v_blocked := true;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'Assertion failed (14b): a cashier without VOID_SALE could call list_session_sales';
    END IF;

    -- 15. operations.schema_state.migration_version >= 20260922090000.
    IF (SELECT migration_version FROM operations.schema_state WHERE singleton) < 20260922090000 THEN
        RAISE EXCEPTION 'Assertion failed (15): schema_state.migration_version mismatch';
    END IF;

    RAISE NOTICE '=== WS-F-006 sale void integration suite completed successfully ===';
END;
$$;

-- =============================================================================
-- 16. Re-applying the migration file a second time raises no error.
-- =============================================================================
\i src-tauri/migrations/20260922090000_ws_f_006_sale_void.sql
