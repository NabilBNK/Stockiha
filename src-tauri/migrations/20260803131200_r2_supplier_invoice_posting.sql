-- R2: invoice confirmation clears GRNI, records price variance, and creates AP.
SET ROLE stockiha_owner;

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
    IF v_purchase_order_id IS NULL THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: MVP supplier invoices require a purchase order' USING ERRCODE = '55000';
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

    -- Lock every matched receipt line so concurrent invoices cannot consume the
    -- same received quantity.
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

    IF EXISTS (
        SELECT 1
        FROM procurement.supplier_invoice_lines sil
        LEFT JOIN procurement.purchase_receipt_lines prl ON prl.id = sil.receipt_line_id
        LEFT JOIN procurement.purchase_receipts pr ON pr.document_id = prl.document_id
        WHERE sil.document_id = p_invoice_doc_id
          AND (
              sil.receipt_line_id IS NULL
              OR prl.id IS NULL
              OR pr.purchase_order_id <> v_purchase_order_id
              OR pr.supplier_id <> v_supplier_id
              OR prl.variant_id <> sil.variant_id
              OR (sil.po_line_id IS NOT NULL AND sil.po_line_id <> prl.po_line_id)
          )
    ) THEN
        RAISE EXCEPTION 'THREE_WAY_MATCH_FAILED: Every invoice line must match a receipt line for the same supplier and purchase order'
            USING ERRCODE = '55000';
    END IF;

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

    -- A return posted before the supplier invoice reduces the quantity that
    -- may subsequently clear GRNI. Validate at PO/variant level so partial
    -- receipts cannot hide an over-invoice on another receipt line.
    IF EXISTS (
        SELECT current_totals.variant_id
        FROM (
            SELECT sil.variant_id, sum(sil.quantity) AS current_quantity
            FROM procurement.supplier_invoice_lines sil
            WHERE sil.document_id = p_invoice_doc_id
            GROUP BY sil.variant_id
        ) current_totals
        WHERE current_totals.current_quantity
              + COALESCE((
                  SELECT sum(other_line.quantity)
                  FROM procurement.supplier_invoice_lines other_line
                  JOIN procurement.supplier_invoices other_invoice
                    ON other_invoice.document_id = other_line.document_id
                  JOIN core.business_documents other_doc
                    ON other_doc.id = other_invoice.document_id
                   AND other_doc.status = 'POSTED'
                  WHERE other_invoice.purchase_order_id = v_purchase_order_id
                    AND other_line.variant_id = current_totals.variant_id
                    AND other_invoice.document_id <> p_invoice_doc_id
              ), 0)
              > COALESCE((
                  SELECT sum(prl.quantity_received)
                  FROM procurement.purchase_receipt_lines prl
                  JOIN procurement.purchase_receipts pr ON pr.document_id = prl.document_id
                  JOIN core.business_documents receipt_doc
                    ON receipt_doc.id = pr.document_id
                   AND receipt_doc.status = 'POSTED'
                  WHERE pr.purchase_order_id = v_purchase_order_id
                    AND prl.variant_id = current_totals.variant_id
              ), 0)
              - COALESCE((
                  SELECT sum(return_line.quantity)
                  FROM procurement.supplier_return_lines return_line
                  JOIN procurement.supplier_returns supplier_return
                    ON supplier_return.id = return_line.return_id
                  JOIN core.business_documents return_doc
                    ON return_doc.id = supplier_return.document_id
                   AND return_doc.status = 'POSTED'
                  WHERE supplier_return.purchase_order_id = v_purchase_order_id
                    AND return_line.variant_id = current_totals.variant_id
              ), 0)
    ) THEN
        RAISE EXCEPTION 'THREE_WAY_MATCH_FAILED: Invoice quantity exceeds net received quantity after supplier returns'
            USING ERRCODE = '55000';
    END IF;

    SELECT sum(round(sil.quantity * prl.unit_cost, 2))
    INTO v_grni_amount
    FROM procurement.supplier_invoice_lines sil
    JOIN procurement.purchase_receipt_lines prl ON prl.id = sil.receipt_line_id
    WHERE sil.document_id = p_invoice_doc_id;

    IF v_grni_amount IS NULL OR v_grni_amount <= 0 THEN
        RAISE EXCEPTION 'THREE_WAY_MATCH_FAILED: Matched GRNI amount must be positive' USING ERRCODE = '55000';
    END IF;
    v_variance := v_base_total - v_grni_amount;

    v_invoice_sequence := core.claim_next_document_number('PURCHASE_INVOICE', v_fiscal_year);
    v_invoice_number := 'PI-' || v_fiscal_year || '-' || lpad(v_invoice_sequence::text, 6, '0');
    UPDATE core.business_documents
    SET status = 'POSTED', sequence_number = v_invoice_sequence,
        document_number = v_invoice_number, document_date = p_document_date,
        fiscal_period_id = p_fiscal_period_id, fiscal_year = v_fiscal_year,
        posted_at = now()
    WHERE id = p_invoice_doc_id;

    v_journal_document_id := finance.create_posted_journal(
        p_document_date,
        p_fiscal_period_id,
        'Supplier invoice journal entry',
        'PURCHASE_INVOICE',
        p_invoice_doc_id
    );

    INSERT INTO finance.journal_lines (document_id, line_number, account_code, debit, credit)
    VALUES (v_journal_document_id, v_line_number, finance.require_account_role('GRNI'), v_grni_amount, 0);
    v_line_number := v_line_number + 1;

    IF v_variance > 0 THEN
        INSERT INTO finance.journal_lines (document_id, line_number, account_code, debit, credit)
        VALUES (v_journal_document_id, v_line_number, finance.require_account_role('PROCUREMENT_VARIANCE'), v_variance, 0);
        v_line_number := v_line_number + 1;
    ELSIF v_variance < 0 THEN
        INSERT INTO finance.journal_lines (document_id, line_number, account_code, debit, credit)
        VALUES (v_journal_document_id, v_line_number, finance.require_account_role('PROCUREMENT_VARIANCE'), 0, -v_variance);
        v_line_number := v_line_number + 1;
    END IF;

    INSERT INTO finance.journal_lines (document_id, line_number, account_code, debit, credit)
    VALUES (v_journal_document_id, v_line_number, finance.require_account_role('ACCOUNTS_PAYABLE'), 0, v_base_total);

    INSERT INTO procurement.supplier_liabilities (
        supplier_id, purchase_order_id, invoice_document_id,
        journal_document_id, original_amount, outstanding_amount, due_date, status
    ) VALUES (
        v_supplier_id, v_purchase_order_id, p_invoice_doc_id,
        v_journal_document_id, v_base_total, v_base_total,
        p_document_date + 30, 'UNPAID'
    );

    PERFORM core.record_idempotent_result(
        'procurement.confirm_supplier_invoice', p_request_id, p_invoice_doc_id
    );

    RETURN jsonb_build_object(
        'document_id', p_invoice_doc_id,
        'document_number', v_invoice_number,
        'supplier_id', v_supplier_id,
        'total_amount', v_base_total,
        'grni_amount', v_grni_amount,
        'variance_amount', v_variance,
        'journal_document_id', v_journal_document_id,
        'status', 'POSTED'
    );
END;
$$;

REVOKE ALL ON FUNCTION procurement.confirm_supplier_invoice(
    text,uuid,bytea,bigint,bigint,date
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION procurement.confirm_supplier_invoice(
    text,uuid,bytea,bigint,bigint,date
) TO stockiha_runtime;

RESET ROLE;
