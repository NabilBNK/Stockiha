-- Migration: 20260812100000_r8_e_procurement_acceptance_defect_repair.sql
-- R8-E Release-Blocker Defect Repair:
-- 1. Harmonized supplier-return eligibility checking between drafting & confirmation.
-- 2. Session-authorized finance.list_journals and finance.get_journal_detail.
-- 3. Secure documents.list_business_documents query for all business documents.
-- 4. Auditability feature toggles: accounting_journals_enabled and business_documents_enabled.

SET ROLE stockiha_owner;

-- Ensure system settings table and default values exist
CREATE TABLE IF NOT EXISTS core.system_settings (
    setting_key text PRIMARY KEY,
    setting_value text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON core.system_settings TO stockiha_runtime;

INSERT INTO core.system_settings (setting_key, setting_value, updated_at)
VALUES 
    ('accounting_journals_enabled', 'true', now()),
    ('business_documents_enabled', 'true', now())
ON CONFLICT (setting_key) DO NOTHING;

-- 1. Enhanced procurement.list_purchase_receipt_lines with stock and liability limits
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
    JOIN core.business_documents po_document
      ON po_document.id = receipt.purchase_order_id
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
        WHERE inv.purchase_order_id = receipt.purchase_order_id
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

-- 2. Synchronized create_supplier_return_draft checking all precondition invariants
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
    v_stock_on_hand numeric;
    v_invoice_count integer;
    v_invoice_doc_id bigint;
    v_liability_outstanding numeric;
    v_authoritative_cost numeric;
    v_return_clearing_amount numeric := 0;
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

    -- Check multiple invoice allocation ambiguity
    SELECT count(DISTINCT inv.document_id), min(inv.document_id)
    INTO v_invoice_count, v_invoice_doc_id
    FROM procurement.supplier_invoices inv
    JOIN core.business_documents bd ON bd.id = inv.document_id AND bd.status = 'POSTED'
    WHERE inv.purchase_order_id = p_purchase_order_id
      AND inv.supplier_id = p_supplier_id;

    IF v_invoice_count > 1 THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Return allocation is ambiguous across multiple supplier invoices'
            USING ERRCODE = '55000';
    END IF;

    IF v_invoice_count = 1 THEN
        SELECT outstanding_amount INTO v_liability_outstanding
        FROM procurement.supplier_liabilities
        WHERE invoice_document_id = v_invoice_doc_id
          AND supplier_id = p_supplier_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'PRECONDITION_FAILED: Posted supplier invoice has no payable liability'
                USING ERRCODE = '55000';
        END IF;
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

        -- Check stock on hand
        SELECT coalesce(quantity_on_hand, 0) INTO v_stock_on_hand
        FROM inventory.positions
        WHERE warehouse_id = p_warehouse_id AND variant_id = v_line.variant_id;
        IF v_stock_on_hand < v_line.quantity THEN
            RAISE EXCEPTION 'INSUFFICIENT_STOCK: Insufficient stock for returned variant %',
                v_line.variant_id USING ERRCODE = '55000';
        END IF;

        -- Check received vs returned quantities
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

        -- Authoritative cost determination
        IF v_invoice_count = 1 THEN
            SELECT round(sum(sil.quantity * sil.unit_cost * inv.exchange_rate_to_dzd) / sum(sil.quantity), 6)
            INTO v_authoritative_cost
            FROM procurement.supplier_invoice_lines sil
            JOIN procurement.supplier_invoices inv ON inv.document_id = sil.document_id
            WHERE sil.document_id = v_invoice_doc_id
              AND sil.variant_id = v_line.variant_id;
        ELSE
            SELECT round(sum(prl.quantity_received * prl.unit_cost) / sum(prl.quantity_received), 6)
            INTO v_authoritative_cost
            FROM procurement.purchase_receipt_lines prl
            JOIN procurement.purchase_receipts pr ON pr.document_id = prl.document_id
            WHERE pr.purchase_order_id = p_purchase_order_id
              AND pr.supplier_id = p_supplier_id
              AND pr.warehouse_id = p_warehouse_id
              AND prl.variant_id = v_line.variant_id;
        END IF;

        IF v_authoritative_cost IS NULL THEN
            RAISE EXCEPTION 'PRECONDITION_FAILED: No authoritative purchase cost exists for variant %',
                v_line.variant_id USING ERRCODE = '55000';
        END IF;

        v_return_clearing_amount := v_return_clearing_amount + round(v_line.quantity * v_authoritative_cost, 2);
    END LOOP;

    IF v_invoice_count = 1 AND v_liability_outstanding IS NOT NULL AND v_return_clearing_amount > v_liability_outstanding THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Return amount exceeds the outstanding supplier liability'
            USING ERRCODE = '55000';
    END IF;

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

-- 3. finance.list_journals
CREATE OR REPLACE FUNCTION finance.list_journals(
    p_session_token text,
    p_limit integer DEFAULT 100,
    p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_enabled text;
    v_result jsonb;
BEGIN
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session(p_session_token);
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'SESSION_INVALID: Session is invalid or expired' USING ERRCODE = '28000';
    END IF;

    SELECT setting_value INTO v_enabled
    FROM core.system_settings
    WHERE setting_key = 'accounting_journals_enabled';
    IF v_enabled = 'false' THEN
        RETURN '[]'::jsonb;
    END IF;

    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'document_id', je.document_id,
            'document_number', bd.document_number,
            'document_date', bd.document_date,
            'fiscal_period_id', bd.fiscal_period_id,
            'source_type', je.source_type,
            'source_id', je.source_id,
            'source_document_number', source_bd.document_number,
            'description', je.description,
            'total_debit', coalesce(line_totals.total_debit, 0)::text,
            'total_credit', coalesce(line_totals.total_credit, 0)::text,
            'is_balanced', (coalesce(line_totals.total_debit, 0) = coalesce(line_totals.total_credit, 0)),
            'created_at', je.created_at
        ) ORDER BY bd.document_date DESC, je.document_id DESC
    ), '[]'::jsonb) INTO v_result
    FROM (
        SELECT * FROM finance.journal_entries
        ORDER BY document_id DESC
        LIMIT greatest(coalesce(p_limit, 100), 1)
        OFFSET greatest(coalesce(p_offset, 0), 0)
    ) je
    JOIN core.business_documents bd ON bd.id = je.document_id
    LEFT JOIN core.business_documents source_bd ON source_bd.id = je.source_id
    LEFT JOIN LATERAL (
        SELECT
            sum(jl.debit) AS total_debit,
            sum(jl.credit) AS total_credit
        FROM finance.journal_lines jl
        WHERE jl.document_id = je.document_id
    ) line_totals ON true;

    RETURN v_result;
