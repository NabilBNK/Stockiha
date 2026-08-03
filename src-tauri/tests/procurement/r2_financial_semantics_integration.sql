-- R2 financial-semantics regression: account roles, GRNI/AP flow,
-- post-invoice return, selected funding account, permissions, and detection.
\set ON_ERROR_STOP on

DO $$
DECLARE
    v_admin_id bigint;
    v_cashier_id bigint;
    v_admin_token text := 'r2_financial_admin_token';
    v_cashier_token text := 'r2_financial_cashier_token';
    v_supplier_id bigint;
    v_warehouse_id bigint;
    v_product_id bigint;
    v_variant_id bigint;
    v_period_id bigint;
    v_po_id bigint;
    v_receipt_id bigint;
    v_receipt_line_id bigint;
    v_invoice_id bigint;
    v_liability_id bigint;
    v_return_id bigint;
    v_journal_id bigint;
    v_result jsonb;
    v_outstanding numeric(14,2);
    v_denied boolean := false;
    v_detected boolean;
BEGIN
    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES ('r2_financial_admin', 'R2 Financial Admin', 'hash')
    RETURNING id INTO v_admin_id;
    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_admin_id, id FROM iam.roles WHERE code = 'ADMIN';
    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_admin_id, 'R2-WKS', sha256(v_admin_token::bytea), now() + interval '1 hour');

    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES ('r2_financial_cashier', 'R2 Financial Cashier', 'hash')
    RETURNING id INTO v_cashier_id;
    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_cashier_id, id FROM iam.roles WHERE code = 'CASHIER';
    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_cashier_id, 'R2-CASHIER-WKS', sha256(v_cashier_token::bytea), now() + interval '1 hour');

    SELECT id INTO v_period_id
    FROM finance.fiscal_periods
    WHERE status = 'OPEN' AND DATE '2026-03-01' BETWEEN starts_on AND ends_on
    ORDER BY starts_on DESC
    LIMIT 1;
    ASSERT v_period_id IS NOT NULL, 'R2 requires the CI open fiscal period';

    INSERT INTO procurement.suppliers (code, name, is_active)
    VALUES ('SUP-R2', 'R2 Supplier', true)
    RETURNING id INTO v_supplier_id;
    INSERT INTO inventory.warehouses (code, name, is_active)
    VALUES ('WH-R2', 'R2 Warehouse', true)
    RETURNING id INTO v_warehouse_id;
    INSERT INTO catalog.products (name, is_active)
    VALUES ('R2 Product', true)
    RETURNING id INTO v_product_id;
    INSERT INTO catalog.product_variants (product_id, base_unit_id, sku, sale_price, is_active)
    VALUES (v_product_id, 1, 'SKU-R2', 180.00, true)
    RETURNING id INTO v_variant_id;

    v_result := procurement.create_purchase_order_draft(
        v_admin_token, v_supplier_id, v_warehouse_id, 'R2 posting matrix',
        jsonb_build_array(jsonb_build_object(
            'variant_id', v_variant_id,
            'unit_id', 1,
            'quantity_ordered', 10,
            'unit_cost', 100.00
        ))
    );
    v_po_id := (v_result ->> 'document_id')::bigint;
    PERFORM procurement.confirm_purchase_order(v_admin_token, v_po_id);

    v_result := inventory.confirm_purchase_receipt(
        v_admin_token,
        'a1000000-0000-4000-8000-000000000001'::uuid,
        '\x01'::bytea,
        v_po_id,
        v_period_id,
        DATE '2026-03-01',
        jsonb_build_array(jsonb_build_object(
            'po_line_id', (SELECT id FROM procurement.purchase_order_lines WHERE document_id = v_po_id),
            'quantity_received', 10
        ))
    );
    v_receipt_id := (v_result ->> 'document_id')::bigint;
    v_journal_id := (v_result ->> 'journal_document_id')::bigint;

    ASSERT EXISTS (
        SELECT 1 FROM finance.journal_lines
        WHERE document_id = v_journal_id
          AND account_code = finance.require_account_role('INVENTORY')
          AND debit = 1000.00 AND credit = 0
    ), 'Receipt must debit Inventory';
    ASSERT EXISTS (
        SELECT 1 FROM finance.journal_lines
        WHERE document_id = v_journal_id
          AND account_code = finance.require_account_role('GRNI')
          AND debit = 0 AND credit = 1000.00
    ), 'Receipt must credit GRNI';
    ASSERT NOT EXISTS (
        SELECT 1 FROM procurement.supplier_liabilities WHERE receipt_document_id = v_receipt_id
    ), 'Receipt must not create AP';

    SELECT id INTO v_receipt_line_id
    FROM procurement.purchase_receipt_lines
    WHERE document_id = v_receipt_id;

    v_result := procurement.create_supplier_invoice_draft(
        v_admin_token, v_supplier_id, v_po_id, 'DZD', 1.000000,
        'R2 price variance invoice',
        jsonb_build_array(jsonb_build_object(
            'line_number', 1,
            'po_line_id', (SELECT id FROM procurement.purchase_order_lines WHERE document_id = v_po_id),
            'receipt_line_id', v_receipt_line_id,
            'variant_id', v_variant_id,
            'quantity', 10,
            'unit_cost', 105.00
        ))
    );
    v_invoice_id := (v_result ->> 'document_id')::bigint;

    BEGIN
        UPDATE procurement.supplier_invoices
        SET base_total_amount = base_subtotal + 1
        WHERE document_id = v_invoice_id;
    EXCEPTION WHEN check_violation THEN
        v_denied := true;
    END;
    ASSERT v_denied, 'Non-zero TVA/discount total divergence must be rejected';
    v_denied := false;

    BEGIN
        PERFORM procurement.confirm_supplier_invoice(
            v_cashier_token,
            'a1000000-0000-4000-8000-000000000002'::uuid,
            '\x02'::bytea,
            v_invoice_id,
            v_period_id,
            DATE '2026-03-02'
        );
    EXCEPTION WHEN insufficient_privilege THEN
        v_denied := true;
    END;
    ASSERT v_denied, 'Cashier must not confirm supplier invoice';

    v_result := procurement.confirm_supplier_invoice(
        v_admin_token,
        'a1000000-0000-4000-8000-000000000003'::uuid,
        '\x03'::bytea,
        v_invoice_id,
        v_period_id,
        DATE '2026-03-02'
    );
    v_journal_id := (v_result ->> 'journal_document_id')::bigint;

    ASSERT EXISTS (
        SELECT 1 FROM finance.journal_lines
        WHERE document_id = v_journal_id
          AND account_code = finance.require_account_role('GRNI')
          AND debit = 1000.00
    ), 'Invoice must debit GRNI at receipt value';
    ASSERT EXISTS (
        SELECT 1 FROM finance.journal_lines
        WHERE document_id = v_journal_id
          AND account_code = finance.require_account_role('PROCUREMENT_VARIANCE')
          AND debit = 50.00
    ), 'Invoice must debit positive purchase variance';
    ASSERT EXISTS (
        SELECT 1 FROM finance.journal_lines
        WHERE document_id = v_journal_id
          AND account_code = finance.require_account_role('ACCOUNTS_PAYABLE')
          AND credit = 1050.00
    ), 'Invoice must credit AP';

    SELECT id INTO v_liability_id
    FROM procurement.supplier_liabilities
    WHERE invoice_document_id = v_invoice_id;
    ASSERT v_liability_id IS NOT NULL, 'Invoice must create a supplier liability';

    v_result := procurement.create_supplier_return_draft(
        v_admin_token, v_supplier_id, v_warehouse_id, v_po_id,
        'DEFECTIVE_GOODS', 'R2 after-invoice return',
        jsonb_build_array(jsonb_build_object(
            'variant_id', v_variant_id,
            'quantity', 2,
            'unit_cost', 1
        ))
    );
    v_return_id := (v_result ->> 'document_id')::bigint;
    v_result := inventory.confirm_supplier_return(
        v_admin_token,
        'a1000000-0000-4000-8000-000000000004'::uuid,
        '\x04'::bytea,
        v_return_id,
        v_period_id,
        DATE '2026-03-03'
    );
    v_journal_id := (v_result ->> 'journal_document_id')::bigint;

    ASSERT EXISTS (
        SELECT 1 FROM finance.journal_lines
        WHERE document_id = v_journal_id
          AND account_code = finance.require_account_role('ACCOUNTS_PAYABLE')
          AND debit = 210.00
    ), 'Post-invoice return must debit AP at invoice value';
    ASSERT EXISTS (
        SELECT 1 FROM finance.journal_lines
        WHERE document_id = v_journal_id
          AND account_code = finance.require_account_role('INVENTORY')
          AND credit = 200.00
    ), 'Supplier return must credit inventory at WAC';
    ASSERT EXISTS (
        SELECT 1 FROM finance.journal_lines
        WHERE document_id = v_journal_id
          AND account_code = finance.require_account_role('PROCUREMENT_VARIANCE')
          AND credit = 10.00
    ), 'Supplier return must credit the value variance';

    SELECT outstanding_amount INTO v_outstanding
    FROM procurement.supplier_liabilities WHERE id = v_liability_id;
    ASSERT v_outstanding = 840.00, 'Return must reduce the invoice liability append-only';

    v_result := procurement.post_supplier_payment(
        v_admin_token,
        'a1000000-0000-4000-8000-000000000005'::uuid,
        '\x05'::bytea,
        v_supplier_id,
        v_liability_id,
        200.00,
        'BANK_TRANSFER',
        v_period_id,
        DATE '2026-03-04',
        'R2 bank payment'
    );
    v_journal_id := (v_result ->> 'journal_document_id')::bigint;
    ASSERT EXISTS (
        SELECT 1 FROM finance.journal_lines
        WHERE document_id = v_journal_id
          AND account_code = finance.require_account_role('BANK')
          AND credit = 200.00
    ), 'Bank payment must credit Bank, not Cash';
    ASSERT NOT EXISTS (
        SELECT 1 FROM finance.journal_lines
        WHERE document_id = v_journal_id
          AND account_code = finance.require_account_role('CASH')
    ), 'Bank payment must not touch Cash';

    ASSERT NOT has_table_privilege(
        'stockiha_runtime', 'procurement.supplier_liabilities', 'INSERT'
    ), 'Runtime must not directly insert supplier liabilities';
    ASSERT NOT has_table_privilege(
        'stockiha_runtime', 'procurement.supplier_liabilities', 'UPDATE'
    ), 'Runtime must not directly update supplier liabilities';

    -- Detection-only report proves old wrong-but-balanced receipt journals are
    -- surfaced without mutating or adopting them.
    v_journal_id := finance.create_posted_journal(
        DATE '2026-03-05', v_period_id, 'Purchase goods receipt',
        'PURCHASE_RECEIPT', v_receipt_id
    );
    INSERT INTO finance.journal_lines (document_id, line_number, account_code, debit, credit)
    VALUES
        (v_journal_id, 1, 'INVENTORY_MERCHANDISE', 1.00, 0),
        (v_journal_id, 2, 'ACCOUNTS_PAYABLE', 0, 1.00);

    SELECT EXISTS (
        SELECT 1 FROM finance.s3_semantic_defect_report
        WHERE defect_code = 'RECEIPT_POSTED_TO_AP'
          AND journal_document_id = v_journal_id
    ) INTO v_detected;
    ASSERT v_detected, 'Historical wrong receipt journal must be detected';

    RAISE NOTICE '=== ALL R2 FINANCIAL SEMANTICS ASSERTIONS PASSED ===';
END;
$$;
