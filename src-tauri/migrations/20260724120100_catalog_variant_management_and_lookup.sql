-- S2-001: Catalog variant management + lookup functions.
--
-- All write paths are SECURITY DEFINER, owned by stockiha_owner, run with a
-- fixed trusted search_path (pg_catalog; every object reference is fully
-- schema-qualified), require the MANAGE_CATALOG permission via the existing
-- session resolver, and are granted EXECUTE only to stockiha_runtime. The
-- runtime role never writes catalog tables directly.
--
-- Active-state interaction: deactivating a product cascades to its variants,
-- and a variant cannot be activated while its product is inactive. Therefore
-- an inactive product never has an active variant, and the existing golden
-- chain functions (inventory.confirm_stock_receipt, sales.confirm_cash_sale),
-- which already reject inactive variants, remain correct and untouched.
SET ROLE stockiha_owner;

-- ===========================================================================
-- Internal helpers (owner-only; executed within SECURITY DEFINER context).
-- ===========================================================================

-- Deterministic attribute-combination signature from a set of value ids.
-- Validates existence, rejects duplicate values, and enforces one value per
-- attribute. Empty/NULL input yields '' (the "no attributes" signature).
CREATE FUNCTION catalog.compute_attribute_signature(p_attr_value_ids bigint[])
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
    v_signature   text;
    v_input_count integer;
    v_distinct    integer;
    v_found_count integer;
    v_attr_dupes  integer;
BEGIN
    IF p_attr_value_ids IS NULL OR array_length(p_attr_value_ids, 1) IS NULL THEN
        RETURN '';
    END IF;

    SELECT count(*), count(DISTINCT value_id)
        INTO v_input_count, v_distinct
        FROM unnest(p_attr_value_ids) AS value_id;
    IF v_input_count <> v_distinct THEN
        RAISE EXCEPTION 'duplicate attribute value supplied' USING ERRCODE = '22023';
    END IF;

    SELECT count(*) INTO v_found_count
        FROM catalog.attribute_values WHERE id = ANY (p_attr_value_ids);
    IF v_found_count <> v_input_count THEN
        RAISE EXCEPTION 'one or more attribute values do not exist' USING ERRCODE = '22023';
    END IF;

    SELECT count(*) INTO v_attr_dupes FROM (
        SELECT attribute_id
            FROM catalog.attribute_values
            WHERE id = ANY (p_attr_value_ids)
            GROUP BY attribute_id HAVING count(*) > 1
    ) dupes;
    IF v_attr_dupes > 0 THEN
        RAISE EXCEPTION 'a variant may select only one value per attribute' USING ERRCODE = '22023';
    END IF;

    SELECT string_agg(av.attribute_id || ':' || av.id, '|' ORDER BY av.attribute_id)
        INTO v_signature
        FROM catalog.attribute_values av WHERE av.id = ANY (p_attr_value_ids);
    RETURN coalesce(v_signature, '');
END;
$$;

-- Normalize + insert one barcode for a variant; returns the new barcode id.
CREATE FUNCTION catalog._insert_barcode(p_variant_id bigint, p_barcode text)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
    v_norm text;
    v_id   bigint;
BEGIN
    IF btrim(coalesce(p_barcode, '')) = '' THEN
        RAISE EXCEPTION 'barcode must not be blank' USING ERRCODE = '22023';
    END IF;
    v_norm := upper(btrim(p_barcode));
    BEGIN
        INSERT INTO catalog.variant_barcodes (variant_id, barcode, normalized_barcode)
            VALUES (p_variant_id, btrim(p_barcode), v_norm)
            RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'barcode % already exists', v_norm USING ERRCODE = '22023';
    END;
    RETURN v_id;
END;
$$;

