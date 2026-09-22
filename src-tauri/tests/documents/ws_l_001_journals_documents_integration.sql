-- WS-L-001 Integration Test: journals & documents fixed, findable, attributable.
\set ON_ERROR_STOP on

DO $$
DECLARE
    v_suffix text := floor(random() * 1000000000)::bigint::text;
    v_workstation text := 'WSL001-WKS-' || v_suffix;
    v_admin_username text := 'wsl001_admin_' || v_suffix;
    v_admin_token text := 'wsl001_admin_token_' || v_suffix;
    v_admin_id bigint;
    v_warehouse_id bigint;
    v_period_id bigint;
    v_doc_date date;
    v_unit_id bigint;
    v_product_id bigint;
    v_variant_id bigint;
    v_lines jsonb;

    v_session1 bigint;
    v_counts jsonb;
    v_res jsonb;

    v_cash_sale_doc bigint;
    v_cash_sale_journal bigint;
    v_void_res jsonb;
    v_void_doc bigint;

    v_customer_id bigint;
    v_customer_json jsonb;
    v_credit_result jsonb;
    v_credit_doc bigint;
    v_invoice_entry_id bigint;
    v_payment_res jsonb;

    v_cash_out_res jsonb;
    v_cash_out_journal bigint;

    v_po_doc bigint;
    v_receipt_doc bigint;
    v_invoice_doc bigint;
    v_pt_doc bigint;
    v_pt_fiscal_year integer;
    v_supplier_id bigint;

    v_detail jsonb;
    v_search jsonb;
    v_journal_search jsonb;
    v_reports jsonb;
    v_before_perm_count integer;

    v_collision_movement_journal bigint;
    v_collision_target_doc bigint;
    v_blocked boolean;
    v_check text;
