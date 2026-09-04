-- =============================================================================
-- WS-D-5B — expose category_id and minimum_stock through get_product_detail.
--
-- WS-D-5 moved product creation onto the v2 write layer but could not move the
-- EDIT flow, because this function — the one that populates the edit form —
-- returned neither the product's category_id nor each variant's minimum_stock,
-- while both v2 writers overwrite those columns unconditionally:
--
--   catalog.update_product  (6-arg): SET ... category_id = p_category_id
--   catalog.update_variant  (6-arg): SET ... minimum_stock = coalesce(p_minimum_stock, 0)
--
-- An edit form that cannot READ those two values would therefore have silently
-- cleared the category and reset the minimum stock of every product it saved.
-- Adding the two keys here closes that gap and is what makes the edit flow
-- safe to build.
--
-- ADD ONLY. The 25 existing keys keep their names, order, and types: the
-- frontend deserializes by name and consumers outside WS-D read this payload.
-- The signature is unchanged (still `(text, bigint) RETURNS jsonb`), so the
-- Rust layer — which passes the jsonb straight through as an opaque
-- JsonValue, with no row struct — needs no change at all, exactly as with
-- WS-D-CORRECTION-2's list_attributes.
--
-- Consumers audited before writing this, none of which break on added keys:
--   * src-tauri/src/application/catalog.rs — query_as::<_, (JsonValue,)>,
--     opaque passthrough, no struct and no FromRow.
--   * src-tauri/tests/catalog/s2_001_catalog_integration.sql — asserts only
--     jsonb_array_length(... -> 'variants').
--   * src-tauri/tests/catalog/ws_d_003_active_attribute_filtering_integration.sql
--     — navigates variants[].attributes[] by name.
--   * tests/catalog.gateway.test.ts — asserts the request arguments and
--     result.product_id only.
--
-- There is exactly one get_product_detail signature; this is a CREATE OR
-- REPLACE in place, not a new overload (ws-d-skill.md section 2.1).
--
-- minimum_stock is an exact decimal and is returned as text with `::text`,
-- byte-identical treatment to how this same function already returns
-- sale_price, so neither ever crosses IPC as a float (ws-d-skill.md section 6).
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
    v_prim_barcode text;
    v_op_id text;
    v_id_type text;
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);

    -- ADDED: p.category_id, so the edit form can round-trip the product's
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
        -- ADDED: v.minimum_stock, for the same round-trip reason.
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
            -- ADDED key #1 of 2. ::text mirrors sale_price above exactly.
            'minimum_stock', v_var.minimum_stock::text
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
        -- ADDED key #2 of 2. Nullable: a product may be uncategorised.
        'category_id', v_prod.category_id
    );
END;
$$;

-- =============================================================================
-- Grants -- nothing to PUBLIC, EXECUTE to stockiha_runtime only, matching the
-- grants issued in 20260724120100 and re-issued in 20260813180000. CREATE OR
-- REPLACE on an identical signature preserves existing grants; these are
-- re-issued explicitly so the function's authorization never depends on that
-- detail (ws-d-skill.md section 4 item 4).
-- =============================================================================
REVOKE ALL ON FUNCTION catalog.get_product_detail(text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog.get_product_detail(text, bigint) TO stockiha_runtime;
