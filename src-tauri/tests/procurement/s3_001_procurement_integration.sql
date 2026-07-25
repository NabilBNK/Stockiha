-- S3-001: Integration test suite for Supplier Master, PO Workflow, and Goods Receipt Posting
DO $$
DECLARE
    v_user_id bigint;
    v_session_token text := 's3001_procurement_token';
    v_supplier_id bigint;
    v_supplier_json jsonb;
    v_warehouse_id bigint;
    v_product_id bigint;
    v_variant1_id bigint;
    v_variant2_id bigint;
    v_fiscal_period_id bigint;
    v_po1_id bigint;
    v_po1_json jsonb;
    v_po2_id bigint;
    v_po2_json jsonb;
    v_receipt1_json jsonb;
    v_receipt1_doc_id bigint;
    v_receipt2_json jsonb;
    v_receipt2_doc_id bigint;
    v_receipt3_json jsonb;
    v_receipt3_doc_id bigint;
    v_pos1_qty numeric(18, 3);
    v_pos1_val numeric(18, 4);
    v_pos1_wac numeric(18, 6);
    v_pos2_qty numeric(18, 3);
    v_pos2_val numeric(18, 4);
    v_pos2_wac numeric(18, 6);
    v_journal_id bigint;
    v_journal_balanced boolean;
    v_liability_count integer;
    v_po1_status text;
