-- =============================================================================
-- WS-D-CORRECTION-1 (re-scoped) — remove Brand as a product-level reference
-- concept from WS-D's own surface only. Brand becomes an ordinary
-- variant-level Attribute, created and managed through the Attributes tab
-- D-3 already built (catalog.attributes / catalog.attribute_values) — no new
-- mechanism is added here, this migration is entirely subtractive.
--
-- catalog.brands and catalog.products.brand_id are DELIBERATELY NOT dropped
-- and NOT altered by this migration. procurement.list_purchase_product_options
-- and procurement.post_purchase_transaction (owned by WS-E, last defined in
-- 20260814170000_repair_purchase_transaction_contract.sql and
-- 20260814190000_make_purchase_hashing_pg18_native.sql respectively) both
-- LEFT JOIN catalog.brands directly and remain unmodified; the latter is a
-- write path that snapshots the brand name on every purchase transaction
-- post. Dropping the table or column would break both at their next
-- invocation. This is a documented, deliberate leftover for a future
-- WS-E-scoped task to resolve, not something this migration touches.
--
-- Pre-check (informational only — no data is at risk here since brand_id
-- the column is untouched; run for visibility per the task brief):
-- =============================================================================
DO $$
DECLARE
    v_brand_products bigint;
BEGIN
    SELECT count(*) INTO v_brand_products FROM catalog.products WHERE brand_id IS NOT NULL;
    RAISE NOTICE 'catalog.products rows with brand_id IS NOT NULL at migration time: %', v_brand_products;
END;
$$;

-- =============================================================================
-- 1. Drop WS-D's own Brand reference-data lifecycle. These are exclusively
--    WS-D's functions (Catalogue Setup's Brands tab, D-1/D-2); procurement
--    never calls any of them, it only ever does a raw LEFT JOIN against the
--    table directly. Dropping these five is safe.
-- =============================================================================
DROP FUNCTION IF EXISTS catalog.list_brands(text);
DROP FUNCTION IF EXISTS catalog.create_brand(text, text, text);
DROP FUNCTION IF EXISTS catalog.rename_brand(text, bigint, text, text);
DROP FUNCTION IF EXISTS catalog.set_brand_active(text, bigint, boolean);
DROP FUNCTION IF EXISTS catalog.delete_brand(text, bigint);

-- =============================================================================
-- 2. Narrow catalog.quick_create_product: drop p_brand_id and the insert of
--    brand_id into catalog.products (the column stays; new products are
--    simply created with brand_id NULL, which the column already allows).
--    Signature changes (9 args -> 8 args) so the old overload is dropped
--    explicitly rather than relying on CREATE OR REPLACE, which only
--    replaces a function of the exact same argument types.
-- =============================================================================
DROP FUNCTION IF EXISTS catalog.quick_create_product(text, text, bigint, numeric, bigint, bigint, text, numeric, boolean);

