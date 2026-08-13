-- Migration: 20260813180000_catalog_identity_and_sku_redesign.sql
-- Stockiha Catalog Redesign: Product owns Unit, Variant optional Name Override,
-- Auto-generated SKU, Barcode operational identity, Removal of Reference Cost & Variant Unit.
SET ROLE stockiha_owner;

-- 1. Create sequence for auto-SKU generation if not exists
CREATE SEQUENCE IF NOT EXISTS catalog.variant_sku_seq START WITH 1;

-- Initialize sequence safely above existing numeric SKUs
DO $$
DECLARE
    v_max bigint;
BEGIN
    SELECT coalesce(max(substring(sku from 'SKU-([0-9]+)')::bigint), 0)
        INTO v_max
        FROM catalog.product_variants
        WHERE sku ~ '^SKU-[0-9]+$';
    IF v_max > 0 THEN
        PERFORM setval('catalog.variant_sku_seq', v_max + 1, false);
    END IF;
END $$;

-- 2. Helper function to generate Stockiha SKU
CREATE OR REPLACE FUNCTION catalog._generate_sku() RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
    RETURN 'SKU-' || lpad(nextval('catalog.variant_sku_seq')::text, 8, '0');
END;
$$;

-- 3. Add unit_id to catalog.products
ALTER TABLE catalog.products ADD COLUMN IF NOT EXISTS unit_id bigint REFERENCES catalog.units(id);

-- Migrate legacy unit ownership from variants to products
DO $$
DECLARE
    r RECORD;
    v_unit_cnt integer;
    v_unit_id bigint;
BEGIN
    FOR r IN SELECT id, name FROM catalog.products LOOP
        SELECT count(DISTINCT base_unit_id), min(base_unit_id)
            INTO v_unit_cnt, v_unit_id
            FROM catalog.product_variants
            WHERE product_id = r.id;
        
        IF v_unit_cnt > 1 THEN
            RAISE EXCEPTION 'Product % (%) has variants with conflicting units! Migration aborted.', r.id, r.name;
        ELSIF v_unit_cnt = 1 THEN
            UPDATE catalog.products SET unit_id = v_unit_id WHERE id = r.id;
        ELSE
            -- No variants yet; assign first catalog unit if available
            SELECT id INTO v_unit_id FROM catalog.units ORDER BY id LIMIT 1;
            IF v_unit_id IS NOT NULL THEN
                UPDATE catalog.products SET unit_id = v_unit_id WHERE id = r.id;
            END IF;
        END IF;
    END LOOP;
END $$;

-- Enforce unit_id NOT NULL on products if any units exist
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM catalog.units) THEN
        -- Assign default unit for any unassigned product
        UPDATE catalog.products SET unit_id = (SELECT id FROM catalog.units ORDER BY id LIMIT 1) WHERE unit_id IS NULL;
        ALTER TABLE catalog.products ALTER COLUMN unit_id SET NOT NULL;
    END IF;
END $$;

-- 4. Add name_override to catalog.product_variants & remove reference_cost if present
ALTER TABLE catalog.product_variants ADD COLUMN IF NOT EXISTS name_override text NULL;
ALTER TABLE catalog.product_variants DROP COLUMN IF EXISTS reference_cost;

-- 5. Add is_primary to catalog.variant_barcodes & partial unique index
ALTER TABLE catalog.variant_barcodes ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE schemaname = 'catalog' AND indexname = 'variant_barcodes_primary_unique'
    ) THEN
        -- Mark lowest barcode ID per variant as primary for backfill
        UPDATE catalog.variant_barcodes b
            SET is_primary = true
            WHERE b.id = (
                SELECT min(b2.id) FROM catalog.variant_barcodes b2 WHERE b2.variant_id = b.variant_id
            );
        CREATE UNIQUE INDEX variant_barcodes_primary_unique
            ON catalog.variant_barcodes (variant_id)
            WHERE is_primary = true;
    END IF;
END $$;

-- 6. Helper to compute effective variant name deterministically
CREATE OR REPLACE FUNCTION catalog._effective_variant_name(p_variant_id bigint) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    v_product_name text;
    v_override text;
    v_attr_str text;
