-- Migration: 20260816150000_direct_purchase_foundation.sql
-- Stockiha Direct Purchasing Policy Implementation (Part 1)
-- 1. Generalize purchase_receipts and purchase_receipt_lines schema for direct purchases.
-- 2. Update inventory._purchase_receipt_response to support nullable purchase_order_id.
-- 3. Create inventory.confirm_direct_purchase atomic posting function.
-- 4. Update procurement.list_purchase_receipts and procurement.list_purchase_receipt_lines.
-- 5. Update procurement.confirm_supplier_invoice and inventory.confirm_supplier_return.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stockiha_owner') THEN
        EXECUTE 'SET ROLE stockiha_owner';
    END IF;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

-- 1. Schema Generalization
-- 1.1 purchase_receipts receipt_origin and nullable purchase_order_id
ALTER TABLE procurement.purchase_receipts
    ADD COLUMN IF NOT EXISTS receipt_origin text NOT NULL DEFAULT 'DIRECT_PURCHASE';

ALTER TABLE procurement.purchase_receipts
    DROP CONSTRAINT IF EXISTS pr_receipt_origin_valid;
ALTER TABLE procurement.purchase_receipts
    ADD CONSTRAINT pr_receipt_origin_valid
    CHECK (receipt_origin IN ('DIRECT_PURCHASE', 'PURCHASE_ORDER'));

-- Backfill existing historical purchase receipts as PURCHASE_ORDER
UPDATE procurement.purchase_receipts
SET receipt_origin = 'PURCHASE_ORDER'
WHERE purchase_order_id IS NOT NULL;

ALTER TABLE procurement.purchase_receipts
    ALTER COLUMN purchase_order_id DROP NOT NULL;

ALTER TABLE procurement.purchase_receipts
    DROP CONSTRAINT IF EXISTS pr_origin_po_invariant;
ALTER TABLE procurement.purchase_receipts
    ADD CONSTRAINT pr_origin_po_invariant
    CHECK (
        (receipt_origin = 'DIRECT_PURCHASE' AND purchase_order_id IS NULL) OR
        (receipt_origin = 'PURCHASE_ORDER' AND purchase_order_id IS NOT NULL)
    );

-- 1.2 purchase_receipt_lines nullable po_line_id
ALTER TABLE procurement.purchase_receipt_lines
    ALTER COLUMN po_line_id DROP NOT NULL;

-- 1.3 supplier_returns optional receipt_document_id reference
ALTER TABLE procurement.supplier_returns
    ADD COLUMN IF NOT EXISTS receipt_document_id bigint REFERENCES procurement.purchase_receipts(document_id) ON DELETE RESTRICT;

