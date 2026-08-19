-- S2-001 catalog integration assertions. Run against a DB with all migrations
-- applied. Any failed assertion RAISEs, and psql -v ON_ERROR_STOP=1 aborts.
\set ON_ERROR_STOP on
SET client_min_messages = warning;

-- ---- Test fixtures: users, roles, sessions ---------------------------------
INSERT INTO iam.users (username, password_hash, display_name) VALUES ('s2admin', 'x', 'S2 Admin');
INSERT INTO iam.users (username, password_hash, display_name) VALUES ('s2cash', 'x', 'S2 Cashier');
INSERT INTO iam.user_roles (user_id, role_id)
    SELECT u.id, r.id FROM iam.users u, iam.roles r WHERE u.username='s2admin' AND r.code='ADMIN';
INSERT INTO iam.user_roles (user_id, role_id)
    SELECT u.id, r.id FROM iam.users u, iam.roles r WHERE u.username='s2cash' AND r.code='CASHIER';
INSERT INTO iam.application_sessions (token_hash, user_id, workstation_id, expires_at)
    SELECT sha256('admintok'::bytea), id, 'WS1', now()+interval '1 day' FROM iam.users WHERE username='s2admin';
INSERT INTO iam.application_sessions (token_hash, user_id, workstation_id, expires_at)
    SELECT sha256('cashtok'::bytea), id, 'WS1', now()+interval '1 day' FROM iam.users WHERE username='s2cash';

-- assertion helper: expect a given SQLSTATE
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
END; $$;

CREATE TEMP TABLE t (k text PRIMARY KEY, v bigint);

DO $$
DECLARE
    v_size bigint; v_color bigint; v_s bigint; v_m bigint; v_w bigint; v_b bigint;
    v_carton bigint; v_kg bigint; v_gram bigint;
    v_res jsonb; v_pid bigint; v_v1 bigint; v_v2 bigint; v_cnt bigint; v_txt text;
