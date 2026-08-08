-- R0-003: Historical Paper-Book V2 Expenses & Manual Sell Benefit SQL Integration Test
-- Runs inside the transaction owned by run_current_sql_suites.sh.

-- 1. Setup session and permissions for ADMIN
DO $$
DECLARE
    v_admin_id bigint;
    v_admin_token text := 'token_r0_003';
BEGIN
    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES ('admin_r0_003', 'Admin R0-003', 'hash')
    RETURNING id INTO v_admin_id;

    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_admin_id, id FROM iam.roles WHERE code = 'ADMIN';

    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_admin_id, 'workstation_r0_003', sha256(v_admin_token::bytea), now() + interval '1 hour');
END;
$$;

-- Seed a test catalog product
INSERT INTO catalog.products (id, name, is_active) OVERRIDING SYSTEM VALUE
VALUES (201, 'Luxury Bed', true)
ON CONFLICT (id) DO NOTHING;

-- Capture operational row counts BEFORE historical import
CREATE TEMP TABLE _op_before_r0_003 AS
SELECT
    (SELECT count(*) FROM sales.cash_sales) AS sales_count,
    (SELECT count(*) FROM procurement.purchase_orders) AS po_count,
    (SELECT count(*) FROM inventory.movements) AS stock_mov_count,
    (SELECT count(*) FROM inventory.positions) AS stock_pos_count,
    (SELECT count(*) FROM finance.journal_entries) AS journal_count,
    (SELECT count(*) FROM receivables.customer_ledger_entries) AS customer_ledger_count;

-- 2. Create Paper-Book V2 Batch
DO $$
DECLARE
    v_batch_res jsonb;
    v_batch_id bigint;
    v_replace_res jsonb;
    v_validate_res jsonb;
    v_approve_res jsonb;
BEGIN
    v_batch_res := onboarding.create_historical_trade_batch(
        'token_r0_003',
        'req-r0-003-test-001',
        'paperbook_v3_benefit_expenses.xlsx',
        'b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1',
        'PAPER_BOOK_V2'
    );
    v_batch_id := (v_batch_res->>'batchId')::bigint;

    IF (v_batch_res->>'importProfile') <> 'PAPER_BOOK_V2' THEN
        RAISE EXCEPTION 'Expected importProfile PAPER_BOOK_V2, got %', (v_batch_res->>'importProfile');
    END IF;

    v_replace_res := onboarding.replace_historical_trade_batch_data(
        'token_r0_003',
        v_batch_id,
        jsonb_build_array(
            -- Txn 1: Sale with positive manual benefit (14500)
            jsonb_build_object(
                'source_transaction_sequence', 1,
                'source_first_excel_row', 2,
                'source_excel_txn_ref', 'TX-000001',
                'transaction_date', '2026-04-15',
                'transaction_type', 'SALE',
                'payment_status', 'PAID',
                'party_company', 'Client Alpha',
                'manual_benefit_dzd', 14500,
                'page_number', 42,
                'lines', jsonb_build_array(
                    jsonb_build_object(
                        'source_row_number', 2,
                        'line_sequence', 1,
                        'product_name', 'Luxury Bed',
                        'brand', 'ComfortLux',
                        'custom_details', 'King Size',
                        'quantity', 1,
                        'unit_price_dzd', 40000,
                        'manual_line_total_dzd', NULL
                    )
                )
            ),
            -- Txn 2: Sale (same date) with negative manual benefit (-2500 loss)
            jsonb_build_object(
                'source_transaction_sequence', 2,
                'source_first_excel_row', 3,
                'source_excel_txn_ref', 'TX-000002',
                'transaction_date', '2026-04-15',
                'transaction_type', 'SALE',
                'payment_status', 'PAID',
                'party_company', 'Client Beta',
                'manual_benefit_dzd', -2500,
                'page_number', 42,
                'lines', jsonb_build_array(
                    jsonb_build_object(
                        'source_row_number', 3,
                        'line_sequence', 1,
                        'product_name', 'Mattress',
                        'brand', 'ComfortLux',
                        'custom_details', 'Medium Firm',
                        'quantity', 1,
                        'unit_price_dzd', 15000,
                        'manual_line_total_dzd', NULL
                    )
                )
            ),
            -- Txn 3: Buy (same date) with null manual benefit
            jsonb_build_object(
                'source_transaction_sequence', 3,
                'source_first_excel_row', 4,
                'source_excel_txn_ref', 'TX-000003',
                'transaction_date', '2026-04-15',
                'transaction_type', 'PURCHASE',
                'payment_status', 'UNPAID',
                'party_company', 'Wood Supplier',
                'manual_benefit_dzd', NULL,
                'page_number', 42,
                'lines', jsonb_build_array(
                    jsonb_build_object(
                        'source_row_number', 4,
                        'line_sequence', 1,
                        'product_name', 'Raw Timber',
                        'brand', 'Forestry',
                        'custom_details', 'Pine Wood',
                        'quantity', 5,
                        'unit_price_dzd', 3000,
                        'manual_line_total_dzd', NULL
                    )
                )
            ),
            -- Txn 4: Expense (same date) with no Qty/Price, literal total 3500
            jsonb_build_object(
                'source_transaction_sequence', 4,
                'source_first_excel_row', 5,
                'source_excel_txn_ref', 'TX-000004',
                'transaction_date', '2026-04-15',
                'transaction_type', 'EXPENSE',
                'payment_status', 'PAID',
                'party_company', 'Express Delivery',
                'manual_benefit_dzd', NULL,
                'page_number', 42,
                'lines', jsonb_build_array(
                    jsonb_build_object(
                        'source_row_number', 5,
                        'line_sequence', 1,
                        'product_name', NULL,
                        'brand', NULL,
                        'custom_details', 'Delivery & Transport',
                        'quantity', NULL,
                        'unit_price_dzd', NULL,
                        'manual_line_total_dzd', 3500
                    )
                )
            )
        )
    );

    v_validate_res := onboarding.validate_historical_trade_batch('token_r0_003', v_batch_id);
    IF (v_validate_res->>'status') <> 'VALIDATED' THEN
        RAISE EXCEPTION 'Validation failed: %', v_validate_res;
    END IF;

    IF (v_validate_res->>'totalExpensesDzd')::bigint <> 3500 THEN
        RAISE EXCEPTION 'Expected totalExpensesDzd 3500, got %', (v_validate_res->>'totalExpensesDzd');
    END IF;

    IF (v_validate_res->>'totalManualBenefitDzd')::bigint <> 12000 THEN
        RAISE EXCEPTION 'Expected totalManualBenefitDzd 12000, got %', (v_validate_res->>'totalManualBenefitDzd');
    END IF;

    v_approve_res := onboarding.approve_historical_trade_batch('token_r0_003', v_batch_id);
    IF (v_approve_res->>'status') <> 'APPROVED_FOR_REPORTING' THEN
        RAISE EXCEPTION 'Approval failed: %', v_approve_res;
    END IF;
