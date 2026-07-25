-- Migration: 20260725140200_procurement_post_supplier_payment.sql
-- S3-003: Post supplier payment procedure and helper query functions for supplier returns.

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
SET search_path = core, procurement, inventory, catalog, public
AS $$
DECLARE
    v_user_id bigint;
    v_role_id bigint;
    v_fiscal_period_id bigint;
    v_doc_id bigint;
    v_return_id bigint;
    v_line record;
    v_line_num integer := 1;
BEGIN
    SELECT s.user_id, r.role_id INTO v_user_id, v_role_id
    FROM iam.application_sessions s
    JOIN iam.user_roles r ON s.user_id = r.user_id
    WHERE s.token_hash = sha256(p_session_token::bytea) AND (s.expires_at IS NULL OR s.expires_at > now());

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'SESSION_INVALID: Invalid or expired session' USING ERRCODE = '28000';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM iam.user_roles ur JOIN iam.roles r ON ur.role_id = r.id WHERE ur.user_id = v_user_id AND r.code IN ('ADMIN', 'MANAGER', 'ACCOUNTANT')) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: Role not authorized to create supplier returns' USING ERRCODE = '42501';
    END IF;

    IF jsonb_array_length(p_lines) = 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Supplier return must contain at least one line' USING ERRCODE = '22023';
    END IF;

    -- Find Open Fiscal Period
    SELECT id INTO v_fiscal_period_id FROM finance.fiscal_periods WHERE status = 'OPEN' LIMIT 1;

    -- Create Document Header
    INSERT INTO core.business_documents (
        document_type, status, document_date, fiscal_period_id, fiscal_year, sequence_number, document_number
    )
    VALUES (
        'PURCHASE_RETURN', 'DRAFT', CURRENT_DATE, v_fiscal_period_id, extract(year from CURRENT_DATE)::integer, NULL, NULL
    )
    RETURNING id INTO v_doc_id;

    INSERT INTO procurement.supplier_returns (
        document_id, supplier_id, warehouse_id, purchase_order_id, reason_code, note
    )
    VALUES (
        v_doc_id, p_supplier_id, p_warehouse_id, p_purchase_order_id, COALESCE(p_reason_code, 'DEFECTIVE_GOODS'), p_note
    )
    RETURNING id INTO v_return_id;

    -- Insert Lines
    FOR v_line IN SELECT * FROM jsonb_to_recordset(p_lines) AS x(
        variant_id bigint, quantity numeric(14,4), unit_cost numeric(14,4)
    ) LOOP
        INSERT INTO procurement.supplier_return_lines (
            return_id, line_number, variant_id, quantity, unit_cost, line_total
        )
        VALUES (
            v_return_id, v_line_num, v_line.variant_id, v_line.quantity, v_line.unit_cost, round(v_line.quantity * v_line.unit_cost, 2)
        );
        v_line_num := v_line_num + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'document_id', v_doc_id,
        'status', 'DRAFT'
    );
END;
$$;

