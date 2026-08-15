-- R8-D focused catalog/inventory journey. The suite runner owns the wrapping
-- transaction, so every fixture and posting is rolled back after assertions.
\set ON_ERROR_STOP on
SET client_min_messages = warning;

CREATE FUNCTION pg_temp.expect_error(p_sql text, p_sqlstate text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        EXECUTE p_sql;
        RAISE EXCEPTION 'ASSERT FAIL: expected sqlstate % but statement succeeded: %', p_sqlstate, p_sql;
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE <> p_sqlstate THEN
            RAISE EXCEPTION 'ASSERT FAIL: expected % got % for: %', p_sqlstate, SQLSTATE, p_sql;
        END IF;
    END;
END;
$$;

INSERT INTO iam.users (username, password_hash, display_name) VALUES
    ('r8d_manager', 'x', 'R8-D Manager'),
    ('r8d_cashier', 'x', 'R8-D Cashier');
INSERT INTO iam.user_roles (user_id, role_id)
SELECT user_account.id, role.id
FROM iam.users user_account, iam.roles role
WHERE user_account.username = 'r8d_manager' AND role.code = 'MANAGER';
INSERT INTO iam.user_roles (user_id, role_id)
SELECT user_account.id, role.id
FROM iam.users user_account, iam.roles role
WHERE user_account.username = 'r8d_cashier' AND role.code = 'CASHIER';
INSERT INTO iam.application_sessions (token_hash, user_id, workstation_id, expires_at)
SELECT sha256('r8d-manager-token'::bytea), id, 'R8D-MANAGER', now() + interval '1 day'
FROM iam.users WHERE username = 'r8d_manager';
INSERT INTO iam.application_sessions (token_hash, user_id, workstation_id, expires_at)
SELECT sha256('r8d-cashier-token'::bytea), id, 'R8D-CASHIER', now() + interval '1 day'
FROM iam.users WHERE username = 'r8d_cashier';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM finance.fiscal_periods
        WHERE DATE '2026-08-11' BETWEEN starts_on AND ends_on
          AND status = 'OPEN'
    ) THEN
        INSERT INTO finance.fiscal_periods (period_code, starts_on, ends_on)
        VALUES ('R8D-2026', '2026-08-01', '2026-08-31');
    END IF;
END;
$$;

INSERT INTO inventory.warehouses (code, name, is_active)
VALUES ('R8D-WH', 'R8-D Warehouse', true);

DO $$
DECLARE
    v_token constant text := 'r8d-manager-token';
    v_cashier_token constant text := 'r8d-cashier-token';
    v_period_id bigint;
    v_warehouse_id bigint;
    v_base_unit_id bigint;
    v_carton_unit_id bigint;
    v_attribute_id bigint;
    v_small_id bigint;
    v_large_id bigint;
    v_product jsonb;
    v_variant_id bigint;
    v_other_variant_id bigint;
    v_receipt_one_id bigint;
    v_receipt_two_id bigint;
    v_receipt_result record;
    v_adjustment jsonb;
    v_adjustment_document_id bigint;
    v_adjustment_journal_id bigint;
    v_before_document_count bigint;
    v_capabilities jsonb;
    v_cashier_capabilities jsonb;
    v_debit numeric;
    v_credit numeric;
