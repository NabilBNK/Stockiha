-- S2-003 Integration Tests: Zero-quantity safeguards and rounding residual handlers
--
-- Prerequisites:
-- - Database schema from migrations up through S2-003
-- - A product variant, warehouse, and fiscal period in OPEN status

SET client_min_messages = notice;

DO $$
DECLARE
    v_admin_user_id bigint;
    v_manager_user_id bigint;
    v_session_token text := 's2_003_test_session_token';
    v_product_id bigint;
    v_variant_id bigint;
    v_warehouse_id bigint;
    v_fiscal_period_id bigint;
    v_cash_session_id bigint;
    v_adjustment_result jsonb;
    v_sale_doc_id bigint;
    v_res_count integer;
    v_res_val numeric(18, 4);
    v_res_move_type text;
BEGIN
    -- 1. Setup Fixtures
    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES ('s2_003_admin', 'Admin User', 'hashed_password')
    RETURNING id INTO v_admin_user_id;

    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES ('s2_003_manager', 'Manager User', 'hashed_password')
    RETURNING id INTO v_manager_user_id;

    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_manager_user_id, r.id FROM iam.roles r WHERE r.code IN ('ADMIN', 'MANAGER');

    INSERT INTO iam.role_permissions (role_id, permission_id)
    SELECT r.id, p.id FROM iam.roles r CROSS JOIN iam.permissions p WHERE r.code IN ('ADMIN', 'MANAGER')
    ON CONFLICT DO NOTHING;

    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_manager_user_id, 'TEST_WKS', sha256(v_session_token::bytea), now() + interval '1 hour');

    INSERT INTO catalog.products (name, is_active) VALUES ('S2-003 Test Product', true) RETURNING id INTO v_product_id;
    INSERT INTO catalog.product_variants (product_id, base_unit_id, sku, sale_price, is_active)
    VALUES (v_product_id, 1, 'SKU-S2003', 100.00, true)
    RETURNING id INTO v_variant_id;

    INSERT INTO inventory.warehouses (code, name, is_active) VALUES ('W2003', 'S2-003 Warehouse', true)
    RETURNING id INTO v_warehouse_id;

    INSERT INTO finance.fiscal_periods (period_code, status, starts_on, ends_on)
    VALUES ('2026-Q1', 'OPEN', '2026-01-01'::date, '2026-03-31'::date)
    RETURNING id INTO v_fiscal_period_id;

    INSERT INTO sales.cash_sessions (warehouse_id, workstation_id, opened_by_user_id, opening_float, status)
    VALUES (v_warehouse_id, 'TEST_WKS', v_manager_user_id, 1000.00, 'OPEN')
    RETURNING id INTO v_cash_session_id;

    ----------------------------------------------------------------------------
    -- Test 1: Adjustment reaching zero quantity clears sub-centime residual
    ----------------------------------------------------------------------------
    -- Seed position with 1.000 unit, total_value = 10.0035 DZD, WAC = 10.000000
    INSERT INTO inventory.positions (warehouse_id, variant_id, quantity_on_hand, total_value, last_known_wac)
    VALUES (v_warehouse_id, v_variant_id, 1.000, 10.0035, 10.000000);

    -- Confirm stock adjustment reducing quantity by -1.000
    v_adjustment_result := inventory.confirm_stock_adjustment(
        v_session_token,
        '11111111-1111-1111-1111-111111111111'::uuid,
        '\x010203'::bytea,
        v_warehouse_id,
        v_variant_id,
        1, -- base unit
        -1.000,
        'DAMAGE',
        NULL,
        v_fiscal_period_id,
        '2026-01-15'::date
    );

    -- Verify position quantity = 0 and total_value = 0
    ASSERT (SELECT quantity_on_hand FROM inventory.positions WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_id) = 0,
        'Test 1 FAILED: position quantity_on_hand != 0';
    ASSERT (SELECT total_value FROM inventory.positions WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_id) = 0,
        'Test 1 FAILED: position total_value != 0';
    ASSERT (SELECT last_known_wac FROM inventory.positions WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_id) = 10.000000,
        'Test 1 FAILED: last_known_wac was not preserved at zero stock';

    -- Verify residual audit record was created
    SELECT count(*), max(detected_residual_value) INTO v_res_count, v_res_val
    FROM inventory.residual_clearances
    WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_id;

    ASSERT v_res_count = 1, 'Test 1 FAILED: residual clearance audit row was not created';
    ASSERT v_res_val = 0.0035, 'Test 1 FAILED: detected_residual_value != 0.0035';

    -- Verify clearing movement exists
    SELECT movement_type INTO v_res_move_type
    FROM inventory.movements
    WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_id AND movement_type = 'RESIDUAL_CLEARANCE';

    ASSERT v_res_move_type = 'RESIDUAL_CLEARANCE', 'Test 1 FAILED: RESIDUAL_CLEARANCE movement missing';

    RAISE NOTICE 'Test 1 PASSED: Adjustment zero-qty sub-centime residual clearance and audit logging verified';

    ----------------------------------------------------------------------------
    -- Test 2: Positive adjustment from zero stock with preserved WAC succeeds
    ----------------------------------------------------------------------------
    v_adjustment_result := inventory.confirm_stock_adjustment(
        v_session_token,
        '22222222-2222-2222-2222-222222222222'::uuid,
        '\x010203'::bytea,
        v_warehouse_id,
        v_variant_id,
        1,
        2.000,
        'FOUND_STOCK',
        NULL,
        v_fiscal_period_id,
        '2026-01-16'::date
    );

    ASSERT (SELECT quantity_on_hand FROM inventory.positions WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_id) = 2.000,
        'Test 2 FAILED: position quantity_on_hand != 2.000';

    RAISE NOTICE 'Test 2 PASSED: Positive adjustment from zero with preserved WAC succeeded';

    ----------------------------------------------------------------------------
    -- Test 3: Positive adjustment from zero stock WITHOUT usable WAC throws P2002
    ----------------------------------------------------------------------------
    UPDATE inventory.positions SET quantity_on_hand = 0, total_value = 0, last_known_wac = 0
    WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_id;

    BEGIN
        v_adjustment_result := inventory.confirm_stock_adjustment(
            v_session_token,
            '33333333-3333-3333-3333-333333333333'::uuid,
            '\x010203'::bytea,
            v_warehouse_id,
            v_variant_id,
            1,
            1.000,
            'FOUND_STOCK',
            NULL,
            v_fiscal_period_id,
            '2026-01-17'::date
        );
        RAISE EXCEPTION 'Test 3 FAILED: Positive adjustment at zero stock without WAC should have thrown P2002';
    EXCEPTION WHEN SQLSTATE 'P2002' THEN
        RAISE NOTICE 'Test 3 PASSED: P2002 raised for positive adjustment without WAC';
    END;

    ----------------------------------------------------------------------------
    -- Test 4: Cash sale reaching zero quantity with sub-centime residual
    ----------------------------------------------------------------------------
    -- Seed position with stock = 1.000, total_value = 50.0020, last_known_wac = 50.002000
    UPDATE inventory.positions SET quantity_on_hand = 1.000, total_value = 50.0020, last_known_wac = 50.002000
    WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_id;

    v_sale_doc_id := sales.confirm_cash_sale(
        v_session_token,
        '44444444-4444-4444-4444-444444444444'::uuid,
        '\x010203'::bytea,
        v_cash_session_id,
        v_warehouse_id,
        v_fiscal_period_id,
        '2026-01-18'::date,
        jsonb_build_array(
            jsonb_build_object(
                'variant_id', v_variant_id,
                'quantity', 1.000,
                'unit_price', 60.00
            )
        )
    );

    ASSERT (SELECT quantity_on_hand FROM inventory.positions WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_id) = 0,
        'Test 4 FAILED: sale position quantity_on_hand != 0';
    ASSERT (SELECT total_value FROM inventory.positions WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_id) = 0,
        'Test 4 FAILED: sale position total_value != 0';

    RAISE NOTICE 'Test 4 PASSED: Cash sale zero-quantity sub-centime residual handling verified';

    RAISE NOTICE 'ALL S2-003 INTEGRATION DB ASSERTIONS PASSED';
END;
$$;
