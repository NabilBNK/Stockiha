-- Keep the legacy single-variant command valid after product-owned units became mandatory.
SET ROLE stockiha_owner;

CREATE OR REPLACE FUNCTION catalog.create_product_with_variant(
    p_session_token text,
    p_name text,
    p_sku text,
    p_sale_price numeric,
    p_is_active boolean
)
RETURNS TABLE (product_id bigint, variant_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_product_id bigint;
    v_variant_id bigint;
    v_unit_id bigint;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(
        p_session_token,
        'MANAGE_CATALOG'
    );

    IF btrim(coalesce(p_name, '')) = '' THEN
        RAISE EXCEPTION 'product name must not be blank' USING ERRCODE = '22023';
    END IF;
    IF btrim(coalesce(p_sku, '')) = '' THEN
        RAISE EXCEPTION 'variant SKU must not be blank' USING ERRCODE = '22023';
    END IF;
    IF p_sale_price IS NULL OR p_sale_price < 0 THEN
        RAISE EXCEPTION 'sale price must not be negative' USING ERRCODE = '22023';
    END IF;

    SELECT u.id
      INTO v_unit_id
      FROM catalog.units u
     WHERE u.normalized_code = 'UNIT';

    IF v_unit_id IS NULL THEN
        RAISE EXCEPTION 'canonical UNIT catalog unit is missing' USING ERRCODE = '55000';
    END IF;

    INSERT INTO catalog.products (name, unit_id, is_active)
        VALUES (btrim(p_name), v_unit_id, p_is_active)
        RETURNING id INTO v_product_id;

    BEGIN
        INSERT INTO catalog.product_variants (
            product_id,
            sku,
            sale_price,
            base_unit_id,
            attribute_signature,
            is_active
        )
        VALUES (
            v_product_id,
            btrim(p_sku),
            p_sale_price,
            v_unit_id,
            '',
            p_is_active
        )
        RETURNING id INTO v_variant_id;
    EXCEPTION
        WHEN unique_violation THEN
            RAISE EXCEPTION 'a variant with SKU % already exists', p_sku
                USING ERRCODE = '22023';
    END;

    RETURN QUERY SELECT v_product_id, v_variant_id;
END;
$$;

REVOKE ALL ON FUNCTION catalog.create_product_with_variant(
    text, text, text, numeric, boolean
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog.create_product_with_variant(
    text, text, text, numeric, boolean
) TO stockiha_runtime;

RESET ROLE;
