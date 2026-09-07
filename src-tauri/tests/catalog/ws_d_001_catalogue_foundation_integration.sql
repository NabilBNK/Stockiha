-- WS-D-001 catalogue-foundation regression assertions. Run against a DB
-- with all migrations applied. Any failed assertion RAISEs, and
-- psql -v ON_ERROR_STOP=1 aborts.
\set ON_ERROR_STOP on
SET client_min_messages = warning;

-- ---- Test fixtures: users, roles, sessions ---------------------------------
INSERT INTO iam.users (username, password_hash, display_name) VALUES ('wsdadmin', 'x', 'WS-D Admin');
INSERT INTO iam.users (username, password_hash, display_name) VALUES ('wsdcash', 'x', 'WS-D Cashier');
INSERT INTO iam.user_roles (user_id, role_id)
    SELECT u.id, r.id FROM iam.users u, iam.roles r WHERE u.username='wsdadmin' AND r.code='ADMIN';
INSERT INTO iam.user_roles (user_id, role_id)
    SELECT u.id, r.id FROM iam.users u, iam.roles r WHERE u.username='wsdcash' AND r.code='CASHIER';
INSERT INTO iam.application_sessions (token_hash, user_id, workstation_id, expires_at)
    SELECT sha256('wsdadmintok'::bytea), id, 'WS1', now()+interval '1 day' FROM iam.users WHERE username='wsdadmin';
INSERT INTO iam.application_sessions (token_hash, user_id, workstation_id, expires_at)
    SELECT sha256('wsdcashtok'::bytea), id, 'WS1', now()+interval '1 day' FROM iam.users WHERE username='wsdcash';

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
CREATE TEMP TABLE t_txt (k text PRIMARY KEY, v text);

-- ---- 1. Category CRUD -------------------------------------------------------
DO $$
DECLARE
    v_cat_a bigint; v_cat_b bigint; v_pid bigint; v_vid bigint; v_unit bigint;
BEGIN
    SELECT id INTO v_unit FROM catalog.units WHERE normalized_code = 'UNIT';

    v_cat_a := catalog.create_category('wsdadmintok', 'Beverages');
    IF catalog.create_category('wsdadmintok', '  beverages ') <> v_cat_a THEN
        RAISE EXCEPTION 'ASSERT FAIL: category create not normalized/idempotent';
    END IF;
    v_cat_b := catalog.create_category('wsdadmintok', 'Snacks');

    -- rename
    PERFORM catalog.rename_category('wsdadmintok', v_cat_b, 'Snacks & Confectionery');
    IF (SELECT name FROM catalog.categories WHERE id = v_cat_b) <> 'Snacks & Confectionery' THEN
        RAISE EXCEPTION 'ASSERT FAIL: category rename did not persist';
    END IF;

    -- rename collision
    PERFORM pg_temp.expect_error(
        format('SELECT catalog.rename_category(%L,%s,%L)', 'wsdadmintok', v_cat_b, 'Beverages'), '22023');

    -- delete-when-unused succeeds
    DECLARE v_disposable bigint;
    BEGIN
        v_disposable := catalog.create_category('wsdadmintok', 'Disposable Category');
        PERFORM catalog.delete_category('wsdadmintok', v_disposable);
        IF EXISTS (SELECT 1 FROM catalog.categories WHERE id = v_disposable) THEN
            RAISE EXCEPTION 'ASSERT FAIL: unused category not deleted';
        END IF;
    END;

    -- usage_count reflects real usage, then delete-blocked-when-used
    SELECT product_id, variant_id INTO v_pid, v_vid
        FROM catalog.quick_create_product('wsdadmintok', 'Cola 1.5L', v_unit, 3.50, p_category_id => v_cat_a);
    IF (SELECT usage_count FROM catalog.list_categories('wsdadmintok') WHERE id = v_cat_a) <> 1 THEN
        RAISE EXCEPTION 'ASSERT FAIL: category usage_count not 1 after one product assigned';
    END IF;
    PERFORM pg_temp.expect_error(format('SELECT catalog.delete_category(%L,%s)', 'wsdadmintok', v_cat_a), '55000');

    -- deactivate / reactivate round-trip
    PERFORM catalog.set_category_active('wsdadmintok', v_cat_b, false);
    IF (SELECT is_active FROM catalog.categories WHERE id = v_cat_b) <> false THEN
        RAISE EXCEPTION 'ASSERT FAIL: category not deactivated';
    END IF;
    PERFORM catalog.set_category_active('wsdadmintok', v_cat_b, true);
    IF (SELECT is_active FROM catalog.categories WHERE id = v_cat_b) <> true THEN
        RAISE EXCEPTION 'ASSERT FAIL: category not reactivated';
    END IF;

    INSERT INTO t VALUES ('cat_a', v_cat_a), ('cat_b', v_cat_b), ('unit', v_unit), ('p_cola', v_pid), ('v_cola', v_vid);
    RAISE NOTICE 'category CRUD OK';
