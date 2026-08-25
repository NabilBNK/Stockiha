-- WS-B-1 Gate 3b (4 of 4): dual-write account_id in
-- receivables.post_customer_refund. Confirmed clean in this task's
-- pre-check: ACCOUNTS_RECEIVABLE and v_credit_account ('CASH_DESK' or
-- 'BANK_ACCOUNT') both already resolve via finance.resolve_account_id().
-- account_id for the dynamic line is resolved from the same v_credit_account
-- variable's runtime value. Only the one journal-line INSERT changes.
SET ROLE stockiha_owner;

CREATE OR REPLACE FUNCTION receivables.post_customer_refund(p_session_token text, p_request_id uuid, p_authorization_id uuid, p_fiscal_period_id bigint, p_document_date date, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
    v_user_id bigint;
    v_workstation_id text;
    v_payload_hash bytea;
    v_cached_result bigint;
    v_auth receivables.customer_refund_authorizations%ROWTYPE;
    v_period_status text;
    v_period_start date;
    v_period_end date;
    v_fiscal_year integer;
    v_current_exposure numeric(14,2);
    v_session_status text;
    v_current_cashier bigint;
    v_session_workstation text;
    v_doc_id bigint;
    v_doc_seq bigint;
    v_doc_num text;
    v_journal_doc_id bigint;
    v_journal_seq bigint;
    v_journal_num text;
    v_credit_account text;
    v_original_payment_ledger_id bigint;
    v_refund_ledger_id bigint;
    v_new_exposure numeric(14,2);
    v_oldest_due date;
    v_movement_id bigint;
    v_result jsonb;
BEGIN
    SELECT user_id, workstation_id
    INTO v_user_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'POST_CUSTOMER_REFUND');

    IF p_request_id IS NULL OR p_authorization_id IS NULL THEN
        RAISE EXCEPTION 'refund request and authorization ids are required' USING ERRCODE = '22023';
    END IF;

    v_payload_hash := sha256(convert_to(jsonb_build_object(
        'authorization_id', p_authorization_id,
        'fiscal_period_id', p_fiscal_period_id,
        'document_date', p_document_date,
        'note', nullif(btrim(p_note), '')
    )::text, 'UTF8'));

    v_cached_result := core.reserve_idempotent_request(
        'receivables.post_customer_refund', p_request_id, v_payload_hash
    );
    IF v_cached_result IS NOT NULL THEN
        SELECT jsonb_build_object(
            'document_id', d.id,
            'document_number', d.document_number,
            'source_payment_document_id', r.source_payment_document_id,
            'customer_id', r.customer_id,
            'refund_method', r.refund_method,
            'amount', r.amount::text,
            'exposure_amount', cs.exposure_amount::text,
            'available_credit', (c.credit_limit - cs.exposure_amount)::text,
            'journal_document_id', r.journal_document_id
        ) INTO v_result
        FROM core.business_documents d
        JOIN receivables.customer_payment_refunds r ON r.document_id = d.id
        JOIN receivables.customers c ON c.id = r.customer_id
        JOIN receivables.customer_credit_state cs ON cs.customer_id = r.customer_id
        WHERE d.id = v_cached_result;
        RETURN v_result;
    END IF;

    SELECT * INTO v_auth
    FROM receivables.customer_refund_authorizations
    WHERE id = p_authorization_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'customer refund authorization not found' USING ERRCODE = '22023';
    END IF;
    IF v_auth.consumed_at IS NOT NULL THEN
        RAISE EXCEPTION 'customer refund authorization has already been consumed'
            USING ERRCODE = '55000';
    END IF;
    IF v_auth.expires_at <= now() THEN
        RAISE EXCEPTION 'customer refund authorization has expired' USING ERRCODE = '55000';
    END IF;
    IF v_auth.workstation_id <> v_workstation_id THEN
        RAISE EXCEPTION 'customer refund authorization belongs to another workstation'
            USING ERRCODE = '42501';
    END IF;

    IF EXISTS (
        SELECT 1 FROM receivables.customer_payment_refunds
        WHERE source_payment_document_id = v_auth.source_payment_document_id
    ) THEN
        RAISE EXCEPTION 'customer payment has already been refunded' USING ERRCODE = '55000';
    END IF;

    SELECT status, starts_on, ends_on, extract(year FROM starts_on)::integer
    INTO v_period_status, v_period_start, v_period_end, v_fiscal_year
    FROM finance.fiscal_periods
    WHERE id = p_fiscal_period_id
    FOR SHARE;

    IF NOT FOUND OR v_period_status <> 'OPEN' THEN
        RAISE EXCEPTION 'fiscal period is not open' USING ERRCODE = '55000';
    END IF;
    IF p_document_date < v_period_start OR p_document_date > v_period_end THEN
        RAISE EXCEPTION 'document date is outside fiscal period' USING ERRCODE = '22023';
    END IF;

    SELECT exposure_amount
    INTO v_current_exposure
    FROM receivables.customer_credit_state
    WHERE customer_id = v_auth.customer_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'customer credit state not found' USING ERRCODE = '22023';
    END IF;

    IF v_auth.refund_method = 'CASH' THEN
        IF v_auth.authorized_cashier_user_id <> v_user_id THEN
            RAISE EXCEPTION 'cash refund authorization is bound to another cashier'
                USING ERRCODE = '42501';
        END IF;

        SELECT status, current_cashier_user_id, workstation_id
        INTO v_session_status, v_current_cashier, v_session_workstation
        FROM sales.cash_sessions
        WHERE id = v_auth.cash_session_id
        FOR UPDATE;

        IF NOT FOUND OR v_session_status <> 'OPEN' THEN
            RAISE EXCEPTION 'cash refund requires the authorized open cash session'
                USING ERRCODE = '55000';
        END IF;
        IF v_current_cashier <> v_user_id OR v_session_workstation <> v_workstation_id THEN
            RAISE EXCEPTION 'cash refund session is not owned by the authorized cashier/workstation'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    PERFORM 1
    FROM receivables.customer_payments cp
    WHERE cp.document_id = v_auth.source_payment_document_id
      AND cp.customer_id = v_auth.customer_id
      AND cp.amount = v_auth.amount
    FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'source customer payment no longer matches authorization'
            USING ERRCODE = '55000';
    END IF;

    SELECT id INTO v_original_payment_ledger_id
    FROM receivables.customer_ledger_entries
    WHERE document_id = v_auth.source_payment_document_id
      AND customer_id = v_auth.customer_id
      AND entry_type = 'PAYMENT';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'source customer payment ledger entry not found' USING ERRCODE = '55000';
    END IF;

    v_doc_seq := core.claim_next_document_number('CUSTOMER_REFUND', v_fiscal_year);
    v_doc_num := 'RF-' || v_fiscal_year::text || '-' || lpad(v_doc_seq::text, 6, '0');
    INSERT INTO core.business_documents (
        document_type, status, document_date, fiscal_period_id, fiscal_year,
        sequence_number, document_number, posted_at
    ) VALUES (
        'CUSTOMER_REFUND', 'POSTED', p_document_date, p_fiscal_period_id, v_fiscal_year,
        v_doc_seq, v_doc_num, now()
    ) RETURNING id INTO v_doc_id;

    v_journal_seq := core.claim_next_document_number('JOURNAL_ENTRY', v_fiscal_year);
    v_journal_num := 'JE-' || v_fiscal_year::text || '-' || lpad(v_journal_seq::text, 6, '0');
    INSERT INTO core.business_documents (
        document_type, status, document_date, fiscal_period_id, fiscal_year,
        sequence_number, document_number, posted_at
    ) VALUES (
        'JOURNAL_ENTRY', 'POSTED', p_document_date, p_fiscal_period_id, v_fiscal_year,
        v_journal_seq, v_journal_num, now()
    ) RETURNING id INTO v_journal_doc_id;

    INSERT INTO finance.journal_entries (document_id, description, source_type, source_id)
    VALUES (v_journal_doc_id, 'Customer payment refund', 'CUSTOMER_REFUND', v_doc_id);

    v_credit_account := CASE
        WHEN v_auth.refund_method = 'CASH' THEN 'CASH_DESK'
        ELSE 'BANK_ACCOUNT'
    END;
    INSERT INTO finance.journal_lines (document_id, line_number, account_code, account_id, debit, credit) VALUES
        (v_journal_doc_id, 1, 'ACCOUNTS_RECEIVABLE', finance.resolve_account_id('ACCOUNTS_RECEIVABLE'), v_auth.amount, 0),
        (v_journal_doc_id, 2, v_credit_account, finance.resolve_account_id(v_credit_account), 0, v_auth.amount);

    INSERT INTO receivables.customer_payment_refunds (
        document_id,
        authorization_id,
        source_payment_document_id,
        customer_id,
        refund_method,
        amount,
        cash_session_id,
        journal_document_id,
        posted_by_user_id,
        authorized_by_user_id,
        workstation_id,
        reason,
        note
    ) VALUES (
        v_doc_id,
        v_auth.id,
        v_auth.source_payment_document_id,
        v_auth.customer_id,
        v_auth.refund_method,
        v_auth.amount,
        v_auth.cash_session_id,
        v_journal_doc_id,
        v_user_id,
        v_auth.authorized_by_user_id,
        v_workstation_id,
        v_auth.reason,
        nullif(btrim(p_note), '')
    );

    INSERT INTO receivables.payment_refund_allocations (
        refund_document_id, invoice_ledger_entry_id, amount
    )
    SELECT v_doc_id, pa.invoice_ledger_entry_id, pa.amount
    FROM receivables.payment_allocations pa
    WHERE pa.payment_document_id = v_auth.source_payment_document_id;

    INSERT INTO receivables.customer_ledger_entries (
        customer_id,
        entry_type,
        amount_delta,
        document_id,
        related_entry_id,
        posted_by_user_id,
        workstation_id
    ) VALUES (
        v_auth.customer_id,
        'PAYMENT_REFUND',
        v_auth.amount,
        v_doc_id,
        v_original_payment_ledger_id,
        v_user_id,
        v_workstation_id
    ) RETURNING id INTO v_refund_ledger_id;

    v_new_exposure := v_current_exposure + v_auth.amount;

    SELECT min(l.due_date)
    INTO v_oldest_due
    FROM receivables.customer_ledger_entries l
    WHERE l.customer_id = v_auth.customer_id
      AND l.entry_type = 'CREDIT_INVOICE'
      AND l.due_date IS NOT NULL
      AND l.amount_delta > receivables.net_invoice_allocated_amount(l.id);

    UPDATE receivables.customer_credit_state
    SET exposure_amount = v_new_exposure,
        oldest_open_due_date = v_oldest_due,
        last_rebuilt_at = now()
    WHERE customer_id = v_auth.customer_id;

    IF v_auth.refund_method = 'CASH' THEN
        INSERT INTO cash.movements (
            cash_session_id, business_document_id, movement_type, amount
        ) VALUES (
            v_auth.cash_session_id, v_doc_id, 'CUSTOMER_REFUND', -v_auth.amount
        ) RETURNING id INTO v_movement_id;

        PERFORM cash.enqueue_drawer_job(
            v_auth.cash_session_id,
            v_doc_id,
            'customer_refund:' || v_doc_id::text
        );
    END IF;

    UPDATE receivables.customer_refund_authorizations
    SET consumed_at = now(), consumed_document_id = v_doc_id
    WHERE id = v_auth.id;

    PERFORM core.record_idempotent_result(
        'receivables.post_customer_refund', p_request_id, v_doc_id
    );

    RETURN jsonb_build_object(
        'document_id', v_doc_id,
        'document_number', v_doc_num,
        'source_payment_document_id', v_auth.source_payment_document_id,
        'customer_id', v_auth.customer_id,
        'refund_method', v_auth.refund_method,
        'amount', v_auth.amount::text,
        'exposure_amount', v_new_exposure::text,
        'available_credit', (
            (SELECT credit_limit FROM receivables.customers WHERE id = v_auth.customer_id)
            - v_new_exposure
        )::text,
        'journal_document_id', v_journal_doc_id,
        'refund_ledger_entry_id', v_refund_ledger_id
    );
END;
$function$;

RESET ROLE;
