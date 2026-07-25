-- S3-001: Procurement CRUD and query database functions
SET ROLE stockiha_owner;

-- 1. Create Supplier
CREATE FUNCTION procurement.create_supplier(
    p_session_token text,
    p_code text,
    p_name text,
    p_contact_name text,
    p_phone text,
    p_email text,
    p_address text,
    p_tax_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_code text := nullif(btrim(p_code), '');
    v_name text := nullif(btrim(p_name), '');
    v_supplier_id bigint;
BEGIN
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_PROCUREMENT');

    IF v_code IS NULL THEN
        RAISE EXCEPTION 'supplier code must not be blank' USING ERRCODE = '22023';
    END IF;
    IF v_name IS NULL THEN
        RAISE EXCEPTION 'supplier name must not be blank' USING ERRCODE = '22023';
    END IF;

    INSERT INTO procurement.suppliers (
        code, name, contact_name, phone, email, address, tax_id, is_active
    ) VALUES (
        v_code, v_name, nullif(btrim(p_contact_name), ''), nullif(btrim(p_phone), ''),
        nullif(btrim(p_email), ''), nullif(btrim(p_address), ''), nullif(btrim(p_tax_id), ''), true
    ) RETURNING id INTO v_supplier_id;

    RETURN jsonb_build_object(
        'id', v_supplier_id,
        'code', v_code,
        'name', v_name,
        'is_active', true
    );
END;
$$;

-- 2. Update Supplier
CREATE FUNCTION procurement.update_supplier(
    p_session_token text,
    p_supplier_id bigint,
    p_code text,
    p_name text,
    p_contact_name text,
    p_phone text,
    p_email text,
    p_address text,
    p_tax_id text,
    p_is_active boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_code text := nullif(btrim(p_code), '');
    v_name text := nullif(btrim(p_name), '');
BEGIN
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_PROCUREMENT');

    IF v_code IS NULL THEN
        RAISE EXCEPTION 'supplier code must not be blank' USING ERRCODE = '22023';
    END IF;
    IF v_name IS NULL THEN
        RAISE EXCEPTION 'supplier name must not be blank' USING ERRCODE = '22023';
    END IF;

    UPDATE procurement.suppliers
    SET code = v_code,
        name = v_name,
        contact_name = nullif(btrim(p_contact_name), ''),
        phone = nullif(btrim(p_phone), ''),
        email = nullif(btrim(p_email), ''),
        address = nullif(btrim(p_address), ''),
        tax_id = nullif(btrim(p_tax_id), ''),
        is_active = coalesce(p_is_active, true)
    WHERE id = p_supplier_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'supplier % not found', p_supplier_id USING ERRCODE = '22023';
    END IF;

    RETURN jsonb_build_object(
        'id', p_supplier_id,
        'code', v_code,
        'name', v_name,
        'is_active', coalesce(p_is_active, true)
    );
END;
$$;

-- 3. List Suppliers
CREATE FUNCTION procurement.list_suppliers(
    p_session_token text,
    p_include_inactive boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_result jsonb;
BEGIN
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_PROCUREMENT');

    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'id', s.id,
            'code', s.code,
            'name', s.name,
            'contact_name', s.contact_name,
            'phone', s.phone,
            'email', s.email,
            'address', s.address,
            'tax_id', s.tax_id,
            'is_active', s.is_active,
            'created_at', s.created_at
        ) ORDER BY s.name, s.code
    ), '[]'::jsonb) INTO v_result
    FROM procurement.suppliers s
    WHERE (coalesce(p_include_inactive, false) OR s.is_active);

    RETURN v_result;
END;
$$;

