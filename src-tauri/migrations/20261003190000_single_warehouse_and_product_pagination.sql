-- Stockiha — WS-O Follow-up: Single Warehouse Consolidation and Product-Level Catalog Pagination
-- Migration: 20261003190000_single_warehouse_and_product_pagination.sql

-- 1. Consolidate inventory positions from secondary warehouses into Warehouse 1 (Main Warehouse)
DO $$
DECLARE
    r RECORD;
    v_wh1_qty numeric;
    v_wh1_val numeric;
    v_wh1_wac numeric;
    v_new_qty numeric;
    v_new_val numeric;
    v_new_wac numeric;
BEGIN
    FOR r IN SELECT id, variant_id, warehouse_id, quantity_on_hand, total_value, last_known_wac 
             FROM inventory.positions 
             WHERE warehouse_id <> 1
    LOOP
        IF EXISTS (SELECT 1 FROM inventory.positions WHERE variant_id = r.variant_id AND warehouse_id = 1) THEN
            SELECT quantity_on_hand, total_value, last_known_wac 
            INTO v_wh1_qty, v_wh1_val, v_wh1_wac 
            FROM inventory.positions 
            WHERE variant_id = r.variant_id AND warehouse_id = 1;

            v_new_qty := coalesce(v_wh1_qty, 0) + coalesce(r.quantity_on_hand, 0);
            v_new_val := coalesce(v_wh1_val, 0) + coalesce(r.total_value, 0);
            
            IF v_new_qty > 0 THEN
                v_new_wac := v_new_val / v_new_qty;
            ELSE
                v_new_wac := coalesce(v_wh1_wac, r.last_known_wac, 0);
            END IF;

            UPDATE inventory.positions 
            SET quantity_on_hand = v_new_qty,
                total_value = v_new_val,
                last_known_wac = v_new_wac
            WHERE variant_id = r.variant_id AND warehouse_id = 1;

            DELETE FROM inventory.positions 
            WHERE id = r.id;
        ELSE
            UPDATE inventory.positions 
            SET warehouse_id = 1 
            WHERE id = r.id;
        END IF;
    END LOOP;

    -- Deactivate secondary warehouses so only Warehouse 1 is active
    UPDATE inventory.warehouses SET is_active = false WHERE id <> 1;
END;
$$;

-- 2. Drop obsolete 8-param overloads
DROP FUNCTION IF EXISTS catalog.list_products_v2(text, bigint, text, bigint, bigint, boolean, integer, integer);
DROP FUNCTION IF EXISTS catalog.list_products_v2(text, bigint, bigint, bigint, text, boolean, integer, integer);
DROP FUNCTION IF EXISTS catalog.list_products_v2(text, bigint, text, bigint, boolean, integer, integer);

-- 3. Product-level paginated list_products_v2 (7 parameters, matching Rust and ws_d_002)
CREATE FUNCTION catalog.list_products_v2(
    p_session_token text,
    p_warehouse_id bigint,
    p_search text DEFAULT NULL,
    p_category_id bigint DEFAULT NULL,
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

    -- Server-side pagination cap: never trust the client's limit.
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
            coalesce(pos.quantity_on_hand, 0)::numeric AS quantity_on_hand,
            coalesce(pos.last_known_wac, 0)::numeric AS last_known_wac
        FROM catalog.product_variants v
        JOIN catalog.products p ON p.id = v.product_id
        LEFT JOIN catalog.categories cat ON cat.id = p.category_id
        LEFT JOIN catalog.variant_barcodes bp ON bp.variant_id = v.id AND bp.is_primary = true
        LEFT JOIN inventory.positions pos ON pos.variant_id = v.id AND pos.warehouse_id = p_warehouse_id
        WHERE (p_include_inactive OR (v.is_active AND p.is_active))
          AND (p_category_id IS NULL OR p.category_id = p_category_id)
          AND (v_search IS NULL OR v.id IN (SELECT mv.variant_id FROM matched_variants mv))
    ),
    matched_products AS (
        SELECT DISTINCT b_inner.product_id, b_inner.product_name
        FROM base b_inner
    ),
    paged_products AS (
        SELECT mp.product_id, count(*) OVER () AS total_product_count
        FROM matched_products mp
        ORDER BY mp.product_name, mp.product_id
        LIMIT v_limit OFFSET v_offset
    ),
    paged AS (
        SELECT b.*, pp.total_product_count AS total_count
        FROM base b
        JOIN paged_products pp ON pp.product_id = b.product_id
        ORDER BY b.product_name, b.variant_name, b.variant_id
    )
    SELECT
        pg.product_id, pg.variant_id, pg.sku, pg.product_name, pg.variant_name,
        pg.primary_barcode, pg.display_identifier, pg.identifier_type,
        pg.sale_price, pg.minimum_stock, pg.is_active, pg.product_is_active,
        pg.category_id, pg.category_name,
        pg.quantity_on_hand, pg.last_known_wac,
        coalesce((
            SELECT jsonb_agg(jsonb_build_object('name', a.name, 'value', av.value) ORDER BY a.id, av.id)
            FROM catalog.variant_attribute_values vav
            JOIN catalog.attribute_values av ON av.id = vav.attribute_value_id
            JOIN catalog.attributes a ON a.id = av.attribute_id
            WHERE vav.variant_id = pg.variant_id
        ), '[]'::jsonb) AS attributes,
        pg.total_count
    FROM paged pg
    ORDER BY pg.product_name, pg.variant_name, pg.variant_id;
END;
$$;

REVOKE ALL ON FUNCTION catalog.list_products_v2(text, bigint, text, bigint, boolean, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog.list_products_v2(text, bigint, text, bigint, boolean, integer, integer) TO stockiha_runtime;

UPDATE operations.schema_state SET migration_version = 20261003190000, updated_at = now() WHERE singleton;
