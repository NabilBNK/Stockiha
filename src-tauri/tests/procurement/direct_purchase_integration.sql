-- Direct Purchase MVP acceptance.
--
-- One operator confirmation posts only the physical Purchase Receipt, inventory
-- movement/WAC and the Inventory/GRNI journal. It must not fabricate a Purchase
-- Order and must not silently create a Supplier Invoice, AP or supplier payment.
-- Supplier Invoice/AP is covered separately by direct_purchase_invoice_integration.sql.
\set ON_ERROR_STOP on

DO $$
DECLARE
    v_suffix text := floor(random() * 1000000000)::text;
    v_admin_id bigint;
    v_admin_token text := 'direct_purchase_admin_' || floor(random() * 1000000000)::text;
    v_supplier_id bigint;
    v_warehouse_id bigint;
    v_product_a_id bigint;
    v_variant_a_id bigint;
    v_product_b_id bigint;
    v_variant_b_id bigint;
    v_unit_id bigint;
    v_period_id bigint;
    v_document_date date;
    v_request_id uuid := 'd1000000-0000-4000-8000-000000000001'::uuid;
    v_request_hash bytea := sha256('direct-purchase-basic-acceptance'::bytea);
    v_landed_request_id uuid := 'd1000000-0000-4000-8000-000000000002'::uuid;
    v_landed_alloc_request_id uuid := 'd1000000-0000-4000-8000-000000000003'::uuid;
    v_return_request_id uuid := 'd1000000-0000-4000-8000-000000000004'::uuid;
    v_po_count_before bigint;
    v_invoice_count_before bigint;
    v_liability_count_before bigint;
    v_payment_count_before bigint;
    v_receipt_id bigint;
    v_landed_receipt_id bigint;
    v_return_id bigint;
    v_result jsonb;
    v_repeat jsonb;
    v_landed_receipt jsonb;
    v_landed_result jsonb;
    v_policy jsonb;
    v_return_draft jsonb;
    v_return_result jsonb;
    v_receipt_lines jsonb;
    v_qty numeric;
    v_value numeric;
    v_wac numeric;
    v_denied boolean := false;