-- 4. Create Purchase Order Draft
CREATE FUNCTION procurement.create_purchase_order_draft(
    p_session_token text,
    p_supplier_id bigint,
    p_warehouse_id bigint,
    p_note text,
    p_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_doc_id bigint;
    v_fiscal_period_id bigint;
    v_fiscal_year integer;
    v_subtotal numeric(14, 2) := 0;
    v_line jsonb;
    v_line_number integer := 0;
    v_variant_id bigint;
    v_unit_id bigint;
    v_qty numeric;
    v_unit_cost numeric;
    v_line_total numeric(14, 2);
    v_sequence bigint;
    v_document_number text;
BEGIN
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_PROCUREMENT');

    PERFORM 1 FROM procurement.suppliers WHERE id = p_supplier_id AND is_active FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'supplier % is inactive or not found', p_supplier_id USING ERRCODE = '22023';
    END IF;

    PERFORM 1 FROM inventory.warehouses WHERE id = p_warehouse_id AND is_active FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'warehouse % is inactive or not found', p_warehouse_id USING ERRCODE = '22023';
    END IF;

    SELECT id, extract(year FROM starts_on)::integer INTO v_fiscal_period_id, v_fiscal_year
    FROM finance.fiscal_periods
    WHERE status = 'OPEN'
    ORDER BY starts_on DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'no open fiscal period found' USING ERRCODE = '55000';
    END IF;

    IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
        RAISE EXCEPTION 'purchase order must contain at least one line' USING ERRCODE = '22023';
    END IF;

    -- Create Header
    INSERT INTO core.business_documents (
        document_type, document_date, fiscal_period_id, fiscal_year
    ) VALUES (
        'PURCHASE_ORDER', CURRENT_DATE, v_fiscal_period_id, v_fiscal_year
    ) RETURNING id INTO v_doc_id;

    INSERT INTO procurement.purchase_orders (
        document_id, supplier_id, warehouse_id, status,
        subtotal, total_amount, note, created_by_user_id
    ) VALUES (
        v_doc_id, p_supplier_id, p_warehouse_id, 'DRAFT',
        0, 0, nullif(btrim(p_note), ''), v_user_id
    );

    -- Create Lines
    FOR v_line IN SELECT jsonb_array_elements(p_lines)
    LOOP
        v_line_number := v_line_number + 1;
        v_variant_id := (v_line ->> 'variant_id')::bigint;
        v_unit_id := (v_line ->> 'unit_id')::bigint;
        v_qty := (v_line ->> 'quantity_ordered')::numeric;
        v_unit_cost := (v_line ->> 'unit_cost')::numeric;

        IF v_variant_id IS NULL OR v_unit_id IS NULL OR v_qty IS NULL OR v_qty <= 0 OR v_unit_cost IS NULL OR v_unit_cost < 0 THEN
            RAISE EXCEPTION 'line % contains invalid quantity or cost', v_line_number USING ERRCODE = '22023';
        END IF;

        PERFORM 1 FROM catalog.product_variants WHERE id = v_variant_id AND is_active FOR SHARE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'variant % is inactive or not found', v_variant_id USING ERRCODE = '22023';
        END IF;

        v_line_total := round(v_qty * v_unit_cost, 2);
        v_subtotal := v_subtotal + v_line_total;

        INSERT INTO procurement.purchase_order_lines (
            document_id, line_number, variant_id, unit_id,
            quantity_ordered, quantity_received, unit_cost, line_total
        ) VALUES (
            v_doc_id, v_line_number, v_variant_id, v_unit_id,
            v_qty, 0, v_unit_cost, v_line_total
        );
    END LOOP;

    -- Update Totals
    UPDATE procurement.purchase_orders
    SET subtotal = v_subtotal, total_amount = v_subtotal
    WHERE document_id = v_doc_id;

    RETURN jsonb_build_object(
        'document_id', v_doc_id,
        'status', 'DRAFT',
        'subtotal', v_subtotal::text
    );
END;
$$;

-- 5. Update Purchase Order Draft
CREATE FUNCTION procurement.update_purchase_order_draft(
    p_session_token text,
    p_purchase_order_id bigint,
    p_supplier_id bigint,
    p_warehouse_id bigint,
    p_note text,
    p_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_status text;
    v_subtotal numeric(14, 2) := 0;
    v_line jsonb;
    v_line_number integer := 0;
    v_variant_id bigint;
    v_unit_id bigint;
    v_qty numeric;
    v_unit_cost numeric;
    v_line_total numeric(14, 2);
BEGIN
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_PROCUREMENT');

    SELECT status INTO v_status
    FROM procurement.purchase_orders
    WHERE document_id = p_purchase_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'purchase order % not found', p_purchase_order_id USING ERRCODE = '22023';
    END IF;
    IF v_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'only DRAFT purchase orders can be edited (order ID: %)', p_purchase_order_id USING ERRCODE = '55000';
    END IF;

    PERFORM 1 FROM procurement.suppliers WHERE id = p_supplier_id AND is_active FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'supplier % is inactive or not found', p_supplier_id USING ERRCODE = '22023';
    END IF;

    PERFORM 1 FROM inventory.warehouses WHERE id = p_warehouse_id AND is_active FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'warehouse % is inactive or not found', p_warehouse_id USING ERRCODE = '22023';
    END IF;

    IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
        RAISE EXCEPTION 'purchase order must contain at least one line' USING ERRCODE = '22023';
    END IF;

    -- Replace lines
    DELETE FROM procurement.purchase_order_lines WHERE document_id = p_purchase_order_id;

    FOR v_line IN SELECT jsonb_array_elements(p_lines)
    LOOP
        v_line_number := v_line_number + 1;
        v_variant_id := (v_line ->> 'variant_id')::bigint;
        v_unit_id := (v_line ->> 'unit_id')::bigint;
        v_qty := (v_line ->> 'quantity_ordered')::numeric;
        v_unit_cost := (v_line ->> 'unit_cost')::numeric;

        IF v_variant_id IS NULL OR v_unit_id IS NULL OR v_qty IS NULL OR v_qty <= 0 OR v_unit_cost IS NULL OR v_unit_cost < 0 THEN
            RAISE EXCEPTION 'line % contains invalid quantity or cost', v_line_number USING ERRCODE = '22023';
        END IF;

        v_line_total := round(v_qty * v_unit_cost, 2);
        v_subtotal := v_subtotal + v_line_total;

        INSERT INTO procurement.purchase_order_lines (
            document_id, line_number, variant_id, unit_id,
            quantity_ordered, quantity_received, unit_cost, line_total
        ) VALUES (
            p_purchase_order_id, v_line_number, v_variant_id, v_unit_id,
            v_qty, 0, v_unit_cost, v_line_total
        );
    END LOOP;

    UPDATE procurement.purchase_orders
    SET supplier_id = p_supplier_id,
        warehouse_id = p_warehouse_id,
        note = nullif(btrim(p_note), ''),
        subtotal = v_subtotal,
        total_amount = v_subtotal
    WHERE document_id = p_purchase_order_id;

    RETURN jsonb_build_object(
        'document_id', p_purchase_order_id,
        'status', 'DRAFT',
        'subtotal', v_subtotal::text
    );
END;
$$;

-- 6. Confirm Purchase Order
CREATE FUNCTION procurement.confirm_purchase_order(
    p_session_token text,
    p_purchase_order_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_status text;
    v_fiscal_year integer;
    v_sequence bigint;
    v_document_number text;
BEGIN
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_PROCUREMENT');

    SELECT po.status, bd.fiscal_year INTO v_status, v_fiscal_year
    FROM procurement.purchase_orders po
    JOIN core.business_documents bd ON bd.id = po.document_id
    WHERE po.document_id = p_purchase_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'purchase order % not found', p_purchase_order_id USING ERRCODE = '22023';
    END IF;
    IF v_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'purchase order % is not in DRAFT status', p_purchase_order_id USING ERRCODE = '55000';
    END IF;

    -- Allocate Document Number & Post Header
    v_sequence := core.claim_next_document_number('PURCHASE_ORDER', v_fiscal_year);
    v_document_number := 'PO-' || v_fiscal_year || '-' || lpad(v_sequence::text, 6, '0');

    UPDATE core.business_documents
    SET status = 'POSTED',
        sequence_number = v_sequence,
        document_number = v_document_number,
        posted_at = now()
    WHERE id = p_purchase_order_id;

    UPDATE procurement.purchase_orders
    SET status = 'CONFIRMED',
        confirmed_at = now(),
        confirmed_by_user_id = v_user_id
    WHERE document_id = p_purchase_order_id;

    RETURN jsonb_build_object(
        'document_id', p_purchase_order_id,
        'document_number', v_document_number,
        'status', 'CONFIRMED'
    );
END;
$$;

-- 7. Cancel Purchase Order
CREATE FUNCTION procurement.cancel_purchase_order(
    p_session_token text,
    p_purchase_order_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_status text;
BEGIN
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_PROCUREMENT');

    SELECT status INTO v_status
    FROM procurement.purchase_orders
    WHERE document_id = p_purchase_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'purchase order % not found', p_purchase_order_id USING ERRCODE = '22023';
    END IF;

    IF v_status IN ('RECEIVED', 'CANCELLED') THEN
        RAISE EXCEPTION 'purchase order % cannot be cancelled in status %', p_purchase_order_id, v_status
            USING ERRCODE = '55000';
    END IF;

    UPDATE procurement.purchase_orders
    SET status = 'CANCELLED'
    WHERE document_id = p_purchase_order_id;

    RETURN jsonb_build_object(
        'document_id', p_purchase_order_id,
        'status', 'CANCELLED'
    );
END;
$$;

-- 8. List Purchase Orders
CREATE FUNCTION procurement.list_purchase_orders(
    p_session_token text,
    p_supplier_id bigint DEFAULT NULL,
    p_status text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_result jsonb;
BEGIN
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_PROCUREMENT');

    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'document_id', po.document_id,
            'document_number', bd.document_number,
            'supplier_id', po.supplier_id,
            'supplier_code', s.code,
            'supplier_name', s.name,
            'warehouse_id', po.warehouse_id,
            'warehouse_code', w.code,
            'warehouse_name', w.name,
            'status', po.status,
            'subtotal', po.subtotal::text,
            'total_amount', po.total_amount::text,
            'created_at', po.created_at,
            'confirmed_at', po.confirmed_at
        ) ORDER BY po.created_at DESC
    ), '[]'::jsonb) INTO v_result
    FROM procurement.purchase_orders po
    JOIN core.business_documents bd ON bd.id = po.document_id
    JOIN procurement.suppliers s ON s.id = po.supplier_id
    JOIN inventory.warehouses w ON w.id = po.warehouse_id
    WHERE (p_supplier_id IS NULL OR po.supplier_id = p_supplier_id)
      AND (p_status IS NULL OR po.status = p_status);

    RETURN v_result;
END;
$$;

-- 9. Get Purchase Order Detail
CREATE FUNCTION procurement.get_purchase_order_detail(
    p_session_token text,
    p_purchase_order_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_header jsonb;
    v_lines jsonb;
BEGIN
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_PROCUREMENT');

    SELECT jsonb_build_object(
        'document_id', po.document_id,
        'document_number', bd.document_number,
        'supplier_id', po.supplier_id,
        'supplier_code', s.code,
        'supplier_name', s.name,
        'warehouse_id', po.warehouse_id,
        'warehouse_code', w.code,
        'warehouse_name', w.name,
        'status', po.status,
        'subtotal', po.subtotal::text,
        'total_amount', po.total_amount::text,
        'note', po.note,
        'created_at', po.created_at,
        'confirmed_at', po.confirmed_at
    ) INTO v_header
    FROM procurement.purchase_orders po
    JOIN core.business_documents bd ON bd.id = po.document_id
    JOIN procurement.suppliers s ON s.id = po.supplier_id
    JOIN inventory.warehouses w ON w.id = po.warehouse_id
    WHERE po.document_id = p_purchase_order_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'purchase order % not found', p_purchase_order_id USING ERRCODE = '22023';
    END IF;

    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'id', pol.id,
            'line_number', pol.line_number,
            'variant_id', pol.variant_id,
            'variant_sku', pv.sku,
            'variant_name', p.name,
            'unit_id', pol.unit_id,
            'unit_code', u.code,
            'unit_name', u.name,
            'quantity_ordered', pol.quantity_ordered::text,
            'quantity_received', pol.quantity_received::text,
            'remaining_quantity', (pol.quantity_ordered - pol.quantity_received)::text,
            'unit_cost', pol.unit_cost::text,
            'line_total', pol.line_total::text
        ) ORDER BY pol.line_number
    ), '[]'::jsonb) INTO v_lines
    FROM procurement.purchase_order_lines pol
    JOIN catalog.product_variants pv ON pv.id = pol.variant_id
    JOIN catalog.products p ON p.id = pv.product_id
    JOIN catalog.units u ON u.id = pol.unit_id
    WHERE pol.document_id = p_purchase_order_id;

    RETURN v_header || jsonb_build_object('lines', v_lines);