END;
$$;

-- 3. Query Historical Trade Analytics
DO $$
DECLARE
    v_analytics jsonb;
    v_sales_dzd bigint;
    v_purchases_dzd bigint;
    v_expenses_dzd bigint;
    v_benefit_dzd bigint;
    v_benefit_count integer;
BEGIN
    v_analytics := onboarding.get_historical_trade_analytics('token_r0_003', '2026-01-01', '2026-12-31');

    v_sales_dzd := (v_analytics->'overview'->>'totalSalesDzd')::bigint;
    v_purchases_dzd := (v_analytics->'overview'->>'totalPurchasesDzd')::bigint;
    v_expenses_dzd := (v_analytics->'overview'->>'totalExpensesDzd')::bigint;
    v_benefit_dzd := (v_analytics->'overview'->>'totalManualBenefitDzd')::bigint;
    v_benefit_count := (v_analytics->'overview'->>'salesWithManualBenefitCount')::integer;

    IF v_sales_dzd <> 55000 OR v_purchases_dzd <> 15000 OR v_expenses_dzd <> 3500 THEN
        RAISE EXCEPTION 'Expected sales=55000 purchases=15000 expenses=3500, got sales=% purchases=% expenses=%',
            v_sales_dzd, v_purchases_dzd, v_expenses_dzd;
    END IF;

    IF v_benefit_dzd <> 12000 OR v_benefit_count <> 2 THEN
        RAISE EXCEPTION 'Expected totalManualBenefitDzd=12000 count=2, got benefit=% count=%',
            v_benefit_dzd, v_benefit_count;
    END IF;
END;
$$;

-- 4. PROVE OPERATIONAL ISOLATION BOUNDARY
DO $$
DECLARE
    v_before _op_before_r0_003%ROWTYPE;
    v_sales_now bigint;
    v_po_now bigint;
    v_stock_mov_now bigint;
    v_stock_pos_now bigint;
    v_journal_now bigint;
    v_cust_ledger_now bigint;
BEGIN
    SELECT * INTO v_before FROM _op_before_r0_003;

    SELECT count(*) INTO v_sales_now FROM sales.cash_sales;
    SELECT count(*) INTO v_po_now FROM procurement.purchase_orders;
    SELECT count(*) INTO v_stock_mov_now FROM inventory.movements;
    SELECT count(*) INTO v_stock_pos_now FROM inventory.positions;
    SELECT count(*) INTO v_journal_now FROM finance.journal_entries;
    SELECT count(*) INTO v_cust_ledger_now FROM receivables.customer_ledger_entries;

    IF v_sales_now <> v_before.sales_count
       OR v_po_now <> v_before.po_count
       OR v_stock_mov_now <> v_before.stock_mov_count
       OR v_stock_pos_now <> v_before.stock_pos_count
       OR v_journal_now <> v_before.journal_count
       OR v_cust_ledger_now <> v_before.customer_ledger_count THEN
        RAISE EXCEPTION 'CRITICAL INTEGRITY FAILURE: R0-003 Historical import altered operational tables!';
    END IF;
END;
$$;