END $$;

-- ---- 2. Unit CRUD (incl. in-use-by-alternate-unit) ---------------------------
-- WS-D-CORRECTION-1: Brand CRUD (list/create/rename/set_active/delete_brand)
-- was removed here — Brand is no longer a product-level reference type; it is
-- now an ordinary variant-level Attribute (see section 3 below, which already
-- exercises the Attribute lifecycle Brand now reuses). catalog.brands and
-- catalog.products.brand_id remain in the schema, untouched, for
-- procurement.list_purchase_product_options / post_purchase_transaction.
DO $$
DECLARE v_unit_new bigint; v_unit_alt bigint; v_pid bigint; v_vid bigint;
BEGIN
    -- WS-D-13 Phase A: create_unit/rename_unit now carry allows_fractions.
    -- A Crate holds whole items, so it is created whole-number-only.
    v_unit_new := catalog.create_unit('wsdadmintok', 'CRATE', 'Crate', false);
    IF catalog.create_unit('wsdadmintok', ' crate ', 'Crate Dup', true) <> v_unit_new THEN
        RAISE EXCEPTION 'ASSERT FAIL: unit create not normalized/idempotent';
    END IF;
    -- ...and the get-or-create must NOT have redefined the existing unit's
    -- fractional semantics as a side effect of the second call passing true.
    IF (SELECT allows_fractions FROM catalog.units WHERE id = v_unit_new) IS DISTINCT FROM false THEN
        RAISE EXCEPTION 'ASSERT FAIL: create_unit conflict path overwrote allows_fractions';
    END IF;

    -- Rename carrying the CURRENT flag: the name changes, the flag survives.
    PERFORM catalog.rename_unit('wsdadmintok', v_unit_new, 'CRATE', 'Wooden Crate', false);
    IF (SELECT name FROM catalog.units WHERE id = v_unit_new) <> 'Wooden Crate' THEN
        RAISE EXCEPTION 'ASSERT FAIL: unit rename did not persist';
    END IF;
    IF (SELECT allows_fractions FROM catalog.units WHERE id = v_unit_new) IS DISTINCT FROM false THEN
        RAISE EXCEPTION 'ASSERT FAIL: unit rename did not preserve allows_fractions';
    END IF;
    -- A deliberate change of the flag through rename does take effect...
    PERFORM catalog.rename_unit('wsdadmintok', v_unit_new, 'CRATE', 'Wooden Crate', true);
    IF (SELECT allows_fractions FROM catalog.units WHERE id = v_unit_new) IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'ASSERT FAIL: unit rename did not apply allows_fractions';
    END IF;
    -- ...and list_units_v2 reports it, which is what the UI reads.
    IF (SELECT allows_fractions FROM catalog.list_units_v2('wsdadmintok') WHERE id = v_unit_new)
       IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'ASSERT FAIL: list_units_v2 did not expose allows_fractions';
    END IF;
    PERFORM catalog.rename_unit('wsdadmintok', v_unit_new, 'CRATE', 'Wooden Crate', false);
    PERFORM pg_temp.expect_error(
        format('SELECT catalog.rename_unit(%L,%s,%L,%L,%L)', 'wsdadmintok', v_unit_new, 'UNIT', 'x', false), '22023');

    DECLARE v_disposable bigint;
    BEGIN
        v_disposable := catalog.create_unit('wsdadmintok', 'TEMPU', 'Temp Unit', true);
        PERFORM catalog.delete_unit('wsdadmintok', v_disposable);
        IF EXISTS (SELECT 1 FROM catalog.units WHERE id = v_disposable) THEN
            RAISE EXCEPTION 'ASSERT FAIL: unused unit not deleted';
        END IF;
    END;

    -- in-use-by-base_unit_id blocks delete
    PERFORM pg_temp.expect_error(
        format('SELECT catalog.delete_unit(%L,%s)', 'wsdadmintok', (SELECT v FROM t WHERE k='unit')), '55000');

    -- in-use-by-alternate-unit conversion row blocks delete
    v_unit_alt := catalog.create_unit('wsdadmintok', 'DOZEN2', 'Dozen (WS-D test)', false);
    SELECT v INTO v_vid FROM t WHERE k = 'v_cola';
    -- WS-D-14 Part 2: add_variant_alt_unit now takes a direction and a
    -- quantity instead of a bare factor. ALT_TO_BASE with quantity 12 means
    -- exactly what the old 4-arg call meant: "1 DOZEN2 = 12 base units".
    PERFORM catalog.add_variant_alt_unit('wsdadmintok', v_vid, v_unit_alt, 'ALT_TO_BASE', 12);
    PERFORM pg_temp.expect_error(format('SELECT catalog.delete_unit(%L,%s)', 'wsdadmintok', v_unit_alt), '55000');

    IF (SELECT usage_count FROM catalog.list_units_v2('wsdadmintok') WHERE id = v_unit_alt) <> 1 THEN
        RAISE EXCEPTION 'ASSERT FAIL: unit usage_count not 1 for alt-unit-only usage';
    END IF;

    -- WS-D-13 Phase B: the conversion just created must be READABLE, or the
    -- panel can only ever add alternate units blind. conversion_factor
    -- crosses as text, like sale_price and minimum_stock.
    DECLARE
        v_variant jsonb;
        v_alt jsonb;
    BEGIN
        SELECT vv INTO v_variant
            FROM jsonb_array_elements(
                catalog.get_product_detail('wsdadmintok', (SELECT product_id FROM catalog.product_variants WHERE id = v_vid)) -> 'variants'
            ) vv
            WHERE (vv ->> 'variant_id')::bigint = v_vid;
        IF v_variant IS NULL THEN
            RAISE EXCEPTION 'ASSERT FAIL: variant % absent from get_product_detail', v_vid;
        END IF;
        IF jsonb_array_length(v_variant -> 'alt_units') <> 1 THEN
            RAISE EXCEPTION 'ASSERT FAIL: alt_units missing from get_product_detail: %',
                v_variant -> 'alt_units';
        END IF;
        v_alt := v_variant -> 'alt_units' -> 0;
        IF jsonb_typeof(v_alt -> 'conversion_factor') <> 'string' THEN
            RAISE EXCEPTION 'ASSERT FAIL: conversion_factor must cross as text, got %',
                jsonb_typeof(v_alt -> 'conversion_factor');
        END IF;
        IF (v_alt ->> 'unit_code') <> 'DOZEN2' OR (v_alt ->> 'unit_id')::bigint <> v_unit_alt THEN
            RAISE EXCEPTION 'ASSERT FAIL: alt_units row does not describe the configured unit: %', v_alt;
        END IF;
        -- WS-D-14 Part 2: ALT_TO_BASE is a direct copy, no division --
        -- conversion_quantity and conversion_factor must be identical.
        IF (v_alt ->> 'conversion_direction') <> 'ALT_TO_BASE' THEN
            RAISE EXCEPTION 'ASSERT FAIL: conversion_direction wrong: %', v_alt ->> 'conversion_direction';
        END IF;
        IF (v_alt ->> 'conversion_quantity') <> '12.000000' OR (v_alt ->> 'conversion_factor') <> '12.000000' THEN
            RAISE EXCEPTION 'ASSERT FAIL: ALT_TO_BASE quantity/factor mismatch: %', v_alt;
        END IF;
        IF jsonb_typeof(v_alt -> 'conversion_quantity') <> 'string' THEN
            RAISE EXCEPTION 'ASSERT FAIL: conversion_quantity must cross as text, got %',
                jsonb_typeof(v_alt -> 'conversion_quantity');
        END IF;
        -- ADD ONLY: the keys WS-D-5B and earlier established must all survive.
        IF NOT (v_variant ? 'variant_id' AND v_variant ? 'sku' AND v_variant ? 'name_override'
            AND v_variant ? 'effective_variant_name' AND v_variant ? 'primary_barcode'
            AND v_variant ? 'operational_identifier' AND v_variant ? 'identifier_type'
            AND v_variant ? 'sale_price' AND v_variant ? 'is_active'
            AND v_variant ? 'attribute_signature' AND v_variant ? 'attributes'
            AND v_variant ? 'barcodes' AND v_variant ? 'minimum_stock') THEN
            RAISE EXCEPTION 'ASSERT FAIL: get_product_detail lost an existing variant key: %',
                (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_variant) k);
        END IF;
    END;

    RAISE NOTICE 'unit CRUD (incl. alt-unit-in-use, alt_units in detail) OK';