CREATE FUNCTION catalog.quick_create_product(
    p_session_token text,
    p_name text,
    p_unit_id bigint,
    p_sale_price numeric,
    p_category_id bigint DEFAULT NULL,
    p_barcode text DEFAULT NULL,
    p_minimum_stock numeric DEFAULT 0,
    p_is_active boolean DEFAULT true
)
RETURNS TABLE(product_id bigint, variant_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_product_id bigint;
    v_variant_id bigint;
    v_sku        text;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');

    IF btrim(coalesce(p_name, '')) = '' THEN
        RAISE EXCEPTION 'product name must not be blank' USING ERRCODE = '22023';
    END IF;
    PERFORM 1 FROM catalog.units WHERE id = p_unit_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'unit % not found', p_unit_id USING ERRCODE = '22023';
    END IF;
    IF p_sale_price IS NULL OR p_sale_price < 0 THEN
        RAISE EXCEPTION 'sale price must not be negative' USING ERRCODE = '22023';
    END IF;
    IF coalesce(p_minimum_stock, 0) < 0 THEN
        RAISE EXCEPTION 'minimum stock must not be negative' USING ERRCODE = '22023';
    END IF;
    IF p_category_id IS NOT NULL THEN
        PERFORM 1 FROM catalog.categories WHERE id = p_category_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'category % not found', p_category_id USING ERRCODE = '22023';
        END IF;
    END IF;

    -- Fail fast on a duplicate barcode before creating anything. Not
    -- strictly required for correctness -- an unhandled exception from
    -- catalog._insert_barcode below would abort this whole function call
    -- and roll back the product/variant inserts too, since there is no
    -- exception block here to catch it -- but this avoids the wasted work
    -- and gives the clearest possible error.
    IF p_barcode IS NOT NULL AND btrim(p_barcode) <> '' THEN
        PERFORM 1 FROM catalog.variant_barcodes WHERE normalized_barcode = upper(btrim(p_barcode));
        IF FOUND THEN
            RAISE EXCEPTION 'barcode % is already registered in the system', p_barcode USING ERRCODE = '22023';
        END IF;
    END IF;

    INSERT INTO catalog.products (name, unit_id, category_id, is_active)
        VALUES (btrim(p_name), p_unit_id, p_category_id, coalesce(p_is_active, true))
        RETURNING id INTO v_product_id;

    v_sku := catalog._generate_sku();
    INSERT INTO catalog.product_variants (
        product_id, sku, sale_price, base_unit_id, attribute_signature, is_active, minimum_stock
    ) VALUES (
        v_product_id, v_sku, p_sale_price, p_unit_id, '', coalesce(p_is_active, true), coalesce(p_minimum_stock, 0)
    ) RETURNING id INTO v_variant_id;

    IF p_barcode IS NOT NULL AND btrim(p_barcode) <> '' THEN
        PERFORM catalog._insert_barcode(v_variant_id, p_barcode, true);
    END IF;

    RETURN QUERY SELECT v_product_id, v_variant_id;
END;
$$;

-- =============================================================================
-- 3. Narrow catalog.list_products_v2: drop p_brand_id filter, the
--    LEFT JOIN catalog.brands, and brand_id/brand_name from the returned
--    columns (18 columns now, was 20). This is WS-D's own read path, wholly
--    independent of procurement.list_purchase_product_options (a different
--    function, different schema, different shape, owned by WS-E) — verified
--    distinct before touching either.
-- =============================================================================
DROP FUNCTION IF EXISTS catalog.list_products_v2(text, bigint, text, bigint, bigint, boolean, integer, integer);

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

    -- A literal '%' or '_' typed by the user must match literally, not act
    -- as an ILIKE wildcard (e.g. searching "50% cotton" or "A_B"). Escape
    -- backslash first, then the two wildcard characters, and pair every
    -- ILIKE below with ESCAPE '\' so the escaping actually takes effect.
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

-- =============================================================================
-- 4. Narrow the 7-arg catalog.update_product to drop p_brand_id only —
--    p_category_id stays (Category is out of scope for this correction).
--    Signature changes (7 args -> 6 args) so the old overload is dropped
--    explicitly. The unrelated 4-arg and 5-arg overloads (pre-D-1) are left
--    completely untouched.
-- =============================================================================
DROP FUNCTION IF EXISTS catalog.update_product(text, bigint, text, bigint, boolean, bigint, bigint);

CREATE FUNCTION catalog.update_product(
    p_session_token text,
    p_product_id bigint,
    p_name text,
    p_unit_id bigint,
    p_is_active boolean,
    p_category_id bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_curr_unit bigint;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    SELECT unit_id INTO v_curr_unit FROM catalog.products WHERE id = p_product_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'product % not found', p_product_id USING ERRCODE = '22023';
    END IF;
    IF btrim(coalesce(p_name, '')) = '' THEN
        RAISE EXCEPTION 'product name must not be blank' USING ERRCODE = '22023';
    END IF;
    PERFORM 1 FROM catalog.units WHERE id = p_unit_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'unit % not found', p_unit_id USING ERRCODE = '22023';
    END IF;
    IF p_category_id IS NOT NULL THEN
        PERFORM 1 FROM catalog.categories WHERE id = p_category_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'category % not found', p_category_id USING ERRCODE = '22023';
        END IF;
    END IF;

    IF p_unit_id <> v_curr_unit AND catalog._product_has_stock_history(p_product_id) THEN
        RAISE EXCEPTION 'This product''s unit cannot be changed because stock transactions already exist.'
            USING ERRCODE = '55000';
    END IF;

    UPDATE catalog.products
        SET name = btrim(p_name), unit_id = p_unit_id, is_active = p_is_active,
            category_id = p_category_id
        WHERE id = p_product_id;
    UPDATE catalog.product_variants SET base_unit_id = p_unit_id WHERE product_id = p_product_id;

    IF NOT p_is_active THEN
        UPDATE catalog.product_variants SET is_active = false WHERE product_id = p_product_id AND is_active;
    END IF;
END;
$$;

-- =============================================================================
-- Grants -- nothing to PUBLIC, EXECUTE to stockiha_runtime only. A replaced
-- function loses its grants (ws-d-skill.md section 4 item 4), so these must
-- be re-issued for every function created above with a new signature.
-- =============================================================================
REVOKE ALL ON FUNCTION catalog.quick_create_product(text, text, bigint, numeric, bigint, text, numeric, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog.list_products_v2(text, bigint, text, bigint, boolean, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog.update_product(text, bigint, text, bigint, boolean, bigint) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION catalog.quick_create_product(text, text, bigint, numeric, bigint, text, numeric, boolean) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.list_products_v2(text, bigint, text, bigint, boolean, integer, integer) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.update_product(text, bigint, text, bigint, boolean, bigint) TO stockiha_runtime;
