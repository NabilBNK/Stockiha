-- Direct Purchase invariants: no synthetic PO, exact WAC, journal evidence,
-- idempotency, changed-payload conflict, and duplicate-line rollback.
\set ON_ERROR_STOP on

DO $$
DECLARE
    v_suffix text := floor(random() * 1000000000)::text;
    v_admin_id bigint;
    v_admin_token text := 'direct_purchase_admin_' || floor(random() * 1000000000)::text;
    v_supplier_id bigint;
    v_warehouse_id bigint;
    v_product_id bigint;
    v_variant_id bigint;
    v_unit_id bigint;
    v_period_id bigint;
    v_document_date date;
    v_result jsonb;
    v_repeat jsonb;
    v_receipt_id bigint;
    v_journal_id bigint;
    v_qty numeric;
    v_value numeric;
    v_wac numeric;
    v_rejected boolean := false;
BEGIN
    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES ('direct_purchase_admin_' || v_suffix, 'Direct Purchase Admin', 'hash')
    RETURNING id INTO v_admin_id;
    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_admin_id, id FROM iam.roles WHERE code = 'ADMIN';
    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_admin_id, 'DIRECT-PURCHASE', sha256(v_admin_token::bytea), now() + interval '2 hours');

    SELECT id, starts_on + 1
    INTO v_period_id, v_document_date
    FROM finance.fiscal_periods
    WHERE status = 'OPEN'
    ORDER BY starts_on DESC
    LIMIT 1;
    ASSERT v_period_id IS NOT NULL, 'Direct Purchase requires an open fiscal period';

    SELECT id INTO v_unit_id FROM catalog.units ORDER BY id LIMIT 1;
    ASSERT v_unit_id IS NOT NULL, 'Direct Purchase requires a catalog unit';

    INSERT INTO procurement.suppliers (code, name, is_active)
    VALUES ('SUP-DP-' || v_suffix, 'Direct Purchase Supplier', true)
    RETURNING id INTO v_supplier_id;
    INSERT INTO inventory.warehouses (code, name, is_active)
    VALUES ('WH-DP-' || v_suffix, 'Direct Purchase Warehouse', true)
    RETURNING id INTO v_warehouse_id;
    INSERT INTO catalog.products (name, is_active)
    VALUES ('Direct Purchase Item', true)
    RETURNING id INTO v_product_id;
    INSERT INTO catalog.product_variants (product_id, base_unit_id, sku, sale_price, is_active)
    VALUES (v_product_id, v_unit_id, 'DP-SKU-' || v_suffix, 180.00, true)
    RETURNING id INTO v_variant_id;
    INSERT INTO inventory.positions (warehouse_id, variant_id, quantity_on_hand, total_value, last_known_wac)
    VALUES (v_warehouse_id, v_variant_id, 20.000, 1600.00, 80.000000);

    v_result := inventory.confirm_direct_purchase(
        v_admin_token,
        'd1000000-0000-4000-8000-000000000001'::uuid,
        '\x01'::bytea,
        v_supplier_id, v_warehouse_id, v_period_id, v_document_date,
        'Direct Purchase acceptance',
        jsonb_build_array(jsonb_build_object(
            'variant_id', v_variant_id, 'unit_id', v_unit_id,
            'quantity_received', 10.000, 'unit_cost', 100.00
        ))
    );
    v_receipt_id := (v_result ->> 'document_id')::bigint;
    ASSERT (v_result ->> 'receipt_origin') = 'DIRECT_PURCHASE', 'Receipt origin must be direct purchase';
    ASSERT (v_result ->> 'purchase_order_id') IS NULL, 'Direct Purchase must not create a Purchase Order';

    v_repeat := inventory.confirm_direct_purchase(
        v_admin_token,
        'd1000000-0000-4000-8000-000000000001'::uuid,
        '\x01'::bytea,
        v_supplier_id, v_warehouse_id, v_period_id, v_document_date,
        'Direct Purchase acceptance',
        jsonb_build_array(jsonb_build_object(
            'variant_id', v_variant_id, 'unit_id', v_unit_id,
            'quantity_received', 10.000, 'unit_cost', 100.00
        ))
    );
    ASSERT (v_repeat ->> 'document_id')::bigint = v_receipt_id, 'Same request must return the original receipt';
    ASSERT (SELECT count(*) FROM procurement.purchase_receipts WHERE document_id = v_receipt_id) = 1,
        'Idempotent retry must not duplicate the receipt';

    BEGIN
        PERFORM inventory.confirm_direct_purchase(
            v_admin_token,
            'd1000000-0000-4000-8000-000000000001'::uuid,
            '\x02'::bytea,
            v_supplier_id, v_warehouse_id, v_period_id, v_document_date,
            'Changed payload',
            jsonb_build_array(jsonb_build_object(
                'variant_id', v_variant_id, 'unit_id', v_unit_id,
                'quantity_received', 11.000, 'unit_cost', 100.00
            ))
        );
    EXCEPTION WHEN unique_violation THEN
        v_rejected := true;
    END;
    ASSERT v_rejected, 'Same request ID with a different payload must fail';
    v_rejected := false;

    BEGIN
        PERFORM inventory.confirm_direct_purchase(
            v_admin_token,
            'd1000000-0000-4000-8000-000000000002'::uuid,
            '\x03'::bytea,
            v_supplier_id, v_warehouse_id, v_period_id, v_document_date,
            'Duplicate line rejection',
            jsonb_build_array(
                jsonb_build_object('variant_id', v_variant_id, 'unit_id', v_unit_id, 'quantity_received', 1.000, 'unit_cost', 100.00),
                jsonb_build_object('variant_id', v_variant_id, 'unit_id', v_unit_id, 'quantity_received', 1.000, 'unit_cost', 110.00)
            )
        );
    EXCEPTION WHEN invalid_parameter_value THEN
        v_rejected := true;
    END;
    ASSERT v_rejected, 'Duplicate effective direct-purchase lines must fail';

    SELECT quantity_on_hand, total_value, last_known_wac
    INTO v_qty, v_value, v_wac
    FROM inventory.positions
    WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_id;
    ASSERT v_qty = 30.000 AND v_value = 2600.00 AND v_wac = 86.666667,
        'Direct Purchase must produce the canonical exact WAC result';
    ASSERT NOT EXISTS (
        SELECT 1 FROM procurement.purchase_receipt_lines
        WHERE document_id = v_receipt_id AND po_line_id IS NOT NULL
    ), 'Direct Purchase lines must not reference Purchase Order lines';
    ASSERT NOT EXISTS (
        SELECT 1 FROM procurement.supplier_invoices invoice
        WHERE invoice.purchase_order_id IS NULL AND invoice.supplier_id = v_supplier_id
    ), 'Direct Purchase must not create a supplier invoice';
    ASSERT NOT EXISTS (
        SELECT 1 FROM procurement.supplier_liabilities liability
        WHERE liability.supplier_id = v_supplier_id
    ), 'Direct Purchase must not create an AP liability';

    SELECT journal_document_id INTO v_journal_id
    FROM procurement.purchase_receipts WHERE document_id = v_receipt_id;
    ASSERT v_journal_id IS NOT NULL, 'Direct Purchase must link one journal';
    ASSERT EXISTS (
        SELECT 1 FROM finance.journal_lines line
        WHERE line.document_id = v_journal_id
          AND line.account_code = finance.require_account_role('INVENTORY')
          AND line.debit = 1000.00
    ), 'Receipt journal must debit inventory';
    ASSERT EXISTS (
        SELECT 1 FROM finance.journal_lines line
        WHERE line.document_id = v_journal_id
          AND line.account_code = finance.require_account_role('GRNI')
          AND line.credit = 1000.00
    ), 'Receipt journal must credit GRNI';
    ASSERT NOT EXISTS (
        SELECT 1 FROM finance.journal_lines
        WHERE document_id = v_journal_id
        GROUP BY document_id HAVING sum(debit) <> sum(credit)
    ), 'Direct Purchase journal must balance';
END;
$$;
