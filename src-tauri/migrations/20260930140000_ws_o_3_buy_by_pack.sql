-- Migration: 20260930140000_ws_o_3_buy_by_pack.sql
-- Workstream WS-O-3: Buy by the pack (Direct purchase split, pack rates, barcode resolution)

SET ROLE stockiha_owner;

-- ============================================================================
-- 1. Add pack_rate_of_unit_id column to procurement.purchase_receipt_lines
-- ============================================================================

ALTER TABLE procurement.purchase_receipt_lines
    ADD COLUMN IF NOT EXISTS pack_rate_of_unit_id bigint NULL REFERENCES catalog.units(id);

-- ============================================================================
-- 2. Helper function to expand direct purchase lines with extra loose pieces
-- ============================================================================

CREATE OR REPLACE FUNCTION inventory._expand_direct_purchase_lines(p_lines jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_expanded jsonb := '[]'::jsonb;
    v_elem jsonb;
    v_var_id bigint;
    v_unit_id bigint;
    v_base_unit_id bigint;
    v_qty numeric;
    v_extra numeric;
    v_unit_cost numeric(14,2);
    v_factor numeric(20,6);
    v_piece_cost numeric(14,2);
BEGIN
    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
        v_var_id := (v_elem->>'variant_id')::bigint;
        v_unit_id := (v_elem->>'unit_id')::bigint;
        v_qty := (v_elem->>'quantity_received')::numeric;
        v_unit_cost := (v_elem->>'unit_cost')::numeric(14,2);
        
        -- Check if extra_base_quantity is present and > 0
        IF v_elem ? 'extra_base_quantity' AND (v_elem->>'extra_base_quantity') IS NOT NULL AND (v_elem->>'extra_base_quantity') <> '' THEN
            v_extra := (v_elem->>'extra_base_quantity')::numeric;
        ELSE
            v_extra := 0;
        END IF;

        IF v_extra < 0 THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: Extra loose pieces cannot be negative' USING ERRCODE = '22023';
        END IF;

        IF v_extra > 0 THEN
            SELECT pv.base_unit_id INTO v_base_unit_id
            FROM catalog.product_variants pv
            WHERE pv.id = v_var_id;

            IF NOT FOUND THEN
                RAISE EXCEPTION 'VALIDATION_ERROR: Variant % not found for extra pieces expansion', v_var_id USING ERRCODE = '22023';
            END IF;

            IF v_unit_id = v_base_unit_id THEN
                RAISE EXCEPTION 'VALIDATION_ERROR: Extra loose pieces cannot be specified on a base unit line' USING ERRCODE = '22023';
            END IF;

            SELECT conversion_factor INTO v_factor
            FROM catalog.variant_units
            WHERE variant_id = v_var_id AND unit_id = v_unit_id;

            IF NOT FOUND OR v_factor IS NULL OR v_factor <= 1 THEN
                RAISE EXCEPTION 'VALIDATION_ERROR: Pack unit % conversion factor not found for variant %', v_unit_id, v_var_id USING ERRCODE = '22023';
            END IF;

            IF v_extra >= v_factor THEN
                RAISE EXCEPTION 'VALIDATION_ERROR: Extra loose pieces (%) must be strictly less than pack conversion factor (%)', v_extra, v_factor USING ERRCODE = '22023';
            END IF;

            -- Calculate piece cost at pack rate: round(unit_cost / factor, 2)
            v_piece_cost := round(v_unit_cost / v_factor, 2);

            -- Emit main pack line (if qty > 0)
            IF v_qty > 0 THEN
                v_expanded := v_expanded || jsonb_build_array(
                    jsonb_build_object(
                        'variant_id', v_var_id,
                        'unit_id', v_unit_id,
                        'quantity_received', v_qty,
                        'unit_cost', v_unit_cost,
                        'pack_rate_of_unit_id', null
                    )
                );
            END IF;

            -- Emit extra loose pieces line
            v_expanded := v_expanded || jsonb_build_array(
                jsonb_build_object(
                    'variant_id', v_var_id,
                    'unit_id', v_base_unit_id,
                    'quantity_received', v_extra,
                    'unit_cost', v_piece_cost,
                    'pack_rate_of_unit_id', v_unit_id
                )
            );
        ELSE
            -- No extra pieces
            v_expanded := v_expanded || jsonb_build_array(
                jsonb_build_object(
                    'variant_id', v_var_id,
                    'unit_id', v_unit_id,
                    'quantity_received', v_qty,
                    'unit_cost', v_unit_cost,
                    'pack_rate_of_unit_id', null
                )
            );
        END IF;
    END LOOP;

    RETURN v_expanded;
END;
$$;
REVOKE ALL ON FUNCTION inventory._expand_direct_purchase_lines(jsonb) FROM PUBLIC;

-- ============================================================================
-- 3. Replace inventory.confirm_direct_purchase with pack expansion support
-- ============================================================================

CREATE OR REPLACE FUNCTION inventory.confirm_direct_purchase(
    p_session_token text,
    p_request_id uuid,
    p_payload_hash bytea,
    p_supplier_id bigint,
    p_warehouse_id bigint,
    p_fiscal_period_id bigint,
    p_document_date date,
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
    v_workstation_id text;
    v_cached_result bigint;
    v_period_status text;
    v_period_start date;
    v_period_end date;
    v_fiscal_year integer;
    v_lines jsonb;
    v_input_line jsonb;
    v_line_number integer := 0;
    v_variant_id bigint;
    v_unit_id bigint;
    v_qty_received numeric;
    v_unit_cost numeric(14, 2);
    v_pack_rate_of_unit_id bigint;
    v_base_unit_id bigint;
    v_variant_active boolean;
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
    v_sequence bigint;
    v_document_number text;
BEGIN
    -- 1. Resolve Session & Permission
    SELECT user_id, workstation_id
    INTO v_user_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'POST_PURCHASE_RECEIPT');

    -- 2. Idempotency Check
    v_cached_result := core.reserve_idempotent_request(
        'inventory.confirm_direct_purchase', p_request_id, p_payload_hash
    );
    IF v_cached_result IS NOT NULL THEN
        RETURN inventory._purchase_receipt_response(v_cached_result);
    END IF;

    -- 3. Validate Fiscal Period
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

    -- 4. Validate Supplier & Warehouse
    PERFORM 1 FROM procurement.suppliers WHERE id = p_supplier_id AND is_active FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'supplier % is inactive or not found', p_supplier_id USING ERRCODE = '22023';
    END IF;

    PERFORM 1 FROM inventory.warehouses WHERE id = p_warehouse_id AND is_active FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'warehouse % is inactive or not found', p_warehouse_id USING ERRCODE = '22023';
    END IF;

    -- 5. Validate & Expand Lines
    IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Direct purchase requires at least one product line' USING ERRCODE = '22023';
    END IF;

    v_lines := inventory._expand_direct_purchase_lines(p_lines);
    IF jsonb_array_length(v_lines) = 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Direct purchase requires at least one product line' USING ERRCODE = '22023';
    END IF;

    -- 6. Deterministic Row Locking on inventory.positions
    PERFORM 1
    FROM inventory.positions pos
    WHERE pos.warehouse_id = p_warehouse_id
      AND pos.variant_id IN (
          SELECT (elem->>'variant_id')::bigint
          FROM jsonb_array_elements(v_lines) elem
          WHERE (elem->>'variant_id') IS NOT NULL
      )
    ORDER BY pos.variant_id
    FOR UPDATE;

    -- 7. Create Business Document for Purchase Receipt
    v_sequence := core.claim_next_document_number('PURCHASE_RECEIPT', v_fiscal_year);
    v_document_number := 'PR-' || v_fiscal_year || '-' || lpad(v_sequence::text, 6, '0');

    INSERT INTO core.business_documents (
        document_type, status, document_date, fiscal_period_id, fiscal_year,
        sequence_number, document_number, posted_at
    ) VALUES (
        'PURCHASE_RECEIPT', 'DRAFT', p_document_date, p_fiscal_period_id, v_fiscal_year,
        NULL, NULL, NULL
    ) RETURNING id INTO v_receipt_document_id;

    -- 8. Insert Purchase Receipt Header
    INSERT INTO procurement.purchase_receipts (
        document_id, receipt_origin, purchase_order_id, supplier_id, warehouse_id,
        subtotal, total_amount, posted_by_user_id, workstation_id
    ) VALUES (
        v_receipt_document_id, 'DIRECT_PURCHASE', NULL, p_supplier_id, p_warehouse_id,
        0.00, 0.00, v_user_id, v_workstation_id
    );

    -- 9. Process Lines
    FOR v_input_line IN SELECT * FROM jsonb_array_elements(v_lines)
    LOOP
        v_line_number := v_line_number + 1;
        v_variant_id := (v_input_line->>'variant_id')::bigint;
        v_unit_id := (v_input_line->>'unit_id')::bigint;
        v_qty_received := (v_input_line->>'quantity_received')::numeric;
        v_unit_cost := (v_input_line->>'unit_cost')::numeric(14, 2);
        v_pack_rate_of_unit_id := (v_input_line->>'pack_rate_of_unit_id')::bigint;

        IF v_variant_id IS NULL OR v_variant_id <= 0 THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: Line % has invalid variant', v_line_number USING ERRCODE = '22023';
        END IF;
        IF v_unit_id IS NULL OR v_unit_id <= 0 THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: Line % has invalid unit', v_line_number USING ERRCODE = '22023';
        END IF;
        IF v_qty_received IS NULL OR v_qty_received <= 0 THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: Line % quantity must be positive', v_line_number USING ERRCODE = '22023';
        END IF;
        IF v_unit_cost IS NULL OR v_unit_cost < 0 THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: Line % unit cost cannot be negative', v_line_number USING ERRCODE = '22023';
        END IF;

        -- Validate Variant & Unit
        SELECT pv.base_unit_id, (p.is_active AND pv.is_active)
        INTO v_base_unit_id, v_variant_active
        FROM catalog.product_variants pv
        JOIN catalog.products p ON p.id = pv.product_id
        WHERE pv.id = v_variant_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: Variant % not found', v_variant_id USING ERRCODE = '22023';
        END IF;
        IF NOT v_variant_active THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: Variant % or its product is inactive', v_variant_id USING ERRCODE = '22023';
        END IF;

        -- Resolve Unit Conversion
        IF v_unit_id = v_base_unit_id THEN
            v_conversion_factor := 1.0;
        ELSE
            SELECT conversion_factor
            INTO v_conversion_factor
            FROM catalog.variant_units
            WHERE variant_id = v_variant_id
              AND unit_id = v_unit_id
            FOR SHARE;

            IF NOT FOUND OR v_conversion_factor IS NULL OR v_conversion_factor <= 0 THEN
                RAISE EXCEPTION 'VALIDATION_ERROR: No unit conversion for variant % from unit % to base unit %',
                    v_variant_id, v_unit_id, v_base_unit_id USING ERRCODE = '22023';
            END IF;
        END IF;

        v_base_qty_received := round(v_qty_received * v_conversion_factor, 3);
        v_line_total := round(v_qty_received * v_unit_cost, 2);
        v_value_delta := v_line_total;
        v_receipt_subtotal := v_receipt_subtotal + v_line_total;

        -- Lock or create the position before calculating its resulting balance.
        INSERT INTO inventory.positions (warehouse_id, variant_id)
        VALUES (p_warehouse_id, v_variant_id)
        ON CONFLICT (warehouse_id, variant_id) DO NOTHING;

        SELECT quantity_on_hand, total_value, last_known_wac
        INTO v_old_qty, v_old_value, v_old_wac
        FROM inventory.positions
        WHERE warehouse_id = p_warehouse_id AND variant_id = v_variant_id
        FOR UPDATE;

        v_new_qty := v_old_qty + v_base_qty_received;
        v_new_value := v_old_value + v_value_delta;
        v_new_wac := CASE WHEN v_new_qty > 0 THEN round(v_new_value / v_new_qty, 6) ELSE v_old_wac END;

        UPDATE inventory.positions
        SET quantity_on_hand = v_new_qty,
            total_value = v_new_value,
            last_known_wac = v_new_wac,
            updated_at = now()
        WHERE warehouse_id = p_warehouse_id AND variant_id = v_variant_id;

        INSERT INTO inventory.movements (
            warehouse_id, variant_id, movement_type, quantity_delta,
            inventory_value_delta, resulting_quantity_on_hand,
            resulting_total_value, reference_type, reference_id
        ) VALUES (
            p_warehouse_id, v_variant_id, 'RECEIPT', v_base_qty_received,
            v_value_delta, v_new_qty, v_new_value,
            'PURCHASE_RECEIPT', v_receipt_document_id
        ) RETURNING id INTO v_movement_id;

        -- Insert Purchase Receipt Line
        INSERT INTO procurement.purchase_receipt_lines (
            document_id, line_number, po_line_id, variant_id, unit_id,
            quantity_received, unit_cost, line_total, movement_id,
            pack_rate_of_unit_id
        ) VALUES (
            v_receipt_document_id, v_line_number, NULL, v_variant_id, v_unit_id,
            v_qty_received, v_unit_cost, v_line_total, v_movement_id,
            v_pack_rate_of_unit_id
        );
    END LOOP;

    -- 10. Update Receipt Header Totals
    UPDATE procurement.purchase_receipts
    SET subtotal = v_receipt_subtotal,
        total_amount = v_receipt_subtotal
    WHERE document_id = v_receipt_document_id;

    -- 11. Create Balanced Journal Entry (Dr INVENTORY / Cr GRNI)
    v_journal_document_id := finance.create_posted_journal(
        p_document_date,
        p_fiscal_period_id,
        COALESCE(p_note, 'Direct purchase goods receipt'),
        'PURCHASE_RECEIPT',
        v_receipt_document_id
    );

    INSERT INTO finance.journal_lines (document_id, line_number, account_code, debit, credit)
    VALUES
        (v_journal_document_id, 1, finance.require_account_role('INVENTORY'), v_receipt_subtotal, 0),
        (v_journal_document_id, 2, finance.require_account_role('GRNI'), 0, v_receipt_subtotal);

    UPDATE procurement.purchase_receipts
    SET journal_document_id = v_journal_document_id
    WHERE document_id = v_receipt_document_id;

    UPDATE core.business_documents
    SET status = 'POSTED',
        sequence_number = v_sequence,
        document_number = v_document_number,
        posted_at = now()
    WHERE id = v_receipt_document_id;

    -- 12. Record Idempotency Result
    PERFORM core.record_idempotent_result(
        'inventory.confirm_direct_purchase', p_request_id, v_receipt_document_id
    );

    RETURN inventory._purchase_receipt_response(v_receipt_document_id);
END;
$$;
REVOKE ALL ON FUNCTION inventory.confirm_direct_purchase(text, uuid, bytea, bigint, bigint, bigint, date, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inventory.confirm_direct_purchase(text, uuid, bytea, bigint, bigint, bigint, date, text, jsonb) TO stockiha_runtime;

-- ============================================================================
-- 4. Update procurement.list_purchase_product_options with packs & barcodes
-- ============================================================================

CREATE OR REPLACE FUNCTION procurement.list_purchase_product_options(
    p_session_token text
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
    SELECT user_id INTO v_user_id FROM iam.resolve_session(p_session_token);
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'SESSION_INVALID: Session is invalid or expired' USING ERRCODE = '28000';
    END IF;

    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'product_id', p.id,
            'variant_id', pv.id,
            'sku', pv.sku,
            'product_name', p.name,
            'variant_name', catalog._effective_variant_name(pv.id),
            'primary_barcode', (
                SELECT barcode FROM catalog.variant_barcodes vb
                WHERE vb.variant_id = pv.id AND vb.is_primary = true
                LIMIT 1
            ),
            'brand', CASE WHEN b.id IS NOT NULL THEN jsonb_build_object('id', b.id, 'name', b.name) ELSE NULL END,
            'default_unit_id', u.id,
            'default_unit_code', u.code,
            'default_unit_name', u.name,
            'primary_pack_unit_id', (
                SELECT vu.unit_id
                FROM catalog.variant_units vu
                WHERE vu.variant_id = pv.id AND vu.is_primary = true AND vu.is_active = true
                LIMIT 1
            ),
            'alternate_units', coalesce((
                SELECT jsonb_agg(jsonb_build_object(
                    'variant_unit_id', vu.id,
                    'unit_id', vu.unit_id,
                    'unit_code', vu_u.code,
                    'unit_name', vu_u.name,
                    'conversion_factor', vu.conversion_factor::text,
                    'is_primary', vu.is_primary,
                    'barcode', (
                        SELECT vb.barcode
                        FROM catalog.variant_barcodes vb
                        WHERE vb.variant_unit_id = vu.id
                        LIMIT 1
                    ),
                    'sale_price', vu.sale_price::text
                ) ORDER BY vu.conversion_factor ASC, vu.id ASC)
                FROM catalog.variant_units vu
                JOIN catalog.units vu_u ON vu_u.id = vu.unit_id
                WHERE vu.variant_id = pv.id AND vu.is_active = true
            ), '[]'::jsonb),
            'attributes', coalesce((
                SELECT jsonb_agg(jsonb_build_object('name', a.name, 'value', val.value))
                FROM catalog.variant_attribute_values vav
                JOIN catalog.attribute_values val ON val.id = vav.attribute_value_id
                JOIN catalog.attributes a ON a.id = val.attribute_id
                WHERE vav.variant_id = pv.id
            ), '[]'::jsonb),
            'is_active', (p.is_active AND pv.is_active)
        ) ORDER BY p.name, pv.sku
    ), '[]'::jsonb) INTO v_result
    FROM catalog.product_variants pv
    JOIN catalog.products p ON p.id = pv.product_id
    JOIN catalog.units u ON u.id = p.unit_id
    LEFT JOIN catalog.brands b ON b.id = p.brand_id
    WHERE p.is_active = true AND pv.is_active = true;

    RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION procurement.list_purchase_product_options(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION procurement.list_purchase_product_options(text) TO stockiha_runtime, stockiha_owner;

-- ============================================================================
-- 5. Update procurement.list_purchase_receipt_lines with pack rate information
-- ============================================================================

CREATE OR REPLACE FUNCTION procurement.list_purchase_receipt_lines(
    p_session_token text,
    p_purchase_order_id bigint DEFAULT NULL::bigint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_result jsonb;
BEGIN
    PERFORM 1
    FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_PROCUREMENT');

    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'receipt_line_id', receipt_line.id,
            'receipt_document_id', receipt.document_id,
            'receipt_document_number', receipt_document.document_number,
            'receipt_origin', receipt.receipt_origin,
            'purchase_order_id', receipt.purchase_order_id,
            'purchase_order_number', po_document.document_number,
            'po_line_id', receipt_line.po_line_id,
            'supplier_id', receipt.supplier_id,
            'supplier_name', supplier.name,
            'warehouse_id', receipt.warehouse_id,
            'warehouse_name', warehouse.name,
            'variant_id', receipt_line.variant_id,
            'variant_sku', variant.sku,
            'variant_name', product.name,
            'unit_id', receipt_line.unit_id,
            'unit_code', unit.code,
            'unit_name', unit.name,
            'pack_rate_of_unit_id', receipt_line.pack_rate_of_unit_id,
            'pack_rate_unit_name', pack_rate_unit.name,
            'quantity_received', receipt_line.quantity_received::text,
            'quantity_invoiced', coalesce(invoice_totals.quantity_invoiced, 0)::text,
            'quantity_available_to_invoice', greatest(
                receipt_line.quantity_received - coalesce(invoice_totals.quantity_invoiced, 0),
                0
            )::text,
            'quantity_returned_for_variant', coalesce(return_totals.quantity_returned, 0)::text,
            'stock_on_hand', coalesce(pos.quantity_on_hand, 0)::text,
            'outstanding_liability', coalesce(liability_info.outstanding_amount, 0)::text,
            'invoice_count', coalesce(invoice_info.invoice_count, 0),
            'eligibility_code', CASE
                WHEN coalesce(invoice_info.invoice_count, 0) > 1 THEN 'AMBIGUOUS_INVOICES'
                WHEN coalesce(pos.quantity_on_hand, 0) <= 0 THEN 'INSUFFICIENT_STOCK'
                WHEN coalesce(received_totals.quantity_received, 0) - coalesce(return_totals.quantity_returned, 0) <= 0 THEN 'NO_RETURNABLE_QUANTITY'
                WHEN coalesce(invoice_info.invoice_count, 0) = 1 AND coalesce(liability_info.outstanding_amount, 0) <= 0 THEN 'INSUFFICIENT_LIABILITY'
                ELSE 'ELIGIBLE'
            END,
            'quantity_returnable_for_variant', greatest(
                CASE
                    WHEN coalesce(invoice_info.invoice_count, 0) > 1 THEN 0
                    WHEN coalesce(invoice_info.invoice_count, 0) = 1 AND coalesce(liability_info.outstanding_amount, 0) <= 0 THEN 0
                    ELSE LEAST(
                        greatest(coalesce(received_totals.quantity_received, 0) - coalesce(return_totals.quantity_returned, 0), 0),
                        greatest(coalesce(pos.quantity_on_hand, 0), 0)
                    )
                END,
                0
            )::text,
            'unit_cost', receipt_line.unit_cost::text,
            'line_total', receipt_line.line_total::text
        ) ORDER BY receipt_document.posted_at DESC, receipt_line.id
    ), '[]'::jsonb) INTO v_result
    FROM procurement.purchase_receipt_lines receipt_line
    JOIN procurement.purchase_receipts receipt
      ON receipt.document_id = receipt_line.document_id
    JOIN core.business_documents receipt_document
      ON receipt_document.id = receipt.document_id
     AND receipt_document.status = 'POSTED'
    LEFT JOIN procurement.purchase_orders purchase_order
      ON purchase_order.document_id = receipt.purchase_order_id
    LEFT JOIN core.business_documents po_document
      ON po_document.id = purchase_order.document_id
    JOIN procurement.suppliers supplier ON supplier.id = receipt.supplier_id
    JOIN inventory.warehouses warehouse ON warehouse.id = receipt.warehouse_id
    JOIN catalog.product_variants variant ON variant.id = receipt_line.variant_id
    JOIN catalog.products product ON product.id = variant.product_id
    JOIN catalog.units unit ON unit.id = receipt_line.unit_id
    LEFT JOIN catalog.units pack_rate_unit ON pack_rate_unit.id = receipt_line.pack_rate_of_unit_id
    LEFT JOIN inventory.positions pos
      ON pos.warehouse_id = receipt.warehouse_id AND pos.variant_id = receipt_line.variant_id
    LEFT JOIN LATERAL (
        SELECT count(DISTINCT inv.document_id) AS invoice_count, min(inv.document_id) AS invoice_doc_id
        FROM procurement.supplier_invoices inv
        JOIN core.business_documents bd ON bd.id = inv.document_id AND bd.status = 'POSTED'
        WHERE (
            (receipt.purchase_order_id IS NOT NULL AND inv.purchase_order_id = receipt.purchase_order_id)
            OR (receipt.purchase_order_id IS NULL AND inv.document_id IN (
                SELECT sil.document_id FROM procurement.supplier_invoice_lines sil
                WHERE sil.receipt_line_id IN (
                    SELECT id FROM procurement.purchase_receipt_lines WHERE document_id = receipt.document_id
                )
            ))
        )
        AND inv.supplier_id = receipt.supplier_id
    ) invoice_info ON true
    LEFT JOIN LATERAL (
        SELECT l.id, l.outstanding_amount
        FROM procurement.supplier_liabilities l
        WHERE l.invoice_document_id = invoice_info.invoice_doc_id
          AND l.supplier_id = receipt.supplier_id
    ) liability_info ON true
    LEFT JOIN LATERAL (
        SELECT sum(invoice_line.quantity) AS quantity_invoiced
        FROM procurement.supplier_invoice_lines invoice_line
        JOIN core.business_documents invoice_document
          ON invoice_document.id = invoice_line.document_id
         AND invoice_document.status = 'POSTED'
        WHERE invoice_line.receipt_line_id = receipt_line.id
    ) invoice_totals ON true
    LEFT JOIN LATERAL (
        SELECT sum(return_line.quantity) AS quantity_returned
        FROM procurement.supplier_return_lines return_line
        JOIN procurement.supplier_returns return_hdr
          ON return_hdr.id = return_line.return_id
        JOIN core.business_documents return_document
          ON return_document.id = return_hdr.document_id
         AND return_document.status = 'POSTED'
        WHERE (
            (receipt.purchase_order_id IS NOT NULL AND return_hdr.purchase_order_id = receipt.purchase_order_id)
            OR (receipt.purchase_order_id IS NULL AND return_hdr.receipt_document_id = receipt.document_id)
        )
        AND return_hdr.supplier_id = receipt.supplier_id
        AND return_hdr.warehouse_id = receipt.warehouse_id
        AND return_line.variant_id = receipt_line.variant_id
    ) return_totals ON true
    LEFT JOIN LATERAL (
        SELECT sum(other_receipt_line.quantity_received) AS quantity_received
        FROM procurement.purchase_receipt_lines other_receipt_line
        JOIN procurement.purchase_receipts other_receipt
          ON other_receipt.document_id = other_receipt_line.document_id
        JOIN core.business_documents other_document
          ON other_document.id = other_receipt.document_id
         AND other_document.status = 'POSTED'
        WHERE (
            (receipt.purchase_order_id IS NOT NULL AND other_receipt.purchase_order_id = receipt.purchase_order_id)
            OR (receipt.purchase_order_id IS NULL AND other_receipt.document_id = receipt.document_id)
        )
        AND other_receipt.supplier_id = receipt.supplier_id
        AND other_receipt.warehouse_id = receipt.warehouse_id
        AND other_receipt_line.variant_id = receipt_line.variant_id
    ) received_totals ON true
    WHERE (p_purchase_order_id IS NULL OR receipt.purchase_order_id = p_purchase_order_id);

    RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION procurement.list_purchase_receipt_lines(text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION procurement.list_purchase_receipt_lines(text, bigint) TO stockiha_runtime, stockiha_owner;

UPDATE operations.schema_state SET migration_version = 20260930140000, updated_at = now() WHERE singleton;

RESET ROLE;