-- Insert one variant (with base unit, attributes, alternate units, barcodes)
-- under an already-created/locked product. Returns the new variant id.
CREATE FUNCTION catalog._insert_variant(p_product_id bigint, p_variant jsonb)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
    v_sku         text;
    v_price       numeric;
    v_active      boolean;
    v_base_unit   bigint;
    v_attr_ids    bigint[];
    v_signature   text;
    v_variant_id  bigint;
    v_alt         jsonb;
    v_unit_id     bigint;
    v_factor      numeric;
    v_barcode     text;
BEGIN
    v_sku := btrim(coalesce(p_variant ->> 'sku', ''));
    IF v_sku = '' THEN
        RAISE EXCEPTION 'variant SKU must not be blank' USING ERRCODE = '22023';
    END IF;
    IF (p_variant ->> 'sale_price') IS NULL THEN
        RAISE EXCEPTION 'variant sale price is required' USING ERRCODE = '22023';
    END IF;
    v_price := (p_variant ->> 'sale_price')::numeric;
    IF v_price < 0 THEN
        RAISE EXCEPTION 'sale price must not be negative' USING ERRCODE = '22023';
    END IF;
    v_active := coalesce((p_variant ->> 'is_active')::boolean, true);

    IF (p_variant ->> 'base_unit_id') IS NOT NULL THEN
        v_base_unit := (p_variant ->> 'base_unit_id')::bigint;
        PERFORM 1 FROM catalog.units WHERE id = v_base_unit;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'base unit % not found', v_base_unit USING ERRCODE = '22023';
        END IF;
    ELSE
        SELECT id INTO v_base_unit FROM catalog.units WHERE normalized_code = 'UNIT';
    END IF;

    IF p_variant ? 'attribute_value_ids'
        AND jsonb_typeof(p_variant -> 'attribute_value_ids') = 'array' THEN
        SELECT array_agg(elem::bigint) INTO v_attr_ids
            FROM jsonb_array_elements_text(p_variant -> 'attribute_value_ids') elem;
    ELSE
        v_attr_ids := NULL;
    END IF;
    v_signature := catalog.compute_attribute_signature(v_attr_ids);

    BEGIN
        INSERT INTO catalog.product_variants
            (product_id, sku, sale_price, is_active, base_unit_id, attribute_signature)
            VALUES (p_product_id, v_sku, v_price, v_active, v_base_unit, v_signature)
            RETURNING id INTO v_variant_id;
    EXCEPTION WHEN unique_violation THEN
        IF EXISTS (SELECT 1 FROM catalog.product_variants WHERE sku = v_sku) THEN
            RAISE EXCEPTION 'a variant with SKU % already exists', v_sku USING ERRCODE = '22023';
        ELSE
            RAISE EXCEPTION 'a variant with the same attribute combination already exists for this product'
                USING ERRCODE = '22023';
        END IF;
    END;

    IF v_attr_ids IS NOT NULL THEN
        INSERT INTO catalog.variant_attribute_values (variant_id, attribute_id, attribute_value_id)
            SELECT v_variant_id, av.attribute_id, av.id
                FROM catalog.attribute_values av WHERE av.id = ANY (v_attr_ids);
    END IF;

    IF p_variant ? 'alternate_units'
        AND jsonb_typeof(p_variant -> 'alternate_units') = 'array' THEN
        FOR v_alt IN SELECT * FROM jsonb_array_elements(p_variant -> 'alternate_units')
        LOOP
            v_unit_id := (v_alt ->> 'unit_id')::bigint;
            v_factor := (v_alt ->> 'conversion_factor')::numeric;
            IF v_unit_id = v_base_unit THEN
                RAISE EXCEPTION 'alternate unit must differ from the base unit' USING ERRCODE = '22023';
            END IF;
            IF v_factor <= 0 THEN
                RAISE EXCEPTION 'conversion factor must be strictly positive' USING ERRCODE = '22023';
            END IF;
            PERFORM 1 FROM catalog.units WHERE id = v_unit_id;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'unit % not found', v_unit_id USING ERRCODE = '22023';
            END IF;
            BEGIN
                INSERT INTO catalog.variant_units (variant_id, unit_id, conversion_factor)
                    VALUES (v_variant_id, v_unit_id, v_factor);
            EXCEPTION WHEN unique_violation THEN
                RAISE EXCEPTION 'alternate unit % is already configured for this variant', v_unit_id
                    USING ERRCODE = '22023';
            END;
        END LOOP;
    END IF;

    IF p_variant ? 'barcodes' AND jsonb_typeof(p_variant -> 'barcodes') = 'array' THEN
        FOR v_barcode IN SELECT jsonb_array_elements_text(p_variant -> 'barcodes')
        LOOP
            PERFORM catalog._insert_barcode(v_variant_id, v_barcode);
        END LOOP;
    END IF;

    RETURN v_variant_id;