BEGIN
    -- Attributes + values (reusable, not hard-coded)
    v_size := catalog.create_attribute('admintok', 'Size');
    v_color := catalog.create_attribute('admintok', 'Color');
    -- idempotent create returns same id
    IF catalog.create_attribute('admintok', '  size ') <> v_size THEN
        RAISE EXCEPTION 'ASSERT FAIL: attribute create not normalized/idempotent';
    END IF;
    v_s := catalog.add_attribute_value('admintok', v_size, 'Small');
    v_m := catalog.add_attribute_value('admintok', v_size, 'Medium');
    v_w := catalog.add_attribute_value('admintok', v_color, 'White');
    v_b := catalog.add_attribute_value('admintok', v_color, 'Black');

    -- Units
    v_carton := catalog.create_unit('admintok', 'CARTON', 'Carton');
    v_kg := catalog.create_unit('admintok', 'KG', 'Kilogram');
    v_gram := catalog.create_unit('admintok', 'G', 'Gram');

    -- Create a product with TWO variants, attributes and barcodes.
    v_res := catalog.create_product_with_variants('admintok', 'T-Shirt', v_kg, true, jsonb_build_array(
        jsonb_build_object('sale_price','10.00','is_active',true,
            'attribute_value_ids', jsonb_build_array(v_s, v_w),
            'barcodes', jsonb_build_array('6001')),
        jsonb_build_object('sale_price','12.00','is_active',true,
            'attribute_value_ids', jsonb_build_array(v_m, v_b),
            'barcodes', jsonb_build_array('6002','6003'))
    ));
    v_pid := (v_res->>'product_id')::bigint;
    v_v1 := ((v_res->'variant_ids')->>0)::bigint;
    v_v2 := ((v_res->'variant_ids')->>1)::bigint;
    INSERT INTO t VALUES ('pid', v_pid), ('v1', v_v1), ('v2', v_v2),
        ('size', v_size), ('color', v_color), ('s', v_s), ('m', v_m), ('w', v_w), ('b', v_b),
        ('carton', v_carton), ('kg', v_kg), ('gram', v_gram);

    -- multiple variants per product
    SELECT count(*) INTO v_cnt FROM catalog.product_variants WHERE product_id = v_pid;
    IF v_cnt <> 2 THEN RAISE EXCEPTION 'ASSERT FAIL: expected 2 variants, got %', v_cnt; END IF;

    -- product-owned unit is copied to each variant
    SELECT u.normalized_code INTO v_txt FROM catalog.product_variants pv
        JOIN catalog.units u ON u.id = pv.base_unit_id WHERE pv.id = v_v1;
    IF v_txt <> 'KG' THEN RAISE EXCEPTION 'ASSERT FAIL: base unit not KG (%)', v_txt; END IF;

    -- attribute ownership is persisted, not merely the selected value id
    SELECT count(*) INTO v_cnt
        FROM catalog.variant_attribute_values vav
        JOIN catalog.attribute_values av
          ON av.id = vav.attribute_value_id
         AND av.attribute_id = vav.attribute_id
        WHERE vav.variant_id = v_v1;
    IF v_cnt <> 2 THEN
        RAISE EXCEPTION 'ASSERT FAIL: expected 2 valid variant-attribute mappings, got %', v_cnt;
    END IF;

    -- attribute signature non-empty and deterministic (sorted attribute_id:value_id)
    SELECT attribute_signature INTO v_txt FROM catalog.product_variants WHERE id = v_v1;
    IF v_txt <> (least(v_size,v_color)||':'|| CASE WHEN v_size<v_color THEN v_s ELSE v_w END)
                ||'|'||(greatest(v_size,v_color)||':'|| CASE WHEN v_size<v_color THEN v_w ELSE v_s END) THEN
        RAISE EXCEPTION 'ASSERT FAIL: unexpected signature %', v_txt;
    END IF;

    -- exact conversion factor stored exactly
    PERFORM catalog.add_variant_alt_unit('admintok', v_v1, v_carton, 12);
    SELECT conversion_factor::text INTO v_txt FROM catalog.variant_units WHERE variant_id=v_v1 AND unit_id=v_carton;
    IF v_txt <> '12.000000' THEN RAISE EXCEPTION 'ASSERT FAIL: carton factor %', v_txt; END IF;

    -- barcode normalized
    SELECT normalized_barcode INTO v_txt FROM catalog.variant_barcodes WHERE variant_id=v_v1;
    IF v_txt <> '6001' THEN RAISE EXCEPTION 'ASSERT FAIL: barcode norm %', v_txt; END IF;

    RAISE NOTICE 'positive create path OK (product %, variants %, %)', v_pid, v_v1, v_v2;
END $$;