BEGIN
    SELECT p.name, v.name_override
        INTO v_product_name, v_override
        FROM catalog.product_variants v
        JOIN catalog.products p ON p.id = v.product_id
        WHERE v.id = p_variant_id;

    IF btrim(coalesce(v_override, '')) <> '' THEN
        RETURN btrim(v_override);
    END IF;

    SELECT string_agg(av.value, ' · ' ORDER BY a.id, av.id)
        INTO v_attr_str
        FROM catalog.variant_attribute_values vav
        JOIN catalog.attribute_values av ON av.id = vav.attribute_value_id
        JOIN catalog.attributes a ON a.id = av.attribute_id
        WHERE vav.variant_id = p_variant_id;

    IF v_attr_str IS NOT NULL AND btrim(v_attr_str) <> '' THEN
        RETURN v_product_name || ' · ' || v_attr_str;
    ELSE
        RETURN v_product_name;
    END IF;
END;
$$;

-- 7. Barcode insertion helper
CREATE OR REPLACE FUNCTION catalog._insert_barcode(
    p_variant_id bigint, p_barcode text, p_is_primary boolean DEFAULT false
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    v_norm text;
    v_id   bigint;
    v_has_primary boolean;
BEGIN
    v_norm := upper(btrim(coalesce(p_barcode, '')));
    IF v_norm = '' THEN
        RAISE EXCEPTION 'barcode must not be blank' USING ERRCODE = '22023';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM catalog.variant_barcodes WHERE variant_id = p_variant_id AND is_primary = true
    ) INTO v_has_primary;

    BEGIN
        INSERT INTO catalog.variant_barcodes (variant_id, barcode, normalized_barcode, is_primary)
            VALUES (p_variant_id, btrim(p_barcode), v_norm, coalesce(p_is_primary, NOT v_has_primary))
            RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'barcode % is already registered in the system', p_barcode
            USING ERRCODE = '22023';
    END;

    RETURN v_id;
END;
$$;

