-- R0-002: Historical Paper-Book Staging, Analytics, and Operational-Isolation SQL Integration Test

BEGIN;

-- 1. Setup session and permissions for ADMIN
DO $$
DECLARE
    v_admin_id bigint;
    v_admin_token text := 'token_r0_002';
BEGIN
    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES ('admin_r0_002', 'Admin R0-002', 'hash')
    RETURNING id INTO v_admin_id;

    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_admin_id, id FROM iam.roles WHERE code = 'ADMIN';

    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_admin_id, 'workstation_r0_002', sha256(v_admin_token::bytea), now() + interval '1 hour');
END;
$$;

-- Seed a test catalog product for exact matching
INSERT INTO catalog.products (id, name, is_active) OVERRIDING SYSTEM VALUE
VALUES (101, 'Office Chair', true)
ON CONFLICT (id) DO NOTHING;

-- Capture operational row counts BEFORE historical import
CREATE TEMP TABLE _op_before AS
SELECT
    (SELECT count(*) FROM sales.cash_sales) AS sales_count,
    (SELECT count(*) FROM procurement.purchase_orders) AS po_count,
    (SELECT count(*) FROM inventory.movements) AS stock_mov_count,
    (SELECT count(*) FROM inventory.positions) AS stock_pos_count,
    (SELECT count(*) FROM finance.journal_entries) AS journal_count,
    (SELECT count(*) FROM receivables.customer_ledger_entries) AS customer_ledger_count;

-- 2. Create Paper-Book Batch
DO $$
DECLARE
    v_batch_res jsonb;
    v_batch_id bigint;
    v_replace_res jsonb;
    v_validate_res jsonb;
    v_approve_res jsonb;
BEGIN
    v_batch_res := onboarding.create_historical_trade_batch(
        'token_r0_002',
        'req-r0-002-test-001',
        'paperbook_2025.xlsx',
        'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'
    );
    v_batch_id := (v_batch_res->>'batchId')::bigint;

    v_replace_res := onboarding.replace_historical_trade_batch_data(
        'token_r0_002',
        v_batch_id,
        jsonb_build_array(
            jsonb_build_object(
                'source_transaction_sequence', 1,
                'source_first_excel_row', 2,
                'source_excel_txn_ref', 'TX-000001',
                'transaction_date', '2025-03-15',
                'transaction_type', 'SALE',
                'payment_status', 'PAID',
                'party_company', 'Customer ABC',
                'page_number', 12,
                'lines', jsonb_build_array(
                    jsonb_build_object(
                        'source_row_number', 2,
                        'line_sequence', 1,
                        'product_name', 'Office Chair',
                        'brand', 'ErgoFlex',
                        'custom_details', 'Black Mesh',
                        'quantity', 2,
                        'unit_price_dzd', 5000,
                        'manual_line_total_dzd', NULL
                    ),
                    jsonb_build_object(
                        'source_row_number', 3,
                        'line_sequence', 2,
                        'product_name', 'Wooden Desk',
                        'brand', 'OakWood',
                        'custom_details', '180x80cm',
                        'quantity', 1,
                        'unit_price_dzd', 15000,
                        'manual_line_total_dzd', 12000
                    )
                )
            ),
            jsonb_build_object(
                'source_transaction_sequence', 2,
                'source_first_excel_row', 4,
                'source_excel_txn_ref', 'TX-000002',
                'transaction_date', '2025-03-16',
                'transaction_type', 'PURCHASE',
                'payment_status', 'UNPAID',
                'party_company', 'Supplier XYZ',
                'page_number', 12,
                'lines', jsonb_build_array(
                    jsonb_build_object(
                        'source_row_number', 4,
                        'line_sequence', 1,
                        'product_name', 'Desk Lamp',
                        'brand', 'Philips',
                        'custom_details', 'LED 10W',
                        'quantity', 3,
                        'unit_price_dzd', 2500,
                        'manual_line_total_dzd', NULL
                    )
                )
            )
        )
    );

    v_validate_res := onboarding.validate_historical_trade_batch('token_r0_002', v_batch_id);
    v_approve_res := onboarding.approve_historical_trade_batch('token_r0_002', v_batch_id);
END;
$$;

-- 7. Query Historical Trade Analytics
DO $$
DECLARE
    v_analytics jsonb;
    v_sales_dzd bigint;
    v_purchases_dzd bigint;
BEGIN
    v_analytics := onboarding.get_historical_trade_analytics('token_r0_002', '2025-01-01', '2025-12-31');

    v_sales_dzd := (v_analytics->'overview'->>'totalSalesDzd')::bigint;
    v_purchases_dzd := (v_analytics->'overview'->>'totalPurchasesDzd')::bigint;

    IF v_sales_dzd <> 22000 OR v_purchases_dzd <> 7500 THEN
        RAISE EXCEPTION 'Expected sales=22000 purchases=7500 in analytics, got sales=% purchases=%',
            v_sales_dzd, v_purchases_dzd;
    END IF;
END;
$$;

-- 8. PROVE OPERATIONAL ISOLATION BOUNDARY
DO $$
DECLARE
    v_before _op_before%ROWTYPE;
    v_sales_now bigint;
    v_po_now bigint;
    v_stock_mov_now bigint;
    v_stock_pos_now bigint;
    v_journal_now bigint;
    v_cust_ledger_now bigint;
BEGIN
    SELECT * INTO v_before FROM _op_before;

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
        RAISE EXCEPTION 'CRITICAL INTEGRITY FAILURE: Historical import altered operational tables!';
    END IF;
END;
$$;

ROLLBACK;
