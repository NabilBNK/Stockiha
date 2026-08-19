-- Keep the redesigned catalog contract consistent across runtime callers.
SET ROLE stockiha_owner;

-- Legacy overloads remain available to administrative historical tests, but
-- runtime callers must use the product-owned unit contract.
REVOKE EXECUTE ON FUNCTION catalog.create_product_with_variants(
    text, text, boolean, jsonb
) FROM stockiha_runtime;

REVOKE EXECUTE ON FUNCTION catalog.update_product(
    text, bigint, text, boolean
) FROM stockiha_runtime;

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

    RETURN QUERY
    SELECT v.id, p.id, v.sku, v.name_override, catalog._effective_variant_name(v.id),
           b_prim.barcode, coalesce(b_prim.barcode, v.sku),
           CASE WHEN b_prim.barcode IS NOT NULL THEN 'BARCODE' ELSE 'SKU' END,
           p.name, v.sale_price, u.id, u.code, u.name, v.is_active, p.is_active
    FROM catalog.variant_barcodes b
    JOIN catalog.product_variants v ON v.id = b.variant_id
    JOIN catalog.products p ON p.id = v.product_id
    JOIN catalog.units u ON u.id = p.unit_id
    LEFT JOIN catalog.variant_barcodes b_prim
      ON b_prim.variant_id = v.id AND b_prim.is_primary = true
    WHERE b.normalized_barcode = v_norm
      AND v.is_active
      AND p.is_active
    LIMIT 1;

    IF FOUND THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT v.id, p.id, v.sku, v.name_override, catalog._effective_variant_name(v.id),
           b_prim.barcode, coalesce(b_prim.barcode, v.sku),
           CASE WHEN b_prim.barcode IS NOT NULL THEN 'BARCODE' ELSE 'SKU' END,
           p.name, v.sale_price, u.id, u.code, u.name, v.is_active, p.is_active
    FROM catalog.product_variants v
    JOIN catalog.products p ON p.id = v.product_id
    JOIN catalog.units u ON u.id = p.unit_id
    LEFT JOIN catalog.variant_barcodes b_prim
      ON b_prim.variant_id = v.id AND b_prim.is_primary = true
    WHERE upper(v.sku) = v_norm
      AND v.is_active
      AND p.is_active
    LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION catalog.resolve_barcode(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog.resolve_barcode(text, text) TO stockiha_runtime;

RESET ROLE;
