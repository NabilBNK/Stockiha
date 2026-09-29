-- WS-O-1 pack catalogue integration assertions (T1-T41)
-- Run against a DB with all migrations applied.
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
            RAISE EXCEPTION 'ASSERT FAIL: expected % got % for: % (message: %)', p_sqlstate, SQLSTATE, p_sql, SQLERRM;
        END IF;
    END;
END; $$;

DO $$
DECLARE
    v_adm text := 'wsoadmin_tok';
    v_noperm text := 'wsonoperm_tok';
    v_adm_user_id bigint;
    v_noperm_user_id bigint;
    v_unit bigint;
    v_ctn bigint;
    v_bal bigint;
    v_kg bigint;
    v_sac bigint;
    v_dzn bigint;
    v_p1 bigint; v_v1 bigint; v_v1_sku text;
    v_p2 bigint; v_v2 bigint;
    v_p3 bigint; v_v3 bigint;
    v_p4 bigint; v_v4 bigint;
    v_v1_ctn_pack bigint;
    v_v1_bal_pack bigint;
    v_v2_ctn_pack bigint;
    v_v3_sac_pack bigint;
    v_v3_dzn_pack bigint;
    v_v4_kg_alt bigint;
    v_v4_ctn_pack bigint;
    v_bc_id bigint;
    v_piece_bc_id bigint;
    v_res jsonb;
    v_cnt bigint;
    v_rec record;
    v_supplier_id bigint;
    v_warehouse_id bigint;
    v_period_id bigint;
    v_document_date date;
    v_direct_purchase_res jsonb;
