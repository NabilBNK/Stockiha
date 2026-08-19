-- R8-E deterministic procurement acceptance journey.
-- Proves secure projections, GRNI/AP semantics, exact inventory values,
-- landed cost, three-way match, supplier return, payment allocation,
-- idempotency, permission denial, and open-payable filtering.
\set ON_ERROR_STOP on

DO $$
DECLARE
    v_suffix text := floor(random() * 1000000000)::text;
    v_admin_id bigint;
    v_cashier_id bigint;
    v_admin_token text := 'r8e_admin_' || floor(random() * 1000000000)::text;
    v_cashier_token text := 'r8e_cashier_' || floor(random() * 1000000000)::text;
    v_supplier_id bigint;
    v_warehouse_id bigint;
    v_product_id bigint;
    v_variant_id bigint;
    v_unit_id bigint;
    v_period_id bigint;
    v_document_date date;
    v_po_id bigint;
    v_receipt_id bigint;
    v_receipt_line_id bigint;
    v_landed_liability_id bigint;
    v_invoice_id bigint;
    v_invoice_liability_id bigint;
    v_return_id bigint;
    v_payment_id bigint;
    v_result jsonb;
    v_repeat jsonb;
    v_rows jsonb;
    v_qty numeric;
    v_value numeric;
    v_wac numeric;
    v_outstanding numeric;
    v_denied boolean := false;
