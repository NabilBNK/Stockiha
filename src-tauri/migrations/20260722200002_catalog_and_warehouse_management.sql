-- Slice 1 Frontend MVP batch: owner-controlled creation functions for
-- products (+ their default variant) and warehouses. `stockiha_runtime` still
-- has no direct INSERT on `catalog.*` or `inventory.warehouses` (migrations
-- 404/405 granted SELECT only) — these SECURITY DEFINER functions are the
-- sole sanctioned write path, each gated on a session token + the matching
-- management permission.
SET ROLE stockiha_owner;

-- Creates a product and its single default variant in one transaction. The
-- MVP has exactly one variant per product (no attributes/barcodes yet), so
-- this is the only catalog-creation entry point. Returns both ids.
CREATE FUNCTION catalog.create_product_with_variant(
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
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');

    IF btrim(p_name) = '' THEN
        RAISE EXCEPTION 'product name must not be blank' USING ERRCODE = '22023';
    END IF;
    IF btrim(p_sku) = '' THEN
        RAISE EXCEPTION 'variant SKU must not be blank' USING ERRCODE = '22023';
    END IF;
    IF p_sale_price < 0 THEN
        RAISE EXCEPTION 'sale price must not be negative' USING ERRCODE = '22023';
    END IF;

    INSERT INTO catalog.products (name, is_active)
        VALUES (p_name, p_is_active)
        RETURNING id INTO v_product_id;

    BEGIN
        INSERT INTO catalog.product_variants (product_id, sku, sale_price, is_active)
            VALUES (v_product_id, p_sku, p_sale_price, p_is_active)
            RETURNING id INTO v_variant_id;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'a variant with SKU % already exists', p_sku USING ERRCODE = '22023';
    END;

    RETURN QUERY SELECT v_product_id, v_variant_id;
END;
$$;

-- Creates a warehouse. Gated on MANAGE_WAREHOUSES.
CREATE FUNCTION inventory.create_warehouse(
    p_session_token text,
    p_code text,
    p_name text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_warehouse_id bigint;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_WAREHOUSES');

    IF btrim(p_code) = '' OR btrim(p_name) = '' THEN
        RAISE EXCEPTION 'warehouse code and name must not be blank' USING ERRCODE = '22023';
    END IF;

    BEGIN
        INSERT INTO inventory.warehouses (code, name)
            VALUES (p_code, p_name)
            RETURNING id INTO v_warehouse_id;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'a warehouse with code % already exists', p_code USING ERRCODE = '22023';
    END;

    RETURN v_warehouse_id;
END;
$$;

REVOKE ALL ON FUNCTION catalog.create_product_with_variant(text, text, text, numeric, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION inventory.create_warehouse(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog.create_product_with_variant(text, text, text, numeric, boolean) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION inventory.create_warehouse(text, text, text) TO stockiha_runtime;

RESET ROLE;