END;
$$;

-- 4. finance.get_journal_detail
CREATE OR REPLACE FUNCTION finance.get_journal_detail(
    p_session_token text,
    p_journal_doc_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_enabled text;
    v_result jsonb;
BEGIN
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session(p_session_token);
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'SESSION_INVALID: Session is invalid or expired' USING ERRCODE = '28000';
    END IF;

    SELECT setting_value INTO v_enabled
    FROM core.system_settings
    WHERE setting_key = 'accounting_journals_enabled';
    IF v_enabled = 'false' THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Journal visibility is disabled' USING ERRCODE = '55000';
    END IF;

    SELECT jsonb_build_object(
        'document_id', je.document_id,
        'document_number', bd.document_number,
        'document_date', bd.document_date,
        'fiscal_period_id', bd.fiscal_period_id,
        'source_type', je.source_type,
        'source_id', je.source_id,
        'source_document_number', source_bd.document_number,
        'description', je.description,
        'total_debit', coalesce(line_totals.total_debit, 0)::text,
        'total_credit', coalesce(line_totals.total_credit, 0)::text,
        'is_balanced', (coalesce(line_totals.total_debit, 0) = coalesce(line_totals.total_credit, 0)),
        'created_at', je.created_at,
        'lines', coalesce(line_totals.lines, '[]'::jsonb)
    ) INTO v_result
    FROM finance.journal_entries je
    JOIN core.business_documents bd ON bd.id = je.document_id
    LEFT JOIN core.business_documents source_bd ON source_bd.id = je.source_id
    LEFT JOIN LATERAL (
        SELECT
            sum(jl.debit) AS total_debit,
            sum(jl.credit) AS total_credit,
            jsonb_agg(
                jsonb_build_object(
                    'line_number', jl.line_number,
                    'account_code', jl.account_code,
                    'account_name', jl.account_code,
                    'debit', jl.debit::text,
                    'credit', jl.credit::text
                ) ORDER BY jl.line_number
            ) AS lines
        FROM finance.journal_lines jl
        WHERE jl.document_id = je.document_id
    ) line_totals ON true
    WHERE je.document_id = p_journal_doc_id;

    IF v_result IS NULL THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Journal entry % not found', p_journal_doc_id USING ERRCODE = '55000';
    END IF;

    RETURN v_result;
END;
$$;

-- 5. documents.list_business_documents
CREATE OR REPLACE FUNCTION documents.list_business_documents(
    p_session_token text,
    p_limit integer DEFAULT 100,
    p_offset integer DEFAULT 0,
    p_document_type text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_is_cashier boolean;
    v_enabled text;
    v_result jsonb;
BEGIN
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session(p_session_token);
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'SESSION_INVALID: Session is invalid or expired' USING ERRCODE = '28000';
    END IF;

    SELECT setting_value INTO v_enabled
    FROM core.system_settings
    WHERE setting_key = 'business_documents_enabled';
    IF v_enabled = 'false' THEN
        RETURN '[]'::jsonb;
    END IF;

    -- Cashiers can only view sales & customer documents; Managers/Admins view all
    SELECT EXISTS (
        SELECT 1 FROM iam.user_roles ur
        JOIN iam.roles r ON r.id = ur.role_id
        WHERE ur.user_id = v_user_id AND r.code = 'CASHIER'
    ) AND NOT EXISTS (
        SELECT 1 FROM iam.user_roles ur
        JOIN iam.roles r ON r.id = ur.role_id
        WHERE ur.user_id = v_user_id AND r.code IN ('ADMIN', 'MANAGER')
    ) INTO v_is_cashier;

    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'document_id', bd.id,
            'document_number', bd.document_number,
            'document_type', bd.document_type,
            'document_date', bd.document_date,
            'status', bd.status,
            'posted_at', bd.posted_at,
            'generation_status', CASE
                WHEN bd.document_type IN ('CASH_SALE', 'CREDIT_SALE', 'CUSTOMER_PAYMENT')
                THEN coalesce(print_jobs.gen_status, 'NOT_GENERATED')
                ELSE 'NOT_APPLICABLE'
            END,
            'print_status', CASE
                WHEN bd.document_type IN ('CASH_SALE', 'CREDIT_SALE', 'CUSTOMER_PAYMENT')
                THEN coalesce(print_jobs.prt_status, 'NOT_PRINTED')
                ELSE 'NOT_APPLICABLE'
            END,
            'linked_journal_id', je.document_id,
            'linked_journal_number', journal_bd.document_number,
            'detail_summary', CASE
                WHEN bd.document_type = 'PURCHASE_ORDER' THEN (SELECT supplier.name FROM procurement.purchase_orders po JOIN procurement.suppliers supplier ON supplier.id = po.supplier_id WHERE po.document_id = bd.id)
                WHEN bd.document_type = 'PURCHASE_RECEIPT' THEN (SELECT supplier.name FROM procurement.purchase_receipts pr JOIN procurement.suppliers supplier ON supplier.id = pr.supplier_id WHERE pr.document_id = bd.id)
                WHEN bd.document_type = 'SUPPLIER_INVOICE' THEN (SELECT supplier.name FROM procurement.supplier_invoices si JOIN procurement.suppliers supplier ON supplier.id = si.supplier_id WHERE si.document_id = bd.id)
                WHEN bd.document_type = 'PURCHASE_RETURN' THEN (SELECT supplier.name FROM procurement.supplier_returns sr JOIN procurement.suppliers supplier ON supplier.id = sr.supplier_id WHERE sr.document_id = bd.id)
                WHEN bd.document_type = 'SUPPLIER_PAYMENT' THEN (SELECT supplier.name FROM procurement.supplier_payments sp JOIN procurement.suppliers supplier ON supplier.id = sp.supplier_id WHERE sp.document_id = bd.id)
                WHEN bd.document_type = 'CASH_SALE' THEN 'Cash Sale'
                WHEN bd.document_type = 'CREDIT_SALE' THEN (SELECT c.name FROM sales.credit_sales cs JOIN receivables.customers c ON c.id = cs.customer_id WHERE cs.document_id = bd.id)
                WHEN bd.document_type = 'CUSTOMER_PAYMENT' THEN (SELECT c.name FROM receivables.customer_payments cp JOIN receivables.customers c ON c.id = cp.customer_id WHERE cp.document_id = bd.id)
                ELSE NULL
            END
        ) ORDER BY bd.posted_at DESC NULLS LAST, bd.id DESC
    ), '[]'::jsonb) INTO v_result
    FROM (
        SELECT * FROM core.business_documents
        WHERE (p_document_type IS NULL OR document_type = p_document_type)
          AND (NOT v_is_cashier OR document_type IN ('CASH_SALE', 'CREDIT_SALE', 'CUSTOMER_PAYMENT'))
        ORDER BY posted_at DESC NULLS LAST, id DESC
        LIMIT greatest(coalesce(p_limit, 100), 1)
        OFFSET greatest(coalesce(p_offset, 0), 0)
    ) bd
    LEFT JOIN finance.journal_entries je ON je.source_id = bd.id
    LEFT JOIN core.business_documents journal_bd ON journal_bd.id = je.document_id
    LEFT JOIN LATERAL (
        SELECT
            dg.status AS gen_status,
            dpj.status AS prt_status
        FROM documents.generation_jobs dg
        LEFT JOIN documents.print_jobs dpj ON dpj.business_document_id = dg.business_document_id
        WHERE dg.business_document_id = bd.id
        ORDER BY dg.created_at DESC
        LIMIT 1
    ) print_jobs ON true;

    RETURN v_result;
END;
$$;

-- Revoke & Grant security permissions
REVOKE ALL ON FUNCTION finance.list_journals(text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION finance.get_journal_detail(text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION documents.list_business_documents(text, integer, integer, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION finance.list_journals(text, integer, integer) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION finance.get_journal_detail(text, bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION documents.list_business_documents(text, integer, integer, text) TO stockiha_runtime;

-- Update schema state
UPDATE operations.schema_state
SET migration_version = 20260812100000,
    updated_at = now()
WHERE singleton;

RESET ROLE;
