-- R5-003 approved opening-state application regression.
-- Runs inside the transaction owned by run_current_sql_suites.sh.
\set ON_ERROR_STOP on

DO $$
DECLARE
    v_admin_id bigint;
    v_cashier_id bigint;
    v_admin_token text := 'r5_003_apply_admin_token';
    v_cashier_token text := 'r5_003_apply_cashier_token';
    v_customer_id bigint;
    v_supplier_id bigint;
    v_period_id bigint;
    v_package jsonb;
    v_validation jsonb;
    v_approval jsonb;
    v_context jsonb;
    v_result jsonb;
    v_replay jsonb;
    v_package_id bigint;
    v_customer_line_id bigint;
    v_supplier_line_id bigint;
    v_application_id bigint;
    v_journal_id bigint;
    v_denied boolean := false;
    v_blocked boolean := false;
    v_immutable boolean := false;
    v_movements_before bigint;
    v_positions_before bigint;
    v_sales_before bigint;
    v_purchase_receipts_before bigint;
BEGIN
    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES ('r5_003_apply_admin', 'R5 Apply Admin', 'hash')
    RETURNING id INTO v_admin_id;
    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_admin_id, id FROM iam.roles WHERE code = 'ADMIN';
    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (
        v_admin_id,
        'R5-APPLY-WKS',
        sha256(v_admin_token::bytea),
        now() + interval '1 hour'
    );

    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES ('r5_003_apply_cashier', 'R5 Apply Cashier', 'hash')
    RETURNING id INTO v_cashier_id;
    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_cashier_id, id FROM iam.roles WHERE code = 'CASHIER';
    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (
        v_cashier_id,
        'R5-APPLY-CASHIER-WKS',
        sha256(v_cashier_token::bytea),
        now() + interval '1 hour'
    );

    ASSERT EXISTS (
        SELECT 1
        FROM iam.user_roles ur
        JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
        JOIN iam.permissions p ON p.id = rp.permission_id
        WHERE ur.user_id = v_admin_id
          AND p.code = 'APPLY_OPENING_STATE'
    ), 'ADMIN must receive APPLY_OPENING_STATE';

    ASSERT NOT EXISTS (
        SELECT 1
        FROM iam.user_roles ur
        JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
        JOIN iam.permissions p ON p.id = rp.permission_id
        WHERE ur.user_id = v_cashier_id
          AND p.code = 'APPLY_OPENING_STATE'
    ), 'CASHIER must not receive APPLY_OPENING_STATE';

    INSERT INTO receivables.customers (
        code, name, is_active, credit_enabled, credit_limit, payment_terms_days
    ) VALUES (
        'R5-CUST-001', 'Opening Customer', true, true, 1000000, 30
    ) RETURNING id INTO v_customer_id;

    INSERT INTO procurement.suppliers (code, name, is_active)
    VALUES ('R5-SUP-001', 'Opening Supplier', true)
    RETURNING id INTO v_supplier_id;

    SELECT id INTO v_period_id
    FROM finance.fiscal_periods
    WHERE DATE '2026-08-05' BETWEEN starts_on AND ends_on
      AND status = 'OPEN'
    ORDER BY id
    LIMIT 1;

    IF v_period_id IS NULL THEN
        INSERT INTO finance.fiscal_periods (
            period_code, starts_on, ends_on, status
        ) VALUES (
            'R5-APPLY-2026', DATE '2026-01-01', DATE '2026-12-31', 'OPEN'
        ) RETURNING id INTO v_period_id;
    END IF;

    SELECT count(*) INTO v_movements_before FROM inventory.movements;
    SELECT count(*) INTO v_positions_before FROM inventory.positions;
    SELECT count(*) INTO v_sales_before FROM sales.cash_sales;
    SELECT count(*) INTO v_purchase_receipts_before FROM procurement.purchase_receipts;

    v_package := onboarding.create_opening_state_package(
        v_admin_token,
        'r5-apply-opening-0001',
        'MANUAL',
        NULL,
        DATE '2026-08-05'
    );
    v_package_id := (v_package ->> 'packageId')::bigint;

    PERFORM onboarding.replace_opening_state_package_data(
        v_admin_token,
        v_package_id,
        jsonb_build_array(
            jsonb_build_object(
                'source_row_number', 2,
                'line_type', 'CASH',
                'description', 'Cash on hand',
                'amount_dzd', 10000,
                'review_status', 'READY'
            ),
            jsonb_build_object(
                'source_row_number', 3,
                'line_type', 'BANK',
                'description', 'Bank balance',
                'amount_dzd', 5000,
                'review_status', 'READY'
            ),
            jsonb_build_object(
                'source_row_number', 4,
                'line_type', 'INVENTORY_VALUE',
                'description', 'Inventory financial value',
                'amount_dzd', 20000,
                'review_status', 'READY'
            ),
            jsonb_build_object(
                'source_row_number', 5,
                'line_type', 'CUSTOMER_RECEIVABLE',
                'description', 'Opening customer balance',
                'amount_dzd', 7000,
                'counterparty_name', 'Opening Customer evidence',
                'review_status', 'READY'
            ),
            jsonb_build_object(
                'source_row_number', 6,
                'line_type', 'SUPPLIER_PAYABLE',
                'description', 'Opening supplier balance',
                'amount_dzd', 8000,
                'counterparty_name', 'Opening Supplier evidence',
                'review_status', 'READY'
            ),
            jsonb_build_object(
                'source_row_number', 7,
                'line_type', 'LOAN_PAYABLE',
                'description', 'Opening loan',
                'amount_dzd', 4000,
                'review_status', 'READY'
            ),
            jsonb_build_object(
                'source_row_number', 8,
                'line_type', 'TAX_PAYABLE',
                'description', 'Opening tax payable',
                'amount_dzd', 1000,
                'review_status', 'READY'
            ),
            jsonb_build_object(
                'source_row_number', 9,
                'line_type', 'OWNER_CAPITAL',
                'description', 'Opening owner capital',
                'amount_dzd', 29000,
                'review_status', 'READY'
            )
        )
    );

    v_validation := onboarding.validate_opening_state_package(v_admin_token, v_package_id);
    ASSERT v_validation ->> 'status' = 'VALIDATED',
        'Balanced package must validate before application';

    v_approval := onboarding.approve_opening_state_package(v_admin_token, v_package_id);
    ASSERT v_approval ->> 'status' = 'APPROVED_FOR_APPLICATION',
        'Package must be approved for application';

    ASSERT NOT EXISTS (
        SELECT 1 FROM onboarding.opening_state_lines
        WHERE package_id = v_package_id
          AND review_status <> 'APPROVED'
    ), 'Approval must finalize every opening-state line';

    SELECT id INTO v_customer_line_id
    FROM onboarding.opening_state_lines
    WHERE package_id = v_package_id AND line_type = 'CUSTOMER_RECEIVABLE';

    SELECT id INTO v_supplier_line_id
    FROM onboarding.opening_state_lines
    WHERE package_id = v_package_id AND line_type = 'SUPPLIER_PAYABLE';

    v_context := onboarding.get_opening_state_application_context(v_admin_token);
    ASSERT (v_context ->> 'hasApprovedPackage')::boolean,
        'Application context must expose the approved package to ADMIN';
    ASSERT NOT (v_context ->> 'applied')::boolean,
        'Approved package must initially be unapplied';
    ASSERT jsonb_array_length(v_context -> 'lines') = 8,
        'Application context must expose every approved evidence line';

    BEGIN
        PERFORM onboarding.get_opening_state_application_context(v_cashier_token);
    EXCEPTION WHEN insufficient_privilege THEN
        v_denied := true;
    END;
    ASSERT v_denied, 'Cashier must not access opening-state application context';

    -- Feature toggle blocks application without mutating evidence.
    PERFORM onboarding.update_opening_state_application_setting(v_admin_token, false);
    BEGIN
        PERFORM onboarding.apply_opening_state(
            v_admin_token,
            '550e8400-e29b-41d4-a716-446655440001'::uuid,
            sha256('r5-apply-disabled'::bytea),
            v_package_id,
            v_period_id,
            jsonb_build_array(
                jsonb_build_object('line_id', v_customer_line_id, 'customer_id', v_customer_id),
                jsonb_build_object('line_id', v_supplier_line_id, 'supplier_id', v_supplier_id)
            )
        );
    EXCEPTION WHEN object_not_in_prerequisite_state THEN
        v_blocked := true;
    END;
    ASSERT v_blocked, 'Disabled application feature must block posting';
    ASSERT NOT EXISTS (
        SELECT 1 FROM onboarding.opening_state_applications WHERE package_id = v_package_id
    ), 'Blocked application must leave no application row';
    PERFORM onboarding.update_opening_state_application_setting(v_admin_token, true);

    -- Missing party mappings fail before any journal or subledger write.
    v_blocked := false;
    BEGIN
        PERFORM onboarding.apply_opening_state(
            v_admin_token,
            '550e8400-e29b-41d4-a716-446655440002'::uuid,
            sha256('r5-apply-missing-map'::bytea),
            v_package_id,
            v_period_id,
            '[]'::jsonb
        );
    EXCEPTION WHEN invalid_parameter_value THEN
        v_blocked := true;
    END;
    ASSERT v_blocked, 'Missing customer/supplier mappings must block posting';
    ASSERT NOT EXISTS (
        SELECT 1 FROM onboarding.opening_state_applications WHERE package_id = v_package_id
    ), 'Mapping validation failure must roll back the idempotency reservation';

    -- Closed period blocks the same package before posting.
    UPDATE finance.fiscal_periods SET status = 'SOFT_CLOSED' WHERE id = v_period_id;
    v_blocked := false;
    BEGIN
        PERFORM onboarding.apply_opening_state(
            v_admin_token,
            '550e8400-e29b-41d4-a716-446655440003'::uuid,
            sha256('r5-apply-closed-period'::bytea),
            v_package_id,
            v_period_id,
            jsonb_build_array(
                jsonb_build_object('line_id', v_customer_line_id, 'customer_id', v_customer_id),
                jsonb_build_object('line_id', v_supplier_line_id, 'supplier_id', v_supplier_id)
            )
        );
    EXCEPTION WHEN object_not_in_prerequisite_state THEN
        v_blocked := true;
    END;
    ASSERT v_blocked, 'Closed fiscal period must block opening-state application';
    UPDATE finance.fiscal_periods SET status = 'OPEN' WHERE id = v_period_id;

    v_result := onboarding.apply_opening_state(
        v_admin_token,
        '550e8400-e29b-41d4-a716-446655440004'::uuid,
        sha256('r5-apply-success-payload'::bytea),
        v_package_id,
        v_period_id,
        jsonb_build_array(
            jsonb_build_object('line_id', v_customer_line_id, 'customer_id', v_customer_id),
            jsonb_build_object('line_id', v_supplier_line_id, 'supplier_id', v_supplier_id)
        )
    );

    v_application_id := (v_result ->> 'applicationId')::bigint;
    v_journal_id := (v_result ->> 'journalDocumentId')::bigint;

    ASSERT v_result ->> 'status' = 'APPLIED', 'Application must finish APPLIED';
    ASSERT NOT (v_result ->> 'isReplay')::boolean, 'First application is not a replay';
    ASSERT (v_result ->> 'physicalInventoryIncomplete')::boolean,
        'Value-only inventory must explicitly remain physically incomplete';

    ASSERT EXISTS (
        SELECT 1
        FROM onboarding.opening_state_applications application
        WHERE application.id = v_application_id
          AND application.package_id = v_package_id
          AND application.journal_document_id = v_journal_id
          AND application.status = 'APPLIED'
    ), 'Application evidence must link package and journal';

    ASSERT EXISTS (
        SELECT 1 FROM finance.journal_entries
        WHERE document_id = v_journal_id
          AND source_type = 'OPENING_STATE'
          AND source_id = v_application_id
    ), 'Opening journal must carry a stable source link';

    ASSERT (
        SELECT count(*) FROM finance.journal_lines WHERE document_id = v_journal_id
    ) = 8, 'Every non-zero approved opening line must remain traceable in the journal';

    ASSERT (
        SELECT sum(debit) = sum(credit)
        FROM finance.journal_lines
        WHERE document_id = v_journal_id
    ), 'Opening journal must balance exactly';

    ASSERT EXISTS (
        SELECT 1 FROM finance.journal_lines
        WHERE document_id = v_journal_id
          AND account_code = 'CASH_DESK'
          AND debit = 10000
          AND credit = 0
    ), 'Cash must debit the controlled cash account';

    ASSERT EXISTS (
        SELECT 1 FROM finance.journal_lines
        WHERE document_id = v_journal_id
          AND account_code = 'ACCOUNTS_RECEIVABLE'
          AND debit = 7000
          AND credit = 0
    ), 'Customer receivable must debit Accounts Receivable';

    ASSERT EXISTS (
        SELECT 1 FROM finance.journal_lines
        WHERE document_id = v_journal_id
          AND account_code = 'ACCOUNTS_PAYABLE'
          AND debit = 0
          AND credit = 8000
    ), 'Supplier payable must credit Accounts Payable';

    ASSERT EXISTS (
        SELECT 1
        FROM receivables.customer_ledger_entries entry
        WHERE entry.customer_id = v_customer_id
          AND entry.document_id = v_journal_id
          AND entry.entry_type = 'ADJUSTMENT'
          AND entry.amount_delta = 7000
    ), 'Opening customer receivable must enter the live customer subledger';

    ASSERT (
        SELECT exposure_amount
        FROM receivables.customer_credit_state
        WHERE customer_id = v_customer_id
    ) = 7000, 'Opening receivable must update customer exposure';

    ASSERT EXISTS (
        SELECT 1
        FROM procurement.supplier_liabilities liability
        WHERE liability.supplier_id = v_supplier_id
          AND liability.opening_state_application_id = v_application_id
          AND liability.journal_document_id = v_journal_id
          AND liability.original_amount = 8000
          AND liability.outstanding_amount = 8000
          AND liability.status = 'UNPAID'
    ), 'Opening supplier payable must enter the live supplier subledger';

    ASSERT (
        SELECT count(*) FROM inventory.movements
    ) = v_movements_before, 'Inventory value must not fabricate stock movements';
    ASSERT (
        SELECT count(*) FROM inventory.positions
    ) = v_positions_before, 'Inventory value must not fabricate stock positions';
    ASSERT (
        SELECT count(*) FROM sales.cash_sales
    ) = v_sales_before, 'Opening state must not create live sales';
    ASSERT (
        SELECT count(*) FROM procurement.purchase_receipts
    ) = v_purchase_receipts_before, 'Opening state must not create purchase receipts';

    v_replay := onboarding.apply_opening_state(
        v_admin_token,
        '550e8400-e29b-41d4-a716-446655440004'::uuid,
        sha256('r5-apply-success-payload'::bytea),
        v_package_id,
        v_period_id,
        jsonb_build_array(
            jsonb_build_object('line_id', v_customer_line_id, 'customer_id', v_customer_id),
            jsonb_build_object('line_id', v_supplier_line_id, 'supplier_id', v_supplier_id)
        )
    );
    ASSERT (v_replay ->> 'isReplay')::boolean,
        'Exact application replay must return the existing result';
    ASSERT (v_replay ->> 'journalDocumentId')::bigint = v_journal_id,
        'Replay must return the original journal';

    v_blocked := false;
    BEGIN
        PERFORM onboarding.apply_opening_state(
            v_admin_token,
            '550e8400-e29b-41d4-a716-446655440005'::uuid,
            sha256('r5-apply-conflict'::bytea),
            v_package_id,
            v_period_id,
            jsonb_build_array(
                jsonb_build_object('line_id', v_customer_line_id, 'customer_id', v_customer_id),
                jsonb_build_object('line_id', v_supplier_line_id, 'supplier_id', v_supplier_id)
            )
        );
    EXCEPTION WHEN unique_violation THEN
        v_blocked := true;
    END;
    ASSERT v_blocked, 'A second application request for the package must be rejected';

    BEGIN
        UPDATE onboarding.opening_state_applications
        SET total_assets_dzd = total_assets_dzd + 1
        WHERE id = v_application_id;
    EXCEPTION WHEN feature_not_supported THEN
        v_immutable := true;
    END;
    ASSERT v_immutable, 'Applied application evidence must be immutable';

    v_immutable := false;
    BEGIN
        UPDATE onboarding.opening_state_application_lines
        SET description = 'mutated'
        WHERE application_id = v_application_id
        LIMIT 1;
    EXCEPTION WHEN syntax_error_or_access_rule_violation THEN
        -- PostgreSQL does not support UPDATE ... LIMIT. Keep the actual
        -- immutable assertion below using a deterministic line id.
        NULL;
    END;
    BEGIN
        UPDATE onboarding.opening_state_application_lines
        SET description = 'mutated'
        WHERE id = (
            SELECT min(id) FROM onboarding.opening_state_application_lines
            WHERE application_id = v_application_id
        );
    EXCEPTION WHEN feature_not_supported THEN
        v_immutable := true;
    END;
    ASSERT v_immutable, 'Applied line snapshots must be immutable';

    ASSERT NOT has_table_privilege(
        'stockiha_runtime',
        'onboarding.opening_state_applications',
        'SELECT,INSERT,UPDATE,DELETE'
    ), 'Runtime must not directly access application evidence';

    ASSERT has_table_privilege(
        'stockiha_backup',
        'onboarding.opening_state_applications',
        'SELECT'
    ), 'Backup role must read application evidence';
    ASSERT NOT has_table_privilege(
        'stockiha_backup',
        'onboarding.opening_state_applications',
        'INSERT,UPDATE,DELETE'
    ), 'Backup role must remain read-only';

    ASSERT EXISTS (
        SELECT 1
        FROM onboarding.opening_state_application_audit audit
        WHERE audit.application_id = v_application_id
          AND audit.action_code = 'APPLICATION_POSTED'
          AND audit.actor_id = v_admin_id
          AND audit.workstation_id = 'R5-APPLY-WKS'
    ), 'Successful application must be audited';
END;
$$;
