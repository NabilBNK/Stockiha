-- R0-004: Historical Paper-Book Line-Level Party & Benefit SQL Integration Test
-- Runs inside a clean transaction block.

BEGIN;

-- 1. Setup session and permissions for ADMIN
INSERT INTO iam.users (username, display_name, password_hash)
VALUES ('admin_r0_004', 'Admin R0-004', 'hash')
ON CONFLICT (username) DO NOTHING;

DO $$
DECLARE
    v_admin_id bigint;
    v_admin_token text := 'token_r0_004';
BEGIN
    SELECT id INTO v_admin_id FROM iam.users WHERE username = 'admin_r0_004';

    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_admin_id, id FROM iam.roles WHERE code = 'ADMIN'
    ON CONFLICT DO NOTHING;

    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_admin_id, 'workstation_r0_004', sha256(v_admin_token::bytea), now() + interval '1 hour')
    ON CONFLICT DO NOTHING;
END;
$$;

-- Clean up any previous test batches in this test database to ensure precise analytics totals
DELETE FROM onboarding.historical_finance_audit WHERE batch_id IN (SELECT id FROM onboarding.historical_finance_batches WHERE original_filename LIKE '%v3_Benefit_Expenses.xlsx%');
DELETE FROM onboarding.historical_trade_transactions WHERE batch_id IN (SELECT id FROM onboarding.historical_finance_batches WHERE original_filename LIKE '%v3_Benefit_Expenses.xlsx%');
DELETE FROM onboarding.historical_finance_batches WHERE original_filename LIKE '%v3_Benefit_Expenses.xlsx%';

-- Seed test catalog products
INSERT INTO catalog.products (id, name, is_active) OVERRIDING SYSTEM VALUE
VALUES (301, 'kowat', true), (302, 'ouess', true)
ON CONFLICT (id) DO NOTHING;

-- Capture operational row counts BEFORE historical import
CREATE TEMP TABLE IF NOT EXISTS _op_before_r0_004 AS
SELECT
    (SELECT count(*) FROM sales.cash_sales) AS sales_count,
    (SELECT count(*) FROM procurement.purchase_orders) AS po_count,
    (SELECT count(*) FROM inventory.movements) AS stock_mov_count,
    (SELECT count(*) FROM inventory.positions) AS stock_pos_count,
    (SELECT count(*) FROM finance.journal_entries) AS journal_count,
    (SELECT count(*) FROM receivables.customer_ledger_entries) AS customer_ledger_count;

-- 2. Test Line-Level Party & Benefit Persistence, Aggregation, and Analytics
DO $$
DECLARE
    v_batch_res jsonb;
    v_batch_id bigint;
    v_replace_res jsonb;
    v_validate_res jsonb;
    v_approve_res jsonb;
    v_analytics jsonb;
    v_line_party text;
    v_txn_benefit bigint;
    v_total_sales bigint;
    v_total_purchases bigint;
    v_total_expenses bigint;
    v_total_benefit bigint;
    v_req_id text;
    v_hash text;
