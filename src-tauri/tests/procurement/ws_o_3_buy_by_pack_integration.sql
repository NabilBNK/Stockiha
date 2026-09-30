-- WS-O-3 Buy by the pack integration tests
-- Tests pack line splitting, extra pieces costing at pack rate, validation errors,
-- stock movements, balanced journals, and receipt projection.
\set ON_ERROR_STOP on

DO $$
DECLARE
    v_suffix text := floor(random() * 1000000000)::text;
    v_admin_id bigint;
    v_admin_token text := 'pack_dp_admin_' || v_suffix;
    v_supplier_id bigint;
    v_warehouse_id bigint;
    v_product_id bigint;
    v_variant_id bigint;
    v_base_unit_id bigint;
    v_box_unit_id bigint;
    v_variant_unit_id bigint;
    v_period_id bigint;
    v_document_date date;
    v_result jsonb;
    v_repeat jsonb;
    v_receipt_id bigint;
    v_lines jsonb;
    v_pos_qty numeric;
    v_pos_val numeric;
    v_pos_wac numeric;
    v_journal_id bigint;
    v_dr_total numeric;
    v_cr_total numeric;
    v_caught boolean;
BEGIN
    -- 1. Setup Admin, Session, Warehouse, Supplier, Units
    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES ('pack_dp_admin_' || v_suffix, 'Pack DP Admin', 'hash')
    RETURNING id INTO v_admin_id;

    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_admin_id, id FROM iam.roles WHERE code = 'ADMIN';

    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_admin_id, 'PACK-DP-WS', sha256(v_admin_token::bytea), now() + interval '2 hours');

    SELECT id, starts_on + 1
    INTO v_period_id, v_document_date
    FROM finance.fiscal_periods
    WHERE status = 'OPEN'
    ORDER BY starts_on DESC
    LIMIT 1;
    ASSERT v_period_id IS NOT NULL, 'Open fiscal period required';

    -- Units: Piece (base) and Box-12 (pack)
    INSERT INTO catalog.units (code, normalized_code, name, allows_fractions)
    VALUES ('PCS_' || v_suffix, lower('PCS_' || v_suffix), 'Piece', false)
    RETURNING id INTO v_base_unit_id;

    INSERT INTO catalog.units (code, normalized_code, name, allows_fractions)
    VALUES ('BX12_' || v_suffix, lower('BX12_' || v_suffix), 'Boite de 12', false)
    RETURNING id INTO v_box_unit_id;

    INSERT INTO procurement.suppliers (code, name, is_active)
    VALUES ('SUP-PK-' || v_suffix, 'Pack Supplier', true)
    RETURNING id INTO v_supplier_id;

    INSERT INTO inventory.warehouses (code, name, is_active)
    VALUES ('WH-PK-' || v_suffix, 'Pack Warehouse', true)
    RETURNING id INTO v_warehouse_id;

    INSERT INTO catalog.products (name, unit_id, is_active)
    VALUES ('Pack Product ' || v_suffix, v_base_unit_id, true)
    RETURNING id INTO v_product_id;

    INSERT INTO catalog.product_variants (product_id, base_unit_id, sku, sale_price, is_active)
    VALUES (v_product_id, v_base_unit_id, 'PK-SKU-' || v_suffix, 150.00, true)
    RETURNING id INTO v_variant_id;

    -- Add pack unit to variant: factor = 12, sale_price = 1500, is_primary = true
    INSERT INTO catalog.variant_units (variant_id, unit_id, conversion_factor, conversion_direction, conversion_quantity, sale_price, is_primary, is_active)
    VALUES (v_variant_id, v_box_unit_id, 12.000000, 'ALT_TO_BASE', 12.000000, 1500.00, true, true)
    RETURNING id INTO v_variant_unit_id;

    -- Add pack barcode
    INSERT INTO catalog.variant_barcodes (variant_id, barcode, normalized_barcode, is_primary, variant_unit_id)
    VALUES (v_variant_id, 'PACK-BARCODE-' || v_suffix, 'PACK-BARCODE-' || v_suffix, false, v_variant_unit_id);

    -- ========================================================================
    -- Test 1: list_purchase_product_options returns primary pack & alternate units
    -- ========================================================================
    SELECT procurement.list_purchase_product_options(v_admin_token) INTO v_result;
    ASSERT jsonb_array_length(v_result) > 0, 'list_purchase_product_options returned empty';
    
    PERFORM 1 FROM jsonb_array_elements(v_result) opt
    WHERE (opt->>'variant_id')::bigint = v_variant_id
      AND (opt->>'primary_pack_unit_id')::bigint = v_box_unit_id
      AND jsonb_array_length(opt->'alternate_units') = 1;
    ASSERT FOUND, 'Option does not contain expected primary pack or alternate units';

    -- ========================================================================
    -- Test 2: Error cases (E3-1 to E3-4)
    -- ========================================================================
    -- E3-1: Negative extra pieces
    v_caught := false;
    BEGIN
        PERFORM inventory.confirm_direct_purchase(
            v_admin_token, gen_random_uuid(), '\x01'::bytea,
            v_supplier_id, v_warehouse_id, v_period_id, v_document_date, 'Negative extra',
            jsonb_build_array(jsonb_build_object(
                'variant_id', v_variant_id, 'unit_id', v_box_unit_id,
                'quantity_received', 2, 'unit_cost', 1200.00,
                'extra_base_quantity', -1
            ))
        );
    EXCEPTION WHEN SQLSTATE '22023' THEN
        v_caught := true;
    END;
    ASSERT v_caught, 'Negative extra pieces must be rejected';

    -- E3-2: Extra pieces >= factor (12 pieces on box of 12)
    v_caught := false;
    BEGIN
        PERFORM inventory.confirm_direct_purchase(
            v_admin_token, gen_random_uuid(), '\x02'::bytea,
            v_supplier_id, v_warehouse_id, v_period_id, v_document_date, 'Exceed factor',
            jsonb_build_array(jsonb_build_object(
                'variant_id', v_variant_id, 'unit_id', v_box_unit_id,
                'quantity_received', 2, 'unit_cost', 1200.00,
                'extra_base_quantity', 12
            ))
        );
    EXCEPTION WHEN SQLSTATE '22023' THEN
        v_caught := true;
    END;
    ASSERT v_caught, 'Extra pieces >= factor must be rejected';

    -- E3-3: Extra pieces on base unit line
    v_caught := false;
    BEGIN
        PERFORM inventory.confirm_direct_purchase(
            v_admin_token, gen_random_uuid(), '\x03'::bytea,
            v_supplier_id, v_warehouse_id, v_period_id, v_document_date, 'Extra on base',
            jsonb_build_array(jsonb_build_object(
                'variant_id', v_variant_id, 'unit_id', v_base_unit_id,
                'quantity_received', 10, 'unit_cost', 100.00,
                'extra_base_quantity', 3
            ))
        );
    EXCEPTION WHEN SQLSTATE '22023' THEN
        v_caught := true;
    END;
    ASSERT v_caught, 'Extra pieces on base unit line must be rejected';

    -- ========================================================================
    -- Test 3: W3 — Successful direct purchase with Pack + Extra pieces
    -- 5 Boxes of 12 @ 1200 DZD + 4 extra pieces
    -- Box line: 5 * 1200 = 6000 DZD
    -- Extra pieces line: 4 * (1200 / 12) = 4 * 100.00 = 400 DZD
    -- Total: 6400 DZD
    -- Base stock delta: 5 * 12 + 4 = 64 pieces
    -- ========================================================================
    v_result := inventory.confirm_direct_purchase(
        v_admin_token,
        'd3000000-0000-4000-8000-000000000001'::uuid,
        '\x10'::bytea,
        v_supplier_id, v_warehouse_id, v_period_id, v_document_date,
        'Buy by the pack test',
        jsonb_build_array(jsonb_build_object(
            'variant_id', v_variant_id,
            'unit_id', v_box_unit_id,
            'quantity_received', 5,
            'unit_cost', 1200.00,
            'extra_base_quantity', 4
        ))
    );
    v_receipt_id := (v_result->>'document_id')::bigint;
    ASSERT (v_result->>'total_amount') = '6400.00', 'Total amount must be 6400.00 DZD, got ' || (v_result->>'total_amount');

    -- Verify receipt lines table
    SELECT jsonb_agg(jsonb_build_object(
        'line_number', line_number,
        'unit_id', unit_id,
        'quantity_received', quantity_received,
        'unit_cost', unit_cost,
        'line_total', line_total,
        'pack_rate_of_unit_id', pack_rate_of_unit_id
    ) ORDER BY line_number) INTO v_lines
    FROM procurement.purchase_receipt_lines
    WHERE document_id = v_receipt_id;

    ASSERT jsonb_array_length(v_lines) = 2, 'Receipt must have exactly 2 lines';

    -- Line 1: Box
    ASSERT (v_lines->0->>'unit_id')::bigint = v_box_unit_id, 'Line 1 unit must be box';
    ASSERT (v_lines->0->>'quantity_received')::numeric = 5, 'Line 1 qty must be 5';
    ASSERT (v_lines->0->>'unit_cost')::numeric = 1200.00, 'Line 1 cost must be 1200.00';
    ASSERT (v_lines->0->>'line_total')::numeric = 6000.00, 'Line 1 total must be 6000.00';
    ASSERT (v_lines->0->>'pack_rate_of_unit_id') IS NULL, 'Line 1 pack_rate_of_unit_id must be null';

    -- Line 2: Extra pieces
    ASSERT (v_lines->1->>'unit_id')::bigint = v_base_unit_id, 'Line 2 unit must be base piece';
    ASSERT (v_lines->1->>'quantity_received')::numeric = 4, 'Line 2 qty must be 4';
    ASSERT (v_lines->1->>'unit_cost')::numeric = 100.00, 'Line 2 piece cost must be 100.00';
    ASSERT (v_lines->1->>'line_total')::numeric = 400.00, 'Line 2 total must be 400.00';
    ASSERT (v_lines->1->>'pack_rate_of_unit_id')::bigint = v_box_unit_id, 'Line 2 pack_rate_of_unit_id must be box unit id';

    -- Check Inventory Position
    SELECT quantity_on_hand, total_value, last_known_wac
    INTO v_pos_qty, v_pos_val, v_pos_wac
    FROM inventory.positions
    WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_id;

    ASSERT v_pos_qty = 64.000, 'Position quantity must be 64.000, got ' || v_pos_qty;
    ASSERT v_pos_val = 6400.00, 'Position value must be 6400.00, got ' || v_pos_val;
    ASSERT v_pos_wac = 100.000000, 'Position WAC must be 100.000000, got ' || v_pos_wac;

    -- Check Accounting Journal
    v_journal_id := (v_result->>'journal_document_id')::bigint;
    ASSERT v_journal_id IS NOT NULL, 'Journal must be posted';

    SELECT sum(debit), sum(credit)
    INTO v_dr_total, v_cr_total
    FROM finance.journal_lines
    WHERE document_id = v_journal_id;

    ASSERT v_dr_total = 6400.00, 'Debit must be 6400.00';
    ASSERT v_cr_total = 6400.00, 'Credit must be 6400.00';

    -- ========================================================================
    -- Test 4: list_purchase_receipt_lines projection
    -- ========================================================================
    SELECT procurement.list_purchase_receipt_lines(v_admin_token) INTO v_lines;
    PERFORM 1 FROM jsonb_array_elements(v_lines) l
    WHERE (l->>'receipt_document_id')::bigint = v_receipt_id
      AND (l->>'pack_rate_of_unit_id')::bigint = v_box_unit_id
      AND (l->>'pack_rate_unit_name') = 'Boite de 12';
    ASSERT FOUND, 'list_purchase_receipt_lines must report pack_rate_of_unit_id and pack_rate_unit_name';

    -- ========================================================================
    -- Test 5: Idempotency
    -- ========================================================================
    v_repeat := inventory.confirm_direct_purchase(
        v_admin_token,
        'd3000000-0000-4000-8000-000000000001'::uuid,
        '\x10'::bytea,
        v_supplier_id, v_warehouse_id, v_period_id, v_document_date,
        'Buy by the pack test',
        jsonb_build_array(jsonb_build_object(
            'variant_id', v_variant_id,
            'unit_id', v_box_unit_id,
            'quantity_received', 5,
            'unit_cost', 1200.00,
            'extra_base_quantity', 4
        ))
    );
    ASSERT (v_repeat->>'document_id')::bigint = v_receipt_id, 'Idempotent call must return original receipt';
    ASSERT (SELECT count(*) FROM procurement.purchase_receipt_lines WHERE document_id = v_receipt_id) = 2,
        'Idempotent call must not duplicate lines';

    RAISE NOTICE 'WS-O-3 Buy by pack integration tests PASSED successfully.';
END;
$$;