END $$;

-- ---- 2b. WS-D-14 Part 2 -- conversion direction, the "1 BOX = 3 PIECE" trap ---
DO $$
DECLARE
    v_base bigint; v_alt bigint; v_pid bigint; v_vid bigint;
    v_detail jsonb; v_variant jsonb; v_altrow jsonb;
BEGIN
    v_base := catalog.create_unit('wsdadmintok', 'WSD14BOX', 'Box', false);
    v_alt  := catalog.create_unit('wsdadmintok', 'WSD14PC', 'Piece', false);
    SELECT product_id, variant_id INTO v_pid, v_vid
        FROM catalog.quick_create_product('wsdadmintok', 'WS-D-14 Pillow', v_base, 100, NULL, NULL, 0, true);

    -- THE TRAP: "1 BOX(base) = 3 PIECE(alt)" must store exactly "3", never
    -- the lossy reciprocal 0.333333 a division-in-React approach would
    -- produce and would then have to display back.
    PERFORM catalog.add_variant_alt_unit('wsdadmintok', v_vid, v_alt, 'BASE_TO_ALT', 3);

    v_detail := catalog.get_product_detail('wsdadmintok', v_pid);
    SELECT vv INTO v_variant FROM jsonb_array_elements(v_detail -> 'variants') vv
        WHERE (vv ->> 'variant_id')::bigint = v_vid;
    v_altrow := v_variant -> 'alt_units' -> 0;

    IF (v_altrow ->> 'conversion_direction') <> 'BASE_TO_ALT' THEN
        RAISE EXCEPTION 'ASSERT FAIL: BASE_TO_ALT direction not stored: %', v_altrow;
    END IF;
    IF (v_altrow ->> 'conversion_quantity') <> '3.000000' THEN
        RAISE EXCEPTION 'ASSERT FAIL: conversion_quantity not exact for the trap case: %',
            v_altrow ->> 'conversion_quantity';
    END IF;
    -- The legacy column is STILL populated, for the three out-of-scope
    -- transaction-time functions that already read it -- and IS the lossy
    -- reciprocal. That is expected and unchanged; nothing user-facing reads
    -- this column for display (the UI reads conversion_direction and
    -- conversion_quantity instead).
    IF (v_altrow ->> 'conversion_factor') <> '0.333333' THEN
        RAISE EXCEPTION 'ASSERT FAIL: conversion_factor unexpected: %', v_altrow ->> 'conversion_factor';
    END IF;

    -- base-unit-must-differ rule survives the signature change unchanged.
    PERFORM pg_temp.expect_error(
        format('SELECT catalog.add_variant_alt_unit(%L,%s,%s,%L,%s)',
            'wsdadmintok', v_vid, v_base, 'ALT_TO_BASE', 5), '22023');
    -- zero and blank quantity still rejected.
    PERFORM pg_temp.expect_error(
        format('SELECT catalog.add_variant_alt_unit(%L,%s,%s,%L,%s)',
            'wsdadmintok', v_vid, v_alt, 'ALT_TO_BASE', 0), '22023');
    -- an invalid direction string is rejected, not silently coerced.
    PERFORM pg_temp.expect_error(
        format('SELECT catalog.add_variant_alt_unit(%L,%s,%s,%L,%s)',
            'wsdadmintok', v_vid, v_alt, 'SIDEWAYS', 5), '22023');

    RAISE NOTICE 'WS-D-14 Part 2 conversion-direction assertions PASSED';