CREATE OR REPLACE FUNCTION procurement.post_supplier_payment(
    p_session_token text,
    p_request_id uuid,
    p_request_hash bytea,
    p_supplier_id bigint,
    p_liability_id bigint,
    p_amount numeric(14,2),
    p_payment_method text,
    p_fiscal_period_id bigint,
    p_document_date date,
    p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, procurement, finance, public
AS $$
DECLARE
    v_user_id bigint;
    v_role_id bigint;
    v_existing_doc_id bigint;
    v_cached_result jsonb;
    v_period_status text;
    v_fiscal_year integer;
    v_outstanding numeric(14,2);
    v_sp_seq bigint;
    v_sp_num text;
    v_doc_id bigint;
    v_je_seq bigint;
    v_journal_num text;
    v_journal_doc_id bigint;
    v_credit_account text := 'CASH_DESK';
BEGIN
    -- 1. Validate Session & Permissions
    SELECT s.user_id, r.role_id INTO v_user_id, v_role_id
    FROM iam.application_sessions s
    JOIN iam.user_roles r ON s.user_id = r.user_id
    WHERE s.token_hash = sha256(p_session_token::bytea) AND (s.expires_at IS NULL OR s.expires_at > now());

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'SESSION_INVALID: Invalid or expired session' USING ERRCODE = '28000';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM iam.user_roles ur JOIN iam.roles r ON ur.role_id = r.id WHERE ur.user_id = v_user_id AND r.code IN ('ADMIN', 'MANAGER', 'ACCOUNTANT')) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: Role not authorized to post supplier payments' USING ERRCODE = '42501';
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Payment amount must be positive' USING ERRCODE = '22023';
    END IF;

    -- 2. Check Idempotency
    v_existing_doc_id := core.reserve_idempotent_request('procurement.post_supplier_payment', p_request_id, p_request_hash);
    IF v_existing_doc_id IS NOT NULL THEN
        SELECT doc.document_number INTO v_sp_num FROM core.business_documents doc WHERE doc.id = v_existing_doc_id;
        RETURN jsonb_build_object(
            'document_id', v_existing_doc_id,
            'document_number', v_sp_num,
            'status', 'POSTED'
        );
    END IF;

    -- Validate Fiscal Period
    SELECT status INTO v_period_status FROM finance.fiscal_periods WHERE id = p_fiscal_period_id;
    IF v_period_status IS NULL OR v_period_status <> 'OPEN' THEN
        RAISE EXCEPTION 'CLOSED_FISCAL_PERIOD: Fiscal period % is not open', p_fiscal_period_id USING ERRCODE = '22023';
    END IF;

    -- Lock Liability if provided
    IF p_liability_id IS NOT NULL THEN
        SELECT outstanding_amount INTO v_outstanding
        FROM procurement.supplier_liabilities
        WHERE id = p_liability_id AND supplier_id = p_supplier_id
        FOR UPDATE;

        IF v_outstanding IS NULL THEN
            RAISE EXCEPTION 'PRECONDITION_FAILED: Supplier liability % not found', p_liability_id USING ERRCODE = '55000';
        END IF;

        IF p_amount > v_outstanding THEN
            RAISE EXCEPTION 'PRECONDITION_FAILED: Payment amount (%) exceeds outstanding liability (%)', p_amount, v_outstanding USING ERRCODE = '55000';
        END IF;

        UPDATE procurement.supplier_liabilities
        SET outstanding_amount = outstanding_amount - p_amount,
            status = CASE WHEN (outstanding_amount - p_amount) = 0 THEN 'PAID' ELSE 'PARTIALLY_PAID' END
        WHERE id = p_liability_id;
    END IF;

    v_fiscal_year := extract(year from p_document_date)::integer;

    -- Create Document
    v_sp_seq := core.claim_next_document_number('SUPPLIER_PAYMENT', v_fiscal_year);
    v_sp_num := 'SP-' || v_fiscal_year::text || '-' || lpad(v_sp_seq::text, 6, '0');

    INSERT INTO core.business_documents (
        document_type, status, document_date, fiscal_period_id, fiscal_year, sequence_number, document_number, posted_at
    )
    VALUES (
        'SUPPLIER_PAYMENT', 'POSTED', p_document_date, p_fiscal_period_id, v_fiscal_year, v_sp_seq, v_sp_num, now()
    )
    RETURNING id INTO v_doc_id;

    INSERT INTO procurement.supplier_payments (
        document_id, supplier_id, liability_id, payment_method, amount, note
    )
    VALUES (
        v_doc_id, p_supplier_id, p_liability_id, COALESCE(p_payment_method, 'CASH'), p_amount, p_note
    );

    IF UPPER(COALESCE(p_payment_method, 'CASH')) IN ('BANK_TRANSFER', 'CHECK') THEN
        v_credit_account := 'BANK_ACCOUNT';
    END IF;

    -- Double-Entry Journal Entry
    v_je_seq := core.claim_next_document_number('JOURNAL_ENTRY', v_fiscal_year);
    v_journal_num := 'JE-' || v_fiscal_year::text || '-' || lpad(v_je_seq::text, 6, '0');

    INSERT INTO core.business_documents (
        document_type, status, document_date, fiscal_period_id, fiscal_year, sequence_number, document_number, posted_at
    )
    VALUES (
        'JOURNAL_ENTRY', 'POSTED', p_document_date, p_fiscal_period_id, v_fiscal_year, v_je_seq, v_journal_num, now()
    )
    RETURNING id INTO v_journal_doc_id;

    INSERT INTO finance.journal_entries (document_id, description, source_type, source_id)
    VALUES (v_journal_doc_id, 'Supplier payment journal entry', 'SUPPLIER_PAYMENT', v_doc_id);

    INSERT INTO finance.journal_lines (document_id, line_number, account_code, debit, credit)
    VALUES (v_journal_doc_id, 1, 'ACCOUNTS_PAYABLE', p_amount, 0),
           (v_journal_doc_id, 2, 'CASH_DESK', 0, p_amount);

    PERFORM core.record_idempotent_result('procurement.post_supplier_payment', p_request_id, v_doc_id);

    RETURN jsonb_build_object(
        'document_id', v_doc_id,
        'document_number', v_sp_num,
        'status', 'POSTED',
        'journal_document_id', v_journal_doc_id,
        'amount', p_amount
    );
