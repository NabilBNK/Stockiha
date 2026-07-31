-- S4-001 Integration Test — customer credit sale, exposure, override, ledger, and document queue integrity.
\set ON_ERROR_STOP on

DO $$
DECLARE
    v_suffix text := floor(random() * 1000000000)::bigint::text;
    v_username text := 's4001_admin_' || v_suffix;
    v_session_token text := 's4001_token_' || v_suffix;
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
    v_lines jsonb;
    v_changed_lines jsonb;
    v_request1 uuid := md5('s4001-r1-' || v_suffix || clock_timestamp()::text)::uuid;
    v_request2 uuid := md5('s4001-r2-' || v_suffix || clock_timestamp()::text)::uuid;
    v_request3 uuid := md5('s4001-r3-' || v_suffix || clock_timestamp()::text)::uuid;
    v_request4 uuid := md5('s4001-r4-' || v_suffix || clock_timestamp()::text)::uuid;
    v_override uuid := md5('s4001-override-' || v_suffix || clock_timestamp()::text)::uuid;
    v_result1 jsonb;
    v_retry jsonb;
    v_result2 jsonb;
    v_doc1 bigint;
    v_doc2 bigint;
    v_qty numeric(18,3);
    v_val numeric(18,4);
    v_exposure numeric(14,2);
    v_ledger_count bigint;
    v_cash_count bigint;
    v_drawer_count bigint;
    v_unbalanced bigint;
    v_generation_count bigint;
    v_print_count bigint;
    v_generation_job_id bigint;
    v_reprint_job_id bigint;
    v_blocked boolean := false;
    v_mismatch_blocked boolean := false;
    v_reuse_blocked boolean := false;