BEGIN
    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES ('direct_purchase_admin_' || v_suffix, 'Direct Purchase Admin', 'hash')
    RETURNING id INTO v_admin_id;

    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_admin_id, id FROM iam.roles WHERE code = 'ADMIN';

    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (
        v_admin_id,
        'DIRECT-PURCHASE-TEST',
        sha256(v_admin_token::bytea),
        now() + interval '2 hours'
    );

    SELECT id, starts_on + 1
    INTO v_period_id, v_document_date
    FROM finance.fiscal_periods
    WHERE status = 'OPEN'
    ORDER BY starts_on DESC
    LIMIT 1;
    ASSERT v_period_id IS NOT NULL, 'Direct purchase test requires an open fiscal period';

    SELECT id
    INTO v_unit_id
    FROM catalog.units
    WHERE normalized_code = 'UNIT'
    ORDER BY id
    LIMIT 1;
    IF v_unit_id IS NULL THEN
        SELECT id INTO v_unit_id FROM catalog.units ORDER BY id LIMIT 1;
    END IF;
    ASSERT v_unit_id IS NOT NULL, 'Direct purchase test requires a catalog unit';

    INSERT INTO procurement.suppliers (code, name, is_active)
    VALUES ('SUP-DIRECT-' || v_suffix, 'Direct Purchase Supplier', true)
    RETURNING id INTO v_supplier_id;

    INSERT INTO inventory.warehouses (code, name, is_active)
    VALUES ('WH-DIRECT-' || v_suffix, 'Direct Purchase Warehouse', true)
    RETURNING id INTO v_warehouse_id;

    UPDATE core.system_state
    SET default_warehouse_id = v_warehouse_id
    WHERE id = 1;

    INSERT INTO catalog.products (name, unit_id, is_active)
    VALUES ('Direct Purchase WAC Item', v_unit_id, true)
    RETURNING id INTO v_product_a_id;

    INSERT INTO catalog.product_variants (
        product_id, base_unit_id, sku, sale_price, is_active
    ) VALUES (
        v_product_a_id, v_unit_id, 'DIRECT-A-' || v_suffix, 180.00, true
    ) RETURNING id INTO v_variant_a_id;

    INSERT INTO catalog.products (name, unit_id, is_active)
    VALUES ('Direct Purchase Landed Cost Item', v_unit_id, true)
    RETURNING id INTO v_product_b_id;

    INSERT INTO catalog.product_variants (
        product_id, base_unit_id, sku, sale_price, is_active
    ) VALUES (
        v_product_b_id, v_unit_id, 'DIRECT-B-' || v_suffix, 180.00, true
    ) RETURNING id INTO v_variant_b_id;

    INSERT INTO inventory.positions (
        warehouse_id, variant_id, quantity_on_hand, total_value, last_known_wac
    ) VALUES (
        v_warehouse_id, v_variant_a_id, 20.000, 1600.0000, 80.000000
    );

    -- The MVP exposes Direct Purchase only and the advanced PO selector is locked.
    v_policy := procurement.get_purchase_workflow_policy(v_admin_token);
    ASSERT v_policy ->> 'mode' = 'DIRECT_PURCHASE',
        'Direct Purchase must be the active MVP purchasing workflow';
    ASSERT NOT (v_policy ->> 'can_manage')::boolean,
        'MVP workflow policy must not expose a mutable Direct/PO selector';

    BEGIN
        PERFORM procurement.update_purchase_workflow_policy(v_admin_token, 'PURCHASE_ORDER');
    EXCEPTION WHEN object_not_in_prerequisite_state THEN
        v_denied := true;
    END;
    ASSERT v_denied, 'Runtime workflow mutation must be rejected';

    SELECT count(*) INTO v_po_count_before FROM procurement.purchase_orders;
    SELECT count(*) INTO v_invoice_count_before FROM procurement.supplier_invoices;
    SELECT count(*) INTO v_liability_count_before FROM procurement.supplier_liabilities;
    SELECT count(*) INTO v_payment_count_before FROM procurement.supplier_payments;

    -- Small acceptance scenario: existing 20 @ 80, buy 10 @ 100.
    v_result := inventory.confirm_direct_purchase_receipt(
        v_admin_token,
        v_request_id,
        v_request_hash,
        v_supplier_id,
        v_warehouse_id,
        v_period_id,
        v_document_date,
        jsonb_build_array(jsonb_build_object(
            'variant_id', v_variant_a_id,
            'unit_id', v_unit_id,
            'quantity_received', '10.000',
            'unit_cost', '100.00'
        )),
        'Direct Purchase MVP WAC acceptance'
    );

    v_receipt_id := (v_result ->> 'document_id')::bigint;
    ASSERT v_receipt_id IS NOT NULL, 'Direct Purchase must create a Purchase Receipt';
    ASSERT v_result ->> 'receipt_origin' = 'DIRECT_PURCHASE',
        'Receipt response must identify DIRECT_PURCHASE';
    ASSERT v_result -> 'purchase_order_id' = 'null'::jsonb,
        'Direct Purchase must return no Purchase Order';
    ASSERT (SELECT count(*) FROM procurement.purchase_orders) = v_po_count_before,
        'Direct Purchase must create zero Purchase Order rows';

    ASSERT EXISTS (
        SELECT 1
        FROM procurement.purchase_receipts receipt
        WHERE receipt.document_id = v_receipt_id
          AND receipt.purchase_order_id IS NULL
          AND receipt.receipt_origin = 'DIRECT_PURCHASE'
          AND receipt.total_amount = 1000.00
    ), 'Direct Purchase must persist a truthful standalone Purchase Receipt';

    ASSERT EXISTS (
        SELECT 1
        FROM procurement.purchase_receipt_lines line
        WHERE line.document_id = v_receipt_id
          AND line.po_line_id IS NULL
          AND line.variant_id = v_variant_a_id
          AND line.quantity_received = 10.000
          AND line.unit_cost = 100.00
          AND line.line_total = 1000.00
    ), 'Direct receipt line must preserve quantity/cost without a PO line';

    SELECT quantity_on_hand, total_value, last_known_wac
    INTO v_qty, v_value, v_wac
    FROM inventory.positions
    WHERE warehouse_id = v_warehouse_id
      AND variant_id = v_variant_a_id;

    ASSERT v_qty = 30.000, '20 existing + 10 purchased must produce 30 units';
    ASSERT v_value = 2600.0000, '1600 existing + 1000 purchase must produce 2600 DZD inventory value';
    ASSERT v_wac = 86.666667, '2600 / 30 must produce authoritative WAC 86.666667';

    ASSERT EXISTS (
        SELECT 1
        FROM inventory.movements movement
        WHERE movement.reference_type = 'PURCHASE_RECEIPT'
          AND movement.reference_id = v_receipt_id
          AND movement.variant_id = v_variant_a_id
          AND movement.movement_type = 'RECEIPT'
          AND movement.quantity_delta = 10.000
          AND movement.inventory_value_delta = 1000.00
    ), 'Direct Purchase must append the canonical RECEIPT movement';

    ASSERT EXISTS (
        SELECT 1
        FROM finance.journal_entries journal
        JOIN finance.journal_lines inventory_line
          ON inventory_line.document_id = journal.document_id
         AND inventory_line.account_code = finance.require_account_role('INVENTORY')
        JOIN finance.journal_lines grni_line
          ON grni_line.document_id = journal.document_id
         AND grni_line.account_code = finance.require_account_role('GRNI')
        WHERE journal.source_type = 'PURCHASE_RECEIPT'
          AND journal.source_id = v_receipt_id
          AND inventory_line.debit = 1000.00
          AND inventory_line.credit = 0
          AND grni_line.debit = 0
          AND grni_line.credit = 1000.00
    ), 'Purchase Receipt journal must debit Inventory and credit GRNI for 1000 DZD';

    ASSERT NOT EXISTS (
        SELECT journal.document_id
        FROM finance.journal_entries journal
        JOIN finance.journal_lines line ON line.document_id = journal.document_id
        WHERE journal.source_type = 'PURCHASE_RECEIPT'
          AND journal.source_id = v_receipt_id
        GROUP BY journal.document_id
        HAVING sum(line.debit) <> sum(line.credit)
    ), 'Direct Purchase receipt journal must balance';

    -- Crucial policy assertion: physical receipt confirmation is NOT an invoice.
    ASSERT (SELECT count(*) FROM procurement.supplier_invoices) = v_invoice_count_before,
        'Direct Purchase must not auto-create a Supplier Invoice';
    ASSERT (SELECT count(*) FROM procurement.supplier_liabilities) = v_liability_count_before,
        'Direct Purchase must not auto-create Accounts Payable';
    ASSERT (SELECT count(*) FROM procurement.supplier_payments) = v_payment_count_before,
        'Direct Purchase must not auto-pay the supplier';

    -- Idempotency: same request and hash returns the same receipt exactly once.
    v_repeat := inventory.confirm_direct_purchase_receipt(
        v_admin_token,
        v_request_id,
        v_request_hash,
        v_supplier_id,
        v_warehouse_id,
        v_period_id,
        v_document_date,
        jsonb_build_array(jsonb_build_object(
            'variant_id', v_variant_a_id,
            'unit_id', v_unit_id,
            'quantity_received', '10.000',
            'unit_cost', '100.00'
        )),
        'Direct Purchase MVP WAC acceptance'
    );

    ASSERT (v_repeat ->> 'document_id')::bigint = v_receipt_id,
        'Retry must return the original Purchase Receipt';
    ASSERT (SELECT count(*) FROM procurement.purchase_receipts WHERE document_id = v_receipt_id) = 1,
        'Retry must not duplicate the Purchase Receipt';

    SELECT quantity_on_hand, total_value, last_known_wac
    INTO v_qty, v_value, v_wac
    FROM inventory.positions
    WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_a_id;
    ASSERT v_qty = 30.000 AND v_value = 2600.0000 AND v_wac = 86.666667,
        'Retry must not duplicate stock or valuation';

    -- Landed cost stays a separate downstream action against the posted receipt.
    v_landed_receipt := inventory.confirm_direct_purchase_receipt(
        v_admin_token,
        v_landed_request_id,
        sha256('direct-purchase-landed-receipt'::bytea),
        v_supplier_id,
        v_warehouse_id,
        v_period_id,
        v_document_date,
        jsonb_build_array(jsonb_build_object(
            'variant_id', v_variant_b_id,
            'unit_id', v_unit_id,
            'quantity_received', '10.000',
            'unit_cost', '100.00'
        )),
        'Direct Purchase landed cost base receipt'
    );
    v_landed_receipt_id := (v_landed_receipt ->> 'document_id')::bigint;

    v_landed_result := inventory.allocate_landed_cost(
        v_admin_token,
        v_landed_alloc_request_id,
        sha256('direct-purchase-landed-allocation'::bytea),
        v_landed_receipt_id,
        100.00,
        'BY_VALUE',
        v_period_id,
        v_document_date,
        'Freight after Direct Purchase receipt'
    );
    ASSERT v_landed_result ->> 'status' = 'POSTED',
        'Landed cost must post against a Direct Purchase receipt';

    SELECT quantity_on_hand, total_value, last_known_wac
    INTO v_qty, v_value, v_wac
    FROM inventory.positions
    WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_b_id;
    ASSERT v_qty = 10.000 AND v_value = 1100.0000 AND v_wac = 110.000000,
        'Separate landed cost must produce 1100 DZD value and 110 WAC';

    ASSERT EXISTS (
        SELECT 1
        FROM inventory.movements movement
        WHERE movement.reference_type = 'PURCHASE_RECEIPT'
          AND movement.reference_id = v_landed_receipt_id
          AND movement.variant_id = v_variant_b_id
          AND movement.movement_type = 'COST_ONLY'
          AND movement.quantity_delta = 0
          AND movement.inventory_value_delta = 100.00
    ), 'Landed cost must append canonical COST_ONLY valuation movement';

    -- A Direct Purchase can be returned before invoice; the clearing leg is GRNI.
    v_return_draft := procurement.create_supplier_return_draft(
        v_admin_token,
        v_supplier_id,
        v_warehouse_id,
        NULL::bigint,
        v_receipt_id,
        'DEFECTIVE_GOODS',
        'Return two units from Direct Purchase',
        jsonb_build_array(jsonb_build_object(
            'variant_id', v_variant_a_id,
            'quantity', '2.000',
            'unit_cost', '100.00'
        ))
    );

    v_return_id := (v_return_draft ->> 'document_id')::bigint;
    ASSERT v_return_id IS NOT NULL, 'Direct Purchase return must create a draft';
    ASSERT v_return_draft -> 'purchase_order_id' = 'null'::jsonb,
        'Direct Purchase return must keep purchase_order_id null';
    ASSERT (v_return_draft ->> 'receipt_document_id')::bigint = v_receipt_id,
        'Direct Purchase return must reference the exact Purchase Receipt';

    v_return_result := inventory.confirm_supplier_return(
        v_admin_token,
        v_return_request_id,
        sha256('direct-purchase-return-confirm'::bytea),
        v_return_id,
        v_period_id,
        v_document_date
    );

    ASSERT v_return_result ->> 'status' = 'POSTED', 'Direct Purchase Supplier Return must post';
    ASSERT v_return_result ->> 'clearing_role' = 'GRNI',
        'Pre-invoice Direct Purchase return must clear GRNI rather than AP';

    SELECT quantity_on_hand
    INTO v_qty
    FROM inventory.positions
    WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_a_id;
    ASSERT v_qty = 28.000, 'Returning two units from 30 must leave 28';

    v_receipt_lines := procurement.list_purchase_receipt_lines(v_admin_token, NULL);
    ASSERT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v_receipt_lines) item
        WHERE (item ->> 'receipt_document_id')::bigint = v_receipt_id
          AND item ->> 'receipt_origin' = 'DIRECT_PURCHASE'
          AND item -> 'purchase_order_id' = 'null'::jsonb
          AND item -> 'po_line_id' = 'null'::jsonb
          AND (item ->> 'quantity_returned_for_variant')::numeric = 2.000
          AND (item ->> 'quantity_returnable_for_variant')::numeric = 8.000
    ), 'Direct receipt read model must expose returnable quantity without a PO';

    ASSERT (SELECT count(*) FROM procurement.purchase_orders) = v_po_count_before,
        'Complete Direct Purchase scenario must create zero synthetic Purchase Orders';
    ASSERT (SELECT count(*) FROM procurement.supplier_invoices) = v_invoice_count_before,
        'Receipt/landed-cost/return scenario must not silently create supplier invoices';

    ASSERT (SELECT migration_version FROM operations.schema_state WHERE singleton) >= 20260816166000,
        'Schema state must include the receipt-only Direct Purchase posting contract';

    RAISE NOTICE '=== DIRECT PURCHASE RECEIPT-ONLY MVP ASSERTIONS PASSED ===';
END;
$$;