BEGIN
    v_req_id := 'req-r0-004-test-' || floor(extract(epoch from clock_timestamp()) * 1000)::text;
    v_hash := encode(sha256(v_req_id::bytea), 'hex');

    -- Create batch
    v_batch_res := onboarding.create_historical_trade_batch(
        'token_r0_004'::text,
        v_req_id,
        'Stockiha_Historical_Transactions_v3_Benefit_Expenses.xlsx'::text,
        v_hash,
        'PAPER_BOOK_V2'::text
    );
    v_batch_id := (v_batch_res->>'batchId')::bigint;

    IF (v_batch_res->>'status') <> 'DRAFT' THEN
        RAISE EXCEPTION 'Expected status DRAFT on creation, got %', (v_batch_res->>'status');
    END IF;

    -- Replace data matching Section 13 sample
    v_replace_res := onboarding.replace_historical_trade_batch_data(
        'token_r0_004',
        v_batch_id,
        jsonb_build_array(
            -- TX-000001 (BUY) - Row 2 to 5 with line-level parties: AK home, Rozana, Dolz
            jsonb_build_object(
                'source_transaction_sequence', 1,
                'source_first_excel_row', 2,
                'source_excel_txn_ref', 'TX-000001',
                'transaction_date', '2025-10-22',
                'transaction_type', 'PURCHASE',
                'payment_status', 'PAID',
                'party_company', 'AK home',
                'page_number', 2,
                'lines', jsonb_build_array(
                    jsonb_build_object('source_row_number', 2, 'line_sequence', 1, 'product_name', 'kowat', 'brand', 'AK', 'custom_details', '2 pers', 'party_company', 'AK home', 'quantity', 10, 'unit_price_dzd', 2000),
                    jsonb_build_object('source_row_number', 3, 'line_sequence', 2, 'product_name', 'kowat', 'brand', 'rozana', 'custom_details', '1 person', 'party_company', 'Rozana', 'quantity', 5, 'unit_price_dzd', 1500),
                    jsonb_build_object('source_row_number', 4, 'line_sequence', 3, 'product_name', 'ouess', 'brand', 'Dolz', 'party_company', 'Dolz', 'quantity', 4, 'unit_price_dzd', 500),
                    jsonb_build_object('source_row_number', 5, 'line_sequence', 4, 'product_name', 'pillow', 'brand', 'Dolz', 'party_company', 'Dolz', 'quantity', 8, 'unit_price_dzd', 1750)
                )
            ),
            -- TX-000002 (SELL) - Row 6 (Corrected Date: 23/11/2025)
            jsonb_build_object(
                'source_transaction_sequence', 2,
                'source_first_excel_row', 6,
                'source_excel_txn_ref', 'TX-000002',
                'transaction_date', '2025-11-23',
                'transaction_type', 'SALE',
                'payment_status', 'PAID',
                'party_company', 'anis',
                'lines', jsonb_build_array(
                    jsonb_build_object('source_row_number', 6, 'line_sequence', 1, 'product_name', 'kowat', 'brand', 'rozana', 'party_company', 'anis', 'manual_benefit_dzd', 7000, 'quantity', 15, 'unit_price_dzd', 2000)
                )
            ),
            -- TX-000003 (SELL) - Row 7 to 8 with line-level benefits: 500 and 2500
            jsonb_build_object(
                'source_transaction_sequence', 3,
                'source_first_excel_row', 7,
                'source_excel_txn_ref', 'TX-000003',
                'transaction_date', '2025-12-26',
                'transaction_type', 'SALE',
                'payment_status', 'UNPAID',
                'party_company', 'zakou',
                'lines', jsonb_build_array(
                    jsonb_build_object('source_row_number', 7, 'line_sequence', 1, 'product_name', 'ouess', 'brand', 'Dolz', 'party_company', 'zakou', 'manual_benefit_dzd', 500, 'quantity', 2, 'unit_price_dzd', 800),
                    jsonb_build_object('source_row_number', 8, 'line_sequence', 2, 'product_name', 'kowat', 'brand', 'rozana', 'party_company', 'zakou', 'manual_benefit_dzd', 2500, 'quantity', 5, 'unit_price_dzd', 2000)
                )
            ),
            -- TX-000004 (EXPENSE) - Row 9
            jsonb_build_object(
                'source_transaction_sequence', 4,
                'source_first_excel_row', 9,
                'source_excel_txn_ref', 'TX-000004',
                'transaction_date', '2025-12-29',
                'transaction_type', 'EXPENSE',
                'payment_status', 'PAID',
                'lines', jsonb_build_array(
                    jsonb_build_object('source_row_number', 9, 'line_sequence', 1, 'custom_details', 'food', 'manual_line_total_dzd', 500)
                )
            )
        )
    );

    IF (v_replace_res->>'transactionCount')::int <> 4 THEN
        RAISE EXCEPTION 'Expected 4 transactions, got %', (v_replace_res->>'transactionCount');
    END IF;
    IF (v_replace_res->>'lineCount')::int <> 8 THEN
        RAISE EXCEPTION 'Expected 8 lines, got %', (v_replace_res->>'lineCount');
    END IF;

    -- Assert line-level party stored on line 2 (Rozana)
    SELECT party_company INTO v_line_party
    FROM onboarding.historical_trade_lines
    WHERE source_row_number = 3 LIMIT 1;
    IF v_line_party <> 'Rozana' THEN
        RAISE EXCEPTION 'Expected line 2 party Rozana, got %', v_line_party;
    END IF;

    -- Assert transaction manual benefit aggregate for TX-000003 (500 + 2500 = 3000)
    SELECT manual_benefit_dzd INTO v_txn_benefit
    FROM onboarding.historical_trade_transactions
    WHERE source_excel_txn_ref = 'TX-000003' LIMIT 1;
    IF v_txn_benefit <> 3000 THEN
        RAISE EXCEPTION 'Expected TX-000003 manual_benefit_dzd aggregate 3000, got %', v_txn_benefit;
    END IF;

    -- Validate batch
    v_validate_res := onboarding.validate_historical_trade_batch('token_r0_004', v_batch_id);
    IF (v_validate_res->>'status') <> 'VALIDATED' THEN
        RAISE EXCEPTION 'Expected status VALIDATED, got %', (v_validate_res->>'status');
    END IF;

    -- Approve batch
    v_approve_res := onboarding.approve_historical_trade_batch('token_r0_004', v_batch_id);
    IF (v_approve_res->>'status') <> 'APPROVED_FOR_REPORTING' THEN
        RAISE EXCEPTION 'Expected status APPROVED_FOR_REPORTING, got %', (v_approve_res->>'status');
    END IF;

    -- Analytics verification
    v_analytics := onboarding.get_historical_trade_analytics('token_r0_004', '2025-01-01'::date, '2026-01-01'::date);

    v_total_sales := (v_analytics->'overview'->>'totalSalesDzd')::bigint;
    v_total_purchases := (v_analytics->'overview'->>'totalPurchasesDzd')::bigint;
    v_total_expenses := (v_analytics->'overview'->>'totalExpensesDzd')::bigint;
    v_total_benefit := (v_analytics->'overview'->>'totalManualBenefitDzd')::bigint;

    IF v_total_sales <> 41600 THEN
        RAISE EXCEPTION 'Analytics totalSalesDzd expected 41600, got %', v_total_sales;
    END IF;
    IF v_total_purchases <> 43500 THEN
        RAISE EXCEPTION 'Analytics totalPurchasesDzd expected 43500, got %', v_total_purchases;
    END IF;
    IF v_total_expenses <> 500 THEN
        RAISE EXCEPTION 'Analytics totalExpensesDzd expected 500, got %', v_total_expenses;
    END IF;
    IF v_total_benefit <> 10000 THEN
        RAISE EXCEPTION 'Analytics totalManualBenefitDzd expected 10000, got %', v_total_benefit;
    END IF;
