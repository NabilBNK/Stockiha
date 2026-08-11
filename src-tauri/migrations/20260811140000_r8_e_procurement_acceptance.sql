-- R8-E: secure procurement projections and operator-ready return drafting.
--
-- Existing posting functions remain authoritative for GRNI/AP, inventory,
-- variance, idempotency, numbering, fiscal-period validation, and journals.
-- This migration closes read-side permission gaps and exposes the exact
-- receipt-line data required by the desktop invoice/return workflows.
DO $$
DECLARE
    v_signature text;
    v_function_oid oid;
    v_owner text;
BEGIN
    FOREACH v_signature IN ARRAY ARRAY[
        'procurement.list_purchase_receipts(text,bigint,bigint)',
        'procurement.create_supplier_return_draft(text,bigint,bigint,bigint,text,text,jsonb)',
        'procurement.list_supplier_invoices(text,bigint)',
        'procurement.list_supplier_liabilities(text,bigint)',
        'procurement.list_supplier_returns(text,bigint)',
        'procurement.list_supplier_payments(text,bigint)'
    ]
    LOOP
        v_function_oid := to_regprocedure(v_signature);
        IF v_function_oid IS NULL THEN
            RAISE EXCEPTION 'expected R8-E replace-target function is missing: %', v_signature;
        END IF;

        SELECT pg_get_userbyid(p.proowner)
        INTO v_owner
        FROM pg_proc p
        WHERE p.oid = v_function_oid;

        IF v_owner = 'stockiha_owner' THEN
            CONTINUE;
        ELSIF v_owner = 'postgres' THEN
            EXECUTE format(
                'ALTER FUNCTION %s OWNER TO stockiha_owner',
                v_function_oid::regprocedure
            );
        ELSE
            RAISE EXCEPTION 'unexpected owner % for R8-E function %', v_owner, v_signature;
        END IF;
    END LOOP;
END;
$$;

SET ROLE stockiha_owner;

CREATE FUNCTION procurement.get_capabilities(p_session_token text)
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
        'can_manage_procurement', EXISTS (
            SELECT 1
            FROM iam.user_roles ur
            JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
            JOIN iam.permissions permission ON permission.id = rp.permission_id
            WHERE ur.user_id = v_user_id
              AND permission.code = 'MANAGE_PROCUREMENT'
        ),
        'can_post_purchase_receipt', EXISTS (
            SELECT 1
            FROM iam.user_roles ur
            JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
            JOIN iam.permissions permission ON permission.id = rp.permission_id
            WHERE ur.user_id = v_user_id
              AND permission.code = 'POST_PURCHASE_RECEIPT'
        ),
        'can_post_supplier_invoice', EXISTS (
            SELECT 1
            FROM iam.user_roles ur
            JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
            JOIN iam.permissions permission ON permission.id = rp.permission_id
            WHERE ur.user_id = v_user_id
              AND permission.code = 'POST_SUPPLIER_INVOICE'
        ),
        'can_post_supplier_return', EXISTS (
            SELECT 1
            FROM iam.user_roles ur
            JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
            JOIN iam.permissions permission ON permission.id = rp.permission_id
            WHERE ur.user_id = v_user_id
              AND permission.code = 'POST_SUPPLIER_RETURN'
        ),
        'can_post_supplier_payment', EXISTS (
            SELECT 1
            FROM iam.user_roles ur
            JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
            JOIN iam.permissions permission ON permission.id = rp.permission_id
            WHERE ur.user_id = v_user_id
              AND permission.code = 'POST_SUPPLIER_PAYMENT'
        )
    );
END;
$$;

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
    JOIN procurement.purchase_orders purchase_order
      ON purchase_order.document_id = receipt.purchase_order_id
    JOIN core.business_documents po_document
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