END;
$$;

-- 10. List Purchase Receipts
CREATE FUNCTION procurement.list_purchase_receipts(
    p_session_token text,
    p_supplier_id bigint DEFAULT NULL,
    p_purchase_order_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_result jsonb;
BEGIN
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_PROCUREMENT');

    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'document_id', pr.document_id,
            'document_number', bd.document_number,
            'purchase_order_id', pr.purchase_order_id,
            'purchase_order_number', po_bd.document_number,
            'supplier_id', pr.supplier_id,
            'supplier_name', s.name,
            'warehouse_id', pr.warehouse_id,
            'warehouse_name', w.name,
            'total_amount', pr.total_amount::text,
            'posted_at', bd.posted_at
        ) ORDER BY bd.posted_at DESC
    ), '[]'::jsonb) INTO v_result
    FROM procurement.purchase_receipts pr
    JOIN core.business_documents bd ON bd.id = pr.document_id
    JOIN procurement.purchase_orders po ON po.document_id = pr.purchase_order_id
    JOIN core.business_documents po_bd ON po_bd.id = po.document_id
    JOIN procurement.suppliers s ON s.id = pr.supplier_id
    JOIN inventory.warehouses w ON w.id = pr.warehouse_id
    WHERE (p_supplier_id IS NULL OR pr.supplier_id = p_supplier_id)
      AND (p_purchase_order_id IS NULL OR pr.purchase_order_id = p_purchase_order_id);

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION procurement.create_supplier(text, text, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION procurement.update_supplier(text, bigint, text, text, text, text, text, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION procurement.list_suppliers(text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION procurement.create_purchase_order_draft(text, bigint, bigint, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION procurement.update_purchase_order_draft(text, bigint, bigint, bigint, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION procurement.confirm_purchase_order(text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION procurement.cancel_purchase_order(text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION procurement.list_purchase_orders(text, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION procurement.get_purchase_order_detail(text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION procurement.list_purchase_receipts(text, bigint, bigint) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION procurement.create_supplier(text, text, text, text, text, text, text, text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION procurement.update_supplier(text, bigint, text, text, text, text, text, text, text, boolean) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION procurement.list_suppliers(text, boolean) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION procurement.create_purchase_order_draft(text, bigint, bigint, text, jsonb) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION procurement.update_purchase_order_draft(text, bigint, bigint, bigint, text, jsonb) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION procurement.confirm_purchase_order(text, bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION procurement.cancel_purchase_order(text, bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION procurement.list_purchase_orders(text, bigint, text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION procurement.get_purchase_order_detail(text, bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION procurement.list_purchase_receipts(text, bigint, bigint) TO stockiha_runtime;

RESET ROLE;
