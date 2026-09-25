-- WS-I-002 Integration Test: finance, money owed and accountant reports.
-- Bootstrap pattern copied from src-tauri/tests/sales/ws_f_006_sale_void_integration.sql
-- (users, roles, sessions, warehouse, fiscal period, stock), suffix wsi002.
\set ON_ERROR_STOP on

DO $$
DECLARE
    v_suffix text := floor(random() * 1000000000)::bigint::text;
    v_workstation text := 'WSI002-WKS-' || v_suffix;
    v_admin_username text := 'wsi002_admin_' || v_suffix;
    v_cashier_username text := 'wsi002_cashier_' || v_suffix;
    v_admin_token text := 'wsi002_admin_token_' || v_suffix;
    v_cashier_token text := 'wsi002_cashier_token_' || v_suffix;
    v_admin_id bigint;
    v_cashier_id bigint;
    v_warehouse_id bigint;
    v_period_id bigint;
    v_unit_id bigint;

    v_today date := current_date;
    v_year integer := extract(year FROM current_date)::integer;
    v_month integer := extract(month FROM current_date)::integer;

    v_p1_product_id bigint;
    v_p1_variant_id bigint;

    v_session1 bigint;
    v_lines jsonb;
    v_counts jsonb;
    v_close_res jsonb;

    v_customer1_json jsonb;
    v_customer1_id bigint;
    v_credit_result jsonb;
    v_doc_s bigint;
    v_doc_s_prime bigint;
    v_doc_s_double_prime bigint;
    v_invoice_s_id bigint;
    v_invoice_s_prime_id bigint;
    v_payment_res jsonb;

    v_supplier_id bigint;
    v_receipt_json jsonb;
    v_receipt_id bigint;

    v_cash_account_id bigint;

    v_pnl jsonb;
    v_summary jsonb;
    v_cash_flow jsonb;
    v_monthly jsonb;
    v_aging jsonb;
    v_cust_stmt jsonb;
    v_supp_stmt jsonb;
    v_trial jsonb;
    v_ledger jsonb;
    v_supplier_balances jsonb;
    v_balance_due numeric;

    v_blocked boolean;