END $$;

-- ---- 3. Attribute + attribute value CRUD -------------------------------------
DO $$
DECLARE v_attr bigint; v_val_a bigint; v_val_b bigint;
BEGIN
    v_attr := catalog.create_attribute('wsdadmintok', 'Size2');
    v_val_a := catalog.add_attribute_value('wsdadmintok', v_attr, 'Small2');
    v_val_b := catalog.add_attribute_value('wsdadmintok', v_attr, 'Large2');

    PERFORM catalog.rename_attribute('wsdadmintok', v_attr, 'Size2Renamed');
    IF (SELECT name FROM catalog.attributes WHERE id = v_attr) <> 'Size2Renamed' THEN
        RAISE EXCEPTION 'ASSERT FAIL: attribute rename did not persist';
    END IF;

    PERFORM catalog.rename_attribute_value('wsdadmintok', v_val_a, 'Small2Renamed');
    IF (SELECT value FROM catalog.attribute_values WHERE id = v_val_a) <> 'Small2Renamed' THEN
        RAISE EXCEPTION 'ASSERT FAIL: attribute value rename did not persist';
    END IF;
    PERFORM pg_temp.expect_error(
        format('SELECT catalog.rename_attribute_value(%L,%s,%L)', 'wsdadmintok', v_val_a, 'Large2'), '22023');

    -- attribute has values -> delete blocked even though no variant uses them yet
    IF (SELECT usage_count FROM catalog.list_attributes_v2('wsdadmintok') WHERE id = v_attr) <> 2 THEN
        RAISE EXCEPTION 'ASSERT FAIL: attribute usage_count should count its 2 values';
    END IF;
    PERFORM pg_temp.expect_error(format('SELECT catalog.delete_attribute(%L,%s)', 'wsdadmintok', v_attr), '55000');

    -- delete the unused value -> succeeds
    PERFORM catalog.delete_attribute_value('wsdadmintok', v_val_b);
    IF EXISTS (SELECT 1 FROM catalog.attribute_values WHERE id = v_val_b) THEN
        RAISE EXCEPTION 'ASSERT FAIL: unused attribute value not deleted';
    END IF;

    -- deactivate / reactivate round trip on both
    PERFORM catalog.set_attribute_active('wsdadmintok', v_attr, false);
    PERFORM catalog.set_attribute_value_active('wsdadmintok', v_val_a, false);
    IF (SELECT is_active FROM catalog.attributes WHERE id = v_attr) <> false
        OR (SELECT is_active FROM catalog.attribute_values WHERE id = v_val_a) <> false THEN
        RAISE EXCEPTION 'ASSERT FAIL: attribute/value not deactivated';
    END IF;
    PERFORM catalog.set_attribute_active('wsdadmintok', v_attr, true);
    PERFORM catalog.set_attribute_value_active('wsdadmintok', v_val_a, true);

    INSERT INTO t VALUES ('attr', v_attr), ('val_a', v_val_a);
    RAISE NOTICE 'attribute + attribute value CRUD OK';