BEGIN
    -- Fixtures: Users, roles, sessions
    INSERT INTO iam.users (username, password_hash, display_name)
    VALUES ('wsoadmin', 'x', 'WSO Admin')
    RETURNING id INTO v_adm_user_id;

    INSERT INTO iam.users (username, password_hash, display_name)
    VALUES ('wsonoperm', 'x', 'WSO NoPerm')
    RETURNING id INTO v_noperm_user_id;

    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_adm_user_id, r.id FROM iam.roles r WHERE r.code = 'ADMIN';

    INSERT INTO iam.application_sessions (token_hash, user_id, workstation_id, expires_at)
    VALUES (sha256(v_adm::bytea), v_adm_user_id, 'WS1', now() + interval '1 day'),
           (sha256(v_noperm::bytea), v_noperm_user_id, 'WS1', now() + interval '1 day');

    -- Seeded base unit UNIT (whole per 7.11)
    SELECT id INTO v_unit FROM catalog.units WHERE normalized_code = 'UNIT' OR code = 'UNIT' LIMIT 1;
    IF v_unit IS NULL THEN
        v_unit := catalog.create_unit(v_adm, 'Unit', false);
    ELSE
        UPDATE catalog.units SET allows_fractions = false WHERE id = v_unit;
    END IF;

    -- Create units CTN, BAL, KG, SAC, DZN
    v_ctn := catalog.create_unit(v_adm, 'Carton', false);
    v_bal := catalog.create_unit(v_adm, 'Bale', false);
    v_kg  := catalog.create_unit(v_adm, 'Kilogram', true);
    v_sac := catalog.create_unit(v_adm, 'Sac', false);
    v_dzn := catalog.create_unit(v_adm, 'Douzaine', false);

    -- Products & Variants:
    -- V1 "Oreiller blanc": base UNIT, piece price 1400.00, barcode 6131000000014
    v_res := catalog.create_product_with_variants(v_adm, 'Oreiller blanc', v_unit, true, jsonb_build_array(
        jsonb_build_object('sale_price', '1400.00', 'is_active', true,
            'attribute_value_ids', '[]'::jsonb,
            'barcodes', jsonb_build_array('6131000000014'))
    ));
    v_p1 := (v_res->>'product_id')::bigint;
    v_v1 := ((v_res->'variant_ids')->>0)::bigint;
    SELECT sku INTO v_v1_sku FROM catalog.product_variants WHERE id = v_v1;

    -- V2 "Plaid 1p": base UNIT, piece price 1500.00
    v_res := catalog.create_product_with_variants(v_adm, 'Plaid 1p', v_unit, true, jsonb_build_array(
        jsonb_build_object('sale_price', '1500.00', 'is_active', true,
            'attribute_value_ids', '[]'::jsonb,
            'barcodes', '[]'::jsonb)
    ));
    v_p2 := (v_res->>'product_id')::bigint;
    v_v2 := ((v_res->'variant_ids')->>0)::bigint;

    -- V3 "Coton vrac": base KG (decimal), price 900.00
    v_res := catalog.create_product_with_variants(v_adm, 'Coton vrac', v_kg, true, jsonb_build_array(
        jsonb_build_object('sale_price', '900.00', 'is_active', true,
            'attribute_value_ids', '[]'::jsonb,
            'barcodes', '[]'::jsonb)
    ));
    v_p3 := (v_res->>'product_id')::bigint;
    v_v3 := ((v_res->'variant_ids')->>0)::bigint;

    -- V4 "Test legacy": base UNIT, price 100.00
    v_res := catalog.create_product_with_variants(v_adm, 'Test legacy', v_unit, true, jsonb_build_array(
        jsonb_build_object('sale_price', '100.00', 'is_active', true,
            'attribute_value_ids', '[]'::jsonb,
            'barcodes', '[]'::jsonb)
    ));
    v_p4 := (v_res->>'product_id')::bigint;
    v_v4 := ((v_res->'variant_ids')->>0)::bigint;

    -- =========================================================================
    -- T1: After migration, across whole DB, every variant with active packs has exactly 1 primary
    -- =========================================================================
    SELECT count(*) INTO v_cnt
    FROM (
        SELECT variant_id
        FROM catalog.variant_units
        WHERE is_active AND conversion_factor > 1
        GROUP BY variant_id
        HAVING count(*) FILTER (WHERE is_primary) <> 1
    ) sub;
    IF v_cnt <> 0 THEN
        RAISE EXCEPTION 'ASSERT FAIL T1: % variants have <> 1 primary pack', v_cnt;
    END IF;

    -- =========================================================================
    -- T2: Legacy add_variant_alt_unit(V4, KG, 0.001) on V4 (no other unit)
    -- =========================================================================
    v_v4_kg_alt := catalog.add_variant_alt_unit(v_adm, v_v4, v_kg, 'ALT_TO_BASE', 0.001);
    SELECT count(*) INTO v_cnt FROM catalog.variant_units WHERE id = v_v4_kg_alt AND is_primary = false;
    IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'ASSERT FAIL T2: legacy smaller alt unit must not be primary';
    END IF;
    SELECT count(*) INTO v_cnt FROM catalog.variant_units WHERE variant_id = v_v4 AND is_primary = true;
    IF v_cnt <> 0 THEN
        RAISE EXCEPTION 'ASSERT FAIL T2: V4 should have no primary pack';
    END IF;

    -- =========================================================================
    -- T3: Two primaries on one variant via direct UPDATE raises unique violation 23505
    -- =========================================================================
    INSERT INTO catalog.variant_units (variant_id, unit_id, conversion_factor, conversion_direction, conversion_quantity, is_primary, is_active)
    VALUES (v_v4, v_ctn, 12, 'ALT_TO_BASE', 12, false, true), (v_v4, v_bal, 50, 'ALT_TO_BASE', 50, false, true);

    PERFORM pg_temp.expect_error(
        format('UPDATE catalog.variant_units SET is_primary = true WHERE variant_id = %s AND unit_id IN (%s, %s)', v_v4, v_ctn, v_bal),
        '23505'
    );

    DELETE FROM catalog.variant_units WHERE variant_id = v_v4 AND unit_id IN (v_ctn, v_bal);

    -- =========================================================================
    -- T4: create_pack(V1, CTN, 12, 15000.00, true)
    -- =========================================================================
    v_v1_ctn_pack := catalog.create_pack(v_adm, v_v1, v_ctn, 12, 15000.00, true);
    SELECT is_primary, sale_price INTO v_rec FROM catalog.variant_units WHERE id = v_v1_ctn_pack;
    IF v_rec.is_primary <> true OR v_rec.sale_price <> 15000.00 THEN
        RAISE EXCEPTION 'ASSERT FAIL T4: create_pack did not set is_primary or sale_price correctly';
    END IF;

    -- =========================================================================
    -- T5: add_pack_barcode(CTN pack, '6131000000021')
    -- =========================================================================
    v_bc_id := catalog.add_pack_barcode(v_adm, v_v1_ctn_pack, '6131000000021');
    SELECT variant_unit_id, is_primary INTO v_rec FROM catalog.variant_barcodes WHERE id = v_bc_id;
    IF v_rec.variant_unit_id <> v_v1_ctn_pack OR v_rec.is_primary <> false THEN
        RAISE EXCEPTION 'ASSERT FAIL T5: pack barcode must have variant_unit_id set and is_primary = false';
    END IF;

    -- =========================================================================
    -- T6: add_pack_barcode(..., ' 6131000000014 ') (V1 piece barcode) -> 22023
    -- =========================================================================
    PERFORM pg_temp.expect_error(
        format('SELECT catalog.add_pack_barcode(%L, %s, %L)', v_adm, v_v1_ctn_pack, ' 6131000000014 '),
        '22023'
    );

    -- =========================================================================
    -- T7: change V1's product unit while it has packs -> 22023
    -- =========================================================================
    PERFORM pg_temp.expect_error(
        format('SELECT catalog.update_product(%L, %s, %L, %s, true)', v_adm, v_p1, 'Oreiller blanc', v_kg),
        '22023'
    );

    -- =========================================================================
    -- T8: change unit of a product with no packs -> succeeds
    -- =========================================================================
    PERFORM catalog.update_product(v_adm, v_p2, 'Plaid 1p', v_bal, true);
    SELECT unit_id INTO v_cnt FROM catalog.products WHERE id = v_p2;
    IF v_cnt <> v_bal THEN
        RAISE EXCEPTION 'ASSERT FAIL T8: update_product unit change failed';
    END IF;
    PERFORM catalog.update_product(v_adm, v_p2, 'Plaid 1p', v_unit, true);

    -- =========================================================================
    -- T9: _validate_pack_factor(1, true) / (0.5, true) / (100001, true) / (12.1234567, false) -> 22023
    -- =========================================================================
    PERFORM pg_temp.expect_error('SELECT catalog._validate_pack_factor(1, true)', '22023');
    PERFORM pg_temp.expect_error('SELECT catalog._validate_pack_factor(0.5, true)', '22023');
    PERFORM pg_temp.expect_error('SELECT catalog._validate_pack_factor(100001, true)', '22023');
    PERFORM pg_temp.expect_error('SELECT catalog._validate_pack_factor(12.1234567, false)', '22023');

    -- =========================================================================
    -- T10: _validate_pack_factor(12.5, true) -> 22023 (PACK_FACTOR_NOT_WHOLE)
    -- =========================================================================
    PERFORM pg_temp.expect_error('SELECT catalog._validate_pack_factor(12.5, true)', '22023');

    -- =========================================================================
    -- T11: _validate_pack_factor(12.5, false) -> passes
    -- =========================================================================
    PERFORM catalog._validate_pack_factor(12.5, false);

    -- =========================================================================
    -- T12: _pack_rate
    -- =========================================================================
    IF catalog._pack_rate(15000.00, 12, 0) <> 1250 THEN RAISE EXCEPTION 'ASSERT FAIL T12.1'; END IF;
    IF catalog._pack_rate(9000.00, 7, 0) <> 1286 THEN RAISE EXCEPTION 'ASSERT FAIL T12.2'; END IF;
    IF catalog._pack_rate(9006.00, 12, 0) <> 751 THEN RAISE EXCEPTION 'ASSERT FAIL T12.3'; END IF;
    IF catalog._pack_rate(7500.00, 7, 2) <> 1071.43 THEN RAISE EXCEPTION 'ASSERT FAIL T12.4'; END IF;
    IF catalog._pack_rate(12600.00, 12, 2) <> 1050.00 THEN RAISE EXCEPTION 'ASSERT FAIL T12.5'; END IF;

    -- =========================================================================
    -- T13: _pack_rate(x, y, 1) -> 22023
    -- =========================================================================
    PERFORM pg_temp.expect_error('SELECT catalog._pack_rate(15000.00, 12, 1)', '22023');

    -- =========================================================================
    -- T14: _validate_amount(-1, ...) / (10.123, ...) -> 22023
    -- =========================================================================
    PERFORM pg_temp.expect_error('SELECT catalog._validate_amount(-1, ''PACK_PRICE_INVALID'')', '22023');
    PERFORM pg_temp.expect_error('SELECT catalog._validate_amount(10.123, ''PACK_PRICE_INVALID'')', '22023');

    -- =========================================================================
    -- T15: create_pack(V1, BAL, 50, NULL, false) -> created; not primary
    -- =========================================================================
    v_v1_bal_pack := catalog.create_pack(v_adm, v_v1, v_bal, 50, NULL, false);
    SELECT is_primary INTO v_rec FROM catalog.variant_units WHERE id = v_v1_bal_pack;
    IF v_rec.is_primary <> false THEN RAISE EXCEPTION 'ASSERT FAIL T15: BAL pack should not be primary'; END IF;
    SELECT is_primary INTO v_rec FROM catalog.variant_units WHERE id = v_v1_ctn_pack;
    IF v_rec.is_primary <> true THEN RAISE EXCEPTION 'ASSERT FAIL T15: CTN pack must stay primary'; END IF;

    -- =========================================================================
    -- T16: create_pack(V1, CTN, 24, ...) again -> 22023 (PACK_DUPLICATE_UNIT)
    -- =========================================================================
    PERFORM pg_temp.expect_error(
        format('SELECT catalog.create_pack(%L, %s, %s, 24, NULL, false)', v_adm, v_v1, v_ctn),
        '22023'
    );

    -- =========================================================================
    -- T17: create_pack(V1, UNIT, 12, ...) -> 22023 (PACK_UNIT_IS_BASE)
    -- =========================================================================
    PERFORM pg_temp.expect_error(
        format('SELECT catalog.create_pack(%L, %s, %s, 12, NULL, false)', v_adm, v_v1, v_unit),
        '22023'
    );

    -- =========================================================================
    -- T18: create_pack(V2, CTN, 7, 9000.00, false) on V2 with no pack -> created and primary
    -- =========================================================================
    v_v2_ctn_pack := catalog.create_pack(v_adm, v_v2, v_ctn, 7, 9000.00, false);
    SELECT is_primary, sale_price INTO v_rec FROM catalog.variant_units WHERE id = v_v2_ctn_pack;
    IF v_rec.is_primary <> true OR v_rec.sale_price <> 9000.00 THEN
        RAISE EXCEPTION 'ASSERT FAIL T18: first pack on V2 must become primary automatically';
    END IF;

    -- =========================================================================
    -- T19: create_pack(V3, SAC, 25, 20000.00, true) (decimal base KG) -> created
    -- =========================================================================
    v_v3_sac_pack := catalog.create_pack(v_adm, v_v3, v_sac, 25, 20000.00, true);
    SELECT is_primary INTO v_rec FROM catalog.variant_units WHERE id = v_v3_sac_pack;
    IF v_rec.is_primary <> true THEN RAISE EXCEPTION 'ASSERT FAIL T19: V3 SAC pack should be primary'; END IF;

    -- =========================================================================
    -- T20: create_pack(V3, DZN, 2.5, NULL, false) -> created (decimal base allows 2.5)
    -- =========================================================================
    v_v3_dzn_pack := catalog.create_pack(v_adm, v_v3, v_dzn, 2.5, NULL, false);
    IF v_v3_dzn_pack IS NULL THEN RAISE EXCEPTION 'ASSERT FAIL T20'; END IF;

    -- =========================================================================
    -- T21: create_pack(V1, DZN, 2.5, ...) -> 22023 (whole base does not allow 2.5)
    -- =========================================================================
    PERFORM pg_temp.expect_error(
        format('SELECT catalog.create_pack(%L, %s, %s, 2.5, NULL, false)', v_adm, v_v1, v_dzn),
        '22023'
    );

    -- =========================================================================
    -- T22: create_pack with session 'wsonoperm' -> 42501 (Permission Denied)
    -- =========================================================================
    PERFORM pg_temp.expect_error(
        format('SELECT catalog.create_pack(%L, %s, %s, 12, NULL, false)', v_noperm, v_v1, v_dzn),
        '42501'
    );

    -- =========================================================================
    -- T23: update_pack(V1 CTN, 12, 14800.00) -> price 14800.00
    -- =========================================================================
    PERFORM catalog.update_pack(v_adm, v_v1_ctn_pack, 12, 14800.00);
    SELECT sale_price INTO v_rec FROM catalog.variant_units WHERE id = v_v1_ctn_pack;
    IF v_rec.sale_price <> 14800.00 THEN RAISE EXCEPTION 'ASSERT FAIL T23'; END IF;

    -- =========================================================================
    -- T24: update_pack(V1 BAL, 40, NULL) (BAL not used) -> BAL factor 40.000000
    -- =========================================================================
    PERFORM catalog.update_pack(v_adm, v_v1_bal_pack, 40, NULL);
    SELECT conversion_factor INTO v_rec FROM catalog.variant_units WHERE id = v_v1_bal_pack;
    IF v_rec.conversion_factor <> 40.000000 THEN RAISE EXCEPTION 'ASSERT FAIL T24'; END IF;

    -- =========================================================================
    -- T25: post a direct purchase of 1 CTN of V1, then update_pack(V1 CTN, 10, ...) -> 22023 (PACK_IN_USE)
    -- =========================================================================
    INSERT INTO procurement.suppliers (code, name, is_active)
    VALUES ('SUP-WSO1', 'WSO1 Supplier', true)
    RETURNING id INTO v_supplier_id;

    INSERT INTO inventory.warehouses (code, name, is_active)
    VALUES ('WH-WSO1', 'WSO1 Warehouse', true)
    RETURNING id INTO v_warehouse_id;

    SELECT id, starts_on + 1 INTO v_period_id, v_document_date
    FROM finance.fiscal_periods WHERE status = 'OPEN' ORDER BY starts_on DESC LIMIT 1;
    IF v_period_id IS NULL THEN
        RAISE EXCEPTION 'ASSERT FAIL T25: no open fiscal period';
    END IF;

    v_direct_purchase_res := inventory.confirm_direct_purchase(
        v_adm,
        'd1000000-0000-4000-8000-000000000099'::uuid,
        '\x02'::bytea,
        v_supplier_id, v_warehouse_id, v_period_id, v_document_date,
        'Direct Purchase of 1 CTN',
        jsonb_build_array(jsonb_build_object(
            'variant_id', v_v1, 'unit_id', v_ctn,
            'quantity_received', 1.000, 'unit_cost', 10000.00
        ))
    );

    PERFORM pg_temp.expect_error(
        format('SELECT catalog.update_pack(%L, %s, 10, 14800.00)', v_adm, v_v1_ctn_pack),
        '22023'
    );

    -- =========================================================================
    -- T26: remove_pack(V1 CTN) after T25 -> 22023 (PACK_IN_USE)
    -- =========================================================================
    PERFORM pg_temp.expect_error(
        format('SELECT catalog.remove_pack(%L, %s)', v_adm, v_v1_ctn_pack),
        '22023'
    );

    -- =========================================================================
    -- T27: set_pack_active(V1 CTN, false) -> inactive, not primary; BAL becomes primary
    -- =========================================================================
    PERFORM catalog.set_pack_active(v_adm, v_v1_ctn_pack, false);
    SELECT is_active, is_primary INTO v_rec FROM catalog.variant_units WHERE id = v_v1_ctn_pack;
    IF v_rec.is_active <> false OR v_rec.is_primary <> false THEN
        RAISE EXCEPTION 'ASSERT FAIL T27: CTN pack must be inactive and not primary';
    END IF;
    SELECT is_primary INTO v_rec FROM catalog.variant_units WHERE id = v_v1_bal_pack;
    IF v_rec.is_primary <> true THEN
        RAISE EXCEPTION 'ASSERT FAIL T27: BAL pack should become primary';
    END IF;

    -- =========================================================================
    -- T28: set_pack_primary(V1 CTN) while inactive -> 22023 (PACK_NOT_ACTIVE)
    -- =========================================================================
    PERFORM pg_temp.expect_error(
        format('SELECT catalog.set_pack_primary(%L, %s)', v_adm, v_v1_ctn_pack),
        '22023'
    );

    -- =========================================================================
    -- T29: set_pack_active(V1 CTN, true) then set_pack_primary(V1 CTN) -> CTN primary, BAL not
    -- =========================================================================
    PERFORM catalog.set_pack_active(v_adm, v_v1_ctn_pack, true);
    PERFORM catalog.set_pack_primary(v_adm, v_v1_ctn_pack);
    SELECT is_primary INTO v_rec FROM catalog.variant_units WHERE id = v_v1_ctn_pack;
    IF v_rec.is_primary <> true THEN RAISE EXCEPTION 'ASSERT FAIL T29: CTN must be primary'; END IF;
    SELECT is_primary INTO v_rec FROM catalog.variant_units WHERE id = v_v1_bal_pack;
    IF v_rec.is_primary <> false THEN RAISE EXCEPTION 'ASSERT FAIL T29: BAL must not be primary'; END IF;

    -- =========================================================================
    -- T30: remove_pack(V1 BAL) (unused) -> deleted
    -- =========================================================================
    PERFORM catalog.remove_pack(v_adm, v_v1_bal_pack);
    SELECT count(*) INTO v_cnt FROM catalog.variant_units WHERE id = v_v1_bal_pack;
    IF v_cnt <> 0 THEN RAISE EXCEPTION 'ASSERT FAIL T30: BAL pack must be deleted'; END IF;

    -- =========================================================================
    -- T31: list_variant_packs(V1) -> 1 row CTN: factor 12.000000, is_pack true, is_primary true, is_used true, barcodes {6131000000021}
    -- =========================================================================
    SELECT count(*) INTO v_cnt FROM catalog.list_variant_packs(v_adm, v_v1);
    IF v_cnt <> 1 THEN RAISE EXCEPTION 'ASSERT FAIL T31: expected 1 pack row for V1, got %', v_cnt; END IF;
    SELECT * INTO v_rec FROM catalog.list_variant_packs(v_adm, v_v1) LIMIT 1;
    IF v_rec.conversion_factor <> 12.000000 OR v_rec.is_pack <> true OR v_rec.is_primary <> true
       OR v_rec.is_used <> true OR v_rec.barcodes <> ARRAY['6131000000021'] THEN
        RAISE EXCEPTION 'ASSERT FAIL T31 fields mismatch: %', row_to_json(v_rec);
    END IF;

    -- =========================================================================
    -- T32: list_variant_packs(V3) -> 2 rows, SAC first (primary)
    -- =========================================================================
    SELECT count(*) INTO v_cnt FROM catalog.list_variant_packs(v_adm, v_v3);
    IF v_cnt <> 2 THEN RAISE EXCEPTION 'ASSERT FAIL T32: expected 2 rows for V3, got %', v_cnt; END IF;
    SELECT * INTO v_rec FROM catalog.list_variant_packs(v_adm, v_v3) LIMIT 1;
    IF v_rec.unit_id <> v_sac OR v_rec.is_primary <> true THEN
        RAISE EXCEPTION 'ASSERT FAIL T32: primary pack SAC must be first';
    END IF;

    -- =========================================================================
    -- T33: get_primary_packs(ARRAY[V1,V2,V3,V1]) -> 3 rows (V1 CTN, V2 CTN, V3 SAC), base unit names filled
    -- =========================================================================
    SELECT count(*) INTO v_cnt FROM catalog.get_primary_packs(v_adm, ARRAY[v_v1, v_v2, v_v3, v_v1]);
    IF v_cnt <> 3 THEN RAISE EXCEPTION 'ASSERT FAIL T33: expected 3 distinct primary pack rows, got %', v_cnt; END IF;
    SELECT count(*) INTO v_cnt FROM catalog.get_primary_packs(v_adm, ARRAY[v_v1, v_v2, v_v3, v_v1]) WHERE base_unit_name IS NULL OR base_unit_code IS NULL;
    IF v_cnt <> 0 THEN RAISE EXCEPTION 'ASSERT FAIL T33: base unit code and name must be filled'; END IF;

    -- =========================================================================
    -- T34: get_primary_packs with 501 ids -> 22023
    -- =========================================================================
    PERFORM pg_temp.expect_error(
        format('SELECT * FROM catalog.get_primary_packs(%L, (SELECT array_agg(i::bigint) FROM generate_series(1, 501) i))', v_adm),
        '22023'
    );

    -- =========================================================================
    -- T35: remove V1's piece barcode (primary) with remove_variant_barcode while pack barcode exists
    -- =========================================================================
    SELECT id INTO v_piece_bc_id FROM catalog.variant_barcodes WHERE variant_id = v_v1 AND variant_unit_id IS NULL;
    PERFORM catalog.remove_variant_barcode(v_adm, v_piece_bc_id);
    SELECT count(*) INTO v_cnt FROM catalog.variant_barcodes WHERE variant_id = v_v1 AND is_primary = true;
    IF v_cnt <> 0 THEN RAISE EXCEPTION 'ASSERT FAIL T35: no barcode should be primary'; END IF;
    SELECT count(*) INTO v_cnt FROM catalog.variant_barcodes WHERE id = v_bc_id AND variant_unit_id = v_v1_ctn_pack;
    IF v_cnt <> 1 THEN RAISE EXCEPTION 'ASSERT FAIL T35: pack barcode must be untouched'; END IF;

    -- =========================================================================
    -- T36: legacy add_variant_alt_unit(V4, CTN, 12) (V4 has no pack yet) then add_pack_barcode(<that pack>, '6131000000038')
    -- =========================================================================
    v_v4_ctn_pack := catalog.add_variant_alt_unit(v_adm, v_v4, v_ctn, 'ALT_TO_BASE', 12);
    SELECT is_primary INTO v_rec FROM catalog.variant_units WHERE id = v_v4_ctn_pack;
    IF v_rec.is_primary <> true THEN RAISE EXCEPTION 'ASSERT FAIL T36: first pack on V4 must become primary'; END IF;
    PERFORM catalog.add_pack_barcode(v_adm, v_v4_ctn_pack, '6131000000038');
    SELECT count(*) INTO v_cnt FROM catalog.variant_barcodes WHERE barcode = '6131000000038' AND variant_unit_id = v_v4_ctn_pack;
    IF v_cnt <> 1 THEN RAISE EXCEPTION 'ASSERT FAIL T36: barcode linked to pack'; END IF;

    -- =========================================================================
    -- T37: legacy remove_variant_alt_unit(<V4 CTN pack>)
    -- =========================================================================
    PERFORM catalog.remove_variant_alt_unit(v_adm, v_v4_ctn_pack);
    SELECT count(*) INTO v_cnt FROM catalog.variant_units WHERE id = v_v4_ctn_pack;
    IF v_cnt <> 0 THEN RAISE EXCEPTION 'ASSERT FAIL T37: pack must be deleted'; END IF;
    SELECT count(*) INTO v_cnt FROM catalog.variant_barcodes WHERE barcode = '6131000000038';
    IF v_cnt <> 0 THEN RAISE EXCEPTION 'ASSERT FAIL T37: pack barcode must be deleted'; END IF;
    SELECT count(*) INTO v_cnt FROM catalog.variant_units WHERE variant_id = v_v4 AND is_primary = true;
    IF v_cnt <> 0 THEN RAISE EXCEPTION 'ASSERT FAIL T37: V4 should have no primary pack'; END IF;

    -- =========================================================================
    -- T38: resolve_barcode('6131000000021') -> V1 + pack_unit_code 'CTN', pack_factor 12.000000, pack_sale_price 14800.00, pack_is_active true
    -- =========================================================================
    SELECT * INTO v_rec FROM catalog.resolve_barcode(v_adm, '6131000000021');
    IF v_rec.variant_id <> v_v1 OR v_rec.pack_factor <> 12.000000 OR v_rec.pack_sale_price <> 14800.00 OR v_rec.pack_is_active <> true THEN
        RAISE EXCEPTION 'ASSERT FAIL T38: resolve_barcode pack info mismatch: %', row_to_json(v_rec);
    END IF;

    -- =========================================================================
    -- T39: resolve_barcode('6131000000014') (re-add piece barcode first) -> V1, seven pack columns NULL
    -- =========================================================================
    PERFORM catalog.add_variant_barcode(v_adm, v_v1, '6131000000014');
    SELECT * INTO v_rec FROM catalog.resolve_barcode(v_adm, '6131000000014');
    IF v_rec.variant_id <> v_v1 OR v_rec.pack_variant_unit_id IS NOT NULL OR v_rec.pack_factor IS NOT NULL THEN
        RAISE EXCEPTION 'ASSERT FAIL T39: piece barcode must return NULL pack fields';
    END IF;

    -- =========================================================================
    -- T40: resolve_barcode(<V1 SKU>) -> V1 by SKU, pack columns NULL
    -- =========================================================================
    SELECT * INTO v_rec FROM catalog.resolve_barcode(v_adm, v_v1_sku);
    IF v_rec.variant_id <> v_v1 OR v_rec.identifier_type <> 'SKU' OR v_rec.pack_variant_unit_id IS NOT NULL THEN
        RAISE EXCEPTION 'ASSERT FAIL T40: resolve by SKU must return NULL pack fields';
    END IF;

    -- =========================================================================
    -- T41: delete unit CTN through live unit delete function -> refused (in use)
    -- =========================================================================
    PERFORM pg_temp.expect_error(
        format('SELECT catalog.delete_unit(%L, %s)', v_adm, v_ctn),
        '55000'
    );

    RAISE NOTICE 'ALL WS-O-1 TESTS T1-T41 PASSED SUCCESSFULLY';
END $$;
