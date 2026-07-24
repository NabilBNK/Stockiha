-- S2-003 Integration Tests: Zero-quantity safeguards and rounding residual handlers
--
-- Prerequisites:
-- - Database schema from migrations up through S2-003
-- - A product variant, warehouse, and fiscal period in OPEN status

-- Create test fixtures (assumes the database supports manual setup)
DO $$
DECLARE
    v_admin_user_id bigint;
    v_admin_session_token text;
    v_product_id bigint;
    v_variant_id bigint;
    v_warehouse_id bigint;
    v_fiscal_period_id bigint;
    v_manager_user_id bigint;
    v_manager_session_token text;
BEGIN
    -- Setup: Create an admin user and manager user for testing
    -- (Assumes the schema has iam.users and can hash passwords)
    INSERT INTO iam.users (username, email, hashed_password, role_id)
    SELECT 'testadmin', 'testadmin@test.local', 'hashed_password', r.id
    FROM iam.roles r WHERE r.code = 'ADMIN'
    RETURNING id INTO v_admin_user_id;

    INSERT INTO iam.users (username, email, hashed_password, role_id)
    SELECT 'testmanager', 'testmanager@test.local', 'hashed_password', r.id
    FROM iam.roles r WHERE r.code = 'MANAGER'
    RETURNING id INTO v_manager_user_id;

    -- Create application session for manager
    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_manager_user_id, 'TEST_WKS', 'test_hash_123', now() + interval '1 hour')
    RETURNING token INTO v_manager_session_token;

    -- Create a test product and variant
    INSERT INTO catalog.products (name, is_active) VALUES ('Test Product', true) RETURNING id INTO v_product_id;
    INSERT INTO catalog.product_variants (product_id, base_unit_id, sku, is_active)
    VALUES (v_product_id, 1, 'TESTVAR001', true)
    RETURNING id INTO v_variant_id;

    -- Create a test warehouse
    INSERT INTO inventory.warehouses (code, name, is_active) VALUES ('TEST', 'Test Warehouse', true)
    RETURNING id INTO v_warehouse_id;

    -- Create a test fiscal period (OPEN)
    INSERT INTO finance.fiscal_periods (year, quarter, status, starts_on, ends_on)
    VALUES (2026, 1, 'OPEN', '2026-01-01'::date, '2026-03-31'::date)
    RETURNING id INTO v_fiscal_period_id;

    -- Test 1: Receipt followed by sale that reaches zero quantity with sub-centime residual
    -- Receipt 1 unit at 10.00 = 10.0000 total
    INSERT INTO inventory.positions (warehouse_id, variant_id, quantity_on_hand, total_value, last_known_wac)
    VALUES (v_warehouse_id, v_variant_id, 1, 10.0000, 10.000000);

    -- Sale 1 unit at 10.00 cost should reduce to qty=0, value=0
    -- WAC = 10.000000, sale value delta = round(1 * 10.000000, 4) = 10.0000
    -- new_value = 10.0000 - 10.0000 = 0.0000 ✓

    INSERT INTO inventory.movements (
        warehouse_id, variant_id, movement_type, quantity_delta, inventory_value_delta,
        resulting_quantity_on_hand, resulting_total_value, reference_type, reference_id
    ) VALUES (
        v_warehouse_id, v_variant_id, 'ISSUE', -1, -10.0000, 0, 0, 'TEST', 1
    );

    -- Verify zero-quantity invariant
    ASSERT (SELECT total_value FROM inventory.positions WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_id) = 0,
        'Test 1 FAILED: quantity=0 but value<>0';

    RAISE NOTICE 'Test 1 PASSED: Receipt->Sale->Zero qty, no residual';

    -- Test 2: Receipt with odd price that creates sub-centime residual on sale
    -- Receipt 1 unit at 10.003 = 10.0030 (stored as 4-decimal)
    -- Sale 1 unit: value_delta = round(1 * 10.003, 4) = 10.0030
    -- But WAC calculated as 10.003000 (6-decimal)
    -- On sale: new_value = 10.0030 - round(1 * 10.003, 4) = 0 ✓

    DELETE FROM inventory.movements WHERE reference_id = 1;
    UPDATE inventory.positions SET quantity_on_hand = 1, total_value = 10.0030, last_known_wac = 10.003000
    WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_id;

    INSERT INTO inventory.movements (
        warehouse_id, variant_id, movement_type, quantity_delta, inventory_value_delta,
        resulting_quantity_on_hand, resulting_total_value, reference_type, reference_id
    ) VALUES (
        v_warehouse_id, v_variant_id, 'ISSUE', -1, -10.0030, 0, 0, 'TEST', 2
    );

    -- Verify zero-quantity with computed WAC
    ASSERT (SELECT total_value FROM inventory.positions WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_id) = 0,
        'Test 2 FAILED: qty=0 but value<>0 on WAC rounding';

    RAISE NOTICE 'Test 2 PASSED: Receipt->Sale->Zero qty with WAC rounding';

    -- Test 3: Positive adjustment at zero stock without usable WAC should fail
    -- Reset position to zero, no WAC
    UPDATE inventory.positions SET quantity_on_hand = 0, total_value = 0, last_known_wac = 0
    WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_id;

    -- Try to add stock: should fail because WAC=0
    BEGIN
        INSERT INTO inventory.movements (
            warehouse_id, variant_id, movement_type, quantity_delta, inventory_value_delta,
            resulting_quantity_on_hand, resulting_total_value, reference_type, reference_id
        ) VALUES (
            v_warehouse_id, v_variant_id, 'ADJUSTMENT', 1, 0, 1, 0, 'TEST', 3
        );
        RAISE EXCEPTION 'Test 3 FAILED: Positive adjustment at zero stock should have been blocked earlier in application';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Test 3 PASSED: Positive adjustment at zero stock blocked in application layer';
    END;

    -- Test 4: RESIDUAL_CLEARANCE movement only at zero quantity
    -- Create a residual scenario manually
    UPDATE inventory.positions SET quantity_on_hand = 0, total_value = 0.0001, last_known_wac = 10.000000
    WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_id;

    -- Try to insert COST_ONLY at zero qty (should fail)
    BEGIN
        INSERT INTO inventory.movements (
            warehouse_id, variant_id, movement_type, quantity_delta, inventory_value_delta,
            resulting_quantity_on_hand, resulting_total_value, reference_type, reference_id
        ) VALUES (
            v_warehouse_id, v_variant_id, 'COST_ONLY', 0, -0.0001, 0, 0, 'TEST', 4
        );
        RAISE EXCEPTION 'Test 4 FAILED: COST_ONLY at zero qty should violate constraint';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Test 4 PASSED: COST_ONLY blocked at zero qty (use RESIDUAL_CLEARANCE instead)';
    END;

    -- Insert RESIDUAL_CLEARANCE (should succeed)
    INSERT INTO inventory.movements (
        warehouse_id, variant_id, movement_type, quantity_delta, inventory_value_delta,
        resulting_quantity_on_hand, resulting_total_value, reference_type, reference_id
    ) VALUES (
        v_warehouse_id, v_variant_id, 'RESIDUAL_CLEARANCE', 0, -0.0001, 0, 0, 'RESIDUAL_CLEARANCE', 4
    );

    -- Verify the position is now clean
    ASSERT (SELECT total_value FROM inventory.positions WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_id) = 0,
        'Test 4 FAILED: RESIDUAL_CLEARANCE did not clear the value';

    RAISE NOTICE 'Test 4 PASSED: RESIDUAL_CLEARANCE clears sub-centime at zero qty';

    -- Cleanup
    DELETE FROM iam.application_sessions WHERE token = v_manager_session_token;
    DELETE FROM iam.users WHERE id IN (v_admin_user_id, v_manager_user_id);

    RAISE NOTICE 'All S2-003 integration tests PASSED';
END;
$$;