BEGIN
    RAISE NOTICE '=== Running S4-001 customer credit sale integration suite ===';

    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES (v_username, 'S4001 Admin', 'hashed_pass')
    RETURNING id INTO v_user_id;

    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_user_id, r.id FROM iam.roles r WHERE r.code = 'ADMIN';

    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_user_id, 'TEST-WKS-S4001-' || v_suffix, sha256(v_session_token::bytea), now() + interval '2 hours');

    SELECT id, starts_on, ends_on
    INTO v_period_id, v_period_start, v_period_end
    FROM finance.fiscal_periods
    WHERE status = 'OPEN'
    ORDER BY starts_on DESC
    LIMIT 1;

    IF v_period_id IS NULL THEN
        RAISE EXCEPTION 'S4-001 integration test requires one OPEN fiscal period';
    END IF;

    v_doc_date := greatest(v_period_start, least((now() AT TIME ZONE 'Africa/Algiers')::date, v_period_end));

    SELECT id INTO v_unit_id FROM catalog.units WHERE normalized_code = 'UNIT' LIMIT 1;
    IF v_unit_id IS NULL THEN
        RAISE EXCEPTION 'S4-001 integration test requires canonical UNIT catalog unit';
    END IF;

    INSERT INTO inventory.warehouses (code, name)
    VALUES ('WH-S4001-' || v_suffix, 'S4001 Warehouse')
    RETURNING id INTO v_warehouse_id;

    INSERT INTO catalog.products (name, is_active)
    VALUES ('S4001 Credit Item ' || v_suffix, true)
    RETURNING id INTO v_product_id;

    INSERT INTO catalog.product_variants (
        product_id, base_unit_id, sku, sale_price, is_active
    ) VALUES (
        v_product_id, v_unit_id, 'SKU-S4001-' || v_suffix, 150.00, true
    ) RETURNING id INTO v_variant_id;

    INSERT INTO inventory.positions (
        warehouse_id, variant_id, quantity_on_hand, total_value, last_known_wac
    ) VALUES (
        v_warehouse_id, v_variant_id, 10.000, 1000.0000, 100.000000
    );

    v_customer_json := receivables.create_customer(
        v_session_token,
        'CUS-S4001-' || v_suffix,
        'S4001 Credit Customer',
        NULL, NULL, NULL, NULL, NULL,
        true, 500.00, 30, 60
    );
    v_customer_id := (v_customer_json ->> 'id')::bigint;

    v_lines := jsonb_build_array(
        jsonb_build_object(
            'variant_id', v_variant_id,
            'quantity', '2',
            'unit_price', '150.00'
        )
    );
    v_changed_lines := jsonb_build_array(
        jsonb_build_object(
            'variant_id', v_variant_id,
            'quantity', '3',
            'unit_price', '150.00'
        )
    );

    -- Public wrapper derives its own payload hash. First 300 DZD sale succeeds.
    v_result1 := sales.confirm_credit_sale(
        v_session_token, v_request1,
        v_customer_id, v_warehouse_id, v_period_id, v_doc_date,
        v_lines, NULL
    );
    v_doc1 := (v_result1 ->> 'document_id')::bigint;

    IF (v_result1 ->> 'total_amount')::numeric <> 300.00 THEN
        RAISE EXCEPTION 'Assertion failed: first credit sale total is not 300.00';
    END IF;
    IF (v_result1 ->> 'exposure_amount')::numeric <> 300.00 THEN
        RAISE EXCEPTION 'Assertion failed: first credit sale exposure is not 300.00';
    END IF;
    IF (v_result1 ->> 'available_credit')::numeric <> 200.00 THEN
        RAISE EXCEPTION 'Assertion failed: first available credit is not 200.00';
    END IF;

    -- Posting the invoice must atomically enqueue exactly one generation job and
    -- one original print job. A rollback or idempotent retry must not duplicate them.
    SELECT count(*), min(id)
    INTO v_generation_count, v_generation_job_id
    FROM documents.generation_jobs
    WHERE business_document_id = v_doc1
      AND document_kind = 'CREDIT_SALE_INVOICE_PDF'
      AND status = 'PENDING';
    IF v_generation_count <> 1 OR v_generation_job_id IS NULL THEN
        RAISE EXCEPTION 'Assertion failed: credit sale did not enqueue exactly one pending invoice generation job';
    END IF;

    SELECT count(*) INTO v_print_count
    FROM documents.print_jobs
    WHERE business_document_id = v_doc1
      AND generation_job_id = v_generation_job_id
      AND status = 'WAITING_FOR_GENERATION';
    IF v_print_count <> 1 THEN
        RAISE EXCEPTION 'Assertion failed: credit sale did not enqueue exactly one waiting original print job';
    END IF;

    SELECT quantity_on_hand, total_value INTO v_qty, v_val
    FROM inventory.positions
    WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_id;
    IF v_qty <> 8.000 OR v_val <> 800.0000 THEN
        RAISE EXCEPTION 'Assertion failed: first credit sale stock expected qty=8/value=800, got qty=% value=%', v_qty, v_val;
    END IF;

    SELECT exposure_amount INTO v_exposure
    FROM receivables.customer_credit_state WHERE customer_id = v_customer_id;
    IF v_exposure <> 300.00 THEN
        RAISE EXCEPTION 'Assertion failed: authoritative exposure cache expected 300.00, got %', v_exposure;
    END IF;

    SELECT count(*) INTO v_ledger_count
    FROM receivables.customer_ledger_entries
    WHERE customer_id = v_customer_id
      AND document_id = v_doc1
      AND entry_type = 'CREDIT_INVOICE'
      AND amount_delta = 300.00;
    IF v_ledger_count <> 1 THEN
        RAISE EXCEPTION 'Assertion failed: first credit sale must append exactly one 300 DZD ledger entry';
    END IF;

    v_retry := sales.confirm_credit_sale(
        v_session_token, v_request1,
        v_customer_id, v_warehouse_id, v_period_id, v_doc_date,
        v_lines, NULL
    );
    IF (v_retry ->> 'document_id')::bigint <> v_doc1 THEN
        RAISE EXCEPTION 'Assertion failed: idempotent retry returned a different credit document';
    END IF;

    SELECT quantity_on_hand INTO v_qty
    FROM inventory.positions
    WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_id;
    IF v_qty <> 8.000 THEN
        RAISE EXCEPTION 'Assertion failed: idempotent retry changed stock';
    END IF;

    SELECT count(*) INTO v_generation_count
    FROM documents.generation_jobs
    WHERE business_document_id = v_doc1
      AND document_kind = 'CREDIT_SALE_INVOICE_PDF';
    SELECT count(*) INTO v_print_count
    FROM documents.print_jobs
    WHERE business_document_id = v_doc1;
    IF v_generation_count <> 1 OR v_print_count <> 1 THEN
        RAISE EXCEPTION 'Assertion failed: idempotent sale retry duplicated document queue rows';
    END IF;

    -- Simulate successful PDF publication: linked original print becomes PENDING.
    PERFORM documents.complete_generation_job(
        v_generation_job_id, true, false,
        'generated/test-credit-invoice-' || v_doc1::text || '.pdf',
        NULL, NULL
    );
    IF NOT EXISTS (
        SELECT 1 FROM documents.print_jobs
        WHERE business_document_id = v_doc1
          AND generation_job_id = v_generation_job_id
          AND status = 'PENDING'
    ) THEN
        RAISE EXCEPTION 'Assertion failed: completing invoice generation did not release original print job';
    END IF;

    -- A reprint is a new print job only. It never reposts financial state or drawer work.
    v_reprint_job_id := documents.enqueue_customer_reprint(
        v_session_token,
        v_doc1,
        's4001-credit-reprint-' || v_suffix
    );
    IF v_reprint_job_id IS NULL THEN
        RAISE EXCEPTION 'Assertion failed: credit invoice reprint job was not created';
    END IF;
    SELECT count(*) INTO v_print_count
    FROM documents.print_jobs
    WHERE business_document_id = v_doc1;
    IF v_print_count <> 2 THEN
        RAISE EXCEPTION 'Assertion failed: credit invoice should have original + one reprint job';
    END IF;
    IF documents.enqueue_customer_reprint(
        v_session_token,
        v_doc1,
        's4001-credit-reprint-' || v_suffix
    ) <> v_reprint_job_id THEN
        RAISE EXCEPTION 'Assertion failed: reprint idempotency key did not return the same print job';
    END IF;

    -- Another 300 exceeds the 500 limit and must roll back cleanly.
    BEGIN
        PERFORM sales.confirm_credit_sale(
            v_session_token, v_request2,
            v_customer_id, v_warehouse_id, v_period_id, v_doc_date,
            v_lines, NULL
        );
    EXCEPTION
        WHEN SQLSTATE '55000' THEN
            v_blocked := true;
    END;

    IF NOT v_blocked THEN
        RAISE EXCEPTION 'Assertion failed: over-limit credit sale was not blocked';
    END IF;

    SELECT exposure_amount INTO v_exposure
    FROM receivables.customer_credit_state WHERE customer_id = v_customer_id;
    SELECT quantity_on_hand INTO v_qty
    FROM inventory.positions WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_id;
    IF v_exposure <> 300.00 OR v_qty <> 8.000 THEN
        RAISE EXCEPTION 'Assertion failed: rejected credit sale changed exposure or stock';
    END IF;

    -- Manager authorizes exact 2-unit intent using actual fields, not caller hash.
    PERFORM receivables.authorize_credit_override(
        v_session_token, v_override,
        v_customer_id, v_warehouse_id, v_period_id, v_doc_date, v_lines,
        'Approved S4 integration over-limit sale', 15
    );

    -- Same token MUST fail for a mutated 3-unit cart even though caller owns the
    -- token value. PostgreSQL recomputes fingerprint from changed inputs.
    BEGIN
        PERFORM sales.confirm_credit_sale(
            v_session_token, v_request3,
            v_customer_id, v_warehouse_id, v_period_id, v_doc_date,
            v_changed_lines, v_override
        );
    EXCEPTION
        WHEN SQLSTATE '55000' THEN
            v_mismatch_blocked := true;
    END;

    IF NOT v_mismatch_blocked THEN
        RAISE EXCEPTION 'Assertion failed: payload-mutated sale reused exact override token';
    END IF;
    IF EXISTS (
        SELECT 1 FROM receivables.credit_override_tokens
        WHERE id = v_override AND consumed_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'Assertion failed: rejected payload mismatch consumed override token';
    END IF;

    -- Exact authorized intent succeeds and consumes token once.
    v_result2 := sales.confirm_credit_sale(
        v_session_token, v_request2,
        v_customer_id, v_warehouse_id, v_period_id, v_doc_date,
        v_lines, v_override
    );
    v_doc2 := (v_result2 ->> 'document_id')::bigint;

    IF (v_result2 ->> 'exposure_amount')::numeric <> 600.00 THEN
        RAISE EXCEPTION 'Assertion failed: override sale exposure expected 600.00';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM receivables.credit_override_tokens
        WHERE id = v_override
          AND consumed_at IS NOT NULL
          AND consumed_document_id = v_doc2
    ) THEN
        RAISE EXCEPTION 'Assertion failed: override token was not consumed by posted document';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM documents.generation_jobs
        WHERE business_document_id = v_doc2
          AND document_kind = 'CREDIT_SALE_INVOICE_PDF'
          AND status = 'PENDING'
    ) THEN
        RAISE EXCEPTION 'Assertion failed: override credit sale did not enqueue its invoice generation job';
    END IF;

    BEGIN
        PERFORM sales.confirm_credit_sale(
            v_session_token, v_request4,
            v_customer_id, v_warehouse_id, v_period_id, v_doc_date,
            v_lines, v_override
        );
    EXCEPTION
        WHEN SQLSTATE '55000' THEN
            v_reuse_blocked := true;
    END;

    IF NOT v_reuse_blocked THEN
        RAISE EXCEPTION 'Assertion failed: consumed override token was reusable';
    END IF;

    SELECT count(*) INTO v_unbalanced
    FROM (
        SELECT je.document_id
        FROM sales.credit_sales cs
        JOIN finance.journal_entries je ON je.document_id = cs.journal_document_id
        JOIN finance.journal_lines jl ON jl.document_id = je.document_id
        WHERE cs.customer_id = v_customer_id
        GROUP BY je.document_id
        HAVING sum(jl.debit) <> sum(jl.credit)
    ) bad;
    IF v_unbalanced <> 0 THEN
        RAISE EXCEPTION 'Assertion failed: one or more credit sale journals are unbalanced';
    END IF;

    SELECT count(*) INTO v_cash_count
    FROM cash.movements
    WHERE business_document_id IN (v_doc1, v_doc2);
    SELECT count(*) INTO v_drawer_count
    FROM cash.drawer_jobs
    WHERE business_document_id IN (v_doc1, v_doc2);
    IF v_cash_count <> 0 OR v_drawer_count <> 0 THEN
        RAISE EXCEPTION 'Assertion failed: credit sale or invoice reprint created cash movement/drawer pulse';
    END IF;

    SELECT exposure_amount INTO v_exposure
    FROM receivables.customer_credit_state WHERE customer_id = v_customer_id;
    IF v_exposure <> 600.00 THEN
        RAISE EXCEPTION 'Assertion failed: document generation/reprint changed customer exposure';
    END IF;

    RAISE NOTICE 'PASSED: S4-001 credit sale, idempotency, override, ledger, accounting, invoice generation/reprint queue, and no-cash assertions';
END;
$$;