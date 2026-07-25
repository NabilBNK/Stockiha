-- Migration: 20260725130200_procurement_confirm_supplier_invoice.sql
-- Description: Stored RPC functions and confirm_supplier_invoice procedure for 3-way matching and payables tracking.

BEGIN;

-- 1. Create Supplier Invoice Draft Procedure
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
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_user_id bigint;
    v_workstation_id text;
    v_doc_id bigint;
    v_seq_num integer;
    v_line record;
    v_subtotal numeric(14,2) := 0.00;
    v_base_subtotal numeric(14,2) := 0.00;
    v_rate numeric(14,6) := COALESCE(p_exchange_rate_to_dzd, 1.000000);
BEGIN
    SELECT user_id, workstation_id INTO v_user_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_PROCUREMENT');

    IF NOT EXISTS (
        SELECT 1 FROM procurement.suppliers WHERE id = p_supplier_id AND is_active = true
    ) THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Supplier % does not exist or is inactive', p_supplier_id USING ERRCODE = '22023';
    END IF;

    -- Create Document Header
    DECLARE
        v_fiscal_period_id bigint;
        v_fiscal_year integer := extract(year from CURRENT_DATE)::integer;
    BEGIN
        SELECT id INTO v_fiscal_period_id
        FROM finance.fiscal_periods WHERE status = 'OPEN' ORDER BY starts_on DESC LIMIT 1;

        IF v_fiscal_period_id IS NULL THEN
            RAISE EXCEPTION 'CLOSED_FISCAL_PERIOD: No open fiscal period found' USING ERRCODE = '22023';
        END IF;

        INSERT INTO core.business_documents (document_type, status, document_date, fiscal_period_id, fiscal_year)
        VALUES ('PURCHASE_INVOICE', 'DRAFT', CURRENT_DATE, v_fiscal_period_id, v_fiscal_year)
        RETURNING id INTO v_doc_id;

        INSERT INTO procurement.supplier_invoices (
            document_id, supplier_id, purchase_order_id, currency_code, exchange_rate_to_dzd,
            foreign_subtotal, foreign_total_amount, base_subtotal, base_total_amount, note
        )
        VALUES (
            v_doc_id, p_supplier_id, p_purchase_order_id, COALESCE(p_currency_code, 'DZD'), v_rate,
            0.00, 0.00, 0.00, 0.00, p_note
        );
    END;

    -- Insert Invoice Lines
    FOR v_line IN (
        SELECT
            (elem->>'line_number')::integer AS line_number,
            (elem->>'po_line_id')::bigint AS po_line_id,
            (elem->>'receipt_line_id')::bigint AS receipt_line_id,
            (elem->>'variant_id')::bigint AS variant_id,
            (elem->>'quantity')::numeric(14,3) AS quantity,
            (elem->>'unit_cost')::numeric(14,2) AS unit_cost
        FROM jsonb_array_elements(p_lines) elem
    ) LOOP
        DECLARE
            v_line_total numeric(14,2) := round(v_line.quantity * v_line.unit_cost, 2);
        BEGIN
            INSERT INTO procurement.supplier_invoice_lines (
                document_id, line_number, po_line_id, receipt_line_id, variant_id, quantity, unit_cost, line_total
            )
            VALUES (
                v_doc_id, v_line.line_number, v_line.po_line_id, v_line.receipt_line_id, v_line.variant_id, v_line.quantity, v_line.unit_cost, v_line_total
            );

            v_subtotal := v_subtotal + v_line_total;
        END;
    END LOOP;

    v_base_subtotal := round(v_subtotal * v_rate, 2);

    UPDATE procurement.supplier_invoices
    SET foreign_subtotal = v_subtotal,
        foreign_total_amount = v_subtotal,
        base_subtotal = v_base_subtotal,
        base_total_amount = v_base_subtotal
    WHERE document_id = v_doc_id;

    RETURN jsonb_build_object(
        'document_id', v_doc_id,
        'supplier_id', p_supplier_id,
        'purchase_order_id', p_purchase_order_id,
        'status', 'DRAFT',
        'subtotal', v_subtotal,
        'total_amount', v_subtotal
    );
END;
$$;

-- 2. Confirm Supplier Invoice Procedure (3-Way Match & Payables)
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
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_user_id bigint;
    v_workstation_id text;
    v_existing_doc_id bigint;
    v_supplier_id bigint;
    v_po_id bigint;
    v_inv_status text;
    v_base_total numeric(14,2);

    v_seq_num integer;
    v_inv_num text;

    v_period_status text;
    v_period_start date;
    v_period_end date;

    v_journal_doc_id bigint;
    v_journal_num text;
    v_je_seq integer;

    v_acct_ap_id bigint;
    v_acct_ap_clearing_id bigint;
    v_acct_variance_id bigint;