BEGIN
    RAISE NOTICE '=== Running WS-I-002 finance reports integration suite ===';

    SELECT id INTO v_period_id
    FROM finance.fiscal_periods
    WHERE status = 'OPEN' AND CURRENT_DATE BETWEEN starts_on AND ends_on
    LIMIT 1;
    IF v_period_id IS NULL THEN
        INSERT INTO finance.fiscal_periods (period_code, starts_on, ends_on, status)
        VALUES ('TESTI2-' || v_suffix, date_trunc('year', CURRENT_DATE)::date, (date_trunc('year', CURRENT_DATE) + interval '1 year' - interval '1 day')::date, 'OPEN')
        RETURNING id INTO v_period_id;
    END IF;

    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES (v_admin_username, 'WSI002 Admin', 'hashed_pass')
    RETURNING id INTO v_admin_id;
    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES (v_cashier_username, 'WSI002 Cashier', 'hashed_pass')
    RETURNING id INTO v_cashier_id;

    INSERT INTO iam.user_roles (user_id, role_id) SELECT v_admin_id, id FROM iam.roles WHERE code = 'ADMIN';
    INSERT INTO iam.user_roles (user_id, role_id) SELECT v_cashier_id, id FROM iam.roles WHERE code = 'CASHIER';

    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at) VALUES
        (v_admin_id, v_workstation, sha256(v_admin_token::bytea), now() + interval '2 hours'),
        (v_cashier_id, v_workstation, sha256(v_cashier_token::bytea), now() + interval '2 hours');

    INSERT INTO inventory.warehouses (code, name)
    VALUES ('WH-WSI002-' || v_suffix, 'WS-I-002 Warehouse')
    RETURNING id INTO v_warehouse_id;

    SELECT id INTO v_unit_id FROM catalog.units WHERE normalized_code = 'UNIT' LIMIT 1;
    IF v_unit_id IS NULL THEN
        SELECT id INTO v_unit_id FROM catalog.units LIMIT 1;
    END IF;

    INSERT INTO catalog.products (name, is_active)
    VALUES ('WSI002 P1 ' || v_suffix, true)
    RETURNING id INTO v_p1_product_id;
    INSERT INTO catalog.product_variants (product_id, base_unit_id, sku, sale_price, is_active)
    VALUES (v_p1_product_id, v_unit_id, 'SKU-WSI002-P1-' || v_suffix, 500.00, true)
    RETURNING id INTO v_p1_variant_id;
    INSERT INTO inventory.positions (warehouse_id, variant_id, quantity_on_hand, total_value, last_known_wac)
    VALUES (v_warehouse_id, v_p1_variant_id, 500.000, 50000.0000, 100.000000);

    -- =========================================================================
    -- Cash session: float 1000, two cash sales, CASH_OUT EXPENSE 500,
    -- CASH_OUT OTHER 50, CASH_IN CHANGE_FLOAT 200, closed 30 below expected.
    -- Admin holds APPROVE_CASH_OUT, so it self-approves (no separate approver).
    -- =========================================================================
    v_session1 := sales.open_cash_session(v_admin_token, v_warehouse_id, v_workstation, 1000.00);

    v_lines := jsonb_build_array(jsonb_build_object('variant_id', v_p1_variant_id, 'quantity', 2.000, 'unit_price', 500.00));
    PERFORM sales.confirm_cash_sale(
        v_admin_token, md5('wsi002-cash1-' || v_suffix)::uuid,
        sha256(convert_to(v_lines::text || ':0.00', 'UTF8')),
        v_session1, v_warehouse_id, v_period_id, v_today, v_lines, 0.00
    );

    v_lines := jsonb_build_array(jsonb_build_object('variant_id', v_p1_variant_id, 'quantity', 1.000, 'unit_price', 500.00));
    PERFORM sales.confirm_cash_sale(
        v_admin_token, md5('wsi002-cash2-' || v_suffix)::uuid,
        sha256(convert_to(v_lines::text || ':0.00', 'UTF8')),
        v_session1, v_warehouse_id, v_period_id, v_today, v_lines, 0.00
    );

    PERFORM cash.record_cash_movement(v_admin_token, v_session1, 'CASH_OUT', 500.00, 'EXPENSE', 'WS-I-002 expense', NULL);
    PERFORM cash.record_cash_movement(v_admin_token, v_session1, 'CASH_OUT', 50.00, 'OTHER', 'WS-I-002 other', NULL);
    PERFORM cash.record_cash_movement(v_admin_token, v_session1, 'CASH_IN', 200.00, 'CHANGE_FLOAT', 'WS-I-002 change float', NULL);

    -- sales.submit_cash_session_count (the function the app actually calls;
    -- see the note by assertion 2 below) sums every movement amount
    -- unsigned, so its own "expected" is 1000 (float) + 1500 (sales)
    -- + 200 (in) + 550 (out, NOT subtracted) = 3250.00. Counted 30 below
    -- that = 3220.00 (3x1000 + 1x200 + 1x20).
    PERFORM sales.begin_cash_session_close(v_admin_token, v_session1);
    SELECT jsonb_agg(
        jsonb_build_object(
            'denomination_id', id,
            'quantity', CASE WHEN code = 'DZD_1000' THEN 3 WHEN code = 'DZD_200' THEN 1 WHEN code = 'DZD_20' THEN 1 ELSE 0 END
        ) ORDER BY display_order
    )
    INTO v_counts
    FROM cash.denominations
    WHERE is_active;
    v_close_res := sales.submit_cash_session_count(v_admin_token, v_session1, v_counts);
    IF v_close_res ->> 'status' <> 'CLOSED' OR (v_close_res ->> 'variance_amount')::numeric <> -30.00 THEN
        RAISE EXCEPTION 'Setup failed: cash session did not close with -30.00 variance: %', v_close_res;
    END IF;

    -- =========================================================================
    -- Customer C1: S (due 45 days ago), S' (paid in full via BANK_TRANSFER),
    -- S'' (unpaid, then voided).
    -- =========================================================================
    v_customer1_json := receivables.create_customer(
        v_admin_token, 'CUS-WSI002-' || v_suffix, 'WSI002 Customer',
        NULL, NULL, NULL, NULL, NULL, true, 5000.00, 30, 60
    );
    v_customer1_id := (v_customer1_json ->> 'id')::bigint;

    -- document_date - 75 + payment_terms_days(30) = document_date's due_date = today - 45.
    v_lines := jsonb_build_array(jsonb_build_object('variant_id', v_p1_variant_id, 'quantity', 1.000, 'unit_price', 500.00));
    v_credit_result := sales.confirm_credit_sale(
        v_admin_token, md5('wsi002-s-' || v_suffix)::uuid,
        sha256(convert_to(v_lines::text, 'UTF8')),
        v_customer1_id, v_warehouse_id, v_period_id, v_today - 75, v_lines, NULL
    );
    v_doc_s := (v_credit_result ->> 'document_id')::bigint;
    SELECT id INTO v_invoice_s_id FROM receivables.customer_ledger_entries
    WHERE document_id = v_doc_s AND entry_type = 'CREDIT_INVOICE';
    IF (SELECT due_date FROM receivables.customer_ledger_entries WHERE id = v_invoice_s_id) <> v_today - 45 THEN
        RAISE EXCEPTION 'Setup failed: S due_date is not exactly 45 days ago: %',
            (SELECT due_date FROM receivables.customer_ledger_entries WHERE id = v_invoice_s_id);
    END IF;

    v_lines := jsonb_build_array(jsonb_build_object('variant_id', v_p1_variant_id, 'quantity', 1.000, 'unit_price', 300.00));
    v_credit_result := sales.confirm_credit_sale(
        v_admin_token, md5('wsi002-sprime-' || v_suffix)::uuid,
        sha256(convert_to(v_lines::text, 'UTF8')),
        v_customer1_id, v_warehouse_id, v_period_id, v_today - 10, v_lines, NULL
    );
    v_doc_s_prime := (v_credit_result ->> 'document_id')::bigint;
    SELECT id INTO v_invoice_s_prime_id FROM receivables.customer_ledger_entries
    WHERE document_id = v_doc_s_prime AND entry_type = 'CREDIT_INVOICE';

    v_payment_res := receivables.post_customer_payment(
        v_admin_token, md5('wsi002-payment-' || v_suffix)::uuid, v_customer1_id, 300.00, 'BANK_TRANSFER', NULL,
        v_period_id, v_today - 9,
        jsonb_build_array(jsonb_build_object('invoice_ledger_entry_id', v_invoice_s_prime_id, 'amount', '300.00')),
        'WS-I-002 full payment'
    );

    v_lines := jsonb_build_array(jsonb_build_object('variant_id', v_p1_variant_id, 'quantity', 1.000, 'unit_price', 200.00));
    v_credit_result := sales.confirm_credit_sale(
        v_admin_token, md5('wsi002-sdouble-' || v_suffix)::uuid,
        sha256(convert_to(v_lines::text, 'UTF8')),
        v_customer1_id, v_warehouse_id, v_period_id, v_today - 5, v_lines, NULL
    );
    v_doc_s_double_prime := (v_credit_result ->> 'document_id')::bigint;
    -- void_sale requires an open cash session (session1 is already closed
    -- above); a second, never-closed session is fine since the whole suite
    -- rolls back.
    PERFORM sales.open_cash_session(v_admin_token, v_warehouse_id, v_workstation, 0.00);
    PERFORM sales.void_sale(v_admin_token, v_doc_s_double_prime, 'CUSTOMER_CHANGED_MIND', NULL);

    -- =========================================================================
    -- Supplier: one POSTED purchase receipt, one purchase payment, one return.
    -- =========================================================================
    INSERT INTO procurement.suppliers (code, name, is_active)
    VALUES ('SUP-WSI002-' || v_suffix, 'WSI002 Supplier', true)
    RETURNING id INTO v_supplier_id;

    v_receipt_json := inventory.confirm_direct_purchase(
        v_admin_token, md5('wsi002-receipt-' || v_suffix)::uuid, '\x01'::bytea,
        v_supplier_id, v_warehouse_id, v_period_id, v_today,
        'WS-I-002 purchase',
        jsonb_build_array(jsonb_build_object('variant_id', v_p1_variant_id, 'unit_id', v_unit_id, 'quantity_received', 10.000, 'unit_cost', 100.00))
    );
    v_receipt_id := (v_receipt_json ->> 'document_id')::bigint;

    PERFORM procurement.post_purchase_payment(
        v_admin_token, md5('wsi002-payment-supplier-' || v_suffix)::uuid, '\x02'::bytea,
        v_receipt_id, v_period_id, v_today, 'CASH', 400.00, 'WSI002-REF'
    );

    PERFORM procurement.confirm_purchase_return(
        v_admin_token, md5('wsi002-return-' || v_suffix)::uuid, '\x03'::bytea,
        v_receipt_id, v_period_id, v_today, 'DEFECTIVE_GOODS', 'WS-I-002 return',
        jsonb_build_array(jsonb_build_object(
            'receipt_line_id', (SELECT id FROM procurement.purchase_receipt_lines WHERE document_id = v_receipt_id ORDER BY line_number LIMIT 1),
            'quantity', 2.000
        ))
    );

    -- finance.accounts.scf_code is the official chart-of-accounts code, a
    -- different vocabulary from finance.account_role_mappings.account_code
    -- (what require_account_role and journal_lines.account_code use) --
    -- resolve account_id via the FK the posting functions actually wrote.
    SELECT DISTINCT account_id INTO v_cash_account_id
    FROM finance.journal_lines
    WHERE account_code = finance.require_account_role('CASH') AND account_id IS NOT NULL
    LIMIT 1;
    IF v_cash_account_id IS NULL THEN
        RAISE EXCEPTION 'Setup failed: no journal_lines row resolves the CASH account role to an account_id';
    END IF;

    -- =========================================================================
    -- 1. get_profit_and_loss(today, today).
    -- =========================================================================
    v_pnl := reports.get_profit_and_loss(v_admin_token, v_today, v_today);
    v_summary := reports.get_sales_summary(v_admin_token, v_today, v_today);
    IF v_pnl ->> 'gross_profit' <> v_summary ->> 'gross_profit' THEN
        RAISE EXCEPTION 'Assertion failed (1a): P&L gross_profit % <> sales summary gross_profit %',
            v_pnl ->> 'gross_profit', v_summary ->> 'gross_profit';
    END IF;
    IF v_pnl ->> 'expenses' <> '500.00' THEN
        RAISE EXCEPTION 'Assertion failed (1b): expenses expected 500.00, got %', v_pnl ->> 'expenses';
    END IF;
    IF v_pnl ->> 'other_cash_out' <> '50.00' THEN
        RAISE EXCEPTION 'Assertion failed (1c): other_cash_out expected 50.00, got %', v_pnl ->> 'other_cash_out';
    END IF;
    IF v_pnl ->> 'cash_shortages' <> '30.00' THEN
        RAISE EXCEPTION 'Assertion failed (1d): cash_shortages expected 30.00, got %', v_pnl ->> 'cash_shortages';
    END IF;
    IF (v_pnl ->> 'net_result')::numeric <> (v_pnl ->> 'gross_profit')::numeric - 500.00 - 30.00 THEN
        RAISE EXCEPTION 'Assertion failed (1e): net_result does not equal gross_profit - 500 - 30: %', v_pnl;
    END IF;

    -- =========================================================================
    -- 2. get_cash_flow.net_drawer_flow, checked against the movements
    --    directly (SALE 1500 + CASH_IN 200 - CASH_OUT 550 = 1150.00), NOT
    --    against session.expected_amount - opening_float as the plan's prose
    --    literally says. Investigated and confirmed a genuine, pre-existing
    --    inconsistency unrelated to WS-I: the production
    --    sales.submit_cash_session_count (src-tauri/migrations/
    --    20260731130000_cash_session_lifecycle.sql:775 -- "round(v_opening_float
    --    + coalesce(sum(m.amount), 0), 2)") sums every cash.movements.amount
    --    unsigned, never subtracting CASH_OUT -- while cash.record_cash_movement
    --    (WS-F-005) stores CASH_OUT as a positive amount, and both
    --    cash.submit_cash_session_count (also WS-F-005, apparently unused by
    --    the Rust command layer -- confirmed via
    --    src-tauri/src/application/cash_session.rs, which calls
    --    sales.submit_cash_session_count) and reports.get_cash_flow correctly
    --    subtract it. session.expected_amount is therefore inflated by
    --    2 x CASH_OUT whenever a session has any cash-out movements -- a real
    --    cash-reconciliation defect, pre-existing and out of WS-I-2 scope to
    --    fix. Reported under "Deviations" and "Unrelated problems" in the
    --    WS-I-2 Result Report.
    -- =========================================================================
    v_cash_flow := reports.get_cash_flow(v_admin_token, v_today, v_today);
    IF (v_cash_flow ->> 'net_drawer_flow')::numeric <> 1150.00 THEN
        RAISE EXCEPTION 'Assertion failed (2): net_drawer_flow expected 1150.00 (1500 sales + 200 cash-in - 550 cash-out), got %',
            v_cash_flow ->> 'net_drawer_flow';
    END IF;

    -- =========================================================================
    -- 3. get_monthly_summary(year, month of today).
    -- =========================================================================
    v_monthly := reports.get_monthly_summary(v_admin_token, v_year, v_month);
    IF v_monthly -> 'pnl' ->> 'net_sales' <>
       (reports.get_profit_and_loss(v_admin_token, (v_monthly -> 'period' ->> 'from')::date, (v_monthly -> 'period' ->> 'to')::date) ->> 'net_sales') THEN
        RAISE EXCEPTION 'Assertion failed (3a): monthly pnl.net_sales does not match get_profit_and_loss for the same month: %', v_monthly;
    END IF;
    v_supplier_balances := procurement.list_supplier_balances(v_admin_token);
    SELECT coalesce(sum((row ->> 'balance_due')::numeric), 0) INTO v_balance_due
    FROM jsonb_array_elements(v_supplier_balances) row;
    IF (v_monthly ->> 'payables_now')::numeric <> v_balance_due THEN
        RAISE EXCEPTION 'Assertion failed (3b): payables_now % <> sum(list_supplier_balances.balance_due) %',
            v_monthly ->> 'payables_now', v_balance_due;
    END IF;

    -- =========================================================================
    -- 4. get_receivables_aging.
    -- =========================================================================
    v_aging := reports.get_receivables_aging(v_admin_token, 'WSI002 Customer', 50, 0);
    IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_aging -> 'rows') row
        WHERE (row ->> 'customer_id')::bigint = v_customer1_id
          AND row ->> 'd31_60' = '500.00'
    ) THEN
        RAISE EXCEPTION 'Assertion failed (4a): C1 d31_60 expected 500.00 (S total): %', v_aging;
    END IF;
    -- S' is fully paid and S'' was voided: only S (500.00) should remain open.
    IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_aging -> 'rows') row
        WHERE (row ->> 'customer_id')::bigint = v_customer1_id
          AND row ->> 'total_open' = '500.00'
    ) THEN
        RAISE EXCEPTION 'Assertion failed (4b): C1 total_open expected 500.00 (S only, S paid and S'''' voided excluded): %', v_aging;
    END IF;

    -- =========================================================================
    -- 5. get_customer_statement(C1, very early date, today).
    -- =========================================================================
    v_cust_stmt := reports.get_customer_statement(v_admin_token, v_customer1_id, (v_today - 3650), v_today);
    IF v_cust_stmt ->> 'opening_balance' <> '0.00' THEN
        RAISE EXCEPTION 'Assertion failed (5a): opening_balance expected 0.00, got %', v_cust_stmt ->> 'opening_balance';
    END IF;
    IF v_cust_stmt ->> 'closing_balance' <>
       (SELECT exposure_amount::text FROM receivables.customer_credit_state WHERE customer_id = v_customer1_id) THEN
        RAISE EXCEPTION 'Assertion failed (5b): closing_balance % <> customer_credit_state.exposure_amount %',
            v_cust_stmt ->> 'closing_balance', (SELECT exposure_amount FROM receivables.customer_credit_state WHERE customer_id = v_customer1_id);
    END IF;

    -- =========================================================================
    -- 6. get_supplier_statement(supplier, very early date, today).closing_balance.
    -- =========================================================================
    v_supp_stmt := reports.get_supplier_statement(v_admin_token, v_supplier_id, (v_today - 3650), v_today);
    SELECT (row ->> 'balance_due')::numeric INTO v_balance_due
    FROM jsonb_array_elements(v_supplier_balances) row
    WHERE (row ->> 'supplier_id')::bigint = v_supplier_id;
    IF (v_supp_stmt ->> 'closing_balance')::numeric <> v_balance_due THEN
        RAISE EXCEPTION 'Assertion failed (6): supplier statement closing_balance % <> list_supplier_balances balance_due %',
            v_supp_stmt ->> 'closing_balance', v_balance_due;
    END IF;

    -- =========================================================================
    -- 7. get_trial_balance(year start, today).totals.is_balanced = true.
    -- =========================================================================
    v_trial := reports.get_trial_balance(v_admin_token, date_trunc('year', v_today)::date, v_today);
    IF NOT (v_trial -> 'totals' ->> 'is_balanced')::boolean THEN
        RAISE EXCEPTION 'Assertion failed (7): trial balance is not balanced: %', v_trial -> 'totals';
    END IF;

    -- =========================================================================
    -- 8. get_account_ledger for the cash-desk account: closing_balance matches
    --    the trial balance's closing debit - credit for that account.
    -- =========================================================================
    v_ledger := reports.get_account_ledger(v_admin_token, v_cash_account_id, date_trunc('year', v_today)::date, v_today, 500, 0);
    IF (v_ledger ->> 'closing_balance')::numeric <> (
        SELECT (row ->> 'closing_debit')::numeric - (row ->> 'closing_credit')::numeric
        FROM jsonb_array_elements(v_trial -> 'rows') row
        WHERE (row ->> 'account_id')::bigint = v_cash_account_id
    ) THEN
        RAISE EXCEPTION 'Assertion failed (8): account ledger closing_balance % <> trial balance closing debit-credit %',
            v_ledger ->> 'closing_balance', v_trial;
    END IF;

    -- =========================================================================
    -- 9. A CASHIER token -> 42501 on every new function.
    -- =========================================================================
    v_blocked := false;
    BEGIN PERFORM reports.get_profit_and_loss(v_cashier_token, v_today, v_today);
    EXCEPTION WHEN SQLSTATE '42501' THEN v_blocked := true; END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'Assertion failed (9a): get_profit_and_loss allowed a CASHIER'; END IF;

    v_blocked := false;
    BEGIN PERFORM reports.get_cash_flow(v_cashier_token, v_today, v_today);
    EXCEPTION WHEN SQLSTATE '42501' THEN v_blocked := true; END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'Assertion failed (9b): get_cash_flow allowed a CASHIER'; END IF;

    v_blocked := false;
    BEGIN PERFORM reports.get_monthly_summary(v_cashier_token, v_year, v_month);
    EXCEPTION WHEN SQLSTATE '42501' THEN v_blocked := true; END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'Assertion failed (9c): get_monthly_summary allowed a CASHIER'; END IF;

    v_blocked := false;
    BEGIN PERFORM reports.get_receivables_aging(v_cashier_token, NULL, 50, 0);
    EXCEPTION WHEN SQLSTATE '42501' THEN v_blocked := true; END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'Assertion failed (9d): get_receivables_aging allowed a CASHIER'; END IF;

    v_blocked := false;
    BEGIN PERFORM reports.get_customer_statement(v_cashier_token, v_customer1_id, v_today, v_today);
    EXCEPTION WHEN SQLSTATE '42501' THEN v_blocked := true; END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'Assertion failed (9e): get_customer_statement allowed a CASHIER'; END IF;

    v_blocked := false;
    BEGIN PERFORM reports.get_supplier_balances(v_cashier_token, NULL, 50, 0);
    EXCEPTION WHEN SQLSTATE '42501' THEN v_blocked := true; END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'Assertion failed (9f): get_supplier_balances allowed a CASHIER'; END IF;

    v_blocked := false;
    BEGIN PERFORM reports.get_supplier_statement(v_cashier_token, v_supplier_id, v_today, v_today);
    EXCEPTION WHEN SQLSTATE '42501' THEN v_blocked := true; END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'Assertion failed (9g): get_supplier_statement allowed a CASHIER'; END IF;

    v_blocked := false;
    BEGIN PERFORM reports.get_trial_balance(v_cashier_token, v_today, v_today);
    EXCEPTION WHEN SQLSTATE '42501' THEN v_blocked := true; END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'Assertion failed (9h): get_trial_balance allowed a CASHIER'; END IF;

    v_blocked := false;
    BEGIN PERFORM reports.get_account_ledger(v_cashier_token, v_cash_account_id, v_today, v_today, 50, 0);
    EXCEPTION WHEN SQLSTATE '42501' THEN v_blocked := true; END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'Assertion failed (9i): get_account_ledger allowed a CASHIER'; END IF;

    v_blocked := false;
    BEGIN PERFORM reports.list_accounts(v_cashier_token);
    EXCEPTION WHEN SQLSTATE '42501' THEN v_blocked := true; END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'Assertion failed (9j): list_accounts allowed a CASHIER'; END IF;

    -- =========================================================================
    -- 10. Unknown customer/supplier/account -> 22023; month 13 -> 22023.
    -- =========================================================================
    v_blocked := false;
    BEGIN PERFORM reports.get_customer_statement(v_admin_token, -1, v_today, v_today);
    EXCEPTION WHEN SQLSTATE '22023' THEN v_blocked := true; END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'Assertion failed (10a): unknown customer was allowed'; END IF;

    v_blocked := false;
    BEGIN PERFORM reports.get_supplier_statement(v_admin_token, -1, v_today, v_today);
    EXCEPTION WHEN SQLSTATE '22023' THEN v_blocked := true; END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'Assertion failed (10b): unknown supplier was allowed'; END IF;

    v_blocked := false;
    BEGIN PERFORM reports.get_account_ledger(v_admin_token, -1, v_today, v_today, 50, 0);
    EXCEPTION WHEN SQLSTATE '22023' THEN v_blocked := true; END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'Assertion failed (10c): unknown account was allowed'; END IF;

    v_blocked := false;
    BEGIN PERFORM reports.get_monthly_summary(v_admin_token, v_year, 13);
    EXCEPTION WHEN SQLSTATE '22023' THEN v_blocked := true; END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'Assertion failed (10d): month 13 was allowed'; END IF;

    -- =========================================================================
    -- 11. operations.schema_state.migration_version >= 20260928090000.
    -- =========================================================================
    IF (SELECT migration_version FROM operations.schema_state WHERE singleton) < 20260928090000 THEN
        RAISE EXCEPTION 'Assertion failed (11): schema_state.migration_version mismatch';
    END IF;

    -- =========================================================================
    -- 12. Performance: EXPLAIN ANALYZE every new public function.
    -- =========================================================================
    DECLARE
        v_explain text;
        v_plan_line text;
    BEGIN
        FOR v_explain IN
            SELECT unnest(ARRAY[
                format('EXPLAIN (ANALYZE, TIMING OFF, SUMMARY ON) SELECT reports.get_profit_and_loss(%L, %L, %L)', v_admin_token, date_trunc('year', v_today)::date, v_today),
                format('EXPLAIN (ANALYZE, TIMING OFF, SUMMARY ON) SELECT reports.get_cash_flow(%L, %L, %L)', v_admin_token, date_trunc('year', v_today)::date, v_today),
                format('EXPLAIN (ANALYZE, TIMING OFF, SUMMARY ON) SELECT reports.get_monthly_summary(%L, %L, %L)', v_admin_token, v_year, v_month),
                format('EXPLAIN (ANALYZE, TIMING OFF, SUMMARY ON) SELECT reports.get_receivables_aging(%L, NULL, 50, 0)', v_admin_token),
                format('EXPLAIN (ANALYZE, TIMING OFF, SUMMARY ON) SELECT reports.get_customer_statement(%L, %L, %L, %L)', v_admin_token, v_customer1_id, (v_today - 3650), v_today),
                format('EXPLAIN (ANALYZE, TIMING OFF, SUMMARY ON) SELECT reports.get_supplier_balances(%L, NULL, 50, 0)', v_admin_token),
                format('EXPLAIN (ANALYZE, TIMING OFF, SUMMARY ON) SELECT reports.get_supplier_statement(%L, %L, %L, %L)', v_admin_token, v_supplier_id, (v_today - 3650), v_today),
                format('EXPLAIN (ANALYZE, TIMING OFF, SUMMARY ON) SELECT reports.get_trial_balance(%L, %L, %L)', v_admin_token, date_trunc('year', v_today)::date, v_today),
                format('EXPLAIN (ANALYZE, TIMING OFF, SUMMARY ON) SELECT reports.get_account_ledger(%L, %L, %L, %L, 50, 0)', v_admin_token, v_cash_account_id, date_trunc('year', v_today)::date, v_today),
                format('EXPLAIN (ANALYZE, TIMING OFF, SUMMARY ON) SELECT reports.list_accounts(%L)', v_admin_token)
            ])
        LOOP
            FOR v_plan_line IN EXECUTE v_explain LOOP
                IF v_plan_line LIKE 'Execution Time:%' THEN
                    RAISE NOTICE '[WS-I-002 perf] % -> %', left(v_explain, 70), v_plan_line;
                END IF;
            END LOOP;
        END LOOP;
    END;

    RAISE NOTICE '=== WS-I-002 finance reports integration suite completed successfully ===';
END;
$$;

-- =============================================================================
-- 13. Re-applying the migration file a second time raises no error.
-- =============================================================================
\i src-tauri/migrations/20260928090000_ws_i_002_finance_reports.sql
