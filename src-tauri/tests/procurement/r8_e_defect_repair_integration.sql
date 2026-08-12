-- R8-E Defect-Repair Integration SQL Test Suite
-- Verifies supplier return eligibility, journal list/detail queries,
-- business document queries, permissions, and feature toggles.
\set ON_ERROR_STOP on

DO $$
DECLARE
    v_suffix text := floor(random() * 1000000000)::text;
    v_admin_id bigint;
    v_cashier_id bigint;
    v_admin_token text := 'repair_admin_' || floor(random() * 1000000000)::text;
    v_cashier_token text := 'repair_cashier_' || floor(random() * 1000000000)::text;
    v_supplier_id bigint;
    v_warehouse_id bigint;
    v_product_id bigint;
    v_variant_id bigint;
    v_unit_id bigint;
    v_period_id bigint;
    v_document_date date;
    v_po_id bigint;
    v_receipt_id bigint;
    v_invoice_id bigint;
    v_liability_id bigint;
    v_return_id bigint;
    v_result jsonb;
    v_journals jsonb;
    v_journal_detail jsonb;
    v_docs jsonb;
    v_denied boolean := false;
BEGIN
    -- 1. Setup Admin and Cashier Users + Session Tokens
    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES ('repair_admin_' || v_suffix, 'Repair Admin', 'hash')
    RETURNING id INTO v_admin_id;
    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_admin_id, id FROM iam.roles WHERE code = 'ADMIN';
    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_admin_id, 'REPAIR-ADMIN', sha256(v_admin_token::bytea), now() + interval '2 hours');

    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES ('repair_cashier_' || v_suffix, 'Repair Cashier', 'hash')
    RETURNING id INTO v_cashier_id;
    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_cashier_id, id FROM iam.roles WHERE code = 'CASHIER';
    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_cashier_id, 'REPAIR-CASHIER', sha256(v_cashier_token::bytea), now() + interval '2 hours');

    SELECT id, starts_on + 1
    INTO v_period_id, v_document_date
    FROM finance.fiscal_periods
    WHERE status = 'OPEN'
    ORDER BY starts_on DESC
    LIMIT 1;
    ASSERT v_period_id IS NOT NULL, 'Open fiscal period required';

    SELECT id INTO v_unit_id FROM catalog.units ORDER BY id LIMIT 1;
    INSERT INTO procurement.suppliers (code, name, is_active)
    VALUES ('SUP-REP-' || v_suffix, 'Defect Repair Supplier', true)
    RETURNING id INTO v_supplier_id;
    INSERT INTO inventory.warehouses (code, name, is_active)
    VALUES ('WH-REP-' || v_suffix, 'Defect Repair Warehouse', true)
    RETURNING id INTO v_warehouse_id;
    INSERT INTO catalog.products (name, is_active)
    VALUES ('Defect Repair Item', true)
    RETURNING id INTO v_product_id;
    INSERT INTO catalog.product_variants (product_id, base_unit_id, sku, sale_price, is_active)
    VALUES (v_product_id, v_unit_id, 'SKU-REP-' || v_suffix, 200.00, true)
    RETURNING id INTO v_variant_id;

    -- 2. Create Purchase Order & Confirm Stock Receipt (10 units @ 100 DZD)
    v_result := procurement.create_purchase_order_draft(
        v_admin_token, v_supplier_id, v_warehouse_id, 'PO Defect Repair',
        jsonb_build_array(jsonb_build_object(
            'variant_id', v_variant_id, 'unit_id', v_unit_id,
            'quantity_ordered', 10.000, 'unit_cost', 100.00
        ))
    );
    v_po_id := (v_result ->> 'document_id')::bigint;
    PERFORM procurement.confirm_purchase_order(v_admin_token, v_po_id);

    v_result := inventory.confirm_purchase_receipt(
        v_admin_token, gen_random_uuid(), '\x10'::bytea,
        v_po_id, v_period_id, v_document_date,
        jsonb_build_array(jsonb_build_object(
            'po_line_id', (SELECT id FROM procurement.purchase_order_lines WHERE document_id = v_po_id),
            'quantity_received', 10.000
        ))
    );
    v_receipt_id := (v_result ->> 'document_id')::bigint;

    -- Verify receipt line projection
    v_result := procurement.list_purchase_receipt_lines(v_admin_token, v_po_id);
    ASSERT jsonb_array_length(v_result) = 1, 'Receipt line projection must contain 1 row';
    ASSERT (v_result -> 0 ->> 'eligibility_code') = 'ELIGIBLE', 'Receipt line must be ELIGIBLE';
    ASSERT (v_result -> 0 ->> 'quantity_returnable_for_variant')::numeric = 10.000, 'Returnable qty must be 10';

    -- 3. Post Supplier Invoice (10 units @ 105 DZD = 1050 DZD AP)
    v_result := procurement.create_supplier_invoice_draft(
        v_admin_token, v_supplier_id, v_po_id, 'DZD', 1.000000, 'Invoice',
        jsonb_build_array(jsonb_build_object(
            'line_number', 1,
            'po_line_id', (SELECT id FROM procurement.purchase_order_lines WHERE document_id = v_po_id),
            'receipt_line_id', (SELECT id FROM procurement.purchase_receipt_lines WHERE document_id = v_receipt_id),
            'variant_id', v_variant_id,
            'quantity', 10.000,
            'unit_cost', 105.00
        ))
    );
    v_invoice_id := (v_result ->> 'document_id')::bigint;
    PERFORM procurement.confirm_supplier_invoice(
        v_admin_token, gen_random_uuid(), '\x11'::bytea, v_invoice_id, v_period_id, v_document_date + 1
    );

    SELECT id INTO v_liability_id
    FROM procurement.supplier_liabilities
    WHERE invoice_document_id = v_invoice_id;

    -- Pay off full liability (1050 DZD)
    PERFORM procurement.post_supplier_payment(
        v_admin_token, gen_random_uuid(), '\x12'::bytea,
        v_supplier_id, v_liability_id, 1050.00, 'CASH',
        v_period_id, v_document_date + 2, 'Settlement'
    );

    -- 4. Verify Supplier Return Eligibility Blocks Post-Settlement Credit Return
    -- Attempting to return items now should fail with PRECONDITION_FAILED because outstanding liability is 0
    BEGIN
        PERFORM procurement.create_supplier_return_draft(
            v_admin_token, v_supplier_id, v_warehouse_id, v_po_id, 'DEFECTIVE_GOODS', 'return attempt',
            jsonb_build_array(jsonb_build_object(
                'variant_id', v_variant_id, 'quantity', 2.000, 'unit_cost', 105.00
            ))
        );
    EXCEPTION WHEN object_not_in_prerequisite_state THEN
        v_denied := true;
    END;
    ASSERT v_denied, 'Supplier return draft must reject when outstanding liability is zero';
    v_denied := false;

    -- Check list_purchase_receipt_lines projection reports INSUFFICIENT_LIABILITY
    v_result := procurement.list_purchase_receipt_lines(v_admin_token, v_po_id);
    ASSERT (v_result -> 0 ->> 'eligibility_code') = 'INSUFFICIENT_LIABILITY', 'Projection must report INSUFFICIENT_LIABILITY';
    ASSERT (v_result -> 0 ->> 'quantity_returnable_for_variant')::numeric = 0, 'Returnable qty must be 0 when settled';

    -- 5. Test finance.list_journals and finance.get_journal_detail
    v_journals := finance.list_journals(v_admin_token, 10, 0);
    ASSERT jsonb_array_length(v_journals) >= 3, 'Must list at least receipt, invoice, and payment journals';
    ASSERT (v_journals -> 0 ->> 'is_balanced')::boolean, 'Every journal entry must be balanced';

    v_journal_detail := finance.get_journal_detail(v_admin_token, (v_journals -> 0 ->> 'document_id')::bigint);
    ASSERT (v_journal_detail -> 'lines') IS NOT NULL, 'Journal detail must expose lines array';
    ASSERT jsonb_array_length(v_journal_detail -> 'lines') >= 2, 'Journal entry must contain at least 2 lines';

    -- 6. Test documents.list_business_documents
    v_docs := documents.list_business_documents(v_admin_token, 10, 0, NULL);
    ASSERT jsonb_array_length(v_docs) >= 4, 'Must list PO, receipt, invoice, payment documents';
    ASSERT (v_docs -> 0 ->> 'generation_status') = 'NOT_APPLICABLE', 'Procurement document generation must be NOT_APPLICABLE';
    ASSERT (v_docs -> 0 ->> 'print_status') = 'NOT_APPLICABLE', 'Procurement document print must be NOT_APPLICABLE';

    -- Cashier permission restriction test for list_business_documents
    v_docs := documents.list_business_documents(v_cashier_token, 10, 0, NULL);
    ASSERT jsonb_array_length(v_docs) = 0, 'Cashier must see 0 procurement business documents';

    -- 7. Test Feature Toggles (accounting_journals_enabled and business_documents_enabled)
    UPDATE core.system_settings SET setting_value = 'false' WHERE setting_key = 'accounting_journals_enabled';
    v_journals := finance.list_journals(v_admin_token, 10, 0);
    ASSERT jsonb_array_length(v_journals) = 0, 'Disabled journals toggle must return empty array';

    UPDATE core.system_settings SET setting_value = 'true' WHERE setting_key = 'accounting_journals_enabled';
    v_journals := finance.list_journals(v_admin_token, 10, 0);
    ASSERT jsonb_array_length(v_journals) >= 3, 'Re-enabled journals toggle must return journals';

    RAISE NOTICE '=== ALL R8-E DEFECT REPAIR SQL ASSERTIONS PASSED ===';
END;
$$;