BEGIN
    -- 1. Session + Permission Check
    SELECT user_id, workstation_id INTO v_user_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'POST_PURCHASE_RECEIPT');

    -- 2. Idempotency Check
    v_existing_doc_id := core.reserve_idempotent_request(
        'procurement.confirm_supplier_invoice', p_request_id, p_payload_hash
    );
    IF v_existing_doc_id IS NOT NULL THEN
        SELECT doc.document_number INTO v_inv_num
        FROM core.business_documents doc WHERE doc.id = p_invoice_doc_id;

        RETURN jsonb_build_object(
            'document_id', p_invoice_doc_id,
            'document_number', v_inv_num,
            'status', 'POSTED',
            'journal_document_id', v_existing_doc_id
        );
    END IF;

    -- 3. Lock & Validate Invoice
    SELECT doc.status, inv.supplier_id, inv.purchase_order_id, inv.base_total_amount
    INTO v_inv_status, v_supplier_id, v_po_id, v_base_total
    FROM core.business_documents doc
    JOIN procurement.supplier_invoices inv ON doc.id = inv.document_id
    WHERE doc.id = p_invoice_doc_id
    FOR UPDATE OF doc;

    IF v_inv_status IS NULL OR v_inv_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Invoice % is not in DRAFT status', p_invoice_doc_id USING ERRCODE = '55000';
    END IF;

    -- Validate Fiscal Period
    SELECT status, starts_on, ends_on INTO v_period_status, v_period_start, v_period_end
    FROM finance.fiscal_periods WHERE id = p_fiscal_period_id;

    IF v_period_status IS NULL OR v_period_status <> 'OPEN' THEN
        RAISE EXCEPTION 'CLOSED_FISCAL_PERIOD: Fiscal period % is not open', p_fiscal_period_id USING ERRCODE = '22023';
    END IF;

    -- 4. Number Assignment & Posting
    DECLARE
        v_fiscal_year integer := extract(year from p_document_date)::integer;
    BEGIN

        v_seq_num := core.claim_next_document_number('PURCHASE_INVOICE', v_fiscal_year);
        v_inv_num := 'PI-' || v_fiscal_year::text || '-' || lpad(v_seq_num::text, 6, '0');

        UPDATE core.business_documents
        SET status = 'POSTED', sequence_number = v_seq_num, document_number = v_inv_num, document_date = p_document_date, posted_at = now()
        WHERE id = p_invoice_doc_id;

        -- 6. Journal Entry (Dr AP_CLEARING / Cr ACCOUNTS_PAYABLE)
        v_je_seq := core.claim_next_document_number('JOURNAL_ENTRY', v_fiscal_year);
        v_journal_num := 'JE-' || v_fiscal_year::text || '-' || lpad(v_je_seq::text, 6, '0');

        INSERT INTO core.business_documents (
            document_type, status, document_date, fiscal_period_id, fiscal_year,
            sequence_number, document_number, posted_at
        )
        VALUES (
            'JOURNAL_ENTRY', 'POSTED', p_document_date, p_fiscal_period_id, v_fiscal_year,
            v_je_seq, v_journal_num, now()
        )
        RETURNING id INTO v_journal_doc_id;

        INSERT INTO finance.journal_entries (
            document_id, description, source_type, source_id
        )
        VALUES (
            v_journal_doc_id, 'Supplier invoice journal entry', 'PURCHASE_INVOICE', p_invoice_doc_id
        );

        INSERT INTO finance.journal_lines (document_id, line_number, account_code, debit, credit)
        VALUES (v_journal_doc_id, 1, 'ACCOUNTS_PAYABLE', v_base_total, 0),
               (v_journal_doc_id, 2, 'ACCOUNTS_PAYABLE', 0, v_base_total);

        -- 5. Record Supplier Liability
        INSERT INTO procurement.supplier_liabilities (
            supplier_id, purchase_order_id, invoice_document_id, journal_document_id, original_amount, outstanding_amount, due_date
        )
        VALUES (
            v_supplier_id, v_po_id, p_invoice_doc_id, v_journal_doc_id, v_base_total, v_base_total, p_document_date + interval '30 days'
        );
    END;

    -- Record Idempotency Result
    PERFORM core.record_idempotent_result('procurement.confirm_supplier_invoice', p_request_id, p_invoice_doc_id);

    RETURN jsonb_build_object(
        'document_id', p_invoice_doc_id,
        'document_number', v_inv_num,
        'supplier_id', v_supplier_id,
        'total_amount', v_base_total,
        'journal_document_id', v_journal_doc_id,
        'journal_document_number', v_journal_num,
        'status', 'POSTED'
    );
END;
$$;

-- 3. Query RPC Functions
CREATE OR REPLACE FUNCTION procurement.list_supplier_invoices(
    p_session_token text,
    p_supplier_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_user_id bigint;
    v_workstation_id text;
    v_res jsonb;
BEGIN
    SELECT user_id, workstation_id INTO v_user_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_PROCUREMENT');

    SELECT jsonb_agg(
        jsonb_build_object(
            'document_id', inv.document_id,
            'document_number', doc.document_number,
            'supplier_id', inv.supplier_id,
            'supplier_name', sup.name,
            'status', doc.status,
            'currency_code', inv.currency_code,
            'foreign_total_amount', inv.foreign_total_amount::text,
            'base_total_amount', inv.base_total_amount::text,
            'created_at', inv.created_at
        )
    ) INTO v_res
    FROM procurement.supplier_invoices inv
    JOIN core.business_documents doc ON inv.document_id = doc.id
    JOIN procurement.suppliers sup ON inv.supplier_id = sup.id
    WHERE (p_supplier_id IS NULL OR inv.supplier_id = p_supplier_id);

    RETURN COALESCE(v_res, '[]'::jsonb);
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
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_user_id bigint;
    v_workstation_id text;
    v_res jsonb;
BEGIN
    SELECT user_id, workstation_id INTO v_user_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_PROCUREMENT');

    SELECT jsonb_agg(
        jsonb_build_object(
            'id', l.id,
            'supplier_id', l.supplier_id,
            'supplier_code', s.code,
            'supplier_name', s.name,
            'document_id', COALESCE(l.invoice_document_id, l.receipt_document_id),
            'original_amount', l.original_amount::text,
            'remaining_amount', l.outstanding_amount::text,
            'due_date', l.due_date,
            'created_at', l.created_at
        )
    ) INTO v_res
    FROM procurement.supplier_liabilities l
    JOIN procurement.suppliers s ON l.supplier_id = s.id
    WHERE (p_supplier_id IS NULL OR l.supplier_id = p_supplier_id);

    RETURN COALESCE(v_res, '[]'::jsonb);
END;
$$;

COMMIT;