END $$;

-- ---- 4. quick_create_product happy path + duplicate-barcode rollback --------
DO $$
DECLARE
    v_unit bigint; v_pid bigint; v_vid bigint; v_sku text;
    v_before_products bigint; v_before_variants bigint;
    v_after_products bigint; v_after_variants bigint;
BEGIN
    SELECT v INTO v_unit FROM t WHERE k = 'unit';

    SELECT product_id, variant_id INTO v_pid, v_vid
        FROM catalog.quick_create_product(
            'wsdadmintok', 'Quick Widget', v_unit, 4.25,
            p_barcode => 'QW-0001', p_minimum_stock => 3
        );
    IF v_pid IS NULL OR v_vid IS NULL THEN
        RAISE EXCEPTION 'ASSERT FAIL: quick_create_product returned null ids';
    END IF;
    SELECT sku INTO v_sku FROM catalog.product_variants WHERE id = v_vid;
    IF v_sku !~ '^SKU-\d{8}$' THEN
        RAISE EXCEPTION 'ASSERT FAIL: quick_create_product did not generate a usable SKU (got %)', v_sku;
    END IF;
    IF (SELECT minimum_stock FROM catalog.product_variants WHERE id = v_vid) <> 3 THEN
        RAISE EXCEPTION 'ASSERT FAIL: minimum_stock not persisted by quick_create_product';
    END IF;
    IF (SELECT attribute_signature FROM catalog.product_variants WHERE id = v_vid) <> '' THEN
        RAISE EXCEPTION 'ASSERT FAIL: quick_create_product variant should have empty attribute_signature';
    END IF;

    -- duplicate barcode: fails clean, no partial product/variant left behind
    SELECT count(*) INTO v_before_products FROM catalog.products;
    SELECT count(*) INTO v_before_variants FROM catalog.product_variants;
    PERFORM pg_temp.expect_error(
        format('SELECT catalog.quick_create_product(%L,%L,%s,%L,p_barcode=>%L)',
            'wsdadmintok', 'Duplicate Barcode Widget', v_unit, '9.99', 'QW-0001'),
        '22023');
    SELECT count(*) INTO v_after_products FROM catalog.products;
    SELECT count(*) INTO v_after_variants FROM catalog.product_variants;
    IF v_after_products <> v_before_products OR v_after_variants <> v_before_variants THEN
        RAISE EXCEPTION 'ASSERT FAIL: duplicate-barcode quick_create_product left partial rows (% -> %, % -> %)',
            v_before_products, v_after_products, v_before_variants, v_after_variants;
    END IF;
    IF EXISTS (SELECT 1 FROM catalog.products WHERE name = 'Duplicate Barcode Widget') THEN
        RAISE EXCEPTION 'ASSERT FAIL: Duplicate Barcode Widget product persisted despite failure';
    END IF;

    -- minimum_stock rejects negatives, both via function and raw CHECK
    PERFORM pg_temp.expect_error(
        format('SELECT catalog.quick_create_product(%L,%L,%s,%L,p_minimum_stock=>%L)',
            'wsdadmintok', 'Negative Min Stock Widget', v_unit, '1.00', '-1'),
        '22023');
    PERFORM pg_temp.expect_error(
        format('UPDATE catalog.product_variants SET minimum_stock = -5 WHERE id = %s', v_vid), '23514');
    PERFORM pg_temp.expect_error(
        format('SELECT catalog.update_variant(%L,%s,NULL,%L,true,-1)', 'wsdadmintok', v_vid, '4.25'), '22023');

    INSERT INTO t VALUES ('p_quick', v_pid), ('v_quick', v_vid);
    RAISE NOTICE 'quick_create_product happy path + duplicate barcode rollback + negative minimum_stock OK';