-- ---- Negative / constraint assertions --------------------------------------
DO $$
DECLARE v_pid bigint; v_v1 bigint; v_s bigint; v_w bigint; v_m bigint; v_b bigint; v_carton bigint; v_kg bigint; v_gram bigint;
BEGIN
    SELECT v INTO v_pid FROM t WHERE k='pid'; SELECT v INTO v_v1 FROM t WHERE k='v1';
    SELECT v INTO v_s FROM t WHERE k='s'; SELECT v INTO v_w FROM t WHERE k='w';
    SELECT v INTO v_m FROM t WHERE k='m'; SELECT v INTO v_b FROM t WHERE k='b';
    SELECT v INTO v_carton FROM t WHERE k='carton'; SELECT v INTO v_kg FROM t WHERE k='kg'; SELECT v INTO v_gram FROM t WHERE k='gram';

    -- negative sale price rejected
    PERFORM pg_temp.expect_error(
        format('SELECT catalog.add_variant(%L,%s,%L::jsonb)','admintok',v_pid,'{"sale_price":"-1.00"}'), '22023');

    -- duplicate attribute-value combination under same product rejected
    PERFORM pg_temp.expect_error(
        format('SELECT catalog.add_variant(%L,%s,%L::jsonb)','admintok',v_pid,
            format('{"sale_price":"9.00","attribute_value_ids":[%s,%s]}', v_s, v_w)), '22023');

    -- two values of the same attribute rejected
    PERFORM pg_temp.expect_error(
        format('SELECT catalog.add_variant(%L,%s,%L::jsonb)','admintok',v_pid,
            format('{"sale_price":"9.00","attribute_value_ids":[%s,%s]}', v_s, v_m)), '22023');

    -- duplicate barcode (global) rejected
    PERFORM pg_temp.expect_error(
        format('SELECT catalog.add_variant_barcode(%L,%s,%L)','admintok',v_v1,'6002'), '22023');

    -- zero / negative conversion factor rejected (DB CHECK + function guard)
    PERFORM pg_temp.expect_error(
        format('SELECT catalog.add_variant_alt_unit(%L,%s,%s,0)','admintok',v_v1,v_carton), '22023');
    PERFORM pg_temp.expect_error(
        format('SELECT catalog.add_variant_alt_unit(%L,%s,%s,-1)','admintok',v_v1,v_carton), '22023');
    -- direct table insert of non-positive factor blocked by CHECK constraint
    PERFORM pg_temp.expect_error(
        format('INSERT INTO catalog.variant_units(variant_id,unit_id,conversion_factor) VALUES (%s,%s,0)', v_v1, v_gram), '23514');

    -- blank barcode rejected
    PERFORM pg_temp.expect_error(format('SELECT catalog.add_variant_barcode(%L,%s,%L)','admintok',v_v1,'   '), '22023');

    -- exact fractional factor (gram per kg = 0.001) preserved
    PERFORM catalog.set_variant_base_unit('admintok', v_v1, v_kg);
    PERFORM catalog.add_variant_alt_unit('admintok', v_v1, v_gram, 0.001);
    IF (SELECT conversion_factor::text FROM catalog.variant_units WHERE variant_id=v_v1 AND unit_id=v_gram) <> '0.001000' THEN
        RAISE EXCEPTION 'ASSERT FAIL: gram factor not exact';
    END IF;
    -- base unit cannot equal an alternate unit and vice versa
    PERFORM pg_temp.expect_error(format('SELECT catalog.add_variant_alt_unit(%L,%s,%s,2)','admintok',v_v1,v_kg), '22023');

    RAISE NOTICE 'negative/constraint assertions OK';
END $$;

-- ---- Barcode resolution + active/inactive rules ----------------------------
DO $$
DECLARE v_pid bigint; v_v1 bigint; v_kg bigint; v_cnt bigint;
BEGIN
    SELECT v INTO v_pid FROM t WHERE k='pid'; SELECT v INTO v_v1 FROM t WHERE k='v1';
    SELECT v INTO v_kg FROM t WHERE k='kg';

    -- resolve returns exactly one active variant
    SELECT count(*) INTO v_cnt FROM catalog.resolve_barcode('admintok','6001');
    IF v_cnt <> 1 THEN RAISE EXCEPTION 'ASSERT FAIL: resolve_barcode active count %', v_cnt; END IF;

    -- deactivate variant -> its barcode no longer resolves operationally
    PERFORM catalog.set_variant_active('admintok', v_v1, false);
    IF (SELECT count(*) FROM catalog.resolve_barcode('admintok','6001')) <> 0 THEN
        RAISE EXCEPTION 'ASSERT FAIL: inactive variant barcode still resolves';
    END IF;
    -- inactive variant keeps its historical barcode row
    IF (SELECT count(*) FROM catalog.variant_barcodes WHERE variant_id=v_v1) <> 1 THEN
        RAISE EXCEPTION 'ASSERT FAIL: barcode row lost on deactivate';
    END IF;
    PERFORM catalog.set_variant_active('admintok', v_v1, true);

    -- deactivate product cascades to all variants
    PERFORM catalog.update_product('admintok', v_pid, 'T-Shirt', v_kg, false);
    IF (SELECT count(*) FROM catalog.product_variants WHERE product_id=v_pid AND is_active) <> 0 THEN
        RAISE EXCEPTION 'ASSERT FAIL: product deactivate did not cascade';
    END IF;
    -- cannot activate a variant while product inactive
    PERFORM pg_temp.expect_error(format('SELECT catalog.set_variant_active(%L,%s,true)','admintok',v_v1), '55000');
    -- reactivate product, then variant
    PERFORM catalog.update_product('admintok', v_pid, 'T-Shirt', v_kg, true);
    PERFORM catalog.set_variant_active('admintok', v_v1, true);
    IF (SELECT count(*) FROM catalog.resolve_barcode('admintok','6001')) <> 1 THEN
        RAISE EXCEPTION 'ASSERT FAIL: barcode not resolvable after reactivation';
    END IF;
    RAISE NOTICE 'barcode resolution + active-state rules OK';