BEGIN
    SELECT id INTO v_period_id
    FROM finance.fiscal_periods
    WHERE DATE '2026-08-11' BETWEEN starts_on AND ends_on
      AND status = 'OPEN'
    ORDER BY starts_on DESC
    LIMIT 1;
    SELECT id INTO v_warehouse_id FROM inventory.warehouses WHERE code = 'R8D-WH';
    v_base_unit_id := catalog.create_unit(v_token, 'PC', 'Piece');
    v_carton_unit_id := catalog.create_unit(v_token, 'R8D-CARTON', 'Carton');
    v_attribute_id := catalog.create_attribute(v_token, 'R8-D Size');
    v_small_id := catalog.add_attribute_value(v_token, v_attribute_id, 'Small');
    v_large_id := catalog.add_attribute_value(v_token, v_attribute_id, 'Large');

    v_product := catalog.create_product_with_variants(
        v_token,
        'R8-D Notebook',
        v_base_unit_id,
        true,
        jsonb_build_array(
            jsonb_build_object(
                'sale_price', '150.00',
                'is_active', true,
                'attribute_value_ids', jsonb_build_array(v_small_id),
                'barcodes', jsonb_build_array('613000000001')
            ),
            jsonb_build_object(
                'sale_price', '180.00',
                'is_active', true,
                'attribute_value_ids', jsonb_build_array(v_large_id),
                'barcodes', jsonb_build_array('613000000002')
            )
        )
    );
    v_variant_id := ((v_product -> 'variant_ids') ->> 0)::bigint;
    v_other_variant_id := ((v_product -> 'variant_ids') ->> 1)::bigint;
    PERFORM catalog.add_variant_unit(
        v_token,
        v_variant_id,
        v_carton_unit_id,
        12.000000
    );

    ASSERT (
        SELECT conversion_factor FROM catalog.variant_units
        WHERE variant_id = v_variant_id AND unit_id = v_carton_unit_id
    ) = 12.000000, 'Alternate unit factor must remain exact';

    v_capabilities := inventory.get_capabilities(v_token);
    ASSERT (v_capabilities ->> 'can_manage_catalog')::boolean,
        'Manager must receive catalog capability';
    ASSERT (v_capabilities ->> 'can_post_stock_receipt')::boolean,
        'Manager must receive receipt capability';
    ASSERT (v_capabilities ->> 'can_view_inventory')::boolean,
        'Manager must receive inventory read capability';
    ASSERT (v_capabilities ->> 'can_manage_inventory')::boolean,
        'Manager must receive adjustment capability';

    v_cashier_capabilities := inventory.get_capabilities(v_cashier_token);
    ASSERT NOT (v_cashier_capabilities ->> 'can_manage_catalog')::boolean,
        'Cashier must not receive catalog capability';
    ASSERT NOT (v_cashier_capabilities ->> 'can_view_inventory')::boolean,
        'Cashier must not receive inventory capability';

    -- 10 x 100 DZD.
    v_receipt_one_id := inventory.confirm_stock_receipt(
        v_token,
        '00000000-0000-4000-8000-000000000201',
        sha256('r8d-receipt-one'::bytea),
        v_warehouse_id,
        v_variant_id,
        10.000,
        100.00,
        v_period_id,
        '2026-08-11'
    );

    -- 10 x 120 DZD => qty 20, value 2200, WAC 110.
    v_receipt_two_id := inventory.confirm_stock_receipt(
        v_token,
        '00000000-0000-4000-8000-000000000202',
        sha256('r8d-receipt-two'::bytea),
        v_warehouse_id,
        v_variant_id,
        10.000,
        120.00,
        v_period_id,
        '2026-08-11'
    );

    ASSERT inventory.confirm_stock_receipt(
        v_token,
        '00000000-0000-4000-8000-000000000202',
        sha256('r8d-receipt-two'::bytea),
        v_warehouse_id,
        v_variant_id,
        10.000,
        120.00,
        v_period_id,
        '2026-08-11'
    ) = v_receipt_two_id, 'Idempotent retry must return the same receipt';

    ASSERT (
        SELECT count(*) FROM inventory.movements
        WHERE reference_type = 'STOCK_RECEIPT'
          AND reference_id = v_receipt_two_id
    ) = 1, 'Idempotent retry must not duplicate movements';

    SELECT * INTO v_receipt_result
    FROM inventory.get_stock_receipt_result(v_token, v_receipt_two_id);
    ASSERT v_receipt_result.document_number ~ '^SR-2026-[0-9]{6}$',
        'Receipt result must expose official document number';
    ASSERT v_receipt_result.resulting_quantity_on_hand = 20.000,
        'Receipt result quantity must be 20';
    ASSERT v_receipt_result.resulting_total_value = 2200.0000,
        'Receipt result value must be 2200';
    ASSERT v_receipt_result.resulting_wac = 110.000000,
        'Receipt result WAC must be 110';

    ASSERT (
        SELECT quantity_on_hand FROM inventory.list_inventory_snapshot(
            v_token, v_warehouse_id, '613000000001', false
        )
    ) = 20.000, 'Snapshot quantity must be 20';
    ASSERT (
        SELECT total_value FROM inventory.list_inventory_snapshot(
            v_token, v_warehouse_id, '613000000001', false
        )
    ) = 2200.0000, 'Barcode search must expose exact total value';
    ASSERT (
        SELECT last_known_wac FROM inventory.list_inventory_snapshot(
            v_token, v_warehouse_id, 'R8-D Notebook', false
        )
        WHERE variant_id = v_variant_id
    ) = 110.000000, 'Snapshot WAC must be 110';

    -- Damage one base unit => qty 19, value 2090, WAC unchanged.
    v_adjustment := inventory.confirm_stock_adjustment(
        v_token,
        '00000000-0000-4000-8000-000000000203',
        sha256('r8d-damage-one'::bytea),
        v_warehouse_id,
        v_variant_id,
        v_base_unit_id,
        -1.000,
        'DAMAGE',
        'R8-D deterministic damage check',
        v_period_id,
        '2026-08-11'
    );
    v_adjustment_document_id := (v_adjustment ->> 'document_id')::bigint;
    v_adjustment_journal_id := (v_adjustment ->> 'journal_document_id')::bigint;
    ASSERT (v_adjustment ->> 'resulting_quantity_on_hand')::numeric = 19.000,
        'Damage result quantity must be 19';
    ASSERT (v_adjustment ->> 'resulting_total_value')::numeric = 2090.0000,
        'Damage result value must be 2090';

    SELECT coalesce(sum(debit), 0), coalesce(sum(credit), 0)
    INTO v_debit, v_credit
    FROM finance.journal_lines
    WHERE document_id = v_adjustment_journal_id;
    ASSERT v_debit = v_credit AND v_debit = 110.00,
        'Damage journal must balance at 110 DZD';

    SELECT count(*) INTO v_before_document_count FROM core.business_documents;
    PERFORM pg_temp.expect_error(format(
        'SELECT inventory.confirm_stock_adjustment(%L,%L::uuid,sha256(%L::bytea),%s,%s,%s,-20,%L,%L,%s,%L::date)',
        v_token,
        '00000000-0000-4000-8000-000000000204',
        'r8d-negative-stock',
        v_warehouse_id,
        v_variant_id,
        v_base_unit_id,
        'DAMAGE',
        'Must roll back',
        v_period_id,
        '2026-08-11'
    ), '55000');
    ASSERT (SELECT count(*) FROM core.business_documents) = v_before_document_count,
        'Rejected negative stock must not leave a document';
    ASSERT (
        SELECT quantity_on_hand FROM inventory.positions
        WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_id
    ) = 19.000, 'Rejected negative stock must not mutate quantity';
    ASSERT (
        SELECT total_value FROM inventory.positions
        WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_id
    ) = 2090.0000, 'Rejected negative stock must not mutate value';
    ASSERT NOT EXISTS (
        SELECT 1 FROM core.request_idempotency
        WHERE operation_key = 'inventory.confirm_stock_adjustment'
          AND request_id = '00000000-0000-4000-8000-000000000204'
    ), 'Rejected negative stock must not cache the request';

    PERFORM catalog.set_variant_active(v_token, v_other_variant_id, false);
    ASSERT NOT EXISTS (
        SELECT 1 FROM inventory.list_inventory_snapshot(
            v_token, v_warehouse_id, '613000000002', false
        )
    ), 'Inactive variants must be hidden by default';
    ASSERT EXISTS (
        SELECT 1 FROM inventory.list_inventory_snapshot(
            v_token, v_warehouse_id, '613000000002', true
        )
        WHERE NOT variant_is_active
    ), 'Inactive variants must remain inspectable when requested';

    PERFORM pg_temp.expect_error(format(
        'SELECT * FROM inventory.list_inventory_snapshot(%L,%s,NULL,false)',
        v_cashier_token, v_warehouse_id
    ), '42501');
    PERFORM pg_temp.expect_error(format(
        'SELECT * FROM inventory.get_stock_receipt_result(%L,%s)',
        v_cashier_token, v_receipt_one_id
    ), '42501');
    PERFORM pg_temp.expect_error(format(
        'SELECT * FROM inventory.list_inventory_snapshot(%L,%s,NULL,false)',
        'invalid-token', v_warehouse_id
    ), '28000');

    ASSERT has_function_privilege(
        'stockiha_runtime',
        'inventory.list_inventory_snapshot(text,bigint,text,boolean)',
        'EXECUTE'
    ), 'Runtime role must receive snapshot EXECUTE only through the function';
    ASSERT NOT has_table_privilege('stockiha_runtime', 'inventory.positions', 'UPDATE'),
        'Runtime role must not update protected inventory positions directly';

    ASSERT v_adjustment_document_id > 0, 'Adjustment document must be created';
END;
$$;

SET CONSTRAINTS ALL IMMEDIATE;
SELECT 'ALL R8-D CATALOG/INVENTORY ASSERTIONS PASSED' AS result;
