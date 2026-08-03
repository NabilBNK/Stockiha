-- R2: shared journal helper and corrected purchase-receipt posting.
SET ROLE stockiha_owner;

CREATE FUNCTION finance.create_posted_journal(
    p_document_date date,
    p_fiscal_period_id bigint,
    p_description text,
    p_source_type text,
    p_source_id bigint
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_fiscal_year integer := extract(year FROM p_document_date)::integer;
    v_sequence bigint;
    v_document_number text;
    v_document_id bigint;
BEGIN
    v_sequence := core.claim_next_document_number('JOURNAL_ENTRY', v_fiscal_year);
    v_document_number := 'JE-' || v_fiscal_year || '-' || lpad(v_sequence::text, 6, '0');

    INSERT INTO core.business_documents (
        document_type, status, document_date, fiscal_period_id, fiscal_year,
        sequence_number, document_number, posted_at
    ) VALUES (
        'JOURNAL_ENTRY', 'POSTED', p_document_date, p_fiscal_period_id,
        v_fiscal_year, v_sequence, v_document_number, now()
    ) RETURNING id INTO v_document_id;

    INSERT INTO finance.journal_entries (
        document_id, description, source_type, source_id
    ) VALUES (
        v_document_id, p_description, p_source_type, p_source_id
    );

    RETURN v_document_id;
END;
$$;

REVOKE ALL ON FUNCTION finance.create_posted_journal(date,bigint,text,text,bigint) FROM PUBLIC;

CREATE OR REPLACE FUNCTION inventory.confirm_purchase_receipt(
    p_session_token text,
    p_request_id uuid,
    p_payload_hash bytea,
    p_purchase_order_id bigint,
    p_fiscal_period_id bigint,
    p_document_date date,
    p_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_workstation_id text;
    v_cached_result bigint;
    v_period_status text;
    v_period_start date;
    v_period_end date;
    v_fiscal_year integer;
    v_supplier_id bigint;
    v_warehouse_id bigint;
    v_po_status text;
    v_input_line jsonb;
    v_line_number integer := 0;
    v_po_line_id bigint;
    v_po_document_id bigint;
    v_variant_id bigint;
    v_unit_id bigint;
    v_qty_received numeric;
    v_qty_ordered numeric(18, 3);
    v_prev_received numeric(18, 3);
    v_unit_cost numeric(14, 2);
    v_base_unit_id bigint;
    v_conversion_factor numeric(20, 6);
    v_base_qty_received numeric(18, 3);
    v_value_delta numeric(18, 4);
    v_line_total numeric(14, 2);
    v_receipt_subtotal numeric(14, 2) := 0;
    v_old_qty numeric(18, 3);
    v_old_value numeric(18, 4);
    v_old_wac numeric(18, 6);
    v_new_qty numeric(18, 3);
    v_new_value numeric(18, 4);
    v_new_wac numeric(18, 6);
    v_movement_id bigint;
    v_receipt_document_id bigint;
    v_journal_document_id bigint;
    v_unreceived_count integer;
    v_new_po_status text;
    v_sequence bigint;
    v_document_number text;
BEGIN
    SELECT user_id, workstation_id
    INTO v_user_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'POST_PURCHASE_RECEIPT');

    v_cached_result := core.reserve_idempotent_request(
        'inventory.confirm_purchase_receipt', p_request_id, p_payload_hash
    );
    IF v_cached_result IS NOT NULL THEN
        RETURN inventory._purchase_receipt_response(v_cached_result);
    END IF;

    SELECT status, starts_on, ends_on, extract(year FROM starts_on)::integer
    INTO v_period_status, v_period_start, v_period_end, v_fiscal_year
    FROM finance.fiscal_periods
    WHERE id = p_fiscal_period_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'fiscal period % not found', p_fiscal_period_id USING ERRCODE = '22023';
    END IF;
    IF v_period_status <> 'OPEN' THEN
        RAISE EXCEPTION 'fiscal period % is not open', p_fiscal_period_id USING ERRCODE = '55000';
    END IF;
    IF p_document_date < v_period_start OR p_document_date > v_period_end THEN
        RAISE EXCEPTION 'document date is outside fiscal period' USING ERRCODE = '22023';
    END IF;

    SELECT supplier_id, warehouse_id, status
    INTO v_supplier_id, v_warehouse_id, v_po_status
    FROM procurement.purchase_orders
    WHERE document_id = p_purchase_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'purchase order % not found', p_purchase_order_id USING ERRCODE = '22023';
    END IF;
    IF v_po_status NOT IN ('CONFIRMED', 'PARTIALLY_RECEIVED') THEN
        RAISE EXCEPTION 'purchase order % is not eligible for receipt (status: %)', p_purchase_order_id, v_po_status
            USING ERRCODE = '55000';
    END IF;

    PERFORM 1 FROM procurement.suppliers WHERE id = v_supplier_id AND is_active FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'supplier % is inactive or not found', v_supplier_id USING ERRCODE = '22023';
    END IF;
    PERFORM 1 FROM inventory.warehouses WHERE id = v_warehouse_id AND is_active FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'warehouse % is inactive or not found', v_warehouse_id USING ERRCODE = '22023';
    END IF;

    IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
        RAISE EXCEPTION 'purchase receipt must contain at least one line' USING ERRCODE = '22023';
    END IF;

    PERFORM 1
    FROM procurement.purchase_order_lines pol
    WHERE pol.id IN (
        SELECT DISTINCT (elem ->> 'po_line_id')::bigint
        FROM jsonb_array_elements(p_lines) elem
    )
    ORDER BY pol.id
    FOR UPDATE;

    PERFORM 1
    FROM inventory.positions pos
    WHERE pos.warehouse_id = v_warehouse_id
      AND pos.variant_id IN (
          SELECT DISTINCT pol.variant_id
          FROM jsonb_array_elements(p_lines) elem
          JOIN procurement.purchase_order_lines pol
            ON pol.id = (elem ->> 'po_line_id')::bigint
      )
    ORDER BY pos.variant_id
    FOR UPDATE;

    INSERT INTO core.business_documents (
        document_type, document_date, fiscal_period_id, fiscal_year
    ) VALUES (
        'PURCHASE_RECEIPT', p_document_date, p_fiscal_period_id, v_fiscal_year
    ) RETURNING id INTO v_receipt_document_id;

    INSERT INTO procurement.purchase_receipts (
        document_id, purchase_order_id, supplier_id, warehouse_id,
        subtotal, total_amount, posted_by_user_id, workstation_id
    ) VALUES (
        v_receipt_document_id, p_purchase_order_id, v_supplier_id, v_warehouse_id,
        0, 0, v_user_id, v_workstation_id
    );

    FOR v_input_line IN SELECT jsonb_array_elements(p_lines)
    LOOP
        v_line_number := v_line_number + 1;
        v_po_line_id := (v_input_line ->> 'po_line_id')::bigint;
        v_qty_received := (v_input_line ->> 'quantity_received')::numeric;

        IF v_po_line_id IS NULL OR v_qty_received IS NULL OR v_qty_received <= 0 THEN
            RAISE EXCEPTION 'line % must have valid po_line_id and positive quantity_received', v_line_number
                USING ERRCODE = '22023';
        END IF;

        SELECT document_id, variant_id, unit_id, quantity_ordered, quantity_received, unit_cost
        INTO v_po_document_id, v_variant_id, v_unit_id, v_qty_ordered, v_prev_received, v_unit_cost
        FROM procurement.purchase_order_lines
        WHERE id = v_po_line_id;

        IF NOT FOUND OR v_po_document_id <> p_purchase_order_id THEN
            RAISE EXCEPTION 'purchase order line % does not belong to purchase order %', v_po_line_id, p_purchase_order_id
                USING ERRCODE = '22023';
        END IF;
        IF v_prev_received + v_qty_received > v_qty_ordered THEN
            RAISE EXCEPTION 'receipt quantity exceeds remaining ordered quantity for line %', v_line_number
                USING ERRCODE = '55000';
        END IF;

        SELECT pv.base_unit_id
        INTO v_base_unit_id
        FROM catalog.product_variants pv
        JOIN catalog.products p ON p.id = pv.product_id
        WHERE pv.id = v_variant_id AND pv.is_active AND p.is_active
        FOR SHARE OF pv, p;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'variant % is inactive or not found', v_variant_id USING ERRCODE = '22023';
        END IF;

        IF v_unit_id = v_base_unit_id THEN
            v_conversion_factor := 1;
        ELSE
            SELECT vu.conversion_factor
            INTO v_conversion_factor
            FROM catalog.variant_units vu
            WHERE vu.variant_id = v_variant_id AND vu.unit_id = v_unit_id
            FOR SHARE;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'unit % is invalid for variant %', v_unit_id, v_variant_id USING ERRCODE = '22023';
            END IF;
        END IF;

        v_base_qty_received := v_qty_received * v_conversion_factor;
        v_line_total := round(v_qty_received * v_unit_cost, 2);
        v_receipt_subtotal := v_receipt_subtotal + v_line_total;
        v_value_delta := round(v_base_qty_received * (v_unit_cost / v_conversion_factor), 4);

        INSERT INTO inventory.positions (warehouse_id, variant_id)
        VALUES (v_warehouse_id, v_variant_id)
        ON CONFLICT (warehouse_id, variant_id) DO NOTHING;

        SELECT quantity_on_hand, total_value, last_known_wac
        INTO v_old_qty, v_old_value, v_old_wac
        FROM inventory.positions
        WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_id
        FOR UPDATE;

        v_new_qty := v_old_qty + v_base_qty_received;
        v_new_value := v_old_value + v_value_delta;
        v_new_wac := CASE WHEN v_new_qty > 0 THEN v_new_value / v_new_qty ELSE v_old_wac END;

        UPDATE inventory.positions
        SET quantity_on_hand = v_new_qty,
            total_value = v_new_value,
            last_known_wac = v_new_wac
        WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_id;

        INSERT INTO inventory.movements (
            warehouse_id, variant_id, movement_type, quantity_delta,
            inventory_value_delta, resulting_quantity_on_hand,
            resulting_total_value, reference_type, reference_id
        ) VALUES (
            v_warehouse_id, v_variant_id, 'RECEIPT', v_base_qty_received,
            v_value_delta, v_new_qty, v_new_value,
            'PURCHASE_RECEIPT', v_receipt_document_id
        ) RETURNING id INTO v_movement_id;

        INSERT INTO procurement.purchase_receipt_lines (
            document_id, line_number, po_line_id, variant_id, unit_id,
            quantity_received, unit_cost, line_total, movement_id
        ) VALUES (
            v_receipt_document_id, v_line_number, v_po_line_id, v_variant_id, v_unit_id,
            v_qty_received, v_unit_cost, v_line_total, v_movement_id
        );

        UPDATE procurement.purchase_order_lines
        SET quantity_received = quantity_received + v_qty_received
        WHERE id = v_po_line_id;
    END LOOP;

    UPDATE procurement.purchase_receipts
    SET subtotal = v_receipt_subtotal,
        total_amount = v_receipt_subtotal
    WHERE document_id = v_receipt_document_id;

    SELECT count(*)
    INTO v_unreceived_count
    FROM procurement.purchase_order_lines
    WHERE document_id = p_purchase_order_id
      AND quantity_received < quantity_ordered;
    v_new_po_status := CASE WHEN v_unreceived_count = 0 THEN 'RECEIVED' ELSE 'PARTIALLY_RECEIVED' END;
    UPDATE procurement.purchase_orders SET status = v_new_po_status WHERE document_id = p_purchase_order_id;

    IF v_receipt_subtotal > 0 THEN
        v_journal_document_id := finance.create_posted_journal(
            p_document_date,
            p_fiscal_period_id,
            'Purchase goods receipt',
            'PURCHASE_RECEIPT',
            v_receipt_document_id
        );

        INSERT INTO finance.journal_lines (
            document_id, line_number, account_code, debit, credit
        ) VALUES
            (v_journal_document_id, 1, finance.require_account_role('INVENTORY'), v_receipt_subtotal, 0),
            (v_journal_document_id, 2, finance.require_account_role('GRNI'), 0, v_receipt_subtotal);

        UPDATE procurement.purchase_receipts
        SET journal_document_id = v_journal_document_id
        WHERE document_id = v_receipt_document_id;
    END IF;

    -- A receipt accrues GRNI; it is not yet a supplier payable. AP and the
    -- supplier liability are created only by a confirmed invoice (or by the
    -- separately posted landed-cost payable).
    v_sequence := core.claim_next_document_number('PURCHASE_RECEIPT', v_fiscal_year);
    v_document_number := 'PR-' || v_fiscal_year || '-' || lpad(v_sequence::text, 6, '0');
    UPDATE core.business_documents
    SET status = 'POSTED', sequence_number = v_sequence,
        document_number = v_document_number, posted_at = now()
    WHERE id = v_receipt_document_id;

    PERFORM core.record_idempotent_result(
        'inventory.confirm_purchase_receipt', p_request_id, v_receipt_document_id
    );

    RETURN inventory._purchase_receipt_response(v_receipt_document_id);
END;
$$;

REVOKE ALL ON FUNCTION inventory.confirm_purchase_receipt(
    text,uuid,bytea,bigint,bigint,date,jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inventory.confirm_purchase_receipt(
    text,uuid,bytea,bigint,bigint,date,jsonb
) TO stockiha_runtime;

RESET ROLE;
