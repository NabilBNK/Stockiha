-- =============================================================================
-- WS-D-14 Part 2 -- store the conversion in the DIRECTION it was entered,
-- never a value derived by dividing in React.
--
-- THE TRAP. catalog.variant_units.conversion_factor is numeric(20,6) and its
-- established meaning is "1 ALTERNATE unit = conversion_factor BASE units".
-- That meaning is fixed by three functions OUTSIDE this task's scope that
-- already read it to do real transaction-time arithmetic --
-- inventory.confirm_stock_adjustment, inventory.confirm_purchase_receipt, and
-- onboarding.inventory_corrections_policy's stock-adjustment path -- all of
-- which compute `quantity_in_selected_unit * conversion_factor` to get a base
-- quantity. This migration does NOT touch that column's meaning or any of
-- those functions: WS-D-14 Part 2 is display/definition only, exactly like
-- WS-D-13 Phase B, and applying conversions at transaction time stays out of
-- scope.
--
-- The problem is the OWNER'S phrasing: "the main unit is BOX, and
-- alternative is pieces, and 1 box = 10 pieces." That is "1 BASE = 10 ALT",
-- the OPPOSITE direction from what conversion_factor stores ("1 ALT = N
-- BASE"). Converting it means factor = 1/10 = 0.1 -- exact here, but for
-- "1 BOX = 3 PIECE" it is 1/3 = 0.333333 at six decimal places, and reading
-- it back would show "0.333333 BOX = 1 PIECE" -- a number the operator never
-- typed, in a unit they did not ask about, wrong by construction.
--
-- FIX -- store what was typed, not what a division produces:
--   conversion_direction text  -- 'ALT_TO_BASE' (legacy meaning, the default:
--     "1 alternate unit = conversion_quantity base units") or 'BASE_TO_ALT'
--     ("1 base unit = conversion_quantity alternate units", the Owner's
--     "1 BOX = 10 PIECE" shape).
--   conversion_quantity numeric(20,6) -- the EXACT number the operator typed
--     for the non-"1" side. Never computed, never divided into. For
--     'ALT_TO_BASE' this number IS conversion_factor, copied verbatim. For
--     'BASE_TO_ALT' it is "3" in the "1 BOX = 3 PIECE" case -- displayed as
--     exactly "3", never as the lossy reciprocal.
--
-- This is a numerator/denominator pair in substance: the "1" side is the
-- implicit denominator, conversion_quantity is the exact numerator, and
-- conversion_direction says which unit the denominator belongs to. Choosing
-- to add these two columns (shape (a) from the brief -- direction + a
-- magnitude alongside conversion_factor) rather than replacing
-- conversion_factor outright with a bare numerator/denominator pair (shape
-- (b)) is deliberate: conversion_factor's single-number "1 alt = N base"
-- shape is a load-bearing dependency of the three out-of-scope functions
-- named above, and restructuring or renaming it would risk their behaviour
-- for no benefit -- this task is display/definition only. conversion_factor
-- therefore keeps its exact current shape and is still populated on every
-- insert (computed once, in SQL, never in React); conversion_quantity is
-- the lossless value everything user-facing reads instead.
--
-- The one division that CAN still happen -- computing conversion_factor from
-- a 'BASE_TO_ALT' entry, for the legacy column those three functions read --
-- is confined to that internal column exactly as before this migration
-- (add_variant_alt_unit already accepted only a single numeric factor, so a
-- 'BASE_TO_ALT'-shaped entry was simply impossible to record correctly until
-- now). It never reaches the operator: get_product_detail and the UI read
-- conversion_direction/conversion_quantity, not conversion_factor, for
-- display.
--
-- BACKFILL. The pre-migration row count in stockiha_acceptance is reported
-- below via RAISE NOTICE, following the pattern in
-- 20260902090000_ws_d_002_brand_to_attribute.sql. Every existing row means
-- "1 alt = conversion_factor base" today (the only shape the old 4-argument
-- add_variant_alt_unit could ever produce), so the backfill is a direct,
-- lossless copy: conversion_direction = 'ALT_TO_BASE',
-- conversion_quantity = conversion_factor. No division, no rounding, and the
-- reported count is the number of rows that meaning was reproduced for.
--
-- WIDENING add_variant_alt_unit -- DROP + CREATE, not CREATE OR REPLACE
-- (ws-d-skill.md section 2.1, and the exact pattern WS-D-13 already used for
-- create_unit/rename_unit): the parameter list changes shape (one numeric
-- argument becomes a direction plus a quantity), and PostgreSQL keys
-- functions by argument types, so CREATE OR REPLACE here would leave a
-- SECOND live overload rather than replacing the first. The old signature is
-- dropped explicitly; every caller (Rust) is updated in this same change; a
-- dropped function loses its grants, so REVOKE/GRANT are re-issued.
--
-- get_product_detail's alt_units payload gets conversion_direction and
-- conversion_quantity ADDED alongside the existing five keys (id, variant_id,
-- unit_id, conversion_factor, unit_code, unit_name) -- nothing renamed,
-- reordered or retyped, the WS-D-5B/WS-D-13-Phase-B discipline. Both new
-- values cross as text (direction is already text; conversion_quantity gets
-- ::text like every other exact-decimal column in this function), never as a
-- float. The signature is unchanged, so this is CREATE OR REPLACE in place.
-- =============================================================================

DO $$
DECLARE
    v_existing_rows bigint;
BEGIN
    SELECT count(*) INTO v_existing_rows FROM catalog.variant_units;
    RAISE NOTICE 'catalog.variant_units rows to backfill with conversion_direction=ALT_TO_BASE: %', v_existing_rows;
END $$;

ALTER TABLE catalog.variant_units
    ADD COLUMN conversion_direction text,
    ADD COLUMN conversion_quantity numeric(20, 6);

-- Direct copy, no arithmetic: today's only meaning, reproduced exactly.
UPDATE catalog.variant_units
    SET conversion_direction = 'ALT_TO_BASE',
        conversion_quantity = conversion_factor;

ALTER TABLE catalog.variant_units
    ALTER COLUMN conversion_direction SET NOT NULL,
    ALTER COLUMN conversion_quantity SET NOT NULL,
    ADD CONSTRAINT variant_units_conversion_direction_check
        CHECK (conversion_direction IN ('ALT_TO_BASE', 'BASE_TO_ALT')),
    ADD CONSTRAINT variant_units_conversion_quantity_positive
        CHECK (conversion_quantity > 0);

COMMENT ON COLUMN catalog.variant_units.conversion_direction IS
    'WS-D-14: which side of the relationship the operator fixed at 1 when '
    'entering it. ALT_TO_BASE (legacy default): "1 alternate unit = '
    'conversion_quantity base units" -- this is also what conversion_factor '
    'means, unconditionally. BASE_TO_ALT: "1 base unit = conversion_quantity '
    'alternate units" (e.g. "1 BOX = 10 PIECE"). Display reads this column '
    'and conversion_quantity, never conversion_factor, so the operator never '
    'sees a value produced by dividing what they typed.';
COMMENT ON COLUMN catalog.variant_units.conversion_quantity IS
    'WS-D-14: the EXACT quantity the operator typed for the non-"1" side, '
    'never derived. For ALT_TO_BASE this equals conversion_factor exactly '
    '(copied, not computed). For BASE_TO_ALT it is the untouched numerator '
    'of the relationship as entered -- e.g. exactly "3" for "1 BOX = 3 '
    'PIECE", never the lossy reciprocal 0.333333 that conversion_factor '
    'alone would have to store.';

-- ------------------------------------------------------- add_variant_alt_unit
DROP FUNCTION catalog.add_variant_alt_unit(text, bigint, bigint, numeric);

CREATE FUNCTION catalog.add_variant_alt_unit(
    p_session_token text,
    p_variant_id bigint,
    p_unit_id bigint,
    p_conversion_direction text,
    p_conversion_quantity numeric
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
    v_base_unit bigint;
    v_id        bigint;
    v_factor    numeric(20, 6);
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    SELECT base_unit_id INTO v_base_unit FROM catalog.product_variants WHERE id = p_variant_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'variant % not found', p_variant_id USING ERRCODE = '22023';
    END IF;
    PERFORM 1 FROM catalog.units WHERE id = p_unit_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'unit % not found', p_unit_id USING ERRCODE = '22023';
    END IF;
    -- Preserved unchanged from the 4-argument version.
    IF p_unit_id = v_base_unit THEN
        RAISE EXCEPTION 'alternate unit must differ from the base unit' USING ERRCODE = '22023';
    END IF;
    IF p_conversion_direction NOT IN ('ALT_TO_BASE', 'BASE_TO_ALT') THEN
        RAISE EXCEPTION 'conversion direction must be ALT_TO_BASE or BASE_TO_ALT' USING ERRCODE = '22023';
    END IF;
    IF p_conversion_quantity IS NULL OR p_conversion_quantity <= 0 THEN
        RAISE EXCEPTION 'conversion quantity must be strictly positive' USING ERRCODE = '22023';
    END IF;

    -- conversion_factor keeps its existing "1 alt = factor base" meaning for
    -- the three out-of-scope functions that already read it. ALT_TO_BASE is
    -- a direct copy (matches today's behaviour exactly, no division).
    -- BASE_TO_ALT is the one place a division happens, and only to populate
    -- this legacy column -- conversion_quantity itself is stored untouched.
    IF p_conversion_direction = 'ALT_TO_BASE' THEN
        v_factor := p_conversion_quantity;
    ELSE
        v_factor := round(1 / p_conversion_quantity, 6);
        IF v_factor <= 0 THEN
            RAISE EXCEPTION 'conversion quantity % is too large to represent at six decimal places',
                p_conversion_quantity USING ERRCODE = '22023';
        END IF;
    END IF;

    BEGIN
        INSERT INTO catalog.variant_units
                (variant_id, unit_id, conversion_factor, conversion_direction, conversion_quantity)
            VALUES (p_variant_id, p_unit_id, v_factor, p_conversion_direction, p_conversion_quantity)
            RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'alternate unit % is already configured for this variant', p_unit_id
            USING ERRCODE = '22023';
    END;
    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION catalog.add_variant_alt_unit(text, bigint, bigint, text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog.add_variant_alt_unit(text, bigint, bigint, text, numeric) TO stockiha_runtime;

-- ------------------------------------------------------- get_product_detail
-- ADD ONLY: conversion_direction and conversion_quantity join the five keys
-- WS-D-13 Phase B added to each alt_units entry. Nothing existing is
-- renamed, reordered or retyped, and the signature is unchanged.
CREATE OR REPLACE FUNCTION catalog.get_product_detail(
    p_session_token text, p_product_id bigint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    v_prod record;
    v_vars jsonb := '[]'::jsonb;
    v_var  record;
    v_attrs jsonb;
    v_barcodes jsonb;
    v_alt_units jsonb;
    v_prim_barcode text;
    v_op_id text;
    v_id_type text;
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);

    SELECT p.id, p.name, p.unit_id, u.code AS unit_code, u.name AS unit_name, p.is_active,
           p.category_id
        INTO v_prod
        FROM catalog.products p
        JOIN catalog.units u ON u.id = p.unit_id
        WHERE p.id = p_product_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'product % not found', p_product_id USING ERRCODE = '22023';
    END IF;

    FOR v_var IN
        SELECT v.id, v.sku, v.name_override, catalog._effective_variant_name(v.id) AS effective_name,
               v.sale_price, v.attribute_signature, v.is_active,
               v.minimum_stock
            FROM catalog.product_variants v
            WHERE v.product_id = p_product_id
            ORDER BY v.id
    LOOP
        SELECT jsonb_agg(jsonb_build_object(
            'attribute_id', a.id,
            'attribute_name', a.name,
            'attribute_value_id', av.id,
            'value', av.value
        ) ORDER BY a.id, av.id)
            INTO v_attrs
            FROM catalog.variant_attribute_values vav
            JOIN catalog.attribute_values av ON av.id = vav.attribute_value_id
            JOIN catalog.attributes a ON a.id = av.attribute_id
            WHERE vav.variant_id = v_var.id;

        SELECT jsonb_agg(jsonb_build_object(
            'id', b.id,
            'barcode', b.barcode,
            'is_primary', b.is_primary
        ) ORDER BY b.id)
            INTO v_barcodes
            FROM catalog.variant_barcodes b
            WHERE b.variant_id = v_var.id;

        -- WS-D-14 Part 2: conversion_direction/conversion_quantity ADDED,
        -- alongside the WS-D-13 Phase B keys, unchanged.
        SELECT jsonb_agg(jsonb_build_object(
            'id', vu.id,
            'variant_id', vu.variant_id,
            'unit_id', vu.unit_id,
            'conversion_factor', vu.conversion_factor::text,
            'unit_code', u2.code,
            'unit_name', u2.name,
            'conversion_direction', vu.conversion_direction,
            'conversion_quantity', vu.conversion_quantity::text
        ) ORDER BY u2.code)
            INTO v_alt_units
            FROM catalog.variant_units vu
            JOIN catalog.units u2 ON u2.id = vu.unit_id
            WHERE vu.variant_id = v_var.id;

        SELECT barcode INTO v_prim_barcode
            FROM catalog.variant_barcodes
            WHERE variant_id = v_var.id AND is_primary = true;

        IF v_prim_barcode IS NOT NULL THEN
            v_op_id := v_prim_barcode;
            v_id_type := 'BARCODE';
        ELSE
            v_op_id := v_var.sku;
            v_id_type := 'SKU';
        END IF;

        v_vars := v_vars || jsonb_build_object(
            'variant_id', v_var.id,
            'sku', v_var.sku,
            'name_override', v_var.name_override,
            'effective_variant_name', v_var.effective_name,
            'primary_barcode', v_prim_barcode,
            'operational_identifier', v_op_id,
            'identifier_type', v_id_type,
            'sale_price', v_var.sale_price::text,
            'is_active', v_var.is_active,
            'attribute_signature', v_var.attribute_signature,
            'attributes', coalesce(v_attrs, '[]'::jsonb),
            'barcodes', coalesce(v_barcodes, '[]'::jsonb),
            'minimum_stock', v_var.minimum_stock::text,
            'alt_units', coalesce(v_alt_units, '[]'::jsonb)
        );
    END LOOP;

    RETURN jsonb_build_object(
        'product_id', v_prod.id,
        'name', v_prod.name,
        'unit_id', v_prod.unit_id,
        'unit_code', v_prod.unit_code,
        'unit_name', v_prod.unit_name,
        'is_active', v_prod.is_active,
        'variants', v_vars,
        'category_id', v_prod.category_id
    );
END;
$$;

REVOKE ALL ON FUNCTION catalog.get_product_detail(text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog.get_product_detail(text, bigint) TO stockiha_runtime;