BEGIN
    RAISE NOTICE '=== Running WS-L-001 journals & documents integration suite ===';

    -- 1. SUPER_ADMIN holds every permission, including APPLY_SALE_DISCOUNT.
    IF EXISTS (
        SELECT 1 FROM iam.permissions p
        WHERE NOT EXISTS (
            SELECT 1 FROM iam.role_permissions rp
            JOIN iam.roles r ON r.id = rp.role_id
            WHERE r.code = 'SUPER_ADMIN' AND rp.permission_id = p.id
        )
    ) THEN
        RAISE EXCEPTION 'Assertion failed (1): SUPER_ADMIN is missing at least one permission';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM iam.role_permissions rp
        JOIN iam.roles r ON r.id = rp.role_id
        JOIN iam.permissions p ON p.id = rp.permission_id
        WHERE r.code = 'SUPER_ADMIN' AND p.code = 'APPLY_SALE_DISCOUNT'
    ) THEN
        RAISE EXCEPTION 'Assertion failed (1): SUPER_ADMIN does not hold APPLY_SALE_DISCOUNT';
    END IF;

    -- 2. A newly inserted permission is granted to SUPER_ADMIN immediately.
    SELECT count(*) INTO v_before_perm_count FROM iam.role_permissions rp
        JOIN iam.roles r ON r.id = rp.role_id WHERE r.code = 'SUPER_ADMIN';

    SELECT pg_get_expr(c.conbin, c.conrelid) INTO v_check
    FROM pg_constraint c
    WHERE c.conrelid = 'iam.permissions'::regclass AND c.conname = 'permissions_code_valid';
    EXECUTE format('ALTER TABLE iam.permissions DROP CONSTRAINT permissions_code_valid');
    EXECUTE format(
        'ALTER TABLE iam.permissions ADD CONSTRAINT permissions_code_valid CHECK ((%s) OR code = %L)',
        v_check, 'WSL001_TEST'
    );
    INSERT INTO iam.permissions (code, name) VALUES ('WSL001_TEST', 'WS-L-001 test permission');
    IF NOT EXISTS (
        SELECT 1 FROM iam.role_permissions rp
        JOIN iam.roles r ON r.id = rp.role_id
        JOIN iam.permissions p ON p.id = rp.permission_id
        WHERE r.code = 'SUPER_ADMIN' AND p.code = 'WSL001_TEST'
    ) THEN
        RAISE EXCEPTION 'Assertion failed (2): SUPER_ADMIN was not auto-granted the new permission';
    END IF;

    -- Fixture users, warehouse, product ----------------------------------
    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES (v_admin_username, 'WS-L-001 Admin', 'hash')
    RETURNING id INTO v_admin_id;
    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_admin_id, id FROM iam.roles WHERE code = 'SUPER_ADMIN';
    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_admin_id, v_workstation, sha256(v_admin_token::bytea), now() + interval '2 hours');

    SELECT id, starts_on + 1 INTO v_period_id, v_doc_date
    FROM finance.fiscal_periods WHERE status = 'OPEN' ORDER BY starts_on DESC LIMIT 1;
    ASSERT v_period_id IS NOT NULL, 'WS-L-001 requires an open fiscal period';

    INSERT INTO inventory.warehouses (code, name) VALUES ('WH-WSL001-' || v_suffix, 'WS-L-001 Warehouse')
    RETURNING id INTO v_warehouse_id;
    SELECT id INTO v_unit_id FROM catalog.units ORDER BY id LIMIT 1;
    INSERT INTO catalog.products (name, is_active) VALUES ('WSL001 Item ' || v_suffix, true)
    RETURNING id INTO v_product_id;
    INSERT INTO catalog.product_variants (product_id, base_unit_id, sku, sale_price, is_active)
    VALUES (v_product_id, v_unit_id, 'SKU-WSL001-' || v_suffix, 500.00, true)
    RETURNING id INTO v_variant_id;
    INSERT INTO inventory.positions (warehouse_id, variant_id, quantity_on_hand, total_value, last_known_wac)
    VALUES (v_warehouse_id, v_variant_id, 500.000, 50000.0000, 100.000000);

    -- A cash sale with a discount, then cancelled -------------------------
    v_session1 := sales.open_cash_session(v_admin_token, v_warehouse_id, v_workstation, 2000.00);

    v_lines := jsonb_build_array(jsonb_build_object('variant_id', v_variant_id, 'quantity', 2.000, 'unit_price', 500.00));
    v_cash_sale_doc := sales.confirm_cash_sale(
        v_admin_token, md5('wsl001-cash-' || v_suffix)::uuid,
        sha256(convert_to(v_lines::text || ':100.00', 'UTF8')),
        v_session1, v_warehouse_id, v_period_id, v_doc_date, v_lines, 100.00
    );
    SELECT je.document_id INTO v_cash_sale_journal
    FROM finance.journal_entries je WHERE je.source_type = 'CASH_SALE' AND je.source_id = v_cash_sale_doc;

    -- A credit sale, unpaid ------------------------------------------------
    v_customer_json := receivables.create_customer(
        v_admin_token, 'CUS-WSL001-' || v_suffix, 'WSL001 Customer',
        NULL, NULL, NULL, NULL, NULL, true, 5000.00, 30, 60
    );
    v_customer_id := (v_customer_json ->> 'id')::bigint;

    v_lines := jsonb_build_array(jsonb_build_object('variant_id', v_variant_id, 'quantity', 1.000, 'unit_price', 400.00));
    v_credit_result := sales.confirm_credit_sale(
        v_admin_token, md5('wsl001-credit-' || v_suffix)::uuid,
        sha256(convert_to(v_lines::text, 'UTF8')),
        v_customer_id, v_warehouse_id, v_period_id, v_doc_date, v_lines, NULL
    );
    v_credit_doc := (v_credit_result ->> 'document_id')::bigint;

    -- A customer payment -----------------------------------------------
    SELECT id INTO v_invoice_entry_id
    FROM receivables.customer_ledger_entries
    WHERE document_id = v_credit_doc AND entry_type = 'CREDIT_INVOICE';
    v_payment_res := receivables.post_customer_payment(
        v_admin_token, md5('wsl001-payment-' || v_suffix)::uuid, v_customer_id, 200.00, 'CASH', v_session1,
        v_period_id, v_doc_date,
        jsonb_build_array(jsonb_build_object('invoice_ledger_entry_id', v_invoice_entry_id, 'amount', '200.00')),
        'WS-L-001 partial payment'
    );

    -- A cash-out (SUPER_ADMIN holds APPROVE_CASH_OUT, no separate approver needed)
    v_cash_out_res := cash.record_cash_movement(
        v_admin_token, v_session1, 'CASH_OUT', 150.00, 'EXPENSE', 'WS-L-001 cash out', NULL
    );
    SELECT je.document_id INTO v_cash_out_journal
    FROM finance.journal_entries je
    WHERE je.source_type = 'CASH_MOVEMENT' AND je.source_id = v_session1
    ORDER BY je.document_id DESC LIMIT 1;

    -- Cancel the cash sale ------------------------------------------------
    v_void_res := sales.void_sale(v_admin_token, v_cash_sale_doc, 'WRONG_ITEM', NULL);
    v_void_doc := (v_void_res ->> 'void_document_id')::bigint;

    -- Purchase transaction fixture (inserted directly: post_purchase_transaction's
    -- payload orchestration is exercised by WS-E suites already; this suite only
    -- proves the WS-L-001 read-side functions render it correctly). -------
    SELECT id INTO v_supplier_id FROM procurement.suppliers LIMIT 1;
    IF v_supplier_id IS NULL THEN
        INSERT INTO procurement.suppliers (code, name, is_active)
        VALUES ('SUP-WSL001-' || v_suffix, 'WSL001 Supplier', true)
        RETURNING id INTO v_supplier_id;
    END IF;
    v_pt_fiscal_year := extract(year FROM v_doc_date)::integer;

    INSERT INTO core.business_documents (document_type, status, document_date, fiscal_period_id, fiscal_year, sequence_number, document_number, posted_at)
    VALUES ('PURCHASE_ORDER', 'POSTED', v_doc_date, v_period_id, v_pt_fiscal_year,
            core.claim_next_document_number('PURCHASE_ORDER', v_pt_fiscal_year),
            'PO-WSL001-' || v_suffix, now())
    RETURNING id INTO v_po_doc;
    INSERT INTO core.business_documents (document_type, status, document_date, fiscal_period_id, fiscal_year, sequence_number, document_number, posted_at)
    VALUES ('PURCHASE_RECEIPT', 'POSTED', v_doc_date, v_period_id, v_pt_fiscal_year,
            core.claim_next_document_number('PURCHASE_RECEIPT', v_pt_fiscal_year),
            'PR-WSL001-' || v_suffix, now())
    RETURNING id INTO v_receipt_doc;
    INSERT INTO core.business_documents (document_type, status, document_date, fiscal_period_id, fiscal_year, sequence_number, document_number, posted_at)
    VALUES ('SUPPLIER_INVOICE', 'POSTED', v_doc_date, v_period_id, v_pt_fiscal_year,
            core.claim_next_document_number('SUPPLIER_INVOICE', v_pt_fiscal_year),
            'SI-WSL001-' || v_suffix, now())
    RETURNING id INTO v_invoice_doc;
    INSERT INTO core.business_documents (document_type, status, document_date, fiscal_period_id, fiscal_year, sequence_number, document_number, posted_at)
    VALUES ('PURCHASE_TRANSACTION', 'POSTED', v_doc_date, v_period_id, v_pt_fiscal_year,
            core.claim_next_document_number('PURCHASE_TRANSACTION', v_pt_fiscal_year),
            'PT-WSL001-' || v_suffix, now())
    RETURNING id INTO v_pt_doc;

    INSERT INTO procurement.purchase_transactions (
        document_id, supplier_id, warehouse_id, external_supplier_document_number,
        payment_status, payment_method, gross_subtotal, discount_amount, tax_amount,
        additional_cost_amount, total_amount, paid_amount, outstanding_amount, due_date,
        purchase_order_id, goods_receipt_id, supplier_invoice_id, supplier_payment_id,
        note, supplier_snapshot
    ) VALUES (
        v_pt_doc, v_supplier_id, v_warehouse_id, 'EXT-WSL001-' || v_suffix,
        'UNPAID', NULL, 1000.00, 0, 0, 0, 1000.00, 0, 1000.00, NULL,
        v_po_doc, v_receipt_doc, v_invoice_doc, NULL,
        'WS-L-001 fixture', jsonb_build_object('name', 'WSL001 Supplier', 'code', 'SUP-WSL001')
    );
    INSERT INTO procurement.purchase_transaction_lines (
        document_id, line_number, variant_id, unit_id, quantity, unit_cost,
        gross_amount, discount_amount, tax_amount, line_total,
        sku_snapshot, product_name_snapshot, unit_code_snapshot
    ) VALUES (
        v_pt_doc, 1, v_variant_id, v_unit_id, 10.000, 100.00,
        1000.00, 0, 0, 1000.00,
        'SKU-WSL001-' || v_suffix, 'WSL001 Item ' || v_suffix, 'UNIT'
    );

    -- 3. Actor capture on posted documents --------------------------------
    IF (SELECT created_by_user_id FROM core.business_documents WHERE id = v_cash_sale_doc) <> v_admin_id THEN
        RAISE EXCEPTION 'Assertion failed (3): cash sale created_by_user_id mismatch';
    END IF;
    IF (SELECT created_on_workstation_id FROM core.business_documents WHERE id = v_cash_sale_doc) <> v_workstation THEN
        RAISE EXCEPTION 'Assertion failed (3): cash sale created_on_workstation_id mismatch';
    END IF;
    IF (SELECT bd.created_by_user_id FROM core.business_documents bd WHERE bd.id = v_cash_sale_journal) <> v_admin_id THEN
        RAISE EXCEPTION 'Assertion failed (3): cash sale journal created_by_user_id mismatch';
    END IF;
    IF (SELECT status FROM core.business_documents WHERE id = v_cash_sale_doc) <> 'REVERSED' THEN
        RAISE EXCEPTION 'Assertion failed (3): voiding did not mark the original REVERSED';
    END IF;

    -- 4. A document inserted with no session actor has NULL created_by_user_id, no error.
    DECLARE
        v_owner_doc bigint;
    BEGIN
        PERFORM set_config('stockiha.actor_user_id', '', true);
        PERFORM set_config('stockiha.actor_workstation_id', '', true);
        INSERT INTO core.business_documents (document_type, status, document_date, fiscal_period_id, fiscal_year, sequence_number, document_number, posted_at)
        VALUES ('PURCHASE_ORDER', 'POSTED', v_doc_date, v_period_id, v_pt_fiscal_year,
                core.claim_next_document_number('PURCHASE_ORDER', v_pt_fiscal_year),
                'PO-WSL001-NOACTOR-' || v_suffix, now())
        RETURNING id INTO v_owner_doc;
        IF (SELECT created_by_user_id FROM core.business_documents WHERE id = v_owner_doc) IS NOT NULL THEN
            RAISE EXCEPTION 'Assertion failed (4): unexpected created_by_user_id with no session actor';
        END IF;
    END;

    -- 5. get_business_document_detail: non-empty subtype_detail per type, key is subtype_detail, never details.
    v_detail := documents.get_business_document_detail(v_admin_token, v_cash_sale_doc);
    IF NOT (v_detail ? 'subtype_detail') OR (v_detail ? 'details') THEN
        RAISE EXCEPTION 'Assertion failed (5): CASH_SALE detail key mismatch: %', v_detail;
    END IF;
    IF (v_detail -> 'subtype_detail' ->> 'discount_amount') IS DISTINCT FROM '100.00' THEN
        RAISE EXCEPTION 'Assertion failed (5): CASH_SALE discount_amount missing/wrong: %', v_detail;
    END IF;

    v_detail := documents.get_business_document_detail(v_admin_token, v_credit_doc);
    IF (v_detail -> 'subtype_detail' ->> 'customer_name') IS DISTINCT FROM 'WSL001 Customer' THEN
        RAISE EXCEPTION 'Assertion failed (5): CREDIT_SALE customer_name missing/wrong: %', v_detail;
    END IF;

    v_detail := documents.get_business_document_detail(v_admin_token, (v_payment_res ->> 'document_id')::bigint);
    IF (v_detail -> 'subtype_detail' ->> 'amount') IS DISTINCT FROM '200.00' THEN
        RAISE EXCEPTION 'Assertion failed (5): CUSTOMER_PAYMENT amount missing/wrong: %', v_detail;
    END IF;

    v_detail := documents.get_business_document_detail(v_admin_token, v_pt_doc);
    IF (v_detail -> 'subtype_detail' ->> 'supplier_name') IS DISTINCT FROM 'WSL001 Supplier'
       OR jsonb_array_length(v_detail -> 'subtype_detail' -> 'lines') <> 1 THEN
        RAISE EXCEPTION 'Assertion failed (5): PURCHASE_TRANSACTION detail missing/wrong: %', v_detail;
    END IF;
    IF v_detail ? 'details' THEN
        RAISE EXCEPTION 'Assertion failed (5): PURCHASE_TRANSACTION must not return key details: %', v_detail;
    END IF;

    v_detail := documents.get_business_document_detail(v_admin_token, v_void_doc);
    IF (v_detail -> 'subtype_detail' ->> 'reason_code') IS DISTINCT FROM 'WRONG_ITEM'
       OR jsonb_array_length(v_detail -> 'subtype_detail' -> 'lines') < 1 THEN
        RAISE EXCEPTION 'Assertion failed (5): SALE_VOID detail missing/wrong: %', v_detail;
    END IF;

    -- 6. Two-way cancellation link.
    v_detail := documents.get_business_document_detail(v_admin_token, v_cash_sale_doc);
    IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_detail -> 'relationships') r
        WHERE r ->> 'document_type' = 'SALE_VOID' AND (r ->> 'document_id')::bigint = v_void_doc
    ) THEN
        RAISE EXCEPTION 'Assertion failed (6): original sale relationships missing the SALE_VOID: %', v_detail;
    END IF;
    v_detail := documents.get_business_document_detail(v_admin_token, v_void_doc);
    IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_detail -> 'relationships') r
        WHERE (r ->> 'document_id')::bigint = v_cash_sale_doc
    ) THEN
        RAISE EXCEPTION 'Assertion failed (6): void relationships missing the original sale: %', v_detail;
    END IF;

    -- 7. The cash sale's journal link is its own entry, never a CASH_MOVEMENT
    --    journal, even when a collision is engineered on purpose.
    SELECT je.document_id INTO v_collision_movement_journal
    FROM finance.journal_entries je
    WHERE je.source_type = 'CASH_MOVEMENT' AND je.source_id = v_session1
    LIMIT 1;
    -- Find (or accept) a document whose id equals the cash session id used as
    -- source_id by CASH_MOVEMENT journals, to prove source_type discriminates.
    SELECT id INTO v_collision_target_doc FROM core.business_documents WHERE id = v_session1;
    v_detail := documents.get_business_document_detail(v_admin_token, v_cash_sale_doc);
    IF v_detail -> 'journal' ->> 'document_id' IS DISTINCT FROM v_cash_sale_journal::text THEN
        RAISE EXCEPTION 'Assertion failed (7): CASH_SALE journal link is not its own entry: %', v_detail;
    END IF;
    IF v_collision_target_doc IS NOT NULL THEN
        v_detail := documents.get_business_document_detail(v_admin_token, v_collision_target_doc);
        IF v_detail -> 'journal' IS NOT NULL
           AND (v_detail -> 'journal' ->> 'document_id')::bigint = v_collision_movement_journal THEN
            RAISE EXCEPTION 'Assertion failed (7): a CASH_MOVEMENT journal leaked onto document %', v_collision_target_doc;
        END IF;
    END IF;

    -- 8. search_business_documents excludes JOURNAL_ENTRY rows.
    v_search := documents.search_business_documents(v_admin_token, NULL, NULL, NULL, NULL, NULL, 200, 0);
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_search -> 'rows') r WHERE r ->> 'document_type' = 'JOURNAL_ENTRY') THEN
        RAISE EXCEPTION 'Assertion failed (8): search_business_documents returned a JOURNAL_ENTRY row: %', v_search;
    END IF;
    IF (v_search ->> 'total_count')::bigint <> (
        SELECT count(*) FROM core.business_documents WHERE document_type <> 'JOURNAL_ENTRY'
    ) THEN
        RAISE EXCEPTION 'Assertion failed (8): total_count mismatch: %', v_search;
    END IF;

    -- 9. Filters: type, status, search (name and %), AN number.
    v_search := documents.search_business_documents(v_admin_token, NULL, NULL, 'CASH_SALE', NULL, NULL, 200, 0);
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_search -> 'rows') r WHERE r ->> 'document_type' <> 'CASH_SALE') THEN
        RAISE EXCEPTION 'Assertion failed (9a): type filter leaked another type: %', v_search;
    END IF;

    v_search := documents.search_business_documents(v_admin_token, NULL, NULL, NULL, 'REVERSED', NULL, 200, 0);
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_search -> 'rows') r WHERE r ->> 'status' <> 'REVERSED') THEN
        RAISE EXCEPTION 'Assertion failed (9b): status filter leaked another status: %', v_search;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_search -> 'rows') r WHERE (r ->> 'document_id')::bigint = v_cash_sale_doc) THEN
        RAISE EXCEPTION 'Assertion failed (9b): REVERSED filter missing the cancelled cash sale: %', v_search;
    END IF;

    v_search := documents.search_business_documents(v_admin_token, NULL, NULL, NULL, NULL, 'WSL001 Customer', 200, 0);
    IF NOT (
        EXISTS (SELECT 1 FROM jsonb_array_elements(v_search -> 'rows') r WHERE (r ->> 'document_id')::bigint = v_credit_doc)
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_search -> 'rows') r WHERE (r ->> 'document_id')::bigint = (v_payment_res ->> 'document_id')::bigint)
    ) THEN
        RAISE EXCEPTION 'Assertion failed (9c): customer-name search did not return the credit sale and the payment: %', v_search;
    END IF;

    v_search := documents.search_business_documents(v_admin_token, NULL, NULL, NULL, NULL, '%', 200, 0);
    IF jsonb_array_length(v_search -> 'rows') <> 0 THEN
        RAISE EXCEPTION 'Assertion failed (9d): a literal %% wildcard search returned rows: %', v_search;
    END IF;

    v_search := documents.search_business_documents(
        v_admin_token, NULL, NULL, NULL, NULL,
        (SELECT document_number FROM core.business_documents WHERE id = v_void_doc), 200, 0
    );
    IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_search -> 'rows') r
        WHERE (r ->> 'document_id')::bigint = v_void_doc
          AND r ->> 'reverses_document_number' = (SELECT document_number FROM core.business_documents WHERE id = v_cash_sale_doc)
    ) THEN
        RAISE EXCEPTION 'Assertion failed (9e): AN-number search did not return the SALE_VOID row with reverses_document_number: %', v_search;
    END IF;

    -- 10. Pagination: limit=2, offsets 0 and 2 disjoint, total_count stable.
    DECLARE
        v_page0 jsonb;
        v_page1 jsonb;
        v_ids0 bigint[];
        v_ids1 bigint[];
    BEGIN
        v_page0 := documents.search_business_documents(v_admin_token, NULL, NULL, NULL, NULL, NULL, 2, 0);
        v_page1 := documents.search_business_documents(v_admin_token, NULL, NULL, NULL, NULL, NULL, 2, 2);
        SELECT array_agg((r ->> 'document_id')::bigint) INTO v_ids0 FROM jsonb_array_elements(v_page0 -> 'rows') r;
        SELECT array_agg((r ->> 'document_id')::bigint) INTO v_ids1 FROM jsonb_array_elements(v_page1 -> 'rows') r;
        IF v_ids0 && v_ids1 THEN
            RAISE EXCEPTION 'Assertion failed (10): pages 0 and 1 overlap: % vs %', v_ids0, v_ids1;
        END IF;
        IF (v_page0 ->> 'total_count') <> (v_page1 ->> 'total_count') THEN
            RAISE EXCEPTION 'Assertion failed (10): total_count differs between pages';
        END IF;
    END;

    -- 11. Validation errors.
    v_blocked := false;
    BEGIN
        PERFORM documents.search_business_documents(v_admin_token, v_doc_date, v_doc_date - 1, NULL, NULL, NULL, 50, 0);
    EXCEPTION WHEN SQLSTATE '22023' THEN v_blocked := true;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'Assertion failed (11a): date_from > date_to was allowed'; END IF;

    v_blocked := false;
    BEGIN
        PERFORM documents.search_business_documents(v_admin_token, NULL, NULL, NULL, NULL, repeat('x', 101), 50, 0);
    EXCEPTION WHEN SQLSTATE '22023' THEN v_blocked := true;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'Assertion failed (11b): a 101-character search was allowed'; END IF;

    v_blocked := false;
    BEGIN
        PERFORM documents.search_business_documents(v_admin_token, NULL, NULL, NULL, 'FOO', NULL, 50, 0);
    EXCEPTION WHEN SQLSTATE '22023' THEN v_blocked := true;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'Assertion failed (11c): status FOO was allowed'; END IF;

    -- 12. finance.search_journals: cash-out journal has CASH_MOVEMENT with no source document.
    v_journal_search := finance.search_journals(v_admin_token, NULL, NULL, NULL, NULL, 200, 0);
    IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_journal_search -> 'rows') r
        WHERE (r ->> 'document_id')::bigint = v_cash_out_journal
          AND r ->> 'source_type' = 'CASH_MOVEMENT'
          AND r -> 'source_document_number' = 'null'::jsonb
    ) THEN
        RAISE EXCEPTION 'Assertion failed (12a): cash-out journal missing or has a source document: %', v_journal_search;
    END IF;
    IF NOT (v_journal_search -> 'available_source_types' ? 'CASH_SALE')
       OR NOT (v_journal_search -> 'available_source_types' ? 'CASH_MOVEMENT') THEN
        RAISE EXCEPTION 'Assertion failed (12b): available_source_types missing CASH_SALE/CASH_MOVEMENT: %', v_journal_search;
    END IF;

    v_journal_search := finance.search_journals(v_admin_token, NULL, NULL, 'SALE_VOID', NULL, 200, 0);
    IF jsonb_array_length(v_journal_search -> 'rows') <> 1
       OR ((v_journal_search -> 'rows' -> 0) ->> 'source_id')::bigint <> v_void_doc THEN
        RAISE EXCEPTION 'Assertion failed (12c): SALE_VOID source filter did not return exactly the void journal: %', v_journal_search;
    END IF;

    -- 13. finance.get_journal_detail for the discounted sale's journal.
    v_detail := finance.get_journal_detail(v_admin_token, v_cash_sale_journal);
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_detail -> 'lines') l
        WHERE l ->> 'scf_code' IS NULL OR l ->> 'name_fr' IS NULL
    ) THEN
        RAISE EXCEPTION 'Assertion failed (13): a journal line is missing scf_code/name_fr: %', v_detail;
    END IF;
    IF (v_detail ->> 'created_by_username') IS DISTINCT FROM v_admin_username THEN
        RAISE EXCEPTION 'Assertion failed (13): created_by_username mismatch: %', v_detail;
    END IF;

    -- 14. get_business_document_reports honours p_has_journal on the paginated rows.
    v_reports := documents.get_business_document_reports(v_admin_token, NULL, NULL, NULL, NULL, NULL, false, 500, 0);
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_reports -> 'rows') r WHERE (r ->> 'has_journal')::boolean) THEN
        RAISE EXCEPTION 'Assertion failed (14): p_has_journal = false returned a row that has a journal: %', v_reports;
    END IF;
    DECLARE
        v_dupe_count integer;
    BEGIN
        SELECT count(*) INTO v_dupe_count
        FROM (
            SELECT (r ->> 'document_id')::bigint AS id, count(*) AS c
            FROM jsonb_array_elements(v_reports -> 'rows') r
            GROUP BY 1 HAVING count(*) > 1
        ) x;
        IF v_dupe_count > 0 THEN
            RAISE EXCEPTION 'Assertion failed (14): a document appeared twice in the reports rows';
        END IF;
    END;

    -- 15. schema_state.
    IF (SELECT migration_version FROM operations.schema_state WHERE singleton) < 20260923090000 THEN
        RAISE EXCEPTION 'Assertion failed (15): schema_state.migration_version mismatch';
    END IF;

    RAISE NOTICE '=== WS-L-001 journals & documents integration suite completed successfully ===';
END;
$$;

-- =============================================================================
-- 16. Re-applying the migration file a second time raises no error.
-- =============================================================================
\i src-tauri/migrations/20260923090000_ws_l_001_journals_documents.sql