END;
$$;

-- ===========================================================================
-- Public write functions (SECURITY DEFINER, MANAGE_CATALOG).
-- ===========================================================================

CREATE FUNCTION catalog.create_product_with_variants(
    p_session_token text, p_name text, p_is_active boolean, p_variants jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
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
    IF p_variants IS NULL OR jsonb_array_length(p_variants) < 1 THEN
        RAISE EXCEPTION 'a product requires at least one variant' USING ERRCODE = '22023';
    END IF;

    INSERT INTO catalog.products (name, is_active)
        VALUES (btrim(p_name), coalesce(p_is_active, true)) RETURNING id INTO v_product_id;

    FOR v_variant IN SELECT * FROM jsonb_array_elements(p_variants)
    LOOP
        v_variant_id := catalog._insert_variant(v_product_id, v_variant);
        v_ids := v_ids || to_jsonb(v_variant_id);
    END LOOP;

    RETURN jsonb_build_object('product_id', v_product_id, 'variant_ids', v_ids);
END;
$$;

CREATE FUNCTION catalog.add_variant(
    p_session_token text, p_product_id bigint, p_variant jsonb
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    PERFORM 1 FROM catalog.products WHERE id = p_product_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'product % not found', p_product_id USING ERRCODE = '22023';
    END IF;
    RETURN catalog._insert_variant(p_product_id, p_variant);
END;
$$;

CREATE FUNCTION catalog.update_variant(
    p_session_token text, p_variant_id bigint, p_sku text,
    p_sale_price numeric, p_is_active boolean
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
    v_product_id bigint;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    SELECT product_id INTO v_product_id FROM catalog.product_variants WHERE id = p_variant_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'variant % not found', p_variant_id USING ERRCODE = '22023';
    END IF;
    IF btrim(coalesce(p_sku, '')) = '' THEN
        RAISE EXCEPTION 'variant SKU must not be blank' USING ERRCODE = '22023';
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
    BEGIN
        UPDATE catalog.product_variants
            SET sku = btrim(p_sku), sale_price = p_sale_price, is_active = p_is_active
            WHERE id = p_variant_id;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'a variant with SKU % already exists', btrim(p_sku) USING ERRCODE = '22023';
    END;
END;
$$;

CREATE FUNCTION catalog.set_variant_active(
    p_session_token text, p_variant_id bigint, p_is_active boolean
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
    v_product_id bigint;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    SELECT product_id INTO v_product_id FROM catalog.product_variants WHERE id = p_variant_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'variant % not found', p_variant_id USING ERRCODE = '22023';
    END IF;
    IF p_is_active THEN
        PERFORM 1 FROM catalog.products WHERE id = v_product_id AND is_active;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'cannot activate a variant of an inactive product' USING ERRCODE = '55000';
        END IF;
    END IF;
    UPDATE catalog.product_variants SET is_active = p_is_active WHERE id = p_variant_id;
END;
$$;

CREATE FUNCTION catalog.update_product(
    p_session_token text, p_product_id bigint, p_name text, p_is_active boolean
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    PERFORM 1 FROM catalog.products WHERE id = p_product_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'product % not found', p_product_id USING ERRCODE = '22023';
    END IF;
    IF btrim(coalesce(p_name, '')) = '' THEN
        RAISE EXCEPTION 'product name must not be blank' USING ERRCODE = '22023';
    END IF;
    UPDATE catalog.products SET name = btrim(p_name), is_active = p_is_active WHERE id = p_product_id;
    -- Cascade: an inactive product must never leave an active variant behind.
    IF NOT p_is_active THEN
        UPDATE catalog.product_variants SET is_active = false
            WHERE product_id = p_product_id AND is_active;
    END IF;
END;
$$;

CREATE FUNCTION catalog.create_attribute(p_session_token text, p_name text)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
    v_id bigint;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    IF btrim(coalesce(p_name, '')) = '' THEN
        RAISE EXCEPTION 'attribute name must not be blank' USING ERRCODE = '22023';
    END IF;
    INSERT INTO catalog.attributes (name, normalized_name)
        VALUES (btrim(p_name), lower(btrim(p_name)))
        ON CONFLICT (normalized_name) DO NOTHING;
    SELECT id INTO v_id FROM catalog.attributes WHERE normalized_name = lower(btrim(p_name));
    RETURN v_id;
END;
$$;

CREATE FUNCTION catalog.add_attribute_value(
    p_session_token text, p_attribute_id bigint, p_value text
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
    v_id bigint;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    PERFORM 1 FROM catalog.attributes WHERE id = p_attribute_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'attribute % not found', p_attribute_id USING ERRCODE = '22023';
    END IF;
    IF btrim(coalesce(p_value, '')) = '' THEN
        RAISE EXCEPTION 'attribute value must not be blank' USING ERRCODE = '22023';
    END IF;
    INSERT INTO catalog.attribute_values (attribute_id, value, normalized_value)
        VALUES (p_attribute_id, btrim(p_value), lower(btrim(p_value)))
        ON CONFLICT (attribute_id, normalized_value) DO NOTHING;
    SELECT id INTO v_id FROM catalog.attribute_values
        WHERE attribute_id = p_attribute_id AND normalized_value = lower(btrim(p_value));
    RETURN v_id;
END;
$$;

CREATE FUNCTION catalog.create_unit(p_session_token text, p_code text, p_name text)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
    v_id bigint;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    IF btrim(coalesce(p_code, '')) = '' OR btrim(coalesce(p_name, '')) = '' THEN
        RAISE EXCEPTION 'unit code and name must not be blank' USING ERRCODE = '22023';
    END IF;
    INSERT INTO catalog.units (code, normalized_code, name)
        VALUES (btrim(p_code), upper(btrim(p_code)), btrim(p_name))
        ON CONFLICT (normalized_code) DO NOTHING;
    SELECT id INTO v_id FROM catalog.units WHERE normalized_code = upper(btrim(p_code));
    RETURN v_id;
END;
$$;

CREATE FUNCTION catalog.set_variant_attributes(
    p_session_token text, p_variant_id bigint, p_attr_value_ids bigint[]
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
    v_product_id bigint;
    v_signature  text;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    SELECT product_id INTO v_product_id FROM catalog.product_variants WHERE id = p_variant_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'variant % not found', p_variant_id USING ERRCODE = '22023';
    END IF;
    PERFORM 1 FROM catalog.products WHERE id = v_product_id FOR UPDATE;
    v_signature := catalog.compute_attribute_signature(p_attr_value_ids);
    BEGIN
        UPDATE catalog.product_variants SET attribute_signature = v_signature WHERE id = p_variant_id;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'a variant with the same attribute combination already exists for this product'
            USING ERRCODE = '22023';
    END;
    DELETE FROM catalog.variant_attribute_values WHERE variant_id = p_variant_id;
    IF p_attr_value_ids IS NOT NULL AND array_length(p_attr_value_ids, 1) IS NOT NULL THEN
        INSERT INTO catalog.variant_attribute_values (variant_id, attribute_id, attribute_value_id)
            SELECT p_variant_id, av.attribute_id, av.id
                FROM catalog.attribute_values av WHERE av.id = ANY (p_attr_value_ids);
    END IF;
END;
$$;

CREATE FUNCTION catalog.add_variant_barcode(
    p_session_token text, p_variant_id bigint, p_barcode text
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    PERFORM 1 FROM catalog.product_variants WHERE id = p_variant_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'variant % not found', p_variant_id USING ERRCODE = '22023';
    END IF;
    RETURN catalog._insert_barcode(p_variant_id, p_barcode);
END;
$$;

CREATE FUNCTION catalog.remove_variant_barcode(p_session_token text, p_barcode_id bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    DELETE FROM catalog.variant_barcodes WHERE id = p_barcode_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'barcode % not found', p_barcode_id USING ERRCODE = '22023';
    END IF;
END;
$$;

CREATE FUNCTION catalog.add_variant_alt_unit(
    p_session_token text, p_variant_id bigint, p_unit_id bigint, p_conversion_factor numeric
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
    v_base_unit bigint;
    v_id        bigint;
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
    IF p_unit_id = v_base_unit THEN
        RAISE EXCEPTION 'alternate unit must differ from the base unit' USING ERRCODE = '22023';
    END IF;
    IF p_conversion_factor <= 0 THEN
        RAISE EXCEPTION 'conversion factor must be strictly positive' USING ERRCODE = '22023';
    END IF;
    BEGIN
        INSERT INTO catalog.variant_units (variant_id, unit_id, conversion_factor)
            VALUES (p_variant_id, p_unit_id, p_conversion_factor) RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'alternate unit % is already configured for this variant', p_unit_id
            USING ERRCODE = '22023';
    END;
    RETURN v_id;
END;
$$;

CREATE FUNCTION catalog.remove_variant_alt_unit(p_session_token text, p_variant_unit_id bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    DELETE FROM catalog.variant_units WHERE id = p_variant_unit_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'alternate unit assignment % not found', p_variant_unit_id USING ERRCODE = '22023';
    END IF;
END;
$$;

CREATE FUNCTION catalog.set_variant_base_unit(
    p_session_token text, p_variant_id bigint, p_unit_id bigint
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    PERFORM 1 FROM catalog.product_variants WHERE id = p_variant_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'variant % not found', p_variant_id USING ERRCODE = '22023';
    END IF;
    PERFORM 1 FROM catalog.units WHERE id = p_unit_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'unit % not found', p_unit_id USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM catalog.variant_units WHERE variant_id = p_variant_id AND unit_id = p_unit_id) THEN
        RAISE EXCEPTION 'unit % is already an alternate unit of this variant', p_unit_id USING ERRCODE = '22023';
    END IF;
    UPDATE catalog.product_variants SET base_unit_id = p_unit_id WHERE id = p_variant_id;
END;
$$;

-- ===========================================================================
-- Read functions.
-- ===========================================================================

-- Resolve a normalized barcode to exactly one ACTIVE catalog variant (of an
-- active product). Returns zero rows when not found or inactive. Suitable for
-- POS barcode-scan lookup.
CREATE FUNCTION catalog.resolve_barcode(p_session_token text, p_barcode text)
RETURNS TABLE (
    variant_id bigint, product_id bigint, sku text, product_name text,
    sale_price numeric, base_unit_id bigint, variant_is_active boolean, product_is_active boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);
    RETURN QUERY
        SELECT v.id, p.id, v.sku, p.name, v.sale_price, v.base_unit_id, v.is_active, p.is_active
            FROM catalog.variant_barcodes b
            JOIN catalog.product_variants v ON v.id = b.variant_id
            JOIN catalog.products p ON p.id = v.product_id
            WHERE b.normalized_barcode = upper(btrim(p_barcode))
              AND v.is_active AND p.is_active;
END;
$$;

CREATE FUNCTION catalog.list_attributes(p_session_token text)
RETURNS TABLE (attribute_id bigint, name text, attribute_values jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);
    RETURN QUERY
        SELECT a.id, a.name,
            coalesce((
                SELECT jsonb_agg(jsonb_build_object('id', av.id, 'value', av.value) ORDER BY av.value)
                    FROM catalog.attribute_values av WHERE av.attribute_id = a.id
            ), '[]'::jsonb)
            FROM catalog.attributes a ORDER BY a.name;
END;
$$;

CREATE FUNCTION catalog.list_units(p_session_token text)
RETURNS TABLE (id bigint, code text, name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);
    RETURN QUERY SELECT u.id, u.code, u.name FROM catalog.units u ORDER BY u.code;
END;
$$;

CREATE FUNCTION catalog.list_catalog_products(p_session_token text, p_search text)
RETURNS TABLE (
    product_id bigint, name text, is_active boolean,
    variant_count bigint, active_variant_count bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    RETURN QUERY
        SELECT p.id, p.name, p.is_active,
            (SELECT count(*) FROM catalog.product_variants v WHERE v.product_id = p.id),
            (SELECT count(*) FROM catalog.product_variants v WHERE v.product_id = p.id AND v.is_active)
            FROM catalog.products p
            WHERE p_search IS NULL OR btrim(p_search) = ''
                OR p.name ILIKE '%' || p_search || '%'
                OR EXISTS (SELECT 1 FROM catalog.product_variants v
                           WHERE v.product_id = p.id AND v.sku ILIKE '%' || p_search || '%')
            ORDER BY p.name;
END;
$$;

-- Cohesive editing payload: product + all variants with their base unit,
-- attributes, alternate units, and barcodes. Prices/factors are serialized as
-- text to preserve exact decimals (never JSON floats).
CREATE FUNCTION catalog.get_product_detail(p_session_token text, p_product_id bigint)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
    v_result jsonb;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    SELECT jsonb_build_object(
        'product_id', p.id,
        'name', p.name,
        'is_active', p.is_active,
        'variants', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                'variant_id', v.id,
                'sku', v.sku,
                'sale_price', v.sale_price::text,
                'is_active', v.is_active,
                'base_unit_id', v.base_unit_id,
                'base_unit_code', (SELECT u.code FROM catalog.units u WHERE u.id = v.base_unit_id),
                'attribute_signature', v.attribute_signature,
                'attributes', coalesce((
                    SELECT jsonb_agg(jsonb_build_object(
                        'attribute_id', a.id, 'attribute_name', a.name,
                        'attribute_value_id', av.id, 'value', av.value) ORDER BY a.name)
                    FROM catalog.variant_attribute_values link
                    JOIN catalog.attributes a ON a.id = link.attribute_id
                    JOIN catalog.attribute_values av ON av.id = link.attribute_value_id
                    WHERE link.variant_id = v.id), '[]'::jsonb),
                'alternate_units', coalesce((
                    SELECT jsonb_agg(jsonb_build_object(
                        'id', vu.id, 'unit_id', vu.unit_id, 'unit_code', u2.code,
                        'conversion_factor', vu.conversion_factor::text) ORDER BY u2.code)
                    FROM catalog.variant_units vu JOIN catalog.units u2 ON u2.id = vu.unit_id
                    WHERE vu.variant_id = v.id), '[]'::jsonb),
                'barcodes', coalesce((
                    SELECT jsonb_agg(jsonb_build_object('id', b.id, 'barcode', b.barcode) ORDER BY b.id)
                    FROM catalog.variant_barcodes b WHERE b.variant_id = v.id), '[]'::jsonb)
            ) ORDER BY v.id)
            FROM catalog.product_variants v WHERE v.product_id = p.id
        ), '[]'::jsonb)
    ) INTO v_result FROM catalog.products p WHERE p.id = p_product_id;
    IF v_result IS NULL THEN
        RAISE EXCEPTION 'product % not found', p_product_id USING ERRCODE = '22023';
    END IF;
    RETURN v_result;
END;
$$;

-- ===========================================================================
-- Backward compatibility: the Slice 1 singular create function must keep
-- working now that base_unit_id is mandatory. Same signature/return type, so
-- CREATE OR REPLACE is valid. It assigns the canonical base unit and an empty
-- attribute signature.
-- ===========================================================================
CREATE OR REPLACE FUNCTION catalog.create_product_with_variant(
    p_session_token text, p_name text, p_sku text, p_sale_price numeric, p_is_active boolean
)
RETURNS TABLE (product_id bigint, variant_id bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
    v_product_id bigint;
    v_variant_id bigint;
    v_base_unit  bigint;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    IF btrim(p_name) = '' THEN RAISE EXCEPTION 'product name must not be blank' USING ERRCODE = '22023'; END IF;
    IF btrim(p_sku) = '' THEN RAISE EXCEPTION 'variant SKU must not be blank' USING ERRCODE = '22023'; END IF;
    IF p_sale_price < 0 THEN RAISE EXCEPTION 'sale price must not be negative' USING ERRCODE = '22023'; END IF;
    SELECT id INTO v_base_unit FROM catalog.units WHERE normalized_code = 'UNIT';
    INSERT INTO catalog.products (name, is_active) VALUES (btrim(p_name), p_is_active) RETURNING id INTO v_product_id;
    BEGIN
        INSERT INTO catalog.product_variants (product_id, sku, sale_price, is_active, base_unit_id, attribute_signature)
            VALUES (v_product_id, btrim(p_sku), p_sale_price, p_is_active, v_base_unit, '')
            RETURNING id INTO v_variant_id;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'a variant with SKU % already exists', btrim(p_sku) USING ERRCODE = '22023';
    END;
    RETURN QUERY SELECT v_product_id, v_variant_id;
END;
$$;

-- ===========================================================================
-- Grants: revoke internal helpers from PUBLIC (no runtime execute); grant
-- EXECUTE on the public API to stockiha_runtime.
-- ===========================================================================
REVOKE ALL ON FUNCTION catalog.compute_attribute_signature(bigint[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog._insert_barcode(bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog._insert_variant(bigint, jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION catalog.create_product_with_variants(text, text, boolean, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog.add_variant(text, bigint, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog.update_variant(text, bigint, text, numeric, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog.set_variant_active(text, bigint, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog.update_product(text, bigint, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog.create_attribute(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog.add_attribute_value(text, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog.create_unit(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog.set_variant_attributes(text, bigint, bigint[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog.add_variant_barcode(text, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog.remove_variant_barcode(text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog.add_variant_alt_unit(text, bigint, bigint, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog.remove_variant_alt_unit(text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog.set_variant_base_unit(text, bigint, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog.resolve_barcode(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog.list_attributes(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog.list_units(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog.list_catalog_products(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog.get_product_detail(text, bigint) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION catalog.create_product_with_variants(text, text, boolean, jsonb) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.add_variant(text, bigint, jsonb) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.update_variant(text, bigint, text, numeric, boolean) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.set_variant_active(text, bigint, boolean) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.update_product(text, bigint, text, boolean) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.create_attribute(text, text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.add_attribute_value(text, bigint, text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.create_unit(text, text, text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.set_variant_attributes(text, bigint, bigint[]) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.add_variant_barcode(text, bigint, text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.remove_variant_barcode(text, bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.add_variant_alt_unit(text, bigint, bigint, numeric) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.remove_variant_alt_unit(text, bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.set_variant_base_unit(text, bigint, bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.resolve_barcode(text, text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.list_attributes(text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.list_units(text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.list_catalog_products(text, text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.get_product_detail(text, bigint) TO stockiha_runtime;

RESET ROLE;
