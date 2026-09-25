-- WS-I-001 Integration Test: reporting foundation + sales & profit reports.
-- Bootstrap pattern copied from src-tauri/tests/sales/ws_f_006_sale_void_integration.sql
-- (users, roles, sessions, warehouse, fiscal period, stock), suffix wsi001.
-- Sales are posted through the real sales.confirm_cash_sale /
-- sales.confirm_credit_sale functions -- document_date is an explicit
-- parameter on both, so no post-hoc UPDATE of core.business_documents is
-- needed for them (R-03 dependency check: confirmed against
-- src-tauri/migrations/20260826091000_sales_confirm_cash_sale_account_id.sql
-- and 20260826095000_sales_confirm_credit_sale_account_id.sql). But
-- sales.void_sale takes no document_date parameter at all and unconditionally
-- stamps the void document with v_today (real current_date; confirmed at
-- src-tauri/migrations/20260922090000_ws_f_006_sale_void.sql:379,
-- "'SALE_VOID', v_today, ..."), and get_sales_summary's void_count/void_total
-- are scoped by the VOID document's own date, not the original sale's date
-- (plan §5.10 SQL, section 6). STEP I1-10's setup note anticipates exactly
-- this class of mismatch ("otherwise use current_date for everything and
-- adapt the expected dates"): D is therefore current_date - 1 here (not
-- current_date - 2 as the plan's prose literally says), so D+1 lands on
-- today and the void the suite posts on day D falls inside the [D, D+1]
-- assertion window used throughout. Reported under "Deviations" in the
-- WS-I-1 Result Report.
\set ON_ERROR_STOP on

DO $$
DECLARE
    v_suffix text := floor(random() * 1000000000)::bigint::text;
    v_workstation text := 'WSI001-WKS-' || v_suffix;
    v_admin_username text := 'wsi001_admin_' || v_suffix;
    v_cashier_username text := 'wsi001_cashier_' || v_suffix;
    v_admin_token text := 'wsi001_admin_token_' || v_suffix;
    v_cashier_token text := 'wsi001_cashier_token_' || v_suffix;
    v_admin_id bigint;
    v_cashier_id bigint;
    v_warehouse_id bigint;
    v_period_id bigint;
    v_period_start date;
    v_period_end date;
    v_unit_id bigint;

    v_day_d date := current_date - 1;
    v_day_d1 date := current_date;

    v_p1_product_id bigint;
    v_p1_variant_id bigint;
    v_p2_product_id bigint;
    v_p2_variant_id bigint;

    v_customer_json jsonb;
    v_customer_id bigint;

    v_session1 bigint;
    v_lines jsonb;
    v_doc_s1 bigint;
    v_doc_s2 bigint;
    v_doc_s3 bigint;
    v_doc_s4 bigint;
    v_credit_result jsonb;

    v_summary jsonb;
    v_by_product jsonb;
    v_by_category jsonb;
    v_by_cashier jsonb;
    v_by_hour jsonb;
    v_timeseries jsonb;
    v_margin_alerts jsonb;

    v_discount_sum numeric;
    v_p1_qty numeric;
    v_share numeric;
    v_blocked boolean;

    v_explain text;
    v_i integer;
BEGIN
    RAISE NOTICE '=== Running WS-I-001 sales reports integration suite ===';

    -- Open fiscal period covering today (and D/D+1, both within a few days).
    SELECT id, starts_on, ends_on
    INTO v_period_id, v_period_start, v_period_end
    FROM finance.fiscal_periods
    WHERE status = 'OPEN' AND CURRENT_DATE BETWEEN starts_on AND ends_on
    LIMIT 1;

    IF v_period_id IS NULL THEN
        SELECT id, starts_on, ends_on
        INTO v_period_id, v_period_start, v_period_end
        FROM finance.fiscal_periods
        WHERE CURRENT_DATE BETWEEN starts_on AND ends_on
        LIMIT 1;
        IF v_period_id IS NOT NULL THEN
            UPDATE finance.fiscal_periods SET status = 'OPEN' WHERE id = v_period_id;
        ELSE
            INSERT INTO finance.fiscal_periods (period_code, starts_on, ends_on, status)
            VALUES ('TESTI1-' || v_suffix, date_trunc('year', CURRENT_DATE)::date, (date_trunc('year', CURRENT_DATE) + interval '1 year' - interval '1 day')::date, 'OPEN')
            RETURNING id, starts_on, ends_on INTO v_period_id, v_period_start, v_period_end;
        END IF;
    END IF;

    -- Users: an ADMIN (holds VIEW_REPORTS) and a plain CASHIER (does not).
    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES (v_admin_username, 'WSI001 Admin', 'hashed_pass')
    RETURNING id INTO v_admin_id;

    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES (v_cashier_username, 'WSI001 Cashier', 'hashed_pass')
    RETURNING id INTO v_cashier_id;

    INSERT INTO iam.user_roles (user_id, role_id) SELECT v_admin_id, id FROM iam.roles WHERE code = 'ADMIN';
    INSERT INTO iam.user_roles (user_id, role_id) SELECT v_cashier_id, id FROM iam.roles WHERE code = 'CASHIER';

    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at) VALUES
        (v_admin_id, v_workstation, sha256(v_admin_token::bytea), now() + interval '2 hours'),
        (v_cashier_id, v_workstation, sha256(v_cashier_token::bytea), now() + interval '2 hours');

    INSERT INTO inventory.warehouses (code, name)
    VALUES ('WH-WSI001-' || v_suffix, 'WS-I-001 Warehouse')
    RETURNING id INTO v_warehouse_id;

    SELECT id INTO v_unit_id FROM catalog.units WHERE normalized_code = 'UNIT' LIMIT 1;
    IF v_unit_id IS NULL THEN
        SELECT id INTO v_unit_id FROM catalog.units LIMIT 1;
    END IF;

    -- P1: sold at 500, WAC 100 (cost < price -- ordinary margin).
    INSERT INTO catalog.products (name, is_active)
    VALUES ('WSI001 P1 ' || v_suffix, true)
    RETURNING id INTO v_p1_product_id;

    INSERT INTO catalog.product_variants (product_id, base_unit_id, sku, sale_price, is_active)
    VALUES (v_p1_product_id, v_unit_id, 'SKU-WSI001-P1-' || v_suffix, 500.00, true)
    RETURNING id INTO v_p1_variant_id;

    -- Ample stock: 7 units used by S1/S2/S4 plus 1,000 sold by the
    -- performance-seeding loop (STEP I1-10 note 14) below.
    INSERT INTO inventory.positions (warehouse_id, variant_id, quantity_on_hand, total_value, last_known_wac)
    VALUES (v_warehouse_id, v_p1_variant_id, 5000.000, 500000.0000, 100.000000);

    -- P2: sold at 60, WAC 100 (below cost -- feeds the margin-alerts test).
    INSERT INTO catalog.products (name, is_active)
    VALUES ('WSI001 P2 ' || v_suffix, true)
    RETURNING id INTO v_p2_product_id;

    INSERT INTO catalog.product_variants (product_id, base_unit_id, sku, sale_price, is_active)
    VALUES (v_p2_product_id, v_unit_id, 'SKU-WSI001-P2-' || v_suffix, 60.00, true)
    RETURNING id INTO v_p2_variant_id;

    INSERT INTO inventory.positions (warehouse_id, variant_id, quantity_on_hand, total_value, last_known_wac)
    VALUES (v_warehouse_id, v_p2_variant_id, 50.000, 5000.0000, 100.000000);

    v_customer_json := receivables.create_customer(
        v_admin_token, 'CUS-WSI001-' || v_suffix, 'WSI001 Customer',
        NULL, NULL, NULL, NULL, NULL, true, 5000.00, 30, 60
    );
    v_customer_id := (v_customer_json ->> 'id')::bigint;

    v_session1 := sales.open_cash_session(v_admin_token, v_warehouse_id, v_workstation, 2000.00);

    -- S1 -- day D, cash: P1 x3 @ 500, discount 100 (subtotal 1500, total 1400).
    v_lines := jsonb_build_array(jsonb_build_object('variant_id', v_p1_variant_id, 'quantity', 3.000, 'unit_price', 500.00));
    v_doc_s1 := sales.confirm_cash_sale(
        v_admin_token, md5('wsi001-s1-' || v_suffix)::uuid,
        sha256(convert_to(v_lines::text || ':100.00', 'UTF8')),
        v_session1, v_warehouse_id, v_period_id, v_day_d, v_lines, 100.00
    );

    -- S2 -- day D, cash: P2 x1 @ 60 (below its WAC cost of 100), no discount.
    v_lines := jsonb_build_array(jsonb_build_object('variant_id', v_p2_variant_id, 'quantity', 1.000, 'unit_price', 60.00));
    v_doc_s2 := sales.confirm_cash_sale(
        v_admin_token, md5('wsi001-s2-' || v_suffix)::uuid,
        sha256(convert_to(v_lines::text || ':0.00', 'UTF8')),
        v_session1, v_warehouse_id, v_period_id, v_day_d, v_lines, 0.00
    );

    -- S3 -- day D+1, credit: P1 x2 @ 500.
    v_lines := jsonb_build_array(jsonb_build_object('variant_id', v_p1_variant_id, 'quantity', 2.000, 'unit_price', 500.00));
    v_credit_result := sales.confirm_credit_sale(
        v_admin_token, md5('wsi001-s3-' || v_suffix)::uuid,
        sha256(convert_to(v_lines::text, 'UTF8')),
        v_customer_id, v_warehouse_id, v_period_id, v_day_d1, v_lines, NULL
    );
    v_doc_s3 := (v_credit_result ->> 'document_id')::bigint;

    -- S4 -- day D, cash: P1 x1 @ 500, then cancelled.
    v_lines := jsonb_build_array(jsonb_build_object('variant_id', v_p1_variant_id, 'quantity', 1.000, 'unit_price', 500.00));
    v_doc_s4 := sales.confirm_cash_sale(
        v_admin_token, md5('wsi001-s4-' || v_suffix)::uuid,
        sha256(convert_to(v_lines::text || ':0.00', 'UTF8')),
        v_session1, v_warehouse_id, v_period_id, v_day_d, v_lines, 0.00
    );
    PERFORM sales.void_sale(v_admin_token, v_doc_s4, 'CUSTOMER_CHANGED_MIND', NULL);

    -- =========================================================================
    -- 1. get_sales_summary(D, D+1).
    -- =========================================================================
    v_summary := reports.get_sales_summary(v_admin_token, v_day_d, v_day_d1);
    IF v_summary ->> 'net_sales' <> '2460.00' THEN
        RAISE EXCEPTION 'Assertion failed (1): net_sales expected 2460.00 (1400 + 60 + 1000), got %', v_summary ->> 'net_sales';
    END IF;
    IF v_summary ->> 'discounts' <> '100.00' THEN
        RAISE EXCEPTION 'Assertion failed (1): discounts expected 100.00, got %', v_summary ->> 'discounts';
    END IF;
    IF (v_summary ->> 'sale_count')::int <> 3 THEN
        RAISE EXCEPTION 'Assertion failed (1): sale_count expected 3, got %', v_summary ->> 'sale_count';
    END IF;
    IF (v_summary ->> 'void_count')::int <> 1 OR v_summary ->> 'void_total' <> '500.00' THEN
        RAISE EXCEPTION 'Assertion failed (1): void_count/void_total expected 1/500.00, got %/%', v_summary ->> 'void_count', v_summary ->> 'void_total';
    END IF;
    -- cost = S1 (3u @ P1 WAC 100 = 300.00) + S2 (1u @ P2 WAC 100 = 100.00)
    --      + S3 (2u @ P1 WAC 100 = 200.00) = 600.00. S4 (voided) excluded.
    IF v_summary ->> 'cost' <> '600.00' THEN
        RAISE EXCEPTION 'Assertion failed (1): cost expected 600.00, got %', v_summary ->> 'cost';
    END IF;

    -- =========================================================================
    -- 2. S1's discount shares sum to exactly 100.00.
    -- =========================================================================
    SELECT sum(discount_share) INTO v_discount_sum
    FROM reports._sale_lines(v_day_d, v_day_d1) WHERE document_id = v_doc_s1;
    IF v_discount_sum <> 100.00 THEN
        RAISE EXCEPTION 'Assertion failed (2): S1 discount shares sum to % instead of 100.00', v_discount_sum;
    END IF;

    -- =========================================================================
    -- 3. get_sales_timeseries(D, D+1, 'DAY') has 2 rows; WEEK bucket starts Saturday.
    -- =========================================================================
    v_timeseries := reports.get_sales_timeseries(v_admin_token, v_day_d, v_day_d1, 'DAY');
    IF jsonb_array_length(v_timeseries -> 'rows') <> 2 THEN
        RAISE EXCEPTION 'Assertion failed (3): DAY timeseries expected 2 rows, got %', jsonb_array_length(v_timeseries -> 'rows');
    END IF;
    v_timeseries := reports.get_sales_timeseries(v_admin_token, v_day_d, v_day_d1, 'WEEK');
    IF extract(isodow FROM (v_timeseries -> 'rows' -> 0 ->> 'bucket_start')::date) <> 6 THEN
        RAISE EXCEPTION 'Assertion failed (3): WEEK bucket does not start on a Saturday: %', v_timeseries -> 'rows' -> 0 ->> 'bucket_start';
    END IF;

    -- =========================================================================
    -- 4. get_sales_by_product totals equal the summary's totals.
    -- =========================================================================
    v_by_product := reports.get_sales_by_product(v_admin_token, v_day_d, v_day_d1, 'REVENUE', NULL, 50, 0);
    IF v_by_product -> 'totals' ->> 'net_revenue' <> v_summary ->> 'net_sales' THEN
        RAISE EXCEPTION 'Assertion failed (4): by-product net_revenue total % <> summary net_sales %',
            v_by_product -> 'totals' ->> 'net_revenue', v_summary ->> 'net_sales';
    END IF;
    IF v_by_product -> 'totals' ->> 'cost' <> v_summary ->> 'cost' THEN
        RAISE EXCEPTION 'Assertion failed (4): by-product cost total % <> summary cost %',
            v_by_product -> 'totals' ->> 'cost', v_summary ->> 'cost';
    END IF;
    IF v_by_product -> 'totals' ->> 'gross_profit' <> v_summary ->> 'gross_profit' THEN
        RAISE EXCEPTION 'Assertion failed (4): by-product gross_profit total % <> summary gross_profit %',
            v_by_product -> 'totals' ->> 'gross_profit', v_summary ->> 'gross_profit';
    END IF;

    -- =========================================================================
    -- 5. get_sales_by_category share percentages sum to ~100%.
    -- =========================================================================
    SELECT sum((row ->> 'share_pct')::numeric) INTO v_share
    FROM jsonb_array_elements(reports.get_sales_by_category(v_admin_token, v_day_d, v_day_d1) -> 'rows') row;
    IF v_share < 99.9 OR v_share > 100.1 THEN
        RAISE EXCEPTION 'Assertion failed (5): category share percentages sum to % (expected ~100)', v_share;
    END IF;

    -- =========================================================================
    -- 6. get_sales_by_cashier returns the posting user's username.
    -- =========================================================================
    v_by_cashier := reports.get_sales_by_cashier(v_admin_token, v_day_d, v_day_d1);
    IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_by_cashier -> 'rows') row
        WHERE row ->> 'username' = v_admin_username
    ) THEN
        RAISE EXCEPTION 'Assertion failed (6): admin username missing from get_sales_by_cashier: %', v_by_cashier;
    END IF;

    -- =========================================================================
    -- 7. get_sales_by_hour always returns 168 rows.
    -- =========================================================================
    v_by_hour := reports.get_sales_by_hour(v_admin_token, v_day_d, v_day_d1);
    IF jsonb_array_length(v_by_hour -> 'rows') <> 168 THEN
        RAISE EXCEPTION 'Assertion failed (7): get_sales_by_hour expected 168 rows, got %', jsonb_array_length(v_by_hour -> 'rows');
    END IF;

    -- =========================================================================
    -- 8. get_margin_alerts lists P2 with below_cost_lines >= 1.
    -- =========================================================================
    v_margin_alerts := reports.get_margin_alerts(v_admin_token, v_day_d, v_day_d1, 5);
    IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_margin_alerts -> 'rows') row
        WHERE (row ->> 'variant_id')::bigint = v_p2_variant_id AND (row ->> 'below_cost_lines')::int >= 1
    ) THEN
        RAISE EXCEPTION 'Assertion failed (8): P2 missing from margin alerts or below_cost_lines < 1: %', v_margin_alerts;
    END IF;

    -- =========================================================================
    -- 9. The cancelled S4 contributes to no product/summary figure except void_*.
    -- =========================================================================
    SELECT (row ->> 'quantity_base')::numeric INTO v_p1_qty
    FROM jsonb_array_elements(v_by_product -> 'rows') row
    WHERE (row ->> 'variant_id')::bigint = v_p1_variant_id;
    -- S1 (3) + S3 (2) = 5; S4's 1 must NOT be included (it was voided).
    IF v_p1_qty <> 5.000 THEN
        RAISE EXCEPTION 'Assertion failed (9): P1 quantity_base expected 5.000 (S4 must be excluded), got %', v_p1_qty;
    END IF;

    -- =========================================================================
    -- 10. A CASHIER token calling get_sales_summary -> 42501.
    -- =========================================================================
    v_blocked := false;
    BEGIN
        PERFORM reports.get_sales_summary(v_cashier_token, v_day_d, v_day_d1);
    EXCEPTION WHEN SQLSTATE '42501' THEN v_blocked := true;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'Assertion failed (10): a CASHIER token without VIEW_REPORTS could call get_sales_summary';
    END IF;

    -- =========================================================================
    -- 11. p_from > p_to -> 22023; granularity 'YEAR' -> 22023; sort 'FOO' -> 22023.
    -- =========================================================================
    v_blocked := false;
    BEGIN
        PERFORM reports.get_sales_summary(v_admin_token, v_day_d1, v_day_d);
    EXCEPTION WHEN SQLSTATE '22023' THEN v_blocked := true;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'Assertion failed (11a): p_from > p_to was allowed'; END IF;

    v_blocked := false;
    BEGIN
        PERFORM reports.get_sales_timeseries(v_admin_token, v_day_d, v_day_d1, 'YEAR');
    EXCEPTION WHEN SQLSTATE '22023' THEN v_blocked := true;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'Assertion failed (11b): granularity YEAR was allowed'; END IF;

    v_blocked := false;
    BEGIN
        PERFORM reports.get_sales_by_product(v_admin_token, v_day_d, v_day_d1, 'FOO', NULL, 50, 0);
    EXCEPTION WHEN SQLSTATE '22023' THEN v_blocked := true;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'Assertion failed (11c): sort FOO was allowed'; END IF;

    -- =========================================================================
    -- 12. operations.schema_state.migration_version >= 20260927090000.
    -- =========================================================================
    IF (SELECT migration_version FROM operations.schema_state WHERE singleton) < 20260927090000 THEN
        RAISE EXCEPTION 'Assertion failed (12): schema_state.migration_version mismatch';
    END IF;

    -- =========================================================================
    -- 14. Performance: 1,000 sales through the real posting function (R-03/
    -- plan §5, STEP I1-10 note 14 -- direct bulk INSERT into
    -- core.business_documents/sales.cash_sales/sales.cash_sale_lines would
    -- have to hand-satisfy document numbering, idempotency, and posting
    -- invariants the SECURITY DEFINER function itself enforces; looping the
    -- real function is the plan's own sanctioned fallback), then EXPLAIN
    -- ANALYZE every public function over a 365-day period.
    -- =========================================================================
    FOR v_i IN 1..1000 LOOP
        v_lines := jsonb_build_array(jsonb_build_object('variant_id', v_p1_variant_id, 'quantity', 1.000, 'unit_price', 500.00));
        PERFORM sales.confirm_cash_sale(
            v_admin_token, md5('wsi001-perf-' || v_suffix || '-' || v_i)::uuid,
            sha256(convert_to(v_lines::text || ':0.00', 'UTF8')),
            v_session1, v_warehouse_id, v_period_id, current_date, v_lines, 0.00
        );
    END LOOP;

    FOR v_explain IN
        SELECT unnest(ARRAY[
            format('EXPLAIN (ANALYZE, TIMING OFF, SUMMARY ON) SELECT reports.get_sales_summary(%L, %L, %L)', v_admin_token, current_date - 365, current_date),
            format('EXPLAIN (ANALYZE, TIMING OFF, SUMMARY ON) SELECT reports.get_sales_timeseries(%L, %L, %L, %L)', v_admin_token, current_date - 365, current_date, 'DAY'),
            format('EXPLAIN (ANALYZE, TIMING OFF, SUMMARY ON) SELECT reports.get_sales_by_product(%L, %L, %L, %L, NULL, 50, 0)', v_admin_token, current_date - 365, current_date, 'REVENUE'),
            format('EXPLAIN (ANALYZE, TIMING OFF, SUMMARY ON) SELECT reports.get_sales_by_category(%L, %L, %L)', v_admin_token, current_date - 365, current_date),
            format('EXPLAIN (ANALYZE, TIMING OFF, SUMMARY ON) SELECT reports.get_sales_by_cashier(%L, %L, %L)', v_admin_token, current_date - 365, current_date),
            format('EXPLAIN (ANALYZE, TIMING OFF, SUMMARY ON) SELECT reports.get_sales_by_hour(%L, %L, %L)', v_admin_token, current_date - 365, current_date),
            format('EXPLAIN (ANALYZE, TIMING OFF, SUMMARY ON) SELECT reports.get_margin_alerts(%L, %L, %L, 5)', v_admin_token, current_date - 365, current_date)
        ])
    LOOP
        DECLARE
            v_plan_line text;
        BEGIN
            FOR v_plan_line IN EXECUTE v_explain LOOP
                IF v_plan_line LIKE 'Execution Time:%' THEN
                    RAISE NOTICE '[WS-I-001 perf] % -> %', left(v_explain, 70), v_plan_line;
                END IF;
            END LOOP;
        END;
    END LOOP;

    RAISE NOTICE '=== WS-I-001 sales reports integration suite completed successfully ===';
END;
$$;

-- =============================================================================
-- 13. Re-applying the migration file a second time raises no error.
-- =============================================================================
\i src-tauri/migrations/20260927090000_ws_i_001_sales_reports.sql