END $$;

-- ---- Authorization + rollback + Slice 1 preservation -----------------------
DO $$
DECLARE v_before bigint; v_after bigint; v_kg bigint;
BEGIN
    SELECT v INTO v_kg FROM t WHERE k='kg';
    -- authorization: cashier lacks MANAGE_CATALOG -> 42501; invalid token -> 28000
    PERFORM pg_temp.expect_error('SELECT catalog.create_attribute(''cashtok'',''Material'')', '42501');
    PERFORM pg_temp.expect_error('SELECT catalog.create_attribute(''bogustoken'',''Material'')', '28000');

    -- rollback: a multi-variant create that fails on the 2nd variant leaves NO product
    SELECT count(*) INTO v_before FROM catalog.products;
    PERFORM pg_temp.expect_error(
        format(
            'SELECT catalog.create_product_with_variants(%L,%L,%s,true,%L::jsonb)',
            'admintok', 'RollbackTest', v_kg,
            '[{"sale_price":"1.00"},{"sale_price":"-1.00"}]'
        ), '22023');
    SELECT count(*) INTO v_after FROM catalog.products;
    IF v_after <> v_before THEN RAISE EXCEPTION 'ASSERT FAIL: rollback left partial product (% -> %)', v_before, v_after; END IF;
    IF EXISTS (SELECT 1 FROM catalog.products WHERE name='RollbackTest') THEN
        RAISE EXCEPTION 'ASSERT FAIL: RollbackTest product persisted';
    END IF;

    -- Slice 1 preservation: singular create still works and sets base unit + empty signature
    PERFORM catalog.create_product_with_variant('admintok','Legacy Product','LEG-1',5.00,true);
    IF (SELECT attribute_signature FROM catalog.product_variants WHERE sku='LEG-1') <> '' THEN
        RAISE EXCEPTION 'ASSERT FAIL: legacy variant signature not empty';
    END IF;
    IF (SELECT u.normalized_code FROM catalog.product_variants pv JOIN catalog.units u ON u.id=pv.base_unit_id WHERE pv.sku='LEG-1') <> 'UNIT' THEN
        RAISE EXCEPTION 'ASSERT FAIL: legacy variant base unit not UNIT';
    END IF;
    -- existing list_products still returns rows (active variants)
    IF (SELECT count(*) FROM catalog.list_products('admintok', 1, NULL)) < 1 THEN
        RAISE EXCEPTION 'ASSERT FAIL: list_products returned nothing';
    END IF;

    -- get_product_detail cohesive payload sanity
    IF (SELECT jsonb_array_length((catalog.get_product_detail('admintok',(SELECT v FROM t WHERE k='pid')))->'variants')) <> 2 THEN
        RAISE EXCEPTION 'ASSERT FAIL: detail variant count';
    END IF;
    RAISE NOTICE 'authorization + rollback + Slice1 preservation OK';
END $$;

SELECT 'ALL S2-001 DB ASSERTIONS PASSED' AS result;