-- 8. Internal variant creation helper
CREATE OR REPLACE FUNCTION catalog._insert_variant(
    p_product_id bigint, p_variant jsonb
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    v_sku        text;
    v_price      numeric;
    v_active     boolean;
    v_name       text;
    v_variant_id bigint;
    v_attr_ids   bigint[];
    v_attr_id    bigint;
    v_barcode    text;
    v_product_unit bigint;
    v_sig        text;
BEGIN
    SELECT unit_id INTO v_product_unit FROM catalog.products WHERE id = p_product_id;
    IF v_product_unit IS NULL THEN
        RAISE EXCEPTION 'product % has no assigned unit', p_product_id USING ERRCODE = '22023';
    END IF;

    v_sku := catalog._generate_sku();
    v_name := NULLIF(btrim(coalesce(p_variant ->> 'name_override', '')), '');

    IF NOT (p_variant ? 'sale_price') OR (p_variant ->> 'sale_price') IS NULL THEN
        RAISE EXCEPTION 'variant sale_price is required' USING ERRCODE = '22023';
    END IF;
    v_price := (p_variant ->> 'sale_price')::numeric;
    IF v_price < 0 THEN
        RAISE EXCEPTION 'sale price must not be negative' USING ERRCODE = '22023';
    END IF;

    v_active := coalesce((p_variant ->> 'is_active')::boolean, true);

    IF p_variant ? 'attribute_value_ids' AND jsonb_typeof(p_variant -> 'attribute_value_ids') = 'array' THEN
        SELECT array_agg(DISTINCT elem::bigint ORDER BY elem::bigint)
            INTO v_attr_ids
            FROM jsonb_array_elements_text(p_variant -> 'attribute_value_ids') AS elem;
    END IF;

    v_sig := catalog.compute_attribute_signature(v_attr_ids);

    PERFORM 1 FROM catalog.product_variants
        WHERE product_id = p_product_id AND attribute_signature = v_sig;
    IF FOUND THEN
        RAISE EXCEPTION 'a variant with this attribute combination already exists for this product'
            USING ERRCODE = '22023';
    END IF;

    INSERT INTO catalog.product_variants (
        product_id, sku, name_override, sale_price, base_unit_id, attribute_signature, is_active
    ) VALUES (
        p_product_id, v_sku, v_name, v_price, v_product_unit, v_sig, v_active
    ) RETURNING id INTO v_variant_id;

    IF v_attr_ids IS NOT NULL THEN
        FOREACH v_attr_id IN ARRAY v_attr_ids LOOP
            INSERT INTO catalog.variant_attribute_values (variant_id, attribute_value_id)
                VALUES (v_variant_id, v_attr_id);
        END LOOP;
    END IF;

    IF p_variant ? 'barcodes' AND jsonb_typeof(p_variant -> 'barcodes') = 'array' THEN
        FOR v_barcode IN SELECT jsonb_array_elements_text(p_variant -> 'barcodes') LOOP
            PERFORM catalog._insert_barcode(v_variant_id, v_barcode);
        END LOOP;
    END IF;

    RETURN v_variant_id;
END;
$$;

-- 9. Public product creation with variants
CREATE OR REPLACE FUNCTION catalog.create_product_with_variants(
    p_session_token text, p_name text, p_unit_id bigint, p_is_active boolean, p_variants jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    v_product_id bigint;
    v_variant    jsonb;
    v_variant_id bigint;
    v_ids        jsonb := '[]'::jsonb;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    IF btrim(coalesce(p_name, '')) = '' THEN
        RAISE EXCEPTION 'product name must not be blank' USING ERRCODE = '22023';
    END IF;
    IF p_unit_id IS NULL THEN
        RAISE EXCEPTION 'product unit_id is required' USING ERRCODE = '22023';
    END IF;
    PERFORM 1 FROM catalog.units WHERE id = p_unit_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'unit % not found', p_unit_id USING ERRCODE = '22023';
    END IF;

    IF p_variants IS NULL OR jsonb_array_length(p_variants) < 1 THEN
        RAISE EXCEPTION 'a product requires at least one variant' USING ERRCODE = '22023';
    END IF;

    INSERT INTO catalog.products (name, unit_id, is_active)
        VALUES (btrim(p_name), p_unit_id, coalesce(p_is_active, true)) RETURNING id INTO v_product_id;

    FOR v_variant IN SELECT * FROM jsonb_array_elements(p_variants) LOOP
        v_variant_id := catalog._insert_variant(v_product_id, v_variant);
        v_ids := v_ids || to_jsonb(v_variant_id);
    END LOOP;

    RETURN jsonb_build_object('product_id', v_product_id, 'variant_ids', v_ids);
END;
$$;

-- 10. Add variant to existing product
CREATE OR REPLACE FUNCTION catalog.add_variant(
    p_session_token text, p_product_id bigint, p_variant jsonb
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    PERFORM 1 FROM catalog.products WHERE id = p_product_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'product % not found', p_product_id USING ERRCODE = '22023';
    END IF;
    RETURN catalog._insert_variant(p_product_id, p_variant);
END;
$$;

-- 11. Update variant core fields (name_override, sale_price, is_active)
CREATE OR REPLACE FUNCTION catalog.update_variant(
    p_session_token text, p_variant_id bigint, p_name_override text,
    p_sale_price numeric, p_is_active boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    v_product_id bigint;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    SELECT product_id INTO v_product_id FROM catalog.product_variants WHERE id = p_variant_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'variant % not found', p_variant_id USING ERRCODE = '22023';
    END IF;
    IF p_sale_price < 0 THEN
        RAISE EXCEPTION 'sale price must not be negative' USING ERRCODE = '22023';
    END IF;
    IF p_is_active THEN
        PERFORM 1 FROM catalog.products WHERE id = v_product_id AND is_active;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'cannot activate a variant of an inactive product' USING ERRCODE = '55000';
        END IF;
    END IF;

    UPDATE catalog.product_variants
        SET name_override = NULLIF(btrim(p_name_override), ''),
            sale_price = p_sale_price,
            is_active = p_is_active
        WHERE id = p_variant_id;
END;
$$;

-- 12. Update product (name, unit_id, is_active) with history protection for unit changes
CREATE OR REPLACE FUNCTION catalog.update_product(
    p_session_token text, p_product_id bigint, p_name text, p_unit_id bigint, p_is_active boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    v_curr_unit bigint;
    v_has_history boolean;
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

    -- History protection: block unit change if stock/purchase/sales/returns history exists
    IF p_unit_id <> v_curr_unit THEN
        SELECT (
            EXISTS (
                SELECT 1 FROM inventory.positions pos
                JOIN catalog.product_variants pv ON pv.id = pos.variant_id
                WHERE pv.product_id = p_product_id AND (pos.quantity_on_hand <> 0 OR pos.total_value <> 0)
            ) OR EXISTS (
                SELECT 1 FROM inventory.movements m
                JOIN catalog.product_variants pv ON pv.id = m.variant_id
                WHERE pv.product_id = p_product_id
            ) OR EXISTS (
                SELECT 1 FROM sales.cash_sale_lines sl
                JOIN catalog.product_variants pv ON pv.id = sl.variant_id
                WHERE pv.product_id = p_product_id
            ) OR EXISTS (
                SELECT 1 FROM procurement.purchase_receipt_lines prl
                JOIN catalog.product_variants pv ON pv.id = prl.variant_id
                WHERE pv.product_id = p_product_id
            )
        ) INTO v_has_history;

        IF v_has_history THEN
            RAISE EXCEPTION 'This product''s unit cannot be changed because stock transactions already exist.'
                USING ERRCODE = '55000';
        END IF;
    END IF;

    UPDATE catalog.products SET name = btrim(p_name), unit_id = p_unit_id, is_active = p_is_active WHERE id = p_product_id;
    -- Keep product_variants.base_unit_id in sync
    UPDATE catalog.product_variants SET base_unit_id = p_unit_id WHERE product_id = p_product_id;

    IF NOT p_is_active THEN
        UPDATE catalog.product_variants SET is_active = false WHERE product_id = p_product_id AND is_active;
    END IF;
END;
$$;

-- 13. Add barcode with auto-primary promotion
CREATE OR REPLACE FUNCTION catalog.add_variant_barcode(
    p_session_token text, p_variant_id bigint, p_barcode text
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    PERFORM 1 FROM catalog.product_variants WHERE id = p_variant_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'variant % not found', p_variant_id USING ERRCODE = '22023';
    END IF;
    RETURN catalog._insert_barcode(p_variant_id, p_barcode);
END;
$$;

-- 14. Remove barcode with auto-promotion of next remaining barcode
CREATE OR REPLACE FUNCTION catalog.remove_variant_barcode(
    p_session_token text, p_barcode_id bigint
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    v_variant_id bigint;
    v_was_primary boolean;
    v_next_id bigint;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    SELECT variant_id, is_primary INTO v_variant_id, v_was_primary
        FROM catalog.variant_barcodes WHERE id = p_barcode_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'barcode % not found', p_barcode_id USING ERRCODE = '22023';
    END IF;

    DELETE FROM catalog.variant_barcodes WHERE id = p_barcode_id;

    IF v_was_primary THEN
        SELECT min(id) INTO v_next_id FROM catalog.variant_barcodes WHERE variant_id = v_variant_id;
        IF v_next_id IS NOT NULL THEN
            UPDATE catalog.variant_barcodes SET is_primary = true WHERE id = v_next_id;
        END IF;
    END IF;
END;
$$;

-- 15. Barcode / Identifier Resolver
CREATE OR REPLACE FUNCTION catalog.resolve_barcode(
    p_session_token text, p_identifier text
) RETURNS TABLE (
    variant_id bigint, product_id bigint, sku text, name_override text,
    effective_variant_name text, primary_barcode text, operational_identifier text,
    identifier_type text, product_name text, sale_price numeric, unit_id bigint,
    unit_code text, unit_name text, variant_is_active boolean, product_is_active boolean
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    v_norm text;
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);
    v_norm := upper(btrim(coalesce(p_identifier, '')));
    IF v_norm = '' THEN
        RETURN;
    END IF;

    -- 1. Try barcode match first
    RETURN QUERY
    SELECT v.id, p.id, v.sku, v.name_override, catalog._effective_variant_name(v.id),
           b_prim.barcode, coalesce(b_prim.barcode, v.sku),
           CASE WHEN b_prim.barcode IS NOT NULL THEN 'BARCODE' ELSE 'SKU' END,
           p.name, v.sale_price, u.id, u.code, u.name, v.is_active, p.is_active
    FROM catalog.variant_barcodes b
    JOIN catalog.product_variants v ON v.id = b.variant_id
    JOIN catalog.products p ON p.id = v.product_id
    JOIN catalog.units u ON u.id = p.unit_id
    LEFT JOIN catalog.variant_barcodes b_prim ON b_prim.variant_id = v.id AND b_prim.is_primary = true
    WHERE b.normalized_barcode = v_norm
    LIMIT 1;

    IF FOUND THEN RETURN; END IF;

    -- 2. Try SKU fallback match
    RETURN QUERY
    SELECT v.id, p.id, v.sku, v.name_override, catalog._effective_variant_name(v.id),
           b_prim.barcode, coalesce(b_prim.barcode, v.sku),
           CASE WHEN b_prim.barcode IS NOT NULL THEN 'BARCODE' ELSE 'SKU' END,
           p.name, v.sale_price, u.id, u.code, u.name, v.is_active, p.is_active
    FROM catalog.product_variants v
    JOIN catalog.products p ON p.id = v.product_id
    JOIN catalog.units u ON u.id = p.unit_id
    LEFT JOIN catalog.variant_barcodes b_prim ON b_prim.variant_id = v.id AND b_prim.is_primary = true
    WHERE upper(v.sku) = v_norm
    LIMIT 1;
END;
$$;

-- 16. Get product detail
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

    SELECT p.id, p.name, p.unit_id, u.code AS unit_code, u.name AS unit_name, p.is_active
        INTO v_prod
        FROM catalog.products p
        JOIN catalog.units u ON u.id = p.unit_id
        WHERE p.id = p_product_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'product % not found', p_product_id USING ERRCODE = '22023';
    END IF;

    FOR v_var IN
        SELECT v.id, v.sku, v.name_override, catalog._effective_variant_name(v.id) AS effective_name,
               v.sale_price, v.attribute_signature, v.is_active
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
            'barcodes', coalesce(v_barcodes, '[]'::jsonb)
        );
    END LOOP;

    RETURN jsonb_build_object(
        'product_id', v_prod.id,
        'name', v_prod.name,
        'unit_id', v_prod.unit_id,
        'unit_code', v_prod.unit_code,
        'unit_name', v_prod.unit_name,
        'is_active', v_prod.is_active,
        'variants', v_vars
    );
END;
$$;

-- 17. List catalog products
CREATE OR REPLACE FUNCTION catalog.list_catalog_products(
    p_session_token text, p_search text DEFAULT NULL
) RETURNS TABLE (
    product_id bigint, name text, unit_id bigint, unit_code text, unit_name text,
    is_active boolean, variant_count bigint, active_variant_count bigint
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    v_query text;
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);
    v_query := upper(btrim(coalesce(p_search, '')));

    RETURN QUERY
    SELECT p.id, p.name, p.unit_id, u.code, u.name, p.is_active,
           count(v.id)::bigint AS variant_count,
           count(v.id) FILTER (WHERE v.is_active)::bigint AS active_variant_count
    FROM catalog.products p
    JOIN catalog.units u ON u.id = p.unit_id
    LEFT JOIN catalog.product_variants v ON v.product_id = p.id
    WHERE v_query = '' OR upper(p.name) LIKE '%' || v_query || '%' OR EXISTS (
        SELECT 1 FROM catalog.product_variants v2
        WHERE v2.product_id = p.id AND (
            upper(v2.sku) LIKE '%' || v_query || '%' OR
            upper(coalesce(v2.name_override, '')) LIKE '%' || v_query || '%' OR
            EXISTS (
                SELECT 1 FROM catalog.variant_barcodes b
                WHERE b.variant_id = v2.id AND b.normalized_barcode LIKE '%' || v_query || '%'
            )
        )
    )
    GROUP BY p.id, p.name, p.unit_id, u.code, u.name, p.is_active
    ORDER BY p.name, p.id;
END;
$$;

-- Grant privileges to stockiha_runtime
GRANT EXECUTE ON FUNCTION catalog._generate_sku() TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog._effective_variant_name(bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.create_product_with_variants(text, text, bigint, boolean, jsonb) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.add_variant(text, bigint, jsonb) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.update_variant(text, bigint, text, numeric, boolean) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.update_product(text, bigint, text, bigint, boolean) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.add_variant_barcode(text, bigint, text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.remove_variant_barcode(text, bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.resolve_barcode(text, text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.get_product_detail(text, bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.list_catalog_products(text, text) TO stockiha_runtime;