END;
$$;

CREATE OR REPLACE FUNCTION procurement.list_supplier_returns(
    p_session_token text,
    p_supplier_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, procurement, inventory, public
AS $$
DECLARE
    v_user_id bigint;
    v_result jsonb;
BEGIN
    SELECT user_id INTO v_user_id FROM iam.application_sessions WHERE token_hash = sha256(p_session_token::bytea) AND (expires_at IS NULL OR expires_at > now());
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'SESSION_INVALID: Invalid session' USING ERRCODE = '28000';
    END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'document_id', doc.id,
            'document_number', doc.document_number,
            'supplier_id', ret.supplier_id,
            'supplier_name', sup.name,
            'warehouse_id', ret.warehouse_id,
            'status', doc.status,
            'reason_code', ret.reason_code,
            'created_at', ret.created_at
        ) ORDER BY ret.id DESC
    ), '[]'::jsonb)
    INTO v_result
    FROM core.business_documents doc
    JOIN procurement.supplier_returns ret ON doc.id = ret.document_id
    JOIN procurement.suppliers sup ON ret.supplier_id = sup.id
    WHERE (p_supplier_id IS NULL OR ret.supplier_id = p_supplier_id);

    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION procurement.list_supplier_payments(
    p_session_token text,
    p_supplier_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, procurement, public
AS $$
DECLARE
    v_user_id bigint;
    v_result jsonb;
BEGIN
    SELECT user_id INTO v_user_id FROM iam.application_sessions WHERE token_hash = sha256(p_session_token::bytea) AND (expires_at IS NULL OR expires_at > now());
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'SESSION_INVALID: Invalid session' USING ERRCODE = '28000';
    END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'document_id', doc.id,
            'document_number', doc.document_number,
            'supplier_id', pay.supplier_id,
            'supplier_name', sup.name,
            'payment_method', pay.payment_method,
            'amount', pay.amount,
            'created_at', pay.created_at
        ) ORDER BY pay.id DESC
    ), '[]'::jsonb)
    INTO v_result
    FROM core.business_documents doc
    JOIN procurement.supplier_payments pay ON doc.id = pay.document_id
    JOIN procurement.suppliers sup ON pay.supplier_id = sup.id
    WHERE (p_supplier_id IS NULL OR pay.supplier_id = p_supplier_id);

    RETURN v_result;
END;
$$;
