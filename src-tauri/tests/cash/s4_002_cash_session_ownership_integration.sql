-- S4-002 integration: handover changes actual cash-posting authority.
-- A stale cashier knowing the session ID must not be able to complete a cash
-- sale after ownership transfers; the whole attempted posting must roll back.
\set ON_ERROR_STOP on

DO $$
DECLARE
    v_suffix text := floor(random() * 1000000000)::bigint::text;
    v_workstation text := 'S4002-OWN-WKS-' || v_suffix;
    v_cashier1_username text := 's4002_own_cashier1_' || v_suffix;
    v_cashier2_username text := 's4002_own_cashier2_' || v_suffix;
    v_manager_username text := 's4002_own_manager_' || v_suffix;
    v_cashier1_token text := 's4002-own-c1-token-' || v_suffix;
    v_cashier2_token text := 's4002-own-c2-token-' || v_suffix;
    v_manager_token text := 's4002-own-mgr-token-' || v_suffix;
    v_cashier1_id bigint;
    v_cashier2_id bigint;
    v_manager_id bigint;
    v_unit_id bigint;
    v_warehouse_id bigint;
    v_product_id bigint;
    v_variant_id bigint;
    v_period_id bigint;
    v_document_date date;
    v_session_id bigint;
    v_sale_document_id bigint;
    v_request_old uuid := md5('s4002-own-old-' || v_suffix)::uuid;
    v_request_new uuid := md5('s4002-own-new-' || v_suffix)::uuid;
    v_lines jsonb;
    v_blocked boolean := false;
    v_qty numeric;
    v_count bigint;
BEGIN
    RAISE NOTICE '=== Running S4-002 cash ownership integration suite ===';

    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES (v_cashier1_username, 'Ownership Cashier One', 'x')
    RETURNING id INTO v_cashier1_id;
    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES (v_cashier2_username, 'Ownership Cashier Two', 'x')
    RETURNING id INTO v_cashier2_id;
    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES (v_manager_username, 'Ownership Manager', 'x')
    RETURNING id INTO v_manager_id;

    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_cashier1_id, id FROM iam.roles WHERE code = 'CASHIER';
    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_cashier2_id, id FROM iam.roles WHERE code = 'CASHIER';
    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_manager_id, id FROM iam.roles WHERE code = 'MANAGER';

    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at) VALUES
        (v_cashier1_id, v_workstation, sha256(v_cashier1_token::bytea), now() + interval '2 hours'),
        (v_cashier2_id, v_workstation, sha256(v_cashier2_token::bytea), now() + interval '2 hours'),
        (v_manager_id, v_workstation, sha256(v_manager_token::bytea), now() + interval '2 hours');

    SELECT id INTO v_unit_id
    FROM catalog.units
    WHERE normalized_code = 'UNIT'
    LIMIT 1;
    IF v_unit_id IS NULL THEN
        RAISE EXCEPTION 'S4-002 ownership integration requires UNIT';
    END IF;

    SELECT id, starts_on
    INTO v_period_id, v_document_date
    FROM finance.fiscal_periods
    WHERE status = 'OPEN'
    ORDER BY starts_on DESC
    LIMIT 1;
    IF v_period_id IS NULL THEN
        RAISE EXCEPTION 'S4-002 ownership integration requires OPEN fiscal period';
    END IF;

    INSERT INTO inventory.warehouses (code, name)
    VALUES ('WH-S4002-OWN-' || v_suffix, 'S4-002 Ownership Warehouse')
    RETURNING id INTO v_warehouse_id;

    INSERT INTO catalog.products (name, is_active)
    VALUES ('S4-002 Ownership Product ' || v_suffix, true)
    RETURNING id INTO v_product_id;

    INSERT INTO catalog.product_variants (
        product_id, base_unit_id, sku, sale_price, is_active
    ) VALUES (
        v_product_id, v_unit_id, 'SKU-S4002-OWN-' || v_suffix, 100.00, true
    ) RETURNING id INTO v_variant_id;

    INSERT INTO inventory.positions (
        warehouse_id, variant_id, quantity_on_hand, total_value, last_known_wac
    ) VALUES (
        v_warehouse_id, v_variant_id, 5.000, 250.0000, 50.000000
    );

    v_lines := jsonb_build_array(jsonb_build_object(
        'variant_id', v_variant_id,
        'quantity', '1',
        'unit_price', '100.00'
    ));

    v_session_id := sales.open_cash_session(
        v_cashier1_token, v_warehouse_id, v_workstation, 0
    );
    PERFORM sales.suspend_cash_session(
        v_cashier1_token, v_session_id, 'Ownership transfer test'
    );
    PERFORM sales.handover_cash_session(
        v_manager_token, v_session_id, v_cashier2_username, 'Ownership transfer test'
    );
    PERFORM sales.resume_cash_session(v_cashier2_token, v_session_id);

    -- The legacy cash-sale function itself only knows OPEN + warehouse.
    -- S4-002's central cash.movements trigger must reject the stale cashier
    -- late in the posting transaction, causing every preceding mutation to
    -- roll back atomically.
    BEGIN
        PERFORM sales.confirm_cash_sale(
            v_cashier1_token,
            v_request_old,
            sha256(convert_to(v_lines::text, 'UTF8')),
            v_session_id,
            v_warehouse_id,
            v_period_id,
            v_document_date,
            v_lines
        );
    EXCEPTION WHEN SQLSTATE '42501' THEN
        v_blocked := true;
    END;

    IF NOT v_blocked THEN
        RAISE EXCEPTION 'Assertion failed: old cashier completed cash sale after handover';
    END IF;

    SELECT quantity_on_hand INTO v_qty
    FROM inventory.positions
    WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_id;
    IF v_qty <> 5.000 THEN
        RAISE EXCEPTION 'Assertion failed: blocked stale sale changed stock: %', v_qty;
    END IF;

    SELECT count(*) INTO v_count
    FROM cash.movements
    WHERE cash_session_id = v_session_id;
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'Assertion failed: blocked stale sale created cash movement';
    END IF;

    SELECT count(*) INTO v_count
    FROM cash.drawer_jobs
    WHERE cash_session_id = v_session_id;
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'Assertion failed: blocked stale sale created drawer job';
    END IF;

    -- Current cashier owns the same session and can post normally.
    v_sale_document_id := sales.confirm_cash_sale(
        v_cashier2_token,
        v_request_new,
        sha256(convert_to(v_lines::text, 'UTF8')),
        v_session_id,
        v_warehouse_id,
        v_period_id,
        v_document_date,
        v_lines
    );

    IF v_sale_document_id IS NULL THEN
        RAISE EXCEPTION 'Assertion failed: current cashier sale did not return document';
    END IF;

    SELECT quantity_on_hand INTO v_qty
    FROM inventory.positions
    WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_id;
    IF v_qty <> 4.000 THEN
        RAISE EXCEPTION 'Assertion failed: authorized sale stock expected 4, got %', v_qty;
    END IF;

    SELECT count(*) INTO v_count
    FROM cash.movements
    WHERE cash_session_id = v_session_id
      AND business_document_id = v_sale_document_id
      AND movement_type = 'SALE'
      AND amount = 100.00;
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'Assertion failed: current cashier cash movement missing';
    END IF;

    SELECT count(*) INTO v_count
    FROM cash.drawer_jobs
    WHERE cash_session_id = v_session_id
      AND business_document_id = v_sale_document_id;
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'Assertion failed: current cashier drawer job missing';
    END IF;

    RAISE NOTICE '=== S4-002 cash ownership integration suite PASSED ===';
END;
$$;
