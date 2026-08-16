-- Direct Purchase MVP acceptance.
-- Proves that one operator confirmation posts physically received goods without
-- fabricating a Purchase Order, preserves WAC/GRNI/AP/landed-cost semantics,
-- supports receipt-line supplier returns, and is idempotent.
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
    v_return_request_id uuid := 'd1000000-0000-4000-8000-000000000003'::uuid;
    v_po_count_before bigint;
    v_root_id bigint;
    v_receipt_id bigint;
    v_invoice_id bigint;
    v_landed_root_id bigint;
    v_landed_receipt_id bigint;
    v_return_id bigint;
    v_result jsonb;
    v_repeat jsonb;
    v_landed_result jsonb;
    v_policy jsonb;
    v_return_draft jsonb;
    v_return_result jsonb;
    v_receipt_lines jsonb;
    v_qty numeric;
    v_value numeric;
    v_wac numeric;
    v_ap numeric;
    v_denied boolean := false;
BEGIN
    -- ---------------------------------------------------------------------
    -- Test authority/session and deterministic business prerequisites.
    -- ---------------------------------------------------------------------
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

    -- Seed the exact manual-acceptance WAC baseline: 20 units / 1600 DZD / 80 DZD.
    INSERT INTO inventory.positions (
        warehouse_id, variant_id, quantity_on_hand, total_value, last_known_wac
    ) VALUES (
        v_warehouse_id, v_variant_a_id, 20.000, 1600.0000, 80.000000
    );

    -- ---------------------------------------------------------------------
    -- MVP policy is Direct Purchase and cannot be changed at runtime.
    -- ---------------------------------------------------------------------
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
    ASSERT v_denied,
        'Runtime workflow mutation must be rejected while advanced PO mode is future work';

    v_policy := procurement.get_purchase_workflow_policy(v_admin_token);
    ASSERT v_policy ->> 'mode' = 'DIRECT_PURCHASE',
        'Rejected workflow mutation must leave Direct Purchase active';

    SELECT count(*) INTO v_po_count_before FROM procurement.purchase_orders;

    -- ---------------------------------------------------------------------
    -- Small acceptance scenario: existing 20 @ 80, buy 10 @ 100.
    -- Expected: 30 units, 2600 DZD, WAC 86.666667.
    -- ---------------------------------------------------------------------
    v_result := procurement.post_purchase_transaction(
        v_admin_token,
        v_request_id,
        v_request_hash,
        jsonb_build_object(
            'supplier_id', v_supplier_id,
            'document_date', v_document_date,
            'external_supplier_document_number', NULL,
            'payment_status', 'UNPAID',
            'payment_method', NULL,
            'print_after_confirmation', false,
            'note', 'Direct Purchase MVP WAC acceptance',
            'lines', jsonb_build_array(jsonb_build_object(
                'variant_id', v_variant_a_id,
                'unit_id', v_unit_id,
                'quantity', '10.000',
                'unit_cost', '100.00'
            )),
            'additional_costs', '[]'::jsonb
        )
    );

    v_root_id := (v_result ->> 'document_id')::bigint;
    v_receipt_id := (v_result -> 'child_documents' ->> 'goods_receipt_id')::bigint;
    v_invoice_id := (v_result -> 'child_documents' ->> 'supplier_invoice_id')::bigint;

    ASSERT v_root_id IS NOT NULL, 'Direct Purchase must create its transaction root';
    ASSERT v_receipt_id IS NOT NULL, 'Direct Purchase must create a Purchase Receipt';
    ASSERT v_result -> 'child_documents' -> 'purchase_order_id' = 'null'::jsonb,
        'Direct Purchase must not return a synthetic Purchase Order';
    ASSERT (SELECT count(*) FROM procurement.purchase_orders) = v_po_count_before,
        'Direct Purchase must not create any Purchase Order row';

    ASSERT EXISTS (
        SELECT 1
        FROM procurement.purchase_transactions purchase_tx
        WHERE purchase_tx.document_id = v_root_id
          AND purchase_tx.purchase_order_id IS NULL
          AND purchase_tx.goods_receipt_id = v_receipt_id
          AND purchase_tx.gross_subtotal = 1000.00
          AND purchase_tx.total_amount = 1000.00
    ), 'Direct Purchase root must persist truthful totals without a PO';

    ASSERT EXISTS (
        SELECT 1
        FROM procurement.purchase_receipts receipt
        WHERE receipt.document_id = v_receipt_id
          AND receipt.purchase_order_id IS NULL
          AND receipt.receipt_origin = 'DIRECT_PURCHASE'
          AND receipt.total_amount = 1000.00
    ), 'Purchase Receipt must be explicitly DIRECT_PURCHASE with no PO';

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

    ASSERT v_qty = 30.000,
        '20 existing + 10 purchased must produce 30 units';
    ASSERT v_value = 2600.0000,
        '1600 existing + 1000 purchase must produce 2600 DZD inventory value';
    ASSERT v_wac = 86.666667,
        '2600 / 30 must produce authoritative WAC 86.666667';

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

    -- Current one-entry purchase contract immediately produces the supplier
    -- invoice/AP leg after the physical receipt. It must match the direct receipt,
    -- never a fabricated PO.
    ASSERT v_invoice_id IS NOT NULL, 'Purchase transaction must create its supplier invoice evidence';
    ASSERT EXISTS (
        SELECT 1
        FROM procurement.supplier_invoices invoice
        WHERE invoice.document_id = v_invoice_id
          AND invoice.purchase_order_id IS NULL
          AND invoice.supplier_id = v_supplier_id
          AND invoice.base_total_amount = 1000.00
    ), 'Supplier Invoice must remain compatible with a Direct Purchase receipt';

    ASSERT EXISTS (
        SELECT 1
        FROM procurement.supplier_invoice_lines invoice_line
        JOIN procurement.purchase_receipt_lines receipt_line
          ON receipt_line.id = invoice_line.receipt_line_id
        WHERE invoice_line.document_id = v_invoice_id
          AND invoice_line.po_line_id IS NULL
          AND receipt_line.document_id = v_receipt_id
          AND invoice_line.variant_id = v_variant_a_id
          AND invoice_line.quantity = 10.000
    ), 'Supplier invoice line must match the exact Direct Purchase receipt line';

    SELECT outstanding_amount
    INTO v_ap
    FROM procurement.supplier_liabilities
    WHERE invoice_document_id = v_invoice_id;
    ASSERT v_ap = 1000.00,
        'Unpaid Direct Purchase must create 1000 DZD supplier liability';

    -- ---------------------------------------------------------------------
    -- Idempotency: same request and hash return the same transaction once.
    -- ---------------------------------------------------------------------
    v_repeat := procurement.post_purchase_transaction(
        v_admin_token,
        v_request_id,
        v_request_hash,
        jsonb_build_object(
            'supplier_id', v_supplier_id,
            'document_date', v_document_date,
            'external_supplier_document_number', NULL,
            'payment_status', 'UNPAID',
            'payment_method', NULL,
            'print_after_confirmation', false,
            'note', 'Direct Purchase MVP WAC acceptance',
            'lines', jsonb_build_array(jsonb_build_object(
                'variant_id', v_variant_a_id,
                'unit_id', v_unit_id,
                'quantity', '10.000',
                'unit_cost', '100.00'
            )),
            'additional_costs', '[]'::jsonb
        )
    );

    ASSERT (v_repeat ->> 'document_id')::bigint = v_root_id,
        'Retry must return the original Direct Purchase';
    ASSERT (SELECT count(*) FROM procurement.purchase_transactions WHERE document_id = v_root_id) = 1,
        'Retry must not duplicate the purchase root';
    ASSERT (SELECT count(*) FROM procurement.purchase_receipts WHERE document_id = v_receipt_id) = 1,
        'Retry must not duplicate the receipt';

    SELECT quantity_on_hand, total_value, last_known_wac
    INTO v_qty, v_value, v_wac
    FROM inventory.positions
    WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_a_id;
    ASSERT v_qty = 30.000 AND v_value = 2600.0000 AND v_wac = 86.666667,
        'Retry must not duplicate stock or valuation';

    -- ---------------------------------------------------------------------
    -- Direct Purchase landed-cost compatibility on a separate variant.
    -- ---------------------------------------------------------------------
    v_landed_result := procurement.post_purchase_transaction(
        v_admin_token,
        v_landed_request_id,
        sha256('direct-purchase-landed-cost'::bytea),
        jsonb_build_object(
            'supplier_id', v_supplier_id,
            'document_date', v_document_date,
            'external_supplier_document_number', NULL,
            'payment_status', 'UNPAID',
            'payment_method', NULL,
            'print_after_confirmation', false,
            'note', 'Direct Purchase landed cost acceptance',
            'lines', jsonb_build_array(jsonb_build_object(
                'variant_id', v_variant_b_id,
                'unit_id', v_unit_id,
                'quantity', '10.000',
                'unit_cost', '100.00'
            )),
            'additional_costs', jsonb_build_array(jsonb_build_object(
                'cost_type', 'FREIGHT',
                'amount', '100.00'
            ))
        )
    );

    v_landed_root_id := (v_landed_result ->> 'document_id')::bigint;
    v_landed_receipt_id := (v_landed_result -> 'child_documents' ->> 'goods_receipt_id')::bigint;
    ASSERT v_landed_root_id IS NOT NULL AND v_landed_receipt_id IS NOT NULL,
        'Direct Purchase with landed cost must post successfully';
    ASSERT v_landed_result -> 'child_documents' -> 'purchase_order_id' = 'null'::jsonb,
        'Landed cost must not force a fake Purchase Order';
    ASSERT (SELECT count(*) FROM procurement.purchase_orders) = v_po_count_before,
        'Landed-cost Direct Purchase must not create a Purchase Order';

    SELECT quantity_on_hand, total_value, last_known_wac
    INTO v_qty, v_value, v_wac
    FROM inventory.positions
    WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_b_id;
    ASSERT v_qty = 10.000 AND v_value = 1100.0000 AND v_wac = 110.000000,
        '10 x 100 plus 100 freight must produce 1100 DZD value and 110 WAC';

    ASSERT EXISTS (
        SELECT 1
        FROM inventory.movements movement
        WHERE movement.reference_type = 'PURCHASE_RECEIPT'
          AND movement.reference_id = v_landed_receipt_id
          AND movement.variant_id = v_variant_b_id
          AND movement.movement_type = 'COST_ONLY'
          AND movement.quantity_delta = 0
          AND movement.inventory_value_delta = 100.00
    ), 'Direct Purchase landed cost must append canonical COST_ONLY valuation movement';

    -- ---------------------------------------------------------------------
    -- Supplier Return compatibility through exact receipt lineage.
    -- ---------------------------------------------------------------------
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

    ASSERT v_return_result ->> 'status' = 'POSTED',
        'Direct Purchase Supplier Return must post';
    ASSERT EXISTS (
        SELECT 1
        FROM procurement.supplier_returns supplier_return
        WHERE supplier_return.document_id = v_return_id
          AND supplier_return.purchase_order_id IS NULL
          AND supplier_return.receipt_document_id = v_receipt_id
    ), 'Posted Supplier Return must remain linked to receipt rather than a PO';

    SELECT quantity_on_hand
    INTO v_qty
    FROM inventory.positions
    WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_a_id;
    ASSERT v_qty = 28.000,
        'Returning two units from the 30-unit stock position must leave 28';

    SELECT outstanding_amount
    INTO v_ap
    FROM procurement.supplier_liabilities
    WHERE invoice_document_id = v_invoice_id;
    ASSERT v_ap = 800.00,
        'Two-unit return at authoritative 100 DZD supplier cost must reduce AP to 800 DZD';

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
    ), 'Direct receipt read model must expose correct returnable quantity without a PO';

    ASSERT (SELECT count(*) FROM procurement.purchase_orders) = v_po_count_before,
        'Complete Direct Purchase scenario must create zero synthetic Purchase Orders';

    ASSERT (SELECT migration_version FROM operations.schema_state WHERE singleton) >= 20260816164000,
        'Schema state must include the Direct Purchase MVP policy lock';

    RAISE NOTICE '=== DIRECT PURCHASE MVP ACCEPTANCE ASSERTIONS PASSED ===';
END;
$$;