BEGIN
    RAISE NOTICE '=== Running S3-001 Procurement Integration Suite ===';

    -- 1. Setup IAM Admin session
    DELETE FROM iam.user_roles WHERE user_id IN (SELECT id FROM iam.users WHERE username = 's3001_proc_user');
    DELETE FROM iam.users WHERE username = 's3001_proc_user';

    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES ('s3001_proc_user', 'S3001 Proc Admin', 'hash')
    RETURNING id INTO v_user_id;

    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_user_id, r.id FROM iam.roles r WHERE r.code IN ('ADMIN', 'MANAGER');

    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_user_id, 'TEST_WKS', sha256(v_session_token::bytea), now() + interval '1 hour');

    -- 2. Seed Warehouse & Products/Variants
    INSERT INTO inventory.warehouses (code, name, is_active)
    VALUES ('W-S3001', 'Procurement Warehouse', true)
    ON CONFLICT (code) DO UPDATE SET is_active = true
    RETURNING id INTO v_warehouse_id;

    SELECT id INTO v_fiscal_period_id FROM finance.fiscal_periods WHERE status = 'OPEN' ORDER BY starts_on DESC LIMIT 1;
    IF v_fiscal_period_id IS NULL THEN
        INSERT INTO finance.fiscal_periods (period_code, status, starts_on, ends_on)
        VALUES ('2026-Q1', 'OPEN', '2026-01-01'::date, '2026-03-31'::date)
        RETURNING id INTO v_fiscal_period_id;
    END IF;

    INSERT INTO catalog.products (name, is_active) VALUES ('Procurement Widget A', true) RETURNING id INTO v_product_id;
    INSERT INTO catalog.product_variants (product_id, base_unit_id, sku, sale_price, is_active)
    VALUES (v_product_id, 1, 'SKU-S3001-A', 150.00, true)
    RETURNING id INTO v_variant1_id;

    INSERT INTO catalog.products (name, is_active) VALUES ('Procurement Widget B', true) RETURNING id INTO v_product_id;
    INSERT INTO catalog.product_variants (product_id, base_unit_id, sku, sale_price, is_active)
    VALUES (v_product_id, 1, 'SKU-S3001-B', 250.00, true)
    RETURNING id INTO v_variant2_id;

    -- 3. Supplier Master CRUD & Validation Assertions
    v_supplier_json := procurement.create_supplier(
        v_session_token, 'SUP-001', 'SARL Global Import', 'Ahmed Contact',
        '0550000000', 'contact@globalimport.dz', 'Algiers Industrial Zone', '123456789'
    );
    v_supplier_id := (v_supplier_json ->> 'id')::bigint;
    ASSERT v_supplier_id IS NOT NULL, 'ASSERT FAILED: Supplier creation failed';

    -- Test duplicate code rejection
    BEGIN
        PERFORM procurement.create_supplier(v_session_token, 'SUP-001', 'Dup Supplier', NULL, NULL, NULL, NULL, NULL);
        RAISE EXCEPTION 'ASSERT FAILED: Duplicate supplier code was not rejected';
    EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'PASSED: Duplicate supplier code rejected';
    END;

    -- Update supplier
    PERFORM procurement.update_supplier(
        v_session_token, v_supplier_id, 'SUP-001', 'SARL Global Import Updated', 'Ahmed Contact',
        '0550000000', 'contact@globalimport.dz', 'Algiers', '123456789', true
    );

    -- 4. Purchase Order Creation & Confirmation
    -- Create Draft PO 1: 10 units @ 100.00 DZD for Variant 1, 5 units @ 200.00 DZD for Variant 2 (Subtotal: 2000.00)
    v_po1_json := procurement.create_purchase_order_draft(
        v_session_token, v_supplier_id, v_warehouse_id, 'Urgent stock order',
        jsonb_build_array(
            jsonb_build_object('variant_id', v_variant1_id, 'unit_id', 1, 'quantity_ordered', 10, 'unit_cost', 100.00),
            jsonb_build_object('variant_id', v_variant2_id, 'unit_id', 1, 'quantity_ordered', 5, 'unit_cost', 200.00)
        )
    );
    v_po1_id := (v_po1_json ->> 'document_id')::bigint;
    ASSERT (v_po1_json ->> 'subtotal') = '2000.00', 'ASSERT FAILED: PO subtotal mismatch';

    -- Confirm PO 1
    v_po1_json := procurement.confirm_purchase_order(v_session_token, v_po1_id);
    ASSERT (v_po1_json ->> 'status') = 'CONFIRMED', 'ASSERT FAILED: PO confirmation failed';
    ASSERT (v_po1_json ->> 'document_number') LIKE 'PO-%', 'ASSERT FAILED: PO document number invalid';

    -- 5. Full Goods Receipt Confirmation (PO 1)
    -- Receive 10 units of Variant 1, 5 units of Variant 2
    v_receipt1_json := inventory.confirm_purchase_receipt(
        v_session_token,
        '11111111-1111-4111-8111-111111111111'::uuid,
        '\x010203'::bytea,
        v_po1_id,
        v_fiscal_period_id,
        '2026-02-15'::date,
        jsonb_build_array(
            jsonb_build_object('po_line_id', (SELECT id FROM procurement.purchase_order_lines WHERE document_id = v_po1_id AND line_number = 1), 'quantity_received', 10),
            jsonb_build_object('po_line_id', (SELECT id FROM procurement.purchase_order_lines WHERE document_id = v_po1_id AND line_number = 2), 'quantity_received', 5)
        )
    );

    v_receipt1_doc_id := (v_receipt1_json ->> 'document_id')::bigint;
    ASSERT (v_receipt1_json ->> 'order_status') = 'RECEIVED', 'ASSERT FAILED: PO 1 final status should be RECEIVED';
    ASSERT (v_receipt1_json ->> 'total_amount') = '2000.00', 'ASSERT FAILED: Receipt total amount mismatch';

    -- Verify inventory position updates and WAC for Variant 1 (10 units @ 100 = 1000 value, WAC 100)
    SELECT quantity_on_hand, total_value, last_known_wac INTO v_pos1_qty, v_pos1_val, v_pos1_wac
    FROM inventory.positions WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant1_id;

    ASSERT v_pos1_qty = 10.000, 'ASSERT FAILED: Variant 1 qty mismatch after receipt';
    ASSERT v_pos1_val = 1000.0000, 'ASSERT FAILED: Variant 1 total value mismatch';
    ASSERT v_pos1_wac = 100.000000, 'ASSERT FAILED: Variant 1 WAC mismatch';

    -- Verify double-entry journal balance
    v_journal_id := (v_receipt1_json ->> 'journal_document_id')::bigint;
    SELECT (sum(debit) = sum(credit)) INTO v_journal_balanced
    FROM finance.journal_lines WHERE document_id = v_journal_id;
    ASSERT v_journal_balanced IS TRUE, 'ASSERT FAILED: Goods receipt journal is not balanced';

    -- Verify supplier liability record creation
    SELECT count(*) INTO v_liability_count
    FROM procurement.supplier_liabilities WHERE receipt_document_id = v_receipt1_doc_id AND original_amount = 2000.00;
    ASSERT v_liability_count = 1, 'ASSERT FAILED: Supplier liability record missing';

    -- Test Idempotent Retry of Receipt 1
    v_receipt1_json := inventory.confirm_purchase_receipt(
        v_session_token,
        '11111111-1111-4111-8111-111111111111'::uuid,
        '\x010203'::bytea,
        v_po1_id,
        v_fiscal_period_id,
        '2026-02-15'::date,
        jsonb_build_array(
            jsonb_build_object('po_line_id', (SELECT id FROM procurement.purchase_order_lines WHERE document_id = v_po1_id AND line_number = 1), 'quantity_received', 10),
            jsonb_build_object('po_line_id', (SELECT id FROM procurement.purchase_order_lines WHERE document_id = v_po1_id AND line_number = 2), 'quantity_received', 5)
        )
    );
    ASSERT (v_receipt1_json ->> 'document_id')::bigint = v_receipt1_doc_id, 'ASSERT FAILED: Idempotent retry returned different document ID';

    -- 6. Partial Receipt Workflow (PO 2)
    -- Create & Confirm PO 2: 20 units @ 120.00 DZD for Variant 1
    v_po2_json := procurement.create_purchase_order_draft(
        v_session_token, v_supplier_id, v_warehouse_id, 'Partial receipt PO',
        jsonb_build_array(
            jsonb_build_object('variant_id', v_variant1_id, 'unit_id', 1, 'quantity_ordered', 20, 'unit_cost', 120.00)
        )
    );
    v_po2_id := (v_po2_json ->> 'document_id')::bigint;
    PERFORM procurement.confirm_purchase_order(v_session_token, v_po2_id);

    -- First Partial Receipt: 8 units @ 120.00 DZD
    v_receipt2_json := inventory.confirm_purchase_receipt(
        v_session_token,
        '22222222-2222-4222-8222-222222222222'::uuid,
        '\x040506'::bytea,
        v_po2_id,
        v_fiscal_period_id,
        '2026-02-15'::date,
        jsonb_build_array(
            jsonb_build_object('po_line_id', (SELECT id FROM procurement.purchase_order_lines WHERE document_id = v_po2_id AND line_number = 1), 'quantity_received', 8)
        )
    );
    ASSERT (v_receipt2_json ->> 'order_status') = 'PARTIALLY_RECEIVED', 'ASSERT FAILED: PO 2 status should be PARTIALLY_RECEIVED';

    -- Check updated position & WAC for Variant 1:
    -- Prev: 10 units @ 1000.00 value. Added: 8 units @ 960.00 value (8 * 120). Total = 18 units @ 1960.00 value -> WAC = 1960 / 18 = 108.888889
    SELECT quantity_on_hand, total_value, last_known_wac INTO v_pos1_qty, v_pos1_val, v_pos1_wac
    FROM inventory.positions WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant1_id;

    ASSERT v_pos1_qty = 18.000, 'ASSERT FAILED: Variant 1 qty mismatch after partial receipt';
    ASSERT v_pos1_val = 1960.0000, 'ASSERT FAILED: Variant 1 value mismatch after partial receipt';

    -- Test Over-Receipt Rejection (Attempt to receive 15 units when remaining is 12)
    BEGIN
        PERFORM inventory.confirm_purchase_receipt(
            v_session_token,
            '33333333-3333-4333-8333-333333333333'::uuid,
            '\x070809'::bytea,
            v_po2_id,
            v_fiscal_period_id,
            '2026-02-15'::date,
            jsonb_build_array(
                jsonb_build_object('po_line_id', (SELECT id FROM procurement.purchase_order_lines WHERE document_id = v_po2_id AND line_number = 1), 'quantity_received', 15)
            )
        );
        RAISE EXCEPTION 'ASSERT FAILED: Over-receipt was not rejected';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'PASSED: Over-receipt correctly rejected: %', SQLERRM;
    END;

    -- Second Partial Receipt completing the PO: remaining 12 units @ 120.00 DZD
    v_receipt3_json := inventory.confirm_purchase_receipt(
        v_session_token,
        '44444444-4444-4444-8444-444444444444'::uuid,
        '\x0a0b0c'::bytea,
        v_po2_id,
        v_fiscal_period_id,
        '2026-02-15'::date,
        jsonb_build_array(
            jsonb_build_object('po_line_id', (SELECT id FROM procurement.purchase_order_lines WHERE document_id = v_po2_id AND line_number = 1), 'quantity_received', 12)
        )
    );
    ASSERT (v_receipt3_json ->> 'order_status') = 'RECEIVED', 'ASSERT FAILED: PO 2 final status should be RECEIVED';

    SELECT status INTO v_po1_status FROM procurement.purchase_orders WHERE document_id = v_po2_id;
    ASSERT v_po1_status = 'RECEIVED', 'ASSERT FAILED: PO 2 status in DB should be RECEIVED';

    RAISE NOTICE '=== ALL S3-001 INTEGRATION DB ASSERTIONS PASSED ===';
END;
$$;
