-- R0-001 finance-only historical onboarding regression.
-- Runs inside the transaction owned by run_current_sql_suites.sh.
\set ON_ERROR_STOP on

DO $$
DECLARE
    v_admin_id bigint;
    v_cashier_id bigint;
    v_admin_token text := 'r0_001_admin_token';
    v_cashier_token text := 'r0_001_cashier_token';
    v_batch jsonb;
    v_replay jsonb;
    v_validation jsonb;
    v_approval jsonb;
    v_summary jsonb;
    v_invalid_batch jsonb;
    v_batch_id bigint;
    v_invalid_batch_id bigint;
    v_second_batch_id bigint;
    v_denied boolean := false;
    v_conflict boolean := false;
    v_disabled boolean := false;
BEGIN
    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES ('r0_001_admin', 'R0 Admin', 'hash')
    RETURNING id INTO v_admin_id;
    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_admin_id, id FROM iam.roles WHERE code = 'ADMIN';
    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_admin_id, 'R0-WKS', sha256(v_admin_token::bytea), now() + interval '1 hour');

    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES ('r0_001_cashier', 'R0 Cashier', 'hash')
    RETURNING id INTO v_cashier_id;
    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_cashier_id, id FROM iam.roles WHERE code = 'CASHIER';
    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_cashier_id, 'R0-CASHIER-WKS', sha256(v_cashier_token::bytea), now() + interval '1 hour');

    ASSERT EXISTS (
        SELECT 1
        FROM iam.user_roles ur
        JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
        JOIN iam.permissions p ON p.id = rp.permission_id
        WHERE ur.user_id = v_admin_id
          AND p.code IN (
              'MANAGE_HISTORICAL_FINANCE_IMPORT',
              'REVIEW_HISTORICAL_FINANCE_IMPORT'
          )
        GROUP BY ur.user_id
        HAVING count(*) = 2
    ), 'ADMIN must receive both historical-finance permissions';

    ASSERT NOT EXISTS (
        SELECT 1
        FROM iam.user_roles ur
        JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
        JOIN iam.permissions p ON p.id = rp.permission_id
        WHERE ur.user_id = v_cashier_id
          AND p.code IN (
              'MANAGE_HISTORICAL_FINANCE_IMPORT',
              'REVIEW_HISTORICAL_FINANCE_IMPORT'
          )
    ), 'CASHIER must not receive historical-finance permissions';

    ASSERT (onboarding.get_historical_finance_setting(v_admin_token) ->> 'enabled')::boolean,
        'Historical-finance import feature must default ON';

    BEGIN
        PERFORM onboarding.get_historical_finance_setting(v_cashier_token);
    EXCEPTION WHEN insufficient_privilege THEN
        v_denied := true;
    END;
    ASSERT v_denied, 'Cashier must not read or manage historical-finance import';

    PERFORM onboarding.update_historical_finance_setting(v_admin_token, false);
    BEGIN
        PERFORM onboarding.create_historical_finance_batch(
            v_admin_token,
            'r0-disabled-0001',
            'EXCEL',
            'disabled.xlsx'
        );
    EXCEPTION WHEN object_not_in_prerequisite_state THEN
        v_disabled := true;
    END;
    ASSERT v_disabled, 'Disabled feature must block new historical-finance batches';
    PERFORM onboarding.update_historical_finance_setting(v_admin_token, true);

    v_batch := onboarding.create_historical_finance_batch(
        v_admin_token,
        'r0-excel-0001',
        'EXCEL',
        'Stockiha_Historical_Finance_Import_Template_Minimal.xlsx'
    );
    v_batch_id := (v_batch ->> 'batchId')::bigint;

    ASSERT v_batch ->> 'status' = 'DRAFT', 'New batch must start in DRAFT';
    ASSERT NOT (v_batch ->> 'isReplay')::boolean, 'First request must not be a replay';

    v_replay := onboarding.create_historical_finance_batch(
        v_admin_token,
        'r0-excel-0001',
        'EXCEL',
        'Stockiha_Historical_Finance_Import_Template_Minimal.xlsx'
    );
    ASSERT (v_replay ->> 'batchId')::bigint = v_batch_id,
        'Matching request replay must return the original batch';
    ASSERT (v_replay ->> 'isReplay')::boolean,
        'Matching request replay must be marked as replay';

    PERFORM onboarding.replace_historical_finance_batch_data(
        v_admin_token,
        v_batch_id,
        jsonb_build_array(
            jsonb_build_object(
                'source_row_number', 2,
                'paper_id', 'PAPER-000001',
                'transaction_date', '2025-01-10',
                'transaction_type', 'SALE',
                'description_or_category', 'Historical customer sale',
                'net_amount_dzd', 100000,
                'payment_status', 'PAID',
                'amount_paid_dzd', 100000,
                'review_status', 'READY'
            ),
            jsonb_build_object(
                'source_row_number', 3,
                'paper_id', 'PAPER-000002',
                'transaction_date', '2025-02-12',
                'transaction_type', 'PURCHASE',
                'description_or_category', 'Historical merchandise purchase',
                'net_amount_dzd', 60000,
                'payment_status', 'PAID',
                'amount_paid_dzd', 60000,
                'supplier_fournisseur', 'Supplier A',
                'review_status', 'READY'
            ),
            jsonb_build_object(
                'source_row_number', 4,
                'paper_id', 'PAPER-000003',
                'transaction_date', '2025-03-01',
                'transaction_type', 'EXPENSE',
                'description_or_category', 'Historical rent',
                'net_amount_dzd', 10000,
                'payment_status', 'PAID',
                'amount_paid_dzd', 10000,
                'expense_category', 'RENT',
                'review_status', 'READY'
            ),
            jsonb_build_object(
                'source_row_number', 5,
                'paper_id', 'PAPER-000004',
                'transaction_date', '2025-04-01',
                'transaction_type', 'OTHER_INCOME',
                'description_or_category', 'Other historical income',
                'net_amount_dzd', 5000,
                'payment_status', 'PAID',
                'amount_paid_dzd', 5000,
                'review_status', 'READY'
            ),
            jsonb_build_object(
                'source_row_number', 6,
                'paper_id', 'PAPER-000005',
                'transaction_date', '2025-05-01',
                'transaction_type', 'SUPPLIER_REFUND',
                'description_or_category', 'Historical supplier refund',
                'net_amount_dzd', 2000,
                'payment_status', 'PAID',
                'amount_paid_dzd', 2000,
                'supplier_fournisseur', 'Supplier A',
                'review_status', 'READY'
            ),
            jsonb_build_object(
                'source_row_number', 7,
                'paper_id', 'PAPER-000006',
                'transaction_date', '2025-06-01',
                'transaction_type', 'CUSTOMER_REFUND',
                'description_or_category', 'Historical customer refund',
                'net_amount_dzd', 3000,
                'payment_status', 'PAID',
                'amount_paid_dzd', 3000,
                'customer_client', 'Customer A',
                'review_status', 'READY'
            )
        ),
        jsonb_build_array(
            jsonb_build_object(
                'source_row_number', 2,
                'balance_date', '2025-01-01',
                'balance_type', 'OPENING_INVENTORY_VALUE',
                'amount_dzd', 20000,
                'review_status', 'READY'
            ),
            jsonb_build_object(
                'source_row_number', 3,
                'balance_date', '2025-12-31',
                'balance_type', 'CLOSING_INVENTORY_VALUE',
                'amount_dzd', 25000,
                'review_status', 'READY'
            )
        )
    );

    v_validation := onboarding.validate_historical_finance_batch(
        v_admin_token,
        v_batch_id
    );

    ASSERT v_validation ->> 'status' = 'VALIDATED',
        'Structurally valid finance data must validate';
    ASSERT (v_validation ->> 'rowCount')::integer = 6,
        'Validation must count all transaction rows';
    ASSERT (v_validation ->> 'invalidRowCount')::integer = 0,
        'Valid data must have zero validation issues';
    ASSERT (v_validation ->> 'totalSalesDzd')::bigint = 100000,
        'Sales total must be calculated independently';
    ASSERT (v_validation ->> 'totalPurchasesDzd')::bigint = 60000,
        'Purchase total must be calculated independently';
    ASSERT (v_validation ->> 'totalExpensesDzd')::bigint = 10000,
        'Expense total must be calculated independently';
    ASSERT (v_validation ->> 'preliminaryResultBeforeInventoryDzd')::bigint = 34000,
        'Preliminary result must include refunds exactly once';

    v_approval := onboarding.approve_historical_finance_batch(
        v_admin_token,
        v_batch_id
    );
    ASSERT v_approval ->> 'status' = 'APPROVED_FOR_REPORTING',
        'Validated batch must become reporting-approved';

    v_approval := onboarding.approve_historical_finance_batch(
        v_admin_token,
        v_batch_id
    );
    ASSERT (v_approval ->> 'isReplay')::boolean,
        'Repeated approval must be idempotent';

    v_summary := onboarding.get_historical_finance_summary(
        v_admin_token,
        DATE '2025-01-01',
        DATE '2025-12-31'
    );
    ASSERT (v_summary ->> 'salesDzd')::bigint = 100000,
        'Approved historical sales must appear in reporting';
    ASSERT (v_summary ->> 'inventoryDataComplete')::boolean,
        'Opening and closing inventory must enable inventory-adjusted estimate';
    ASSERT (v_summary ->> 'estimatedProfitLossDzd')::bigint = 39000,
        'Inventory-adjusted estimate must apply supplier refund once';
    ASSERT v_summary ->> 'profitCalculationStatus' = 'INVENTORY_ADJUSTED_ESTIMATE',
        'Report must label the result as an estimate';

    -- A second batch cannot claim the same physical paper identifier.
    v_batch := onboarding.create_historical_finance_batch(
        v_admin_token,
        'r0-manual-0002',
        'MANUAL',
        NULL
    );
    v_second_batch_id := (v_batch ->> 'batchId')::bigint;

    BEGIN
        PERFORM onboarding.replace_historical_finance_batch_data(
            v_admin_token,
            v_second_batch_id,
            jsonb_build_array(
                jsonb_build_object(
                    'source_row_number', 2,
                    'paper_id', 'PAPER-000001',
                    'transaction_date', '2025-01-10',
                    'transaction_type', 'SALE',
                    'description_or_category', 'Duplicate physical paper',
                    'net_amount_dzd', 100000,
                    'payment_status', 'PAID',
                    'review_status', 'READY'
                )
            ),
            '[]'::jsonb
        );
    EXCEPTION WHEN unique_violation THEN
        v_conflict := true;
    END;
    ASSERT v_conflict, 'Duplicate Paper_ID must be rejected across batches';

    -- Unknown/contradictory data must remain in review and cannot be approved.
    v_invalid_batch := onboarding.create_historical_finance_batch(
        v_admin_token,
        'r0-excel-0003',
        'EXCEL',
        'invalid.xlsx'
    );
    v_invalid_batch_id := (v_invalid_batch ->> 'batchId')::bigint;

    PERFORM onboarding.replace_historical_finance_batch_data(
        v_admin_token,
        v_invalid_batch_id,
        jsonb_build_array(
            jsonb_build_object(
                'source_row_number', 2,
                'paper_id', 'PAPER-INVALID-001',
                'transaction_date', '2025-07-01',
                'transaction_type', 'SALE',
                'description_or_category', 'Unknown settlement state',
                'net_amount_dzd', 50000,
                'payment_status', 'UNKNOWN',
                'review_status', 'READY'
            )
        ),
        '[]'::jsonb
    );

    v_validation := onboarding.validate_historical_finance_batch(
        v_admin_token,
        v_invalid_batch_id
    );
    ASSERT v_validation ->> 'status' = 'NEEDS_REVIEW',
        'Unknown payment status must require review';
    ASSERT (v_validation ->> 'invalidRowCount')::integer = 1,
        'Unknown payment status must produce one validation issue';

    v_denied := false;
    BEGIN
        PERFORM onboarding.approve_historical_finance_batch(
            v_admin_token,
            v_invalid_batch_id
        );
    EXCEPTION WHEN object_not_in_prerequisite_state THEN
        v_denied := true;
    END;
    ASSERT v_denied, 'Batch with validation issues must not be approved';

    ASSERT NOT has_table_privilege(
        'stockiha_runtime',
        'onboarding.historical_finance_batches',
        'SELECT,INSERT,UPDATE,DELETE'
    ), 'Runtime must not access historical-finance batches directly';
    ASSERT NOT has_table_privilege(
        'stockiha_runtime',
        'onboarding.historical_finance_rows',
        'SELECT,INSERT,UPDATE,DELETE'
    ), 'Runtime must not access historical-finance rows directly';
    ASSERT NOT has_table_privilege(
        'stockiha_runtime',
        'onboarding.historical_finance_balances',
        'SELECT,INSERT,UPDATE,DELETE'
    ), 'Runtime must not access historical-finance balances directly';
    ASSERT NOT has_table_privilege(
        'stockiha_runtime',
        'onboarding.historical_finance_audit',
        'SELECT,INSERT,UPDATE,DELETE'
    ), 'Runtime must not access historical-finance audit directly';

    ASSERT has_function_privilege(
        'stockiha_runtime',
        'onboarding.create_historical_finance_batch(text,text,text,text)',
        'EXECUTE'
    ), 'Runtime must execute the guarded batch-creation function';
    ASSERT has_function_privilege(
        'stockiha_runtime',
        'onboarding.get_historical_finance_summary(text,date,date)',
        'EXECUTE'
    ), 'Runtime must execute the guarded report function';

    ASSERT EXISTS (
        SELECT 1
        FROM onboarding.historical_finance_audit
        WHERE batch_id = v_batch_id
          AND action_code = 'APPROVED'
          AND actor_id = v_admin_id
          AND workstation_id = 'R0-WKS'
    ), 'Approval must be audited with actor and workstation';
END;
$$;
