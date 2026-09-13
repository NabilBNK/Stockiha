-- WS-F-003: attribute receipt visibility toggle
--
-- Adds visible_on_receipt flag to catalog.attributes (default true).
-- Provides catalog.set_attribute_visible_on_receipt to toggle it.
-- Updates catalog.list_attributes_v2 to return visible_on_receipt.
-- Updates catalog.list_products_v2 to include visible_on_receipt in attributes jsonb.

SET ROLE stockiha_owner;

-- 1. Add column to catalog.attributes
ALTER TABLE catalog.attributes
    ADD COLUMN IF NOT EXISTS visible_on_receipt boolean NOT NULL DEFAULT true;

-- 2. Toggle function
CREATE OR REPLACE FUNCTION catalog.set_attribute_visible_on_receipt(
    p_session_token text,
    p_attribute_id bigint,
    p_visible_on_receipt boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    UPDATE catalog.attributes
    SET visible_on_receipt = p_visible_on_receipt
    WHERE id = p_attribute_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'attribute % not found', p_attribute_id USING ERRCODE = '22023';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION catalog.set_attribute_visible_on_receipt(text, bigint, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog.set_attribute_visible_on_receipt(text, bigint, boolean) TO stockiha_runtime;

-- 3. Update catalog.list_attributes_v2 to return visible_on_receipt
DROP FUNCTION IF EXISTS catalog.list_attributes_v2(text);

CREATE FUNCTION catalog.list_attributes_v2(p_session_token text)
RETURNS TABLE(
    id bigint,
    name text,
    is_active boolean,
    visible_on_receipt boolean,
    usage_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);
    RETURN QUERY
        SELECT a.id, a.name, a.is_active, a.visible_on_receipt,
               (SELECT count(*) FROM catalog.attribute_values av WHERE av.attribute_id = a.id)
        FROM catalog.attributes a
        ORDER BY a.name;
END;
$$;

REVOKE ALL ON FUNCTION catalog.list_attributes_v2(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog.list_attributes_v2(text) TO stockiha_runtime;

-- 4. Update catalog.list_products_v2 to include visible_on_receipt in attributes jsonb
CREATE OR REPLACE FUNCTION catalog.list_products_v2(
    p_session_token text,
    p_warehouse_id bigint,
    p_category_id bigint DEFAULT NULL,
    p_brand_id bigint DEFAULT NULL,
    p_search text DEFAULT NULL,
    p_include_inactive boolean DEFAULT false,
    p_limit integer DEFAULT 100,
    p_offset integer DEFAULT 0
)
RETURNS TABLE(
    product_id bigint,
    variant_id bigint,
    sku text,
    product_name text,
    variant_name text,
    primary_barcode text,
    display_identifier text,
    identifier_type text,
    sale_price numeric,
    minimum_stock numeric,
    is_active boolean,
    product_is_active boolean,
    category_id bigint,
    category_name text,
    brand_id bigint,
    brand_name text,
    quantity_on_hand numeric,
    last_known_wac numeric,
    attributes jsonb,
    total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_limit   integer;
    v_offset  integer;
    v_search  text;
    v_pattern text;
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);

    v_limit  := LEAST(GREATEST(coalesce(p_limit, 100), 1), 100);
    v_offset := GREATEST(coalesce(p_offset, 0), 0);
    v_search := NULLIF(btrim(coalesce(p_search, '')), '');

    v_pattern := CASE WHEN v_search IS NOT NULL
        THEN '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
        ELSE NULL
    END;

    RETURN QUERY
    WITH matched_variants AS (
        SELECT v.id AS variant_id
        FROM catalog.product_variants v
        WHERE v_search IS NOT NULL AND v.sku ILIKE v_pattern ESCAPE '\'
        UNION
        SELECT v.id
        FROM catalog.product_variants v
        WHERE v_search IS NOT NULL AND coalesce(v.name_override, '') ILIKE v_pattern ESCAPE '\'
        UNION
        SELECT v.id
        FROM catalog.product_variants v
        JOIN catalog.products p ON p.id = v.product_id
        WHERE v_search IS NOT NULL AND p.name ILIKE v_pattern ESCAPE '\'
        UNION
        SELECT b.variant_id
        FROM catalog.variant_barcodes b
        WHERE v_search IS NOT NULL AND b.barcode ILIKE v_pattern ESCAPE '\'
        UNION
        SELECT vav.variant_id
        FROM catalog.variant_attribute_values vav
        JOIN catalog.attribute_values av ON av.id = vav.attribute_value_id
        WHERE v_search IS NOT NULL AND av.value ILIKE v_pattern ESCAPE '\'
    ),
    base AS (
        SELECT
            p.id AS product_id,
            v.id AS variant_id,
            v.sku,
            p.name AS product_name,
            catalog._effective_variant_name(v.id) AS variant_name,
            bp.barcode AS primary_barcode,
            coalesce(bp.barcode, v.sku) AS display_identifier,
            CASE WHEN bp.barcode IS NOT NULL THEN 'BARCODE' ELSE 'SKU' END AS identifier_type,
            v.sale_price,
            v.minimum_stock,
            v.is_active,
            p.is_active AS product_is_active,
            p.category_id,
            cat.name AS category_name,
            p.brand_id,
            br.name AS brand_name,
            coalesce(pos.quantity_on_hand, 0)::numeric AS quantity_on_hand,
            coalesce(pos.last_known_wac, 0)::numeric AS last_known_wac
        FROM catalog.product_variants v
        JOIN catalog.products p ON p.id = v.product_id
        LEFT JOIN catalog.categories cat ON cat.id = p.category_id
        LEFT JOIN catalog.brands br ON br.id = p.brand_id
        LEFT JOIN catalog.variant_barcodes bp ON bp.variant_id = v.id AND bp.is_primary = true
        LEFT JOIN inventory.positions pos ON pos.variant_id = v.id AND pos.warehouse_id = p_warehouse_id
        WHERE (p_include_inactive OR (v.is_active AND p.is_active))
          AND (p_category_id IS NULL OR p.category_id = p_category_id)
          AND (p_brand_id IS NULL OR p.brand_id = p_brand_id)
          AND (v_search IS NULL OR v.id IN (SELECT mv.variant_id FROM matched_variants mv))
    ),
    counted AS (
        SELECT b.*, count(*) OVER () AS total_count FROM base b
    ),
    paged AS (
        SELECT * FROM counted
        ORDER BY product_name, variant_name, variant_id
        LIMIT v_limit OFFSET v_offset
    )
    SELECT
        pg.product_id, pg.variant_id, pg.sku, pg.product_name, pg.variant_name,
        pg.primary_barcode, pg.display_identifier, pg.identifier_type,
        pg.sale_price, pg.minimum_stock, pg.is_active, pg.product_is_active,
        pg.category_id, pg.category_name, pg.brand_id, pg.brand_name,
        pg.quantity_on_hand, pg.last_known_wac,
        coalesce((
            SELECT jsonb_agg(
                jsonb_build_object(
                    'name', a.name,
                    'value', av.value,
                    'visible_on_receipt', a.visible_on_receipt
                )
                ORDER BY a.id, av.id
            )
            FROM catalog.variant_attribute_values vav
            JOIN catalog.attribute_values av ON av.id = vav.attribute_value_id
            JOIN catalog.attributes a ON a.id = av.attribute_id
            WHERE vav.variant_id = pg.variant_id
        ), '[]'::jsonb) AS attributes,
        pg.total_count
    FROM paged pg;
END;
$$;

REVOKE ALL ON FUNCTION catalog.list_products_v2(text, bigint, bigint, bigint, text, boolean, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog.list_products_v2(text, bigint, bigint, bigint, text, boolean, integer, integer) TO stockiha_runtime;

RESET ROLE;
