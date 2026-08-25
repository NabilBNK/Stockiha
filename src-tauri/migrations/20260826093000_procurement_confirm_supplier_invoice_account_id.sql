-- WS-B-1 Gate 3a (part 2): convert procurement.confirm_supplier_invoice to
-- dual-write account_id, via the finance.add_journal_line helper this task
-- just created. Converts the GRNI and ACCOUNTS_PAYABLE call sites (both valid
-- finance.account_role_code members) and the idempotency-result rename
-- (core.store_idempotent_result never existed -- core.record_idempotent_result
-- is the real, already-installed function).
--
-- The PURCHASE_PRICE_VARIANCE call sites are deliberately left untouched:
-- 'PURCHASE_PRICE_VARIANCE' is not a finance.account_role_code member and no
-- account exists for it yet -- seeding one is an explicitly separate future
-- task. Those two branches remain exactly as broken as before this migration.
SET ROLE stockiha_owner;

CREATE OR REPLACE FUNCTION procurement.confirm_supplier_invoice(p_session_token text, p_request_id uuid, p_payload_hash bytea, p_invoice_doc_id bigint, p_fiscal_period_id bigint, p_document_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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

    PERFORM core.record_idempotent_result(
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
$function$;

RESET ROLE;
