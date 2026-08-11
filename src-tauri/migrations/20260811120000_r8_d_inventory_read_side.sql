-- R8-D: permission-aware inventory read side and immutable posting results.
--
-- This migration does not change stock mutation semantics. Authoritative WAC,
-- quantity, value, idempotency, numbering, and negative-stock rules remain in
-- the existing posting functions. It exposes only display-safe projections
-- through owner-controlled SECURITY DEFINER functions.
SET ROLE stockiha_owner;

CREATE FUNCTION inventory.get_capabilities(p_session_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
BEGIN
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session(p_session_token);

    RETURN jsonb_build_object(
        'can_manage_catalog', EXISTS (
            SELECT 1
            FROM iam.user_roles ur
            JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
            JOIN iam.permissions permission ON permission.id = rp.permission_id
            WHERE ur.user_id = v_user_id
              AND permission.code = 'MANAGE_CATALOG'
        ),
        'can_post_stock_receipt', EXISTS (
            SELECT 1
            FROM iam.user_roles ur
            JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
            JOIN iam.permissions permission ON permission.id = rp.permission_id
            WHERE ur.user_id = v_user_id
              AND permission.code = 'POST_STOCK_RECEIPT'
        ),
        'can_view_inventory', EXISTS (
            SELECT 1
            FROM iam.user_roles ur
            JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
            JOIN iam.permissions permission ON permission.id = rp.permission_id
            WHERE ur.user_id = v_user_id
              AND permission.code = 'MANAGE_INVENTORY'
        ),
        'can_manage_inventory', EXISTS (
            SELECT 1
            FROM iam.user_roles ur
            JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
            JOIN iam.permissions permission ON permission.id = rp.permission_id
            WHERE ur.user_id = v_user_id
              AND permission.code = 'MANAGE_INVENTORY'
        )
    );
END;
$$;

CREATE FUNCTION inventory.list_inventory_snapshot(
    p_session_token text,
    p_warehouse_id bigint,
    p_search text,
    p_include_inactive boolean DEFAULT false
)
RETURNS TABLE (
    product_id bigint,
    variant_id bigint,
    product_name text,
    sku text,
    base_unit_code text,
    product_is_active boolean,
    variant_is_active boolean,
    quantity_on_hand numeric,
    last_known_wac numeric,
    total_value numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1
    FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_INVENTORY');

    PERFORM 1
    FROM inventory.warehouses warehouse
    WHERE warehouse.id = p_warehouse_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'warehouse not found' USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    SELECT
        product.id,
        variant.id,
        product.name,
        variant.sku,
        unit.code,
        product.is_active,
        variant.is_active,
        coalesce(position.quantity_on_hand, 0)::numeric,
        coalesce(position.last_known_wac, 0)::numeric,
        coalesce(position.total_value, 0)::numeric
    FROM catalog.product_variants variant
    JOIN catalog.products product ON product.id = variant.product_id
    JOIN catalog.units unit ON unit.id = variant.base_unit_id
    LEFT JOIN inventory.positions position
      ON position.warehouse_id = p_warehouse_id
     AND position.variant_id = variant.id
    WHERE (
        p_include_inactive
        OR (product.is_active AND variant.is_active)
    )
      AND (
        p_search IS NULL
        OR btrim(p_search) = ''
        OR product.name ILIKE '%' || btrim(p_search) || '%'
        OR variant.sku ILIKE '%' || btrim(p_search) || '%'
        OR EXISTS (
            SELECT 1
            FROM catalog.variant_barcodes barcode
            WHERE barcode.variant_id = variant.id
              AND barcode.normalized_barcode ILIKE '%' || btrim(p_search) || '%'
        )
      )
    ORDER BY lower(product.name), lower(variant.sku), variant.id;
END;
$$;

CREATE FUNCTION inventory.get_stock_receipt_result(
    p_session_token text,
    p_document_id bigint
)
RETURNS TABLE (
    document_id bigint,
    document_number text,
    warehouse_id bigint,
    variant_id bigint,
    received_quantity numeric,
    received_value numeric,
    resulting_quantity_on_hand numeric,
    resulting_total_value numeric,
    resulting_wac numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1
    FROM iam.resolve_session_with_permission(p_session_token, 'POST_STOCK_RECEIPT');

    RETURN QUERY
    SELECT
        document.id,
        document.document_number,
        movement.warehouse_id,
        movement.variant_id,
        movement.quantity_delta,
        movement.inventory_value_delta,
        movement.resulting_quantity_on_hand,
        movement.resulting_total_value,
        round(
            movement.resulting_total_value
            / nullif(movement.resulting_quantity_on_hand, 0),
            6
        )
    FROM core.business_documents document
    JOIN inventory.movements movement
      ON movement.reference_type = 'STOCK_RECEIPT'
     AND movement.reference_id = document.id
    WHERE document.id = p_document_id
      AND document.document_type = 'STOCK_RECEIPT'
      AND document.status = 'POSTED';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'stock receipt result not found' USING ERRCODE = '22023';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION inventory.get_capabilities(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION inventory.list_inventory_snapshot(text, bigint, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION inventory.get_stock_receipt_result(text, bigint) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION inventory.get_capabilities(text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION inventory.list_inventory_snapshot(text, bigint, text, boolean) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION inventory.get_stock_receipt_result(text, bigint) TO stockiha_runtime;

UPDATE operations.schema_state
SET migration_version = 20260811120000,
    updated_at = now()
WHERE singleton;

RESET ROLE;