END $$;

-- ---- 5. list_products_v2: multi-field search, display_identifier, dual-match,
--         category non-interference with attribute_signature/effective name --
DO $$
DECLARE
    v_unit bigint; v_cat bigint; v_flavor bigint; v_cherry bigint;
    v_pid_alpha bigint; v_vid_base bigint; v_vid_flavor bigint;
    v_base_sku text;
    v_pid_dual bigint; v_vid_dual bigint;
    v_pid_a bigint; v_pid_b bigint; v_vid_a bigint; v_vid_b bigint;
    v_sig_a text; v_sig_b text;
    v_cnt bigint;
BEGIN
    SELECT v INTO v_unit FROM t WHERE k = 'unit';
    v_cat := catalog.create_category('wsdadmintok', 'Search Test Category');
    v_flavor := catalog.create_attribute('wsdadmintok', 'FlavorWSD');
    v_cherry := catalog.add_attribute_value('wsdadmintok', v_flavor, 'CherryWSD');

    SELECT product_id, variant_id INTO v_pid_alpha, v_vid_base
        FROM catalog.quick_create_product(
            'wsdadmintok', 'AlphaProductWSD', v_unit, 9.99,
            p_category_id => v_cat, p_barcode => 'BC-ALPHA-BASE-WSD'
        );
    SELECT sku INTO v_base_sku FROM catalog.product_variants WHERE id = v_vid_base;

    v_vid_flavor := catalog.add_variant('wsdadmintok', v_pid_alpha, jsonb_build_object(
        'sale_price', '11.00',
        'name_override', 'AlphaOverrideNameWSD',
        'attribute_value_ids', jsonb_build_array(v_cherry)
    ));
    -- deliberately no barcode on this variant: display_identifier must fall back to SKU

    -- barcode search
    IF (SELECT count(*) FROM catalog.list_products_v2('wsdadmintok', 1, 'BC-ALPHA-BASE-WSD')) <> 1 THEN
        RAISE EXCEPTION 'ASSERT FAIL: barcode search did not find exactly 1 row';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM catalog.list_products_v2('wsdadmintok', 1, 'BC-ALPHA-BASE-WSD') WHERE variant_id = v_vid_base) THEN
        RAISE EXCEPTION 'ASSERT FAIL: barcode search did not find the right variant';
    END IF;

    -- SKU search
    IF (SELECT count(*) FROM catalog.list_products_v2('wsdadmintok', 1, v_base_sku)) <> 1 THEN
        RAISE EXCEPTION 'ASSERT FAIL: SKU search did not find exactly 1 row';
    END IF;

    -- product name search matches both sibling variants (2 rows, not deduped away)
    SELECT count(*) INTO v_cnt FROM catalog.list_products_v2('wsdadmintok', 1, 'AlphaProductWSD');
    IF v_cnt <> 2 THEN
        RAISE EXCEPTION 'ASSERT FAIL: product-name search expected 2 sibling variants, got %', v_cnt;
    END IF;

    -- variant (effective) name search finds only the overridden variant
    IF (SELECT count(*) FROM catalog.list_products_v2('wsdadmintok', 1, 'AlphaOverrideNameWSD')) <> 1 THEN
        RAISE EXCEPTION 'ASSERT FAIL: variant-name search did not find exactly 1 row';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM catalog.list_products_v2('wsdadmintok', 1, 'AlphaOverrideNameWSD') WHERE variant_id = v_vid_flavor) THEN
        RAISE EXCEPTION 'ASSERT FAIL: variant-name search did not find the right variant';
    END IF;

    -- attribute-value search finds only the flavored variant
    IF (SELECT count(*) FROM catalog.list_products_v2('wsdadmintok', 1, 'CherryWSD')) <> 1 THEN
        RAISE EXCEPTION 'ASSERT FAIL: attribute-value search did not find exactly 1 row';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM catalog.list_products_v2('wsdadmintok', 1, 'CherryWSD') WHERE variant_id = v_vid_flavor) THEN
        RAISE EXCEPTION 'ASSERT FAIL: attribute-value search did not find the right variant';
    END IF;

    -- display_identifier: barcode when present, SKU when absent
    IF (SELECT display_identifier FROM catalog.list_products_v2('wsdadmintok', 1, 'BC-ALPHA-BASE-WSD') WHERE variant_id = v_vid_base) <> 'BC-ALPHA-BASE-WSD' THEN
        RAISE EXCEPTION 'ASSERT FAIL: display_identifier should be the barcode when one exists';
    END IF;
    IF (SELECT identifier_type FROM catalog.list_products_v2('wsdadmintok', 1, 'BC-ALPHA-BASE-WSD') WHERE variant_id = v_vid_base) <> 'BARCODE' THEN
        RAISE EXCEPTION 'ASSERT FAIL: identifier_type should be BARCODE when a barcode exists';
    END IF;
    IF (SELECT display_identifier FROM catalog.list_products_v2('wsdadmintok', 1, 'CherryWSD') WHERE variant_id = v_vid_flavor)
        <> (SELECT sku FROM catalog.product_variants WHERE id = v_vid_flavor) THEN
        RAISE EXCEPTION 'ASSERT FAIL: display_identifier should fall back to SKU when no barcode exists';
    END IF;
    IF (SELECT identifier_type FROM catalog.list_products_v2('wsdadmintok', 1, 'CherryWSD') WHERE variant_id = v_vid_flavor) <> 'SKU' THEN
        RAISE EXCEPTION 'ASSERT FAIL: identifier_type should be SKU when no barcode exists';
    END IF;

    -- dual-field match on the same item still returns exactly one row
    SELECT product_id, variant_id INTO v_pid_dual, v_vid_dual
        FROM catalog.quick_create_product('wsdadmintok', 'ZZDualMatchWSD', v_unit, 1.00, p_barcode => 'ZZDualMatchWSD-BC');
    SELECT count(*) INTO v_cnt FROM catalog.list_products_v2('wsdadmintok', 1, 'ZZDualMatchWSD');
    IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'ASSERT FAIL: term matching both product name and barcode on the same item returned % rows, expected 1', v_cnt;
    END IF;

    -- category never participates in attribute_signature or the effective name
    SELECT product_id INTO v_pid_a FROM catalog.quick_create_product('wsdadmintok', 'CatSigTestWithCategory', v_unit, 1.00, p_category_id => v_cat);
    SELECT product_id INTO v_pid_b FROM catalog.quick_create_product('wsdadmintok', 'CatSigTestWithoutCategory', v_unit, 1.00);
    v_vid_a := catalog.add_variant('wsdadmintok', v_pid_a, jsonb_build_object('sale_price','2.00','attribute_value_ids', jsonb_build_array(v_cherry)));
    v_vid_b := catalog.add_variant('wsdadmintok', v_pid_b, jsonb_build_object('sale_price','2.00','attribute_value_ids', jsonb_build_array(v_cherry)));
    SELECT attribute_signature INTO v_sig_a FROM catalog.product_variants WHERE id = v_vid_a;
    SELECT attribute_signature INTO v_sig_b FROM catalog.product_variants WHERE id = v_vid_b;
    IF v_sig_a <> v_sig_b THEN
        RAISE EXCEPTION 'ASSERT FAIL: category presence changed attribute_signature (% vs %)', v_sig_a, v_sig_b;
    END IF;
    IF catalog._effective_variant_name(v_vid_a) <> ('CatSigTestWithCategory - CherryWSD') THEN
        RAISE EXCEPTION 'ASSERT FAIL: categorized variant effective name leaked category text: %', catalog._effective_variant_name(v_vid_a);
    END IF;

    RAISE NOTICE 'multi-field search, display_identifier, dual-match, category-non-interference OK';
