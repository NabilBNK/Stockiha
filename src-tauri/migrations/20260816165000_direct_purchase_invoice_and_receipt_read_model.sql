-- Complete the Direct Purchase read/invoice contracts.
--
-- Direct Purchase receipts have no Purchase Order by design. This migration
-- removes the remaining PO-only assumptions from the receipt history projection
-- and supplier-invoice draft boundary while preserving the legacy PO path.

SET ROLE stockiha_owner;

-- ---------------------------------------------------------------------------
-- 1. Purchase-receipt history must include DIRECT_PURCHASE receipts.
-- ---------------------------------------------------------------------------
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
    ), '[]'::jsonb)
    INTO v_result
    FROM procurement.purchase_receipts receipt
    JOIN core.business_documents document
      ON document.id = receipt.document_id
     AND document.status = 'POSTED'
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

-- ---------------------------------------------------------------------------
-- 2. Supplier-invoice draft creation supports either a real PO receipt line or
--    a first-class Direct Purchase receipt line. No synthetic PO is accepted.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION procurement.create_supplier_invoice_draft(
    p_session_token text,
    p_supplier_id bigint,
    p_purchase_order_id bigint,
    p_currency_code text,
    p_exchange_rate_to_dzd numeric(14,6),
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
    v_fiscal_year integer := extract(year from CURRENT_DATE)::integer;
    v_line jsonb;
    v_line_number integer;
    v_po_line_id bigint;
    v_receipt_line_id bigint;
    v_variant_id bigint;
    v_quantity numeric(14,3);
    v_unit_cost numeric(14,2);
    v_line_total numeric(14,2);
    v_subtotal numeric(14,2) := 0.00;
    v_rate numeric(14,6) := coalesce(p_exchange_rate_to_dzd, 1.000000);
    v_receipt_supplier_id bigint;
    v_receipt_purchase_order_id bigint;
    v_receipt_origin text;
    v_receipt_po_line_id bigint;
    v_receipt_variant_id bigint;
    v_receipt_quantity numeric(14,3);
    v_already_invoiced numeric(14,3);
BEGIN
    SELECT user_id
    INTO v_user_id
    FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_PROCUREMENT');

    IF p_supplier_id IS NULL OR p_supplier_id <= 0 OR NOT EXISTS (
        SELECT 1
        FROM procurement.suppliers supplier
        WHERE supplier.id = p_supplier_id
          AND supplier.is_active
    ) THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Supplier is inactive or not found'
            USING ERRCODE = '22023';
    END IF;

    IF coalesce(p_currency_code, 'DZD') <> 'DZD' THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Only DZD supplier invoices are enabled for the MVP'
            USING ERRCODE = '22023';
    END IF;
    IF v_rate <= 0 OR v_rate <> 1.000000 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: DZD supplier invoice exchange rate must be 1.000000'
            USING ERRCODE = '22023';
    END IF;
    IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Supplier invoice requires at least one receipt line'
            USING ERRCODE = '22023';
    END IF;

    IF p_purchase_order_id IS NOT NULL THEN
        PERFORM 1
        FROM procurement.purchase_orders purchase_order
        WHERE purchase_order.document_id = p_purchase_order_id
          AND purchase_order.supplier_id = p_supplier_id
          AND purchase_order.status IN ('PARTIALLY_RECEIVED', 'RECEIVED');
        IF NOT FOUND THEN
            RAISE EXCEPTION 'PRECONDITION_FAILED: Purchase order is not eligible for invoicing'
                USING ERRCODE = '55000';
        END IF;
    END IF;

    -- Validate the complete source set before inserting a draft document.
    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
        v_line_number := nullif(v_line ->> 'line_number', '')::integer;
        v_po_line_id := nullif(v_line ->> 'po_line_id', '')::bigint;
        v_receipt_line_id := nullif(v_line ->> 'receipt_line_id', '')::bigint;
        v_variant_id := nullif(v_line ->> 'variant_id', '')::bigint;
        v_quantity := nullif(v_line ->> 'quantity', '')::numeric;
        v_unit_cost := nullif(v_line ->> 'unit_cost', '')::numeric;

        IF v_line_number IS NULL OR v_line_number <= 0
           OR v_receipt_line_id IS NULL OR v_receipt_line_id <= 0
           OR v_variant_id IS NULL OR v_variant_id <= 0
           OR v_quantity IS NULL OR v_quantity <= 0
           OR v_unit_cost IS NULL OR v_unit_cost < 0 THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: Supplier invoice contains an invalid line'
                USING ERRCODE = '22023';
        END IF;

        SELECT receipt.supplier_id,
               receipt.purchase_order_id,
               receipt.receipt_origin,
               receipt_line.po_line_id,
               receipt_line.variant_id,
               receipt_line.quantity_received
        INTO v_receipt_supplier_id,
             v_receipt_purchase_order_id,
             v_receipt_origin,
             v_receipt_po_line_id,
             v_receipt_variant_id,
             v_receipt_quantity
        FROM procurement.purchase_receipt_lines receipt_line
        JOIN procurement.purchase_receipts receipt
          ON receipt.document_id = receipt_line.document_id
        JOIN core.business_documents receipt_document
          ON receipt_document.id = receipt.document_id
         AND receipt_document.status = 'POSTED'
        WHERE receipt_line.id = v_receipt_line_id;

        IF NOT FOUND
           OR v_receipt_supplier_id <> p_supplier_id
           OR v_receipt_variant_id <> v_variant_id THEN
            RAISE EXCEPTION 'PRECONDITION_FAILED: Invoice line does not match a posted supplier receipt line'
                USING ERRCODE = '55000';
        END IF;

        IF p_purchase_order_id IS NULL THEN
            IF v_receipt_origin <> 'DIRECT_PURCHASE'
               OR v_receipt_purchase_order_id IS NOT NULL
               OR v_receipt_po_line_id IS NOT NULL
               OR v_po_line_id IS NOT NULL THEN
                RAISE EXCEPTION 'PRECONDITION_FAILED: Direct invoice line must reference a Direct Purchase receipt without a PO'
                    USING ERRCODE = '55000';
            END IF;
        ELSE
            IF v_receipt_origin <> 'PURCHASE_ORDER'
               OR v_receipt_purchase_order_id <> p_purchase_order_id
               OR v_receipt_po_line_id IS NULL
               OR v_po_line_id IS DISTINCT FROM v_receipt_po_line_id THEN
                RAISE EXCEPTION 'PRECONDITION_FAILED: Purchase-order invoice line does not match the selected PO receipt'
                    USING ERRCODE = '55000';
            END IF;
        END IF;

        SELECT coalesce(sum(invoice_line.quantity), 0)
        INTO v_already_invoiced
        FROM procurement.supplier_invoice_lines invoice_line
        JOIN core.business_documents invoice_document
          ON invoice_document.id = invoice_line.document_id
         AND invoice_document.status = 'POSTED'
        WHERE invoice_line.receipt_line_id = v_receipt_line_id;

        IF v_quantity + v_already_invoiced > v_receipt_quantity THEN
            RAISE EXCEPTION 'PRECONDITION_FAILED: Invoice quantity exceeds remaining received quantity'
                USING ERRCODE = '55000';
        END IF;
    END LOOP;

    SELECT period.id
    INTO v_fiscal_period_id
    FROM finance.fiscal_periods period
    WHERE period.status = 'OPEN'
      AND CURRENT_DATE BETWEEN period.starts_on AND period.ends_on
    ORDER BY period.starts_on DESC
    LIMIT 1;

    IF v_fiscal_period_id IS NULL THEN
        RAISE EXCEPTION 'CLOSED_FISCAL_PERIOD: No open fiscal period contains the current business date'
            USING ERRCODE = '55000';
    END IF;

    INSERT INTO core.business_documents (
        document_type, status, document_date, fiscal_period_id, fiscal_year
    ) VALUES (
        'PURCHASE_INVOICE', 'DRAFT', CURRENT_DATE, v_fiscal_period_id, v_fiscal_year
    )
    RETURNING id INTO v_doc_id;

    INSERT INTO procurement.supplier_invoices (
        document_id, supplier_id, purchase_order_id, currency_code, exchange_rate_to_dzd,
        foreign_subtotal, foreign_total_amount, base_subtotal, base_total_amount, note
    ) VALUES (
        v_doc_id, p_supplier_id, p_purchase_order_id, 'DZD', 1.000000,
        0.00, 0.00, 0.00, 0.00, nullif(btrim(p_note), '')
    );

    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
        v_line_number := (v_line ->> 'line_number')::integer;
        v_po_line_id := nullif(v_line ->> 'po_line_id', '')::bigint;
        v_receipt_line_id := (v_line ->> 'receipt_line_id')::bigint;
        v_variant_id := (v_line ->> 'variant_id')::bigint;
        v_quantity := (v_line ->> 'quantity')::numeric;
        v_unit_cost := (v_line ->> 'unit_cost')::numeric;
        v_line_total := round(v_quantity * v_unit_cost, 2);

        INSERT INTO procurement.supplier_invoice_lines (
            document_id, line_number, po_line_id, receipt_line_id,
            variant_id, quantity, unit_cost, line_total
        ) VALUES (
            v_doc_id, v_line_number, v_po_line_id, v_receipt_line_id,
            v_variant_id, v_quantity, v_unit_cost, v_line_total
        );

        v_subtotal := v_subtotal + v_line_total;
    END LOOP;

    UPDATE procurement.supplier_invoices
    SET foreign_subtotal = v_subtotal,
        foreign_total_amount = v_subtotal,
        base_subtotal = v_subtotal,
        base_total_amount = v_subtotal
    WHERE document_id = v_doc_id;

    RETURN jsonb_build_object(
        'document_id', v_doc_id,
        'supplier_id', p_supplier_id,
        'purchase_order_id', p_purchase_order_id,
        'status', 'DRAFT',
        'subtotal', v_subtotal::text,
        'total_amount', v_subtotal::text
    );
END;
$$;

REVOKE ALL ON FUNCTION procurement.list_purchase_receipts(text,bigint,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION procurement.create_supplier_invoice_draft(text,bigint,bigint,text,numeric,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION procurement.list_purchase_receipts(text,bigint,bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION procurement.create_supplier_invoice_draft(text,bigint,bigint,text,numeric,text,jsonb) TO stockiha_runtime;

UPDATE operations.schema_state
SET migration_version = 20260816165000,
    updated_at = now()
WHERE singleton;

RESET ROLE;
