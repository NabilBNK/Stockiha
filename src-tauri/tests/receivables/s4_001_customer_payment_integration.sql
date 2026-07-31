-- S4-001 Integration Test — customer payment allocation, cash ledger, drawer, document queue, and isolation.
\set ON_ERROR_STOP on

DO $$
DECLARE
    v_suffix text := floor(random() * 1000000000)::bigint::text;
    v_username text := 's4001_pay_admin_' || v_suffix;
    v_token text := 's4001_pay_token_' || v_suffix;
    v_workstation text := 'S4001-PAY-WKS-' || v_suffix;
    v_user_id bigint;
    v_period_id bigint;
    v_period_start date;
    v_period_end date;
    v_doc_date date;
    v_unit_id bigint;
    v_warehouse_id bigint;
    v_product_id bigint;
    v_variant_id bigint;
    v_customer1 bigint;
    v_customer2 bigint;
    v_credit1 jsonb;
    v_credit2 jsonb;
    v_credit_doc1 bigint;
    v_credit_doc2 bigint;
    v_invoice_ledger1 bigint;
    v_invoice_ledger2 bigint;
    v_cash_session_id bigint;
    v_payment_request uuid := md5('s4pay-r1-' || v_suffix || clock_timestamp()::text)::uuid;
    v_bad_request uuid := md5('s4pay-bad-' || v_suffix || clock_timestamp()::text)::uuid;
    v_payment jsonb;
    v_retry jsonb;
    v_payment_doc bigint;
    v_exposure numeric(14,2);
    v_remaining numeric(14,2);
    v_count bigint;
    v_generation_job_id bigint;
    v_reprint_job_id bigint;
    v_cross_blocked boolean := false;