END $$;

-- ---- 6. Pagination: disjoint/complete/non-repeating, and server-side clamp --
DO $$
DECLARE
    v_unit bigint; i integer;
    v_page1 bigint[]; v_page2 bigint[]; v_page3 bigint[];
    v_total_1 bigint; v_total_2 bigint; v_total_3 bigint;
    v_union_count bigint; v_overlap_count bigint;
    v_clamped_count bigint;
BEGIN
    SELECT v INTO v_unit FROM t WHERE k = 'unit';

    FOR i IN 1..105 LOOP
        PERFORM catalog.quick_create_product(
            'wsdadmintok', 'ClampItemWSD ' || lpad(i::text, 3, '0'), v_unit, 1.00
        );
    END LOOP;

    SELECT array_agg(variant_id), max(total_count) INTO v_page1, v_total_1
        FROM catalog.list_products_v2('wsdadmintok', 1, 'ClampItemWSD', p_limit => 40, p_offset => 0);
    SELECT array_agg(variant_id), max(total_count) INTO v_page2, v_total_2
        FROM catalog.list_products_v2('wsdadmintok', 1, 'ClampItemWSD', p_limit => 40, p_offset => 40);
    SELECT array_agg(variant_id), max(total_count) INTO v_page3, v_total_3
        FROM catalog.list_products_v2('wsdadmintok', 1, 'ClampItemWSD', p_limit => 40, p_offset => 80);

    IF array_length(v_page1,1) <> 40 OR array_length(v_page2,1) <> 40 OR array_length(v_page3,1) <> 25 THEN
        RAISE EXCEPTION 'ASSERT FAIL: page sizes wrong (% / % / %)', array_length(v_page1,1), array_length(v_page2,1), array_length(v_page3,1);
    END IF;
    IF v_total_1 <> 105 OR v_total_2 <> 105 OR v_total_3 <> 105 THEN
        RAISE EXCEPTION 'ASSERT FAIL: total_count not stable/correct across pages (% / % / %)', v_total_1, v_total_2, v_total_3;
    END IF;

    -- disjoint: no variant_id appears on more than one page
    SELECT count(*) INTO v_overlap_count FROM (
        SELECT unnest(v_page1) AS id
        INTERSECT SELECT unnest(v_page2)
        UNION ALL
        SELECT unnest(v_page2)
        INTERSECT SELECT unnest(v_page3)
        UNION ALL
        SELECT unnest(v_page1)
        INTERSECT SELECT unnest(v_page3)
    ) ovl;
    IF v_overlap_count <> 0 THEN
        RAISE EXCEPTION 'ASSERT FAIL: pages are not disjoint, % overlapping id(s)', v_overlap_count;
    END IF;

    -- complete + non-repeating: union of all three pages covers exactly the 105 rows
    SELECT count(DISTINCT id) INTO v_union_count FROM (
        SELECT unnest(v_page1) AS id
        UNION ALL SELECT unnest(v_page2)
        UNION ALL SELECT unnest(v_page3)
    ) all_ids;
    IF v_union_count <> 105 THEN
        RAISE EXCEPTION 'ASSERT FAIL: paged union covers % distinct rows, expected 105', v_union_count;
    END IF;

    -- server-side clamp: an outrageous p_limit is capped at 100, not honoured literally
    SELECT count(*) INTO v_clamped_count
        FROM catalog.list_products_v2('wsdadmintok', 1, 'ClampItemWSD', p_limit => 999999, p_offset => 0);
    IF v_clamped_count <> 100 THEN
        RAISE EXCEPTION 'ASSERT FAIL: p_limit was not clamped to the 100-row server maximum (got %)', v_clamped_count;
    END IF;

    RAISE NOTICE 'pagination (disjoint/complete/non-repeating) + server-side clamp OK';
