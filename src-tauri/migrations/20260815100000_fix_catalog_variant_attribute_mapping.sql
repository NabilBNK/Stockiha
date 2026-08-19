-- Fix catalog variant-attribute mapping insertion in catalog._insert_variant
SET ROLE stockiha_owner;

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

    IF v_attr_ids IS NOT NULL AND array_length(v_attr_ids, 1) IS NOT NULL THEN
        INSERT INTO catalog.variant_attribute_values (
            variant_id,
            attribute_id,
            attribute_value_id
        )
        SELECT
            v_variant_id,
            av.attribute_id,
            av.id
        FROM catalog.attribute_values av
        WHERE av.id = ANY (v_attr_ids);
    END IF;

    IF p_variant ? 'barcodes' AND jsonb_typeof(p_variant -> 'barcodes') = 'array' THEN
        FOR v_barcode IN SELECT jsonb_array_elements_text(p_variant -> 'barcodes') LOOP
            PERFORM catalog._insert_barcode(v_variant_id, v_barcode);
        END LOOP;
    END IF;

    RETURN v_variant_id;
END;
$$;

RESET ROLE;
