-- S3-003 Integration Test Suite — Supplier Returns & Payables Settlement
\set ON_ERROR_STOP on

DO $$
DECLARE
    v_user_id bigint;
    v_username text := 's3003_admin_' || floor(random() * 1000000)::text;
    v_session_token text := 's3003_test_token_' || floor(random() * 1000000)::text;
    v_sku text := 'SKU-RET-' || floor(random() * 1000000)::text;
    v_supplier_id bigint;
    v_warehouse_id bigint;
    v_product_id bigint;
    v_variant_id bigint;
    v_fiscal_period_id bigint;
    v_po_json jsonb;
    v_po_id bigint;
    v_rcpt_json jsonb;
    v_rcpt_id bigint;
    v_inv_json jsonb;
    v_inv_id bigint;
    v_ret_json jsonb;
    v_ret_id bigint;
    v_pay_json jsonb;
    v_liability_id bigint;
    v_qty numeric(14,4);
    v_val numeric(14,2);
    v_out_amt numeric(14,2);
BEGIN
    RAISE NOTICE '=== Running S3-003 Supplier Returns & Payments Integration Suite ===';

    -- 1. Setup User & Session
    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES (v_username, 'S3003 Admin', 'hashed_pass')
    RETURNING id INTO v_user_id;

    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_user_id, r.id FROM iam.roles r WHERE r.code IN ('ADMIN', 'MANAGER');

    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_user_id, 'TEST_WKS_S3003', sha256(v_session_token::bytea), now() + interval '2 hours');

    -- Fiscal Period
    SELECT id INTO v_fiscal_period_id FROM finance.fiscal_periods WHERE status = 'OPEN' LIMIT 1;
    IF v_fiscal_period_id IS NULL THEN
        INSERT INTO finance.fiscal_periods (period_code, starts_on, ends_on, status)
        VALUES ('FP-2026-S3003', '2026-01-01', '2026-12-31', 'OPEN')
        RETURNING id INTO v_fiscal_period_id;
    END IF;

    -- Supplier & Warehouse
    INSERT INTO procurement.suppliers (code, name) VALUES ('SUP-S3003', 'S3003 Return Supplier') RETURNING id INTO v_supplier_id;
    INSERT INTO inventory.warehouses (code, name) VALUES ('WH-S3003', 'S3003 Warehouse') RETURNING id INTO v_warehouse_id;

    -- Product & Variant
    INSERT INTO catalog.products (name, is_active) VALUES ('Return Test Item', true) RETURNING id INTO v_product_id;
    INSERT INTO catalog.product_variants (product_id, base_unit_id, sku, sale_price, is_active)
    VALUES (v_product_id, 1, v_sku, 200.00, true)
    RETURNING id INTO v_variant_id;

    -- 2. Create & Confirm PO, then Receipt 10 units @ 100.00 DZD
    v_po_json := procurement.create_purchase_order_draft(
        v_session_token, v_supplier_id, v_warehouse_id, 'S3003 Test PO',
        jsonb_build_array(jsonb_build_object('variant_id', v_variant_id, 'unit_id', 1, 'quantity_ordered', 10.00, 'unit_cost', 100.00))
    );
    v_po_id := (v_po_json ->> 'document_id')::bigint;
    PERFORM procurement.confirm_purchase_order(v_session_token, v_po_id);

    v_rcpt_json := inventory.confirm_purchase_receipt(
        v_session_token, '11111111-1111-4111-8111-111111111111'::uuid, '\x010203'::bytea,
        v_po_id, v_fiscal_period_id, '2026-02-15'::date,
        jsonb_build_array(jsonb_build_object('po_line_id', (
            SELECT id FROM procurement.purchase_order_lines WHERE document_id = v_po_id LIMIT 1
        ), 'quantity_received', 10.00))
    );
    v_rcpt_id := (v_rcpt_json ->> 'document_id')::bigint;

    SELECT quantity_on_hand, total_value INTO v_qty, v_val FROM inventory.positions WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_id;
    IF v_qty <> 10.00 OR v_val <> 1000.00 THEN
        RAISE EXCEPTION 'Assertion failed: Initial receipt position wrong. Found qty=%, val=%', v_qty, v_val;
    END IF;

    -- 3. Create & Confirm Supplier Return of 2 units @ 100.00 DZD
    v_ret_json := procurement.create_supplier_return_draft(
        v_session_token, v_supplier_id, v_warehouse_id, v_po_id, 'DEFECTIVE_GOODS', 'Returning 2 damaged units',
        jsonb_build_array(jsonb_build_object('variant_id', v_variant_id, 'quantity', 2.00, 'unit_cost', 100.00))
    );
    v_ret_id := (v_ret_json ->> 'document_id')::bigint;

    v_ret_json := inventory.confirm_supplier_return(
        v_session_token, '22222222-2222-4222-8222-222222222222'::uuid, '\x040506'::bytea,
        v_ret_id, v_fiscal_period_id, '2026-02-16'::date
    );

    IF (v_ret_json ->> 'status') <> 'POSTED' THEN
        RAISE EXCEPTION 'Assertion failed: Supplier return status not POSTED';
    END IF;

    SELECT quantity_on_hand, total_value INTO v_qty, v_val FROM inventory.positions WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_id;
    IF v_qty <> 8.00 OR v_val <> 800.00 THEN
        RAISE EXCEPTION 'Assertion failed: Position after return wrong. Expected 8 qty, 800 val. Found qty=%, val=%', v_qty, v_val;
    END IF;
    RAISE NOTICE 'PASSED: Supplier return reduced stock to 8 units and re-valued inventory position to 800.00 DZD';

    -- 4. Create & Confirm Supplier Invoice, then Post Supplier Payment
    v_inv_json := procurement.create_supplier_invoice_draft(
        v_session_token, v_supplier_id, v_po_id, 'DZD', 1.000000, 'Invoice for PO',
        jsonb_build_array(jsonb_build_object(
            'line_number', 1,
            'po_line_id', (SELECT id FROM procurement.purchase_order_lines WHERE document_id = v_po_id LIMIT 1),
            'receipt_line_id', (SELECT id FROM procurement.purchase_receipt_lines WHERE document_id = v_rcpt_id LIMIT 1),
            'variant_id', v_variant_id,
            'quantity', 8.00,
            'unit_cost', 100.00
        ))
    );
    v_inv_id := (v_inv_json ->> 'document_id')::bigint;
    PERFORM procurement.confirm_supplier_invoice(v_session_token, '33333333-3333-4333-8333-333333333333'::uuid, '\x070809'::bytea, v_inv_id, v_fiscal_period_id, '2026-02-20'::date);

    SELECT id, outstanding_amount INTO v_liability_id, v_out_amt FROM procurement.supplier_liabilities WHERE invoice_document_id = v_inv_id;

    v_pay_json := procurement.post_supplier_payment(
        v_session_token, '44444444-4444-4444-8444-444444444444'::uuid, '\x0a0b0c'::bytea,
        v_supplier_id, v_liability_id, 400.00, 'CASH', v_fiscal_period_id, '2026-02-25'::date, 'Partial payment'
    );

    IF (v_pay_json ->> 'status') <> 'POSTED' THEN
        RAISE EXCEPTION 'Assertion failed: Supplier payment status not POSTED';
    END IF;

    SELECT outstanding_amount INTO v_out_amt FROM procurement.supplier_liabilities WHERE id = v_liability_id;
    IF v_out_amt <> 400.00 THEN
        RAISE EXCEPTION 'Assertion failed: Liability outstanding amount after 400 DZD payment wrong. Expected 400.00, found %', v_out_amt;
    END IF;
    RAISE NOTICE 'PASSED: Supplier payment of 400.00 DZD reduced outstanding liability to 400.00 DZD';

    RAISE NOTICE '=== ALL S3-003 INTEGRATION DB ASSERTIONS PASSED ===';
END;
$$;