BEGIN
    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES ('r8e_admin_' || v_suffix, 'R8-E Admin', 'hash')
    RETURNING id INTO v_admin_id;
    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_admin_id, id FROM iam.roles WHERE code = 'ADMIN';
    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_admin_id, 'R8E-ADMIN', sha256(v_admin_token::bytea), now() + interval '2 hours');

    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES ('r8e_cashier_' || v_suffix, 'R8-E Cashier', 'hash')
    RETURNING id INTO v_cashier_id;
    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_cashier_id, id FROM iam.roles WHERE code = 'CASHIER';
    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_cashier_id, 'R8E-CASHIER', sha256(v_cashier_token::bytea), now() + interval '2 hours');

    SELECT id, starts_on + 1
    INTO v_period_id, v_document_date
    FROM finance.fiscal_periods
    WHERE status = 'OPEN'
    ORDER BY starts_on DESC
    LIMIT 1;
    ASSERT v_period_id IS NOT NULL, 'R8-E requires an open fiscal period';

    SELECT id INTO v_unit_id FROM catalog.units ORDER BY id LIMIT 1;
    ASSERT v_unit_id IS NOT NULL, 'R8-E requires one catalog unit';

    INSERT INTO procurement.suppliers (code, name, is_active)
    VALUES ('SUP-R8E-' || v_suffix, 'R8-E Procurement Supplier', true)
    RETURNING id INTO v_supplier_id;
    INSERT INTO inventory.warehouses (code, name, is_active)
    VALUES ('WH-R8E-' || v_suffix, 'R8-E Warehouse', true)
    RETURNING id INTO v_warehouse_id;
    INSERT INTO catalog.products (name, is_active)
    VALUES ('R8-E Procurement Item', true)
    RETURNING id INTO v_product_id;
    INSERT INTO catalog.product_variants (product_id, base_unit_id, sku, sale_price, is_active)
    VALUES (v_product_id, v_unit_id, 'R8E-SKU-' || v_suffix, 180.00, true)
    RETURNING id INTO v_variant_id;

    v_result := procurement.get_capabilities(v_admin_token);
    ASSERT (v_result ->> 'can_manage_procurement')::boolean, 'Admin must manage procurement';
    ASSERT (v_result ->> 'can_post_purchase_receipt')::boolean, 'Admin must post purchase receipts';
    ASSERT (v_result ->> 'can_post_supplier_invoice')::boolean, 'Admin must post supplier invoices';
    ASSERT (v_result ->> 'can_post_supplier_return')::boolean, 'Admin must post supplier returns';
    ASSERT (v_result ->> 'can_post_supplier_payment')::boolean, 'Admin must post supplier payments';

    v_result := procurement.get_capabilities(v_cashier_token);
    ASSERT NOT (v_result ->> 'can_manage_procurement')::boolean, 'Cashier procurement UI must safe-deny';
    ASSERT NOT (v_result ->> 'can_post_supplier_payment')::boolean, 'Cashier supplier payment must safe-deny';

    BEGIN
        PERFORM procurement.list_purchase_receipt_lines(v_cashier_token, NULL);
    EXCEPTION WHEN insufficient_privilege THEN
        v_denied := true;
    END;
    ASSERT v_denied, 'Cashier must not read procurement receipt-line projections';
    v_denied := false;

    BEGIN
        PERFORM procurement.list_supplier_returns(v_cashier_token, NULL);
    EXCEPTION WHEN insufficient_privilege THEN
        v_denied := true;
    END;
    ASSERT v_denied, 'Cashier must not read supplier returns';
    v_denied := false;

    BEGIN
        PERFORM procurement.list_supplier_payments(v_cashier_token, NULL);
    EXCEPTION WHEN insufficient_privilege THEN
        v_denied := true;
    END;
    ASSERT v_denied, 'Cashier must not read supplier payments';

    v_result := procurement.create_purchase_order_draft(
        v_admin_token,
        v_supplier_id,
        v_warehouse_id,
        'R8-E deterministic purchase order',
        jsonb_build_array(jsonb_build_object(
            'variant_id', v_variant_id,
            'unit_id', v_unit_id,
            'quantity_ordered', 10.000,
            'unit_cost', 100.00
        ))
    );
    v_po_id := (v_result ->> 'document_id')::bigint;
    PERFORM procurement.confirm_purchase_order(v_admin_token, v_po_id);

    v_result := inventory.confirm_purchase_receipt(
        v_admin_token,
        'e1000000-0000-4000-8000-000000000001'::uuid,
        '\x01'::bytea,
        v_po_id,
        v_period_id,
        v_document_date,
        jsonb_build_array(jsonb_build_object(
            'po_line_id', (
                SELECT id FROM procurement.purchase_order_lines
                WHERE document_id = v_po_id AND line_number = 1
            ),
            'quantity_received', 10.000
        ))
    );
    v_receipt_id := (v_result ->> 'document_id')::bigint;
    v_repeat := inventory.confirm_purchase_receipt(
        v_admin_token,
        'e1000000-0000-4000-8000-000000000001'::uuid,
        '\x01'::bytea,
        v_po_id,
        v_period_id,
        v_document_date,
        jsonb_build_array(jsonb_build_object(
            'po_line_id', (
                SELECT id FROM procurement.purchase_order_lines
                WHERE document_id = v_po_id AND line_number = 1
            ),
            'quantity_received', 10.000
        ))
    );
    ASSERT (v_repeat ->> 'document_id')::bigint = v_receipt_id,
        'Purchase receipt retry must return the original document';
    ASSERT (SELECT count(*) FROM procurement.purchase_receipts WHERE purchase_order_id = v_po_id) = 1,
        'Purchase receipt retry must not duplicate the receipt';

    SELECT quantity_on_hand, total_value, last_known_wac
    INTO v_qty, v_value, v_wac
    FROM inventory.positions
    WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_id;
    ASSERT v_qty = 10.000 AND v_value = 1000.00 AND v_wac = 100.000000,
        'Receipt controls must be 10 units, 1000 DZD value, 100 DZD WAC';

    SELECT id INTO v_receipt_line_id
    FROM procurement.purchase_receipt_lines
    WHERE document_id = v_receipt_id;

    v_rows := procurement.list_purchase_receipts(v_admin_token, v_supplier_id, v_po_id);
    ASSERT jsonb_array_length(v_rows) = 1, 'Receipt history must expose the posted receipt';
    ASSERT (v_rows -> 0 ->> 'journal_document_id') IS NOT NULL,
        'Receipt history must expose the journal';
    ASSERT (v_rows -> 0 ->> 'landed_cost_amount') IS NULL,
        'Receipt must start without landed cost';

    v_rows := procurement.list_purchase_receipt_lines(v_admin_token, v_po_id);
    ASSERT jsonb_array_length(v_rows) = 1, 'Receipt-line projection must expose the match candidate';
    ASSERT (v_rows -> 0 ->> 'quantity_available_to_invoice')::numeric = 10.000,
        'All received quantity must initially be invoiceable';
    ASSERT (v_rows -> 0 ->> 'quantity_returnable_for_variant')::numeric = 10.000,
        'All received quantity must initially be returnable';

    v_result := inventory.allocate_landed_cost(
        v_admin_token,
        'e1000000-0000-4000-8000-000000000002'::uuid,
        '\x02'::bytea,
        v_receipt_id,
        100.00,
        'BY_QTY',
        v_period_id,
        v_document_date + 1,
        'R8-E freight'
    );
    ASSERT (v_result ->> 'inventory_debit')::numeric = 100.00,
        'Landed cost must debit remaining inventory by 100 DZD';
    ASSERT (v_result ->> 'variance_debit')::numeric = 0,
        'No landed-cost variance is expected before any sale';

    SELECT quantity_on_hand, total_value, last_known_wac
    INTO v_qty, v_value, v_wac
    FROM inventory.positions
    WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_id;
    ASSERT v_qty = 10.000 AND v_value = 1100.00 AND v_wac = 110.000000,
        'Landed cost controls must be 10 units, 1100 DZD value, 110 DZD WAC';

    SELECT id INTO v_landed_liability_id
    FROM procurement.supplier_liabilities
    WHERE receipt_document_id = v_receipt_id;
    ASSERT v_landed_liability_id IS NOT NULL, 'Landed cost must create a separate AP liability';

    v_rows := procurement.list_purchase_receipts(v_admin_token, v_supplier_id, v_po_id);
    ASSERT (v_rows -> 0 ->> 'landed_cost_amount')::numeric = 100.00,
        'Receipt history must expose the landed cost';

    v_result := procurement.create_supplier_invoice_draft(
        v_admin_token,
        v_supplier_id,
        v_po_id,
        'DZD',
        1.000000,
        'R8-E supplier invoice',
        jsonb_build_array(jsonb_build_object(
            'line_number', 1,
            'po_line_id', (
                SELECT id FROM procurement.purchase_order_lines
                WHERE document_id = v_po_id AND line_number = 1
            ),
            'receipt_line_id', v_receipt_line_id,
            'variant_id', v_variant_id,
            'quantity', 10.000,
            'unit_cost', 105.00
        ))
    );
    v_invoice_id := (v_result ->> 'document_id')::bigint;
    v_result := procurement.confirm_supplier_invoice(
        v_admin_token,
        'e1000000-0000-4000-8000-000000000003'::uuid,
        '\x03'::bytea,
        v_invoice_id,
        v_period_id,
        v_document_date + 2
    );
    ASSERT (v_result ->> 'total_amount')::numeric = 1050.00,
        'Supplier invoice must post 1050 DZD';
    ASSERT (v_result ->> 'grni_amount')::numeric = 1000.00,
        'Supplier invoice must clear 1000 DZD GRNI';
    ASSERT (v_result ->> 'variance_amount')::numeric = 50.00,
        'Supplier invoice must post 50 DZD purchase variance';

    SELECT id, outstanding_amount
    INTO v_invoice_liability_id, v_outstanding
    FROM procurement.supplier_liabilities
    WHERE invoice_document_id = v_invoice_id;
    ASSERT v_outstanding = 1050.00, 'Invoice must create 1050 DZD AP';

    v_rows := procurement.list_purchase_receipt_lines(v_admin_token, v_po_id);
    ASSERT (v_rows -> 0 ->> 'quantity_available_to_invoice')::numeric = 0,
        'Posted invoice must consume the receipt-line invoiceable quantity';
    v_rows := procurement.list_supplier_invoices(v_admin_token, v_supplier_id);
    ASSERT (v_rows -> 0 ->> 'journal_document_id') IS NOT NULL,
        'Invoice history must expose its journal';
    ASSERT (v_rows -> 0 ->> 'outstanding_amount')::numeric = 1050.00,
        'Invoice history must expose the outstanding liability';

    BEGIN
        PERFORM procurement.create_supplier_return_draft(
            v_admin_token, v_supplier_id, v_warehouse_id, v_po_id,
            'DEFECTIVE_GOODS', 'too many',
            jsonb_build_array(jsonb_build_object(
                'variant_id', v_variant_id, 'quantity', 11.000, 'unit_cost', 105.00
            ))
        );
    EXCEPTION WHEN object_not_in_prerequisite_state THEN
        v_denied := true;
    END;
    ASSERT v_denied, 'Return draft must reject quantity above net received stock';
    v_denied := false;

    v_result := procurement.create_supplier_return_draft(
        v_admin_token, v_supplier_id, v_warehouse_id, v_po_id,
        'DEFECTIVE_GOODS', 'R8-E return',
        jsonb_build_array(jsonb_build_object(
            'variant_id', v_variant_id, 'quantity', 2.000, 'unit_cost', 105.00
        ))
    );
    v_return_id := (v_result ->> 'document_id')::bigint;
    v_result := inventory.confirm_supplier_return(
        v_admin_token,
        'e1000000-0000-4000-8000-000000000004'::uuid,
        '\x04'::bytea,
        v_return_id,
        v_period_id,
        v_document_date + 3
    );
    ASSERT (v_result ->> 'clearing_role') = 'ACCOUNTS_PAYABLE',
        'Post-invoice return must clear AP';
    ASSERT (v_result ->> 'clearing_amount')::numeric = 210.00,
        'Return must clear AP at invoice value';
    ASSERT (v_result ->> 'inventory_value')::numeric = 220.00,
        'Return must credit inventory at landed WAC';
    ASSERT (v_result ->> 'variance_amount')::numeric = 10.00,
        'Return must expose the exact 10 DZD landed-WAC variance';

    SELECT quantity_on_hand, total_value, last_known_wac
    INTO v_qty, v_value, v_wac
    FROM inventory.positions
    WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_id;
    ASSERT v_qty = 8.000 AND v_value = 880.00 AND v_wac = 110.000000,
        'Return controls must be 8 units, 880 DZD value, 110 DZD WAC';
    SELECT outstanding_amount INTO v_outstanding
    FROM procurement.supplier_liabilities WHERE id = v_invoice_liability_id;
    ASSERT v_outstanding = 840.00, 'Return must reduce invoice AP to 840 DZD';

    v_rows := procurement.list_supplier_returns(v_admin_token, v_supplier_id);
    ASSERT jsonb_array_length(v_rows) = 1, 'Return history must expose the posted return';
    ASSERT (v_rows -> 0 ->> 'journal_document_id') IS NOT NULL,
        'Return history must expose its journal';
    v_rows := procurement.list_purchase_receipt_lines(v_admin_token, v_po_id);
    ASSERT (v_rows -> 0 ->> 'quantity_returnable_for_variant')::numeric = 8.000,
        'Returnable projection must fall to 8 units';

    BEGIN
        PERFORM procurement.post_supplier_payment(
            v_admin_token,
            'e1000000-0000-4000-8000-000000000005'::uuid,
            '\x05'::bytea,
            v_supplier_id,
            v_invoice_liability_id,
            841.00,
            'BANK_TRANSFER',
            v_period_id,
            v_document_date + 4,
            'must reject'
        );
    EXCEPTION WHEN object_not_in_prerequisite_state THEN
        v_denied := true;
    END;
    ASSERT v_denied, 'Payment above the allocated liability must be rejected';

    v_result := procurement.post_supplier_payment(
        v_admin_token,
        'e1000000-0000-4000-8000-000000000006'::uuid,
        '\x06'::bytea,
        v_supplier_id,
        v_invoice_liability_id,
        400.00,
        'BANK_TRANSFER',
        v_period_id,
        v_document_date + 4,
        'R8-E partial bank payment'
    );
    v_payment_id := (v_result ->> 'document_id')::bigint;
    v_repeat := procurement.post_supplier_payment(
        v_admin_token,
        'e1000000-0000-4000-8000-000000000006'::uuid,
        '\x06'::bytea,
        v_supplier_id,
        v_invoice_liability_id,
        400.00,
        'BANK_TRANSFER',
        v_period_id,
        v_document_date + 4,
        'R8-E partial bank payment'
    );
    ASSERT (v_repeat ->> 'document_id')::bigint = v_payment_id,
        'Supplier payment retry must return the original document';
    ASSERT (SELECT count(*) FROM procurement.supplier_payments WHERE liability_id = v_invoice_liability_id) = 1,
        'Supplier payment retry must not duplicate the payment';

    SELECT outstanding_amount INTO v_outstanding
    FROM procurement.supplier_liabilities WHERE id = v_invoice_liability_id;
    ASSERT v_outstanding = 440.00, 'Partial payment must leave 440 DZD invoice AP';
    ASSERT EXISTS (
        SELECT 1
        FROM finance.journal_lines line
        WHERE line.document_id = (v_result ->> 'journal_document_id')::bigint
          AND line.account_code = finance.require_account_role('BANK')
          AND line.credit = 400.00
    ), 'Bank payment must credit the Bank role';

    PERFORM procurement.post_supplier_payment(
        v_admin_token,
        'e1000000-0000-4000-8000-000000000007'::uuid,
        '\x07'::bytea,
        v_supplier_id,
        v_invoice_liability_id,
        440.00,
        'CASH',
        v_period_id,
        v_document_date + 5,
        'R8-E final invoice payment'
    );

    v_rows := procurement.list_supplier_liabilities(v_admin_token, v_supplier_id);
    ASSERT jsonb_array_length(v_rows) = 1,
        'Open-payable list must hide the fully paid invoice and retain landed cost';
    ASSERT (v_rows -> 0 ->> 'id')::bigint = v_landed_liability_id,
        'Remaining open payable must be the landed-cost liability';
    ASSERT (v_rows -> 0 ->> 'remaining_amount')::numeric = 100.00,
        'Remaining supplier AP must be exactly 100 DZD';

    PERFORM procurement.post_supplier_payment(
        v_admin_token,
        'e1000000-0000-4000-8000-000000000008'::uuid,
        '\x08'::bytea,
        v_supplier_id,
        v_landed_liability_id,
        100.00,
        'CHECK',
        v_period_id,
        v_document_date + 6,
        'R8-E landed cost settlement'
    );

    v_rows := procurement.list_supplier_liabilities(v_admin_token, v_supplier_id);
    ASSERT jsonb_array_length(v_rows) = 0,
        'No open payable may remain after exact settlement';
    v_rows := procurement.list_supplier_payments(v_admin_token, v_supplier_id);
    ASSERT jsonb_array_length(v_rows) = 3,
        'Payment history must expose partial, final, and landed-cost settlements';
    ASSERT (v_rows -> 0 ->> 'journal_document_id') IS NOT NULL,
        'Payment history must expose its journal';

    ASSERT NOT EXISTS (
        SELECT journal.document_id
        FROM finance.journal_entries journal
        JOIN finance.journal_lines line ON line.document_id = journal.document_id
        WHERE journal.source_type IN (
            'PURCHASE_RECEIPT', 'LANDED_COST', 'PURCHASE_INVOICE',
            'PURCHASE_RETURN', 'SUPPLIER_PAYMENT'
        )
          AND journal.source_id IN (v_receipt_id, v_invoice_id, v_return_id, v_payment_id)
        GROUP BY journal.document_id
        HAVING sum(line.debit) <> sum(line.credit)
    ), 'Every R8-E journal must balance';

    -- R8-E is a milestone test, not a claim that no forward migration exists.
    -- Recovery schema state is deliberately monotonic and later recoverable
    -- schema changes must advance it (see R6-001 schema_state contract).
    ASSERT (SELECT migration_version FROM operations.schema_state WHERE singleton) >= 20260812100000,
        'R8-E schema milestone must be present in the current forward schema';

    RAISE NOTICE '=== ALL R8-E PROCUREMENT ACCEPTANCE ASSERTIONS PASSED ===';
END;
$$;
