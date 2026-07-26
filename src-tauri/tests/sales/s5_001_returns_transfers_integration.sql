-- Slice 5 Integration Test Suite: POS Customer Returns, 1-Step Warehouse Transfers & Stock Write-Offs

\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
    v_token              text := 'test-s5001-token-' || gen_random_uuid();
    v_token_hash         bytea;
    v_user_id            bigint;
    v_period_id          bigint;
    v_w1_id              bigint;
    v_w2_id              bigint;
    v_variant_id         bigint;
    v_customer_id        bigint;
    v_session_id         bigint;
    v_result             jsonb;
    v_lines              jsonb;
    v_qty_w1             numeric;
    v_qty_w2             numeric;
    v_fiscal_year        integer;
BEGIN
    v_token_hash := sha256(v_token::bytea);
    v_fiscal_year := extract(year FROM CURRENT_DATE)::integer;

    -- Setup User, Open Fiscal Period & 2 Warehouses
    SELECT u.id INTO STRICT v_user_id FROM iam.users u WHERE u.is_active LIMIT 1;
    SELECT fp.id INTO STRICT v_period_id FROM finance.fiscal_periods fp WHERE fp.status = 'OPEN' LIMIT 1;

    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_user_id, r.id FROM iam.roles r WHERE r.code IN ('ADMIN', 'MANAGER', 'CASHIER')
    ON CONFLICT DO NOTHING;

    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_user_id, 'WS-S5001-TEST', v_token_hash, now() + interval '1 hour');

    -- Create 2 warehouses if needed
    SELECT id INTO v_w1_id FROM inventory.warehouses LIMIT 1;
    INSERT INTO inventory.warehouses (code, name) VALUES ('WH-S5-TARGET', 'Target Warehouse S5')
    ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id INTO v_w2_id;

    -- Get test variant
    SELECT id INTO STRICT v_variant_id FROM catalog.product_variants LIMIT 1;

    -- Seed stock in W1 (50 units)
    INSERT INTO inventory.positions (warehouse_id, variant_id, quantity_on_hand)
    VALUES (v_w1_id, v_variant_id, 50.00)
    ON CONFLICT (warehouse_id, variant_id) DO UPDATE SET quantity_on_hand = 50.00;

    -- ── Test 1: Customer POS Return with Cash Refund ─────────────────────────
    v_lines := jsonb_build_array(jsonb_build_object('variant_id', v_variant_id, 'quantity', 5.0, 'unit_price', 200.00));
    v_result := sales.confirm_customer_return(
        v_token, gen_random_uuid(), NULL, NULL, v_w1_id, 'CASH', v_period_id, CURRENT_DATE, v_lines, 'Instant POS Return'
    );
    ASSERT v_result->>'document_number' LIKE 'CR-%', 'Document number not CR-formatted';
    ASSERT (v_result->>'total_amount')::numeric = 1000.00, 'Total amount mismatch';

    -- Check stock in W1 restocked from 50 to 55
    SELECT quantity_on_hand INTO v_qty_w1 FROM inventory.positions WHERE warehouse_id = v_w1_id AND variant_id = v_variant_id;
    ASSERT v_qty_w1 = 55.00, format('Expected W1 stock 55, got %s', v_qty_w1);
    RAISE NOTICE 'Test 1 PASS: Customer POS return restocked stock to % (doc: %)', v_qty_w1, v_result->>'document_number';

    -- ── Test 2: 1-Step Warehouse Stock Transfer (15 units W1 -> W2) ──────────
    v_lines := jsonb_build_array(jsonb_build_object('variant_id', v_variant_id, 'quantity', 15.0));
    v_result := inventory.confirm_warehouse_transfer(
        v_token, gen_random_uuid(), v_w1_id, v_w2_id, v_period_id, CURRENT_DATE, v_lines, 'Stock relocation'
    );
    ASSERT v_result->>'document_number' LIKE 'TR-%', 'Document number not TR-formatted';

    -- Verify stock: W1 = 40 (55 - 15), W2 = 15
    SELECT quantity_on_hand INTO v_qty_w1 FROM inventory.positions WHERE warehouse_id = v_w1_id AND variant_id = v_variant_id;
    SELECT quantity_on_hand INTO v_qty_w2 FROM inventory.positions WHERE warehouse_id = v_w2_id AND variant_id = v_variant_id;
    ASSERT v_qty_w1 = 40.00, format('Expected W1 stock 40, got %s', v_qty_w1);
    ASSERT v_qty_w2 = 15.00, format('Expected W2 stock 15, got %s', v_qty_w2);
    RAISE NOTICE 'Test 2 PASS: 1-Step transfer moved stock W1=% W2=% (doc: %)', v_qty_w1, v_qty_w2, v_result->>'document_number';

    -- ── Test 3: Stock Write-Off (2 damaged units from W2) ───────────────────
    v_lines := jsonb_build_array(jsonb_build_object('variant_id', v_variant_id, 'quantity', 2.0, 'unit_cost', 150.00));
    v_result := inventory.confirm_stock_write_off(
        v_token, gen_random_uuid(), v_w2_id, 'DAMAGED', v_period_id, CURRENT_DATE, v_lines, 'Damaged during transit'
    );
    ASSERT v_result->>'document_number' LIKE 'WO-%', 'Document number not WO-formatted';
    ASSERT (v_result->>'total_cost')::numeric = 300.00, 'Total cost mismatch';

    -- Verify stock in W2 reduced from 15 to 13
    SELECT quantity_on_hand INTO v_qty_w2 FROM inventory.positions WHERE warehouse_id = v_w2_id AND variant_id = v_variant_id;
    ASSERT v_qty_w2 = 13.00, format('Expected W2 stock 13, got %s', v_qty_w2);
    RAISE NOTICE 'Test 3 PASS: Stock write-off reduced W2 stock to % (doc: %)', v_qty_w2, v_result->>'document_number';

    RAISE NOTICE '=== ALL SLICE 5 INTEGRATION ASSERTIONS PASSED ===';
END;
$$;

ROLLBACK;
