-- S3-002 Landed Cost Allocation & Supplier Invoicing Integration Test Suite
-- Database target: stockiha_test

\set ON_ERROR_STOP on

DO $$
DECLARE
    v_user_id bigint;
    v_username text := 's3002_admin_' || floor(random() * 1000000)::text;
    v_session_token text := 's3002_test_token_' || floor(random() * 1000000)::text;
    v_sku text := 'SKU-LC-' || floor(random() * 1000000)::text;
    v_supplier_id bigint;
    v_warehouse_id bigint;
    v_product_id bigint;
    v_variant_id bigint;
    v_fiscal_period_id bigint;
    v_po_id bigint;
    v_receipt_id bigint;
    v_invoice_id bigint;
    v_po_json jsonb;
    v_receipt_json jsonb;
    v_invoice_json jsonb;
    v_landed_cost_json jsonb;
    v_pos_session_id bigint;
    v_sale_json jsonb;
    v_req_id uuid;
    v_qty numeric(14,3);
    v_val numeric(14,2);
    v_wac numeric(14,6);
    v_dr_sum numeric(14,2);
    v_cr_sum numeric(14,2);
BEGIN
    RAISE NOTICE '=== Running S3-002 Landed Cost & Supplier Invoicing Integration Suite ===';

    -- 1. Setup User & Session
    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES (v_username, 'S3002 Admin', 'hashed_pass')
    RETURNING id INTO v_user_id;

    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_user_id, r.id FROM iam.roles r WHERE r.code IN ('ADMIN', 'MANAGER');

    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_user_id, 'TEST_WKS', sha256(v_session_token::bytea), now() + interval '2 hours');

    -- Fixtures
    SELECT id INTO v_supplier_id FROM procurement.suppliers WHERE code = 'SUP-LC';
    IF v_supplier_id IS NULL THEN
        INSERT INTO procurement.suppliers (code, name, is_active)
        VALUES ('SUP-LC', 'Landed Cost Supplier', true)
        RETURNING id INTO v_supplier_id;
    END IF;

    SELECT id INTO v_warehouse_id FROM inventory.warehouses WHERE code = 'W-LC';
    IF v_warehouse_id IS NULL THEN
        INSERT INTO inventory.warehouses (code, name, is_active)
        VALUES ('W-LC', 'Warehouse LC', true)
        RETURNING id INTO v_warehouse_id;
    END IF;

    SELECT id INTO v_fiscal_period_id FROM finance.fiscal_periods WHERE status = 'OPEN' ORDER BY starts_on DESC LIMIT 1;
    IF v_fiscal_period_id IS NULL THEN
        INSERT INTO finance.fiscal_periods (period_code, starts_on, ends_on, status)
        VALUES ('2026-Q1', '2026-01-01', '2026-03-31', 'OPEN')
        RETURNING id INTO v_fiscal_period_id;
    END IF;

    -- Product & Variant
    INSERT INTO catalog.products (name, is_active) VALUES ('Landed Cost Item', true) RETURNING id INTO v_product_id;
    INSERT INTO catalog.product_variants (product_id, base_unit_id, sku, sale_price, is_active)
    VALUES (v_product_id, 1, v_sku, 200.00, true)
    RETURNING id INTO v_variant_id;

    -- 2. Create & Confirm Purchase Order: 10 units @ 100.00 DZD
    v_po_json := procurement.create_purchase_order_draft(
        v_session_token, v_supplier_id, v_warehouse_id, 'PO for Landed Cost Test',
        jsonb_build_array(
            jsonb_build_object('variant_id', v_variant_id, 'unit_id', 1, 'quantity_ordered', 10, 'unit_cost', 100.00)
        )
    );
    v_po_id := (v_po_json ->> 'document_id')::bigint;
    PERFORM procurement.confirm_purchase_order(v_session_token, v_po_id);

    -- 3. Receive Stock (10 units @ 100.00 DZD = 1,000.00 DZD)
    v_req_id := '66666666-6666-4666-8666-666666666666'::uuid;
    v_receipt_json := inventory.confirm_purchase_receipt(
        v_session_token, v_req_id, '\x01020304'::bytea, v_po_id, v_fiscal_period_id, '2026-02-15'::date,
        jsonb_build_array(
            jsonb_build_object('po_line_id', (SELECT id FROM procurement.purchase_order_lines WHERE document_id = v_po_id AND line_number = 1), 'quantity_received', 10)
        )
    );
    v_receipt_id := (v_receipt_json ->> 'document_id')::bigint;

    SELECT quantity_on_hand, total_value, last_known_wac INTO v_qty, v_val, v_wac
    FROM inventory.positions WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_id;
    IF v_qty <> 10.000 OR v_val <> 1000.00 OR v_wac <> 100.000000 THEN
        RAISE EXCEPTION 'Assertion failed: Initial receipt positions wrong. Qty: %, Val: %, WAC: %', v_qty, v_val, v_wac;
    END IF;

    -- 4. Simulate selling 4 units (Leaving 6 units in stock @ 600 DZD total value)
    UPDATE inventory.positions
    SET quantity_on_hand = 6.000, total_value = 600.00
    WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_id;

    SELECT quantity_on_hand, total_value INTO v_qty, v_val
    FROM inventory.positions WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_id;
    IF v_qty <> 6.000 OR v_val <> 600.00 THEN
        RAISE EXCEPTION 'Assertion failed: Position after sale wrong. Qty: %, Val: %', v_qty, v_val;
    END IF;

    -- 5. Allocate Late Landed Cost (Freight Invoice: 200.00 DZD)
    -- Total units: 10. Remaining units: 6 (60%). Sold units: 4 (40%).
    -- Remaining share: 60% of 200 = 120.00 DZD.
    -- Sold share: 40% of 200 = 80.00 DZD.
    v_landed_cost_json := inventory.allocate_landed_cost(
        v_session_token, '88888888-8888-4888-8888-888888888888'::uuid, '\x08090a'::bytea,
        v_receipt_id, 200.00, 'BY_QTY', v_fiscal_period_id, '2026-02-18'::date, 'Freight allocation'
    );

    SELECT quantity_on_hand, total_value, last_known_wac INTO v_qty, v_val, v_wac
    FROM inventory.positions WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_id;
    IF v_qty <> 6.000 OR v_val <> 720.00 OR v_wac <> 120.000000 THEN
        RAISE EXCEPTION 'Assertion failed: Position after landed cost wrong. Qty: %, Val: %, WAC: %', v_qty, v_val, v_wac;
    END IF;
    RAISE NOTICE 'PASSED: Landed cost split correctly: Remaining stock total value updated to 720.00 DZD, WAC updated to 120.000000';

    -- Verify Double-Entry Journal for Landed Cost
    SELECT sum(debit), sum(credit) INTO v_dr_sum, v_cr_sum
    FROM finance.journal_lines
    WHERE document_id = (v_landed_cost_json ->> 'journal_document_id')::bigint;

    IF v_dr_sum <> 200.00 OR v_cr_sum <> 200.00 THEN
        RAISE EXCEPTION 'Assertion failed: Landed cost journal imbalanced. Debits: %, Credits: %', v_dr_sum, v_cr_sum;
    END IF;
    RAISE NOTICE 'PASSED: Landed cost double-entry journal balanced (200.00 DZD = 200.00 DZD)';

    -- 6. Create Supplier Invoice Draft & Confirm (3-Way Match)
    v_invoice_json := procurement.create_supplier_invoice_draft(
        v_session_token, v_supplier_id, v_po_id, 'DZD', 1.000000, 'Official invoice',
        jsonb_build_array(
            jsonb_build_object(
                'line_number', 1, 'po_line_id', (SELECT id FROM procurement.purchase_order_lines WHERE document_id = v_po_id AND line_number = 1),
                'receipt_line_id', (SELECT id FROM procurement.purchase_receipt_lines WHERE document_id = v_receipt_id AND line_number = 1),
                'variant_id', v_variant_id, 'quantity', 10, 'unit_cost', 100.00
            )
        )
    );
    v_invoice_id := (v_invoice_json ->> 'document_id')::bigint;

    v_invoice_json := procurement.confirm_supplier_invoice(
        v_session_token, '99999999-9999-4999-8999-999999999999'::uuid, '\x0b0c0d'::bytea,
        v_invoice_id, v_fiscal_period_id, '2026-02-20'::date
    );

    IF (v_invoice_json ->> 'status') <> 'POSTED' THEN
        RAISE EXCEPTION 'Assertion failed: Invoice status not POSTED';
    END IF;

    -- Verify Supplier Liability Created
    IF NOT EXISTS (
        SELECT 1 FROM procurement.supplier_liabilities
        WHERE supplier_id = v_supplier_id AND invoice_document_id = v_invoice_id AND outstanding_amount = 1000.00
    ) THEN
        DECLARE
            v_act_sub record;
        BEGIN
            SELECT * INTO v_act_sub FROM procurement.supplier_liabilities WHERE invoice_document_id = v_invoice_id;
            RAISE EXCEPTION 'Assertion failed: Supplier liability record missing or wrong amount. Found: sup_id=%, inv_id=%, out_amt=%', v_act_sub.supplier_id, v_act_sub.invoice_document_id, v_act_sub.outstanding_amount;
        END;
    END IF;
    RAISE NOTICE 'PASSED: Supplier liability record created for 1,000.00 DZD';

    RAISE NOTICE '=== ALL S3-002 INTEGRATION DB ASSERTIONS PASSED ===';
END;
$$;
