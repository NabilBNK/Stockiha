-- Direct-purchase recovery acceptance.
-- Proves that one operator confirmation posts goods that already arrived without
-- fabricating a purchase order, while preserving WAC, GRNI/AP, landed-cost,
-- idempotency and persisted workflow-policy semantics.
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
    v_request_id uuid := 'd1000000-0000-4000-8000-000000000001'::uuid;
    v_request_hash bytea := sha256('direct-purchase-acceptance'::bytea);
    v_po_count_before bigint;
    v_root_id bigint;
    v_receipt_id bigint;
    v_invoice_id bigint;
    v_result jsonb;
    v_repeat jsonb;
    v_policy jsonb;
    v_qty numeric;
    v_value numeric;
    v_wac numeric;
    v_invoice_ap numeric;
    v_landed_ap numeric;
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
    VALUES ('Direct Purchase Item', v_unit_id, true)
    RETURNING id INTO v_product_id;

    INSERT INTO catalog.product_variants (
        product_id, base_unit_id, sku, sale_price, is_active
    ) VALUES (
        v_product_id, v_unit_id, 'DIRECT-SKU-' || v_suffix, 180.00, true
    ) RETURNING id INTO v_variant_id;

    v_policy := procurement.get_purchase_workflow_policy(v_admin_token);
    ASSERT v_policy ->> 'mode' = 'DIRECT_PURCHASE',
        'Direct purchase must be the default purchasing workflow';
    ASSERT (v_policy ->> 'can_manage')::boolean,
        'Administrator must be allowed to manage purchasing workflow policy';

    SELECT count(*) INTO v_po_count_before FROM procurement.purchase_orders;

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
            'note', 'Goods already physically received',
            'lines', jsonb_build_array(jsonb_build_object(
                'variant_id', v_variant_id,
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

    v_root_id := (v_result ->> 'document_id')::bigint;
    v_receipt_id := (v_result -> 'child_documents' ->> 'goods_receipt_id')::bigint;
    v_invoice_id := (v_result -> 'child_documents' ->> 'supplier_invoice_id')::bigint;

    ASSERT v_root_id IS NOT NULL, 'Direct purchase must create a root purchase transaction';
    ASSERT v_receipt_id IS NOT NULL, 'Direct purchase must create a goods receipt';
    ASSERT v_invoice_id IS NOT NULL, 'Direct purchase must create a supplier invoice';
    ASSERT v_result -> 'child_documents' -> 'purchase_order_id' = 'null'::jsonb,
        'Direct purchase result must not contain a synthetic purchase order';
    ASSERT (SELECT count(*) FROM procurement.purchase_orders) = v_po_count_before,
        'Direct purchase must not create any purchase order row';

    ASSERT EXISTS (
        SELECT 1
        FROM procurement.purchase_transactions transaction
        WHERE transaction.document_id = v_root_id
          AND transaction.purchase_order_id IS NULL
          AND transaction.external_supplier_document_number IS NULL
          AND transaction.goods_receipt_id = v_receipt_id
          AND transaction.supplier_invoice_id = v_invoice_id
          AND transaction.gross_subtotal = 1000.00
          AND transaction.additional_cost_amount = 100.00
          AND transaction.total_amount = 1100.00
          AND transaction.outstanding_amount = 1100.00
    ), 'Root purchase transaction must persist the direct-purchase totals and nullable supplier reference';

    ASSERT EXISTS (
        SELECT 1
        FROM procurement.purchase_receipts receipt
        WHERE receipt.document_id = v_receipt_id
          AND receipt.purchase_order_id IS NULL
          AND receipt.receipt_origin = 'DIRECT_PURCHASE'
          AND receipt.total_amount = 1000.00
    ), 'Goods receipt must be a direct receipt with no purchase order';

    ASSERT EXISTS (
        SELECT 1
        FROM procurement.purchase_receipt_lines line
        WHERE line.document_id = v_receipt_id
          AND line.po_line_id IS NULL
          AND line.variant_id = v_variant_id
          AND line.quantity_received = 10.000
          AND line.unit_cost = 100.00
          AND line.line_total = 1000.00
    ), 'Direct receipt line must preserve quantity and acquisition cost without a PO line';

    SELECT quantity_on_hand, total_value, last_known_wac
    INTO v_qty, v_value, v_wac
    FROM inventory.positions
    WHERE warehouse_id = v_warehouse_id
      AND variant_id = v_variant_id;
    ASSERT v_qty = 10.000 AND v_value = 1100.00 AND v_wac = 110.000000,
        '10 x 100 DZD plus 100 DZD freight must produce 10 units, 1100 DZD inventory value and 110 DZD WAC';

    ASSERT EXISTS (
        SELECT 1
        FROM inventory.movements movement
        WHERE movement.reference_type = 'PURCHASE_RECEIPT'
          AND movement.reference_id = v_receipt_id
          AND movement.variant_id = v_variant_id
          AND movement.movement_type = 'RECEIPT'
          AND movement.quantity_delta = 10.000
          AND movement.inventory_value_delta = 1000.00
    ), 'Direct goods posting must append the canonical RECEIPT movement';
    ASSERT EXISTS (
        SELECT 1
        FROM inventory.movements movement
        WHERE movement.reference_type = 'PURCHASE_RECEIPT'
          AND movement.reference_id = v_receipt_id
          AND movement.variant_id = v_variant_id
          AND movement.movement_type = 'COST_ONLY'
          AND movement.quantity_delta = 0
          AND movement.inventory_value_delta = 100.00
    ), 'Additional freight must append the canonical landed-cost COST_ONLY movement';

    ASSERT EXISTS (
        SELECT 1
        FROM procurement.supplier_invoices invoice
        WHERE invoice.document_id = v_invoice_id
          AND invoice.purchase_order_id IS NULL
          AND invoice.supplier_id = v_supplier_id
          AND invoice.base_total_amount = 1000.00
    ), 'Direct supplier invoice must be linked to the supplier without a PO';
    ASSERT EXISTS (
        SELECT 1
        FROM procurement.supplier_invoice_lines invoice_line
        JOIN procurement.purchase_receipt_lines receipt_line
          ON receipt_line.id = invoice_line.receipt_line_id
        WHERE invoice_line.document_id = v_invoice_id
          AND invoice_line.po_line_id IS NULL
          AND receipt_line.document_id = v_receipt_id
          AND invoice_line.variant_id = v_variant_id
          AND invoice_line.quantity = 10.000
    ), 'Direct invoice line must match the exact direct receipt line';

    SELECT outstanding_amount
    INTO v_invoice_ap
    FROM procurement.supplier_liabilities
    WHERE invoice_document_id = v_invoice_id;
    SELECT outstanding_amount
    INTO v_landed_ap
    FROM procurement.supplier_liabilities
    WHERE receipt_document_id = v_receipt_id
      AND invoice_document_id IS NULL;
    ASSERT v_invoice_ap = 1000.00,
        'Unpaid direct purchase must create 1000 DZD goods AP';
    ASSERT v_landed_ap = 100.00,
        'Unpaid direct purchase freight must create its separate 100 DZD AP';

    ASSERT NOT EXISTS (
        SELECT journal.document_id
        FROM finance.journal_entries journal
        JOIN finance.journal_lines line ON line.document_id = journal.document_id
        WHERE journal.source_id IN (v_receipt_id, v_invoice_id)
        GROUP BY journal.document_id
        HAVING sum(line.debit) <> sum(line.credit)
    ), 'Every direct-purchase receipt, landed-cost and invoice journal must balance';

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
            'note', 'Goods already physically received',
            'lines', jsonb_build_array(jsonb_build_object(
                'variant_id', v_variant_id,
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
    ASSERT (v_repeat ->> 'document_id')::bigint = v_root_id,
        'Direct purchase retry must return the original root transaction';
    ASSERT (SELECT count(*) FROM procurement.purchase_transactions WHERE document_id = v_root_id) = 1,
        'Direct purchase retry must not duplicate the root transaction';
    ASSERT (SELECT count(*) FROM procurement.purchase_receipts WHERE document_id = v_receipt_id) = 1,
        'Direct purchase retry must not duplicate the receipt';
    ASSERT (SELECT count(*) FROM procurement.supplier_invoices WHERE document_id = v_invoice_id) = 1,
        'Direct purchase retry must not duplicate the supplier invoice';

    v_policy := procurement.update_purchase_workflow_policy(v_admin_token, 'PURCHASE_ORDER');
    ASSERT v_policy ->> 'mode' = 'PURCHASE_ORDER',
        'Administrator must be able to switch new purchases to PO workflow';
    ASSERT EXISTS (
        SELECT 1 FROM procurement.purchase_transactions WHERE document_id = v_root_id
    ), 'Changing workflow must not rewrite the already-posted direct purchase';

    BEGIN
        PERFORM procurement.post_purchase_transaction(
            v_admin_token,
            'd1000000-0000-4000-8000-000000000002'::uuid,
            sha256('blocked-by-po-policy'::bytea),
            jsonb_build_object(
                'supplier_id', v_supplier_id,
                'document_date', v_document_date,
                'payment_status', 'UNPAID',
                'print_after_confirmation', false,
                'lines', jsonb_build_array(jsonb_build_object(
                    'variant_id', v_variant_id,
                    'unit_id', v_unit_id,
                    'quantity', '1.000',
                    'unit_cost', '100.00'
                ))
            )
        );
    EXCEPTION WHEN object_not_in_prerequisite_state THEN
        v_denied := true;
    END;
    ASSERT v_denied,
        'PO workflow policy must block creation of a new direct purchase';
    ASSERT (SELECT count(*) FROM procurement.purchase_orders) = v_po_count_before,
        'Policy switch must not fabricate a purchase order either';

    ASSERT (SELECT migration_version FROM operations.schema_state WHERE singleton) >= 20260816162000,
        'Recovery schema state must include the direct-purchase contract';

    RAISE NOTICE '=== DIRECT PURCHASE RECOVERY ASSERTIONS PASSED ===';
END;
$$;