CREATE FUNCTION procurement.list_purchase_receipt_lines(
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
            'quantity_returnable_for_variant', greatest(
                coalesce(received_totals.quantity_received, 0)
                - coalesce(return_totals.quantity_returned, 0),
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
    JOIN core.business_documents po_document
      ON po_document.id = receipt.purchase_order_id
    JOIN procurement.suppliers supplier ON supplier.id = receipt.supplier_id
    JOIN inventory.warehouses warehouse ON warehouse.id = receipt.warehouse_id
    JOIN catalog.product_variants variant ON variant.id = receipt_line.variant_id
    JOIN catalog.products product ON product.id = variant.product_id
    JOIN catalog.units unit ON unit.id = receipt_line.unit_id
    LEFT JOIN LATERAL (
        SELECT sum(invoice_line.quantity) AS quantity_invoiced
        FROM procurement.supplier_invoice_lines invoice_line
        JOIN core.business_documents invoice_document
          ON invoice_document.id = invoice_line.document_id
         AND invoice_document.status = 'POSTED'
        WHERE invoice_line.receipt_line_id = receipt_line.id
    ) invoice_totals ON true
    LEFT JOIN LATERAL (
        SELECT sum(other_receipt_line.quantity_received) AS quantity_received
        FROM procurement.purchase_receipt_lines other_receipt_line
        JOIN procurement.purchase_receipts other_receipt
          ON other_receipt.document_id = other_receipt_line.document_id
        JOIN core.business_documents other_receipt_document
          ON other_receipt_document.id = other_receipt.document_id
         AND other_receipt_document.status = 'POSTED'
        WHERE other_receipt.purchase_order_id = receipt.purchase_order_id
          AND other_receipt_line.variant_id = receipt_line.variant_id
    ) received_totals ON true
    LEFT JOIN LATERAL (
        SELECT sum(return_line.quantity) AS quantity_returned
        FROM procurement.supplier_return_lines return_line
        JOIN procurement.supplier_returns supplier_return
          ON supplier_return.id = return_line.return_id
        JOIN core.business_documents return_document
          ON return_document.id = supplier_return.document_id
         AND return_document.status = 'POSTED'
        WHERE supplier_return.purchase_order_id = receipt.purchase_order_id
          AND return_line.variant_id = receipt_line.variant_id
    ) return_totals ON true
    WHERE p_purchase_order_id IS NULL
       OR receipt.purchase_order_id = p_purchase_order_id;

    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION procurement.create_supplier_return_draft(
    p_session_token text,
    p_supplier_id bigint,
    p_warehouse_id bigint,
    p_purchase_order_id bigint,
    p_reason_code text,
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
    v_fiscal_period_id bigint;
    v_document_id bigint;
    v_return_id bigint;
    v_line record;
    v_line_number integer := 1;
    v_received_quantity numeric;
    v_returned_quantity numeric;
BEGIN
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_PROCUREMENT');

    IF p_purchase_order_id IS NULL THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Supplier return requires a purchase order'
            USING ERRCODE = '22023';
    END IF;
    IF coalesce(p_reason_code, 'DEFECTIVE_GOODS') NOT IN (
        'DEFECTIVE_GOODS', 'EXCESS_DELIVERY', 'WRONG_ITEM'
    ) THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Unsupported supplier return reason'
            USING ERRCODE = '22023';
    END IF;
    IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Supplier return must contain at least one line'
            USING ERRCODE = '22023';
    END IF;

    PERFORM 1
    FROM procurement.purchase_orders purchase_order
    JOIN core.business_documents document ON document.id = purchase_order.document_id
    JOIN procurement.suppliers supplier ON supplier.id = purchase_order.supplier_id
    JOIN inventory.warehouses warehouse ON warehouse.id = purchase_order.warehouse_id
    WHERE purchase_order.document_id = p_purchase_order_id
      AND purchase_order.supplier_id = p_supplier_id
      AND purchase_order.warehouse_id = p_warehouse_id
      AND purchase_order.status IN ('PARTIALLY_RECEIVED', 'RECEIVED')
      AND supplier.is_active
      AND warehouse.is_active;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Purchase order is not eligible for supplier return'
            USING ERRCODE = '55000';
    END IF;

    FOR v_line IN
        SELECT
            (line ->> 'variant_id')::bigint AS variant_id,
            sum((line ->> 'quantity')::numeric) AS quantity,
            max((line ->> 'unit_cost')::numeric) AS unit_cost
        FROM jsonb_array_elements(p_lines) line
        GROUP BY (line ->> 'variant_id')::bigint
    LOOP
        IF v_line.variant_id IS NULL OR v_line.quantity IS NULL OR v_line.quantity <= 0
           OR v_line.unit_cost IS NULL OR v_line.unit_cost < 0 THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: Invalid supplier return line'
                USING ERRCODE = '22023';
        END IF;

        SELECT coalesce(sum(receipt_line.quantity_received), 0)
        INTO v_received_quantity
        FROM procurement.purchase_receipt_lines receipt_line
        JOIN procurement.purchase_receipts receipt
          ON receipt.document_id = receipt_line.document_id
        JOIN core.business_documents receipt_document
          ON receipt_document.id = receipt.document_id
         AND receipt_document.status = 'POSTED'
        WHERE receipt.purchase_order_id = p_purchase_order_id
          AND receipt_line.variant_id = v_line.variant_id;

        SELECT coalesce(sum(return_line.quantity), 0)
        INTO v_returned_quantity
        FROM procurement.supplier_return_lines return_line
        JOIN procurement.supplier_returns supplier_return
          ON supplier_return.id = return_line.return_id
        JOIN core.business_documents return_document
          ON return_document.id = supplier_return.document_id
         AND return_document.status = 'POSTED'
        WHERE supplier_return.purchase_order_id = p_purchase_order_id
          AND return_line.variant_id = v_line.variant_id;

        IF v_line.quantity > v_received_quantity - v_returned_quantity THEN
            RAISE EXCEPTION 'PRECONDITION_FAILED: Return quantity exceeds net received quantity for variant %',
                v_line.variant_id USING ERRCODE = '55000';
        END IF;
    END LOOP;

    SELECT id INTO v_fiscal_period_id
    FROM finance.fiscal_periods
    WHERE status = 'OPEN'
    ORDER BY starts_on DESC
    LIMIT 1;
    IF v_fiscal_period_id IS NULL THEN
        RAISE EXCEPTION 'CLOSED_FISCAL_PERIOD: No open fiscal period is available'
            USING ERRCODE = '55000';
    END IF;

    INSERT INTO core.business_documents (
        document_type, status, document_date, fiscal_period_id, fiscal_year
    ) VALUES (
        'PURCHASE_RETURN', 'DRAFT', current_date, v_fiscal_period_id,
        extract(year from current_date)::integer
    ) RETURNING id INTO v_document_id;

    INSERT INTO procurement.supplier_returns (
        document_id, supplier_id, warehouse_id, purchase_order_id, reason_code, note
    ) VALUES (
        v_document_id, p_supplier_id, p_warehouse_id, p_purchase_order_id,
        coalesce(p_reason_code, 'DEFECTIVE_GOODS'), nullif(btrim(p_note), '')
    ) RETURNING id INTO v_return_id;

    FOR v_line IN
        SELECT
            (line ->> 'variant_id')::bigint AS variant_id,
            (line ->> 'quantity')::numeric AS quantity,
            (line ->> 'unit_cost')::numeric AS unit_cost
        FROM jsonb_array_elements(p_lines) line
    LOOP
        INSERT INTO procurement.supplier_return_lines (
            return_id, line_number, variant_id, quantity, unit_cost, line_total
        ) VALUES (
            v_return_id, v_line_number, v_line.variant_id, v_line.quantity,
            v_line.unit_cost, round(v_line.quantity * v_line.unit_cost, 2)
        );
        v_line_number := v_line_number + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'document_id', v_document_id,
        'supplier_id', p_supplier_id,
        'purchase_order_id', p_purchase_order_id,
        'status', 'DRAFT'
    );
END;
$$;

CREATE OR REPLACE FUNCTION procurement.list_supplier_invoices(
    p_session_token text,
    p_supplier_id bigint DEFAULT NULL
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
            'document_id', invoice.document_id,
            'document_number', document.document_number,
            'supplier_id', invoice.supplier_id,
            'supplier_name', supplier.name,
            'purchase_order_id', invoice.purchase_order_id,
            'purchase_order_number', po_document.document_number,
            'status', document.status,
            'currency_code', invoice.currency_code,
            'foreign_total_amount', invoice.foreign_total_amount::text,
            'base_total_amount', invoice.base_total_amount::text,
            'journal_document_id', liability.journal_document_id,
            'journal_document_number', journal_document.document_number,
            'liability_id', liability.id,
            'outstanding_amount', liability.outstanding_amount::text,
            'created_at', invoice.created_at
        ) ORDER BY invoice.created_at DESC, invoice.document_id DESC
    ), '[]'::jsonb) INTO v_result
    FROM procurement.supplier_invoices invoice
    JOIN core.business_documents document ON document.id = invoice.document_id
    JOIN procurement.suppliers supplier ON supplier.id = invoice.supplier_id
    LEFT JOIN core.business_documents po_document
      ON po_document.id = invoice.purchase_order_id
    LEFT JOIN procurement.supplier_liabilities liability
      ON liability.invoice_document_id = invoice.document_id
    LEFT JOIN core.business_documents journal_document
      ON journal_document.id = liability.journal_document_id
    WHERE p_supplier_id IS NULL OR invoice.supplier_id = p_supplier_id;

    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION procurement.list_supplier_liabilities(
    p_session_token text,
    p_supplier_id bigint DEFAULT NULL
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
            'id', liability.id,
            'supplier_id', liability.supplier_id,
            'supplier_code', supplier.code,
            'supplier_name', supplier.name,
            'document_id', coalesce(liability.invoice_document_id, liability.receipt_document_id),
            'document_number', source_document.document_number,
            'source_type', CASE
                WHEN liability.invoice_document_id IS NOT NULL THEN 'SUPPLIER_INVOICE'
                ELSE 'LANDED_COST'
            END,
            'journal_document_id', liability.journal_document_id,
            'journal_document_number', journal_document.document_number,
            'original_amount', liability.original_amount::text,
            'remaining_amount', liability.outstanding_amount::text,
            'status', liability.status,
            'due_date', liability.due_date,
            'created_at', liability.created_at
        ) ORDER BY liability.due_date NULLS LAST, liability.id
    ), '[]'::jsonb) INTO v_result
    FROM procurement.supplier_liabilities liability
    JOIN procurement.suppliers supplier ON supplier.id = liability.supplier_id
    LEFT JOIN core.business_documents source_document
      ON source_document.id = coalesce(liability.invoice_document_id, liability.receipt_document_id)
    LEFT JOIN core.business_documents journal_document
      ON journal_document.id = liability.journal_document_id
    WHERE liability.outstanding_amount > 0
      AND (p_supplier_id IS NULL OR liability.supplier_id = p_supplier_id);

    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION procurement.list_supplier_returns(
    p_session_token text,
    p_supplier_id bigint DEFAULT NULL
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
            'document_id', document.id,
            'document_number', document.document_number,
            'supplier_id', supplier_return.supplier_id,
            'supplier_name', supplier.name,
            'warehouse_id', supplier_return.warehouse_id,
            'warehouse_name', warehouse.name,
            'purchase_order_id', supplier_return.purchase_order_id,
            'purchase_order_number', po_document.document_number,
            'status', document.status,
            'reason_code', supplier_return.reason_code,
            'journal_document_id', journal.document_id,
            'journal_document_number', journal_document.document_number,
            'created_at', supplier_return.created_at
        ) ORDER BY supplier_return.id DESC
    ), '[]'::jsonb) INTO v_result
    FROM procurement.supplier_returns supplier_return
    JOIN core.business_documents document ON document.id = supplier_return.document_id
    JOIN procurement.suppliers supplier ON supplier.id = supplier_return.supplier_id
    JOIN inventory.warehouses warehouse ON warehouse.id = supplier_return.warehouse_id
    LEFT JOIN core.business_documents po_document
      ON po_document.id = supplier_return.purchase_order_id
    LEFT JOIN finance.journal_entries journal
      ON journal.source_type = 'PURCHASE_RETURN'
     AND journal.source_id = supplier_return.document_id
    LEFT JOIN core.business_documents journal_document
      ON journal_document.id = journal.document_id
    WHERE p_supplier_id IS NULL OR supplier_return.supplier_id = p_supplier_id;

    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION procurement.list_supplier_payments(
    p_session_token text,
    p_supplier_id bigint DEFAULT NULL
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
            'document_id', document.id,
            'document_number', document.document_number,
            'supplier_id', payment.supplier_id,
            'supplier_name', supplier.name,
            'liability_id', payment.liability_id,
            'payment_method', payment.payment_method,
            'amount', payment.amount::text,
            'journal_document_id', journal.document_id,
            'journal_document_number', journal_document.document_number,
            'created_at', payment.created_at
        ) ORDER BY payment.id DESC
    ), '[]'::jsonb) INTO v_result
    FROM procurement.supplier_payments payment
    JOIN core.business_documents document ON document.id = payment.document_id
    JOIN procurement.suppliers supplier ON supplier.id = payment.supplier_id
    LEFT JOIN finance.journal_entries journal
      ON journal.source_type = 'SUPPLIER_PAYMENT'
     AND journal.source_id = payment.document_id
    LEFT JOIN core.business_documents journal_document
      ON journal_document.id = journal.document_id
    WHERE p_supplier_id IS NULL OR payment.supplier_id = p_supplier_id;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION procurement.get_capabilities(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION procurement.list_purchase_receipts(text, bigint, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION procurement.list_purchase_receipt_lines(text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION procurement.create_supplier_return_draft(text, bigint, bigint, bigint, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION procurement.list_supplier_invoices(text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION procurement.list_supplier_liabilities(text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION procurement.list_supplier_returns(text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION procurement.list_supplier_payments(text, bigint) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION procurement.get_capabilities(text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION procurement.list_purchase_receipts(text, bigint, bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION procurement.list_purchase_receipt_lines(text, bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION procurement.create_supplier_return_draft(text, bigint, bigint, bigint, text, text, jsonb) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION procurement.list_supplier_invoices(text, bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION procurement.list_supplier_liabilities(text, bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION procurement.list_supplier_returns(text, bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION procurement.list_supplier_payments(text, bigint) TO stockiha_runtime;

UPDATE operations.schema_state
SET migration_version = 20260811140000,
    updated_at = now()
WHERE singleton;

RESET ROLE;
