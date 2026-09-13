-- WS-E-003: supplier return invariants -- stock leaves at WAC, supplier is
-- credited at the purchase price, the variance balances the journal, returns
-- reduce what is owed, and over-returning is refused.
\set ON_ERROR_STOP on

DO $$
DECLARE
    v_suffix text := floor(random() * 1000000000)::text;
    v_admin_id bigint;
    v_admin_token text := 'ws_e_003_admin_' || floor(random() * 1000000000)::text;
    v_supplier_id bigint;
    v_warehouse_id bigint;
    v_product_id bigint;
    v_variant_id bigint;
    v_unit_id bigint;
    v_period_id bigint;
    v_document_date date;
    v_receipt jsonb;
    v_receipt_id bigint;
    v_receipt_line_id bigint;
    v_return jsonb;
    v_repeat jsonb;
    v_return_id bigint;
    v_journal_id bigint;
    v_status jsonb;
    v_qty numeric;
    v_value numeric;
    v_wac numeric;
    v_rejected boolean := false;
BEGIN
    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES ('ws_e_003_admin_' || v_suffix, 'WS-E-003 Admin', 'hash')
    RETURNING id INTO v_admin_id;
    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_admin_id, id FROM iam.roles WHERE code = 'ADMIN';
    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_admin_id, 'WS-E-003', sha256(v_admin_token::bytea), now() + interval '2 hours');

    SELECT id, starts_on + 1
    INTO v_period_id, v_document_date
    FROM finance.fiscal_periods
    WHERE status = 'OPEN'
    ORDER BY starts_on DESC
    LIMIT 1;
    ASSERT v_period_id IS NOT NULL, 'Supplier return requires an open fiscal period';

    SELECT id INTO v_unit_id FROM catalog.units ORDER BY id LIMIT 1;
    ASSERT v_unit_id IS NOT NULL, 'Supplier return test requires a catalog unit';

    INSERT INTO procurement.suppliers (code, name, is_active)
    VALUES ('SUP-RET-' || v_suffix, 'Return Supplier', true)
    RETURNING id INTO v_supplier_id;
    INSERT INTO inventory.warehouses (code, name, is_active)
    VALUES ('WH-RET-' || v_suffix, 'Return Warehouse', true)
    RETURNING id INTO v_warehouse_id;
    INSERT INTO catalog.products (name, is_active)
    VALUES ('Return Item', true)
    RETURNING id INTO v_product_id;
    INSERT INTO catalog.product_variants (product_id, base_unit_id, sku, sale_price, is_active)
    VALUES (v_product_id, v_unit_id, 'RET-SKU-' || v_suffix, 200.00, true)
    RETURNING id INTO v_variant_id;

    -- Opening stock: 10 units valued at 120 each, so the later purchase at 100
    -- produces a blended WAC of 110 and a real return variance.
    INSERT INTO inventory.positions (warehouse_id, variant_id, quantity_on_hand, total_value, last_known_wac)
    VALUES (v_warehouse_id, v_variant_id, 10.000, 1200.00, 120.000000);

    -- Purchase 10 units at 100.00 -> qty 20, value 2200.00, WAC 110.000000
    v_receipt := inventory.confirm_direct_purchase(
        v_admin_token,
        'e3000000-0000-4000-8000-000000000001'::uuid,
        '\x01'::bytea,
        v_supplier_id, v_warehouse_id, v_period_id, v_document_date,
        'WS-E-003 purchase',
        jsonb_build_array(jsonb_build_object(
            'variant_id', v_variant_id, 'unit_id', v_unit_id,
            'quantity_received', 10.000, 'unit_cost', 100.00
        ))
    );
    v_receipt_id := (v_receipt ->> 'document_id')::bigint;

    SELECT quantity_on_hand, total_value, last_known_wac
    INTO v_qty, v_value, v_wac
    FROM inventory.positions
    WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_id;
    ASSERT v_qty = 20.000, 'Stock after purchase must be 20';
    ASSERT v_wac = 110.000000, 'WAC after purchase must be 110.000000';

    SELECT id INTO v_receipt_line_id
    FROM procurement.purchase_receipt_lines
    WHERE document_id = v_receipt_id
    ORDER BY line_number
    LIMIT 1;

    -- Return 4 units: supplier credit 400.00, stock out 440.00, variance -40.00
    v_return := procurement.confirm_purchase_return(
        v_admin_token,
        'e3000000-0000-4000-8000-000000000002'::uuid,
        '\x02'::bytea,
        v_receipt_id, v_period_id, v_document_date,
        'DEFECTIVE_GOODS', 'four broken units',
        jsonb_build_array(jsonb_build_object(
            'receipt_line_id', v_receipt_line_id, 'quantity', 4.000
        ))
    );
    v_return_id := (v_return ->> 'document_id')::bigint;
    ASSERT (v_return ->> 'document_number') LIKE 'PRT-%', 'Return must get a PRT document number';
    ASSERT (v_return ->> 'refund_amount')::numeric = 400.00, 'Supplier credit must be 4 x 100.00';
    ASSERT (v_return ->> 'inventory_value')::numeric = 440.00, 'Stock must leave at 4 x 110.00';
    ASSERT (v_return ->> 'variance_amount')::numeric = -40.00, 'Variance must be -40.00';

    SELECT quantity_on_hand, total_value, last_known_wac
    INTO v_qty, v_value, v_wac
    FROM inventory.positions
    WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_id;
    ASSERT v_qty = 16.000, 'Stock after return must be 16';
    ASSERT v_value = 1760.0000, 'Stock value after return must be 1760.00';
    ASSERT v_wac = 110.000000, 'Returning at WAC must not change WAC';

    ASSERT EXISTS (
        SELECT 1 FROM inventory.movements
        WHERE reference_type = 'PURCHASE_RETURN'
          AND reference_id = v_return_id
          AND movement_type = 'ISSUE'
          AND quantity_delta = -4.000
    ), 'Return must write one ISSUE movement';

    v_journal_id := (v_return ->> 'journal_document_id')::bigint;
    ASSERT EXISTS (
        SELECT 1 FROM finance.journal_lines line
        WHERE line.document_id = v_journal_id
          AND line.account_code = finance.require_account_role('GRNI')
          AND line.debit = 400.00
    ), 'Return journal must debit GRNI by the supplier credit';
    ASSERT EXISTS (
        SELECT 1 FROM finance.journal_lines line
        WHERE line.document_id = v_journal_id
          AND line.account_code = finance.require_account_role('INVENTORY')
          AND line.credit = 440.00
    ), 'Return journal must credit inventory at WAC';
    ASSERT EXISTS (
        SELECT 1 FROM finance.journal_lines line
        WHERE line.document_id = v_journal_id
          AND line.account_code = finance.require_account_role('PROCUREMENT_VARIANCE')
          AND line.debit = 40.00
    ), 'Return journal must debit the variance';
    ASSERT NOT EXISTS (
        SELECT 1 FROM finance.journal_lines
        WHERE document_id = v_journal_id
        GROUP BY document_id HAVING sum(debit) <> sum(credit)
    ), 'Return journal must balance';
    ASSERT NOT EXISTS (
        SELECT 1 FROM finance.journal_lines
        WHERE document_id = v_journal_id AND account_id IS NULL
    ), 'Return journal lines must carry account_id';

    -- The return reduces what is owed on the purchase
    v_status := procurement.list_purchase_payment_status(v_admin_token, v_receipt_id);
    ASSERT (v_status -> 0 ->> 'returned_amount')::numeric = 400.00, 'Status must report the returned amount';
    ASSERT (v_status -> 0 ->> 'net_payable_amount')::numeric = 600.00, 'Net payable must be 1000 - 400';
    ASSERT (v_status -> 0 ->> 'outstanding_amount')::numeric = 600.00, 'Outstanding must be 600.00';

    -- Idempotent retry
    v_repeat := procurement.confirm_purchase_return(
        v_admin_token,
        'e3000000-0000-4000-8000-000000000002'::uuid,
        '\x02'::bytea,
        v_receipt_id, v_period_id, v_document_date,
        'DEFECTIVE_GOODS', 'four broken units',
        jsonb_build_array(jsonb_build_object(
            'receipt_line_id', v_receipt_line_id, 'quantity', 4.000
        ))
    );
    ASSERT (v_repeat ->> 'document_id')::bigint = v_return_id, 'Retry must return the original return';
    ASSERT (SELECT count(*) FROM procurement.purchase_returns
            WHERE receipt_document_id = v_receipt_id) = 1,
        'Idempotent retry must not duplicate the return';

    -- Paying more than the net payable is refused
    BEGIN
        PERFORM procurement.post_purchase_payment(
            v_admin_token,
            'e3000000-0000-4000-8000-000000000003'::uuid,
            '\x03'::bytea,
            v_receipt_id, v_period_id, v_document_date,
            'CASH', 601.00, NULL
        );
    EXCEPTION WHEN invalid_parameter_value THEN
        v_rejected := true;
    END;
    ASSERT v_rejected, 'A payment above the net payable must be refused after a return';
    v_rejected := false;

    -- Returning more than remains on the line is refused
    BEGIN
        PERFORM procurement.confirm_purchase_return(
            v_admin_token,
            'e3000000-0000-4000-8000-000000000004'::uuid,
            '\x04'::bytea,
            v_receipt_id, v_period_id, v_document_date,
            'WRONG_ITEM', NULL,
            jsonb_build_array(jsonb_build_object(
                'receipt_line_id', v_receipt_line_id, 'quantity', 7.000
            ))
        );
    EXCEPTION WHEN invalid_parameter_value THEN
        v_rejected := true;
    END;
    ASSERT v_rejected, 'Returning more than was received must be refused';
    v_rejected := false;

    -- An unsupported reason is refused
    BEGIN
        PERFORM procurement.confirm_purchase_return(
            v_admin_token,
            'e3000000-0000-4000-8000-000000000005'::uuid,
            '\x05'::bytea,
            v_receipt_id, v_period_id, v_document_date,
            'CHANGED_MY_MIND', NULL,
            jsonb_build_array(jsonb_build_object(
                'receipt_line_id', v_receipt_line_id, 'quantity', 1.000
            ))
        );
    EXCEPTION WHEN invalid_parameter_value THEN
        v_rejected := true;
    END;
    ASSERT v_rejected, 'An unsupported return reason must be refused';
    v_rejected := false;

    -- OTHER reason without note is refused
    BEGIN
        PERFORM procurement.confirm_purchase_return(
            v_admin_token,
            'e3000000-0000-4000-8000-000000000006'::uuid,
            '\x06'::bytea,
            v_receipt_id, v_period_id, v_document_date,
            'OTHER', NULL,
            jsonb_build_array(jsonb_build_object(
                'receipt_line_id', v_receipt_line_id, 'quantity', 1.000
            ))
        );
    EXCEPTION WHEN invalid_parameter_value THEN
        v_rejected := true;
    END;
    ASSERT v_rejected, 'OTHER reason without note must be refused';
    v_rejected := false;

    -- OTHER reason with empty/blank note is refused
    BEGIN
        PERFORM procurement.confirm_purchase_return(
            v_admin_token,
            'e3000000-0000-4000-8000-000000000007'::uuid,
            '\x07'::bytea,
            v_receipt_id, v_period_id, v_document_date,
            'OTHER', '   ',
            jsonb_build_array(jsonb_build_object(
                'receipt_line_id', v_receipt_line_id, 'quantity', 1.000
            ))
        );
    EXCEPTION WHEN invalid_parameter_value THEN
        v_rejected := true;
    END;
    ASSERT v_rejected, 'OTHER reason with blank note must be refused';
    v_rejected := false;

    -- Returnable quantity read model
    ASSERT (
        SELECT (entry ->> 'quantity_returnable')::numeric
        FROM jsonb_array_elements(
            procurement.list_purchase_returnable_lines(v_admin_token, v_receipt_id)
        ) entry
        LIMIT 1
    ) = 6.000, 'Six units must remain returnable';

    -- Supplier balance nets the return
    ASSERT EXISTS (
        SELECT 1 FROM jsonb_array_elements(
            procurement.list_supplier_balances(v_admin_token)
        ) entry
        WHERE (entry ->> 'supplier_id')::bigint = v_supplier_id
          AND (entry ->> 'total_returned')::numeric = 400.00
          AND (entry ->> 'balance_due')::numeric = 600.00
    ), 'Supplier balance must net purchases against returns';

    -- Returns are immutable
    BEGIN
        UPDATE procurement.purchase_returns
        SET refund_amount = 1.00
        WHERE document_id = v_return_id;
    EXCEPTION WHEN feature_not_supported THEN
        v_rejected := true;
    END;
    ASSERT v_rejected, 'A posted return must be immutable';
END;
$$;
