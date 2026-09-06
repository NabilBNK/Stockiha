-- =============================================================================
-- WS-D-13 Phase B -- expose each variant's alternate units through
-- catalog.get_product_detail.
--
-- Per-variant unit conversions have existed since 20260724120100
-- (catalog.variant_units, add_variant_alt_unit, remove_variant_alt_unit) and
-- have never been reachable from any screen: nothing returned them, so the
-- panel could not list what a variant already had, and an operator could only
-- ever add blind. This adds the read side. The conversions stay PER VARIANT,
-- which is correct and deliberate -- a box of pillows and a box of nails hold
-- different counts, so a global "BOX = 6" would be wrong.
--
-- ADD ONLY. Every existing key in this payload keeps its name, order and
-- type; `alt_units` is appended to each variant object, exactly the discipline
-- WS-D-5B (20260904090000) used when it added `minimum_stock` and
-- `category_id`. The signature is unchanged -- still (text, bigint) RETURNS
-- jsonb -- so this is a CREATE OR REPLACE in place, not a new overload
-- (ws-d-skill.md section 2.1), and the Rust layer needs no change at all: it
-- passes the jsonb through as an opaque JsonValue with no row struct.
--
-- Consumers audited before writing this, none of which break on an added key:
--   * src-tauri/src/application/catalog.rs -- query_as::<_, (JsonValue,)>,
--     opaque passthrough, no struct and no FromRow.
--   * src-tauri/tests/catalog/s2_001_catalog_integration.sql -- asserts only
--     jsonb_array_length(... -> 'variants').
--   * src-tauri/tests/catalog/ws_d_003_active_attribute_filtering_integration.sql
--     -- navigates variants[].attributes[] by name.
--   * src/features/catalog2/* and tests/catalog2.workflow.test.tsx -- read
--     named keys off each variant; an extra key is ignored.
--
-- conversion_factor is an EXACT DECIMAL and is returned with ::text, the same
-- treatment this function already gives sale_price and minimum_stock, so it
-- never crosses IPC as a float (ws-d-skill.md section 6).
--
-- Ordered by unit code so the panel's list is stable between reloads rather
-- than following insertion order.
-- =============================================================================
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

    -- WS-D-5B: p.category_id, so the edit form can round-trip the product's
    -- current category instead of overwriting it with NULL.
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
        -- WS-D-5B: v.minimum_stock, for the same round-trip reason.
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

        -- ADDED (WS-D-13 Phase B). Mirrors the VariantAltUnit DTO that has
        -- existed unused in src/shared/ipc/dto.ts since the alternate-unit
        -- functions were written: id, variant_id, unit_id, conversion_factor,
        -- unit_code, unit_name.
        SELECT jsonb_agg(jsonb_build_object(
            'id', vu.id,
            'variant_id', vu.variant_id,
            'unit_id', vu.unit_id,
            'conversion_factor', vu.conversion_factor::text,
            'unit_code', u2.code,
            'unit_name', u2.name
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
            -- ADDED. Empty array, never null, matching attributes/barcodes.
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

-- =============================================================================
-- Grants. CREATE OR REPLACE on an identical signature preserves existing
-- grants; these are re-issued explicitly so the function's authorization never
-- depends on that detail (ws-d-skill.md section 4 item 4).
-- =============================================================================
REVOKE ALL ON FUNCTION catalog.get_product_detail(text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog.get_product_detail(text, bigint) TO stockiha_runtime;
