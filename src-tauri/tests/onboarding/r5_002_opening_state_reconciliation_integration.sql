-- R5-002 current opening-state reconciliation regression.
-- Runs inside the transaction owned by run_current_sql_suites.sh.
\set ON_ERROR_STOP on

DO $$
DECLARE
    v_admin_id bigint;
    v_cashier_id bigint;
    v_admin_token text := 'r5_002_admin_token';
    v_cashier_token text := 'r5_002_cashier_token';
    v_package jsonb;
    v_replay jsonb;
    v_result jsonb;
    v_invalid jsonb;
    v_package_id bigint;
    v_invalid_package_id bigint;
    v_denied boolean := false;
    v_blocked boolean := false;
    v_cash_sales_before bigint;
    v_movements_before bigint;
    v_journals_before bigint;
BEGIN
    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES ('r5_002_admin', 'R5 Opening Admin', 'hash')
    RETURNING id INTO v_admin_id;
    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_admin_id, id FROM iam.roles WHERE code = 'ADMIN';
    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_admin_id, 'R5-OPENING-WKS', sha256(v_admin_token::bytea), now() + interval '1 hour');

    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES ('r5_002_cashier', 'R5 Opening Cashier', 'hash')
    RETURNING id INTO v_cashier_id;
    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_cashier_id, id FROM iam.roles WHERE code = 'CASHIER';
    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_cashier_id, 'R5-CASHIER-WKS', sha256(v_cashier_token::bytea), now() + interval '1 hour');

    ASSERT EXISTS (
        SELECT 1
        FROM iam.user_roles ur
        JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
        JOIN iam.permissions p ON p.id = rp.permission_id
        WHERE ur.user_id = v_admin_id
          AND p.code IN (
              'MANAGE_OPENING_STATE_RECONCILIATION',
              'REVIEW_OPENING_STATE_RECONCILIATION'
          )
        GROUP BY ur.user_id
        HAVING count(*) = 2
    ), 'ADMIN must receive opening-state manage and review permissions';

    ASSERT NOT EXISTS (
        SELECT 1
        FROM iam.user_roles ur
        JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
        JOIN iam.permissions p ON p.id = rp.permission_id
        WHERE ur.user_id = v_cashier_id
          AND p.code IN (
              'MANAGE_OPENING_STATE_RECONCILIATION',
              'REVIEW_OPENING_STATE_RECONCILIATION'
          )
    ), 'CASHIER must not receive opening-state permissions';

    ASSERT (onboarding.get_opening_state_setting(v_admin_token) ->> 'enabled')::boolean,
        'Opening-state reconciliation must default ON';

    BEGIN
        PERFORM onboarding.get_opening_state_setting(v_cashier_token);
    EXCEPTION WHEN insufficient_privilege THEN
        v_denied := true;
    END;
    ASSERT v_denied, 'Cashier must not read opening-state settings';

    SELECT count(*) INTO v_cash_sales_before FROM sales.cash_sales;
    SELECT count(*) INTO v_movements_before FROM inventory.movements;
    SELECT count(*) INTO v_journals_before FROM finance.journal_entries;

    v_package := onboarding.create_opening_state_package(
        v_admin_token,
        'r5-opening-0001',
        'MANUAL',
        NULL,
        DATE '2026-08-05'
    );
    v_package_id := (v_package ->> 'packageId')::bigint;

    ASSERT v_package ->> 'status' = 'DRAFT', 'Opening-state package must start DRAFT';
    ASSERT NOT (v_package ->> 'isReplay')::boolean, 'First package request must not be replay';

    v_replay := onboarding.create_opening_state_package(
        v_admin_token,
        'r5-opening-0001',
        'MANUAL',
        NULL,
        DATE '2026-08-05'
    );
    ASSERT (v_replay ->> 'packageId')::bigint = v_package_id,
        'Exact request replay must return the existing package';
    ASSERT (v_replay ->> 'isReplay')::boolean,
        'Exact request replay must be marked replay';

    PERFORM onboarding.replace_opening_state_package_data(
        v_admin_token,
        v_package_id,
        jsonb_build_array(
            jsonb_build_object(
                'source_row_number', 2,
                'line_type', 'CASH',
                'description', 'Cash on hand at cutover',
                'amount_dzd', 10000,
                'review_status', 'READY'
            ),
            jsonb_build_object(
                'source_row_number', 3,
                'line_type', 'BANK',
                'description', 'Bank balance at cutover',
                'amount_dzd', 5000,
                'review_status', 'READY'
            ),
            jsonb_build_object(
                'source_row_number', 4,
                'line_type', 'INVENTORY_VALUE',
                'description', 'Current inventory financial value',
                'amount_dzd', 20000,
                'review_status', 'READY'
            ),
            jsonb_build_object(
                'source_row_number', 5,
                'line_type', 'CUSTOMER_RECEIVABLE',
                'description', 'Outstanding customer balance',
                'amount_dzd', 7000,
                'counterparty_name', 'Customer A',
                'review_status', 'READY'
            ),
            jsonb_build_object(
                'source_row_number', 6,
                'line_type', 'SUPPLIER_PAYABLE',
                'description', 'Outstanding supplier balance',
                'amount_dzd', 8000,
                'counterparty_name', 'Supplier A',
                'review_status', 'READY'
            ),
            jsonb_build_object(
                'source_row_number', 7,
                'line_type', 'LOAN_PAYABLE',
                'description', 'Outstanding loan',
                'amount_dzd', 4000,
                'review_status', 'READY'
            ),
            jsonb_build_object(
                'source_row_number', 8,
                'line_type', 'TAX_PAYABLE',
                'description', 'Tax payable at cutover',
                'amount_dzd', 1000,
                'review_status', 'READY'
            ),
            jsonb_build_object(
                'source_row_number', 9,
                'line_type', 'OWNER_CAPITAL',
                'description', 'Owner capital and accumulated result',
                'amount_dzd', 29000,
                'review_status', 'READY'
            )
        )
    );

    v_result := onboarding.validate_opening_state_package(v_admin_token, v_package_id);
    ASSERT v_result ->> 'status' = 'VALIDATED',
        'Balanced current opening state must validate';
    ASSERT (v_result ->> 'rowCount')::integer = 8,
        'Validation must count every opening-state line';
    ASSERT (v_result ->> 'invalidRowCount')::integer = 0,
        'Valid opening state must have no invalid rows';
    ASSERT (v_result ->> 'totalAssetsDzd')::bigint = 42000,
        'Assets must include cash, bank, inventory, and customer receivables';
    ASSERT (v_result ->> 'totalLiabilitiesDzd')::bigint = 13000,
        'Liabilities must include supplier, loan, and tax balances';
    ASSERT (v_result ->> 'totalEquityDzd')::bigint = 29000,
        'Equity must be calculated independently';
    ASSERT (v_result ->> 'reconciliationDifferenceDzd')::bigint = 0,
        'Accounting equation must reconcile to zero';
    ASSERT jsonb_array_length(v_result -> 'validationErrors') = 0,
        'Balanced package must have no package validation errors';

    v_result := onboarding.approve_opening_state_package(v_admin_token, v_package_id);
    ASSERT v_result ->> 'status' = 'APPROVED_FOR_APPLICATION',
        'Reconciled package must become ready for later application';
    ASSERT NOT (v_result ->> 'isReplay')::boolean,
        'First approval must not be replay';

    v_result := onboarding.approve_opening_state_package(v_admin_token, v_package_id);
    ASSERT (v_result ->> 'isReplay')::boolean,
        'Repeated approval must be replay-safe';

    v_result := onboarding.get_opening_state_package(v_admin_token, v_package_id);
    ASSERT v_result ->> 'status' = 'APPROVED_FOR_APPLICATION',
        'Approved package must remain queryable';
    ASSERT v_result ->> 'cutoverDate' = '2026-08-05',
        'Cutover date must remain immutable';

    -- Approval in this slice is evidence-only and must not touch live ledgers.
    ASSERT (SELECT count(*) FROM sales.cash_sales) = v_cash_sales_before,
        'Opening-state approval must not create live sales';
    ASSERT (SELECT count(*) FROM inventory.movements) = v_movements_before,
        'Opening-state approval must not create stock movements';
    ASSERT (SELECT count(*) FROM finance.journal_entries) = v_journals_before,
        'Opening-state approval must not create finance journals';

    -- Missing supplier identity and an unbalanced equation must require review.
    v_invalid := onboarding.create_opening_state_package(
        v_admin_token,
        'r5-opening-0002',
        'MANUAL',
        NULL,
        DATE '2026-08-06'
    );
    v_invalid_package_id := (v_invalid ->> 'packageId')::bigint;

    PERFORM onboarding.replace_opening_state_package_data(
        v_admin_token,
        v_invalid_package_id,
        jsonb_build_array(
            jsonb_build_object(
                'source_row_number', 2,
                'line_type', 'CASH',
                'description', 'Cash',
                'amount_dzd', 1000,
                'review_status', 'READY'
            ),
            jsonb_build_object(
                'source_row_number', 3,
                'line_type', 'BANK',
                'description', 'Bank',
                'amount_dzd', 0,
                'review_status', 'READY'
            ),
            jsonb_build_object(
                'source_row_number', 4,
                'line_type', 'INVENTORY_VALUE',
                'description', 'Inventory',
                'amount_dzd', 0,
                'review_status', 'READY'
            ),
            jsonb_build_object(
                'source_row_number', 5,
                'line_type', 'SUPPLIER_PAYABLE',
                'description', 'Unknown supplier payable',
                'amount_dzd', 400,
                'review_status', 'READY'
            ),
            jsonb_build_object(
                'source_row_number', 6,
                'line_type', 'OWNER_CAPITAL',
                'description', 'Owner capital',
                'amount_dzd', 500,
                'review_status', 'READY'
            )
        )
    );

    v_result := onboarding.validate_opening_state_package(v_admin_token, v_invalid_package_id);
    ASSERT v_result ->> 'status' = 'NEEDS_REVIEW',
        'Incomplete or unbalanced package must require review';
    ASSERT (v_result ->> 'invalidRowCount')::integer = 1,
        'Missing supplier identity must mark its row invalid';
    ASSERT (v_result ->> 'reconciliationDifferenceDzd')::bigint = 100,
        'Validation must expose the exact accounting-equation difference';
    ASSERT (v_result -> 'validationErrors') ? 'ACCOUNTING_EQUATION_NOT_BALANCED',
        'Package errors must explain the non-zero reconciliation difference';

    BEGIN
        PERFORM onboarding.approve_opening_state_package(v_admin_token, v_invalid_package_id);
    EXCEPTION WHEN object_not_in_prerequisite_state THEN
        v_blocked := true;
    END;
    ASSERT v_blocked, 'Package with reconciliation defects must not be approved';

    PERFORM onboarding.update_opening_state_setting(v_admin_token, false);
    v_blocked := false;
    BEGIN
        PERFORM onboarding.create_opening_state_package(
            v_admin_token,
            'r5-disabled-0003',
            'MANUAL',
            NULL,
            DATE '2026-08-07'
        );
    EXCEPTION WHEN object_not_in_prerequisite_state THEN
        v_blocked := true;
    END;
    ASSERT v_blocked, 'Disabled opening-state feature must block new packages';

    -- Existing approved evidence remains readable while new work is disabled.
    v_result := onboarding.get_opening_state_package(v_admin_token, v_package_id);
    ASSERT v_result ->> 'status' = 'APPROVED_FOR_APPLICATION',
        'Disabling new reconciliation must not delete approved evidence';
    PERFORM onboarding.update_opening_state_setting(v_admin_token, true);

    ASSERT NOT has_table_privilege(
        'stockiha_runtime',
        'onboarding.opening_state_packages',
        'SELECT,INSERT,UPDATE,DELETE'
    ), 'Runtime must not access opening-state packages directly';
    ASSERT NOT has_table_privilege(
        'stockiha_runtime',
        'onboarding.opening_state_lines',
        'SELECT,INSERT,UPDATE,DELETE'
    ), 'Runtime must not access opening-state lines directly';
    ASSERT NOT has_table_privilege(
        'stockiha_runtime',
        'onboarding.opening_state_audit',
        'SELECT,INSERT,UPDATE,DELETE'
    ), 'Runtime must not access opening-state audit directly';

    ASSERT has_function_privilege(
        'stockiha_runtime',
        'onboarding.create_opening_state_package(text,text,text,text,date)',
        'EXECUTE'
    ), 'Runtime must execute only the guarded package function';

    ASSERT has_table_privilege(
        'stockiha_backup',
        'onboarding.opening_state_packages',
        'SELECT'
    ), 'Backup role must read opening-state packages';
    ASSERT NOT has_table_privilege(
        'stockiha_backup',
        'onboarding.opening_state_packages',
        'INSERT,UPDATE,DELETE'
    ), 'Backup role must remain read-only';

    ASSERT EXISTS (
        SELECT 1
        FROM onboarding.opening_state_audit
        WHERE package_id = v_package_id
          AND action_code = 'APPROVED'
          AND actor_id = v_admin_id
          AND workstation_id = 'R5-OPENING-WKS'
    ), 'Opening-state approval must be audited';

    ASSERT EXISTS (
        SELECT 1
        FROM onboarding.opening_state_audit
        WHERE package_id IS NULL
          AND action_code = 'SETTING_CHANGED'
          AND actor_id = v_admin_id
    ), 'Opening-state setting changes must be audited';
END;
$$;
