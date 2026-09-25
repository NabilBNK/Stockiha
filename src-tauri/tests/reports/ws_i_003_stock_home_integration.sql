-- WS-I-003 Integration Test: stock reports, notifications and the Today home.
-- Bootstrap pattern copied from src-tauri/tests/reports/ws_i_002_finance_reports_integration.sql,
-- suffix wsi003.
\set ON_ERROR_STOP on

DO $$
DECLARE
    v_suffix text := floor(random() * 1000000000)::bigint::text;
    v_workstation text := 'WSI003-WKS-' || v_suffix;
    v_workstation2 text := 'WSI003-WKS2-' || v_suffix;
    v_admin_username text := 'wsi003_admin_' || v_suffix;
    v_admin_token text := 'wsi003_admin_token_' || v_suffix;
    v_admin2_token text := 'wsi003_admin2_token_' || v_suffix;
    v_cashier_username text := 'wsi003_cashier_' || v_suffix;
    v_cashier_token text := 'wsi003_cashier_token_' || v_suffix;
    v_admin_id bigint;
    v_cashier_id bigint;
    v_warehouse_id bigint;
    v_period_id bigint;
    v_unit_id bigint;
    v_carton_unit_id bigint;

    v_today date := current_date;

    v_p1_product_id bigint; v_v1_id bigint;
    v_p2_product_id bigint; v_v2_id bigint;
    v_p3_product_id bigint; v_v3_id bigint;
    v_p4_product_id bigint; v_v4_id bigint;
    -- Separate from V3 on purpose: V3 must stay untouched ("has stock, never
    -- sold") for the slow-movers assertion, so today's sale and the overdue
    -- credit invoice use their own variant instead.
    v_p5_product_id bigint; v_v5_id bigint;

    v_supplier_id bigint;
    v_purchase_res jsonb;

    v_customer_json jsonb;
    v_customer_id bigint;
    v_credit_result jsonb;

    v_session_long bigint;
    v_lines jsonb;

    v_valuation jsonb;
    v_positions_total numeric;
    v_low_stock jsonb;
    v_row jsonb;
    v_slow30 jsonb;
    v_slow60 jsonb;
    v_history jsonb;
    v_notifications jsonb;
    v_today_overview jsonb;
    v_today_overview2 jsonb;
    v_notif_kinds text[];

    v_blocked boolean;
BEGIN
    RAISE NOTICE '=== Running WS-I-003 stock/notifications/home integration suite ===';

    SELECT id INTO v_period_id
    FROM finance.fiscal_periods
    WHERE status = 'OPEN' AND CURRENT_DATE BETWEEN starts_on AND ends_on
    LIMIT 1;
    IF v_period_id IS NULL THEN
        INSERT INTO finance.fiscal_periods (period_code, starts_on, ends_on, status)
        VALUES ('TESTI3-' || v_suffix, date_trunc('year', CURRENT_DATE)::date, (date_trunc('year', CURRENT_DATE) + interval '1 year' - interval '1 day')::date, 'OPEN')
        RETURNING id INTO v_period_id;
    END IF;

    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES (v_admin_username, 'WSI003 Admin', 'hashed_pass')
    RETURNING id INTO v_admin_id;
    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES (v_cashier_username, 'WSI003 Cashier', 'hashed_pass')
    RETURNING id INTO v_cashier_id;

    INSERT INTO iam.user_roles (user_id, role_id) SELECT v_admin_id, id FROM iam.roles WHERE code = 'ADMIN';
    INSERT INTO iam.user_roles (user_id, role_id) SELECT v_cashier_id, id FROM iam.roles WHERE code = 'CASHIER';

    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at) VALUES
        (v_admin_id, v_workstation, sha256(v_admin_token::bytea), now() + interval '2 hours'),
        (v_admin_id, v_workstation2, sha256(v_admin2_token::bytea), now() + interval '2 hours'),
        (v_cashier_id, v_workstation, sha256(v_cashier_token::bytea), now() + interval '2 hours');

    INSERT INTO inventory.warehouses (code, name)
    VALUES ('WH-WSI003-' || v_suffix, 'WS-I-003 Warehouse')
    RETURNING id INTO v_warehouse_id;

    SELECT id INTO v_unit_id FROM catalog.units WHERE normalized_code = 'UNIT' LIMIT 1;
    IF v_unit_id IS NULL THEN
        SELECT id INTO v_unit_id FROM catalog.units LIMIT 1;
    END IF;
    INSERT INTO catalog.units (code, normalized_code, name)
    VALUES ('CARTON-WSI003-' || v_suffix, 'CARTON-WSI003-' || v_suffix, 'Carton')
    RETURNING id INTO v_carton_unit_id;

    INSERT INTO procurement.suppliers (code, name, is_active)
    VALUES ('SUP-WSI003-' || v_suffix, 'WSI003 Supplier S1', true)
    RETURNING id INTO v_supplier_id;

    -- V1: minimum_stock 50, no starting position (the purchase below creates
    -- it at exactly on-hand 20 via 2 cartons of 10 base units each).
    INSERT INTO catalog.products (name, is_active) VALUES ('WSI003 V1 ' || v_suffix, true) RETURNING id INTO v_p1_product_id;
    INSERT INTO catalog.product_variants (product_id, base_unit_id, sku, sale_price, is_active, minimum_stock)
    VALUES (v_p1_product_id, v_unit_id, 'SKU-WSI003-V1-' || v_suffix, 900.00, true, 50)
    RETURNING id INTO v_v1_id;
    -- catalog.variant_units.conversion_direction/conversion_quantity are
    -- NOT NULL as of 20260908090000_ws_d_007_variant_alt_unit_direction.sql
    -- (grep-proven; not a WS-I-3 plan omission, R-03). ALT_TO_BASE matches
    -- conversion_factor's own meaning ("1 alternate = N base units").
    INSERT INTO catalog.variant_units (variant_id, unit_id, conversion_factor, conversion_direction, conversion_quantity)
    VALUES (v_v1_id, v_carton_unit_id, 10.000, 'ALT_TO_BASE', 10.000);

    -- V2: minimum_stock 10, on-hand 0.
    INSERT INTO catalog.products (name, is_active) VALUES ('WSI003 V2 ' || v_suffix, true) RETURNING id INTO v_p2_product_id;
    INSERT INTO catalog.product_variants (product_id, base_unit_id, sku, sale_price, is_active, minimum_stock)
    VALUES (v_p2_product_id, v_unit_id, 'SKU-WSI003-V2-' || v_suffix, 300.00, true, 10)
    RETURNING id INTO v_v2_id;
    INSERT INTO inventory.positions (warehouse_id, variant_id, quantity_on_hand, total_value, last_known_wac)
    VALUES (v_warehouse_id, v_v2_id, 0.000, 0.0000, 0.000000);

    -- V3: has stock, never sold.
    INSERT INTO catalog.products (name, is_active) VALUES ('WSI003 V3 ' || v_suffix, true) RETURNING id INTO v_p3_product_id;
    INSERT INTO catalog.product_variants (product_id, base_unit_id, sku, sale_price, is_active)
    VALUES (v_p3_product_id, v_unit_id, 'SKU-WSI003-V3-' || v_suffix, 200.00, true)
    RETURNING id INTO v_v3_id;
    INSERT INTO inventory.positions (warehouse_id, variant_id, quantity_on_hand, total_value, last_known_wac)
    VALUES (v_warehouse_id, v_v3_id, 30.000, 3000.0000, 100.000000);

    -- V4: has stock, last sold 45 days ago.
    INSERT INTO catalog.products (name, is_active) VALUES ('WSI003 V4 ' || v_suffix, true) RETURNING id INTO v_p4_product_id;
    INSERT INTO catalog.product_variants (product_id, base_unit_id, sku, sale_price, is_active)
    VALUES (v_p4_product_id, v_unit_id, 'SKU-WSI003-V4-' || v_suffix, 150.00, true)
    RETURNING id INTO v_v4_id;
    INSERT INTO inventory.positions (warehouse_id, variant_id, quantity_on_hand, total_value, last_known_wac)
    VALUES (v_warehouse_id, v_v4_id, 40.000, 4000.0000, 100.000000);

    -- V5: sold today and via the overdue credit invoice (kept separate from
    -- V3, which must remain "never sold" for the slow-movers assertion).
    INSERT INTO catalog.products (name, is_active) VALUES ('WSI003 V5 ' || v_suffix, true) RETURNING id INTO v_p5_product_id;
    INSERT INTO catalog.product_variants (product_id, base_unit_id, sku, sale_price, is_active)
    VALUES (v_p5_product_id, v_unit_id, 'SKU-WSI003-V5-' || v_suffix, 200.00, true)
    RETURNING id INTO v_v5_id;
    INSERT INTO inventory.positions (warehouse_id, variant_id, quantity_on_hand, total_value, last_known_wac)
    VALUES (v_warehouse_id, v_v5_id, 50.000, 5000.0000, 100.000000);

    -- =========================================================================
    -- POSTED purchase receipt of V1: 2 cartons (10 base units each) at
    -- 4,500 per carton, from S1. Establishes on-hand 20 and the last-cost
    -- history get_low_stock reads.
    -- =========================================================================
    v_purchase_res := inventory.confirm_direct_purchase(
        v_admin_token, gen_random_uuid(), sha256(('wsi003-purchase-' || v_suffix)::bytea),
        v_supplier_id, v_warehouse_id, v_period_id, v_today, NULL,
        jsonb_build_array(jsonb_build_object('variant_id', v_v1_id, 'unit_id', v_carton_unit_id, 'quantity_received', 2, 'unit_cost', 4500.00))
    );

    -- =========================================================================
    -- V4 sold 45 days ago (backdated document_date).
    -- =========================================================================
    v_session_long := sales.open_cash_session(v_admin_token, v_warehouse_id, v_workstation, 500.00);
    v_lines := jsonb_build_array(jsonb_build_object('variant_id', v_v4_id, 'quantity', 2.000, 'unit_price', 150.00));
    PERFORM sales.confirm_cash_sale(
        v_admin_token, md5('wsi003-v4sale-' || v_suffix)::uuid,
        sha256(convert_to(v_lines::text || ':0.00', 'UTF8')),
        v_session_long, v_warehouse_id, v_period_id, v_today - 45, v_lines, 0.00
    );

    -- A sale today too, so get_today's summary has a non-zero figure to
    -- compare against get_sales_summary(today, today) (assertion 6).
    v_lines := jsonb_build_array(jsonb_build_object('variant_id', v_v5_id, 'quantity', 1.000, 'unit_price', 200.00));
    PERFORM sales.confirm_cash_sale(
        v_admin_token, md5('wsi003-today-' || v_suffix)::uuid,
        sha256(convert_to(v_lines::text || ':0.00', 'UTF8')),
        v_session_long, v_warehouse_id, v_period_id, v_today, v_lines, 0.00
    );

    -- Backdate the session's open time to 17 hours ago (CASH_SESSION_LONG_OPEN).
    UPDATE sales.cash_sessions SET opened_at = now() - interval '17 hours' WHERE id = v_session_long;

    -- =========================================================================
    -- Customer credit invoice overdue by 100 days (terms 30 days, so document
    -- date = today - 130).
    -- =========================================================================
    v_customer_json := receivables.create_customer(
        v_admin_token, 'CUS-WSI003-' || v_suffix, 'WSI003 Customer',
        NULL, NULL, NULL, NULL, NULL, true, 100000.00, 30, 999
    );
    v_customer_id := (v_customer_json ->> 'id')::bigint;
    v_lines := jsonb_build_array(jsonb_build_object('variant_id', v_v5_id, 'quantity', 2.000, 'unit_price', 200.00));
    v_credit_result := sales.confirm_credit_sale(
        v_admin_token, md5('wsi003-credit-' || v_suffix)::uuid,
        sha256(convert_to(v_lines::text, 'UTF8')),
        v_customer_id, v_warehouse_id, v_period_id, v_today - 130, v_lines
    );

    -- =========================================================================
    -- 1. get_stock_valuation.totals.stock_value == SUM(inventory.positions.total_value)
    --    over active variants with stock <> 0.
    -- =========================================================================
    v_valuation := reports.get_stock_valuation(v_admin_token, NULL, NULL, 500, 0);
    SELECT sum(p.total_value) INTO v_positions_total
    FROM inventory.positions p
    JOIN catalog.product_variants pv ON pv.id = p.variant_id
    JOIN catalog.products pr ON pr.id = pv.product_id
    WHERE pv.is_active AND pr.is_active AND p.quantity_on_hand <> 0;
    IF (v_valuation -> 'totals' ->> 'stock_value')::numeric <> round(v_positions_total, 2) THEN
        RAISE EXCEPTION 'Assertion failed (1): stock_value % <> positions total %',
            v_valuation -> 'totals' ->> 'stock_value', v_positions_total;
    END IF;

    -- =========================================================================
    -- 2. get_low_stock: V1 suggested_qty_base 80 / suggested_packs 8 /
    --    last_unit_cost 450.00 / last_supplier_name S1; V2 present with on_hand 0.
    -- =========================================================================
    v_low_stock := reports.get_low_stock(v_admin_token, NULL, 500, 0);
    SELECT r INTO v_row FROM jsonb_array_elements(v_low_stock -> 'rows') r WHERE (r ->> 'variant_id')::bigint = v_v1_id;
    IF v_row IS NULL THEN RAISE EXCEPTION 'Assertion failed (2): V1 missing from get_low_stock'; END IF;
    IF (v_row ->> 'suggested_qty_base')::numeric <> 80 THEN
        RAISE EXCEPTION 'Assertion failed (2): V1 suggested_qty_base % <> 80', v_row ->> 'suggested_qty_base';
    END IF;
    IF (v_row ->> 'suggested_packs')::numeric <> 8 THEN
        RAISE EXCEPTION 'Assertion failed (2): V1 suggested_packs % <> 8', v_row ->> 'suggested_packs';
    END IF;
    IF (v_row ->> 'last_unit_cost')::numeric <> 450.00 THEN
        RAISE EXCEPTION 'Assertion failed (2): V1 last_unit_cost % <> 450.00', v_row ->> 'last_unit_cost';
    END IF;
    IF v_row ->> 'last_supplier_name' <> 'WSI003 Supplier S1' THEN
        RAISE EXCEPTION 'Assertion failed (2): V1 last_supplier_name % <> S1', v_row ->> 'last_supplier_name';
    END IF;
    SELECT r INTO v_row FROM jsonb_array_elements(v_low_stock -> 'rows') r WHERE (r ->> 'variant_id')::bigint = v_v2_id;
    IF v_row IS NULL OR (v_row ->> 'on_hand')::numeric <> 0 THEN
        RAISE EXCEPTION 'Assertion failed (2): V2 missing or on_hand <> 0';
    END IF;

    -- =========================================================================
    -- 3. get_slow_movers(30) contains V4 and V3; get_slow_movers(60) does not
    --    contain V4 and still contains V3.
    -- =========================================================================
    v_slow30 := reports.get_slow_movers(v_admin_token, 30, NULL, 500, 0);
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_slow30 -> 'rows') r WHERE (r ->> 'variant_id')::bigint = v_v4_id) THEN
        RAISE EXCEPTION 'Assertion failed (3): V4 missing from get_slow_movers(30)';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_slow30 -> 'rows') r WHERE (r ->> 'variant_id')::bigint = v_v3_id) THEN
        RAISE EXCEPTION 'Assertion failed (3): V3 missing from get_slow_movers(30)';
    END IF;
    v_slow60 := reports.get_slow_movers(v_admin_token, 60, NULL, 500, 0);
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_slow60 -> 'rows') r WHERE (r ->> 'variant_id')::bigint = v_v4_id) THEN
        RAISE EXCEPTION 'Assertion failed (3): V4 unexpectedly present in get_slow_movers(60)';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_slow60 -> 'rows') r WHERE (r ->> 'variant_id')::bigint = v_v3_id) THEN
        RAISE EXCEPTION 'Assertion failed (3): V3 missing from get_slow_movers(60)';
    END IF;

    -- =========================================================================
    -- 4. get_product_history(V1): opening + sum(delta) == closing == total on hand today.
    -- =========================================================================
    v_history := reports.get_product_history(v_admin_token, v_v1_id, v_today - 3650, v_today, 500, 0);
    IF (v_history ->> 'closing_quantity')::numeric <>
       (SELECT quantity_on_hand FROM inventory.positions WHERE variant_id = v_v1_id AND warehouse_id = v_warehouse_id) THEN
        RAISE EXCEPTION 'Assertion failed (4): V1 closing_quantity %  <> on-hand', v_history ->> 'closing_quantity';
    END IF;

    -- =========================================================================
    -- 5. get_notifications contains OUT_OF_STOCK, LOW_STOCK, OVERDUE_DEBTS
    --    (CRITICAL, >90 days), CASH_SESSION_LONG_OPEN, BACKUP_OVERDUE.
    -- =========================================================================
    v_notifications := reports.get_notifications(v_admin_token);
    SELECT array_agg(r ->> 'id') INTO v_notif_kinds FROM jsonb_array_elements(v_notifications -> 'items') r;
    IF NOT ('OUT_OF_STOCK' = ANY (v_notif_kinds)) THEN RAISE EXCEPTION 'Assertion failed (5): OUT_OF_STOCK missing'; END IF;
    IF NOT ('LOW_STOCK' = ANY (v_notif_kinds)) THEN RAISE EXCEPTION 'Assertion failed (5): LOW_STOCK missing'; END IF;
    IF NOT ('OVERDUE_DEBTS' = ANY (v_notif_kinds)) THEN RAISE EXCEPTION 'Assertion failed (5): OVERDUE_DEBTS missing'; END IF;
    SELECT r INTO v_row FROM jsonb_array_elements(v_notifications -> 'items') r WHERE r ->> 'id' = 'OVERDUE_DEBTS';
    IF v_row ->> 'severity' <> 'CRITICAL' THEN
        RAISE EXCEPTION 'Assertion failed (5): OVERDUE_DEBTS severity % <> CRITICAL', v_row ->> 'severity';
    END IF;
    IF NOT ('CASH_SESSION_LONG_OPEN' = ANY (v_notif_kinds)) THEN RAISE EXCEPTION 'Assertion failed (5): CASH_SESSION_LONG_OPEN missing'; END IF;
    IF NOT ('BACKUP_OVERDUE' = ANY (v_notif_kinds)) THEN RAISE EXCEPTION 'Assertion failed (5): BACKUP_OVERDUE missing'; END IF;

    -- =========================================================================
    -- 6. get_today.today.summary == get_sales_summary(today, today);
    --    drawer is null for a workstation with no open session.
    -- =========================================================================
    v_today_overview := reports.get_today(v_admin_token);
    IF (v_today_overview -> 'today' -> 'summary') <> reports.get_sales_summary(v_admin_token, v_today, v_today) THEN
        RAISE EXCEPTION 'Assertion failed (6): get_today.today.summary mismatch';
    END IF;
    v_today_overview2 := reports.get_today(v_admin2_token);
    IF (v_today_overview2 -> 'drawer') IS DISTINCT FROM 'null'::jsonb THEN
        RAISE EXCEPTION 'Assertion failed (6): drawer not null for a workstation with no open session';
    END IF;

    -- =========================================================================
    -- 7. CASHIER -> 42501; days 45 -> 22023; unknown variant -> 22023.
    -- =========================================================================
    v_blocked := false;
    BEGIN PERFORM reports.get_stock_valuation(v_cashier_token, NULL, NULL, 50, 0);
    EXCEPTION WHEN SQLSTATE '42501' THEN v_blocked := true; END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'Assertion failed (7a): get_stock_valuation allowed a CASHIER'; END IF;

    v_blocked := false;
    BEGIN PERFORM reports.get_low_stock(v_cashier_token, NULL, 50, 0);
    EXCEPTION WHEN SQLSTATE '42501' THEN v_blocked := true; END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'Assertion failed (7b): get_low_stock allowed a CASHIER'; END IF;

    v_blocked := false;
    BEGIN PERFORM reports.get_slow_movers(v_cashier_token, 90, NULL, 50, 0);
    EXCEPTION WHEN SQLSTATE '42501' THEN v_blocked := true; END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'Assertion failed (7c): get_slow_movers allowed a CASHIER'; END IF;

    v_blocked := false;
    BEGIN PERFORM reports.get_product_history(v_cashier_token, v_v1_id, v_today, v_today, 50, 0);
    EXCEPTION WHEN SQLSTATE '42501' THEN v_blocked := true; END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'Assertion failed (7d): get_product_history allowed a CASHIER'; END IF;

    v_blocked := false;
    BEGIN PERFORM reports.get_notifications(v_cashier_token);
    EXCEPTION WHEN SQLSTATE '42501' THEN v_blocked := true; END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'Assertion failed (7e): get_notifications allowed a CASHIER'; END IF;

    v_blocked := false;
    BEGIN PERFORM reports.get_today(v_cashier_token);
    EXCEPTION WHEN SQLSTATE '42501' THEN v_blocked := true; END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'Assertion failed (7f): get_today allowed a CASHIER'; END IF;

    v_blocked := false;
    BEGIN PERFORM reports.get_slow_movers(v_admin_token, 45, NULL, 50, 0);
    EXCEPTION WHEN SQLSTATE '22023' THEN v_blocked := true; END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'Assertion failed (7g): days=45 was allowed'; END IF;

    v_blocked := false;
    BEGIN PERFORM reports.get_product_history(v_admin_token, -1, v_today, v_today, 50, 0);
    EXCEPTION WHEN SQLSTATE '22023' THEN v_blocked := true; END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'Assertion failed (7h): unknown variant was allowed'; END IF;

    -- =========================================================================
    -- 8. schema_state.migration_version >= 20260929090000; re-run.
    -- =========================================================================
    IF (SELECT migration_version FROM operations.schema_state WHERE singleton) < 20260929090000 THEN
        RAISE EXCEPTION 'Assertion failed (8): schema_state.migration_version mismatch';
    END IF;

    -- =========================================================================
    -- 9. Performance: EXPLAIN ANALYZE every new public function.
    -- =========================================================================
    DECLARE
        v_explain text;
        v_plan_line text;
    BEGIN
        FOR v_explain IN
            SELECT unnest(ARRAY[
                format('EXPLAIN (ANALYZE, TIMING OFF, SUMMARY ON) SELECT reports.get_stock_valuation(%L, NULL, NULL, 50, 0)', v_admin_token),
                format('EXPLAIN (ANALYZE, TIMING OFF, SUMMARY ON) SELECT reports.get_low_stock(%L, NULL, 50, 0)', v_admin_token),
                format('EXPLAIN (ANALYZE, TIMING OFF, SUMMARY ON) SELECT reports.get_slow_movers(%L, 90, NULL, 50, 0)', v_admin_token),
                format('EXPLAIN (ANALYZE, TIMING OFF, SUMMARY ON) SELECT reports.get_product_history(%L, %L, %L, %L, 50, 0)', v_admin_token, v_v1_id, v_today - 3650, v_today),
                format('EXPLAIN (ANALYZE, TIMING OFF, SUMMARY ON) SELECT reports.get_notifications(%L)', v_admin_token),
                format('EXPLAIN (ANALYZE, TIMING OFF, SUMMARY ON) SELECT reports.get_today(%L)', v_admin_token)
            ])
        LOOP
            FOR v_plan_line IN EXECUTE v_explain LOOP
                IF v_plan_line LIKE 'Execution Time:%' THEN
                    RAISE NOTICE '[WS-I-003 perf] % -> %', left(v_explain, 70), v_plan_line;
                END IF;
            END LOOP;
        END LOOP;
    END;

    RAISE NOTICE '=== WS-I-003 stock/notifications/home integration suite completed successfully ===';
END;
$$;

-- =============================================================================
-- Re-applying the migration file a second time raises no error.
-- =============================================================================
\i src-tauri/migrations/20260929090000_ws_i_003_stock_home.sql