-- 2. Update inventory._purchase_receipt_response helper
CREATE OR REPLACE FUNCTION inventory._purchase_receipt_response(p_document_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_result jsonb;
BEGIN
    SELECT jsonb_build_object(
        'document_id', pr.document_id,
        'document_number', bd.document_number,
        'receipt_origin', pr.receipt_origin,
        'purchase_order_id', pr.purchase_order_id,
        'purchase_order_number', po_bd.document_number,
        'supplier_id', pr.supplier_id,
        'warehouse_id', pr.warehouse_id,
        'total_amount', pr.total_amount::text,
        'journal_document_id', pr.journal_document_id,
        'journal_document_number', j_bd.document_number,
        'order_status', COALESCE(po.status, 'POSTED'),
        'posted_at', bd.posted_at
    ) INTO v_result
    FROM procurement.purchase_receipts pr
    JOIN core.business_documents bd ON bd.id = pr.document_id
    LEFT JOIN procurement.purchase_orders po ON po.document_id = pr.purchase_order_id
    LEFT JOIN core.business_documents po_bd ON po_bd.id = po.document_id
    LEFT JOIN core.business_documents j_bd ON j_bd.id = pr.journal_document_id
    WHERE pr.document_id = p_document_id;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION inventory._purchase_receipt_response(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inventory._purchase_receipt_response(bigint) TO stockiha_runtime;

-- 3. Direct Purchase Authoritative Posting Function
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
    v_input_line jsonb;
    v_line_number integer := 0;
    v_variant_id bigint;
    v_unit_id bigint;
    v_qty_received numeric;
    v_unit_cost numeric(14, 2);
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

    -- 5. Validate Lines
    IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Direct purchase requires at least one product line' USING ERRCODE = '22023';
    END IF;

    -- 6. Deterministic Row Locking on inventory.positions
    PERFORM 1
    FROM inventory.positions pos
    WHERE pos.warehouse_id = p_warehouse_id
      AND pos.variant_id IN (
          SELECT (elem->>'variant_id')::bigint
          FROM jsonb_array_elements(p_lines) elem
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
        'PURCHASE_RECEIPT', 'POSTED', p_document_date, p_fiscal_period_id, v_fiscal_year,
        v_sequence, v_document_number, now()
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
    FOR v_input_line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
        v_line_number := v_line_number + 1;
        v_variant_id := (v_input_line->>'variant_id')::bigint;
        v_unit_id := (v_input_line->>'unit_id')::bigint;
        v_qty_received := (v_input_line->>'quantity_received')::numeric;
        v_unit_cost := (v_input_line->>'unit_cost')::numeric(14, 2);

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
        SELECT p.unit_id, (p.is_active AND pv.is_active)
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
            FROM catalog.unit_conversions
            WHERE variant_id = v_variant_id
              AND from_unit_id = v_unit_id
              AND to_unit_id = v_base_unit_id;

            IF NOT FOUND THEN
                SELECT conversion_factor
                INTO v_conversion_factor
                FROM catalog.unit_conversions
                WHERE product_id = (SELECT product_id FROM catalog.product_variants WHERE id = v_variant_id)
                  AND variant_id IS NULL
                  AND from_unit_id = v_unit_id
                  AND to_unit_id = v_base_unit_id;
            END IF;

            IF NOT FOUND OR v_conversion_factor IS NULL OR v_conversion_factor <= 0 THEN
                RAISE EXCEPTION 'VALIDATION_ERROR: No unit conversion for variant % from unit % to base unit %',
                    v_variant_id, v_unit_id, v_base_unit_id USING ERRCODE = '22023';
            END IF;
        END IF;

        v_base_qty_received := round(v_qty_received * v_conversion_factor, 3);
        v_line_total := round(v_qty_received * v_unit_cost, 2);
        v_value_delta := v_line_total;
        v_receipt_subtotal := v_receipt_subtotal + v_line_total;

        -- Insert Inventory Movement
        INSERT INTO inventory.movements (
            warehouse_id, variant_id, movement_type,
            quantity_delta, value_delta, unit_cost,
            reference_document_id, created_by_user_id
        ) VALUES (
            p_warehouse_id, v_variant_id, 'PURCHASE_RECEIPT',
            v_base_qty_received, v_value_delta, v_unit_cost,
            v_receipt_document_id, v_user_id
        ) RETURNING id INTO v_movement_id;

        -- Update Inventory Position & Recalculate WAC
        SELECT quantity_on_hand, total_value, current_wac
        INTO v_old_qty, v_old_value, v_old_wac
        FROM inventory.positions
        WHERE warehouse_id = p_warehouse_id AND variant_id = v_variant_id
        FOR UPDATE;

        IF NOT FOUND THEN
            v_new_qty := v_base_qty_received;
            v_new_value := v_value_delta;
            v_new_wac := round(v_new_value / v_new_qty, 6);

            INSERT INTO inventory.positions (
                warehouse_id, variant_id, quantity_on_hand, total_value, current_wac
            ) VALUES (
                p_warehouse_id, v_variant_id, v_new_qty, v_new_value, v_new_wac
            );
        ELSE
            v_new_qty := v_old_qty + v_base_qty_received;
            v_new_value := v_old_value + v_value_delta;
            IF v_new_qty > 0 THEN
                v_new_wac := round(v_new_value / v_new_qty, 6);
            ELSE
                v_new_wac := v_old_wac;
            END IF;

            UPDATE inventory.positions
            SET quantity_on_hand = v_new_qty,
                total_value = v_new_value,
                current_wac = v_new_wac,
                updated_at = now()
            WHERE warehouse_id = p_warehouse_id AND variant_id = v_variant_id;
        END IF;

        -- Insert Purchase Receipt Line
        INSERT INTO procurement.purchase_receipt_lines (
            document_id, line_number, po_line_id, variant_id, unit_id,
            quantity_received, unit_cost, line_total, movement_id
        ) VALUES (
            v_receipt_document_id, v_line_number, NULL, v_variant_id, v_unit_id,
            v_qty_received, v_unit_cost, v_line_total, v_movement_id
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

    PERFORM finance.add_journal_line(
        v_journal_document_id,
        1,
        'INVENTORY_MERCHANDISE',
        v_receipt_subtotal,
        0.00,
        'Direct purchase inventory debit'
    );

    PERFORM finance.add_journal_line(
        v_journal_document_id,
        2,
        'GRNI',
        0.00,
        v_receipt_subtotal,
        'Direct purchase un-invoiced goods receipt credit'
    );

    UPDATE procurement.purchase_receipts
    SET journal_document_id = v_journal_document_id
    WHERE document_id = v_receipt_document_id;

    -- 12. Record Idempotency Result
    PERFORM core.store_idempotent_result(
        'inventory.confirm_direct_purchase', p_request_id, v_receipt_document_id
    );

    RETURN inventory._purchase_receipt_response(v_receipt_document_id);
END;
$$;

REVOKE ALL ON FUNCTION inventory.confirm_direct_purchase(text, uuid, bytea, bigint, bigint, bigint, date, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inventory.confirm_direct_purchase(text, uuid, bytea, bigint, bigint, bigint, date, text, jsonb) TO stockiha_runtime;

-- 4. Update procurement.list_purchase_receipts
CREATE OR REPLACE FUNCTION procurement.list_purchase_receipts(
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
    v_result jsonb;
BEGIN
    PERFORM 1
    FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_PROCUREMENT');

    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'document_id', receipt.document_id,
            'document_number', document.document_number,
            'receipt_origin', receipt.receipt_origin,
            'purchase_order_id', receipt.purchase_order_id,
            'purchase_order_number', po_document.document_number,
            'supplier_id', receipt.supplier_id,
            'supplier_name', supplier.name,
            'warehouse_id', receipt.warehouse_id,
            'warehouse_name', warehouse.name,
            'total_amount', receipt.total_amount::text,
            'journal_document_id', receipt.journal_document_id,
            'journal_document_number', receipt_journal_document.document_number,
            'landed_cost_amount', landed.amount::text,
            'landed_cost_journal_id', landed.journal_document_id,
            'landed_cost_journal_number', landed_journal_document.document_number,
            'posted_at', document.posted_at
        ) ORDER BY document.posted_at DESC, receipt.document_id DESC
    ), '[]'::jsonb) INTO v_result
    FROM procurement.purchase_receipts receipt
    JOIN core.business_documents document ON document.id = receipt.document_id
    LEFT JOIN procurement.purchase_orders purchase_order
      ON purchase_order.document_id = receipt.purchase_order_id
    LEFT JOIN core.business_documents po_document
      ON po_document.id = purchase_order.document_id
    JOIN procurement.suppliers supplier ON supplier.id = receipt.supplier_id
    JOIN inventory.warehouses warehouse ON warehouse.id = receipt.warehouse_id
    LEFT JOIN core.business_documents receipt_journal_document
      ON receipt_journal_document.id = receipt.journal_document_id
    LEFT JOIN procurement.landed_cost_postings landed
      ON landed.receipt_document_id = receipt.document_id
    LEFT JOIN core.business_documents landed_journal_document
      ON landed_journal_document.id = landed.journal_document_id
    WHERE (p_supplier_id IS NULL OR receipt.supplier_id = p_supplier_id)
      AND (p_purchase_order_id IS NULL OR receipt.purchase_order_id = p_purchase_order_id);

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION procurement.list_purchase_receipts(text, bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION procurement.list_purchase_receipts(text, bigint, bigint) TO stockiha_runtime;

-- 5. Update procurement.list_purchase_receipt_lines
CREATE OR REPLACE FUNCTION procurement.list_purchase_receipt_lines(
    p_session_token text,
    p_purchase_order_id bigint DEFAULT NULL
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
GRANT EXECUTE ON FUNCTION procurement.list_purchase_receipt_lines(text, bigint) TO stockiha_runtime;

-- 6. Update procurement.confirm_supplier_invoice (Allowing Direct Purchase Receipts)
CREATE OR REPLACE FUNCTION procurement.confirm_supplier_invoice(
    p_session_token text,
    p_request_id uuid,
    p_payload_hash bytea,
    p_invoice_doc_id bigint,
    p_fiscal_period_id bigint,
    p_document_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_workstation_id text;
    v_existing_document_id bigint;
    v_supplier_id bigint;
    v_purchase_order_id bigint;
    v_invoice_status text;
    v_base_total numeric(14,2);
    v_foreign_subtotal numeric(14,2);
    v_foreign_total numeric(14,2);
    v_base_subtotal numeric(14,2);
    v_period_status text;
    v_period_start date;
    v_period_end date;
    v_fiscal_year integer := extract(year FROM p_document_date)::integer;
    v_invoice_sequence bigint;
    v_invoice_number text;
    v_journal_document_id bigint;
    v_grni_amount numeric(14,2);
    v_variance numeric(14,2);
    v_line_number integer := 1;
BEGIN
    SELECT user_id, workstation_id
    INTO v_user_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'POST_SUPPLIER_INVOICE');

    v_existing_document_id := core.reserve_idempotent_request(
        'procurement.confirm_supplier_invoice', p_request_id, p_payload_hash
    );
    IF v_existing_document_id IS NOT NULL THEN
        SELECT bd.document_number, l.journal_document_id
        INTO v_invoice_number, v_journal_document_id
        FROM core.business_documents bd
        LEFT JOIN procurement.supplier_liabilities l
          ON l.invoice_document_id = bd.id
        WHERE bd.id = v_existing_document_id;

        RETURN jsonb_build_object(
            'document_id', v_existing_document_id,
            'document_number', v_invoice_number,
            'status', 'POSTED',
            'journal_document_id', v_journal_document_id
        );
    END IF;

    SELECT bd.status, inv.supplier_id, inv.purchase_order_id,
           inv.base_total_amount, inv.foreign_subtotal,
           inv.foreign_total_amount, inv.base_subtotal
    INTO v_invoice_status, v_supplier_id, v_purchase_order_id,
         v_base_total, v_foreign_subtotal, v_foreign_total, v_base_subtotal
    FROM core.business_documents bd
    JOIN procurement.supplier_invoices inv ON inv.document_id = bd.id
    WHERE bd.id = p_invoice_doc_id
    FOR UPDATE OF bd;

    IF NOT FOUND OR v_invoice_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Invoice % is not in DRAFT status', p_invoice_doc_id USING ERRCODE = '55000';
    END IF;
    IF v_base_total <= 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Supplier invoice total must be positive' USING ERRCODE = '22023';
    END IF;
    IF v_foreign_total <> v_foreign_subtotal OR v_base_total <> v_base_subtotal THEN
        RAISE EXCEPTION 'TAX_DISCOUNT_DISABLED: TVA and discounts are not enabled for the MVP' USING ERRCODE = '0A000';
    END IF;

    SELECT status, starts_on, ends_on
    INTO v_period_status, v_period_start, v_period_end
    FROM finance.fiscal_periods
    WHERE id = p_fiscal_period_id
    FOR SHARE;
    IF NOT FOUND OR v_period_status <> 'OPEN' THEN
        RAISE EXCEPTION 'CLOSED_FISCAL_PERIOD: Fiscal period % is not open', p_fiscal_period_id USING ERRCODE = '55000';
    END IF;
    IF p_document_date < v_period_start OR p_document_date > v_period_end THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Document date is outside fiscal period' USING ERRCODE = '22023';
    END IF;

    -- Lock matched receipt lines
    PERFORM 1
    FROM procurement.purchase_receipt_lines prl
    WHERE prl.id IN (
        SELECT sil.receipt_line_id
        FROM procurement.supplier_invoice_lines sil
        WHERE sil.document_id = p_invoice_doc_id
    )
    ORDER BY prl.id
    FOR UPDATE;

    IF NOT EXISTS (
        SELECT 1 FROM procurement.supplier_invoice_lines WHERE document_id = p_invoice_doc_id
    ) THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Supplier invoice requires at least one line' USING ERRCODE = '22023';
    END IF;

    -- Match verification
    IF EXISTS (
        SELECT 1
        FROM procurement.supplier_invoice_lines sil
        LEFT JOIN procurement.purchase_receipt_lines prl ON prl.id = sil.receipt_line_id
        LEFT JOIN procurement.purchase_receipts pr ON pr.document_id = prl.document_id
        WHERE sil.document_id = p_invoice_doc_id
          AND (
              sil.receipt_line_id IS NULL
              OR prl.id IS NULL
              OR (v_purchase_order_id IS NOT NULL AND pr.purchase_order_id IS NOT NULL AND pr.purchase_order_id <> v_purchase_order_id)
              OR pr.supplier_id <> v_supplier_id
              OR prl.variant_id <> sil.variant_id
              OR (sil.po_line_id IS NOT NULL AND prl.po_line_id IS NOT NULL AND sil.po_line_id <> prl.po_line_id)
          )
    ) THEN
        RAISE EXCEPTION 'THREE_WAY_MATCH_FAILED: Every invoice line must match a valid receipt line for the same supplier'
            USING ERRCODE = '55000';
    END IF;

    -- Over-invoicing check
    IF EXISTS (
        SELECT 1
        FROM procurement.supplier_invoice_lines current_line
        JOIN procurement.purchase_receipt_lines prl ON prl.id = current_line.receipt_line_id
        WHERE current_line.document_id = p_invoice_doc_id
          AND current_line.quantity + COALESCE((
              SELECT sum(other_line.quantity)
              FROM procurement.supplier_invoice_lines other_line
              JOIN core.business_documents other_doc ON other_doc.id = other_line.document_id
              WHERE other_line.receipt_line_id = current_line.receipt_line_id
                AND other_line.document_id <> p_invoice_doc_id
                AND other_doc.status = 'POSTED'
          ), 0) > prl.quantity_received
    ) THEN
        RAISE EXCEPTION 'THREE_WAY_MATCH_FAILED: Invoiced quantity exceeds received quantity' USING ERRCODE = '55000';
    END IF;

    SELECT round(coalesce(sum(sil.quantity * prl.unit_cost), 2), 2)
    INTO v_grni_amount
    FROM procurement.supplier_invoice_lines sil
    JOIN procurement.purchase_receipt_lines prl ON prl.id = sil.receipt_line_id
    WHERE sil.document_id = p_invoice_doc_id;

    v_variance := round(v_base_total - v_grni_amount, 2);

    v_invoice_sequence := core.claim_next_document_number('PURCHASE_INVOICE', v_fiscal_year);
    v_invoice_number := 'PI-' || v_fiscal_year || '-' || lpad(v_invoice_sequence::text, 6, '0');

    v_journal_document_id := finance.create_posted_journal(
        p_document_date,
        p_fiscal_period_id,
        'Supplier invoice ' || v_invoice_number,
        'PURCHASE_INVOICE',
        p_invoice_doc_id
    );

    PERFORM finance.add_journal_line(
        v_journal_document_id,
        v_line_number,
        'GRNI',
        v_grni_amount,
        0.00,
        'Clear goods received not invoiced'
    );
    v_line_number := v_line_number + 1;

    IF v_variance > 0 THEN
        PERFORM finance.add_journal_line(
            v_journal_document_id,
            v_line_number,
            'PURCHASE_PRICE_VARIANCE',
            v_variance,
            0.00,
            'Purchase price unfavorable variance'
        );
        v_line_number := v_line_number + 1;
    ELSIF v_variance < 0 THEN
        PERFORM finance.add_journal_line(
            v_journal_document_id,
            v_line_number,
            'PURCHASE_PRICE_VARIANCE',
            0.00,
            abs(v_variance),
            'Purchase price favorable variance'
        );
        v_line_number := v_line_number + 1;
    END IF;

    PERFORM finance.add_journal_line(
        v_journal_document_id,
        v_line_number,
        'ACCOUNTS_PAYABLE',
        0.00,
        v_base_total,
        'Supplier invoice accounts payable'
    );

    INSERT INTO procurement.supplier_liabilities (
        supplier_id,
        purchase_order_id,
        invoice_document_id,
        receipt_document_id,
        journal_document_id,
        original_amount,
        outstanding_amount,
        status,
        due_date
    ) VALUES (
        v_supplier_id,
        v_purchase_order_id,
        p_invoice_doc_id,
        NULL,
        v_journal_document_id,
        v_base_total,
        v_base_total,
        'UNPAID',
        p_document_date + 30
    );

    UPDATE core.business_documents
    SET status = 'POSTED',
        sequence_number = v_invoice_sequence,
        document_number = v_invoice_number,
        document_date = p_document_date,
        fiscal_period_id = p_fiscal_period_id,
        fiscal_year = v_fiscal_year,
        posted_at = now()
    WHERE id = p_invoice_doc_id;

    PERFORM core.store_idempotent_result(
        'procurement.confirm_supplier_invoice', p_request_id, p_invoice_doc_id
    );

    RETURN jsonb_build_object(
        'document_id', p_invoice_doc_id,
        'document_number', v_invoice_number,
        'status', 'POSTED',
        'journal_document_id', v_journal_document_id,
        'supplier_id', v_supplier_id,
        'total_amount', v_base_total::text,
        'grni_amount', v_grni_amount::text,
        'variance_amount', v_variance::text
    );
END;
$$;

REVOKE ALL ON FUNCTION procurement.confirm_supplier_invoice(text, uuid, bytea, bigint, bigint, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION procurement.confirm_supplier_invoice(text, uuid, bytea, bigint, bigint, date) TO stockiha_runtime;

-- 7. Update inventory.confirm_supplier_return (Allowing Direct Purchase Returns)
CREATE OR REPLACE FUNCTION inventory.confirm_supplier_return(
    p_session_token text,
    p_request_id uuid,
    p_request_hash bytea,
    p_return_doc_id bigint,
    p_fiscal_period_id bigint,
    p_document_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_workstation_id text;
    v_existing_document_id bigint;
    v_return_status text;
    v_return_id bigint;
    v_supplier_id bigint;
    v_warehouse_id bigint;
    v_purchase_order_id bigint;
    v_receipt_document_id bigint;
    v_period_status text;
    v_period_start date;
    v_period_end date;
    v_fiscal_year integer := extract(year FROM p_document_date)::integer;
    v_invoice_count integer;
    v_invoice_document_id bigint;
    v_liability_id bigint;
    v_liability_outstanding numeric(14,2);
    v_clearing_role finance.account_role_code;
    v_return_sequence bigint;
    v_return_number text;
    v_journal_document_id bigint;
    v_clearing_amount numeric(14,2) := 0;
    v_inventory_value numeric(14,2) := 0;
    v_variance numeric(14,2);
    v_line record;
    v_received_qty numeric(18,3);
    v_previously_returned_qty numeric(18,3);
    v_authoritative_unit_cost numeric(18,6);
    v_position_qty numeric(18,3);
    v_position_value numeric(18,4);
    v_wac numeric(18,6);
    v_issue_value numeric(14,2);
    v_movement_id bigint;
    v_journal_line_number integer := 1;
BEGIN
    SELECT user_id, workstation_id
    INTO v_user_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'POST_SUPPLIER_RETURN');

    v_existing_document_id := core.reserve_idempotent_request(
        'inventory.confirm_supplier_return', p_request_id, p_request_hash
    );
    IF v_existing_document_id IS NOT NULL THEN
        SELECT bd.document_number, je.document_id
        INTO v_return_number, v_journal_document_id
        FROM core.business_documents bd
        LEFT JOIN finance.journal_entries je
          ON je.source_type = 'PURCHASE_RETURN' AND je.source_id = bd.id
        WHERE bd.id = v_existing_document_id;
        RETURN jsonb_build_object(
            'document_id', v_existing_document_id,
            'document_number', v_return_number,
            'status', 'POSTED',
            'journal_document_id', v_journal_document_id
        );
    END IF;

    SELECT bd.status, sr.id, sr.supplier_id, sr.warehouse_id, sr.purchase_order_id, sr.receipt_document_id
    INTO v_return_status, v_return_id, v_supplier_id, v_warehouse_id, v_purchase_order_id, v_receipt_document_id
    FROM core.business_documents bd
    JOIN procurement.supplier_returns sr ON sr.document_id = bd.id
    WHERE bd.id = p_return_doc_id
    FOR UPDATE OF bd;

    IF NOT FOUND OR v_return_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Supplier return % is not in DRAFT status', p_return_doc_id USING ERRCODE = '55000';
    END IF;

    SELECT status, starts_on, ends_on
    INTO v_period_status, v_period_start, v_period_end
    FROM finance.fiscal_periods
    WHERE id = p_fiscal_period_id
    FOR SHARE;
    IF NOT FOUND OR v_period_status <> 'OPEN' THEN
        RAISE EXCEPTION 'CLOSED_FISCAL_PERIOD: Fiscal period % is not open', p_fiscal_period_id USING ERRCODE = '55000';
    END IF;
    IF p_document_date < v_period_start OR p_document_date > v_period_end THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Document date is outside fiscal period' USING ERRCODE = '22023';
    END IF;

    -- Count related invoices
    SELECT count(DISTINCT inv.document_id), min(inv.document_id)
    INTO v_invoice_count, v_invoice_document_id
    FROM procurement.supplier_invoices inv
    JOIN core.business_documents bd ON bd.id = inv.document_id AND bd.status = 'POSTED'
    WHERE (
        (v_purchase_order_id IS NOT NULL AND inv.purchase_order_id = v_purchase_order_id)
        OR (v_receipt_document_id IS NOT NULL AND inv.document_id IN (
            SELECT sil.document_id FROM procurement.supplier_invoice_lines sil
            WHERE sil.receipt_line_id IN (
                SELECT id FROM procurement.purchase_receipt_lines WHERE document_id = v_receipt_document_id
            )
        ))
    )
    AND inv.supplier_id = v_supplier_id;

    IF v_invoice_count > 1 THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Return allocation is ambiguous across multiple supplier invoices'
            USING ERRCODE = '55000';
    ELSIF v_invoice_count = 1 THEN
        SELECT id, outstanding_amount
        INTO v_liability_id, v_liability_outstanding
        FROM procurement.supplier_liabilities
        WHERE invoice_document_id = v_invoice_document_id
          AND supplier_id = v_supplier_id
        FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'PRECONDITION_FAILED: Posted supplier invoice has no payable liability' USING ERRCODE = '55000';
        END IF;
        v_clearing_role := 'ACCOUNTS_PAYABLE';
    ELSE
        v_clearing_role := 'GRNI';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM procurement.supplier_return_lines WHERE return_id = v_return_id
    ) THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Supplier return requires at least one line' USING ERRCODE = '22023';
    END IF;

    PERFORM 1
    FROM inventory.positions pos
    WHERE pos.warehouse_id = v_warehouse_id
      AND pos.variant_id IN (
          SELECT DISTINCT srl.variant_id
          FROM procurement.supplier_return_lines srl
          WHERE srl.return_id = v_return_id
      )
    ORDER BY pos.variant_id
    FOR UPDATE;

    FOR v_line IN
        SELECT id, variant_id, quantity
        FROM procurement.supplier_return_lines
        WHERE return_id = v_return_id
        ORDER BY line_number, id
    LOOP
        SELECT COALESCE(sum(prl.quantity_received), 0)
        INTO v_received_qty
        FROM procurement.purchase_receipt_lines prl
        JOIN procurement.purchase_receipts pr ON pr.document_id = prl.document_id
        JOIN core.business_documents bd ON bd.id = pr.document_id AND bd.status = 'POSTED'
        WHERE (
            (v_purchase_order_id IS NOT NULL AND pr.purchase_order_id = v_purchase_order_id)
            OR (v_receipt_document_id IS NOT NULL AND pr.document_id = v_receipt_document_id)
            OR (v_purchase_order_id IS NULL AND v_receipt_document_id IS NULL AND pr.supplier_id = v_supplier_id AND pr.warehouse_id = v_warehouse_id)
        )
        AND pr.supplier_id = v_supplier_id
        AND pr.warehouse_id = v_warehouse_id
        AND prl.variant_id = v_line.variant_id;

        SELECT COALESCE(sum(other_line.quantity), 0)
        INTO v_previously_returned_qty
        FROM procurement.supplier_return_lines other_line
        JOIN procurement.supplier_returns other_return ON other_return.id = other_line.return_id
        JOIN core.business_documents other_doc ON other_doc.id = other_return.document_id
        WHERE (
            (v_purchase_order_id IS NOT NULL AND other_return.purchase_order_id = v_purchase_order_id)
            OR (v_receipt_document_id IS NOT NULL AND other_return.receipt_document_id = v_receipt_document_id)
            OR (v_purchase_order_id IS NULL AND v_receipt_document_id IS NULL AND other_return.supplier_id = v_supplier_id AND other_return.warehouse_id = v_warehouse_id)
        )
        AND other_return.supplier_id = v_supplier_id
        AND other_return.warehouse_id = v_warehouse_id
        AND other_line.variant_id = v_line.variant_id
        AND other_return.id <> v_return_id
        AND other_doc.status = 'POSTED';

        IF v_line.quantity + v_previously_returned_qty > v_received_qty THEN
            RAISE EXCEPTION 'PRECONDITION_FAILED: Return quantity exceeds received quantity for variant %', v_line.variant_id
                USING ERRCODE = '55000';
        END IF;

        IF v_invoice_count = 1 THEN
            SELECT round(sum(sil.quantity * sil.unit_cost * inv.exchange_rate_to_dzd) / sum(sil.quantity), 6)
            INTO v_authoritative_unit_cost
            FROM procurement.supplier_invoice_lines sil
            JOIN procurement.supplier_invoices inv ON inv.document_id = sil.document_id
            WHERE sil.document_id = v_invoice_document_id
              AND sil.variant_id = v_line.variant_id;
        ELSE
            SELECT round(sum(prl.quantity_received * prl.unit_cost) / sum(prl.quantity_received), 6)
            INTO v_authoritative_unit_cost
            FROM procurement.purchase_receipt_lines prl
            JOIN procurement.purchase_receipts pr ON pr.document_id = prl.document_id
            WHERE (
                (v_purchase_order_id IS NOT NULL AND pr.purchase_order_id = v_purchase_order_id)
                OR (v_receipt_document_id IS NOT NULL AND pr.document_id = v_receipt_document_id)
                OR (v_purchase_order_id IS NULL AND v_receipt_document_id IS NULL AND pr.supplier_id = v_supplier_id AND pr.warehouse_id = v_warehouse_id)
            )
            AND pr.supplier_id = v_supplier_id
            AND pr.warehouse_id = v_warehouse_id
            AND prl.variant_id = v_line.variant_id;
        END IF;

        IF v_authoritative_unit_cost IS NULL THEN
            RAISE EXCEPTION 'PRECONDITION_FAILED: No authoritative purchase cost exists for variant %', v_line.variant_id
                USING ERRCODE = '55000';
        END IF;

        SELECT quantity_on_hand, total_value
        INTO v_position_qty, v_position_value
        FROM inventory.positions
        WHERE warehouse_id = v_warehouse_id
          AND variant_id = v_line.variant_id
        FOR UPDATE;

        IF NOT FOUND OR v_position_qty < v_line.quantity THEN
            RAISE EXCEPTION 'NEGATIVE_STOCK_FORBIDDEN: Warehouse has insufficient quantity on hand for variant %', v_line.variant_id
                USING ERRCODE = '55000';
        END IF;

        IF v_position_qty = 0 THEN
            v_wac := 0.000000;
        ELSE
            v_wac := round(v_position_value / v_position_qty, 6);
        END IF;

        v_issue_value := round(v_line.quantity * v_wac, 2);
        v_clearing_amount := v_clearing_amount + round(v_line.quantity * v_authoritative_unit_cost, 2);
        v_inventory_value := v_inventory_value + v_issue_value;

        INSERT INTO inventory.movements (
            warehouse_id, variant_id, movement_type,
            quantity_delta, value_delta, unit_cost,
            reference_document_id, created_by_user_id
        ) VALUES (
            v_warehouse_id, v_line.variant_id, 'PURCHASE_RETURN',
            -v_line.quantity, -v_issue_value, v_wac,
            p_return_doc_id, v_user_id
        ) RETURNING id INTO v_movement_id;

        IF v_position_qty - v_line.quantity = 0 THEN
            UPDATE inventory.positions
            SET quantity_on_hand = 0,
                total_value = 0.00,
                current_wac = v_wac,
                updated_at = now()
            WHERE warehouse_id = v_warehouse_id AND variant_id = v_line.variant_id;
        ELSE
            UPDATE inventory.positions
            SET quantity_on_hand = quantity_on_hand - v_line.quantity,
                total_value = round(total_value - v_issue_value, 2),
                current_wac = round((total_value - v_issue_value) / (quantity_on_hand - v_line.quantity), 6),
                updated_at = now()
            WHERE warehouse_id = v_warehouse_id AND variant_id = v_line.variant_id;
        END IF;

        UPDATE procurement.supplier_return_lines
        SET unit_cost = v_authoritative_unit_cost,
            line_total = round(v_line.quantity * v_authoritative_unit_cost, 2)
        WHERE id = v_line.id;
    END LOOP;

    IF v_clearing_role = 'ACCOUNTS_PAYABLE' AND v_clearing_amount > v_liability_outstanding THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Return amount % exceeds outstanding liability %',
            v_clearing_amount, v_liability_outstanding USING ERRCODE = '55000';
    END IF;

    v_variance := round(v_clearing_amount - v_inventory_value, 2);
    v_return_sequence := core.claim_next_document_number('PURCHASE_RETURN', v_fiscal_year);
    v_return_number := 'PRT-' || v_fiscal_year || '-' || lpad(v_return_sequence::text, 6, '0');

    v_journal_document_id := finance.create_posted_journal(
        p_document_date,
        p_fiscal_period_id,
        'Supplier return ' || v_return_number,
        'PURCHASE_RETURN',
        p_return_doc_id
    );

    PERFORM finance.add_journal_line(
        v_journal_document_id,
        v_journal_line_number,
        v_clearing_role,
        v_clearing_amount,
        0.00,
        'Supplier return clearing debit'
    );
    v_journal_line_number := v_journal_line_number + 1;

    PERFORM finance.add_journal_line(
        v_journal_document_id,
        v_journal_line_number,
        'INVENTORY_MERCHANDISE',
        0.00,
        v_inventory_value,
        'Supplier return inventory credit'
    );
    v_journal_line_number := v_journal_line_number + 1;

    IF v_variance > 0 THEN
        PERFORM finance.add_journal_line(
            v_journal_document_id,
            v_journal_line_number,
            'PURCHASE_PRICE_VARIANCE',
            0.00,
            v_variance,
            'Supplier return favorable variance'
        );
    ELSIF v_variance < 0 THEN
        PERFORM finance.add_journal_line(
            v_journal_document_id,
            v_journal_line_number,
            'PURCHASE_PRICE_VARIANCE',
            abs(v_variance),
            0.00,
            'Supplier return unfavorable variance'
        );
    END IF;

    IF v_clearing_role = 'ACCOUNTS_PAYABLE' THEN
        UPDATE procurement.supplier_liabilities
        SET outstanding_amount = round(outstanding_amount - v_clearing_amount, 2),
            status = CASE
                WHEN round(outstanding_amount - v_clearing_amount, 2) = 0 THEN 'PAID'
                ELSE 'PARTIALLY_PAID'
            END
        WHERE id = v_liability_id;
    END IF;

    UPDATE core.business_documents
    SET status = 'POSTED',
        sequence_number = v_return_sequence,
        document_number = v_return_number,
        document_date = p_document_date,
        fiscal_period_id = p_fiscal_period_id,
        fiscal_year = v_fiscal_year,
        posted_at = now()
    WHERE id = p_return_doc_id;

    PERFORM core.store_idempotent_result(
        'inventory.confirm_supplier_return', p_request_id, p_return_doc_id
    );

    RETURN jsonb_build_object(
        'document_id', p_return_doc_id,
        'document_number', v_return_number,
        'status', 'POSTED',
        'journal_document_id', v_journal_document_id
    );
END;
$$;

REVOKE ALL ON FUNCTION inventory.confirm_supplier_return(text, uuid, bytea, bigint, bigint, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inventory.confirm_supplier_return(text, uuid, bytea, bigint, bigint, date) TO stockiha_runtime;
