-- R0-002: Historical Paper-Book Staging, Analytics, and Operational-Isolation SQL Integration Test

BEGIN;

-- 1. Setup session and permissions for ADMIN
SELECT set_config('request.jwt.claim.sub', '1', true);

INSERT INTO iam.users (id, username, display_name, password_hash, role_id)
SELECT 1, 'admin_r0_002', 'Admin R0-002', 'hash', r.id
FROM iam.roles r WHERE r.code = 'ADMIN'
ON CONFLICT (id) DO NOTHING;

INSERT INTO iam.sessions (id, user_id, token, expires_at, workstation_id)
VALUES (999, 1, 'token_r0_002', now() + interval '1 hour', 'workstation_r0_002')
ON CONFLICT (id) DO NOTHING;

-- Seed a test catalog product for exact matching
INSERT INTO catalog.products (id, code, name, default_uom, active)
VALUES (101, 'PROD-CHAIR', 'Office Chair', 'UNIT', true)
ON CONFLICT (id) DO NOTHING;

-- Capture operational row counts BEFORE historical import
CREATE TEMP TABLE _op_before AS
SELECT
    (SELECT count(*) FROM sales.sales) AS sales_count,
    (SELECT count(*) FROM procurement.purchase_orders) AS po_count,
    (SELECT count(*) FROM inventory.stock_movements) AS stock_mov_count,
    (SELECT count(*) FROM accounting.journals) AS journal_count,
    (SELECT count(*) FROM customer.ledger_entries) AS customer_ledger_count,
    (SELECT count(*) FROM supplier.liabilities) AS supplier_liab_count;

-- 2. Create Paper-Book Batch
SELECT onboarding.create_historical_trade_batch(
    'token_r0_002',
    'req-r0-002-test-001',
    'paperbook_2025.xlsx',
    'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'
);

-- 3. Attempt Duplicate Dataset Import (Same content hash) -> Expect exception
DO $$
DECLARE
    v_error text;
BEGIN
    BEGIN
        PERFORM onboarding.create_historical_trade_batch(
            'token_r0_002',
            'req-r0-002-test-dup',
            'paperbook_copy.xlsx',
            'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'
        );
        RAISE EXCEPTION 'Expected duplicate content hash to be rejected!';
    EXCEPTION WHEN OTHERS THEN
        v_error := SQLERRM;
        IF v_error NOT LIKE '%identical dataset%' THEN
            RAISE EXCEPTION 'Unexpected error for duplicate hash: %', v_error;
        END IF;
    END;
END;
$$;

-- 4. Replace Batch Data with 2 Transactions:
-- Txn 1: SALE 2 lines (Office Chair matched, Table unmatched). Chair qty 2 x 5000 DZD = 10000 DZD. Table manual override 12000 DZD.
-- Txn 2: PURCHASE 1 line (Lamp 3 x 2500 DZD = 7500 DZD).
SELECT onboarding.replace_historical_trade_batch_data(
    'token_r0_002',
    1,
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

-- Assert product catalog matching & line total override calculations
DO $$
DECLARE
    v_chair_matched_id bigint;
    v_desk_override_diff bigint;
    v_desk_eff_total bigint;
BEGIN
    SELECT matched_product_id INTO v_chair_matched_id
    FROM onboarding.historical_trade_lines
    WHERE product_name = 'Office Chair';

    IF v_chair_matched_id <> 101 THEN
        RAISE EXCEPTION 'Expected Office Chair to match product ID 101, got %', v_chair_matched_id;
    END IF;

    SELECT effective_line_total_dzd, override_difference_dzd
    INTO v_desk_eff_total, v_desk_override_diff
    FROM onboarding.historical_trade_lines
    WHERE product_name = 'Wooden Desk';

    IF v_desk_eff_total <> 12000 OR v_desk_override_diff <> -3000 THEN
        RAISE EXCEPTION 'Expected Wooden Desk override eff=12000 diff=-3000, got eff=% diff=%',
            v_desk_eff_total, v_desk_override_diff;
    END IF;
END;
$$;

-- 5. Validate Batch
SELECT onboarding.validate_historical_trade_batch('token_r0_002', 1);

-- 6. Approve Batch for Historical Reporting
SELECT onboarding.approve_historical_trade_batch('token_r0_002', 1);

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
    v_journal_now bigint;
    v_cust_ledger_now bigint;
    v_supp_liab_now bigint;
BEGIN
    SELECT * INTO v_before FROM _op_before;

    SELECT count(*) INTO v_sales_now FROM sales.sales;
    SELECT count(*) INTO v_po_now FROM procurement.purchase_orders;
    SELECT count(*) INTO v_stock_mov_now FROM inventory.stock_movements;
    SELECT count(*) INTO v_journal_now FROM accounting.journals;
    SELECT count(*) INTO v_cust_ledger_now FROM customer.ledger_entries;
    SELECT count(*) INTO v_supp_liab_now FROM supplier.liabilities;

    IF v_sales_now <> v_before.sales_count
       OR v_po_now <> v_before.po_count
       OR v_stock_mov_now <> v_before.stock_mov_count
       OR v_journal_now <> v_before.journal_count
       OR v_cust_ledger_now <> v_before.customer_ledger_count
       OR v_supp_liab_now <> v_before.supplier_liab_count THEN
        RAISE EXCEPTION 'CRITICAL INTEGRITY FAILURE: Historical import altered operational tables!';
    END IF;
END;
$$;

ROLLBACK;