BEGIN
    RAISE NOTICE '=== Running S4-001 customer payment integration suite ===';

    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES (v_username, 'S4001 Payment Admin', 'hashed_pass')
    RETURNING id INTO v_user_id;
    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_user_id, id FROM iam.roles WHERE code = 'ADMIN';
    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_user_id, v_workstation, sha256(v_token::bytea), now() + interval '2 hours');

    SELECT id, starts_on, ends_on
    INTO v_period_id, v_period_start, v_period_end
    FROM finance.fiscal_periods
    WHERE status = 'OPEN'
    ORDER BY starts_on DESC LIMIT 1;
    IF v_period_id IS NULL THEN RAISE EXCEPTION 'S4 payment integration requires OPEN fiscal period'; END IF;
    v_doc_date := greatest(v_period_start, least((now() AT TIME ZONE 'Africa/Algiers')::date, v_period_end));

    SELECT id INTO v_unit_id FROM catalog.units WHERE normalized_code = 'UNIT' LIMIT 1;
    IF v_unit_id IS NULL THEN RAISE EXCEPTION 'S4 payment integration requires UNIT'; END IF;

    INSERT INTO inventory.warehouses (code, name)
    VALUES ('WH-S4PAY-' || v_suffix, 'S4 Payment Warehouse') RETURNING id INTO v_warehouse_id;
    INSERT INTO catalog.products (name, is_active)
    VALUES ('S4 Payment Product ' || v_suffix, true) RETURNING id INTO v_product_id;
    INSERT INTO catalog.product_variants (product_id, base_unit_id, sku, sale_price, is_active)
    VALUES (v_product_id, v_unit_id, 'SKU-S4PAY-' || v_suffix, 150.00, true) RETURNING id INTO v_variant_id;
    INSERT INTO inventory.positions (warehouse_id, variant_id, quantity_on_hand, total_value, last_known_wac)
    VALUES (v_warehouse_id, v_variant_id, 20.000, 2000.0000, 100.000000);

    v_customer1 := (receivables.create_customer(
        v_token, 'CUS-S4PAY-A-' || v_suffix, 'Payment Customer A', NULL, NULL, NULL, NULL, NULL,
        true, 1000.00, 30, 60
    )->>'id')::bigint;
    v_customer2 := (receivables.create_customer(
        v_token, 'CUS-S4PAY-B-' || v_suffix, 'Payment Customer B', NULL, NULL, NULL, NULL, NULL,
        true, 1000.00, 30, 60
    )->>'id')::bigint;

    v_credit1 := sales.confirm_credit_sale(
        v_token,
        md5('s4pay-credit-a-' || v_suffix)::uuid,
        v_customer1, v_warehouse_id, v_period_id, v_doc_date,
        jsonb_build_array(jsonb_build_object('variant_id', v_variant_id, 'quantity', '2', 'unit_price', '150.00')),
        NULL
    );
    v_credit_doc1 := (v_credit1->>'document_id')::bigint;

    v_credit2 := sales.confirm_credit_sale(
        v_token,
        md5('s4pay-credit-b-' || v_suffix)::uuid,
        v_customer2, v_warehouse_id, v_period_id, v_doc_date,
        jsonb_build_array(jsonb_build_object('variant_id', v_variant_id, 'quantity', '1', 'unit_price', '150.00')),
        NULL
    );
    v_credit_doc2 := (v_credit2->>'document_id')::bigint;

    SELECT id INTO v_invoice_ledger1
    FROM receivables.customer_ledger_entries
    WHERE customer_id = v_customer1 AND document_id = v_credit_doc1 AND entry_type = 'CREDIT_INVOICE';
    SELECT id INTO v_invoice_ledger2
    FROM receivables.customer_ledger_entries
    WHERE customer_id = v_customer2 AND document_id = v_credit_doc2 AND entry_type = 'CREDIT_INVOICE';

    v_cash_session_id := sales.open_cash_session(v_token, v_warehouse_id, v_workstation, 0);

    -- Collect 100 cash against customer A's 300 open invoice.
    v_payment := receivables.post_customer_payment(
        v_token, v_payment_request, v_customer1, 100.00, 'CASH', v_cash_session_id,
        v_period_id, v_doc_date,
        jsonb_build_array(jsonb_build_object('invoice_ledger_entry_id', v_invoice_ledger1, 'amount', '100.00')),
        'S4 payment integration'
    );
    v_payment_doc := (v_payment->>'document_id')::bigint;

    IF (v_payment->>'amount')::numeric <> 100.00 OR (v_payment->>'exposure_amount')::numeric <> 200.00 THEN
        RAISE EXCEPTION 'Assertion failed: customer payment amount/exposure wrong: %', v_payment;
    END IF;

    -- Receipt queue is created in the same posting transaction.
    SELECT min(id), count(*)
    INTO v_generation_job_id, v_count
    FROM documents.generation_jobs
    WHERE business_document_id = v_payment_doc
      AND document_kind = 'CUSTOMER_PAYMENT_RECEIPT_PDF'
      AND status = 'PENDING';
    IF v_count <> 1 OR v_generation_job_id IS NULL THEN
        RAISE EXCEPTION 'Assertion failed: customer payment did not enqueue exactly one pending receipt generation job';
    END IF;

    SELECT count(*) INTO v_count
    FROM documents.print_jobs
    WHERE business_document_id = v_payment_doc
      AND generation_job_id = v_generation_job_id
      AND status = 'WAITING_FOR_GENERATION';
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'Assertion failed: customer payment did not enqueue exactly one waiting original print job';
    END IF;

    SELECT exposure_amount INTO v_exposure
    FROM receivables.customer_credit_state WHERE customer_id = v_customer1;
    IF v_exposure <> 200.00 THEN
        RAISE EXCEPTION 'Assertion failed: exposure expected 200 after payment, got %', v_exposure;
    END IF;

    SELECT l.amount_delta - coalesce(sum(pa.amount), 0)
    INTO v_remaining
    FROM receivables.customer_ledger_entries l
    LEFT JOIN receivables.payment_allocations pa ON pa.invoice_ledger_entry_id = l.id
    WHERE l.id = v_invoice_ledger1
    GROUP BY l.amount_delta;
    IF v_remaining <> 200.00 THEN
        RAISE EXCEPTION 'Assertion failed: invoice remaining expected 200, got %', v_remaining;
    END IF;

    SELECT count(*) INTO v_count
    FROM cash.movements
    WHERE business_document_id = v_payment_doc
      AND cash_session_id = v_cash_session_id
      AND movement_type = 'CUSTOMER_PAYMENT'
      AND amount = 100.00;
    IF v_count <> 1 THEN RAISE EXCEPTION 'Assertion failed: cash payment movement missing'; END IF;

    SELECT count(*) INTO v_count
    FROM cash.drawer_jobs
    WHERE business_document_id = v_payment_doc
      AND idempotency_key = 'customer_payment:' || v_payment_request::text;
    IF v_count <> 1 THEN RAISE EXCEPTION 'Assertion failed: customer payment drawer job missing'; END IF;

    SELECT count(*) INTO v_count
    FROM receivables.customer_ledger_entries
    WHERE customer_id = v_customer1 AND document_id = v_payment_doc
      AND entry_type = 'PAYMENT' AND amount_delta = -100.00;
    IF v_count <> 1 THEN RAISE EXCEPTION 'Assertion failed: payment ledger row missing'; END IF;

    SELECT count(*) INTO v_count
    FROM (
        SELECT jl.document_id
        FROM receivables.customer_payments cp
        JOIN finance.journal_lines jl ON jl.document_id = cp.journal_document_id
        WHERE cp.document_id = v_payment_doc
        GROUP BY jl.document_id
        HAVING sum(jl.debit) <> sum(jl.credit)
    ) bad;
    IF v_count <> 0 THEN RAISE EXCEPTION 'Assertion failed: customer payment journal unbalanced'; END IF;

    -- Same request is idempotent: no second cash movement, drawer pulse,
    -- allocation, receipt generation job, or original print job.
    v_retry := receivables.post_customer_payment(
        v_token, v_payment_request, v_customer1, 100.00, 'CASH', v_cash_session_id,
        v_period_id, v_doc_date,
        jsonb_build_array(jsonb_build_object('amount', '100.0', 'invoice_ledger_entry_id', v_invoice_ledger1)),
        'S4 payment integration'
    );
    IF (v_retry->>'document_id')::bigint <> v_payment_doc THEN
        RAISE EXCEPTION 'Assertion failed: payment idempotent retry returned different document';
    END IF;
    SELECT count(*) INTO v_count FROM cash.movements WHERE business_document_id = v_payment_doc;
    IF v_count <> 1 THEN RAISE EXCEPTION 'Assertion failed: retry duplicated cash movement'; END IF;
    SELECT count(*) INTO v_count FROM cash.drawer_jobs WHERE business_document_id = v_payment_doc;
    IF v_count <> 1 THEN RAISE EXCEPTION 'Assertion failed: retry duplicated drawer job'; END IF;
    SELECT count(*) INTO v_count FROM documents.generation_jobs WHERE business_document_id = v_payment_doc;
    IF v_count <> 1 THEN RAISE EXCEPTION 'Assertion failed: retry duplicated receipt generation job'; END IF;
    SELECT count(*) INTO v_count FROM documents.print_jobs WHERE business_document_id = v_payment_doc;
    IF v_count <> 1 THEN RAISE EXCEPTION 'Assertion failed: retry duplicated original receipt print job'; END IF;

    -- Complete receipt generation and prove reprint is print-only: the cash
    -- payment's one legitimate drawer job remains exactly one.
    PERFORM documents.complete_generation_job(
        v_generation_job_id, true, false,
        'generated/test-payment-receipt-' || v_payment_doc::text || '.pdf',
        NULL, NULL
    );
    IF NOT EXISTS (
        SELECT 1 FROM documents.print_jobs
        WHERE business_document_id = v_payment_doc
          AND generation_job_id = v_generation_job_id
          AND status = 'PENDING'
    ) THEN
        RAISE EXCEPTION 'Assertion failed: completed receipt generation did not release original print job';
    END IF;

    v_reprint_job_id := documents.enqueue_customer_reprint(
        v_token,
        v_payment_doc,
        's4001-payment-reprint-' || v_suffix
    );
    IF v_reprint_job_id IS NULL THEN
        RAISE EXCEPTION 'Assertion failed: payment receipt reprint job was not created';
    END IF;
    SELECT count(*) INTO v_count FROM documents.print_jobs WHERE business_document_id = v_payment_doc;
    IF v_count <> 2 THEN RAISE EXCEPTION 'Assertion failed: payment receipt should have original + one reprint job'; END IF;
    SELECT count(*) INTO v_count FROM cash.drawer_jobs WHERE business_document_id = v_payment_doc;
    IF v_count <> 1 THEN RAISE EXCEPTION 'Assertion failed: receipt reprint created another drawer job'; END IF;
    SELECT count(*) INTO v_count FROM cash.movements WHERE business_document_id = v_payment_doc;
    IF v_count <> 1 THEN RAISE EXCEPTION 'Assertion failed: receipt reprint created another cash movement'; END IF;
    SELECT exposure_amount INTO v_exposure FROM receivables.customer_credit_state WHERE customer_id = v_customer1;
    IF v_exposure <> 200.00 THEN RAISE EXCEPTION 'Assertion failed: receipt generation/reprint changed exposure'; END IF;

    -- Customer B has its own exposure, but may never allocate a payment against A's invoice.
    BEGIN
        PERFORM receivables.post_customer_payment(
            v_token, v_bad_request, v_customer2, 50.00, 'BANK_TRANSFER', NULL,
            v_period_id, v_doc_date,
            jsonb_build_array(jsonb_build_object('invoice_ledger_entry_id', v_invoice_ledger1, 'amount', '50.00')),
            NULL
        );
    EXCEPTION
        WHEN SQLSTATE '55000' THEN v_cross_blocked := true;
    END;
    IF NOT v_cross_blocked THEN
        RAISE EXCEPTION 'Assertion failed: cross-customer payment allocation was accepted';
    END IF;

    SELECT exposure_amount INTO v_exposure
    FROM receivables.customer_credit_state WHERE customer_id = v_customer2;
    IF v_exposure <> 150.00 THEN
        RAISE EXCEPTION 'Assertion failed: rejected cross-customer allocation changed customer B exposure';
    END IF;

    RAISE NOTICE 'PASSED: S4-001 customer payment allocation, idempotency, cash/drawer, receipt generation/reprint queue, journal, and customer isolation';
END;
$$;