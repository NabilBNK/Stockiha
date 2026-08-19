-- Direct Purchase supplier-invoice compatibility acceptance.
-- Verifies an uninvoiced first-class direct receipt can be discovered, drafted,
-- confirmed and turned into AP without inventing a Purchase Order.
\set ON_ERROR_STOP on

DO $$
DECLARE
    v_suffix text := floor(random() * 1000000000)::text;
    v_admin_id bigint;
    v_admin_token text := 'direct_invoice_admin_' || floor(random() * 1000000000)::text;
    v_supplier_id bigint;
    v_warehouse_id bigint;
    v_product_id bigint;
    v_variant_id bigint;
    v_unit_id bigint;
    v_period_id bigint;
    v_document_date date;
    v_receipt_result jsonb;
    v_receipt_id bigint;
    v_receipt_line_id bigint;
    v_receipts jsonb;
    v_draft jsonb;
    v_invoice_id bigint;
    v_confirmed jsonb;
BEGIN
    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES ('direct_invoice_admin_' || v_suffix, 'Direct Invoice Admin', 'hash')
    RETURNING id INTO v_admin_id;

    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_admin_id, id FROM iam.roles WHERE code = 'ADMIN';

    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (
        v_admin_id,
        'DIRECT-INVOICE-TEST',
        sha256(v_admin_token::bytea),
        now() + interval '2 hours'
    );

    SELECT id, CURRENT_DATE
    INTO v_period_id, v_document_date
    FROM finance.fiscal_periods
    WHERE status = 'OPEN'
      AND CURRENT_DATE BETWEEN starts_on AND ends_on
    ORDER BY starts_on DESC
    LIMIT 1;
    ASSERT v_period_id IS NOT NULL,
        'Direct invoice test requires an open fiscal period containing CURRENT_DATE';

    SELECT id
    INTO v_unit_id
    FROM catalog.units
    WHERE normalized_code = 'UNIT'
    ORDER BY id
    LIMIT 1;
    IF v_unit_id IS NULL THEN
        SELECT id INTO v_unit_id FROM catalog.units ORDER BY id LIMIT 1;
    END IF;
    ASSERT v_unit_id IS NOT NULL, 'Direct invoice test requires a catalog unit';

    INSERT INTO procurement.suppliers (code, name, is_active)
    VALUES ('SUP-DIRINV-' || v_suffix, 'Direct Invoice Supplier', true)
    RETURNING id INTO v_supplier_id;

    INSERT INTO inventory.warehouses (code, name, is_active)
    VALUES ('WH-DIRINV-' || v_suffix, 'Direct Invoice Warehouse', true)
    RETURNING id INTO v_warehouse_id;

    INSERT INTO catalog.products (name, unit_id, is_active)
    VALUES ('Direct Invoice Product', v_unit_id, true)
    RETURNING id INTO v_product_id;

    INSERT INTO catalog.product_variants (
        product_id, base_unit_id, sku, sale_price, is_active
    ) VALUES (
        v_product_id, v_unit_id, 'DIRINV-' || v_suffix, 150.00, true
    ) RETURNING id INTO v_variant_id;

    -- Post only the physical direct receipt. This deliberately leaves the
    -- receipt invoiceable so the manual Supplier Invoice path can be proven.
    v_receipt_result := inventory.confirm_direct_purchase_receipt(
        v_admin_token,
        'd2000000-0000-4000-8000-000000000001'::uuid,
        sha256(('direct-invoice-receipt-' || v_suffix)::bytea),
        v_supplier_id,
        v_warehouse_id,
        v_period_id,
        v_document_date,
        jsonb_build_array(jsonb_build_object(
            'variant_id', v_variant_id,
            'unit_id', v_unit_id,
            'quantity_received', '5.000',
            'unit_cost', '100.00'
        )),
        'Direct invoice compatibility receipt'
    );

    v_receipt_id := (v_receipt_result ->> 'document_id')::bigint;
    ASSERT v_receipt_id IS NOT NULL, 'Direct receipt must post';
    ASSERT v_receipt_result ->> 'receipt_origin' = 'DIRECT_PURCHASE',
        'Receipt response must identify DIRECT_PURCHASE';
    ASSERT v_receipt_result -> 'purchase_order_id' = 'null'::jsonb,
        'Direct receipt must have no Purchase Order';

    SELECT id
    INTO v_receipt_line_id
    FROM procurement.purchase_receipt_lines
    WHERE document_id = v_receipt_id;
    ASSERT v_receipt_line_id IS NOT NULL, 'Direct receipt line must exist';

    -- The receipt-history read model must not drop direct receipts through an
    -- inner Purchase Order join.
    v_receipts := procurement.list_purchase_receipts(v_admin_token, v_supplier_id, NULL);
    ASSERT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v_receipts) item
        WHERE (item ->> 'document_id')::bigint = v_receipt_id
          AND item ->> 'receipt_origin' = 'DIRECT_PURCHASE'
          AND item -> 'purchase_order_id' = 'null'::jsonb
          AND item -> 'purchase_order_number' = 'null'::jsonb
    ), 'Purchase receipt history must include the direct receipt with null PO fields';

    v_draft := procurement.create_supplier_invoice_draft(
        v_admin_token,
        v_supplier_id,
        NULL::bigint,
        'DZD',
        1.000000,
        'Invoice against direct receipt',
        jsonb_build_array(jsonb_build_object(
            'line_number', 1,
            'po_line_id', NULL,
            'receipt_line_id', v_receipt_line_id,
            'variant_id', v_variant_id,
            'quantity', '5.000',
            'unit_cost', '100.00'
        ))
    );

    v_invoice_id := (v_draft ->> 'document_id')::bigint;
    ASSERT v_invoice_id IS NOT NULL, 'Direct receipt must create a supplier invoice draft';
    ASSERT v_draft -> 'purchase_order_id' = 'null'::jsonb,
        'Direct supplier invoice draft must not fabricate a PO reference';

    ASSERT EXISTS (
        SELECT 1
        FROM procurement.supplier_invoices invoice
        WHERE invoice.document_id = v_invoice_id
          AND invoice.supplier_id = v_supplier_id
          AND invoice.purchase_order_id IS NULL
          AND invoice.base_total_amount = 500.00
    ), 'Direct supplier invoice header must persist null purchase_order_id and correct total';

    ASSERT EXISTS (
        SELECT 1
        FROM procurement.supplier_invoice_lines invoice_line
        WHERE invoice_line.document_id = v_invoice_id
          AND invoice_line.po_line_id IS NULL
          AND invoice_line.receipt_line_id = v_receipt_line_id
          AND invoice_line.variant_id = v_variant_id
          AND invoice_line.quantity = 5.000
          AND invoice_line.unit_cost = 100.00
    ), 'Direct supplier invoice line must match the exact receipt line without a PO line';

    v_confirmed := procurement.confirm_supplier_invoice(
        v_admin_token,
        'd2000000-0000-4000-8000-000000000002'::uuid,
        sha256(('direct-invoice-confirm-' || v_suffix)::bytea),
        v_invoice_id,
        v_period_id,
        v_document_date
    );

    ASSERT v_confirmed ->> 'status' = 'POSTED',
        'Direct supplier invoice must confirm successfully';
    ASSERT EXISTS (
        SELECT 1
        FROM procurement.supplier_liabilities liability
        WHERE liability.invoice_document_id = v_invoice_id
          AND liability.supplier_id = v_supplier_id
          AND liability.purchase_order_id IS NULL
          AND liability.original_amount = 500.00
          AND liability.outstanding_amount = 500.00
    ), 'Confirmed direct supplier invoice must create AP without a PO';

    ASSERT NOT EXISTS (
        SELECT 1
        FROM procurement.purchase_orders purchase_order
        WHERE purchase_order.supplier_id = v_supplier_id
    ), 'Direct receipt invoice path must create zero synthetic Purchase Orders';

    RAISE NOTICE '=== DIRECT PURCHASE SUPPLIER INVOICE ASSERTIONS PASSED ===';
END;
$$;