END;
$$;

-- 3. Operational Isolation Assertions
DO $$
DECLARE
    v_after record;
    v_before record;
BEGIN
    SELECT * INTO v_before FROM _op_before_r0_004;

    SELECT
        (SELECT count(*) FROM sales.cash_sales) AS sales_count,
        (SELECT count(*) FROM procurement.purchase_orders) AS po_count,
        (SELECT count(*) FROM inventory.movements) AS stock_mov_count,
        (SELECT count(*) FROM inventory.positions) AS stock_pos_count,
        (SELECT count(*) FROM finance.journal_entries) AS journal_count,
        (SELECT count(*) FROM receivables.customer_ledger_entries) AS customer_ledger_count
    INTO v_after;

    IF v_after.sales_count <> v_before.sales_count THEN
        RAISE EXCEPTION 'Operational isolation broken: sales.cash_sales count changed!';
    END IF;
    IF v_after.po_count <> v_before.po_count THEN
        RAISE EXCEPTION 'Operational isolation broken: procurement.purchase_orders count changed!';
    END IF;
    IF v_after.stock_mov_count <> v_before.stock_mov_count THEN
        RAISE EXCEPTION 'Operational isolation broken: inventory.movements count changed!';
    END IF;
    IF v_after.journal_count <> v_before.journal_count THEN
        RAISE EXCEPTION 'Operational isolation broken: finance.journal_entries count changed!';
    END IF;
END;
$$;

COMMIT;
