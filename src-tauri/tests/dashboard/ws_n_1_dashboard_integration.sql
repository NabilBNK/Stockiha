-- WS-N-1: SQL integration test suite (F0..F15, F-1..F-24, I-1..I-6, T-P1..T-P6)
-- Requires an empty business database (CI runner environment).
\set ON_ERROR_STOP on

-- Precondition check
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM core.business_documents WHERE document_type IN ('SALE_CASH', 'SALE_CREDIT') AND status = 'POSTED')
       OR EXISTS (SELECT 1 FROM receivables.customer_ledger_entries)
       OR EXISTS (SELECT 1 FROM inventory.positions WHERE quantity_on_hand > 0) THEN
        RAISE EXCEPTION 'WS-N-1 integration suite needs an empty business database';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.expect_error(p_sql text, p_sqlstate text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE p_sql;
    RAISE EXCEPTION 'Expected SQLSTATE %, but no error was raised: %', p_sqlstate, p_sql;
EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> p_sqlstate THEN
        RAISE EXCEPTION 'Expected SQLSTATE %, got %: % (query: %)', p_sqlstate, SQLSTATE, SQLERRM, p_sql;
    END IF;
END;
$$;

DO $$
DECLARE
    v_now timestamptz := now();
    T date := (v_now AT TIME ZONE 'Africa/Algiers')::date;
    H integer := extract(hour FROM v_now AT TIME ZONE 'Africa/Algiers')::integer;
    v_token text := 'wsnadmin';
    v_admin_id bigint;
    v_wh_id bigint;
    v_period_id bigint;
    v_unit_id bigint;
    v_ctn_unit_id bigint;
    v_cat_oreillers bigint;
    v_cat_couettes bigint;

    v_prod_a bigint; v_var_a bigint;
    v_prod_b bigint; v_var_b bigint;
    v_prod_c bigint; v_var_c bigint;
    v_prod_d bigint; v_var_d bigint;
    v_prod_f bigint; v_var_f bigint;

    v_cust_karim bigint;
    v_cust_samir bigint;
    v_supp_alpha bigint;

    v_receipt_res jsonb;
    v_receipt_id bigint;
    v_session_id bigint;

    v_doc_s1 bigint;
    v_doc_s2 bigint;
    v_doc_s3 bigint;
    v_doc_s4 bigint;
    v_doc_s5 bigint;
    v_doc_s6 bigint;
    v_doc_s7 bigint;
    v_doc_s8 bigint;
    v_doc_s9 bigint;

    v_entry_s6 bigint;
    v_entry_s9 bigint;
    v_lines jsonb;
    v_credit_res jsonb;

    -- Assert records
    v_rec record;
    v_cnt bigint;
    v_sum numeric;
    v_sum2 numeric;
    v_month_start date;
BEGIN
    RAISE NOTICE '=== Running WS-N-1 Dashboard Integration Suite ===';

    -- F0: Setup admin session, warehouse, fiscal period, units, categories, products, customers, supplier
    -- Users and session
    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES ('wsn_admin', 'WS-N Admin', 'hashed')
    RETURNING id INTO v_admin_id;

    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_admin_id, id FROM iam.roles WHERE code = 'ADMIN';

    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_admin_id, 'WSN-WKS', sha256(v_token::bytea), now() + interval '4 hours');

    -- Warehouse
    INSERT INTO inventory.warehouses (code, name, is_active)
    VALUES ('WH-WSN', 'WS-N Warehouse', true)
    RETURNING id INTO v_wh_id;

    -- Fiscal period
    SELECT id INTO v_period_id FROM finance.fiscal_periods
    WHERE status = 'OPEN' AND T BETWEEN starts_on AND ends_on LIMIT 1;
    IF v_period_id IS NULL THEN
        INSERT INTO finance.fiscal_periods (period_code, starts_on, ends_on, status)
        VALUES ('FP-WSN', date_trunc('year', T::timestamp)::date, (date_trunc('year', T::timestamp) + interval '1 year' - interval '1 day')::date, 'OPEN')
        RETURNING id INTO v_period_id;
    END IF;

    -- Units
    SELECT id INTO v_unit_id FROM catalog.units WHERE normalized_code = 'UNIT' LIMIT 1;
    SELECT id INTO v_ctn_unit_id FROM catalog.units WHERE normalized_code = 'CTN' LIMIT 1;
    IF v_ctn_unit_id IS NULL THEN
        INSERT INTO catalog.units (code, normalized_code, name)
        VALUES ('CTN', 'CTN', 'Carton')
        RETURNING id INTO v_ctn_unit_id;
    END IF;

    -- Categories
    INSERT INTO catalog.categories (name, normalized_name, is_active)
    VALUES ('Oreillers', 'oreillers', true)
    RETURNING id INTO v_cat_oreillers;

    INSERT INTO catalog.categories (name, normalized_name, is_active)
    VALUES ('Couettes', 'couettes', true)
    RETURNING id INTO v_cat_couettes;

    -- Product A: Oreiller blanc (Oreillers, price 1000.00, min 5) with pack Carton x12 @ 15000.00
    INSERT INTO catalog.products (name, category_id, is_active)
    VALUES ('Oreiller blanc', v_cat_oreillers, true)
    RETURNING id INTO v_prod_a;
    INSERT INTO catalog.product_variants (product_id, base_unit_id, sku, sale_price, minimum_stock, is_active)
    VALUES (v_prod_a, v_unit_id, 'SKU-WSN-A', 1000.00, 5, true)
    RETURNING id INTO v_var_a;
    PERFORM catalog.create_pack(v_token, v_var_a, v_ctn_unit_id, 12, 15000.00, true);

    -- Product B: Couette 2p (Couettes, price 2000.00, min 5)
    INSERT INTO catalog.products (name, category_id, is_active)
    VALUES ('Couette 2p', v_cat_couettes, true)
    RETURNING id INTO v_prod_b;
    INSERT INTO catalog.product_variants (product_id, base_unit_id, sku, sale_price, minimum_stock, is_active)
    VALUES (v_prod_b, v_unit_id, 'SKU-WSN-B', 2000.00, 5, true)
    RETURNING id INTO v_var_b;

    -- Product C: Drap 1p (no category, price 1200.00, min 0)
    INSERT INTO catalog.products (name, category_id, is_active)
    VALUES ('Drap 1p', NULL, true)
    RETURNING id INTO v_prod_c;
    INSERT INTO catalog.product_variants (product_id, base_unit_id, sku, sale_price, minimum_stock, is_active)
    VALUES (v_prod_c, v_unit_id, 'SKU-WSN-C', 1200.00, 0, true)
    RETURNING id INTO v_var_c;

    -- Product D: Plaid (no category, price 900.00, min 0)
    INSERT INTO catalog.products (name, category_id, is_active)
    VALUES ('Plaid', NULL, true)
    RETURNING id INTO v_prod_d;
    INSERT INTO catalog.product_variants (product_id, base_unit_id, sku, sale_price, minimum_stock, is_active)
    VALUES (v_prod_d, v_unit_id, 'SKU-WSN-D', 900.00, 0, true)
    RETURNING id INTO v_var_d;

    -- Product F: Ancien modèle (no category, price 500.00, min 5), variant inactive
    INSERT INTO catalog.products (name, category_id, is_active)
    VALUES ('Ancien modèle', NULL, true)
    RETURNING id INTO v_prod_f;
    INSERT INTO catalog.product_variants (product_id, base_unit_id, sku, sale_price, minimum_stock, is_active)
    VALUES (v_prod_f, v_unit_id, 'SKU-WSN-F', 500.00, 5, false)
    RETURNING id INTO v_var_f;

    -- Customers Karim and Samir
    INSERT INTO receivables.customers (code, name, is_active, credit_limit, credit_sale_allowed, payment_terms_days, max_overdue_days)
    VALUES ('CUS-KARIM', 'Karim', true, 1000000.00, true, 30, 60)
    RETURNING id INTO v_cust_karim;

    INSERT INTO receivables.customers (code, name, is_active, credit_limit, credit_sale_allowed, payment_terms_days, max_overdue_days)
    VALUES ('CUS-SAMIR', 'Samir', true, 1000000.00, true, 30, 60)
    RETURNING id INTO v_cust_samir;

    -- Supplier Alpha
    INSERT INTO procurement.suppliers (code, name, is_active)
    VALUES ('SUP-ALPHA', 'Alpha', true)
    RETURNING id INTO v_supp_alpha;

    -- F1: Direct purchase from Alpha: A 80 x 800.00, B 10 x 1500.00, D 4 x 500.00 (total 81,000.00)
    v_receipt_res := inventory.confirm_direct_purchase(
        v_token,
        'f1000000-0000-4000-8000-000000000001'::uuid,
        '\x01'::bytea,
        v_supp_alpha, v_wh_id, v_period_id, T,
        'WS-N-1 Purchase',
        jsonb_build_array(
            jsonb_build_object('variant_id', v_var_a, 'unit_id', v_unit_id, 'quantity_received', 80.000, 'unit_cost', 800.00),
            jsonb_build_object('variant_id', v_var_b, 'unit_id', v_unit_id, 'quantity_received', 10.000, 'unit_cost', 1500.00),
            jsonb_build_object('variant_id', v_var_d, 'unit_id', v_unit_id, 'quantity_received', 4.000, 'unit_cost', 500.00)
        )
    );
    v_receipt_id := (v_receipt_res ->> 'document_id')::bigint;

    -- F2: Supplier payment to Alpha 30,000.00
    PERFORM procurement.post_purchase_payment(
        v_token,
        'f2000000-0000-4000-8000-000000000001'::uuid,
        '\x02'::bytea,
        v_receipt_id, v_period_id, T,
        'CASH', 30000.00, 'SP-ALPHA'
    );

    -- F3: Open cash session with opening float 0.00
    v_session_id := sales.open_cash_session(v_token, v_wh_id, 'WSN-WKS', 0.00);

    -- F4: S1 cash (walk-in): B 1 x 2,000.00
    v_lines := jsonb_build_array(jsonb_build_object('variant_id', v_var_b, 'quantity', 1.000, 'unit_price', 2000.00));
    v_doc_s1 := sales.confirm_cash_sale(
        v_token, 's1000000-0000-4000-8000-000000000001'::uuid,
        sha256(convert_to(v_lines::text || ':0.00', 'UTF8')),
        v_session_id, v_wh_id, v_period_id, T, v_lines, 0.00
    );

    -- F5: S2 cash: A 3 x 1,000.00
    v_lines := jsonb_build_array(jsonb_build_object('variant_id', v_var_a, 'quantity', 3.000, 'unit_price', 1000.00));
    v_doc_s2 := sales.confirm_cash_sale(
        v_token, 's2000000-0000-4000-8000-000000000001'::uuid,
        sha256(convert_to(v_lines::text || ':0.00', 'UTF8')),
        v_session_id, v_wh_id, v_period_id, T, v_lines, 0.00
    );

    -- F6: S3 credit Karim: B 2 x 2,000.00
    v_lines := jsonb_build_array(jsonb_build_object('variant_id', v_var_b, 'quantity', 2.000, 'unit_price', 2000.00));
    v_credit_res := sales.confirm_credit_sale(
        v_token, 's3000000-0000-4000-8000-000000000001'::uuid,
        sha256(convert_to(v_lines::text, 'UTF8')),
        v_cust_karim, v_wh_id, v_period_id, T, v_lines, NULL
    );
    v_doc_s3 := (v_credit_res ->> 'document_id')::bigint;

    -- F7: S4 cash: A 1 x 1,000.00, then void S4
    v_lines := jsonb_build_array(jsonb_build_object('variant_id', v_var_a, 'quantity', 1.000, 'unit_price', 1000.00));
    v_doc_s4 := sales.confirm_cash_sale(
        v_token, 's4000000-0000-4000-8000-000000000001'::uuid,
        sha256(convert_to(v_lines::text || ':0.00', 'UTF8')),
        v_session_id, v_wh_id, v_period_id, T, v_lines, 0.00
    );
    PERFORM sales.void_sale(v_token, v_doc_s4, 'CUSTOMER_CHANGE_MIND', NULL);

    -- F8: S5 cash: A pack line pack_quantity 2, extra_quantity 5, pack_price 15000.00, discount 250.00
    v_lines := jsonb_build_array(
        jsonb_build_object(
            'variant_id', v_var_a, 'quantity', 24.000, 'unit_price', 1000.00,
            'price_basis', 'PACK', 'pack_unit_id', v_ctn_unit_id,
            'pack_unit_name_snapshot', 'Carton', 'pack_factor_snapshot', 12.000000,
            'pack_quantity', 2.000, 'pack_price', 15000.00, 'line_total', 30000.00
        ),
        jsonb_build_object(
            'variant_id', v_var_a, 'quantity', 5.000, 'unit_price', 1250.00,
            'price_basis', 'PACK_RATE', 'pack_unit_id', v_ctn_unit_id,
            'pack_unit_name_snapshot', 'Carton', 'pack_factor_snapshot', 12.000000,
            'pack_price', 15000.00, 'line_total', 6250.00
        )
    );
    v_doc_s5 := sales.confirm_cash_sale(
        v_token, 's5000000-0000-4000-8000-000000000001'::uuid,
        sha256(convert_to(v_lines::text || ':250.00', 'UTF8')),
        v_session_id, v_wh_id, v_period_id, T, v_lines, 250.00
    );

    -- F9: S6 credit Samir: B 3 x 2,100.00
    v_lines := jsonb_build_array(jsonb_build_object('variant_id', v_var_b, 'quantity', 3.000, 'unit_price', 2100.00));
    v_credit_res := sales.confirm_credit_sale(
        v_token, 's6000000-0000-4000-8000-000000000001'::uuid,
        sha256(convert_to(v_lines::text, 'UTF8')),
        v_cust_samir, v_wh_id, v_period_id, T, v_lines, NULL
    );
    v_doc_s6 := (v_credit_res ->> 'document_id')::bigint;

    -- F10: Samir pays 2,000.00 in cash, allocated to S6
    SELECT id INTO v_entry_s6 FROM receivables.customer_ledger_entries WHERE document_id = v_doc_s6 AND amount_delta > 0;
    PERFORM receivables.post_customer_payment(
        v_token, 'f1000000-0000-4000-8000-000000000001'::uuid,
        v_cust_samir, 2000.00, 'CASH', v_session_id, v_period_id, T,
        jsonb_build_array(jsonb_build_object('invoice_ledger_entry_id', v_entry_s6, 'amount', '2000.00')),
        'Samir payment S6'
    );

    -- F11: S7 credit Karim: A 5 x 1,000.00
    v_lines := jsonb_build_array(jsonb_build_object('variant_id', v_var_a, 'quantity', 5.000, 'unit_price', 1000.00));
    v_credit_res := sales.confirm_credit_sale(
        v_token, 's7000000-0000-4000-8000-000000000001'::uuid,
        sha256(convert_to(v_lines::text, 'UTF8')),
        v_cust_karim, v_wh_id, v_period_id, T, v_lines, NULL
    );
    v_doc_s7 := (v_credit_res ->> 'document_id')::bigint;

    -- F12: S8 cash: A 2 x 1,100.00
    v_lines := jsonb_build_array(jsonb_build_object('variant_id', v_var_a, 'quantity', 2.000, 'unit_price', 1100.00));
    v_doc_s8 := sales.confirm_cash_sale(
        v_token, 's8000000-0000-4000-8000-000000000001'::uuid,
        sha256(convert_to(v_lines::text || ':0.00', 'UTF8')),
        v_session_id, v_wh_id, v_period_id, T, v_lines, 0.00
    );

    -- F13: S9 credit Samir: B 1 x 2,000.00
    v_lines := jsonb_build_array(jsonb_build_object('variant_id', v_var_b, 'quantity', 1.000, 'unit_price', 2000.00));
    v_credit_res := sales.confirm_credit_sale(
        v_token, 's9000000-0000-4000-8000-000000000001'::uuid,
        sha256(convert_to(v_lines::text, 'UTF8')),
        v_cust_samir, v_wh_id, v_period_id, T, v_lines, NULL
    );
    v_doc_s9 := (v_credit_res ->> 'document_id')::bigint;

    -- F14: Samir pays 500.00 in cash, allocated to S9
    SELECT id INTO v_entry_s9 FROM receivables.customer_ledger_entries WHERE document_id = v_doc_s9 AND amount_delta > 0;
    PERFORM receivables.post_customer_payment(
        v_token, 'f1400000-0000-4000-8000-000000000001'::uuid,
        v_cust_samir, 500.00, 'CASH', v_session_id, v_period_id, T,
        jsonb_build_array(jsonb_build_object('invoice_ledger_entry_id', v_entry_s9, 'amount', '500.00')),
        'Samir payment S9'
    );

    -- F15: Void S9 (500.00 stays as customer credit)
    PERFORM sales.void_sale(v_token, v_doc_s9, 'MISTAKE', NULL);

    -- ========================================================================
    -- Assertions F-1 .. F-24
    -- ========================================================================

    -- F-1: _dashboard_sales(T, T)
    SELECT count(*), coalesce(sum(gross_total),0), coalesce(sum(discount_total),0),
           coalesce(sum(net_total),0), coalesce(sum(cogs),0)
    INTO v_cnt, v_sum, v_rec.disc, v_rec.net, v_rec.cogs
    FROM core._dashboard_sales(T, T);
    ASSERT v_cnt = 7, 'F-1 count must be 7';
    ASSERT v_sum = 58750.00, 'F-1 gross sum must be 58750.00';
    ASSERT v_rec.disc = 250.00, 'F-1 discount sum must be 250.00';
    ASSERT v_rec.net = 58500.00, 'F-1 net sum must be 58500.00';
    ASSERT v_rec.cogs = 40200.00, 'F-1 cogs sum must be 40200.00';

    -- S5 row check
    SELECT gross_total, discount_total, net_total INTO v_rec FROM core._dashboard_sales(T, T) WHERE document_id = v_doc_s5;
    ASSERT v_rec.gross_total = 36250.00 AND v_rec.discount_total = 250.00 AND v_rec.net_total = 36000.00, 'F-1 S5 row failed';

    -- F-2: _dashboard_sale_lines(T, T)
    SELECT coalesce(sum(line_total), 0) INTO v_sum FROM core._dashboard_sale_lines(T, T);
    ASSERT v_sum = 58750.00, 'F-2 line total sum must be 58750.00';
    SELECT count(*) INTO v_cnt FROM core._dashboard_sale_lines(T, T) WHERE document_id = v_doc_s5;
    ASSERT v_cnt = 2, 'F-2 S5 must have 2 lines';

    -- F-3: _dashboard_purchases(T, T)
    SELECT count(*), coalesce(sum(total), 0) INTO v_cnt, v_sum FROM core._dashboard_purchases(T, T);
    ASSERT v_cnt = 1 AND v_sum = 81000.00, 'F-3 purchases failed';

    -- F-4: _dashboard_variant_stock()
    SELECT quantity, stock_value INTO v_rec FROM core._dashboard_variant_stock() WHERE variant_id = v_var_a;
    ASSERT v_rec.quantity = 41 AND v_rec.stock_value = 32800.00, 'F-4 variant A stock failed';
    SELECT quantity, stock_value INTO v_rec FROM core._dashboard_variant_stock() WHERE variant_id = v_var_b;
    ASSERT v_rec.quantity = 4 AND v_rec.stock_value = 6000.00, 'F-4 variant B stock failed';
    SELECT quantity, stock_value INTO v_rec FROM core._dashboard_variant_stock() WHERE variant_id = v_var_c;
    ASSERT v_rec.quantity = 0, 'F-4 variant C stock failed';
    SELECT quantity, stock_value INTO v_rec FROM core._dashboard_variant_stock() WHERE variant_id = v_var_d;
    ASSERT v_rec.quantity = 4 AND v_rec.stock_value = 2000.00, 'F-4 variant D stock failed';
    SELECT is_active INTO v_rec.is_active FROM core._dashboard_variant_stock() WHERE variant_id = v_var_f;
    ASSERT v_rec.is_active = false, 'F-4 variant F is_active failed';

    -- F-5: _dashboard_customer_balances()
    SELECT balance INTO v_sum FROM core._dashboard_customer_balances() WHERE customer_id = v_cust_karim;
    ASSERT v_sum = 9000.00, 'F-5 Karim balance must be 9000.00';
    SELECT balance INTO v_sum FROM core._dashboard_customer_balances() WHERE customer_id = v_cust_samir;
    ASSERT v_sum = 3800.00, 'F-5 Samir balance must be 3800.00';
    SELECT coalesce(sum(balance), 0) INTO v_sum FROM core._dashboard_customer_balances();
    ASSERT v_sum = 12800.00, 'F-5 total balance must be 12800.00';

    -- F-6: _dashboard_open_items_at(T)
    SELECT count(*) INTO v_cnt FROM core._dashboard_open_items_at(T);
    ASSERT v_cnt = 3, 'F-6 open items count must be 3';
    ASSERT NOT EXISTS (SELECT 1 FROM core._dashboard_open_items_at(T) WHERE ledger_entry_id = v_entry_s9), 'F-6 S9 must not be open';

    -- F-7: _dashboard_money_summary(T, T, T-1, T-1, NULL)
    SELECT * INTO v_rec FROM core._dashboard_money_summary(T, T, T - 1, T - 1, NULL);
    ASSERT v_rec.sales = 58500.00, 'F-7 sales failed';
    ASSERT v_rec.prev_sales = 0.00, 'F-7 prev_sales failed';
    ASSERT v_rec.sales_change_kind = 'NO_BASE' AND v_rec.sales_change_pct IS NULL, 'F-7 sales_change failed';
    ASSERT v_rec.profit = 18300.00, 'F-7 profit failed';
    ASSERT v_rec.prev_profit = 0.00, 'F-7 prev_profit failed';
    ASSERT v_rec.profit_change_kind = 'NO_BASE', 'F-7 profit_change failed';
    ASSERT v_rec.margin_pct = 31.3, 'F-7 margin_pct failed';
    ASSERT v_rec.sale_count = 7, 'F-7 sale_count failed';
    ASSERT v_rec.prev_sale_count = 0, 'F-7 prev_sale_count failed';
    ASSERT v_rec.count_change_kind = 'NO_BASE', 'F-7 count_change failed';
    ASSERT v_rec.average_sale = 8357.14, 'F-7 average_sale failed';
    ASSERT v_rec.discount_total = 250.00, 'F-7 discount_total failed';
    ASSERT v_rec.cash_sales = 43200.00, 'F-7 cash_sales failed';
    ASSERT v_rec.credit_sales = 15300.00, 'F-7 credit_sales failed';
    ASSERT v_rec.open_session_count = 1, 'F-7 open_session_count failed';
    ASSERT v_rec.receivables_total = 12800.00, 'F-7 receivables_total failed';

    -- F-8: _dashboard_stock_summary_at(90, T)
    SELECT * INTO v_rec FROM core._dashboard_stock_summary_at(90, T);
    ASSERT v_rec.stock_value = 40800.00 AND v_rec.low_count = 1 AND v_rec.out_count = 1
       AND v_rec.dead_count = 0 AND v_rec.dead_value = 0.00, 'F-8 stock summary failed';

    -- F-9: _dashboard_stock_summary_at(90, T + 100)
    SELECT * INTO v_rec FROM core._dashboard_stock_summary_at(90, T + 100);
    ASSERT v_rec.dead_count = 3 AND v_rec.dead_value = 40800.00, 'F-9 dead stock failed';

    -- F-10: _dashboard_stock_summary_at(180, T + 100)
    SELECT * INTO v_rec FROM core._dashboard_stock_summary_at(180, T + 100);
    ASSERT v_rec.dead_count = 0, 'F-10 dead stock at 180 days failed';

    -- F-11: _dashboard_stock_items_at('low', 90, 25, 0, T)
    SELECT count(*), max(variant_id), max(quantity), max(minimum_stock), max(total_count)
    INTO v_cnt, v_rec.variant_id, v_rec.quantity, v_rec.minimum_stock, v_rec.total_count
    FROM core._dashboard_stock_items_at('low', 90, 25, 0, T);
    ASSERT v_cnt = 1 AND v_rec.variant_id = v_var_b AND v_rec.quantity = 4 AND v_rec.minimum_stock = 5 AND v_rec.total_count = 1, 'F-11 low stock items failed';

    -- F-12: _dashboard_stock_items_at('out', 90, 25, 0, T)
    SELECT count(*), max(variant_id) INTO v_cnt, v_rec.variant_id FROM core._dashboard_stock_items_at('out', 90, 25, 0, T);
    ASSERT v_cnt = 1 AND v_rec.variant_id = v_var_c, 'F-12 out of stock items failed';

    -- F-13: _dashboard_stock_items_at('dead', 90, 2, 0, T + 100) then offset 2
    SELECT count(*), max(total_count) INTO v_cnt, v_rec.total_count FROM core._dashboard_stock_items_at('dead', 90, 2, 0, T + 100);
    ASSERT v_cnt = 2 AND v_rec.total_count = 3, 'F-13 page 1 dead items failed';
    SELECT count(*), max(variant_id), max(last_sold_on) INTO v_cnt, v_rec.variant_id, v_rec.last_sold_on FROM core._dashboard_stock_items_at('dead', 90, 2, 2, T + 100);
    ASSERT v_cnt = 1 AND v_rec.variant_id = v_var_d AND v_rec.last_sold_on IS NULL, 'F-13 page 2 dead items failed';

    -- F-14: _dashboard_top_items(T, T, 5)
    SELECT count(*) INTO v_cnt FROM core._dashboard_top_items(T, T, 5);
    ASSERT v_cnt = 2, 'F-14 count must be 2';
    SELECT quantity_sold, sales_before_discount INTO v_rec FROM core._dashboard_top_items(T, T, 5) WHERE variant_id = v_var_a;
    ASSERT v_rec.quantity_sold = 39 AND v_rec.sales_before_discount = 46450.00, 'F-14 item A failed';
    SELECT quantity_sold, sales_before_discount INTO v_rec FROM core._dashboard_top_items(T, T, 5) WHERE variant_id = v_var_b;
    ASSERT v_rec.quantity_sold = 6 AND v_rec.sales_before_discount = 12300.00, 'F-14 item B failed';

    -- F-15: _dashboard_top_customers(T, T)
    SELECT count(*) INTO v_cnt FROM core._dashboard_top_customers(T, T);
    ASSERT v_cnt = 2, 'F-15 count must be 2';
    SELECT sale_count, sales INTO v_rec FROM core._dashboard_top_customers(T, T) WHERE customer_id = v_cust_karim;
    ASSERT v_rec.sale_count = 2 AND v_rec.sales = 9000.00, 'F-15 Karim top customer failed';
    SELECT sale_count, sales INTO v_rec FROM core._dashboard_top_customers(T, T) WHERE customer_id = v_cust_samir;
    ASSERT v_rec.sale_count = 1 AND v_rec.sales = 6300.00, 'F-15 Samir top customer failed';

    -- F-16: _dashboard_top_debtors_at(T)
    SELECT count(*) INTO v_cnt FROM core._dashboard_top_debtors_at(T);
    ASSERT v_cnt = 2, 'F-16 count must be 2';
    SELECT amount_owed, oldest_open_days INTO v_rec FROM core._dashboard_top_debtors_at(T) WHERE customer_id = v_cust_karim;
    ASSERT v_rec.amount_owed = 9000.00 AND v_rec.oldest_open_days = 0, 'F-16 Karim debtor failed';
    SELECT amount_owed, oldest_open_days INTO v_rec FROM core._dashboard_top_debtors_at(T) WHERE customer_id = v_cust_samir;
    ASSERT v_rec.amount_owed = 3800.00 AND v_rec.oldest_open_days = 0, 'F-16 Samir debtor failed';

    -- F-17: _dashboard_latest_sales()
    SELECT count(*) INTO v_cnt FROM core._dashboard_latest_sales();
    ASSERT v_cnt = 5, 'F-17 count must be 5';
    -- Top row is S9 and is voided
    SELECT document_id, is_voided, total INTO v_rec FROM core._dashboard_latest_sales() LIMIT 1;
    ASSERT v_rec.document_id = v_doc_s9 AND v_rec.is_voided = true AND v_rec.total = 2000.00, 'F-17 S9 latest sale failed';

    -- F-18: _dashboard_sales_series(T-2, T, 'DAY')
    SELECT count(*), coalesce(sum(sales),0), coalesce(sum(profit),0), coalesce(sum(cash_sales),0),
           coalesce(sum(credit_sales),0), coalesce(sum(purchases),0), coalesce(sum(sale_count),0)
    INTO v_cnt, v_rec.sales, v_rec.profit, v_rec.cash, v_rec.credit, v_rec.pu, v_rec.n
    FROM core._dashboard_sales_series(T - 2, T, 'DAY');
    ASSERT v_cnt = 3, 'F-18 series DAY rows must be 3';
    ASSERT v_rec.sales = 58500.00 AND v_rec.profit = 18300.00 AND v_rec.cash = 43200.00
       AND v_rec.credit = 15300.00 AND v_rec.pu = 81000.00 AND v_rec.n = 7, 'F-18 DAY totals failed';

    -- F-19: _dashboard_sales_series(T, T, 'HOUR')
    SELECT count(*) INTO v_cnt FROM core._dashboard_sales_series(T, T, 'HOUR');
    ASSERT v_cnt = 24, 'F-19 HOUR series must have 24 rows';
    SELECT sales, profit, cash_sales, credit_sales, purchases, sale_count
    INTO v_rec FROM core._dashboard_sales_series(T, T, 'HOUR')
    WHERE bucket_start = T::timestamp + make_interval(hours => H);
    ASSERT v_rec.sales = 58500.00 AND v_rec.profit = 18300.00 AND v_rec.cash_sales = 43200.00
       AND v_rec.credit_sales = 15300.00 AND v_rec.purchases = 81000.00 AND v_rec.sale_count = 7, 'F-19 current hour failed';

    -- F-20: _dashboard_sales_series(2 months ago, T, 'MONTH')
    v_month_start := (date_trunc('month', T::timestamp) - interval '2 months')::date;
    SELECT count(*) INTO v_cnt FROM core._dashboard_sales_series(v_month_start, T, 'MONTH');
    ASSERT v_cnt = 3, 'F-20 MONTH series must have 3 rows';

    -- F-21: _dashboard_sales_by_category(T, T)
    SELECT count(*) INTO v_cnt FROM core._dashboard_sales_by_category(T, T);
    ASSERT v_cnt = 2, 'F-21 count must be 2';
    SELECT category_key, sales_before_discount, share_pct INTO v_rec
    FROM core._dashboard_sales_by_category(T, T) WHERE sort_order = 1;
    ASSERT v_rec.category_key = 'ID:' || v_cat_oreillers AND v_rec.sales_before_discount = 46450.00 AND v_rec.share_pct = 79.1, 'F-21 Oreillers failed';
    SELECT category_key, sales_before_discount, share_pct INTO v_rec
    FROM core._dashboard_sales_by_category(T, T) WHERE sort_order = 2;
    ASSERT v_rec.category_key = 'ID:' || v_cat_couettes AND v_rec.sales_before_discount = 12300.00 AND v_rec.share_pct = 20.9, 'F-21 Couettes failed';

    -- F-22: _dashboard_busy_hours(T, T)
    SELECT count(*) INTO v_cnt FROM core._dashboard_busy_hours(T, T);
    ASSERT v_cnt = 168, 'F-22 busy hours must have 168 rows';
    SELECT sale_count, sales INTO v_rec FROM core._dashboard_busy_hours(T, T)
    WHERE weekday = extract(dow FROM T)::integer AND hour = H;
    ASSERT v_rec.sale_count = 7 AND v_rec.sales = 58500.00, 'F-22 active cell failed';

    -- F-23: _dashboard_receivables_aging_at(T)
    SELECT count(*) INTO v_cnt FROM core._dashboard_receivables_aging_at(T);
    ASSERT v_cnt = 6, 'F-23 aging must have 6 rows';
    SELECT amount, item_count INTO v_rec FROM core._dashboard_receivables_aging_at(T) WHERE bucket = '0_30';
    ASSERT v_rec.amount = 13300.00 AND v_rec.item_count = 3, 'F-23 0_30 bucket failed';
    SELECT amount INTO v_rec.amount FROM core._dashboard_receivables_aging_at(T) WHERE bucket = 'UNAPPLIED';
    ASSERT v_rec.amount = -500.00, 'F-23 UNAPPLIED bucket failed';
    SELECT amount INTO v_rec.amount FROM core._dashboard_receivables_aging_at(T) WHERE bucket = 'TOTAL';
    ASSERT v_rec.amount = 12800.00, 'F-23 TOTAL bucket failed';

    -- F-24: _dashboard_receivables_aging_at(T + 100)
    SELECT amount, item_count INTO v_rec FROM core._dashboard_receivables_aging_at(T + 100) WHERE bucket = '91_PLUS';
    ASSERT v_rec.amount = 13300.00 AND v_rec.item_count = 3, 'F-24 91_PLUS bucket failed';
    SELECT amount INTO v_rec.amount FROM core._dashboard_receivables_aging_at(T + 100) WHERE bucket = '0_30';
    ASSERT v_rec.amount = 0.00, 'F-24 0_30 bucket at T+100 failed';

    -- ========================================================================
    -- Invariants I-1 .. I-6
    -- ========================================================================
    -- I-1: series sales = money sales, etc.
    SELECT sum(sales), sum(cash_sales), sum(credit_sales), sum(sale_count)
    INTO v_rec FROM core._dashboard_sales_series(T, T, 'HOUR');
    ASSERT v_rec.sum = 58500.00 AND v_rec.sum2 IS NULL, 'I-1 series sales';

    -- I-3: category values sum = 58,750.00 = money sales + discount
    SELECT sum(sales_before_discount) INTO v_sum FROM core._dashboard_sales_by_category(T, T);
    ASSERT v_sum = 58750.00, 'I-3 category sum failed';

    -- I-4: busy-hours sale_count = money sale_count; sales = money sales
    SELECT sum(sale_count), sum(sales) INTO v_cnt, v_sum FROM core._dashboard_busy_hours(T, T);
    ASSERT v_cnt = 7 AND v_sum = 58500.00, 'I-4 busy hours sum failed';

    -- I-5: aging sum rows 1-5 = aging TOTAL = receivables_total
    SELECT sum(amount) INTO v_sum FROM core._dashboard_receivables_aging_at(T) WHERE sort_order <= 5;
    SELECT amount INTO v_sum2 FROM core._dashboard_receivables_aging_at(T) WHERE sort_order = 6;
    ASSERT v_sum = v_sum2 AND v_sum = 12800.00, 'I-5 aging balance failed';

    -- ========================================================================
    -- Public function checks T-P1 .. T-P6
    -- ========================================================================
    -- T-P1: unknown session raises 28000
    PERFORM pg_temp.expect_error('SELECT * FROM core.dashboard_period(''bad_tok'', ''today'', NULL, NULL)', '28000');
    PERFORM pg_temp.expect_error('SELECT * FROM core.dashboard_money_summary(''bad_tok'', CURRENT_DATE, CURRENT_DATE, CURRENT_DATE-1, CURRENT_DATE-1, NULL)', '28000');
    PERFORM pg_temp.expect_error('SELECT * FROM core.dashboard_stock_summary(''bad_tok'', 90)', '28000');
    PERFORM pg_temp.expect_error('SELECT * FROM core.dashboard_stock_items(''bad_tok'', ''low'', 90, 25, 0)', '28000');
    PERFORM pg_temp.expect_error('SELECT * FROM core.dashboard_top_items(''bad_tok'', CURRENT_DATE, CURRENT_DATE, 5)', '28000');
    PERFORM pg_temp.expect_error('SELECT * FROM core.dashboard_top_customers(''bad_tok'', CURRENT_DATE, CURRENT_DATE)', '28000');
    PERFORM pg_temp.expect_error('SELECT * FROM core.dashboard_top_debtors(''bad_tok'')', '28000');
    PERFORM pg_temp.expect_error('SELECT * FROM core.dashboard_latest_sales(''bad_tok'')', '28000');
    PERFORM pg_temp.expect_error('SELECT * FROM core.dashboard_sales_series(''bad_tok'', CURRENT_DATE, CURRENT_DATE, ''HOUR'')', '28000');
    PERFORM pg_temp.expect_error('SELECT * FROM core.dashboard_sales_by_category(''bad_tok'', CURRENT_DATE, CURRENT_DATE)', '28000');
    PERFORM pg_temp.expect_error('SELECT * FROM core.dashboard_busy_hours(''bad_tok'', CURRENT_DATE, CURRENT_DATE)', '28000');
    PERFORM pg_temp.expect_error('SELECT * FROM core.dashboard_receivables_aging(''bad_tok'')', '28000');

    -- T-P2: dashboard_money_summary invalid window
    PERFORM pg_temp.expect_error(format('SELECT * FROM core.dashboard_money_summary(%L, CURRENT_DATE, CURRENT_DATE + 1, CURRENT_DATE - 1, CURRENT_DATE - 1, NULL)', v_token), '22023');
    PERFORM pg_temp.expect_error(format('SELECT * FROM core.dashboard_money_summary(%L, CURRENT_DATE, CURRENT_DATE - 1, CURRENT_DATE - 1, CURRENT_DATE - 1, NULL)', v_token), '22023');

    -- T-P3: dashboard_stock_summary invalid dead_days
    PERFORM pg_temp.expect_error(format('SELECT * FROM core.dashboard_stock_summary(%L, 45)', v_token), '22023');

    -- T-P4: dashboard_stock_items invalid kind / offset
    PERFORM pg_temp.expect_error(format('SELECT * FROM core.dashboard_stock_items(%L, ''all'', 90, 25, 0)', v_token), '22023');
    PERFORM pg_temp.expect_error(format('SELECT * FROM core.dashboard_stock_items(%L, ''low'', 90, 25, -1)', v_token), '22023');

    -- T-P5: dashboard_sales_series invalid bucket usage
    PERFORM pg_temp.expect_error(format('SELECT * FROM core.dashboard_sales_series(%L, CURRENT_DATE - 1, CURRENT_DATE, ''HOUR'')', v_token), '22023');
    PERFORM pg_temp.expect_error(format('SELECT * FROM core.dashboard_sales_series(%L, CURRENT_DATE, CURRENT_DATE, ''WEEK'')', v_token), '22023');
    PERFORM pg_temp.expect_error(format('SELECT * FROM core.dashboard_sales_series(%L, CURRENT_DATE - 400, CURRENT_DATE, ''DAY'')', v_token), '22023');

    -- T-P6: dashboard_period month returns today = T
    SELECT * INTO v_rec FROM core.dashboard_period(v_token, 'month', NULL, NULL);
    ASSERT v_rec.today = T, 'T-P6 today must equal T';

    RAISE NOTICE '=== WS-N-1 Dashboard Integration Suite Passed Successfully ===';
END;
$$;