END $$;

-- ---- 7. LIKE metacharacters in search terms must be literal, not wildcards -
DO $$
DECLARE
    v_unit bigint; v_pid_pct bigint; v_pid_other bigint; v_cnt bigint;
BEGIN
    SELECT v INTO v_unit FROM t WHERE k = 'unit';

    -- a product name containing a literal '%' ...
    SELECT product_id INTO v_pid_pct
        FROM catalog.quick_create_product('wsdadmintok', '50% Cotton Towel WSD', v_unit, 5.00);
    -- ... and an unrelated product whose name would wrongly match if '%' were
    -- treated as a wildcard instead of a literal character.
    SELECT product_id INTO v_pid_other
        FROM catalog.quick_create_product('wsdadmintok', '50XCotton Towel WSD', v_unit, 5.00);

    SELECT count(*) INTO v_cnt FROM catalog.list_products_v2('wsdadmintok', 1, '50% Cotton');
    IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'ASSERT FAIL: literal %% search matched % rows, expected exactly 1', v_cnt;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM catalog.list_products_v2('wsdadmintok', 1, '50% Cotton') WHERE product_id = v_pid_pct) THEN
        RAISE EXCEPTION 'ASSERT FAIL: literal %% search did not find the product actually containing %%';
    END IF;
    IF EXISTS (SELECT 1 FROM catalog.list_products_v2('wsdadmintok', 1, '50% Cotton') WHERE product_id = v_pid_other) THEN
        RAISE EXCEPTION 'ASSERT FAIL: literal %% search wrongly matched the unrelated product (wildcard behaviour leaked through)';
    END IF;

    -- '_' must likewise be literal, not a single-character wildcard
    PERFORM catalog.quick_create_product('wsdadmintok', 'A_B Widget WSD', v_unit, 5.00);
    PERFORM catalog.quick_create_product('wsdadmintok', 'AxB Widget WSD', v_unit, 5.00);
    SELECT count(*) INTO v_cnt FROM catalog.list_products_v2('wsdadmintok', 1, 'A_B Widget WSD');
    IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'ASSERT FAIL: literal underscore search matched % rows, expected exactly 1', v_cnt;
    END IF;

    RAISE NOTICE 'LIKE metacharacter (%%, _) literal-search escaping OK';
END $$;

SELECT 'ALL WS-D-001 DB ASSERTIONS PASSED' AS result;
